import { useEffect, useId, useState } from "react";
import { useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, MoreHorizontal, Palette, Pencil, Plus, Tags } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../../../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "../../../pages/_helpers";
import { EmptyState, Field } from "../../../components/ui";
import { Menu } from "../../../components/Menu";
import { Modal } from "../../../components/Modal";
import { Select } from "../../../components/Select";
import { Tag } from "../../../components/Tag";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import { FINANCE_TAG_COLORS, FINANCE_TAG_NAME_MAX, tagColor, tagNameProblem } from "../../../../shared/financeTags";
import { useFinanceTags, type FinanceTagGroupRow, type FinanceTagRow } from "../transactions/useFinanceTags";

type Editing =
  | { kind: "group"; group?: FinanceTagGroupRow }
  | { kind: "tag"; group: FinanceTagGroupRow; tag?: FinanceTagRow };

const COLOR_LABELS: Record<(typeof FINANCE_TAG_COLORS)[number], string> = {
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  purple: "Purple",
  teal: "Teal",
  pink: "Pink",
  violet: "Violet",
  red: "Red",
  gray: "Gray",
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);

/**
 * Finance → Tags: the workspace's reporting dimensions. Groups (Program,
 * Grant, Event…) hold tags; a transaction line carries at most one tag per
 * group, and posted journal lines keep them for reports. Archiving hides a
 * group or tag from pickers without untagging anything.
 */
export function TransactionTagsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const tags = useFinanceTags(society?._id);
  const setGroupArchived = useMutation(api.financeTags.setGroupArchived);
  const setTagArchived = useMutation(api.financeTags.setTagArchived);
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const active = tags.groups.filter((group) => !group.archived);
  const archived = tags.groups.filter((group) => group.archived);

  const archiveGroup = async (group: FinanceTagGroupRow, archive: boolean) => {
    try {
      await setGroupArchived({ id: group._id, archived: archive });
      toast.success(archive ? `Archived ${group.name}` : `Restored ${group.name}`, archive ? "Tagged lines keep their tags; the group leaves the pickers." : undefined);
    } catch (error) {
      toast.error(archive ? "Could not archive the group" : "Could not restore the group", errorMessage(error));
    }
  };
  const archiveTag = async (tag: FinanceTagRow, archive: boolean) => {
    try {
      await setTagArchived({ id: tag._id, archived: archive });
      toast.success(archive ? `Archived ${tag.name}` : `Restored ${tag.name}`, archive && tag.transactionCount ? `${pluralize(tag.transactionCount, "transaction")} keep the tag.` : undefined);
    } catch (error) {
      toast.error(archive ? "Could not archive the tag" : "Could not restore the tag", errorMessage(error));
    }
  };

  return (
    <div className="page books-tags-page">
      <PageHeader
        title="Tags"
        icon={<Tags size={16} />}
        iconColor="green"
        subtitle="Programs, grants and events to tag transaction lines with."
        info={
          <>
            <p>
              Each group is one way to slice the books, such as Program or Grant. A transaction line can carry one tag
              from each group, so a split payment can charge part to Youth mentoring and part to Arts nights.
            </p>
            <p>Tags travel onto the journal lines a transaction posts, so reports can be filtered by them.</p>
          </>
        }
        actions={
          <button className="btn-action btn-action--primary" type="button" disabled={!canWrite} onClick={() => setEditing({ kind: "group" })}>
            <Plus size={12} aria-hidden="true" /> New group
          </button>
        }
      />

      {!tags.loaded ? (
        <div className="card"><div className="card__body"><div className="record-table__loading">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div></div>
      ) : active.length === 0 && archived.length === 0 ? (
        <div className="card">
          <div className="card__body">
            <EmptyState
              icon={<Tags size={20} />}
              title="Slice the books by program, grant or event"
              description="Create a group such as Program, add its tags, then tag transaction lines from the Transactions tab."
              action={
                <button className="btn btn--accent" type="button" disabled={!canWrite} onClick={() => setEditing({ kind: "group" })}>
                  <Plus size={12} aria-hidden="true" /> Create a group
                </button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="books-tags">
          {active.map((group) => (
            <TagGroupCard
              key={group._id}
              group={group}
              canWrite={canWrite}
              onEditGroup={() => setEditing({ kind: "group", group })}
              onArchiveGroup={() => void archiveGroup(group, true)}
              onAddTag={() => setEditing({ kind: "tag", group })}
              onEditTag={(tag) => setEditing({ kind: "tag", group, tag })}
              onArchiveTag={(tag, archive) => void archiveTag(tag, archive)}
            />
          ))}
          {archived.length > 0 && (
            <div className="books-tags__archived">
              <button type="button" className="btn btn--ghost btn--sm" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}>
                <Archive size={12} aria-hidden="true" /> {showArchived ? "Hide" : "Show"} {pluralize(archived.length, "archived group")}
              </button>
              {showArchived && archived.map((group) => (
                <div key={group._id} className="books-tags__archived-row">
                  <Tag color={tagColor(undefined, group)} text={group.name} variant="border" />
                  <span className="muted">{pluralize(group.tags.length, "tag")}</span>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => void archiveGroup(group, false)}>
                    <ArchiveRestore size={12} aria-hidden="true" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <TagEditor editing={editing} societyId={society._id} siblings={siblingNames(editing, tags.groups)} onClose={() => setEditing(null)} />
    </div>
  );
}

/** Names the edited group or tag must not repeat (archived ones may be reused). */
function siblingNames(editing: Editing | null, groups: readonly FinanceTagGroupRow[]): string[] {
  if (!editing) return [];
  if (editing.kind === "group") return groups.filter((group) => !group.archived && group._id !== editing.group?._id).map((group) => group.name);
  return editing.group.tags.filter((tag) => !tag.archived && tag._id !== editing.tag?._id).map((tag) => tag.name);
}

function TagGroupCard({
  group,
  canWrite,
  onEditGroup,
  onArchiveGroup,
  onAddTag,
  onEditTag,
  onArchiveTag,
}: {
  group: FinanceTagGroupRow;
  canWrite: boolean;
  onEditGroup: () => void;
  onArchiveGroup: () => void;
  onAddTag: () => void;
  onEditTag: (tag: FinanceTagRow) => void;
  onArchiveTag: (tag: FinanceTagRow, archive: boolean) => void;
}) {
  const live = group.tags.filter((tag) => !tag.archived);
  const archivedTags = group.tags.filter((tag) => tag.archived);
  return (
    <section className="card books-tags__group" aria-labelledby={`tag-group-${group._id}`}>
      <div className="card__head">
        <span className={`txn-tags__dot txn-tags__dot--${tagColor(undefined, group)}`} aria-hidden="true" />
        <h2 className="card__title" id={`tag-group-${group._id}`}>{group.name}</h2>
        <span className="card__subtitle">{pluralize(live.length, "tag")}</span>
        <div className="books-tags__head-actions">
          <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={onAddTag}>
            <Plus size={12} aria-hidden="true" /> Add tag
          </button>
          <Menu
            align="right"
            label={`${group.name} group actions`}
            trigger={
              <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${group.name}`} disabled={!canWrite}>
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
            }
            sections={[
              {
                id: "group",
                items: [
                  { id: "rename", label: "Rename or recolour", icon: <Pencil size={14} />, onSelect: onEditGroup },
                  { id: "archive", label: "Archive group", icon: <Archive size={14} />, destructive: true, onSelect: onArchiveGroup },
                ],
              },
            ]}
          />
        </div>
      </div>
      {live.length === 0 && archivedTags.length === 0 ? (
        <p className="card__body muted">No tags in this group yet.</p>
      ) : (
        <ul className="books-tags__list">
          {[...live, ...archivedTags].map((tag) => (
            <li key={tag._id} className={`books-tags__tag${tag.archived ? " is-archived" : ""}`}>
              <Tag color={tagColor(tag, group)} text={tag.name} variant={tag.archived ? "border" : "solid"} />
              {tag.archived && <span className="muted">Archived</span>}
              <Link className="books-tags__count" to={`/app/financials?tab=transactions&tag=${encodeURIComponent(tag._id)}`}>
                {pluralize(tag.transactionCount, "transaction")}
              </Link>
              {canWrite && (
                <span className="books-tags__tag-actions">
                  {!tag.archived && (
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Rename or recolour ${tag.name}`} title="Rename or recolour" onClick={() => onEditTag(tag)}>
                      <Palette size={12} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={tag.archived ? `Restore ${tag.name}` : `Archive ${tag.name}`}
                    title={tag.archived ? "Restore" : "Archive"}
                    onClick={() => onArchiveTag(tag, !tag.archived)}
                  >
                    {tag.archived ? <ArchiveRestore size={12} aria-hidden="true" /> : <Archive size={12} aria-hidden="true" />}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TagEditor({ editing, societyId, siblings, onClose }: { editing: Editing | null; societyId: string; siblings: string[]; onClose: () => void }) {
  const upsertGroup = useMutation(api.financeTags.upsertGroup);
  const upsertTag = useMutation(api.financeTags.upsertTag);
  const toast = useToast();
  const formId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setName(editing.kind === "group" ? editing.group?.name ?? "" : editing.tag?.name ?? "");
    setColor(editing.kind === "group" ? editing.group?.color ?? "" : editing.tag?.color ?? "");
    setTouched(false);
  }, [editing]);

  const noun = editing?.kind === "tag" ? "tag" : "group";
  const problem = tagNameProblem(name, siblings, noun);
  const isNew = editing?.kind === "group" ? !editing.group : !editing?.tag;
  const title = !editing
    ? ""
    : editing.kind === "group"
      ? (editing.group ? `Edit ${editing.group.name}` : "New tag group")
      : (editing.tag ? `Edit ${editing.tag.name}` : `New ${editing.group.name} tag`);

  const submit = async () => {
    setTouched(true);
    if (!editing || problem || busy) return;
    setBusy(true);
    try {
      if (editing.kind === "group") {
        await upsertGroup({ societyId, ...(editing.group ? { id: editing.group._id } : {}), name, color: color || null });
      } else {
        await upsertTag({ societyId, groupId: editing.group._id, ...(editing.tag ? { id: editing.tag._id } : {}), name, color: color || null });
      }
      toast.success(isNew ? `Created ${name.trim()}` : `Saved ${name.trim()}`);
      onClose();
    } catch (error) {
      toast.error(`Could not save the ${noun}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(editing)}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="btn btn--accent" disabled={busy}>{isNew ? `Create ${noun}` : "Save"}</button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Name" required error={touched && problem ? problem : undefined}>
          <input
            className="input"
            value={name}
            maxLength={FINANCE_TAG_NAME_MAX}
            autoFocus
            placeholder={noun === "group" ? "e.g. Program" : "e.g. Youth mentoring"}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Colour" hint={noun === "tag" ? "Leave it to use the group's colour." : undefined}>
          <Select
            value={color}
            onChange={setColor}
            clearable
            clearLabel={noun === "tag" ? "Group colour" : "Gray"}
            placeholder={noun === "tag" ? "Group colour" : "Gray"}
            options={FINANCE_TAG_COLORS.map((value) => ({ value, label: COLOR_LABELS[value], color: value }))}
          />
        </Field>
      </form>
    </Modal>
  );
}
