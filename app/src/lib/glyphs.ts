/** Parse the symbols/text field into a glyph list (ported from v1 parseGlyphs). */
export function parseGlyphs(str: string): string[] {
  const t = str.trim();
  if (!t) return ['?'];
  let parts = t.includes('\n') ? t.split(/\n/) : t.split(/\s+/);
  parts = parts.map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : ['?'];
}
