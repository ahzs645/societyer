import { useEffect, useRef, useState } from "react";
import { Ban, Check, CheckCheck, Pencil, ShieldCheck, ShieldQuestion, ShieldX, X } from "lucide-react";
import {
  datePrecisionOf, emptyValueFor, formatFieldValue, isPromotedDecision, thresholdFor, validateEditedValue,
  type FieldKind, type ReviewField, type ReviewGroup, type ReviewRow,
} from "../../../shared/intake/review";

export type FieldDecisionHandler = (field: ReviewField, decision: "accept" | "edit" | "reject" | "cant_represent", editedValue?: unknown) => void;

const GROUP_LABELS: Record<ReviewGroup, string> = { meeting: "Meeting", quorum: "Quorum", attendance: "Attendance", motions: "Motions", actionItems: "Action items", sections: "Agenda sections", decisions: "Decisions", other: "Other details" };
const ITEM_LABELS: Partial<Record<ReviewGroup, string>> = { attendance: "Attendee", motions: "Motion", actionItems: "Action", sections: "Section", decisions: "Decision" };

export function locatorLabel(locator: any): string {
  if (!locator) return "";
  return [locator.page ? `p${locator.page}` : "", locator.blockIndex !== undefined ? `b${locator.blockIndex}` : "", locator.sheet ? locator.sheet : "", locator.cell ?? "", locator.kind === "filename" ? "file name" : ""].filter(Boolean).join(" · ") || locator.kind;
}

function confidenceTone(confidence: number, threshold: number) {
  if (confidence >= threshold) return "high";
  if (confidence >= threshold - 0.2) return "mid";
  return "low";
}

const VERIFY: Record<string, { icon: typeof ShieldCheck; label: string }> = {
  verified_span: { icon: ShieldCheck, label: "Quote re-found exactly in the source" },
  verified_fuzzy: { icon: ShieldCheck, label: "Quote re-found (whitespace/case normalised)" },
  span_mismatch: { icon: ShieldX, label: "Quote NOT found in the source — check carefully" },
  no_quote: { icon: ShieldQuestion, label: "No quote to verify" },
  invalid: { icon: ShieldX, label: "Locator is invalid" },
};

/** Grouped native-target form: each field's value, confidence, status, verification and locator, with per-field decisions. */
export function FieldList({ docClass, fields, decisions, selectedPath, onSelect, onDecide, onBulkItem, readOnly }: {
  docClass: string;
  fields: ReviewField[];
  decisions: Map<string, ReviewRow>;
  selectedPath?: string;
  onSelect: (field: ReviewField) => void;
  onDecide: FieldDecisionHandler;
  onBulkItem: (group: ReviewGroup, itemIndex?: number) => void;
  readOnly: boolean;
}) {
  const groups = new Map<ReviewGroup, ReviewField[]>();
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return (
    <div className="intake-fields" data-testid="intake-fields">
      {[...groups.entries()].map(([group, groupFields]) => {
        const items = new Map<number | "none", ReviewField[]>();
        for (const field of groupFields) items.set(field.itemIndex ?? "none", [...(items.get(field.itemIndex ?? "none") ?? []), field]);
        const decided = groupFields.filter((field) => decisions.has(field.path)).length;
        const itemCount = [...items.keys()].filter((key) => key !== "none").length;
        return (
          <details key={group} className="intake-group" open={group !== "sections" || groupFields.length < 30}>
            <summary>
              {GROUP_LABELS[group]}{itemCount ? ` (${itemCount})` : ""}
              <span className="muted" style={{ fontWeight: 400 }}>{decided}/{groupFields.length} reviewed</span>
              {!readOnly && <button type="button" className="btn btn--sm btn--ghost" style={{ marginLeft: "auto" }} onClick={(event) => { event.preventDefault(); onBulkItem(group); }} title={`Bulk accept verified ${GROUP_LABELS[group].toLowerCase()} fields`}><CheckCheck size={12} /> Accept verified</button>}
            </summary>
            <div className="intake-group__items">
              {[...items.entries()].map(([itemIndex, itemFields]) => (
                <div key={String(itemIndex)} className="intake-item">
                  {itemIndex !== "none" && ITEM_LABELS[group] && (
                    <div className="intake-item__title">
                      {ITEM_LABELS[group]} {Number(itemIndex) + 1}
                      {!readOnly && <button type="button" className="btn btn--sm btn--ghost" onClick={() => onBulkItem(group, Number(itemIndex))} title="Bulk accept this item's verified fields"><CheckCheck size={11} /></button>}
                    </div>
                  )}
                  {itemFields.map((field) => (
                    <FieldRow key={field.path} docClass={docClass} field={field} review={decisions.get(field.path)} selected={field.path === selectedPath} onSelect={onSelect} onDecide={onDecide} readOnly={readOnly} />
                  ))}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

const DECISION_LABEL: Record<string, string> = { accept: "Accepted", edit: "Edited", reject: "Rejected", cant_represent: "Can't represent" };

function FieldRow({ docClass, field, review, selected, onSelect, onDecide, readOnly }: { docClass: string; field: ReviewField; review?: ReviewRow; selected: boolean; onSelect: (field: ReviewField) => void; onDecide: FieldDecisionHandler; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEffect(() => {
    const open = () => setEditing(true);
    const element = row.current;
    element?.addEventListener("intake:edit", open);
    return () => element?.removeEventListener("intake:edit", open);
  }, []);
  const value = field.field.value;
  const threshold = thresholdFor(docClass, field.pattern);
  const tone = confidenceTone(field.field.confidence, threshold);
  const verify = field.field.verification ? VERIFY[field.field.verification] : undefined;
  const VerifyIcon = verify?.icon;
  const locator = field.field.locators?.[0];
  const decision = review?.decision;
  const shown = decision === "edit" ? review?.editedValue : value;
  return (
    <div
      ref={row}
      className="intake-field"
      data-selected={selected}
      data-decision={decision}
      data-path={field.path}
      data-testid="intake-field"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
        onSelect(field);
      }}
    >
      <div className="intake-field__label">
        <span>{field.label}{field.required && <span aria-label="required"> *</span>}</span>
        {decision && <span className={`intake-chip ${isPromotedDecision(decision) ? "intake-chip--high" : decision === "reject" ? "intake-chip--low" : "intake-chip--mid"}`}>{DECISION_LABEL[decision] ?? decision}</span>}
      </div>
      <div className={`intake-field__value${shown === undefined || shown === null || shown === "" ? " intake-field__value--empty" : ""}`} title={field.field.note}>
        {field.field.status === "not_stated" && shown === undefined ? "Not stated" : formatFieldValue(shown, field.kind)}
        {decision === "edit" && <> <del title="Extracted value">{formatFieldValue(value, field.kind)}</del></>}
      </div>
      {!readOnly && (
        <div className="intake-field__actions" role="group" aria-label={`${field.label} decision`}>
          <button type="button" className="btn btn--sm btn--ghost" aria-label={`Accept ${field.label}`} title="Accept (A)" aria-pressed={decision === "accept"} onClick={() => onDecide(field, "accept")} disabled={value === undefined}><Check size={13} /></button>
          <button type="button" className="btn btn--sm btn--ghost" aria-label={`Edit ${field.label}`} title="Edit (E) — the original value and locator are kept" onClick={() => { onSelect(field); setEditing((open) => !open); }}><Pencil size={12} /></button>
          <button type="button" className="btn btn--sm btn--ghost" aria-label={`Reject ${field.label}`} title="Reject (R)" aria-pressed={decision === "reject"} onClick={() => onDecide(field, "reject")}><X size={13} /></button>
          <button type="button" className="btn btn--sm btn--ghost" aria-label={`${field.label}: can't represent`} title="Can't represent (C) — records a system gap" aria-pressed={decision === "cant_represent"} onClick={() => onDecide(field, "cant_represent")}><Ban size={12} /></button>
        </div>
      )}
      <div className="intake-field__meta">
        <span className={`intake-chip intake-chip--${tone}`} title={`Confidence ${Math.round(field.field.confidence * 100)}% (bulk-accept threshold ${Math.round(threshold * 100)}%)`}>{Math.round(field.field.confidence * 100)}%</span>
        <span className={`intake-chip intake-chip--${field.field.status === "conflicting" ? "conflicting" : field.field.status === "inferred" ? "inferred" : "stated"}`}>{field.field.status.replace(/_/g, " ")}</span>
        {VerifyIcon && <span title={verify!.label} aria-label={verify!.label} style={{ display: "inline-flex", color: field.field.verification === "span_mismatch" || field.field.verification === "invalid" ? "var(--danger)" : "var(--success)" }}><VerifyIcon size={12} /></span>}
        {locator && <button type="button" className="intake-locator" onClick={() => onSelect(field)} title={locator.quote ? `“${locator.quote}”` : undefined}>{locatorLabel(locator)}</button>}
        {field.field.locators.length > 1 && <span className="muted">+{field.field.locators.length - 1}</span>}
      </div>
      {editing && !readOnly && (
        <FieldEditor
          field={field}
          initial={decision === "edit" ? review?.editedValue : value}
          onCancel={() => setEditing(false)}
          onSave={(next) => { setEditing(false); onDecide(field, "edit", next); }}
        />
      )}
    </div>
  );
}

/** Kind-aware editor; the saved value replaces the extracted one on promotion (the original and locator stay in the review). */
function FieldEditor({ field, initial, onSave, onCancel }: { field: ReviewField; initial: unknown; onSave: (value: unknown) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<any>(() => (initial === undefined || initial === null ? emptyValueFor(field.kind) : structuredClone(initial)));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);
  const save = () => {
    let value: unknown = draft;
    if (field.kind === "json") {
      try {
        value = JSON.parse(jsonText);
      } catch {
        setError("Enter valid JSON.");
        return;
      }
    }
    if (field.kind === "date") value = { ...(draft ?? {}), iso: String(draft?.iso ?? "").trim(), precision: datePrecisionOf(String(draft?.iso ?? "").trim()) };
    const problem = validateEditedValue(field.kind as FieldKind, value);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(value);
  };
  const id = `edit-${field.path.replace(/[^a-z0-9]/gi, "-")}`;
  const set = (patch: Record<string, unknown>) => setDraft((current: any) => ({ ...(current ?? {}), ...patch }));
  return (
    <form className="intake-field__editor" onSubmit={(event) => { event.preventDefault(); save(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
      {(field.kind === "text") && <input ref={first} id={id} className="input" aria-label={field.label} value={String(draft ?? "")} onChange={(event) => setDraft(event.target.value)} />}
      {field.kind === "longtext" && <textarea ref={first} id={id} className="input" aria-label={field.label} rows={3} value={String(draft ?? "")} onChange={(event) => setDraft(event.target.value)} />}
      {field.kind === "time" && <input ref={first} id={id} className="input" type="time" aria-label={field.label} value={String(draft ?? "")} onChange={(event) => setDraft(event.target.value)} />}
      {field.kind === "number" && <input ref={first} id={id} className="input" type="number" min={0} step={1} aria-label={field.label} value={draft ?? ""} onChange={(event) => setDraft(event.target.value === "" ? undefined : Number(event.target.value))} />}
      {field.kind === "boolean" && (
        <select ref={first} id={id} className="input" aria-label={field.label} value={draft ? "yes" : "no"} onChange={(event) => setDraft(event.target.value === "yes")}>
          <option value="yes">Yes</option><option value="no">No</option>
        </select>
      )}
      {field.kind === "enum" && (
        <select ref={first} id={id} className="input" aria-label={field.label} value={String(draft ?? "")} onChange={(event) => setDraft(event.target.value)}>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}
        </select>
      )}
      {field.kind === "date" && <input ref={first} id={id} className="input" aria-label={`${field.label} (YYYY-MM-DD)`} placeholder="YYYY-MM-DD" value={String(draft?.iso ?? "")} onChange={(event) => set({ iso: event.target.value })} />}
      {field.kind === "person" && (
        <div className="row">
          <input ref={first} className="input" aria-label="Name as written" placeholder="Name as written" value={String(draft?.nameAsWritten ?? "")} onChange={(event) => set({ nameAsWritten: event.target.value })} />
          <input className="input" aria-label="Full name (resolved)" placeholder="Full name (optional)" value={String(draft?.resolvedName ?? "")} onChange={(event) => set({ resolvedName: event.target.value || undefined })} />
        </div>
      )}
      {field.kind === "votes" && (
        <div className="row">
          {(["for", "against", "abstain"] as const).map((key, index) => (
            <label key={key} className="col" style={{ fontSize: 11, gap: 2 }}>{key}
              <input ref={index === 0 ? first : undefined} className="input" type="number" min={0} style={{ width: 80 }} value={draft?.[key] ?? ""} onChange={(event) => set({ [key]: event.target.value === "" ? undefined : Number(event.target.value) })} />
            </label>
          ))}
        </div>
      )}
      {(field.kind === "nextMeeting" || field.kind === "adoptsMinutes") && (
        <div className="col" style={{ gap: 6 }}>
          <input ref={first} className="input" aria-label="As written" placeholder="As written" value={String(draft?.text ?? "")} onChange={(event) => set({ text: event.target.value })} />
          <div className="row">
            <input className="input" aria-label="Date (YYYY-MM-DD)" placeholder="YYYY-MM-DD" value={String(draft?.date ?? "")} onChange={(event) => set({ date: event.target.value || undefined })} />
            {field.kind === "nextMeeting" && <input className="input" type="time" aria-label="Time" value={String(draft?.time ?? "")} onChange={(event) => set({ time: event.target.value || undefined })} />}
            {field.kind === "nextMeeting" && <input className="input" aria-label="Location" placeholder="Location" value={String(draft?.location ?? "")} onChange={(event) => set({ location: event.target.value || undefined })} />}
          </div>
        </div>
      )}
      {field.kind === "json" && <textarea ref={first} className="input mono" rows={4} aria-label={field.label} value={jsonText} onChange={(event) => setJsonText(event.target.value)} />}
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
      <div className="row">
        <button type="submit" className="btn btn--sm btn--accent">Save edit</button>
        <button type="button" className="btn btn--sm" onClick={onCancel}>Cancel</button>
        <span className="muted" style={{ fontSize: 11 }}>The extracted value and its locator are kept.</span>
      </div>
    </form>
  );
}
