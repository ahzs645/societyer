/** Agenda numbering preference ("1a." letters vs "1.1" decimal), shared by the
 *  minutes editor UI and the export renderer so headings match on both. */

export type AgendaNumberingMode = "letters" | "decimal";

export const AGENDA_NUMBERING_PREF_KEY = "societyer.meetingAgendaNumberingMode";

export function readStoredAgendaNumberingMode(): AgendaNumberingMode {
  if (typeof window === "undefined") return "letters";
  return window.localStorage.getItem(AGENDA_NUMBERING_PREF_KEY) === "decimal" ? "decimal" : "letters";
}

export function agendaAlphaLabel(index: number) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

/** Dotted heading label for section lists and exports: roots are "1.", "2.";
 *  children are "1a." in letters mode or "1.1" in decimal mode. `rootCount`
 *  and `childCount` are 1-based (childCount 0 = this row IS the root). */
export function agendaSequenceLabel(rootCount: number, childCount: number, mode: AgendaNumberingMode) {
  if (childCount === 0) return `${rootCount}.`;
  return mode === "decimal"
    ? `${rootCount}.${childCount}`
    : `${rootCount}${agendaAlphaLabel(childCount - 1).toLowerCase()}.`;
}
