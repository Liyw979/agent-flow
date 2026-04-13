import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_DIRECTORY_NAME = "agentflow";

export function resolveCliUserDataPath() {
  const override = process.env.AGENTFLOW_USER_DATA_DIR?.trim();
  if (override) {
    return ensureWritableDirectory(path.resolve(override));
  }

  const home = os.homedir();
  let preferred: string;

  if (process.platform === "darwin") {
    preferred = path.join(home, "Library", "Application Support", APP_DIRECTORY_NAME);
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    preferred = path.join(appData || path.join(home, "AppData", "Roaming"), APP_DIRECTORY_NAME);
  } else {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
    preferred = path.join(xdgConfigHome || path.join(home, ".config"), APP_DIRECTORY_NAME);
  }

  try {
    return ensureWritableDirectory(preferred);
  } catch {
    return ensureWritableDirectory(path.resolve(process.cwd(), ".agentflow"));
  }
}

function ensureWritableDirectory(targetPath: string) {
  fs.mkdirSync(targetPath, { recursive: true });
  fs.accessSync(targetPath, fs.constants.W_OK);
  return targetPath;
}
