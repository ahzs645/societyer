/** Source sections can differ from an older imported agenda's positions. */
export function minuteSectionIndexForAgendaEntry(
  entry: { _id?: string; title: string },
  sections: Array<{ agendaItemId?: string; title?: string }>,
): number | null {
  if (entry._id) {
    const linked = sections.flatMap((section, index) => section.agendaItemId === entry._id ? [index] : []);
    if (linked.length === 1) return linked[0];
    if (linked.length > 1) return null;
  }
  const title = entry.title.trim().replace(/\s+/g, " ").toLowerCase();
  if (!title) return null;
  const matching = sections.flatMap((section, index) =>
    String(section.title ?? "").trim().replace(/\s+/g, " ").toLowerCase() === title ? [index] : []);
  return matching.length === 1 ? matching[0] : null;
}
import { changedSourceMinuteSections } from "../../../../shared/sourceMeetingRecord";

export function unchangedSourceDumpSection(section: any, record: any): boolean {
  if (!Array.isArray(record?.sectionBaseline)) return false;
  if (!/^source (?:notes awaiting agenda mapping|evidence awaiting extraction)$/i.test(String(section?.title ?? "").trim())) return false;
  return changedSourceMinuteSections(record, [section]).length === 0;
}

/**
 * Agenda entries a reader should count as topics: an untouched "Source notes
 * awaiting agenda mapping" dump is hidden on the page, so it must not inflate
 * the "Agenda topics" summary either (MA-6).
 */
export function visibleAgendaEntries<T extends { _id?: string; title: string }>(
  entries: T[],
  sections: any[],
  record: any,
): T[] {
  return entries.filter((entry) => {
    const index = minuteSectionIndexForAgendaEntry(entry, sections);
    return index === null || !unchangedSourceDumpSection(sections[index], record);
  });
}
