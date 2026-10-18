import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { tagColor, type FinanceTagColor } from "../../../../shared/financeTags";

export type FinanceTagRow = {
  _id: string;
  groupId: string;
  name: string;
  color?: string;
  sortOrder: number;
  archived: boolean;
  transactionCount: number;
};

export type FinanceTagGroupRow = {
  _id: string;
  name: string;
  color?: string;
  sortOrder: number;
  archived: boolean;
  tags: FinanceTagRow[];
};

export type FinanceTagsWorkspace = { groups: FinanceTagGroupRow[] };

export type FinanceTagOption = { value: string; label: string; hint: string; color: FinanceTagColor };

export type FinanceTagsApi = {
  loaded: boolean;
  groups: FinanceTagGroupRow[];
  /** Groups and tags that can be picked (not archived), in order. */
  activeGroups: FinanceTagGroupRow[];
  tag: (tagId: string) => FinanceTagRow | undefined;
  group: (groupId: string) => FinanceTagGroupRow | undefined;
  groupOf: (tagId: string) => string | undefined;
  tagName: (tagId: string) => string | undefined;
  colorOf: (tagId: string) => FinanceTagColor;
  /** Every active tag as a Select option, its group as the hint. */
  options: FinanceTagOption[];
};

const EMPTY: FinanceTagGroupRow[] = [];

/** The workspace's tag groups and tags (`financeTags:workspace`) with lookups. */
export function useFinanceTags(societyId: string | undefined): FinanceTagsApi {
  const workspace = useQuery(api.financeTags.workspace, societyId ? { societyId } : "skip") as FinanceTagsWorkspace | undefined;
  return useMemo(() => {
    const groups = workspace?.groups ?? EMPTY;
    const tags = new Map<string, FinanceTagRow>();
    const groupsById = new Map<string, FinanceTagGroupRow>();
    for (const group of groups) {
      groupsById.set(group._id, group);
      for (const tag of group.tags) tags.set(tag._id, tag);
    }
    const activeGroups = groups
      .filter((group) => !group.archived)
      .map((group) => ({ ...group, tags: group.tags.filter((tag) => !tag.archived) }));
    const colorOf = (tagId: string) => {
      const tag = tags.get(tagId);
      return tagColor(tag, tag ? groupsById.get(tag.groupId) : undefined);
    };
    return {
      loaded: workspace !== undefined,
      groups,
      activeGroups,
      tag: (tagId) => tags.get(tagId),
      group: (groupId) => groupsById.get(groupId),
      groupOf: (tagId) => tags.get(tagId)?.groupId,
      tagName: (tagId) => tags.get(tagId)?.name,
      colorOf,
      options: activeGroups.flatMap((group) => group.tags.map((tag) => ({ value: tag._id, label: tag.name, hint: group.name, color: colorOf(tag._id) }))),
    };
  }, [workspace]);
}
