/**
 * Keep minutes sections 1-to-1 with an edited agenda.
 *
 * Sections are matched to agenda entries by the agenda item id they carry
 * (`section.agendaItemId === entry._id`) first, then by title. Matching by
 * title alone meant renaming "Agenda: Review and" to "Agenda: Review and
 * Approval" created an empty new section and left the old one, with its
 * notes and motions, stranded at the end of the minutes.
 *
 * Sections dropped from the agenda keep their place at the end when they hold
 * recorded content (never silently destroyed). Motions follow their section
 * to its new position and title. Pure module.
 */
export type AgendaAlignEntry = { title: string; depth: 0 | 1; _id?: string };

export type AgendaAlignResult<S, M> = {
  sections: S[];
  motions: M[];
  sectionsChanged: boolean;
  motionsChanged: boolean;
};

const normalize = (title: unknown) => String(title ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function alignSectionsToAgenda<S extends Record<string, any>, M extends Record<string, any>>(
  existingSections: readonly S[],
  entries: readonly AgendaAlignEntry[],
  motions: readonly M[],
  buildSection: (title: string, depth: 0 | 1) => S,
  hasDetails: (section: S) => boolean,
): AgendaAlignResult<S, M> {
  const used = new Set<number>();
  const take = (predicate: (section: S) => boolean) => {
    const index = existingSections.findIndex((section, i) => !used.has(i) && predicate(section));
    if (index >= 0) used.add(index);
    return index;
  };
  const newIndexOfOld = new Map<number, number>();
  const aligned: S[] = entries.map((entry, newIndex) => {
    let oldIndex = entry._id ? take((section) => section.agendaItemId != null && String(section.agendaItemId) === String(entry._id)) : -1;
    if (oldIndex < 0) oldIndex = take((section) => normalize(section.title) === normalize(entry.title));
    if (oldIndex < 0) return buildSection(entry.title, entry.depth);
    newIndexOfOld.set(oldIndex, newIndex);
    const existing = existingSections[oldIndex];
    return existing.title === entry.title && existing.depth === entry.depth
      ? existing
      : { ...existing, title: entry.title, depth: entry.depth };
  });
  const orphans: S[] = [];
  existingSections.forEach((section, oldIndex) => {
    if (used.has(oldIndex) || !hasDetails(section)) return;
    newIndexOfOld.set(oldIndex, aligned.length + orphans.length);
    orphans.push(section);
  });
  const sections = [...aligned, ...orphans];
  const sectionsChanged = sections.length !== existingSections.length || sections.some((section, i) => section !== existingSections[i]);

  let motionsChanged = false;
  const nextMotions = motions.map((motion) => {
    if (motion.sectionIndex == null) return motion;
    const newIndex = newIndexOfOld.get(Number(motion.sectionIndex));
    if (newIndex == null) {
      const { sectionIndex: _sectionIndex, sectionTitle: _sectionTitle, ...rest } = motion;
      motionsChanged = true;
      return rest as unknown as M;
    }
    const title = sections[newIndex]?.title;
    if (newIndex === motion.sectionIndex && (motion.sectionTitle == null || motion.sectionTitle === title)) return motion;
    motionsChanged = true;
    return { ...motion, sectionIndex: newIndex, ...(motion.sectionTitle != null ? { sectionTitle: title } : {}) };
  });
  return { sections, motions: nextMotions, sectionsChanged, motionsChanged };
}
