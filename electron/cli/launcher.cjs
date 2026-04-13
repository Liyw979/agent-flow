#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const electronBinary = require("electron");
const tsxCli = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const entry = path.resolve(__dirname, "index.ts");

const child = spawn(
  electronBinary,
  [tsxCli, "--tsconfig", "tsconfig.node.json", entry, ...process.argv.slice(2)],
  {
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
