const KNIP_TEST_ENTRY_PATTERNS = [
  "**/*.test.ts",
  "**/*.test.tsx",
] as const;

export function createKnipConfig() {
  return {
    entry: [...KNIP_TEST_ENTRY_PATTERNS],
  };
}

export default createKnipConfig();
