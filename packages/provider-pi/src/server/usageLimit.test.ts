// @effect-diagnostics globalDate:off -- Tests pin local wall-clock reset boundaries.
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  billedDriverForModel,
  classifyPiUsageLimit,
  failureForPiTerminalMessage,
  resetAtFromBilledWindows,
} from "./usageLimit.ts";

const nowMs = Date.UTC(2026, 10, 12, 18, 0, 0);

describe("classifyPiUsageLimit", () => {
  it.each([
    "You've hit your usage limit. Try again at 7:51 PM.",
    "You have hit your ChatGPT usage limit (plus plan). Try again in ~33 min.",
    "Claude API rate limit reached. Try again later.",
    "Claude usage limit reached. This turn is paused until the 5-hour limit resets in 33m.",
    "You've hit your 5-hour limit · resets 7:10am",
    "You’re out of extra usage",
    "Rate limited",
    "too many requests",
    "insufficient_quota",
    "quota exceeded",
    "You exceeded your quota",
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "Monthly usage limit reached",
    "Enable available balance to continue",
    "subscription_sharing_usage_limit_exceeded",
    "subscription_sharing_workplace_individual_usage_limit_exceeded",
    '{"code":1308}',
    "usageLimitExceeded",
    "rateLimitExceeded",
    "HTTP 429",
    "API Error: 503 [gateway] [429]: rate_limit_error (reset after 2h 33m 4s)",
    "out of budget",
    "out of credits",
    "spending limit reached",
    "usage limit resets_at: 1794521400",
  ])("matches %s", (message) => {
    assert.isNotNull(classifyPiUsageLimit(message, nowMs));
  });

  it.each([
    "The model is overloaded. Please try again.",
    "529 overloaded",
    "socket timed out",
    "temporary network failure",
    "internal server error 500",
    "context length exceeded",
    "maximum context length is 200000 tokens",
    "exceeded request buffer limit while retrying upstream",
    "billing address is invalid",
    "Request rejected",
    "Nothing to compact (session too small)",
    "Pi reported a model error.",
    "request id 42918392",
    "retry after 429 ms",
    '{"code":13080}',
  ])("leaves %s as an ordinary failure", (message) => {
    assert.isNull(classifyPiUsageLimit(message, nowMs));
  });

  it("reads a relative wait", () => {
    assert.deepEqual(
      classifyPiUsageLimit("You have hit your ChatGPT usage limit. Try again in ~33 min.", nowMs),
      { resetAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs + 33 * 60_000)) },
    );
  });

  it("reads reset after hours and minutes", () => {
    assert.deepEqual(
      classifyPiUsageLimit("API Error: 429 rate_limit_error (reset after 2h 33m 4s)", nowMs),
      {
        resetAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs + (2 * 3600 + 33 * 60 + 4) * 1000)),
      },
    );
  });

  it("reads an ISO timestamp", () => {
    assert.deepEqual(
      classifyPiUsageLimit("usage limit reached at 2026-11-12T22:51:21.000Z", nowMs),
      { resetAt: "2026-11-12T22:51:21.000Z" },
    );
  });

  it("reads resets_at seconds", () => {
    assert.deepEqual(classifyPiUsageLimit('usage limit "resets_at": 1794521481', nowMs), {
      resetAt: DateTime.formatIso(DateTime.makeUnsafe(1794521481 * 1000)),
    });
  });

  it("reads a local clock and rolls a past time to the next day", () => {
    const localNow = new Date(2026, 10, 12, 20, 0, 0, 0);
    const expected = new Date(2026, 10, 13, 19, 51, 0, 0);
    assert.deepEqual(
      classifyPiUsageLimit(
        "You've hit your usage limit. try again at 7:51 PM.",
        localNow.getTime(),
      ),
      { resetAt: expected.toISOString() },
    );
  });

  it("reads a same-day local clock", () => {
    const localNow = new Date(2026, 10, 12, 15, 0, 0, 0);
    const expected = new Date(2026, 10, 12, 19, 51, 0, 0);
    assert.equal(
      classifyPiUsageLimit("usage limit. try again at 7:51 PM.", localNow.getTime())?.resetAt,
      expected.toISOString(),
    );
  });

  it("reads a 24-hour clock", () => {
    const localNow = new Date(2026, 10, 12, 15, 0, 0, 0);
    const expected = new Date(2026, 10, 12, 19, 51, 0, 0);
    assert.equal(
      classifyPiUsageLimit("usage limit resets 19:51", localNow.getTime())?.resetAt,
      expected.toISOString(),
    );
  });

  it("keeps the limit when the message has no reset time", () => {
    assert.deepEqual(
      classifyPiUsageLimit("Claude API rate limit reached. Try again later.", nowMs),
      {
        resetAt: null,
      },
    );
  });
});

describe("failureForPiTerminalMessage", () => {
  it("stores a usage limit", () => {
    const failure = failureForPiTerminalMessage(
      "You have hit your ChatGPT usage limit. Try again in ~15 min.",
      nowMs,
      { retryable: false },
    );
    assert.equal(failure.class, "usage_limit");
    assert.equal(failure.retryable, true);
    assert.equal(failure.resetAt, DateTime.formatIso(DateTime.makeUnsafe(nowMs + 15 * 60_000)));
  });

  it("keeps an ordinary terminal failure", () => {
    const failure = failureForPiTerminalMessage("socket timed out", nowMs, { retryable: false });
    assert.equal(failure.class, "provider_error");
    assert.equal(failure.retryable, false);
    assert.isUndefined(failure.resetAt);
  });
});

const billedNow = Date.parse("2026-11-18T20:00:00.000Z");

describe("billed usage reset", () => {
  it.each([
    ["openai-codex/gpt-6.2-sol", "codex"],
    ["claude-extra/claude-sonnet-5-5", "claudeAgent"],
    ["xai/grok-4.7", "grok"],
  ] as const)("maps %s to %s", (model, driver) => {
    assert.equal(billedDriverForModel(model), driver);
  });

  it("ignores a slug with no billed driver", () => {
    assert.isNull(billedDriverForModel("other/default"));
    assert.isNull(billedDriverForModel(null));
  });

  it("uses an exhausted window instead of a later open weekly bar", () => {
    assert.equal(
      resetAtFromBilledWindows(
        [
          { kind: "session", usedPercent: 100, resetsAt: "2026-11-18T22:00:00.000Z" },
          { kind: "weekly", usedPercent: 12, resetsAt: "2026-11-25T00:00:00.000Z" },
        ],
        billedNow,
      ),
      "2026-11-18T22:00:00.000Z",
    );
  });

  it("does not use an open session clock when the bars have not caught up", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [
          { kind: "session", usedPercent: 40, resetsAt: "2026-11-18T22:00:00.000Z" },
          { kind: "weekly", usedPercent: 12, resetsAt: "2026-11-25T00:00:00.000Z" },
        ],
        billedNow,
      ),
    );
  });

  it("returns nothing when an exhausted window has no clock", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [
          { kind: "weekly", usedPercent: 100 },
          { kind: "session", usedPercent: 100, resetsAt: "2026-11-18T22:00:00.000Z" },
        ],
        billedNow,
      ),
    );
  });

  it("ignores a clock that already passed", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [{ kind: "session", usedPercent: 100, resetsAt: "2026-11-18T19:00:00.000Z" }],
        billedNow,
      ),
    );
  });

  it("does not guess an open weekly clock", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [{ kind: "weekly", usedPercent: 12, resetsAt: "2026-11-25T00:00:00.000Z" }],
        billedNow,
      ),
    );
  });
});
