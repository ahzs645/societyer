/** Excel refuses a cell longer than this; longer text is cut with an ellipsis. */
export const MAX_CELL_TEXT = 32767;

/**
 * XML 1.0 forbids most C0 control characters, U+FFFE/U+FFFF and unpaired
 * surrogates; any of them makes the whole sheet unreadable. Tab, LF and CR
 * are legal and kept.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripIllegalXmlChars(text: string): string {
  return text.replace(ILLEGAL_XML, "");
}

/** Text safe for a cell: legal XML characters only, within Excel's length limit. */
export function cleanCellText(text: string): string {
  const clean = stripIllegalXmlChars(text);
  return clean.length > MAX_CELL_TEXT ? `${clean.slice(0, MAX_CELL_TEXT - 1)}…` : clean;
}

/** Escape for element content and double-quoted attribute values. */
export function escapeXml(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
