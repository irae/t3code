import type {
  OrchestrationV2ProviderFailure,
  ProviderDriverKind,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";

import { parseUsageLimitMessage } from "./parseUsageLimitMessage.ts";

const LATEST_RESET_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

export function classifyPiUsageLimit(
  message: string,
  nowMs: number,
  zone: DateTime.TimeZone = DateTime.zoneMakeLocal(),
): { readonly resetAt: string | null } | null {
  const candidates = parseUsageLimitMessage(message);
  if (candidates === null) return null;
  return { resetAt: resolveResetAt(candidates, nowMs, zone) };
}

export function failureForPiTerminalMessage(
  message: string,
  nowMs: number,
  ordinary?: { readonly retryable?: boolean | null; readonly zone?: DateTime.TimeZone },
): OrchestrationV2ProviderFailure {
  const limit = classifyPiUsageLimit(message, nowMs, ordinary?.zone);
  if (limit !== null) {
    return makeProviderFailure({
      message,
      class: "usage_limit",
      retryable: true,
      resetAt: limit.resetAt,
    });
  }
  return makeProviderFailure({
    message,
    class: "provider_error",
    ...(ordinary?.retryable === undefined ? {} : { retryable: ordinary.retryable }),
  });
}

function resolveResetAt(
  candidates: NonNullable<ReturnType<typeof parseUsageLimitMessage>>,
  nowMs: number,
  zone: DateTime.TimeZone,
): string | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    let at: number;
    switch (candidate.kind) {
      case "epoch":
        at = candidate.milliseconds;
        break;
      case "duration":
        at = nowMs + candidate.milliseconds;
        break;
      case "zoned": {
        const parsed = DateTime.make(candidate.timestamp);
        if (Option.isNone(parsed)) continue;
        at = DateTime.toEpochMillis(parsed.value);
        break;
      }
      case "local": {
        const date =
          candidate.date ?? DateTime.toParts(DateTime.setZone(DateTime.makeUnsafe(nowMs), zone));
        const placed = placeWallClock(
          {
            year: date.year,
            month: date.month,
            day: date.day,
            hour: candidate.hour,
            minute: candidate.minute,
            second: candidate.second ?? 0,
          },
          zone,
        );
        if (placed === null) continue;
        at = candidate.second === undefined ? placed + 60_000 : placed;
        break;
      }
    }
    if (acceptableReset(at, nowMs)) latest = Math.max(latest, at);
  }
  return Number.isFinite(latest) ? DateTime.formatIso(DateTime.makeUnsafe(latest)) : null;
}

function acceptableReset(resetMs: number, nowMs: number): boolean {
  return (
    Number.isFinite(resetMs) &&
    resetMs < 8.64e15 &&
    resetMs > nowMs &&
    resetMs < nowMs + LATEST_RESET_WINDOW_MS
  );
}

// A repeated local hour takes the later instant so resume does not fire early. A gap is not a reset.
function placeWallClock(
  parts: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
  },
  zone: DateTime.TimeZone,
): number | null {
  const options = { timeZone: zone, adjustForTimeZone: true as const };
  const unambiguous = DateTime.makeZoned(parts, { ...options, disambiguation: "reject" });
  if (Option.isSome(unambiguous)) return DateTime.toEpochMillis(unambiguous.value);
  const later = DateTime.makeZoned(parts, { ...options, disambiguation: "later" });
  if (Option.isNone(later)) return null;
  const placed = DateTime.toParts(later.value);
  if (placed.hour !== parts.hour || placed.minute !== parts.minute || placed.day !== parts.day) {
    return null;
  }
  return DateTime.toEpochMillis(later.value);
}

export function billedDriverForModel(model: string | null | undefined): ProviderDriverKind | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  const provider = (slash === -1 ? model : model.slice(0, slash)).toLowerCase();
  const name = (slash === -1 ? "" : model.slice(slash + 1)).toLowerCase();
  if (provider.includes("claude") || name.includes("claude")) {
    return "claudeAgent" as ProviderDriverKind;
  }
  if (provider.includes("codex")) return "codex" as ProviderDriverKind;
  if (provider.includes("grok") || name.includes("grok")) return "grok" as ProviderDriverKind;
  return null;
}

function readResetMs(resetsAt: string | undefined): number | null {
  if (typeof resetsAt !== "string" || resetsAt.length === 0) return null;
  const at = DateTime.make(resetsAt);
  if (Option.isNone(at)) return null;
  const ms = DateTime.toEpochMillis(at.value);
  return Number.isFinite(ms) ? ms : null;
}

/** Every exhausted window must have a readable clock. A past clock already reset. */
export function resetAtFromBilledWindows(
  windows: readonly Pick<ServerProviderUsageWindow, "usedPercent" | "resetsAt">[],
  nowMs: number,
): string | null {
  const exhausted = windows.filter((window) => window.usedPercent >= 100);
  if (exhausted.length === 0) return null;
  const future: number[] = [];
  for (const window of exhausted) {
    const at = readResetMs(window.resetsAt);
    if (at === null) return null;
    if (at > nowMs) future.push(at);
  }
  const latest = future.reduce((max, at) => Math.max(max, at), Number.NEGATIVE_INFINITY);
  return Number.isFinite(latest) ? DateTime.formatIso(DateTime.makeUnsafe(latest)) : null;
}
