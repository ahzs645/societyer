/**
 * Tidy action items transposed from a source document.
 *
 * The transposition labels each action "Reported action (source review
 * pending): ACTION: …" and, when a source was read twice (a DOCX and its PDF),
 * also keeps line-wrapped fragments ("ACTION: Secretariat to explore
 * opportunities for") next to the full sentence. A reviewer correcting the
 * minutes wants the plain wording and one copy of each action.
 *
 * Pure module.
 */
export type TidyRow = { sectionIndex: number | null; actionIndex: number; text: string };

const LABEL = /^(?:reported action \(source review pending\)|proposed action)\s*:\s*/i;
const ACTION_WORD = /^action(?:\s+item)?\s*:\s*/i;

/** "Reported action (source review pending): ACTION: Mike to revise…" → "Mike to revise…". */
export function plainActionWording(text: unknown): string {
  return String(text ?? "").replace(LABEL, "").replace(ACTION_WORD, "").replace(/\s+/g, " ").trim();
}

const key = (text: string) => plainActionWording(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Rows that repeat another action: the same wording, or a cut-off start of a
 * longer action's wording (at least four words). The longest copy is kept.
 */
export function duplicateActionRows<T extends TidyRow>(rows: readonly T[]): T[] {
  const keyed = rows.map((row) => ({ row, k: key(row.text) })).filter((entry) => entry.k);
  const drop = new Set<T>();
  keyed.forEach((entry, i) => {
    if (drop.has(entry.row)) return;
    const words = entry.k.split(" ").length;
    const longer = keyed.find((other, j) => j !== i && !drop.has(other.row) && (
      (other.k === entry.k && j < i)
      || (words >= 4 && other.k.length > entry.k.length && other.k.startsWith(`${entry.k} `))
    ));
    if (longer) drop.add(entry.row);
  });
  return rows.filter((row) => drop.has(row));
}

/** "Mike to revise the draft…" → "Mike"; "Secretariat and Operations Committee to clarify…" → that pair. */
export function suggestedActionOwner(text: unknown): string | undefined {
  const match = /^([A-Z][A-Za-z&.'’ -]{1,60}?)\s+to\s+\S/.exec(plainActionWording(text));
  if (!match) return undefined;
  const owner = match[1].trim();
  return owner.split(/\s+/).length <= 6 ? owner : undefined;
}
