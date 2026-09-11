const MOJIBAKE_HINT = /[ÃÂâ]/;

/**
 * Repairs the common case where UTF-8 text was decoded once as Latin-1/Windows-1252
 * and then persisted, e.g. `ItÃ¡lia` -> `Itália`.
 *
 * The function is intentionally conservative: it only attempts a repair when a
 * known mojibake hint is present and every code point fits in a single byte.
 */
export function repairMojibake(value: string | null | undefined) {
  if (!value || !MOJIBAKE_HINT.test(value)) return value ?? "";

  const chars = Array.from(value);
  if (chars.some((char) => char.charCodeAt(0) > 255)) return value;

  try {
    const bytes = Uint8Array.from(chars, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}
