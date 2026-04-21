import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as {
  scripts?: Record<string, string>;
};

const AGENTS_MD = fs.readFileSync(new URL("./AGENTS.md", import.meta.url), "utf8");

test("package.json 提供 macOS 打包入口", () => {
  assert.equal(
    PACKAGE_JSON.scripts?.["dist:mac-arm64"],
    "bun run build && bun build --compile --target bun-darwin-arm64 ./cli/index.ts --outfile ./dist/agent-team-macos-arm64",
  );
  assert.equal(
    PACKAGE_JSON.scripts?.["dist:mac-x64"],
    "bun run build && bun build --compile --target bun-darwin-x64 ./cli/index.ts --outfile ./dist/agent-team-macos-x64",
  );
});

test("AGENTS.md 同步记录 macOS 打包产物", () => {
  assert.match(AGENTS_MD, /bun run dist:mac-arm64/);
  assert.match(AGENTS_MD, /bun run dist:mac-x64/);
  assert.match(AGENTS_MD, /dist\/agent-team-macos-arm64/);
  assert.match(AGENTS_MD, /dist\/agent-team-macos-x64/);
});
