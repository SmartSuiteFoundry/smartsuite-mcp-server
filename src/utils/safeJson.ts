export function safeJsonStringify(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent) ?? 'null';
  } catch {
    return '"[unserializable]"';
  }
}

export function jsonResult(value: unknown): string {
  return safeJsonStringify(value);
}
