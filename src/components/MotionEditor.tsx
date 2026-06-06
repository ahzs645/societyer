import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Check, X, Plus, Trash2, MinusCircle, PlusCircle, Pencil, Clock } from "lucide-react";

function DinnerTableIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M25.484,7.114l-4.278-3.917C21.034,3.069,20.825,3,20.61,3H5.38C5.165,3,4.956,3.069,4.783,3.197l-4.38,4C0.403,7.197,0,7.453,0,8v2c0,0.551,0.449,1,1,1h24c0.551,0,1-0.449,1-1V8C26,7.469,25.484,7.114,25.484,7.114z" />
      <path d="M2,23c-0.551,0-1-0.449-1-1V10h3v12c0,0.551-0.449,1-1,1H2z" />
      <path d="M23,23c-0.551,0-1-0.449-1-1V10h3v12c0,0.551-0.449,1-1,1H23z" />
      <path d="M20,18c-0.551,0-1-0.449-1-1v-5h2v5C21,17.551,20.551,18,20,18L20,18z" />
      <path d="M6,18c-0.551,0-1-0.449-1-1v-5h2v5C7,17.551,6.551,18,6,18L6,18z" />
    </svg>
  );
}
import { Badge, Field } from "./ui";
import { MarkdownEditor } from "./MarkdownEditor";
import { NameAutocomplete } from "./NameAutocomplete";
import { Select, type SelectOption } from "./Select";
import { Tooltip } from "./Tooltip";
import { Modal, useConfirm } from "./Modal";

export type Motion = {
  name?: string;
  text: string;
  movedBy?: string;
  movedByMemberId?: string;
  movedByDirectorId?: string;
  secondedBy?: string;
  secondedByMemberId?: string;
  secondedByDirectorId?: string;
  outcome: "Carried" | "Defeated" | "Tabled" | string;
  votesFor?: number;
  votesAgainst?: number;
  abstentions?: number;
  resolutionType?: "Ordinary" | "Special" | "Unanimous" | string;
  sectionIndex?: number;
  sectionTitle?: string;
};

export type MotionPerson = {
  id: string;
  kind: "member" | "director";
  name: string;
  aliases?: string[];
};

export type MotionAgendaSection = {
  title: string;
  discussion?: string;
  decisions?: string[];
};

const RESOLUTION_TYPE_OPTIONS: SelectOption<string>[] = [
  { value: "Ordinary", label: "Ordinary (simple majority)" },
  { value: "Special", label: "Special (>= 2/3)" },
  { value: "Unanimous", label: "Unanimous" },
  { value: "Procedural", label: "Procedural" },
];

export function isAdjournmentMotion(motion: Pick<Motion, "text" | "sectionTitle" | "resolutionType">) {
  const text = `${motion.text ?? ""} ${motion.sectionTitle ?? ""} ${motion.resolutionType ?? ""}`.toLowerCase();
  return /\badjourn(?:ment|ed|s)?\b/.test(text);
}

/** Required threshold percentage for a resolution type per the Societies Act. */
export function thresholdFor(kind?: string): number {
  if (kind === "Special") return 2 / 3;
  if (kind === "Unanimous") return 1;
  return 0.5;
}

/** Whether a motion's vote counts meet its resolution threshold. */
export function motionMeetsThreshold(m: Motion): boolean | null {
  const f = m.votesFor ?? 0;
  const a = m.votesAgainst ?? 0;
  const cast = f + a; // abstentions don't count toward "votes cast"
  if (cast === 0) return null;
  return f / cast >= thresholdFor(m.resolutionType);
}

/** Director/member name autocomplete. Uses the shared NameAutocomplete so the
 * dropdown is themed instead of using the browser's native datalist. */
function NameInput({
  value,
  onChange,
  placeholder,
  nameOptions,
}: {
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  nameOptions: string[];
}) {
  return (
    <NameAutocomplete
      value={value ?? ""}
      onChange={onChange}
      options={nameOptions}
      placeholder={placeholder}
    />
  );
}

function OutcomePicker({
  value,
  onChange,
  compact = false,
  stretch = false,
}: {
  value: string;
  onChange: (v: Motion["outcome"]) => void;
  compact?: boolean;
  /** Buttons grow to fill the available row width and only collapse to
   *  icon-only when the labels can't stay on a single line. */
  stretch?: boolean;
}) {
  const opts: { id: Motion["outcome"]; label: string; toneClass: string; renderIcon: () => React.ReactNode }[] = [
    { id: "Pending", label: "Pending", toneClass: "", renderIcon: () => <Clock size={12} aria-hidden="true" /> },
    { id: "Carried", label: "Carried", toneClass: "btn-action--success", renderIcon: () => <Check size={12} aria-hidden="true" /> },
    { id: "Defeated", label: "Defeated", toneClass: "btn-action--danger", renderIcon: () => <X size={12} aria-hidden="true" /> },
    { id: "Tabled", label: "Tabled", toneClass: "btn-action--warn", renderIcon: () => <DinnerTableIcon size={12} /> },
  ];
  return (
    <div className={`motion-outcome-picker${compact ? " motion-outcome-picker--compact" : ""}${stretch ? " motion-outcome-picker--stretch" : ""}`} role="radiogroup" aria-label="Outcome">
      {opts.map(({ id, label, toneClass, renderIcon }) => {
        const isSelected = value === id;
        return (
          <Tooltip key={id} content={label}>
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`btn-action ${toneClass}${isSelected ? " is-active" : ""}`.trim()}
              onClick={() => onChange(id)}
              aria-label={label}
            >
              {renderIcon()}
              <span className="btn-action__label">{label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function VoteProgress({ motion }: { motion: Motion }) {
  const f = motion.votesFor ?? 0;
  const a = motion.votesAgainst ?? 0;
  const s = motion.abstentions ?? 0;
  const total = f + a + s;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
        }}
      >
        {f > 0 && <div style={{ width: `${pct(f)}%`, background: "var(--success)" }} />}
        {s > 0 && <div style={{ width: `${pct(s)}%`, background: "var(--warn)" }} />}
        {a > 0 && <div style={{ width: `${pct(a)}%`, background: "var(--danger)" }} />}
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>
        {total === 0
          ? "No votes recorded yet"
          : `For ${f} · Against ${a} · Abstain ${s} · (${total} voting)`}
      </div>
    </div>
  );
}

export type MotionEditorHandle = {
  startAdding: () => void;
  /** Commit any in-progress motion draft. Returns true if a non-empty draft
   * was committed, false if there was nothing to commit. Used by parents that
   * own a "Save" button outside the editor — they can flush a pending draft
   * before persisting their own state so it doesn't get silently dropped. */
  commitDraft: () => boolean;
};

export const MotionEditor = forwardRef<MotionEditorHandle, {
  motions: Motion[];
  onChange: (next: Motion[]) => void;
  /** Director full names used to autofill movedBy/secondedBy. */
  directorNames: string[];
  people?: MotionPerson[];
  agendaSections?: Array<string | MotionAgendaSection>;
  onAddToBacklog?: (motion: Motion, index: number) => void | Promise<void>;
  /** Hide the inline "Add motion" button; parent provides its own trigger via ref. */
  hideInlineAdd?: boolean;
  /** Restrict the editor to a single agenda section: only motions assigned to
   * that section are listed, new drafts are pre-assigned to it, and the
   * adjournment block is hidden (not relevant within an agenda item). */
  sectionScope?: number;
  /** Fires whenever the in-progress draft toggles between "empty/closed" and
   * "open with text". Lets parents reflect the pending state in their own
   * UI (e.g. an outer Save button that should also flush the draft). */
  onPendingDraftChange?: (hasPending: boolean) => void;
}>(function MotionEditor({
  motions,
  onChange,
  directorNames,
  people = [],
  agendaSections = [],
  onAddToBacklog,
  hideInlineAdd = false,
  sectionScope,
  onPendingDraftChange,
}, ref) {
  const scopedSectionTitle = sectionScope == null ? "" : agendaSectionTitle(agendaSections[sectionScope]);
  const isAdjournmentScope = sectionScope != null && isAdjournmentSectionTitle(scopedSectionTitle);
  const sectionPatchForScope = (): Partial<Motion> =>
    sectionScope != null ? motionSectionPatch(String(sectionScope), agendaSections) : {};
  const makeDraft = (): Motion => ({ text: "", outcome: "Pending", ...sectionPatchForScope() });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Motion>(makeDraft);
  // Index of the motion the user is editing inline. Lifted out of MotionRow
  // so the parent can enforce one-at-a-time editing and so the bottom
  // "Add motion" button can swap to "Done" while an edit is open.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const beginAdding = () => {
    // When scoped to a section, force the draft's sectionIndex/sectionTitle to
    // that section every time the user opens the add form — otherwise stale
    // values from a previous cancelled draft could leak in.
    if (sectionScope != null) setDraft((current) => ({ ...current, ...sectionPatchForScope() }));
    setAdding(true);
  };
  // While true, votesFor auto-tracks (movedBy ? 1 : 0) + (secondedBy ? 1 : 0).
  // The user breaks this binding the moment they edit votesFor manually.
  const [votesAutoFill, setVotesAutoFill] = useState(true);

  const updateDraftPerson = (
    key: "movedBy" | "secondedBy",
    value: string,
    extra: Partial<Motion> = {},
  ) => {
    setDraft((current) => {
      const next = { ...current, [key]: value, ...extra };
      if (votesAutoFill) {
        const moved = (key === "movedBy" ? value : current.movedBy ?? "").trim();
        const seconded = (key === "secondedBy" ? value : current.secondedBy ?? "").trim();
        next.votesFor = (moved ? 1 : 0) + (seconded ? 1 : 0);
      }
      return next;
    });
  };

  const resetDraft = () => {
    setDraft(makeDraft());
    setVotesAutoFill(true);
  };

  const nameOptions = useMemo(
    () => Array.from(new Set([...directorNames, ...people.flatMap((person) => [person.name, ...(person.aliases ?? [])])])).filter(Boolean).sort(),
    [directorNames, people],
  );
  const allMotionRows = motions.map((motion, index) => ({ motion, index }));
  // Filter to the scoped section when embedded inside the section editor; the
  // onChange callback still emits the full motions array, so array indexes
  // remain stable and the parent stays the source of truth.
  const motionRows = sectionScope == null
    ? allMotionRows
    : allMotionRows.filter(({ motion }) =>
        assignedSectionIndexForMotion(motion, agendaSections) === sectionScope,
      );
  const businessMotionRows = motionRows.filter(({ motion }) => !isAdjournmentMotion(motion));
  const adjournmentRows = motionRows.filter(({ motion }) => isAdjournmentMotion(motion));

  const saveDraft = () => {
    if (!draft.text.trim()) return;
    onChange([...motions, { ...draft, text: draft.text.trim() }]);
    resetDraft();
    setAdding(false);
  };

  // Notify the parent whenever the in-progress draft has typed text. Used by
  // outer save buttons (e.g. "Save section") to flip their label and to know
  // when to call commitDraft() before persisting their own state.
  const hasPendingDraft = adding && draft.text.trim().length > 0;
  useEffect(() => {
    onPendingDraftChange?.(hasPendingDraft);
  }, [hasPendingDraft, onPendingDraftChange]);
  // Make sure the parent's "pending" indicator clears when MotionEditor goes
  // away — otherwise a stale "+ add motion" label could stick around.
  useEffect(() => {
    return () => onPendingDraftChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    startAdding: beginAdding,
    commitDraft: () => {
      const text = draft.text.trim();
      if (!adding || !text) return false;
      onChange([...motions, { ...draft, text }]);
      resetDraft();
      setAdding(false);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [adding, draft, motions, onChange, sectionScope, agendaSections]);

  const patch = (idx: number, diff: Partial<Motion>) => {
    const next = motions.map((m, i) => (i === idx ? { ...m, ...diff } : m));
    onChange(next);
  };

  const setVote = (idx: number, key: "votesFor" | "votesAgainst" | "abstentions", next: number) => {
    patch(idx, { [key]: Math.max(0, next) } as Partial<Motion>);
  };

  const addAdjournmentRecord = () => {
    onChange([
      ...motions,
      {
        text: "Adjourn the meeting",
        outcome: "Carried",
        resolutionType: "Procedural",
        ...sectionPatchForScope(),
        sectionTitle: scopedSectionTitle || "Adjournment",
      },
    ]);
  };

  useEffect(() => {
    if (!isAdjournmentScope || adjournmentRows.length > 0) return;
    addAdjournmentRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdjournmentScope, adjournmentRows.length]);

  return (
    <div>
      {businessMotionRows.length === 0 && !adding && (
        <div className="muted">
          {isAdjournmentScope
            ? "Adjournment is tracked as a procedural motion below."
            : sectionScope != null
            ? "No motions assigned to this agenda item yet."
            : "No business motions recorded yet."}
        </div>
      )}

      {businessMotionRows.map(({ motion: m, index: i }) => (
        <MotionRow
          key={i}
          motion={m}
          nameOptions={nameOptions}
          directorNames={directorNames}
          people={people}
          agendaSections={agendaSections}
          expanded={editingIndex === i}
          onSetExpanded={(next) => setEditingIndex(next ? i : null)}
          onPatch={(diff) => patch(i, diff)}
          onSetVote={(k, n) => setVote(i, k, n)}
          onDelete={() => {
            if (editingIndex === i) setEditingIndex(null);
            onChange(motions.filter((_, j) => j !== i));
          }}
          onAddToBacklog={onAddToBacklog ? () => onAddToBacklog(m, i) : undefined}
        />
      ))}

      {!adding && !hideInlineAdd && (
        <div className="motion-add-before-adjournment">
          {editingIndex != null ? (
            <button className="btn-action btn-action--primary" onClick={() => setEditingIndex(null)}>
              <Check size={12} /> Done
            </button>
          ) : (
            <button className="btn-action" onClick={beginAdding}>
              <Plus size={12} /> Add motion
            </button>
          )}
        </div>
      )}

      {adding && (
        <div className="motion motion-draft" style={{ borderColor: "var(--accent)" }}>
          <div className="motion-draft__header">
            <div>
              <strong>Add motion</strong>
              <div className="muted">Record the wording first, then capture movers and outcome.</div>
            </div>
            <div className="motion-draft__actions">
              <button className="btn-action" onClick={() => { setAdding(false); resetDraft(); }}>
                <X size={12} /> Cancel
              </button>
              <button className="btn-action btn-action--primary" onClick={saveDraft} disabled={!draft.text.trim()}>
                <Check size={12} /> Add
              </button>
            </div>
          </div>

          <div className="motion-draft__motion-field">
            <input
              className="input motion-draft__name-input"
              autoFocus
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Motion name — e.g. Approve 2024–25 financial statements"
              aria-label="Motion name"
            />
            <textarea
              className="textarea"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="Details — extra context, e.g. That the board approve the 2024–25 financial statements as presented."
              aria-label="Details"
            />
          </div>

          <details className="motion-draft__details">
            <summary className="motion-draft__details-summary">Details</summary>
            <div className="motion-draft__grid">
              <Field label="Moved by">
              <NameInput
                nameOptions={nameOptions}
                value={draft.movedBy}
                onChange={(v) =>
                  updateDraftPerson("movedBy", v, motionPersonPatch("movedBy", resolveMotionPerson(v, people)))
                }
                placeholder="Start typing…"
              />
            </Field>
            <Field label="Seconded by">
              <NameInput
                nameOptions={nameOptions}
                value={draft.secondedBy}
                onChange={(v) =>
                  updateDraftPerson("secondedBy", v, motionPersonPatch("secondedBy", resolveMotionPerson(v, people)))
                }
                placeholder="Optional"
              />
            </Field>

            <Field label="Resolution type">
              <Select
                value={draft.resolutionType ?? "Ordinary"}
                onChange={(resolutionType) => setDraft({ ...draft, resolutionType })}
                options={RESOLUTION_TYPE_OPTIONS}
                size="sm"
              />
            </Field>

            <OutcomePicker stretch value={draft.outcome} onChange={(v) => setDraft({ ...draft, outcome: v })} />

            {agendaSections.length > 0 && (
              <Field label="Agenda item">
                <Select
                  value={draft.sectionIndex == null ? "" : String(draft.sectionIndex)}
                  onChange={(value) => setDraft((current) => ({ ...current, ...motionSectionPatch(value, agendaSections) }))}
                  options={agendaSectionOptions(agendaSections)}
                  size="sm"
                />
              </Field>
            )}

            <div className="motion-draft__votes">
              <div className="motion-draft__vote-row">
                <VoteStepper
                  label="For"
                  value={draft.votesFor ?? 0}
                  onChange={(n) => {
                    setVotesAutoFill(false);
                    setDraft((current) => ({ ...current, votesFor: n }));
                  }}
                  tone="success"
                />
                <VoteStepper
                  label="Against"
                  value={draft.votesAgainst ?? 0}
                  onChange={(n) => setDraft((current) => ({ ...current, votesAgainst: n }))}
                  tone="danger"
                />
                <VoteStepper
                  label="Abstain"
                  value={draft.abstentions ?? 0}
                  onChange={(n) => setDraft((current) => ({ ...current, abstentions: n }))}
                  tone="warn"
                />
              </div>
            </div>
          </div>
          </details>
        </div>
      )}

      {(sectionScope == null || isAdjournmentScope) && (
      <div className="motion-adjournment">
        <div className="motion-adjournment__head">
          <div>
            <strong>Adjournment</strong>
            <div className="muted">Procedural close of the meeting.</div>
          </div>
          {!adjournmentRows.length && (
            <button className="btn-action" type="button" onClick={addAdjournmentRecord}>
              <Plus size={12} /> Add adjournment record
            </button>
          )}
        </div>
        {adjournmentRows.map(({ motion: m, index: i }) => (
          <MotionRow
            key={`adjournment-${i}`}
            motion={m}
            nameOptions={nameOptions}
            directorNames={directorNames}
            people={people}
            agendaSections={agendaSections}
            procedural
            expanded={editingIndex === i}
            onSetExpanded={(next) => setEditingIndex(next ? i : null)}
            onPatch={(diff) => patch(i, diff)}
            onSetVote={(k, n) => setVote(i, k, n)}
            onDelete={() => {
              if (editingIndex === i) setEditingIndex(null);
              onChange(motions.filter((_, j) => j !== i));
            }}
          />
        ))}
      </div>
      )}
    </div>
  );
});

function MotionRow({
  motion,
  nameOptions,
  directorNames,
  people,
  agendaSections,
  procedural = false,
  expanded = false,
  onSetExpanded,
  onPatch,
  onSetVote,
  onDelete,
  onAddToBacklog,
}: {
  motion: Motion;
  nameOptions: string[];
  directorNames: string[];
  people: MotionPerson[];
  agendaSections: Array<string | MotionAgendaSection>;
  procedural?: boolean;
  expanded?: boolean;
  onSetExpanded?: (next: boolean) => void;
  onPatch: (diff: Partial<Motion>) => void;
  onSetVote: (k: "votesFor" | "votesAgainst" | "abstentions", next: number) => void;
  onDelete: () => void;
  onAddToBacklog?: () => void | Promise<void>;
}) {
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const confirm = useConfirm();

  const tone =
    motion.outcome === "Carried" ? "success" :
    motion.outcome === "Defeated" ? "danger" :
    motion.outcome === "Pending" ? "warn" : "warn";
  const isPending = motion.outcome === "Pending";
  const assignedAgendaLabel = agendaLabelForMotion(motion, agendaSections);
  const selectedAgendaIndex = assignedSectionIndexForMotion(motion, agendaSections);
  // Heuristic: title is "long" when it has more than ~80 chars or contains an
  // unbroken run of >30 non-space chars (URLs, ids, junk strings). When that's
  // the case, the action buttons stack below the title so the title gets the
  // full card width to breathe instead of wrapping inside a narrow column.
  const titleText = motion.name ?? "";
  const isLongTitle =
    titleText.length > 80 ||
    titleText.split(/\s+/).some((word) => word.length > 30);

  const motionHasContent =
    !!motion.name?.trim() ||
    !!motion.text?.trim() ||
    !!motion.movedBy?.trim() ||
    !!motion.secondedBy?.trim() ||
    (motion.votesFor ?? 0) > 0 ||
    (motion.votesAgainst ?? 0) > 0 ||
    (motion.abstentions ?? 0) > 0 ||
    (motion.outcome != null && motion.outcome !== "Pending");

  const handleRemoveClick = async () => {
    // Attached motions deserve an unlink-vs-delete prompt so users don't
    // accidentally lose the motion when they just wanted to detach it from
    // an agenda item. Empty unattached motions delete with no prompt.
    if (selectedAgendaIndex != null) {
      setShowRemoveDialog(true);
      return;
    }
    if (!motionHasContent) {
      onDelete();
      return;
    }
    const ok = await confirm({
      title: "Delete this motion?",
      message: "The motion text, votes, and outcome will be removed.",
      confirmLabel: "Delete motion",
      tone: "danger",
    });
    if (ok) onDelete();
  };

  return (
    <div
      className="motion"
      style={isPending ? { borderStyle: "dotted", borderColor: "var(--warn)" } : undefined}
    >
      <div className={`motion__head${isLongTitle ? " motion__head--stacked" : ""}`}>
        <div className="motion__head-main">
          <input
            className="motion__name-input"
            value={motion.name ?? ""}
            onChange={(event) => onPatch({ name: event.target.value })}
            placeholder="Motion name"
            aria-label="Motion name"
          />
          <div className="motion__meta">
            {!expanded && <Badge tone={tone as any}>{motion.outcome}</Badge>}
          </div>
        </div>
        <div className="motion__actions">
          <div className="motion__action-strip">
            {isPending && !expanded && (
              <>
                <button
                  className="btn-action btn-action--success"
                  onClick={() => onPatch({ outcome: "Carried" })}
                  title="Record as Carried"
                >
                  <Check size={12} />
                  <span className="btn-action__label">Carried</span>
                </button>
                <button
                  className="btn-action btn-action--danger"
                  onClick={() => onPatch({ outcome: "Defeated" })}
                  title="Record as Defeated"
                >
                  <X size={12} />
                  <span className="btn-action__label">Defeated</span>
                </button>
                <button
                  className="btn-action btn-action--warn"
                  onClick={() => onPatch({ outcome: "Tabled" })}
                  title="Record as Tabled"
                >
                  <DinnerTableIcon size={12} />
                  <span className="btn-action__label">Tabled</span>
                </button>
              </>
            )}
            {onAddToBacklog && /^(Tabled|Deferred)$/i.test(motion.outcome) && (
              <button className="btn-action" onClick={onAddToBacklog} title="Add to motion backlog">
                <Plus size={12} />
                <span className="btn-action__label">Add to backlog</span>
              </button>
            )}
            {!expanded && (
              <button
                className="btn-action"
                onClick={() => onSetExpanded?.(true)}
                title="Edit motion"
              >
                <Pencil size={12} />
                <span className="btn-action__label">Edit</span>
              </button>
            )}
            <button className="btn-action" onClick={handleRemoveClick} title="Remove motion" aria-label="Remove motion">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      <VoteProgress motion={motion} />

      {expanded && (
        <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
          <Field label="Details">
            <MarkdownEditor rows={4} value={motion.text} onChange={(markdown) => onPatch({ text: markdown })} />
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Moved by">
              <NameInput
                nameOptions={nameOptions}
                value={motion.movedBy}
                onChange={(v) => onPatch({ movedBy: v, ...motionPersonPatch("movedBy", resolveMotionPerson(v, people)) })}
              />
            </Field>
            <Field label="Seconded by">
              <NameInput
                nameOptions={nameOptions}
                value={motion.secondedBy}
                onChange={(v) => onPatch({ secondedBy: v, ...motionPersonPatch("secondedBy", resolveMotionPerson(v, people)) })}
              />
            </Field>
          </div>
          <Field label="Resolution type">
            <Select
              value={motion.resolutionType ?? "Ordinary"}
              onChange={(resolutionType) => onPatch({ resolutionType })}
              options={RESOLUTION_TYPE_OPTIONS}
            />
          </Field>
          <OutcomePicker stretch value={motion.outcome} onChange={(v) => onPatch({ outcome: v })} />
          {agendaSections.length > 0 && (
            <Field label="Agenda item">
              <Select
                value={selectedAgendaIndex == null ? "" : String(selectedAgendaIndex)}
                onChange={(value) => onPatch(motionSectionPatch(value, agendaSections))}
                options={agendaSectionOptions(agendaSections)}
              />
            </Field>
          )}
          <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
            <VoteStepper label="For" value={motion.votesFor ?? 0} onChange={(n) => onSetVote("votesFor", n)} tone="success" />
            <VoteStepper label="Against" value={motion.votesAgainst ?? 0} onChange={(n) => onSetVote("votesAgainst", n)} tone="danger" />
            <VoteStepper label="Abstain" value={motion.abstentions ?? 0} onChange={(n) => onSetVote("abstentions", n)} tone="warn" />
          </div>
        </div>
      )}
      <Modal
        open={showRemoveDialog}
        onClose={() => setShowRemoveDialog(false)}
        title="Remove motion?"
        size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setShowRemoveDialog(false)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={() => {
                setShowRemoveDialog(false);
                onPatch({ sectionIndex: undefined, sectionTitle: undefined });
              }}
            >
              Unlink from agenda
            </button>
            <button
              className="btn btn--danger"
              onClick={() => {
                setShowRemoveDialog(false);
                onDelete();
              }}
            >
              Delete motion
            </button>
          </>
        }
      >
        <p>
          This motion is attached to <strong>{assignedAgendaLabel || "an agenda item"}</strong>.
          Unlink it to keep the motion on the meeting without an agenda assignment, or delete it
          to remove the motion entirely.
        </p>
      </Modal>
    </div>
  );
}

export function motionPersonDisplayName(
  value: string | undefined,
  people: MotionPerson[],
  ids: { memberId?: string; directorId?: string } = {},
) {
  return resolveMotionPerson(value, people, ids)?.name ?? value ?? "";
}

function motionPersonPatch(prefix: "movedBy" | "secondedBy", person: MotionPerson | null): Partial<Motion> {
  return {
    [`${prefix}MemberId`]: person?.kind === "member" ? person.id : undefined,
    [`${prefix}DirectorId`]: person?.kind === "director" ? person.id : undefined,
  } as Partial<Motion>;
}

function motionSectionPatch(value: string, agendaSections: Array<string | MotionAgendaSection>): Partial<Motion> {
  if (value === "") {
    return { sectionIndex: undefined, sectionTitle: undefined };
  }
  const sectionIndex = Number(value);
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= agendaSections.length) {
    return {};
  }
  return {
    sectionIndex,
    sectionTitle: agendaSectionTitle(agendaSections[sectionIndex]) || undefined,
  };
}

function agendaLabelForMotion(motion: Motion, agendaSections: Array<string | MotionAgendaSection>) {
  const sectionIndex = assignedSectionIndexForMotion(motion, agendaSections);
  if (sectionIndex != null && agendaSections[sectionIndex]) {
    return `${sectionIndex + 1}. ${agendaSectionTitle(agendaSections[sectionIndex])}`;
  }
  return motion.sectionTitle ? `Agenda: ${motion.sectionTitle}` : "";
}

function assignedSectionIndexForMotion(motion: Motion, agendaSections: Array<string | MotionAgendaSection>) {
  if (motion.sectionIndex != null && agendaSections[motion.sectionIndex]) return motion.sectionIndex;
  if (motion.sectionTitle) {
    const titleMatch = agendaSections.findIndex((section) => normalizeMotionText(agendaSectionTitle(section)) === normalizeMotionText(motion.sectionTitle));
    if (titleMatch >= 0) return titleMatch;
  }
  const inferred = agendaSections.findIndex((section) => motionBelongsToAgendaSection(motion, section));
  return inferred >= 0 ? inferred : null;
}

function motionBelongsToAgendaSection(motion: Motion, section: string | MotionAgendaSection) {
  if (isAdjournmentMotion(motion)) return isAdjournmentSectionTitle(agendaSectionTitle(section));
  const haystackRaw = agendaSectionSearchText(section);
  const haystack = normalizeMotionText(haystackRaw);
  const motionText = normalizeMotionText(motion.text);
  if (!haystack || !motionText) return false;
  if (
    haystack.includes("agenda") &&
    /\b(approve|adopt|approval)\b/.test(motionText) &&
    motionText.includes("agenda")
  ) {
    return true;
  }
  if (
    /\b(previous )?minutes?\b/.test(haystack) &&
    /\b(approve|adopt|approval)\b/.test(motionText) &&
    /\bminutes?\b/.test(motionText)
  ) {
    return true;
  }

  const amounts = moneyAmounts(motion.text);
  if (amounts.length && !amounts.some((amount) => haystackRaw.replace(/\s+/g, "").includes(amount))) return false;
  if (haystack.includes(motionText.slice(0, 32))) return true;

  const words = motionText.split(" ").filter((word) => word.length > 3 && !["motion", "approve", "approved", "purchase", "payment", "payments"].includes(word));
  if (!words.length) return false;
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits >= Math.min(2, words.length);
}

function agendaSectionTitle(section: string | MotionAgendaSection | undefined) {
  return typeof section === "string" ? section : section?.title ?? "";
}

function agendaSectionOptions(agendaSections: Array<string | MotionAgendaSection>): SelectOption<string>[] {
  return [
    { value: "", label: "Unassigned" },
    ...agendaSections.map((section, index) => ({
      value: String(index),
      label: `${index + 1}. ${agendaSectionTitle(section) || "Untitled section"}`,
    })),
  ];
}

function agendaSectionSearchText(section: string | MotionAgendaSection) {
  if (typeof section === "string") return section;
  return [section.title, section.discussion ?? "", ...(section.decisions ?? [])].filter(Boolean).join(" ");
}

function isAdjournmentSectionTitle(title: string) {
  return /\badjourn(?:ment|ed|s)?\b/i.test(title);
}

function moneyAmounts(text: string) {
  return String(text ?? "").match(/\$\s?\d[\d,]*(?:\.\d{2})?/g)?.map((amount) => amount.replace(/\s+/g, "")) ?? [];
}

function normalizeMotionText(value: string | undefined | null) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveMotionPerson(
  value: string | undefined,
  people: MotionPerson[],
  ids: { memberId?: string; directorId?: string } = {},
) {
  if (ids.memberId || ids.directorId) {
    const id = ids.memberId ?? ids.directorId;
    const kind = ids.memberId ? "member" : "director";
    return people.find((person) => person.id === id && person.kind === kind) ?? null;
  }
  const key = normalizePersonName(value ?? "");
  if (!key) return null;
  const matches = people.filter((person) =>
    personLookupKeys(person).some((candidate) => candidate === key),
  );
  return matches.length === 1 ? matches[0] : null;
}

function personLookupKeys(person: MotionPerson) {
  const values = [person.name, ...(person.aliases ?? [])];
  const firstNames = values.map((value) => normalizePersonName(value).split(" ")[0]).filter(Boolean);
  return Array.from(new Set([...values.map(normalizePersonName), ...firstNames].filter(Boolean)));
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function VoteStepper({
  label,
  value,
  onChange,
  tone,
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  tone: "success" | "danger" | "warn";
  compact?: boolean;
}) {
  return (
    <div className={`field vote-stepper${compact ? " vote-stepper--compact" : ""}`} style={{ marginBottom: 0 }}>
      <label className="field__label" style={{ color: `var(--${tone})` }}>{label}</label>
      <div className="row" style={{ gap: 4 }}>
        <button
          className="btn-action btn-action--icon vote-stepper__btn"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Decrease ${label}`}
          style={{ color: `var(--${tone})` }}
        >
          <MinusCircle size={12} />
        </button>
        <input
          className="mono vote-stepper__input"
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            const parsed = e.target.value === "" ? 0 : Number(e.target.value);
            if (Number.isFinite(parsed)) onChange(Math.max(0, parsed));
          }}
          aria-label={label}
          style={{
            width: 56, textAlign: "center",
            padding: "2px 4px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontVariantNumeric: "tabular-nums",
            color: "inherit",
          }}
        />
        <button
          className="btn-action btn-action--icon vote-stepper__btn"
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label}`}
          style={{ color: `var(--${tone})` }}
        >
          <PlusCircle size={12} />
        </button>
      </div>
    </div>
  );
}
