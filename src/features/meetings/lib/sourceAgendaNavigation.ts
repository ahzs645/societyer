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
