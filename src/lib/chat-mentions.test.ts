import assert from "node:assert/strict";
import test from "node:test";

import { getMentionContext, getMentionOptions } from "./chat-mentions";

test("getMentionOptions preserves the configured agent order", () => {
  const options = getMentionOptions(["Build", "Security", "CodeReview"], "");

  assert.deepEqual(options, ["Build", "Security", "CodeReview"]);
});

test("getMentionOptions filters without reordering the original list", () => {
  const options = getMentionOptions(["Build", "Security", "CodeReview"], "view");

  assert.deepEqual(options, ["CodeReview"]);
});

test("getMentionContext only returns a context while editing an @mention", () => {
  assert.equal(getMentionContext("", 0), null);
  assert.equal(getMentionContext("@BA implement add", "@BA implement add".length), null);
  assert.deepEqual(getMentionContext("@BA", 3), {
    start: 0,
    end: 3,
    query: "BA",
  });
  assert.deepEqual(getMentionContext("ask @CodeReview", "ask @CodeReview".length), {
    start: 4,
    end: "ask @CodeReview".length,
    query: "CodeReview",
  });
});
