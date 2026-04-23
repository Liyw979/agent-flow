export function pickRecentPartIndexes(partsLength: number, maxActivities: number): number[] {
  if (!Number.isInteger(partsLength) || partsLength <= 0) {
    return [];
  }

  if (!Number.isInteger(maxActivities) || maxActivities <= 0) {
    return [];
  }

  const startIndex = Math.max(0, partsLength - maxActivities);
  const indexes: number[] = [];
  for (let offset = 0; offset < partsLength - startIndex; offset += 1) {
    indexes.push(startIndex + offset);
  }
  return indexes;
}
