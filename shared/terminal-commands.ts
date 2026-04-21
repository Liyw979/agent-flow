interface BuildCliOpencodeAttachCommandOptions {
  platform?: NodeJS.Platform;
}

function quotePortableShellArg(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCliOpencodeAttachCommand(
  attachBaseUrl: string,
  sessionId: string,
  options?: BuildCliOpencodeAttachCommandOptions,
): string {
  const platform = options?.platform ?? process.platform;
  return [
    "opencode",
    "attach",
    quotePortableShellArg(attachBaseUrl, platform),
    "--session",
    quotePortableShellArg(sessionId, platform),
  ].join(" ");
}
