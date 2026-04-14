const POSIX_ZELLIJ_INSTALL_GUIDE =
  "请先安装 zellij，并确认终端里 `zellij --version` 可以正常执行；macOS 可运行 `brew install zellij`。";

const WINDOWS_BUNDLED_ZELLIJ_GUIDE =
  "Windows 版会直接使用项目内置的 `download/zellij.exe`，打包后会落到应用的 `resources/bin/zellij.exe`；当前未找到该文件，请检查仓库或安装包内容是否完整。";

function getZellijGuide(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? WINDOWS_BUNDLED_ZELLIJ_GUIDE : POSIX_ZELLIJ_INSTALL_GUIDE;
}

export function buildZellijMissingReminder(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return `检测到当前 Windows 环境缺少项目内置的 zellij.exe，无法创建真实的 Zellij session / pane。${getZellijGuide(platform)}`;
  }

  return `检测到当前电脑未安装 zellij，无法创建真实的 Zellij session / pane。${getZellijGuide(platform)}`;
}

export function buildZellijMissingMessage(
  action: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `检测到当前 Windows 环境缺少项目内置的 zellij.exe，${action}。${getZellijGuide(platform)}`;
  }

  return `检测到当前电脑未安装 zellij，${action}。${getZellijGuide(platform)}`;
}
