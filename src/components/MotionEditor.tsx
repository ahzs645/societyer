import { useMemo, useState } from "react";
import { Check, X, Plus, Trash2, MinusCircle, PlusCircle } from "lucide-react";
import { Badge, Field } from "./ui";

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

/** Lightweight director-name autocomplete — uses a native <datalist>.
 * The datalist itself is rendered once at the MotionEditor root (not here) so
 * we don't end up with duplicate IDs in the DOM (invalid, and Chrome/Safari
 * silently drop one of them, which is why autofill "doesn't work"). */
function NameInput({
  value,
  onChange,
  placeholder,
  listId,
}: {
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  listId: string;
}) {
  return (
    <input
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      list={listId}
      autoComplete="off"
      onFocus={(e) => {
        // Chrome only shows suggestions when the value is empty or cleared.
        // Select-all on focus so the user can immediately type to overwrite
        // and see the suggestion dropdown.
        e.currentTarget.select();
      }}
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
    { id: "Pending", label: "Pending", tone: "accent" },
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
  if (total === 0) return null;
  const pct = (n: number) => (n / total) * 100;
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
        For {f} · Against {a} · Abstain {s} · ({total} voting)
      </div>
    </div>
  );
}

export function MotionEditor({
  motions,
  onChange,
  directorNames,
  people = [],
  agendaSections = [],
  onAddToBacklog,
}: {
  motions: Motion[];
  onChange: (next: Motion[]) => void;
  /** Director full names used to autofill movedBy/secondedBy. */
  directorNames: string[];
  people?: MotionPerson[];
  agendaSections?: Array<string | MotionAgendaSection>;
  onAddToBacklog?: (motion: Motion, index: number) => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Motion>({ text: "", outcome: "Pending" });

  const listId = useMemo(() => `dir-list-${Math.random().toString(36).slice(2, 8)}`, []);
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
    setDraft({ text: "", outcome: "Pending" });
    setAdding(false);
  };

  const patch = (idx: number, diff: Partial<Motion>) => {
    const next = motions.map((m, i) => (i === idx ? { ...m, ...diff } : m));
    onChange(next);
  };

  const bumpVote = (idx: number, key: "votesFor" | "votesAgainst" | "abstentions", delta: number) => {
    const current = motions[idx][key] ?? 0;
    patch(idx, { [key]: Math.max(0, current + delta) } as Partial<Motion>);
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
      <datalist id={listId}>
        {nameOptions.map((n) => <option key={n} value={n} />)}
      </datalist>

      {businessMotionRows.length === 0 && !adding && <div className="muted">No business motions recorded yet.</div>}

      {businessMotionRows.map(({ motion: m, index: i }) => (
        <MotionRow
          key={i}
          motion={m}
          listId={listId}
          directorNames={directorNames}
          people={people}
          agendaSections={agendaSections}
          onPatch={(diff) => patch(i, diff)}
          onBumpVote={(k, d) => bumpVote(i, k, d)}
          onDelete={() => onChange(motions.filter((_, j) => j !== i))}
          onAddToBacklog={onAddToBacklog ? () => onAddToBacklog(m, i) : undefined}
        />
      ))}

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
            listId={listId}
            directorNames={directorNames}
            people={people}
            agendaSections={agendaSections}
            procedural
            onPatch={(diff) => patch(i, diff)}
            onBumpVote={(k, d) => bumpVote(i, k, d)}
            onDelete={() => onChange(motions.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      {adding ? (
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
                listId={listId}
                value={draft.movedBy}
                onChange={(v) =>
                  setDraft((current) => ({
                    ...current,
                    movedBy: v,
                    ...motionPersonPatch("movedBy", resolveMotionPerson(v, people)),
                  }))
                }
                placeholder="Start typing…"
              />
            </Field>
            <Field label="Seconded by">
              <NameInput
                listId={listId}
                value={draft.secondedBy}
                onChange={(v) =>
                  setDraft((current) => ({
                    ...current,
                    secondedBy: v,
                    ...motionPersonPatch("secondedBy", resolveMotionPerson(v, people)),
                  }))
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
          <div className="row" style={{ gap: 12 }}>
            <Field label="Votes for">
              <input className="input" type="number" min={0} value={draft.votesFor ?? ""} onChange={(e) => setDraft({ ...draft, votesFor: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Against">
              <input className="input" type="number" min={0} value={draft.votesAgainst ?? ""} onChange={(e) => setDraft({ ...draft, votesAgainst: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Abstain">
              <input className="input" type="number" min={0} value={draft.abstentions ?? ""} onChange={(e) => setDraft({ ...draft, abstentions: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
            <button className="btn-action" onClick={() => { setAdding(false); setDraft({ text: "", outcome: "Pending" }); }}>
              <X size={12} /> Cancel
            </button>
            <button className="btn-action btn-action--primary" onClick={saveDraft} disabled={!draft.text.trim()}>
              <Check size={12} /> Add motion
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <button className="btn-action" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add motion
          </button>
        </div>
      )}
    </div>
  );
}

function MotionRow({
  motion,
  listId,
  directorNames,
  people,
  agendaSections,
  procedural = false,
  onPatch,
  onBumpVote,
  onDelete,
  onAddToBacklog,
}: {
  motion: Motion;
  listId: string;
  directorNames: string[];
  people: MotionPerson[];
  agendaSections: Array<string | MotionAgendaSection>;
  procedural?: boolean;
  onPatch: (diff: Partial<Motion>) => void;
  onBumpVote: (k: "votesFor" | "votesAgainst" | "abstentions", d: number) => void;
  onDelete: () => void;
  onAddToBacklog?: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  const tone =
    motion.outcome === "Carried" ? "success" :
    motion.outcome === "Defeated" ? "danger" :
    motion.outcome === "Pending" ? "accent" : "warn";
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
  const kindLabel =
    motion.resolutionType === "Special"
      ? "Special · ≥ 2⁄3"
      : motion.resolutionType === "Unanimous"
        ? "Unanimous"
        : "Ordinary · majority";
  const assignedAgendaLabel = agendaLabelForMotion(motion, agendaSections);
  const selectedAgendaIndex = assignedSectionIndexForMotion(motion, agendaSections);

  return (
    <div
      className="motion"
      style={isPending ? { borderStyle: "dashed", borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
    >
      <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="motion__text">{motion.text}</div>
          <div className="motion__meta">
            {motion.movedBy && <MotionPersonMeta label="Moved by" value={motion.movedBy} person={movedByLink} />}
            {motion.secondedBy && <MotionPersonMeta label="Seconded by" value={motion.secondedBy} person={secondedByLink} />}
            <Badge tone={tone as any}>{motion.outcome}</Badge>
            <Badge tone="neutral">{procedural ? "Procedural" : kindLabel}</Badge>
            {assignedAgendaLabel && <Badge tone="neutral">{assignedAgendaLabel}</Badge>}
            {thresholdMet != null && (
              <Badge tone={thresholdMet ? "success" : "danger"}>
                {thresholdMet ? "Threshold met" : "Below threshold"}
              </Badge>
            )}
            {(motion.votesFor != null || motion.votesAgainst != null || motion.abstentions != null) && (
              <span>
                For {motion.votesFor ?? 0} · Against {motion.votesAgainst ?? 0} · Abstain {motion.abstentions ?? 0}
              </span>
            )}
          </div>
          <VoteProgress motion={motion} />
        </div>
        <div className="col" style={{ gap: 4, alignItems: "flex-end" }}>
          {isPending && (
            <div className="row" style={{ gap: 4 }}>
              <button
                className="btn-action btn-action--success"
                onClick={() => onPatch({ outcome: "Carried" })}
                title="Record as Carried"
              >
                ✓ Carried
              </button>
              <button
                className="btn-action btn-action--danger"
                onClick={() => onPatch({ outcome: "Defeated" })}
                title="Record as Defeated"
              >
                ✗ Defeated
              </button>
              <button
                className="btn-action btn-action--warn"
                onClick={() => onPatch({ outcome: "Tabled" })}
                title="Table this motion"
              >
                Table
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 4 }}>
            {onAddToBacklog && /^(Tabled|Deferred)$/i.test(motion.outcome) && (
              <button className="btn-action" onClick={onAddToBacklog}>
                Add to backlog
              </button>
            )}
            <button className="btn-action" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Done" : isPending ? "Record vote" : "Edit"}
            </button>
            <button className="btn-action" onClick={onDelete} title="Remove motion">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
          <Field label="Motion text">
            <textarea className="textarea" value={motion.text} onChange={(e) => onPatch({ text: e.target.value })} />
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Moved by">
              <NameInput
                listId={listId}
                value={motion.movedBy}
                onChange={(v) => onPatch({ movedBy: v, ...motionPersonPatch("movedBy", resolveMotionPerson(v, people)) })}
              />
            </Field>
            <Field label="Seconded by">
              <NameInput
                listId={listId}
                value={motion.secondedBy}
                onChange={(v) => onPatch({ secondedBy: v, ...motionPersonPatch("secondedBy", resolveMotionPerson(v, people)) })}
              />
            </Field>
          </div>
          <Field label="Outcome">
            <OutcomePicker value={motion.outcome} onChange={(v) => onPatch({ outcome: v })} />
          </Field>
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
            <VoteStepper label="For" value={motion.votesFor ?? 0} onBump={(d) => onBumpVote("votesFor", d)} tone="success" />
            <VoteStepper label="Against" value={motion.votesAgainst ?? 0} onBump={(d) => onBumpVote("votesAgainst", d)} tone="danger" />
            <VoteStepper label="Abstain" value={motion.abstentions ?? 0} onBump={(d) => onBumpVote("abstentions", d)} tone="warn" />
          </div>
        </div>
      )}
    </div>
  );
}

function MotionPersonMeta({
  label,
  value,
  person,
}: {
  label: string;
  value: string;
  person: MotionPerson | null;
}) {
  return (
    <span>
      {label} <strong>{person?.name ?? value}</strong>
    </span>
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
  onBump,
  tone,
}: {
  label: string;
  value: number;
  onBump: (delta: number) => void;
  tone: "success" | "danger" | "warn";
}) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="field__label" style={{ color: `var(--${tone})` }}>{label}</label>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn-action btn-action--icon" onClick={() => onBump(-1)} aria-label={`Decrease ${label}`}>
          <MinusCircle size={12} />
        </button>
        <div
          className="mono"
          style={{
            minWidth: 36, textAlign: "center",
            padding: "2px 0",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
        <button className="btn-action btn-action--icon" onClick={() => onBump(1)} aria-label={`Increase ${label}`}>
          <PlusCircle size={12} />
        </button>
      </div>
    </div>
  );
}
