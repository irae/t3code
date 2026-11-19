import { assert, it } from "@effect/vitest";

import { parseUsageLimitMessage } from "./parseUsageLimitMessage.ts";

it("extracts reset candidates without a clock or timezone", () => {
  // Claude subscription warning surfaced through Pi.
  assert.deepEqual(
    parseUsageLimitMessage(
      "Claude subscription rate limit reached (five_hour) — resets at 4:00:00 PM",
    ),
    [{ kind: "local", hour: 16, minute: 0, second: 0 }],
  );
  // OpenAI Codex usage-limit error surfaced through Pi.
  assert.deepEqual(
    parseUsageLimitMessage("You have hit your ChatGPT usage limit. Try again in ~33 min."),
    [{ kind: "duration", milliseconds: 33 * 60_000 }],
  );
  // OpenAI Codex weekly status can include a date after the clock.
  assert.deepEqual(parseUsageLimitMessage("Weekly limit resets 17:41 on 1 Jul"), []);
});

it("distinguishes an untimed limit from an unrelated error", () => {
  // Claude API rate-limit error surfaced through Pi.
  assert.deepEqual(parseUsageLimitMessage("Claude API rate limit reached. Try again later."), []);
  assert.isNull(parseUsageLimitMessage("socket timed out"));
});
