/**
 * Minutes action items (A12, B6, ui-meetings F16/F19): every action recorded in
 * the minutes — top-level and per agenda section — with its status from the
 * shared vocabulary (open, in progress, ongoing, on hold, completed,
 * cancelled, not stated), the assignee linked to the people directory, the due
 * date, and "Create task" to track it on the task board.
 *
 * It is also where actions are added, reworded and removed: correcting
 * imported minutes means typing the actions the source assigns ("Terry to
 * revise accounts list") under the agenda item they belong to.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/Modal";
import { ACTION_ITEM_STATUSES, ACTION_ITEM_STATUS_LABELS, actionItemStatus, type ActionItemStatus } from "../../../../shared/actionItemStatus";
import { taskDraftFromActionItem } from "../../../../shared/meetingActionTasks";
import { PersonNameLinkField, type DirectoryPerson } from "../../../components/PersonNameLinkField";
import { matchDirectoryPerson } from "../../../../shared/meetingAttendanceGrid";

const STATUS_OPTIONS = ACTION_ITEM_STATUSES.map((value) => ({ value, label: ACTION_ITEM_STATUS_LABELS[value] }));

type Row = { item: any; sectionIndex: number | null; actionIndex: number; sectionTitle?: string };
type ActionDraft = { text: string; section: string; assignee: string; assigneePersonId?: string; dueDate: string; status: ActionItemStatus };

const GENERAL = "general";
const emptyDraft = (section = GENERAL): ActionDraft => ({ text: "", section, assignee: "", dueDate: "", status: "open" });

export function MeetingActionItemsCard({
  sections: sectionsProp,
  topLevelItems: topLevelProp,
  people,
  meetingTasks,
  canEdit,
  canCreateTasks,
  meetingTitle,
  saveSections: saveSectionsProp,
  saveTopLevel: saveTopLevelProp,
  createTask,
}: {
  sections: any[];
  topLevelItems: any[];
  people?: DirectoryPerson[];
  meetingTasks: any[];
  canEdit: boolean;
  canCreateTasks: boolean;
  meetingTitle?: string;
  saveSections: (next: any[]) => void | Promise<void>;
  saveTopLevel?: (items: any[]) => void | Promise<void>;
  createTask?: (draft: ReturnType<typeof taskDraftFromActionItem>) => Promise<string | undefined>;
}) {
  // Each change rewrites the whole list, so it must start from the latest
  // saved list, not from props that the live query has not refreshed yet —
  // otherwise quick successive edits (owners, statuses) overwrite each other.
  const [pending, setPending] = useState<{ base: { sections: any[]; top: any[] }; sections?: any[]; top?: any[] } | null>(null);
  const propsChanged = !!pending && (pending.base.sections !== sectionsProp || pending.base.top !== topLevelProp);
  if (propsChanged) setPending(null);
  const live = pending && !propsChanged ? pending : null;
  const sections: any[] = live?.sections ?? sectionsProp;
  const topLevelItems: any[] = live?.top ?? topLevelProp;
  const saveSections = async (next: any[]) => {
    setPending((current) => ({ base: current?.base ?? { sections: sectionsProp, top: topLevelProp }, top: current?.top, sections: next }));
    await saveSectionsProp(next);
  };
  const saveTopLevel = saveTopLevelProp ? async (items: any[]) => {
    setPending((current) => ({ base: current?.base ?? { sections: sectionsProp, top: topLevelProp }, sections: current?.sections, top: items }));
    await saveTopLevelProp(items);
  } : undefined;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // The owner is edited as a draft and saved once (Enter / Save), not on
  // every keystroke — each save also re-syncs the agenda.
  const [ownerDraft, setOwnerDraft] = useState<{ name: string; personId?: string }>({ name: "" });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [adding, setAdding] = useState<ActionDraft | null>(null);
  const [rewording, setRewording] = useState<{ key: string; text: string; dueDate: string } | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const confirm = useConfirm();
  const rows: Row[] = [
    ...topLevelItems.map((item, actionIndex) => ({ item, sectionIndex: null, actionIndex })),
    ...sections.flatMap((section: any, sectionIndex: number) =>
      (section?.actionItems ?? []).map((item: any, actionIndex: number) => ({ item, sectionIndex, actionIndex, sectionTitle: section.title || `Agenda item ${sectionIndex + 1}` })),
    ),
  ].filter((row) => String(row.item?.text ?? "").trim());
  if (!rows.length && !canEdit) return null;
  const sectionOptions = [
    ...(saveTopLevel ? [{ value: GENERAL, label: "General (not under an agenda item)" }] : []),
    ...sections.map((section: any, index: number) => ({ value: String(index), label: `${index + 1}. ${section?.title || `Agenda item ${index + 1}`}` })),
  ];
  const taskById = new Map((meetingTasks ?? []).map((task: any) => [String(task._id), task]));
  const open = rows.filter((row) => !["completed", "cancelled"].includes(actionItemStatus(row.item))).length;

  const patchItem = async (row: Row, diff: Record<string, unknown>) => {
    const apply = (item: any) => {
      const next = { ...item, ...diff };
      if (typeof diff.status === "string") next.done = diff.status === "completed";
      return next;
    };
    if (row.sectionIndex == null) {
      if (!saveTopLevel) return;
      await saveTopLevel(topLevelItems.map((item, index) => (index === row.actionIndex ? apply(item) : item)));
      return;
    }
    await saveSections(sections.map((section: any, index: number) => index !== row.sectionIndex ? section : {
      ...section,
      actionItems: (section.actionItems ?? []).map((item: any, actionIndex: number) => (actionIndex === row.actionIndex ? apply(item) : item)),
    }));
  };

  // Owners typed as names that match exactly one directory person.
  const linkableOwners = rows.filter((row) => !row.item.assigneePersonId && row.item.assignee && matchDirectoryPerson(row.item.assignee, people));
  const linkAllOwners = async () => {
    const link = (item: any) => {
      if (item?.assigneePersonId || !item?.assignee) return item;
      const match = matchDirectoryPerson(item.assignee, people);
      return match ? { ...item, assigneePersonId: String(match._id) } : item;
    };
    if (linkableOwners.some((row) => row.sectionIndex == null) && saveTopLevel) await saveTopLevel(topLevelItems.map(link));
    if (linkableOwners.some((row) => row.sectionIndex != null)) {
      await saveSections(sections.map((section: any) => Array.isArray(section?.actionItems) ? { ...section, actionItems: section.actionItems.map(link) } : section));
    }
  };

  const addAction = async () => {
    if (!adding || !adding.text.trim() || savingDraft) return;
    const item: Record<string, unknown> = {
      text: adding.text.trim(),
      status: adding.status,
      done: adding.status === "completed",
    };
    if (adding.assignee.trim()) item.assignee = adding.assignee.trim();
    if (adding.assigneePersonId) item.assigneePersonId = adding.assigneePersonId;
    if (adding.dueDate.trim()) item.dueDate = adding.dueDate.trim();
    setSavingDraft(true);
    try {
      if (adding.section === GENERAL) {
        if (!saveTopLevel) return;
        await saveTopLevel([...topLevelItems, item]);
      } else {
        const target = Number(adding.section);
        await saveSections(sections.map((section: any, index: number) => index !== target ? section : {
          ...section,
          actionItems: [...(section.actionItems ?? []), item],
        }));
      }
      // Keep the form open on the same agenda item: minutes usually list
      // several actions in a row.
      setAdding(emptyDraft(adding.section));
    } finally {
      setSavingDraft(false);
    }
  };

  const removeAction = async (row: Row) => {
    const ok = await confirm({
      title: "Remove this action item?",
      message: `“${row.item.text}” will be removed from the minutes${row.item.taskId ? ". Its linked task stays on the task board" : ""}.`,
      confirmLabel: "Remove action",
      tone: "danger",
    });
    if (!ok) return;
    if (row.sectionIndex == null) {
      if (!saveTopLevel) return;
      await saveTopLevel(topLevelItems.filter((_item, index) => index !== row.actionIndex));
      return;
    }
    await saveSections(sections.map((section: any, index: number) => index !== row.sectionIndex ? section : {
      ...section,
      actionItems: (section.actionItems ?? []).filter((_item: any, actionIndex: number) => actionIndex !== row.actionIndex),
    }));
  };

  const saveRewording = async (row: Row) => {
    if (!rewording || !rewording.text.trim()) return;
    await patchItem(row, { text: rewording.text.trim(), dueDate: rewording.dueDate.trim() || undefined });
    setRewording(null);
  };

  const makeTask = async (row: Row, key: string) => {
    if (!createTask) return;
    setBusyKey(key);
    try {
      const taskId = await createTask(taskDraftFromActionItem(row.item, { meetingTitle, sectionTitle: row.sectionTitle }));
      if (taskId) await patchItem(row, { taskId });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="card" id="meeting-minutes-action-items" data-testid="action-items-card">
      <div className="card__head">
        <h2 className="card__title"><ListChecks size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Action items</h2>
        <span className="card__subtitle">{rows.length ? `${open} open · ${rows.length} total` : "None recorded"}</span>
        {canEdit && linkableOwners.length > 0 && (
          <button type="button" className="btn-action" style={{ marginLeft: "auto" }} onClick={() => { void linkAllOwners(); }} data-testid="link-action-owners" title="Link owners whose name matches exactly one person in the people directory">
            Link {linkableOwners.length} owner{linkableOwners.length === 1 ? "" : "s"} to the directory
          </button>
        )}
        {canEdit && !adding && (
          <button type="button" className="btn-action" style={linkableOwners.length ? undefined : { marginLeft: "auto" }} onClick={() => setAdding(emptyDraft(sections.length ? "0" : GENERAL))} data-testid="add-action-item">
            <Plus size={12} /> Add action
          </button>
        )}
      </div>
      <div className="card__body">
        {adding && (
          <form
            className="action-item-form"
            data-testid="add-action-form"
            onSubmit={(event) => { event.preventDefault(); void addAction(); }}
          >
            <label className="action-item-form__wide">
              <span>Action</span>
              <input
                className="input"
                autoFocus
                value={adding.text}
                onChange={(event) => setAdding({ ...adding, text: event.target.value })}
                placeholder="e.g. Revise the accounts list for the next budget year"
              />
            </label>
            <div className="action-item-form__field">
              <span>Agenda item</span>
              <Select value={adding.section} onChange={(section) => setAdding({ ...adding, section })} options={sectionOptions} size="sm" aria-label="Agenda item for the action" />
            </div>
            <div className="action-item-form__field">
              <span>Owner</span>
              <PersonNameLinkField
                value={{ name: adding.assignee, personId: adding.assigneePersonId }}
                people={people}
                ariaLabel="Action owner"
                placeholder="Name as written"
                onChange={(next) => setAdding({ ...adding, assignee: next.name, assigneePersonId: next.personId })}
              />
            </div>
            <label className="action-item-form__field">
              <span>Due</span>
              <input className="input" value={adding.dueDate} onChange={(event) => setAdding({ ...adding, dueDate: event.target.value })} placeholder="Date or as written" />
            </label>
            <div className="action-item-form__field">
              <span>Status</span>
              <Select value={adding.status} onChange={(status) => setAdding({ ...adding, status: status as ActionItemStatus })} options={STATUS_OPTIONS} size="sm" aria-label="Action status" />
            </div>
            <div className="action-item-form__buttons">
              <button type="button" className="btn-action" onClick={() => setAdding(null)}>Done</button>
              <button type="submit" className="btn-action btn-action--primary" disabled={!adding.text.trim() || savingDraft} data-testid="add-action-save">
                <Plus size={12} /> {savingDraft ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        )}
        {!rows.length && !adding && (
          <p className="muted" style={{ margin: 0 }}>No action items recorded. Add the actions these minutes assign, with their owners.</p>
        )}
        <div className="action-list action-list--compact">
          {rows.map((row) => {
            const key = `${row.sectionIndex ?? "top"}-${row.actionIndex}`;
            const status = actionItemStatus(row.item) as ActionItemStatus;
            const task = row.item.taskId ? taskById.get(String(row.item.taskId)) : undefined;
            const editing = editingKey === key;
            return (
              <div className="action-item action-item--rich" key={key} data-testid="action-item">
                <span className={`action-item__text${status === "completed" ? " done" : ""}`}>
                  {rewording?.key === key ? (
                    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input className="input input--sm" style={{ flex: "1 1 220px" }} value={rewording.text} onChange={(event) => setRewording({ ...rewording, text: event.target.value })} aria-label="Action wording" autoFocus
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveRewording(row); } if (event.key === "Escape") setRewording(null); }} />
                      <input className="input input--sm" style={{ width: 130 }} value={rewording.dueDate} onChange={(event) => setRewording({ ...rewording, dueDate: event.target.value })} aria-label="Action due date" placeholder="Due" />
                      <button type="button" className="btn-action btn-action--primary" disabled={!rewording.text.trim()} onClick={() => { void saveRewording(row); }}>Save</button>
                      <button type="button" className="btn-action" onClick={() => setRewording(null)}>Cancel</button>
                    </span>
                  ) : <span>{row.item.text}</span>}
                  <span className="action-item__context">
                    {row.sectionIndex == null ? "Minutes" : `${row.sectionIndex + 1}. ${row.sectionTitle}`}
                    {row.item.sourceStatus ? ` · source: “${row.item.sourceStatus}”` : ""}
                  </span>
                </span>
                <div className="action-item__controls">
                  <div className="action-item__status">
                    <Select
                      value={status}
                      onChange={(next) => { void patchItem(row, { status: next }); }}
                      options={STATUS_OPTIONS}
                      size="sm"
                      disabled={!canEdit}
                      aria-label={`Status of action: ${row.item.text}`}
                    />
                  </div>
                  {editing ? (
                    <span
                      className="row action-item__owner-edit"
                      style={{ gap: 6, flexWrap: "wrap" }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void patchItem(row, { assignee: ownerDraft.name.trim() || undefined, assigneePersonId: ownerDraft.personId }).then(() => setEditingKey(null));
                        }
                      }}
                    >
                      <PersonNameLinkField
                        value={ownerDraft}
                        people={people}
                        ariaLabel={`Assignee of action: ${row.item.text}`}
                        placeholder="Assignee"
                        onChange={setOwnerDraft}
                      />
                      <button type="button" className="btn-action btn-action--primary" onClick={() => { void patchItem(row, { assignee: ownerDraft.name.trim() || undefined, assigneePersonId: ownerDraft.personId }).then(() => setEditingKey(null)); }}>Save</button>
                      <button type="button" className="btn-action" onClick={() => setEditingKey(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-action"
                      disabled={!canEdit}
                      onClick={() => {
                        const name = String(row.item.assignee ?? "");
                        setOwnerDraft({ name, personId: row.item.assigneePersonId ?? (name ? matchDirectoryPerson(name, people)?._id : undefined) });
                        setEditingKey(key);
                      }}
                      title={row.item.assigneePersonId ? "Owner (linked to the people directory) — change" : "Change owner"}
                      aria-label={`Owner of action: ${row.item.text}`}
                    >
                      {row.item.assignee ? <>{row.item.assignee}{row.item.assigneePersonId ? " ✓" : ""}</> : "Assign…"}
                    </button>
                  )}
                  {row.item.dueDate && <span className="action-item__due">{row.item.dueDate}</span>}
                  {task ? (
                    <Link className="btn-action" to="/app/tasks" title={`Task: ${task.title}`}>
                      <ClipboardList size={12} /> {task.status}
                    </Link>
                  ) : row.item.taskId ? (
                    <Badge tone="neutral">Task linked</Badge>
                  ) : canCreateTasks && createTask ? (
                    <button type="button" className="btn-action" disabled={busyKey === key || !canEdit} onClick={() => { void makeTask(row, key); }} data-testid="create-task-from-action">
                      <ClipboardList size={12} /> {busyKey === key ? "Creating…" : "Create task"}
                    </button>
                  ) : null}
                  {canEdit && rewording?.key !== key && (
                    <>
                      <button type="button" className="btn-action btn-action--icon" title="Edit wording and due date" aria-label={`Edit action: ${row.item.text}`} onClick={() => setRewording({ key, text: String(row.item.text ?? ""), dueDate: String(row.item.dueDate ?? "") })}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" className="btn-action btn-action--icon" title="Remove action" aria-label={`Remove action: ${row.item.text}`} onClick={() => { void removeAction(row); }}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
