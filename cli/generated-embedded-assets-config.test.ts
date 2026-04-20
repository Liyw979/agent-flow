import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  scripts?: Record<string, string>;
};

test("build:embedded-assets 会改为调用 cli 目录下的生成脚本", () => {
  assert.equal(
    PACKAGE_JSON.scripts?.["build:embedded-assets"],
    "node cli/generate-embedded-assets.mjs",
  );
});

test("generated-embedded-assets.ts 会在 .gitattributes 里标记为 generated 并关闭默认 diff", () => {
  const gitAttributes = fs.readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");
  assert.match(
    gitAttributes,
    /^cli\/generated-embedded-assets\.ts linguist-generated=true -diff$/m,
  );
});
