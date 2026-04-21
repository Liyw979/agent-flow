export function getPanelFullscreenButtonCopy(isFullscreen: boolean) {
  if (isFullscreen) {
    return {
      label: "退出全屏",
      ariaLabel: "退出全屏",
    };
  }

  return {
    label: "全屏",
    ariaLabel: "进入全屏",
  };
}
