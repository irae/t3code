const USAGE_LIMIT_PATTERN =
  /usage[_\s-]*limit|rate[_\s-]*limited|rate[_\s-]*limit|too many requests|insufficient[_\s-]*quota|quota exceeded|exceeded (?:your |the )?quota|out of quota|\bout of budget\b|\bout of extra usage\b|\bout of credits\b|insufficient credits|spend(?:ing)? limit|GoUsageLimitError|FreeUsageLimitError|subscription_sharing_(?:workplace_individual_)?usage_limit|usageLimitExceeded|rateLimitExceeded|usage_limit_reached|usage_not_included|rate_limit_exceeded|PRO_USER_USAGE_LIMIT|you['’]ve hit your (?:(?:5-hour|session|weekly|usage) )?limit|you['’]re out of extra usage|\b(?:5-hour|session|weekly) limit\b|available balance|"code"\s*:\s*"?1308(?![0-9])|(?<![A-Za-z0-9])429(?![A-Za-z0-9])(?!\s*(?:ms|milliseconds|bytes|kb|mb|tokens))/i;

const RESETS_AT_UNIX = /\breset_?s?_?at["']?\s*[:=]\s*["']?(\d{13}|\d{10})(?!\d)/i;
const ABSOLUTE_RESET =
  /(?:\breset_?s?_?at\b|\b(?:try again|retry|resets?)\s+at)\s*["']?\s*[:=]?\s*["']?(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:[ \t]*(Z|[+-]\d{2}:?\d{2}))?/gi;
const WALL_RESET =
  /\b(?:try again at|retry at|resets?(?: at)?)\s+(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s+)?(\d{1,2})(?::([0-5]\d)(?::([0-5]\d))?)?(?:\s*([ap])\.?m\.?)?(?![\w:+-])/gi;

const RESET_DURATION =
  /(?:\breset after\b|\bresets in\b|\btry again in\b|\bretry (?:after|in)\b)\s*~?\s*(?:(\d+)\s*d(?:ays?)?(?![a-z]))?\s*(?:(\d+)\s*h(?:ours?|rs?)?(?![a-z]))?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?(?!s|[a-z]))?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?(?![a-z]))?/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

type ResetCandidate =
  | { kind: "epoch"; milliseconds: number }
  | { kind: "duration"; milliseconds: number }
  | { kind: "zoned"; timestamp: string }
  | {
      kind: "local";
      date?: { year: number; month: number; day: number };
      hour: number;
      minute: number;
      second?: number;
    };

export function parseUsageLimitMessage(message: string): readonly ResetCandidate[] | null {
  if (!USAGE_LIMIT_PATTERN.test(message)) return null;
  const candidates: ResetCandidate[] = [];
  const unix = unixReset(message);
  if (unix !== null) candidates.push({ kind: "epoch", milliseconds: unix });
  const duration = durationReset(message);
  if (duration !== null) candidates.push({ kind: "duration", milliseconds: duration });
  for (const [, date, time, offset] of message.matchAll(ABSOLUTE_RESET)) {
    if (date === undefined || time === undefined) continue;
    if (offset !== undefined) {
      candidates.push({ kind: "zoned", timestamp: `${date}T${time}${offset.toUpperCase()}` });
      continue;
    }
    const [year, month, day] = date.split("-");
    const [hour, minute, second] = time.split(":");
    candidates.push({
      kind: "local",
      date: { year: Number(year), month: Number(month), day: Number(day) },
      hour: Number(hour),
      minute: Number(minute),
      ...(second === undefined ? {} : { second: Math.trunc(Number(second)) }),
    });
  }
  return [...candidates, ...wallResets(message)];
}

function wallResets(message: string): ResetCandidate[] {
  const resets: ResetCandidate[] = [];
  for (const match of message.matchAll(WALL_RESET)) {
    const [text, month, day, year, hour, minute, second, meridiem] = match;
    const trailing = message.slice(match.index + text.length);
    if (/^\s+on\s+/i.test(trailing)) return [];
    if (hour === undefined || (minute === undefined && meridiem === undefined)) continue;
    const hours = wallHour(Number(hour), meridiem);
    if (hours === null) continue;
    const monthIndex =
      month === undefined ? undefined : MONTHS.indexOf(month.toLowerCase().slice(0, 3));
    if (monthIndex === -1) continue;
    resets.push({
      kind: "local",
      ...(monthIndex === undefined
        ? {}
        : { date: { year: Number(year), month: monthIndex + 1, day: Number(day) } }),
      hour: hours,
      minute: Number(minute ?? 0),
      ...(second === undefined ? {} : { second: Number(second) }),
    });
  }
  return resets;
}

function unixReset(message: string): number | null {
  const match = RESETS_AT_UNIX.exec(message);
  if (match?.[1] === undefined) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  return raw >= 1e12 ? raw : raw * 1000;
}

function wallHour(hours: number, meridiem: string | undefined): number | null {
  if (meridiem !== undefined) {
    if (hours < 1 || hours > 12) return null;
    return (hours % 12) + (meridiem.toLowerCase() === "p" ? 12 : 0);
  }
  return hours > 23 ? null : hours;
}

function durationReset(message: string): number | null {
  const match = RESET_DURATION.exec(message);
  if (match === null) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  if (days + hours + minutes + seconds <= 0) return null;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}
