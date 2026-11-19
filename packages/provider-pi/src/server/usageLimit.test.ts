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

  it("reads a zoned reset without moving it into the system zone", () => {
    const dhaka = DateTime.zoneMakeNamedUnsafe("Asia/Dhaka");
    assert.equal(
      classifyPiUsageLimit("usage limit resets at 2026-11-12 19:51:21 -03:00", nowMs, dhaka)
        ?.resetAt,
      "2026-11-12T22:51:21.000Z",
    );
  });

  it("places an unzoned reset in the given zone, not UTC", () => {
    const dhaka = DateTime.zoneMakeNamedUnsafe("Asia/Dhaka");
    assert.equal(
      classifyPiUsageLimit("usage limit resets at 2026-11-13 04:00:00", nowMs, dhaka)?.resetAt,
      "2026-11-12T22:00:00.000Z",
    );
  });

  it("does not treat a reached-at timestamp as the reset", () => {
    assert.deepEqual(
      classifyPiUsageLimit(
        "usage limit reached at 2026-11-12T20:00:00.000Z. Resets at 2026-11-12T22:51:21.000Z",
        nowMs,
      ),
      { resetAt: "2026-11-12T22:51:21.000Z" },
    );
    assert.deepEqual(
      classifyPiUsageLimit("usage limit reached at 2026-11-12T22:51:21.000Z", nowMs),
      { resetAt: null },
    );
  });

  it.each(["4:00:00 PM", "16:00:00"])("reads local clock %s", (clock) => {
    const localNow = new Date(2026, 10, 19, 12);
    assert.deepEqual(
      classifyPiUsageLimit(
        `Claude subscription rate limit reached (five_hour) — resets at ${clock}`,
        localNow.getTime(),
      ),
      { resetAt: new Date(2026, 10, 19, 16).toISOString() },
    );
  });

  it("treats a minute-precision clock as the next minute", () => {
    const localNow = new Date(2026, 10, 19, 12);
    assert.deepEqual(
      classifyPiUsageLimit(
        "Claude subscription rate limit reached (five_hour) — resets at 16:00",
        localNow.getTime(),
      ),
      { resetAt: new Date(2026, 10, 19, 16, 1).toISOString() },
    );
  });

  it("does not invent tomorrow when the clock has already passed", () => {
    const localNow = new Date(2026, 10, 19, 18);
    assert.deepEqual(classifyPiUsageLimit("usage limit resets at 4:00:00 PM", localNow.getTime()), {
      resetAt: null,
    });
  });

  it("reads a dated clock in the given zone and leaves a past date unknown", () => {
    const dhaka = DateTime.zoneMakeNamedUnsafe("Asia/Dhaka");
    const before = Date.UTC(2026, 10, 7, 3, 0, 0);
    assert.equal(
      classifyPiUsageLimit("You've hit your usage limit. Try again at 3:37 PM.", before, dhaka)
        ?.resetAt,
      "2026-11-07T09:38:00.000Z",
    );
    assert.equal(
      classifyPiUsageLimit(
        "You've hit your usage limit. Try again at Nov 11th, 2026 3:37 PM.",
        before,
        dhaka,
      )?.resetAt,
      "2026-11-11T09:38:00.000Z",
    );
    assert.equal(
      classifyPiUsageLimit("usage limit. Try again at Nov 11th, 2026 3:37 PM.", nowMs, dhaka)
        ?.resetAt,
      null,
    );
  });

  it("takes the later instant of a repeated local hour and rejects a missing one", () => {
    const newYork = DateTime.zoneMakeNamedUnsafe("America/New_York");
    for (const now of [Date.UTC(2026, 10, 1, 5, 15, 0), Date.UTC(2026, 10, 1, 6, 15, 0)]) {
      assert.equal(
        classifyPiUsageLimit("usage limit. Try again at 1:30 AM.", now, newYork)?.resetAt,
        "2026-11-01T06:31:00.000Z",
      );
    }
    assert.equal(
      classifyPiUsageLimit("usage limit resets at 2:30 AM.", Date.UTC(2026, 2, 8, 6, 0, 0), newYork)
        ?.resetAt,
      null,
    );
  });

  it("skips a stale absolute reset in favor of a valid wait", () => {
    assert.deepEqual(
      classifyPiUsageLimit("usage limit resets_at: 1000000000; retry in 1m", nowMs),
      {
        resetAt: new Date(nowMs + 60_000).toISOString(),
      },
    );
  });

  it.each(["resets_at", "reset_at", "resetAt"])("reads %s seconds", (key) => {
    assert.equal(
      classifyPiUsageLimit(`usage limit "${key}": 1794521481`, nowMs)?.resetAt,
      DateTime.formatIso(DateTime.makeUnsafe(1794521481 * 1000)),
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

it("leaves trailing calendar dates to the usage-window fallback", () => {
  assert.deepEqual(
    classifyPiUsageLimit(
      "You've hit your usage limit. Try again at 1:36 PM. Weekly limit resets 17:41 on 1 Jul",
      Date.parse("2026-06-05T10:00:00Z"),
      DateTime.zoneMakeOffset(0),
    ),
    { resetAt: null },
  );
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
    assert.equal(String(billedDriverForModel(model)), driver);
  });

  it("does not map an API-key provider token onto a subscription driver", () => {
    assert.isNull(billedDriverForModel("openai/gpt-6"));
    assert.isNull(billedDriverForModel("xai/other"));
  });

  it("ignores a slug with no billed driver", () => {
    assert.isNull(billedDriverForModel("other/default"));
    assert.isNull(billedDriverForModel(null));
  });

  it("uses an exhausted window instead of a later open weekly bar", () => {
    assert.equal(
      resetAtFromBilledWindows(
        [
          { usedPercent: 100, resetsAt: "2026-11-18T22:00:00.000Z" },
          { usedPercent: 12, resetsAt: "2026-11-25T00:00:00.000Z" },
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
          { usedPercent: 40, resetsAt: "2026-11-18T22:00:00.000Z" },
          { usedPercent: 12, resetsAt: "2026-11-25T00:00:00.000Z" },
        ],
        billedNow,
      ),
    );
  });

  it("returns nothing when an exhausted window has no clock", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [{ usedPercent: 100 }, { usedPercent: 100, resetsAt: "2026-11-18T22:00:00.000Z" }],
        billedNow,
      ),
    );
  });

  it("ignores a clock that already passed", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [{ usedPercent: 100, resetsAt: "2026-11-18T19:00:00.000Z" }],
        billedNow,
      ),
    );
  });

  it("keeps a later exhausted window after another clock already passed", () => {
    assert.equal(
      resetAtFromBilledWindows(
        [
          { usedPercent: 100, resetsAt: "2026-11-18T19:00:00.000Z" },
          { usedPercent: 100, resetsAt: "2026-11-18T22:00:00.000Z" },
        ],
        billedNow,
      ),
      "2026-11-18T22:00:00.000Z",
    );
  });

  it("does not guess from a sibling when an exhausted window has no readable clock", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [
          { usedPercent: 100, resetsAt: "not-a-time" },
          { usedPercent: 100, resetsAt: "2026-11-18T22:00:00.000Z" },
        ],
        billedNow,
      ),
    );
  });

  it("does not guess an open weekly clock", () => {
    assert.isNull(
      resetAtFromBilledWindows(
        [{ usedPercent: 12, resetsAt: "2026-11-25T00:00:00.000Z" }],
        billedNow,
      ),
    );
  });
});
