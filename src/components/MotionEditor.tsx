import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Check, X, Plus, Trash2, MinusCircle, PlusCircle, Pencil } from "lucide-react";

function DinnerTableIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 22 14.61"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M21 1H1" />
      <path
        d="M3.01,1.92v11.78c0,1.22,1.9,1.22,1.9,0V1.92c0-1.22-1.9-1.22-1.9,0Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M17.05,1.92c0,3.93,0,7.85,0,11.78s1.9,1.22,1.9,0c0-3.93,0-7.85,0-11.78s-1.9-1.22-1.9,0Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
import { Badge, Field } from "./ui";
import { NameAutocomplete } from "./NameAutocomplete";

export type Motion = {
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
}: {
  value: string;
  onChange: (v: Motion["outcome"]) => void;
}) {
  const opts: { id: Motion["outcome"]; label: string; tone: "success" | "danger" | "warn" | "accent" }[] = [
    { id: "Pending", label: "Pending", tone: "warn" },
    { id: "Carried", label: "Carried", tone: "success" },
    { id: "Defeated", label: "Defeated", tone: "danger" },
    { id: "Tabled", label: "Tabled", tone: "warn" },
  ];
  return (
    <div className="segmented">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`segmented__btn${value === o.id ? " is-active" : ""}`}
          onClick={() => onChange(o.id)}
          style={{
            color: value === o.id ? `var(--${o.tone})` : undefined,
          }}
        >
          {o.label}
        </button>
      ))}
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
}>(function MotionEditor({
  motions,
  onChange,
  directorNames,
  people = [],
  agendaSections = [],
  onAddToBacklog,
  hideInlineAdd = false,
}, ref) {
  const [adding, setAdding] = useState(false);
  useImperativeHandle(ref, () => ({ startAdding: () => setAdding(true) }), []);
  const [draft, setDraft] = useState<Motion>({ text: "", outcome: "Pending" });
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
    setDraft({ text: "", outcome: "Pending" });
    setVotesAutoFill(true);
  };

  const nameOptions = useMemo(
    () => Array.from(new Set([...directorNames, ...people.flatMap((person) => [person.name, ...(person.aliases ?? [])])])).filter(Boolean).sort(),
    [directorNames, people],
  );
  const motionRows = motions.map((motion, index) => ({ motion, index }));
  const businessMotionRows = motionRows.filter(({ motion }) => !isAdjournmentMotion(motion));
  const adjournmentRows = motionRows.filter(({ motion }) => isAdjournmentMotion(motion));

  const saveDraft = () => {
    if (!draft.text.trim()) return;
    onChange([...motions, { ...draft, text: draft.text.trim() }]);
    resetDraft();
    setAdding(false);
  };

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
        sectionTitle: "Adjournment",
      },
    ]);
  };

  return (
    <div>
      {businessMotionRows.length === 0 && !adding && <div className="muted">No business motions recorded yet.</div>}

      {businessMotionRows.map(({ motion: m, index: i }) => (
        <MotionRow
          key={i}
          motion={m}
          nameOptions={nameOptions}
          directorNames={directorNames}
          people={people}
          agendaSections={agendaSections}
          onPatch={(diff) => patch(i, diff)}
          onSetVote={(k, n) => setVote(i, k, n)}
          onDelete={() => onChange(motions.filter((_, j) => j !== i))}
          onAddToBacklog={onAddToBacklog ? () => onAddToBacklog(m, i) : undefined}
        />
      ))}

      {!adding && !hideInlineAdd && (
        <div className="motion-add-before-adjournment">
          <button className="btn-action" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add motion
          </button>
        </div>
      )}

      {adding && (
        <div className="motion" style={{ borderColor: "var(--accent)" }}>
          <Field label="Motion">
            <textarea
              className="textarea"
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="That the board approve the 2024–25 financial statements as presented."
            />
          </Field>
          <div className="row" style={{ gap: 12 }}>
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
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Resolution type">
              <select
                className="input"
                value={draft.resolutionType ?? "Ordinary"}
                onChange={(e) =>
                  setDraft({ ...draft, resolutionType: e.target.value })
                }
              >
                <option value="Ordinary">Ordinary (simple majority)</option>
                <option value="Special">Special (≥ 2⁄3)</option>
                <option value="Unanimous">Unanimous</option>
              </select>
            </Field>
            <Field label="Outcome">
              <OutcomePicker value={draft.outcome} onChange={(v) => setDraft({ ...draft, outcome: v })} />
            </Field>
          </div>
          {agendaSections.length > 0 && (
            <Field label="Agenda item">
              <select
                className="input"
                value={draft.sectionIndex == null ? "" : String(draft.sectionIndex)}
                onChange={(event) => setDraft((current) => ({ ...current, ...motionSectionPatch(event.target.value, agendaSections) }))}
              >
                <option value="">Unassigned</option>
                {agendaSections.map((section, index) => (
                  <option key={index} value={index}>
                    {index + 1}. {agendaSectionTitle(section) || "Untitled section"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
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
          <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
            <button className="btn-action" onClick={() => { setAdding(false); resetDraft(); }}>
              <X size={12} /> Cancel
            </button>
            <button className="btn-action btn-action--primary" onClick={saveDraft} disabled={!draft.text.trim()}>
              <Check size={12} /> Add motion
            </button>
          </div>
        </div>
      )}

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
            onPatch={(diff) => patch(i, diff)}
            onSetVote={(k, n) => setVote(i, k, n)}
            onDelete={() => onChange(motions.filter((_, j) => j !== i))}
          />
        ))}
      </div>
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
  onPatch: (diff: Partial<Motion>) => void;
  onSetVote: (k: "votesFor" | "votesAgainst" | "abstentions", next: number) => void;
  onDelete: () => void;
  onAddToBacklog?: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  const tone =
    motion.outcome === "Carried" ? "success" :
    motion.outcome === "Defeated" ? "danger" :
    motion.outcome === "Pending" ? "warn" : "warn";
  const isPending = motion.outcome === "Pending";
  const thresholdMet = motionMeetsThreshold(motion);
  const movedByLink = resolveMotionPerson(motion.movedBy, people, {
    memberId: motion.movedByMemberId,
    directorId: motion.movedByDirectorId,
  });
  const secondedByLink = resolveMotionPerson(motion.secondedBy, people, {
    memberId: motion.secondedByMemberId,
    directorId: motion.secondedByDirectorId,
  });
  const assignedAgendaLabel = agendaLabelForMotion(motion, agendaSections);
  const selectedAgendaIndex = assignedSectionIndexForMotion(motion, agendaSections);
  // Heuristic: title is "long" when it has more than ~80 chars or contains an
  // unbroken run of >30 non-space chars (URLs, ids, junk strings). When that's
  // the case, the action buttons stack below the title so the title gets the
  // full card width to breathe instead of wrapping inside a narrow column.
  const titleText = motion.text ?? "";
  const isLongTitle =
    titleText.length > 80 ||
    titleText.split(/\s+/).some((word) => word.length > 30);

  return (
    <div
      className="motion"
      style={isPending ? { borderStyle: "dotted", borderColor: "var(--warn)" } : undefined}
    >
      <div className={`motion__head${isLongTitle ? " motion__head--stacked" : ""}`}>
        <div className="motion__head-main">
          <div className="motion__text">{motion.text}</div>
          <div className="motion__meta">
            {!expanded && (motion.movedBy || motion.secondedBy) && (
              // Single span so movedBy + secondedBy stay together as one flex
              // item — when the action column on the right is wide, they stack
              // as a unit instead of each landing on its own line.
              <span>
                {motion.movedBy && (
                  <>Moved by <strong>{movedByLink?.name ?? motion.movedBy}</strong></>
                )}
                {motion.movedBy && motion.secondedBy && " · "}
                {motion.secondedBy && (
                  <>Seconded by <strong>{secondedByLink?.name ?? motion.secondedBy}</strong></>
                )}
              </span>
            )}
            {!expanded && <Badge tone={tone as any}>{motion.outcome}</Badge>}
            {assignedAgendaLabel && !procedural && (
              <Badge tone="neutral">Agenda: {assignedAgendaLabel}</Badge>
            )}
            {thresholdMet != null && (
              <Badge tone={thresholdMet ? "success" : "danger"}>
                {thresholdMet ? "Threshold met" : "Below threshold"}
              </Badge>
            )}
          </div>
        </div>
        <div className="motion__actions">
          <div className="motion__action-strip">
            {isPending && (
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
            <button
              className="btn-action"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Done editing" : "Edit motion"}
            >
              <Pencil size={12} />
              <span className="btn-action__label">{expanded ? "Done" : "Edit"}</span>
            </button>
            <button className="btn-action" onClick={onDelete} title="Remove motion">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      <VoteProgress motion={motion} />

      {expanded && (
        <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
          <Field label="Motion text">
            <textarea className="textarea" value={motion.text} onChange={(e) => onPatch({ text: e.target.value })} />
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
          <div className="row" style={{ gap: 12 }}>
            <Field label="Resolution type">
              <select
                className="input"
                value={motion.resolutionType ?? "Ordinary"}
                onChange={(event) => onPatch({ resolutionType: event.target.value })}
              >
                <option value="Ordinary">Ordinary (simple majority)</option>
                <option value="Special">Special (≥ 2⁄3)</option>
                <option value="Unanimous">Unanimous</option>
              </select>
            </Field>
            <Field label="Outcome">
              <OutcomePicker value={motion.outcome} onChange={(v) => onPatch({ outcome: v })} />
            </Field>
          </div>
          {agendaSections.length > 0 && (
            <Field label="Agenda item">
              <select
                className="input"
                value={selectedAgendaIndex == null ? "" : String(selectedAgendaIndex)}
                onChange={(event) => onPatch(motionSectionPatch(event.target.value, agendaSections))}
              >
                <option value="">Unassigned</option>
                {agendaSections.map((section, index) => (
                  <option key={index} value={index}>
                    {index + 1}. {agendaSectionTitle(section) || "Untitled section"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
            <VoteStepper label="For" value={motion.votesFor ?? 0} onChange={(n) => onSetVote("votesFor", n)} tone="success" />
            <VoteStepper label="Against" value={motion.votesAgainst ?? 0} onChange={(n) => onSetVote("votesAgainst", n)} tone="danger" />
            <VoteStepper label="Abstain" value={motion.abstentions ?? 0} onChange={(n) => onSetVote("abstentions", n)} tone="warn" />
          </div>
        </div>
      )}
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
  if (isAdjournmentMotion(motion)) return false;
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

function agendaSectionSearchText(section: string | MotionAgendaSection) {
  if (typeof section === "string") return section;
  return [section.title, section.discussion ?? "", ...(section.decisions ?? [])].filter(Boolean).join(" ");
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
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  tone: "success" | "danger" | "warn";
}) {
  return (
    <div className="field vote-stepper" style={{ marginBottom: 0 }}>
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
