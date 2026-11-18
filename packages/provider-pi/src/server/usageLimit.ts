import type {
  OrchestrationV2ProviderFailure,
  ProviderDriverKind,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";

const USAGE_LIMIT_PATTERN =
  /usage[_\s-]*limit|rate[_\s-]*limited|rate[_\s-]*limit|too many requests|insufficient[_\s-]*quota|quota exceeded|exceeded (?:your |the )?quota|out of quota|\bout of budget\b|\bout of extra usage\b|\bout of credits\b|insufficient credits|spend(?:ing)? limit|GoUsageLimitError|FreeUsageLimitError|subscription_sharing_(?:workplace_individual_)?usage_limit|usageLimitExceeded|rateLimitExceeded|usage_limit_reached|usage_not_included|rate_limit_exceeded|PRO_USER_USAGE_LIMIT|you['’]ve hit your (?:(?:5-hour|session|weekly|usage) )?limit|you['’]re out of extra usage|\b(?:5-hour|session|weekly) limit\b|available balance|"code"\s*:\s*"?1308(?![0-9])|(?<![A-Za-z0-9])429(?![A-Za-z0-9])(?!\s*(?:ms|milliseconds|bytes|kb|mb|tokens))/i;

const RESETS_AT_UNIX = /resets_at["']?\s*[:=]\s*"?(\d{10,13})(?!\d)/i;

const RESET_DURATION =
  /(?:reset after|resets in|try again in|retry (?:after|in))\s*~?\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?/i;

const LATEST_RESET_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

export function classifyPiUsageLimit(
  message: string,
  nowMs: number,
): { readonly resetAt: string | null } | null {
  if (!USAGE_LIMIT_PATTERN.test(message)) return null;
  return { resetAt: resetAtFromMessage(message, nowMs) };
}

export function failureForPiTerminalMessage(
  message: string,
  nowMs: number,
  ordinary?: { readonly retryable?: boolean | null },
): OrchestrationV2ProviderFailure {
  const limit = classifyPiUsageLimit(message, nowMs);
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

function resetAtFromMessage(message: string, nowMs: number): string | null {
  const candidate = unixReset(message) ?? durationReset(message, nowMs);
  if (candidate === null || !acceptableReset(candidate, nowMs)) return null;
  return DateTime.formatIso(DateTime.makeUnsafe(candidate));
}

function acceptableReset(resetMs: number, nowMs: number): boolean {
  return (
    Number.isFinite(resetMs) &&
    resetMs < 8.64e15 &&
    resetMs > nowMs &&
    resetMs < nowMs + LATEST_RESET_WINDOW_MS
  );
}

function unixReset(message: string): number | null {
  const match = RESETS_AT_UNIX.exec(message);
  if (match?.[1] === undefined) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  return raw >= 1e12 ? raw : raw * 1000;
}

function durationReset(message: string, nowMs: number): number | null {
  const match = RESET_DURATION.exec(message);
  if (match === null) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  if (hours + minutes + seconds <= 0) return null;
  return nowMs + ((hours * 60 + minutes) * 60 + seconds) * 1000;
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

function futureResetMs(resetsAt: string | undefined, nowMs: number): number | null {
  if (resetsAt === undefined) return null;
  const at = Date.parse(resetsAt);
  return Number.isFinite(at) && at > nowMs ? at : null;
}

/** Every exhausted window must have reset. A past clock already did. */
export function resetAtFromBilledWindows(
  windows: readonly Pick<ServerProviderUsageWindow, "usedPercent" | "resetsAt">[],
  nowMs: number,
): string | null {
  const exhausted = windows.filter((window) => window.usedPercent >= 100);
  if (exhausted.length === 0 || exhausted.some((window) => window.resetsAt === undefined)) {
    return null;
  }
  const resets = exhausted.flatMap((window) => {
    const resetsAt = window.resetsAt;
    return futureResetMs(resetsAt, nowMs) === null || resetsAt === undefined ? [] : [resetsAt];
  });
  resets.sort((left, right) => Date.parse(left) - Date.parse(right));
  return resets.at(-1) ?? null;
}
