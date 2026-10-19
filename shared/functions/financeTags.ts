/**
 * PORTABLE FUNCTIONS: tags and tag groups for the books
 * (workspace / upsertGroup / upsertTag / setGroupArchived / setTagArchived).
 *
 * Groups (`financeTagGroups`) and their tags (`financeTags`) are reporting
 * dimensions a workspace defines (Program, Grant, Event…). Transaction lines
 * carry at most one tag per group and the tags travel onto posted journal
 * lines. Archiving hides a group or tag from pickers and keeps every line
 * already tagged with it.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireRolePortable, requireSocietyMembership } from "./access";
import { isFinanceTagColor, newTagProblem, normalizeTagName, tagGroupLookup, tagNameProblem } from "../financeTags";
import { transactionTagIds } from "../transactionLines";

type GroupRow = PortableDoc & { societyId: string; name: string; color?: string; sortOrder: number; archivedAtISO?: string };
type TagRow = PortableDoc & { societyId: string; groupId: string; name: string; color?: string; sortOrder: number; archivedAtISO?: string };

async function loadGroups(ctx: PortableQueryCtx, societyId: string) {
  return ctx.db.query<GroupRow>("financeTagGroups").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

async function loadTags(ctx: PortableQueryCtx, societyId: string) {
  return ctx.db.query<TagRow>("financeTags").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

/**
 * This organization's tag rules for a save: tag → group (one tag per group;
 * another organization's tags are unknown) and the problem with tags newly
 * added to a record (archived, or in an archived group), given the tags it
 * already had.
 */
export async function tagRulesFor(ctx: PortableQueryCtx, societyId: string) {
  const [groups, tags] = await Promise.all([loadGroups(ctx, societyId), loadTags(ctx, societyId)]);
  const refs = tags.map((tag) => ({ _id: String(tag._id), groupId: String(tag.groupId), archivedAtISO: tag.archivedAtISO }));
  const groupRefs = groups.map((group) => ({ _id: String(group._id), archivedAtISO: group.archivedAtISO }));
  return {
    groupOf: tagGroupLookup(refs),
    newTagProblem: (tagIds: Iterable<string>, keptTagIds: Iterable<string>) => newTagProblem(tagIds, keptTagIds, refs, groupRefs),
  };
}

const bySortOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Every group with its tags (archived ones flagged, not dropped, so tagged
 * lines can still name them) and how many transactions carry each tag.
 */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [groups, tags, transactions] = await Promise.all([
    loadGroups(ctx, societyId),
    loadTags(ctx, societyId),
    ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const usage = new Map<string, number>();
  for (const row of transactions) {
    for (const tagId of transactionTagIds({
      amountCents: Number(row.amountCents) || 0,
      tagIds: Array.isArray(row.tagIds) ? row.tagIds.map(String) : undefined,
      lines: Array.isArray(row.lines) ? row.lines : undefined,
    })) usage.set(tagId, (usage.get(tagId) ?? 0) + 1);
  }
  return {
    groups: [...groups].sort(bySortOrder).map((group) => ({
      _id: String(group._id),
      name: group.name,
      color: group.color,
      sortOrder: group.sortOrder,
      archived: Boolean(group.archivedAtISO),
      tags: tags
        .filter((tag) => String(tag.groupId) === String(group._id))
        .sort(bySortOrder)
        .map((tag) => ({
          _id: String(tag._id),
          groupId: String(tag.groupId),
          name: tag.name,
          color: tag.color,
          sortOrder: tag.sortOrder,
          archived: Boolean(tag.archivedAtISO),
          transactionCount: usage.get(String(tag._id)) ?? 0,
        })),
    })),
  };
}

function cleanColor(color: string | null | undefined): string | undefined {
  if (color === null || color === undefined || color === "") return undefined;
  if (!isFinanceTagColor(color)) throw new Error("Choose one of the listed colours.");
  return color;
}

export async function upsertGroupPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; name: string; color?: string | null; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  const groups = await loadGroups(ctx, args.societyId);
  const name = normalizeTagName(args.name);
  const siblings = groups.filter((group) => String(group._id) !== String(args.id ?? "") && !group.archivedAtISO).map((group) => group.name);
  const problem = tagNameProblem(name, siblings, "group");
  if (problem) throw new Error(problem);
  const color = cleanColor(args.color);
  const now = new Date().toISOString();
  if (args.id) {
    await getOwned(ctx, "financeTagGroups", args.id, args.societyId);
    await ctx.db.patch(args.id, { name, color, updatedAtISO: now });
    return args.id;
  }
  const sortOrder = groups.reduce((max, group) => Math.max(max, group.sortOrder), 0) + 1;
  return ctx.db.insert("financeTagGroups", { societyId: args.societyId, name, color, sortOrder, createdAtISO: now, updatedAtISO: now });
}

export async function upsertTagPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; groupId: string; name: string; color?: string | null; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  const group = await getOwned<GroupRow>(ctx, "financeTagGroups", args.groupId, args.societyId);
  const siblingsInGroup = (await loadTags(ctx, args.societyId)).filter((tag) => String(tag.groupId) === String(group._id));
  const name = normalizeTagName(args.name);
  const problem = tagNameProblem(
    name,
    siblingsInGroup.filter((tag) => String(tag._id) !== String(args.id ?? "") && !tag.archivedAtISO).map((tag) => tag.name),
    "tag",
  );
  if (problem) throw new Error(problem);
  const color = cleanColor(args.color);
  const now = new Date().toISOString();
  if (args.id) {
    const existing = await getOwned<TagRow>(ctx, "financeTags", args.id, args.societyId);
    if (String(existing.groupId) !== String(group._id)) throw new Error("A tag stays in its group. Create the tag in the other group instead.");
    await ctx.db.patch(args.id, { name, color, updatedAtISO: now });
    return args.id;
  }
  if (group.archivedAtISO) throw new Error("Restore the group before adding tags to it.");
  const sortOrder = siblingsInGroup.reduce((max, tag) => Math.max(max, tag.sortOrder), 0) + 1;
  return ctx.db.insert("financeTags", { societyId: args.societyId, groupId: group._id, name, color, sortOrder, createdAtISO: now, updatedAtISO: now });
}

export async function setGroupArchivedPortable(
  ctx: PortableMutationCtx,
  { id, archived, actingUserId }: { id: string; archived: boolean; actingUserId?: string },
) {
  const group = await ctx.db.get<GroupRow>(id, "financeTagGroups");
  if (!group) throw new Error("Tag group not found.");
  await requireSocietyMembership(ctx, String(group.societyId));
  await requireRolePortable(ctx, { actingUserId, societyId: String(group.societyId), required: "Director" });
  await getOwned(ctx, "financeTagGroups", id, String(group.societyId));
  if (!archived) {
    const others = (await loadGroups(ctx, String(group.societyId))).filter((row) => String(row._id) !== id && !row.archivedAtISO).map((row) => row.name);
    const problem = tagNameProblem(group.name, others, "group");
    if (problem) throw new Error(`${problem} Rename one of them first.`);
  }
  const now = new Date().toISOString();
  await ctx.db.patch(id, { archivedAtISO: archived ? now : undefined, updatedAtISO: now });
  return id;
}

export async function setTagArchivedPortable(
  ctx: PortableMutationCtx,
  { id, archived, actingUserId }: { id: string; archived: boolean; actingUserId?: string },
) {
  const tag = await ctx.db.get<TagRow>(id, "financeTags");
  if (!tag) throw new Error("Tag not found.");
  await requireSocietyMembership(ctx, String(tag.societyId));
  await requireRolePortable(ctx, { actingUserId, societyId: String(tag.societyId), required: "Director" });
  await getOwned(ctx, "financeTags", id, String(tag.societyId));
  if (!archived) {
    const others = (await loadTags(ctx, String(tag.societyId)))
      .filter((row) => String(row.groupId) === String(tag.groupId) && String(row._id) !== id && !row.archivedAtISO)
      .map((row) => row.name);
    const problem = tagNameProblem(tag.name, others, "tag");
    if (problem) throw new Error(`${problem} Rename one of them first.`);
  }
  const now = new Date().toISOString();
  await ctx.db.patch(id, { archivedAtISO: archived ? now : undefined, updatedAtISO: now });
  return id;
}
