import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { relative } from "../lib/format";
import { Button, EmptyState, Skeleton } from "./ui";
import { MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { useConfirm } from "./Modal";
import { MentionInput } from "./MentionInput";
import { MentionChip } from "./MentionChip";
import { parseMentions } from "../lib/mentions";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";

type Note = {
  _id: string;
  author: string;
  body: string;
  createdAtISO: string;
  updatedAtISO?: string;
};

/** Freeform notes attached to a record via (entityType, entityId).
 * Renders the list + a compose form; authors can edit/delete their own. */
export function NotesPanel({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const society = useSociety();
  const user = useCurrentUser();
  const { loaded, can } = usePermissions();
  const canRead = loaded && can("tasks:read");
  const canWrite = canRead && can("tasks:write");
  const confirm = useConfirm();
  const notes = useQuery(
    api.notes.listForRecord,
    society && canRead ? { societyId: society._id, entityType, subjectId: entityId } : "skip",
  ) as Note[] | undefined;
  const createNote = usePermissionedMutation(api.notes.create, canWrite);
  const updateNote = usePermissionedMutation(api.notes.update, canWrite);
  const removeNote = usePermissionedMutation(api.notes.remove, canWrite);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const author = user?.displayName ?? user?.email ?? "Someone";

  const submit = async () => {
    if (!canWrite || !society || !draft.trim()) return;
    setSaving(true);
    try {
      await createNote({
        societyId: society._id,
        entityType,
        subjectId: entityId,
        author,
        body: draft.trim(),
      });
      setDraft("");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!canWrite || !editDraft.trim() || !notes?.some(note => note._id === id && note.author === author)) return;
    await updateNote({ id: id as any, body: editDraft.trim() });
    setEditingId(null);
    setEditDraft("");
  };

  const destroy = async (note: Note) => {
    if (!canWrite || note.author !== author) return;
    const ok = await confirm({
      title: "Delete note?",
      message: "This can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await removeNote({ id: note._id as any });
  };

  if (loaded && !canRead) {
    return <p className="muted" role="status">Notes require additional access.</p>;
  }

  return (
    <div className="notes-panel">
      {canWrite ? <form
        className="notes-panel__compose"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <MentionInput
          className="textarea notes-panel__textarea"
          placeholder="Add a note — use @ to mention"
          value={draft}
          onChange={setDraft}
          rows={3}
        />
        <div className="notes-panel__compose-actions">
          <Button
            variant="accent"
            size="sm"
            type="submit"
            disabled={!canWrite || !draft.trim() || saving}
          >
            {saving ? "Saving…" : "Post note"}
          </Button>
        </div>
      </form> : loaded && <p className="muted" role="status">Read-only notes. Your role cannot add, edit, or delete notes.</p>}

      {notes === undefined ? (
        <div className="notes-panel__list" aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="notes-panel__item">
              <Skeleton variant="line" width="40%" height={10} />
              <div style={{ height: 6 }} />
              <Skeleton variant="line" width="90%" height={10} />
            </div>
          ))}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={18} />}
          title="No notes yet"
          description="Use notes to capture context, decisions, and follow-ups attached to this record."
          size="sm"
        />
      ) : (
        <ul className="notes-panel__list">
          {notes.map((note) => {
            const isEditing = canWrite && editingId === note._id;
            const canEdit = canWrite && note.author === author;
            return (
              <li key={note._id} className="notes-panel__item">
                <div className="notes-panel__head">
                  <strong>{note.author}</strong>
                  <span className="notes-panel__time">
                    {relative(note.createdAtISO)}
                    {note.updatedAtISO && " · edited"}
                  </span>
                  {canEdit && !isEditing && (
                    <div className="notes-panel__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label="Edit note"
                        onClick={() => {
                          if (!canWrite) return;
                          setEditingId(note._id);
                          setEditDraft(note.body);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label="Delete note"
                        onClick={() => destroy(note)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                  {isEditing && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label="Cancel edit"
                      onClick={() => setEditingId(null)}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <div className="notes-panel__edit">
                    <MentionInput
                      className="textarea notes-panel__textarea"
                      value={editDraft}
                      onChange={setEditDraft}
                      rows={3}
                    />
                    <Button size="sm" variant="accent" disabled={!canWrite || !editDraft.trim()} onClick={() => saveEdit(note._id)}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <div className="notes-panel__body">
                    {parseMentions(note.body).map((seg, i) =>
                      seg.kind === "mention" ? (
                        <MentionChip key={i} id={seg.id} label={seg.label} />
                      ) : (
                        <span key={i}>{seg.value}</span>
                      ),
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
