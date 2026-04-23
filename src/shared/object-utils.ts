export function withOptionalString<
  T extends Record<string, unknown>,
  K extends string,
>(target: T, key: K, value: string | null | undefined): T & Partial<Record<K, string>> {
  if (typeof value !== "string") {
    return target as T & Partial<Record<K, string>>;
  }
  return {
    ...target,
    [key]: value,
  } as T & Partial<Record<K, string>>;
}

export function withOptionalValue<
  T extends Record<string, unknown>,
  K extends string,
  V,
>(target: T, key: K, value: V | undefined): T & Partial<Record<K, V>> {
  if (value === undefined) {
    return target as T & Partial<Record<K, V>>;
  }
  return {
    ...target,
    [key]: value,
  } as T & Partial<Record<K, V>>;
}
