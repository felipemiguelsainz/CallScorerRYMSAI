export function sanitizeString(input: string): string {
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeObjectStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeObjectStrings(v)) as T;
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      next[k] = sanitizeObjectStrings(v);
    }
    return next as T;
  }
  return value;
}
