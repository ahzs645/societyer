/**
 * Tags and tag groups for the books: workspace-defined reporting dimensions
 * such as Program, Grant or Event. Pure helpers shared by the portable
 * handlers, the demo data and the UI.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */

/** Chip tones a group or tag may use (the record table's chip palette). */
export const FINANCE_TAG_COLORS = ["blue", "green", "amber", "purple", "teal", "pink", "violet", "red", "gray"] as const;

export type FinanceTagColor = (typeof FINANCE_TAG_COLORS)[number];

export const FINANCE_TAG_NAME_MAX = 60;

export function isFinanceTagColor(value: unknown): value is FinanceTagColor {
  return typeof value === "string" && (FINANCE_TAG_COLORS as readonly string[]).includes(value);
}

export function normalizeTagName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** The problem with a group or tag name, or null. `siblings` are the other names in the same scope. */
export function tagNameProblem(name: string, siblings: readonly string[], noun: "group" | "tag"): string | null {
  const clean = normalizeTagName(name);
  if (!clean) return `Name the ${noun}.`;
  if (clean.length > FINANCE_TAG_NAME_MAX) return `Keep the ${noun} name under ${FINANCE_TAG_NAME_MAX} characters.`;
  const key = clean.toLocaleLowerCase("en-CA");
  if (siblings.some((other) => normalizeTagName(other).toLocaleLowerCase("en-CA") === key)) {
    return noun === "group" ? `There is already a tag group called ${clean}.` : `This group already has a tag called ${clean}.`;
  }
  return null;
}

export type FinanceTagRef = { _id: string; groupId: string; name: string; color?: string; archivedAtISO?: string };
export type FinanceTagGroupRef = { _id: string; name: string; color?: string; archivedAtISO?: string; sortOrder?: number };

/** Tag id → group id lookup, for the one-tag-per-group rule. */
export function tagGroupLookup(tags: readonly Pick<FinanceTagRef, "_id" | "groupId">[]): (tagId: string) => string | undefined {
  const byId = new Map(tags.map((tag) => [String(tag._id), String(tag.groupId)]));
  return (tagId) => byId.get(String(tagId));
}

/**
 * The problem with tags newly put on a record (a transaction or a bill): an
 * archived tag, or one in an archived group, can't be added until it's
 * restored. Tags the record already carried (`keptTagIds`) stay allowed, so
 * editing an old record never strips its history. Unknown ids are left to the
 * caller's own "no longer exists" check. Null when every new tag is usable.
 */
export function newTagProblem(
  tagIds: Iterable<string>,
  keptTagIds: Iterable<string>,
  tags: readonly Pick<FinanceTagRef, "_id" | "groupId" | "archivedAtISO">[],
  groups: readonly Pick<FinanceTagGroupRef, "_id" | "archivedAtISO">[],
): string | null {
  const kept = new Set([...keptTagIds].map(String));
  const tagById = new Map(tags.map((tag) => [String(tag._id), tag]));
  const archivedGroups = new Set(groups.filter((group) => group.archivedAtISO).map((group) => String(group._id)));
  for (const id of new Set([...tagIds].map(String))) {
    if (kept.has(id)) continue;
    const tag = tagById.get(id);
    if (!tag) continue;
    if (tag.archivedAtISO) return "This tag is archived. Restore it on the Tags page to use it again.";
    if (archivedGroups.has(String(tag.groupId))) return "This tag's group is archived. Restore the group on the Tags page to use its tags again.";
  }
  return null;
}

/** The colour a tag shows in: its own, else its group's, else gray. */
export function tagColor(tag: Pick<FinanceTagRef, "color"> | undefined, group: Pick<FinanceTagGroupRef, "color"> | undefined): FinanceTagColor {
  if (isFinanceTagColor(tag?.color)) return tag.color;
  if (isFinanceTagColor(group?.color)) return group.color;
  return "gray";
}
