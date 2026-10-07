/**
 * Minutes text written by the rich editor, made readable by the line-based
 * minutes renderers (on screen and in every export style).
 *
 * The rich editor (Milkdown) saves CommonMark: it escapes punctuation that
 * would otherwise start markup ("\|", "6\. Next", "\#") and writes a hard line
 * break as a trailing backslash ("revenue.\" + newline). The minutes
 * renderers are deliberately simple and line-based, so without this step a
 * reviewer who opens a section, changes nothing and saves sees stray
 * backslashes in the minutes and in the Word/PDF export.
 *
 * `*` and `` ` `` stay escaped: they are the only inline markup the renderers
 * interpret, and unescaping them would turn literal asterisks into emphasis.
 *
 * Pure module.
 */
const UNESCAPED_PUNCTUATION = /\\([!"#$%&'()+,\-./:;<=>?@[\]^_{|}~\\])/g;

export function minutesTextForDisplay(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    // Hard breaks: "text\" + newline (backslash form) and "text  " + newline.
    .replace(/\\\n/g, "\n")
    .replace(/[ \t]{2,}\n/g, "\n")
    .replace(/\\$/, "")
    .replace(UNESCAPED_PUNCTUATION, "$1");
}
