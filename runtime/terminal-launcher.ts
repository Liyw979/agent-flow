import { spawn } from "node:child_process";
import { quoteWindowsShellValue, resolveWindowsCmdPath } from "./windows-shell";

interface TerminalLaunchInput {
  cwd: string;
  command: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

interface TerminalLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildTerminalLaunchSpec(input: TerminalLaunchInput): TerminalLaunchSpec {
  const platform = input.platform ?? process.platform;

  if (platform === "win32") {
    const cmdPath = resolveWindowsCmdPath(input.env);
    return {
      command: cmdPath,
      args: ["/d", "/s", "/c", `start "" ${quoteWindowsShellValue(cmdPath)} /k ${input.command}`],
      cwd: input.cwd,
    };
  }

  if (platform === "darwin") {
    return {
      command: "osascript",
      args: [
        "-e",
        'if application "Terminal" is running then',
        "-e",
        `tell application "Terminal" to do script ${quoteAppleScriptString(input.command)}`,
        "-e",
        "else",
        "-e",
        'tell application "Terminal"',
        "-e",
        "activate",
        "-e",
        "repeat until (count of windows) > 0",
        "-e",
        "delay 0.05",
        "-e",
        "end repeat",
        "-e",
        `set attachTab to do script ${quoteAppleScriptString(input.command)} in window 1`,
        "-e",
        "set selected tab of window 1 to attachTab",
        "-e",
        "end tell",
        "-e",
        "end if",
        "-e",
        'tell application "Terminal" to activate',
      ],
      cwd: input.cwd,
    };
  }

  return {
    command: "x-terminal-emulator",
    args: ["-e", "/bin/sh", "-lc", input.command],
    cwd: input.cwd,
  };
}

export async function launchTerminalCommand(input: TerminalLaunchInput): Promise<void> {
  const spec = buildTerminalLaunchSpec(input);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
