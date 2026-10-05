/** Visual Unicode equivalents of legacy Word Symbol/Wingdings private-use glyphs. */
export function normalizeLegacyFontGlyphs(text: string): string {
  return text.replace(/\uf020/g, " ").replace(/\uf0a7/g, "▪")
    .replace(/\uf0b7/g, "•").replace(/\uf0d8/g, "➢");
}
