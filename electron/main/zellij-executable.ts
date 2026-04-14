import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const REPO_ZELLIJ_PATH = path.join(PROJECT_ROOT, "download", "zellij.exe");

function isAsarPath(targetPath: string): boolean {
  return targetPath.includes(".asar/") || targetPath.includes(".asar\\");
}

export interface ResolvedZellijExecutable {
  command: string;
  available: boolean;
  bundled: boolean;
  candidates: string[];
}

interface ResolveZellijExecutableOptions {
  platform?: NodeJS.Platform;
  resourcesPath?: string | undefined;
  existsSync?: typeof fs.existsSync;
}

export function resolveZellijExecutable(
  options: ResolveZellijExecutableOptions = {},
): ResolvedZellijExecutable {
  const platform = options.platform ?? process.platform;
  const existsSync = options.existsSync ?? fs.existsSync;

  if (platform !== "win32") {
    return {
      command: "zellij",
      available: true,
      bundled: false,
      candidates: ["zellij"],
    };
  }

  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const candidates = Array.from(
    new Set(
      [
        resourcesPath ? path.join(resourcesPath, "bin", "zellij.exe") : null,
        isAsarPath(REPO_ZELLIJ_PATH) ? null : REPO_ZELLIJ_PATH,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const command =
    candidates.find((candidate) => existsSync(candidate))
    ?? candidates[0]
    ?? REPO_ZELLIJ_PATH;

  return {
    command,
    available: existsSync(command),
    bundled: true,
    candidates,
  };
}

export function getRepoBundledZellijPath(): string {
  return REPO_ZELLIJ_PATH;
}
