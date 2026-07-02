import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import { ShieldAlert, Trash2, Check, RotateCcw } from "lucide-react";
import { resolveConflictMotion } from "../lib/conflictMotions";

type MotionOption = { index: number; label: string; text: string };

function directorName(director: any): string {
  return `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim() || "Unnamed director";
}

/**
 * Conflict-of-interest / recusal capture for a single meeting. Declarations are
 * stored in the society-wide `conflicts` register but linked to this meeting
 * (and optionally a specific motion), and are rendered into the minutes export.
 */
export function MeetingConflictsCard({
  societyId,
  meetingId,
  directors,
  motions,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  directors: any[];
  motions: MotionOption[];
}) {
  const conflicts = useQuery(api.conflicts.forMeeting, { meetingId });
  const createConflict = useMutation(api.conflicts.create);
  const resolveConflict = useMutation(api.conflicts.resolve);
  const removeConflict = useMutation(api.conflicts.remove);
  const toast = useToast();

  const activeDirectors = useMemo(
    () => (directors ?? []).filter((d: any) => d.status !== "Resigned" && !d.resignedAt),
    [directors],
  );
  const directorById = useMemo(() => {
    const map = new Map<string, any>();
    for (const d of directors ?? []) map.set(d._id, d);
    return map;
  }, [directors]);

  const blankDraft = {
    directorId: "",
    contractOrMatter: "",
    natureOfInterest: "",
    motionIndex: "",
    abstainedFromVote: true,
    leftRoom: false,
    notes: "",
  };
  const [draft, setDraft] = useState(blankDraft);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sparse array keyed by each motion's ORIGINAL index in minutes.motions —
  // resolveConflictMotion needs positional lookup, and `motions` here is the
  // adjournment-filtered picklist that keeps raw indexes.
  const motionsByRawIndex = useMemo(() => {
    const sparse: Array<{ text: string; label: string }> = [];
    for (const option of motions) sparse[option.index] = { text: option.text, label: option.label };
    return sparse;
  }, [motions]);

  // Resolve the declaration's motion link by text snapshot, not raw index —
  // the motions array gets reordered/deleted and indexes go stale.
  const conflictMotionBadge = (conflict: any): { label: string; stale: boolean } | null => {
    const resolution = resolveConflictMotion(conflict, motionsByRawIndex);
    if (!resolution) return null;
    if (resolution.kind === "resolved") {
      const entry = motionsByRawIndex[resolution.index];
      return { label: entry?.label ?? `Motion ${resolution.index + 1}`, stale: false };
    }
    return { label: `Motion no longer on record: "${resolution.motionText}"`, stale: true };
  };

  const save = async () => {
    if (saving) return;
    if (!draft.directorId || !draft.contractOrMatter.trim()) {
      toast.error("Pick a director and describe the matter.");
      return;
    }
    setSaving(true);
    try {
      await createConflict({
        societyId,
        meetingId,
        directorId: draft.directorId as Id<"directors">,
        declaredAt: new Date().toISOString(),
        contractOrMatter: draft.contractOrMatter.trim(),
        natureOfInterest: draft.natureOfInterest.trim(),
        abstainedFromVote: draft.abstainedFromVote,
        leftRoom: draft.leftRoom,
        notes: draft.notes.trim() || undefined,
        motionIndex: draft.motionIndex === "" ? undefined : Number(draft.motionIndex),
        // Snapshot the motion text so the link survives reorders/deletes of
        // the positional motions array (see resolveConflictMotion).
        motionText:
          draft.motionIndex === ""
            ? undefined
            : motions.find((m) => m.index === Number(draft.motionIndex))?.text || undefined,
      });
    } finally {
      setSaving(false);
    }
    setDraft(blankDraft);
    setAdding(false);
    toast.success("Conflict declared", "Recorded against this meeting.");
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <ShieldAlert size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          Conflicts of interest &amp; recusals
        </h3>
        {!adding && (
          <button className="btn-action" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
            Declare conflict
          </button>
        )}
      </div>
      <div className="card__body">
        {(conflicts ?? []).length === 0 && !adding && (
          <p className="muted" style={{ margin: 0 }}>
            No conflicts declared for this meeting. Record any director's disclosed interest and whether
            they abstained or left the room.
          </p>
        )}

        {(conflicts ?? []).map((conflict: any) => {
          const director = directorById.get(conflict.directorId);
          return (
            <div key={conflict._id} className="meeting-conflict-row">
              <div className="meeting-conflict-row__main">
                <strong>{director ? directorName(director) : "Director"}</strong>
                <span className="muted"> · {conflict.contractOrMatter}</span>
                {conflict.natureOfInterest ? (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{conflict.natureOfInterest}</div>
                ) : null}
                <div className="meeting-conflict-row__badges">
                  {(() => {
                    const badge = conflictMotionBadge(conflict);
                    if (!badge) return null;
                    return <Badge tone={badge.stale ? "danger" : "warn"}>{badge.label}</Badge>;
                  })()}
                  {conflict.abstainedFromVote && <Badge tone="success">Abstained</Badge>}
                  {conflict.leftRoom && <Badge tone="success">Left room</Badge>}
                  {conflict.resolvedAt ? (
                    <Badge tone="neutral">Resolved {formatDate(conflict.resolvedAt)}</Badge>
                  ) : (
                    <Badge tone="warn">Open</Badge>
                  )}
                </div>
              </div>
              <div className="meeting-conflict-row__actions">
                {conflict.resolvedAt ? (
                  <button
                    className="btn-action"
                    title="Reopen"
                    onClick={() => resolveConflict({ id: conflict._id, resolvedAt: "" })}
                  >
                    <RotateCcw size={12} />
                  </button>
                ) : (
                  <button
                    className="btn-action"
                    title="Mark resolved"
                    onClick={() => resolveConflict({ id: conflict._id, resolvedAt: new Date().toISOString() })}
                  >
                    <Check size={12} />
                  </button>
                )}
                <button
                  className="btn-action"
                  title="Remove"
                  aria-label="Remove conflict"
                  onClick={() => removeConflict({ id: conflict._id })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {adding && (
          <div className="meeting-conflict-form">
            <div className="row" style={{ gap: 12 }}>
              <Field label="Director">
                <Select
                  value={draft.directorId}
                  onChange={(value) => setDraft({ ...draft, directorId: value })}
                  options={[
                    { value: "", label: "Select director…" },
                    ...activeDirectors.map((d: any) => ({ value: d._id as string, label: directorName(d) })),
                  ]}
                />
              </Field>
              {motions.length > 0 && (
                <Field label="Related motion (optional)">
                  <Select
                    value={draft.motionIndex}
                    onChange={(value) => setDraft({ ...draft, motionIndex: value })}
                    options={[
                      { value: "", label: "Whole meeting" },
                      ...motions.map((m) => ({ value: String(m.index), label: m.label })),
                    ]}
                  />
                </Field>
              )}
            </div>
            <Field label="Contract or matter">
              <input
                className="input"
                value={draft.contractOrMatter}
                onChange={(e) => setDraft({ ...draft, contractOrMatter: e.target.value })}
                placeholder="e.g. Vendor contract with Acme Ltd."
              />
            </Field>
            <Field label="Nature of interest">
              <input
                className="input"
                value={draft.natureOfInterest}
                onChange={(e) => setDraft({ ...draft, natureOfInterest: e.target.value })}
                placeholder="e.g. Director is a part-owner of the vendor"
              />
            </Field>
            <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={draft.abstainedFromVote}
                  onChange={(e) => setDraft({ ...draft, abstainedFromVote: e.target.checked })}
                />
                Abstained from vote
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={draft.leftRoom}
                  onChange={(e) => setDraft({ ...draft, leftRoom: e.target.checked })}
                />
                Left the room
              </label>
            </div>
            <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn" onClick={() => { setAdding(false); setDraft(blankDraft); }}>Cancel</button>
              <button className="btn btn--accent" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save declaration"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
