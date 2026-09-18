type ParsedRequestLimit =
  | { ok: true; value: number | undefined }
  | { ok: false };

export function parseRequestLimit(
  rawValue: string | null,
  maximum = 100
): ParsedRequestLimit {
  if (rawValue === null) return { ok: true, value: undefined };
  if (!/^[1-9]\d*$/.test(rawValue)) return { ok: false };

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) return { ok: false };
  return { ok: true, value: Math.min(value, maximum) };
}
