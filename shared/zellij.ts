const ZELLIJ_INSTALL_GUIDE =
  "请先安装 zellij，并确认终端里 `zellij --version` 可以正常执行；macOS 可直接运行 `brew install zellij`。";

export function buildZellijMissingReminder(): string {
  return `检测到当前电脑未安装 zellij，无法创建真实的 Zellij session / pane。${ZELLIJ_INSTALL_GUIDE}`;
}

export function buildZellijMissingMessage(action: string): string {
  return `检测到当前电脑未安装 zellij，${action}。${ZELLIJ_INSTALL_GUIDE}`;
}
