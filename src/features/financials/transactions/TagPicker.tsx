import { Check, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Menu, type MenuSection } from "../../../components/Menu";
import { Tag } from "../../../components/Tag";
import { withTagAssigned } from "../../../../shared/transactionLines";
import type { FinanceTagsApi } from "./useFinanceTags";

/** Read-only tag chips (archived tags keep their name, marked as archived). */
export function TagChips({ tagIds, tags, empty }: { tagIds: readonly string[] | undefined; tags: FinanceTagsApi; empty?: string }) {
  const known = (tagIds ?? []).filter((id) => tags.tag(id));
  if (known.length === 0) return empty ? <span className="muted">{empty}</span> : null;
  return (
    <span className="txn-tags">
      {known.map((id) => {
        const tag = tags.tag(id)!;
        const group = tags.group(tag.groupId);
        return <Tag key={id} color={tags.colorOf(id)} text={tag.name} title={`${group?.name ?? "Tag"}${tag.archived ? " (archived)" : ""}`} />;
      })}
    </span>
  );
}

/**
 * Tags on one line: chips with a remove button, and "Tag" to add one. The
 * menu lists each group's tags; picking one replaces any other tag from the
 * same group (one tag per group).
 */
export function TagPicker({
  tagIds,
  tags,
  onChange,
  disabled,
  label = "Tag",
}: {
  tagIds: readonly string[] | undefined;
  tags: FinanceTagsApi;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const current = (tagIds ?? []).filter((id) => tags.tag(id));
  const sections: MenuSection[] = tags.activeGroups
    .filter((group) => group.tags.length > 0)
    .map((group) => ({
      id: group._id,
      label: group.name,
      items: group.tags.map((tag) => ({
        id: tag._id,
        label: tag.name,
        icon: current.includes(tag._id) ? <Check size={12} aria-hidden="true" /> : <span className={`txn-tags__dot txn-tags__dot--${tags.colorOf(tag._id)}`} aria-hidden="true" />,
        onSelect: () => onChange(current.includes(tag._id) ? current.filter((id) => id !== tag._id) : withTagAssigned(current, tag._id, tags.groupOf)),
      })),
    }));
  return (
    <span className="txn-tags">
      {current.map((id) => {
        const tag = tags.tag(id)!;
        return (
          <span key={id} className="txn-tags__chip">
            <Tag color={tags.colorOf(id)} text={tag.name} title={tags.group(tag.groupId)?.name} />
            {!disabled && (
              <button type="button" className="txn-tags__remove" aria-label={`Remove ${tag.name}`} onClick={() => onChange(current.filter((other) => other !== id))}>
                <X size={10} aria-hidden="true" />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (sections.length > 0 ? (
        <Menu
          label={`${label} options`}
          trigger={
            <button type="button" className="btn btn--ghost btn--sm txn-tags__add">
              <Plus size={12} aria-hidden="true" /> {label}
            </button>
          }
          sections={sections}
          minWidth={200}
        />
      ) : (
        tags.loaded && <Link className="txn-tags__setup" to="/app/financials/tags">Set up tags</Link>
      ))}
    </span>
  );
}
