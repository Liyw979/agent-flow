import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REMOVED_TERMINAL_HOST = String.fromCharCode(122, 101, 108, 108, 105, 106);
const REMOVED_UI_HOOK = ["on", "Open", "Task", "Session"].join("");
const REMOVED_TERMINAL_PREFIX = ["agent", "flow"].join("");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("浠撳簱浜х墿涓庢簮鐮佸叆鍙ｄ笉鍐嶅寘鍚凡搴熷純缁堢瀹夸富娈嬬暀", () => {
  const packageJson = readRepoFile("package.json");
  const sharedTypes = readRepoFile("shared/types.ts");
  const terminalCommands = readRepoFile("shared/terminal-commands.ts");
  const chatWindow = readRepoFile("src/components/ChatWindow.tsx");

  assert.doesNotMatch(packageJson, new RegExp(`download/${REMOVED_TERMINAL_HOST}\\.exe`));
  assert.doesNotMatch(sharedTypes, new RegExp(`${REMOVED_TERMINAL_HOST}SessionId`));
  assert.doesNotMatch(sharedTypes, /TaskPanelRecord/);
  assert.doesNotMatch(sharedTypes, /\bpanels:\s*TaskPanelRecord\[\]/);
  assert.doesNotMatch(terminalCommands, /buildCliPanelFocusCommand/);
  assert.doesNotMatch(terminalCommands, /buildCliAttachSessionCommand/);
  assert.doesNotMatch(terminalCommands, /buildOpencodePaneCommand/);
  assert.doesNotMatch(terminalCommands, new RegExp(`${REMOVED_TERMINAL_PREFIX}-${REMOVED_TERMINAL_HOST}`));
  assert.doesNotMatch(chatWindow, new RegExp(REMOVED_UI_HOOK));
  assert.doesNotMatch(chatWindow, /鎵撳紑鏃х粓绔涓?/);
});
