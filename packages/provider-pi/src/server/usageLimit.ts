// @effect-diagnostics globalDate:off -- A provider reset clock is the viewer's local wall time. Effect DateTime parts are UTC.
import type {
  OrchestrationV2ProviderFailure,
  ProviderDriverKind,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";

const USAGE_LIMIT_PATTERN =
  /usage[_\s-]*limit|rate[_\s-]*limited|rate[_\s-]*limit|too many requests|insufficient[_\s-]*quota|quota exceeded|exceeded (?:your |the )?quota|out of quota|\bout of budget\b|\bout of extra usage\b|\bout of credits\b|insufficient credits|spend(?:ing)? limit|GoUsageLimitError|FreeUsageLimitError|subscription_sharing_(?:workplace_individual_)?usage_limit|usageLimitExceeded|rateLimitExceeded|usage_limit_reached|usage_not_included|rate_limit_exceeded|PRO_USER_USAGE_LIMIT|you['’]ve hit your (?:(?:5-hour|session|weekly|usage) )?limit|you['’]re out of extra usage|\b(?:5-hour|session|weekly) limit\b|available balance|"code"\s*:\s*"?1308(?![0-9])|(?<![A-Za-z0-9])429(?![A-Za-z0-9])(?!\s*(?:ms|milliseconds|bytes|kb|mb|tokens))/i;

const ISO_TIMESTAMP = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;

const RESETS_AT_UNIX = /resets_at["']?\s*[:=]\s*"?(\d{10,13})(?!\d)/i;

const RESET_DURATION =
  /(?:reset after|resets in|try again in|retry (?:after|in))\s*~?\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?/i;

const RESET_CLOCK_AMPM =
  /(?:try again at|resets(?: at)?)\s+([1-9]|1[0-2])(?::([0-5]\d))?\s*(am|pm)\b/i;

const RESET_CLOCK_24 = /(?:try again at|resets(?: at)?)\s+(1[3-9]|2[0-3]):([0-5]\d)\b/i;

const PAST_RESET_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
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
  const candidate =
    isoReset(message) ??
    unixReset(message) ??
    durationReset(message, nowMs) ??
    clockReset(message, nowMs);
  if (candidate === null || !acceptableReset(candidate, nowMs)) return null;
  return DateTime.formatIso(DateTime.makeUnsafe(candidate));
}

function acceptableReset(resetMs: number, nowMs: number): boolean {
  return (
    Number.isFinite(resetMs) &&
    resetMs < 8.64e15 &&
    resetMs > nowMs - PAST_RESET_WINDOW_MS &&
    resetMs < nowMs + LATEST_RESET_WINDOW_MS
  );
}

function isoReset(message: string): number | null {
  const match = ISO_TIMESTAMP.exec(message);
  if (match?.[1] === undefined) return null;
  const resetMs = Date.parse(match[1]);
  return Number.isFinite(resetMs) ? resetMs : null;
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

function clockReset(message: string, nowMs: number): number | null {
  const ampm = RESET_CLOCK_AMPM.exec(message);
  if (ampm?.[1] !== undefined && ampm[3] !== undefined) {
    return localClock(nowMs, hourOn12HourClock(Number(ampm[1]), ampm[3]), Number(ampm[2] ?? 0));
  }
  const hour24 = RESET_CLOCK_24.exec(message);
  if (hour24?.[1] === undefined || hour24[2] === undefined) return null;
  return localClock(nowMs, Number(hour24[1]), Number(hour24[2]));
}

function hourOn12HourClock(hour: number, ampm: string): number {
  const pm = ampm.toLowerCase() === "pm";
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

export function billedDriverForModel(model: string | null | undefined): ProviderDriverKind | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  const provider = (slash === -1 ? model : model.slice(0, slash)).toLowerCase();
  if (provider.includes("claude")) return "claudeAgent" as ProviderDriverKind;
  if (provider.includes("codex") || provider === "openai") return "codex" as ProviderDriverKind;
  if (provider.includes("grok") || provider === "xai") return "grok" as ProviderDriverKind;
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

function localClock(nowMs: number, hour: number, minute: number): number {
  const candidate = new Date(nowMs);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() < nowMs - 60_000) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
}
