import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../components/Modal";
import { Badge, Banner, Field } from "../../components/ui";
import { formatDate, pluralize } from "../../lib/format";
import { GAP_REASONS, GAP_REASON_LABELS, INFO_TYPES } from "../../../shared/gapCatalog";
import { defaultInfoTypeForPath } from "../../../shared/intake/promotion";
import { formatFieldValue, nativeTargetForPath, samplePreview, thresholdFor, type Readiness, type ReviewField } from "../../../shared/intake/review";
import { locatorLabel } from "./FieldPanel";

/** Bulk accept: verified, stated, non-conflicting fields at or above τ, with a sampled preview of five. */
export function BulkAcceptModal({ open, onClose, onConfirm, candidates, docClass, scopeLabel, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; candidates: ReviewField[]; docClass: string; scopeLabel: string; busy: boolean }) {
  const sample = useMemo(() => samplePreview(candidates, 5), [candidates]);
  const thresholds = useMemo(() => {
    const map = new Map<string, number>();
    for (const field of candidates) map.set(field.label, thresholdFor(docClass, field.pattern));
    return [...map.entries()].slice(0, 8);
  }, [candidates, docClass]);
  return (
    <Modal open={open} onClose={onClose} title={`Bulk accept ${scopeLabel}`} size="md"
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--accent" onClick={onConfirm} disabled={!candidates.length || busy} data-testid="intake-bulk-confirm">Accept {pluralize(candidates.length, "field")}</button>
      </>}>
      {!candidates.length && <p className="muted">No unreviewed field qualifies: bulk accept takes only values the source states, whose quote was re-found in the source, that are not in conflict, and whose confidence meets the threshold.</p>}
      {candidates.length > 0 && (
        <>
          <p style={{ marginTop: 0 }}>{pluralize(candidates.length, "field")} are <strong>stated</strong>, have a <strong>verified source span</strong>, are <strong>not conflicting</strong> and meet the confidence threshold. You can undo for a few seconds afterwards.</p>
          <p className="muted" style={{ fontSize: 12 }}>Thresholds: {thresholds.map(([label, value]) => `${label} ≥ ${Math.round(value * 100)}%`).join(" · ")}</p>
          <strong style={{ fontSize: 12 }}>Sample of {sample.length}</strong>
          <ul className="intake-sample" data-testid="intake-bulk-sample">
            {sample.map((field) => (
              <li key={field.path}>
                <div><span className="muted">{field.label}</span> · <strong>{formatFieldValue(field.field.value, field.kind)}</strong> <span className="intake-chip intake-chip--high">{Math.round(field.field.confidence * 100)}%</span> <span className="muted mono" style={{ fontSize: 10 }}>{locatorLabel(field.field.locators[0])}</span></div>
                {field.field.locators[0]?.quote && <blockquote>“{field.field.locators[0].quote}”</blockquote>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

export type CantRepresentDraft = { infoType: string; reason: string; description: string; suggestedTarget: string };

/** "Can't represent": records a typed representation gap (system gap) for the field. */
export function CantRepresentModal({ field, onClose, onConfirm }: { field: ReviewField | null; onClose: () => void; onConfirm: (draft: CantRepresentDraft) => void }) {
  const [draft, setDraft] = useState<CantRepresentDraft>({ infoType: "other", reason: "no_schema_field", description: "", suggestedTarget: "" });
  useEffect(() => {
    if (!field) return;
    const target = nativeTargetForPath(field.path);
    setDraft({
      infoType: defaultInfoTypeForPath(field.path),
      reason: "no_schema_field",
      description: `${field.label}: "${formatFieldValue(field.field.value, field.kind)}" cannot be recorded natively.`,
      suggestedTarget: target ? `${target.table}.${target.field.split(".")[0]}` : "",
    });
  }, [field]);
  const groups = useMemo(() => {
    const byArea = new Map<string, typeof INFO_TYPES[number][]>();
    for (const type of INFO_TYPES) byArea.set(type.area, [...(byArea.get(type.area) ?? []), type]);
    return [...byArea.entries()];
  }, []);
  return (
    <Modal open={Boolean(field)} onClose={onClose} title="The app can't represent this" size="md"
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--accent" disabled={!draft.description.trim()} onClick={() => onConfirm(draft)}>Record system gap</button>
      </>}>
      {field && (
        <div className="col" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0 }}>The fact stays out of the native record and is tracked in Coverage & gaps (system gaps) with its source locator, so the backlog shows what the data model is missing.</p>
          {field.field.locators[0]?.quote && <blockquote className="coverage-excerpt">“{field.field.locators[0].quote}”</blockquote>}
          <Field label="Information type">
            <select className="input" value={draft.infoType} onChange={(event) => setDraft({ ...draft, infoType: event.target.value })}>
              {groups.map(([area, types]) => <optgroup key={area} label={area}>{types.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</optgroup>)}
            </select>
          </Field>
          <Field label="Why">
            <select className="input" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })}>
              {GAP_REASONS.map((reason) => <option key={reason} value={reason}>{GAP_REASON_LABELS[reason]}</option>)}
            </select>
          </Field>
          <Field label="What cannot be represented" required>
            <textarea className="input" rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </Field>
          <Field label="Suggested native target" hint="table.field the app would need, e.g. minutes.quorumPresentCount">
            <input className="input mono" value={draft.suggestedTarget} onChange={(event) => setDraft({ ...draft, suggestedTarget: event.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export type PromoteChoice = { mode: "auto" | "new" | "merge"; targetMeetingId?: string };

/** Promote: readiness, what happens to unreviewed fields and gaps, and where the record goes (new or merged). */
export function PromoteModal({ open, onClose, onConfirm, societyId, extractionId, readiness, unsupported, gapsRecorded, busy, storeNote }: {
  open: boolean; onClose: () => void; onConfirm: (choice: PromoteChoice) => void; societyId: string; extractionId: string; readiness: Readiness; unsupported: number; gapsRecorded: number; busy: boolean; storeNote: string;
}) {
  const merge = useQuery(api.intake.mergeCandidates, open ? { societyId, extractionId } : "skip") as { date?: string; candidates: any[] } | undefined;
  const [choice, setChoice] = useState<string>("auto");
  useEffect(() => {
    if (!merge) return;
    const sameBody = merge.candidates.find((candidate) => candidate.sameBody && !candidate.minutesApproved);
    setChoice(sameBody ? `merge:${sameBody.meetingId}` : "auto");
  }, [merge]);
  const confirm = () => {
    if (choice.startsWith("merge:")) onConfirm({ mode: "merge", targetMeetingId: choice.slice(6) });
    else onConfirm({ mode: choice === "new" ? "new" : "auto" });
  };
  return (
    <Modal open={open} onClose={onClose} title="Promote to native records" size="md"
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--accent" onClick={confirm} disabled={!readiness.ready || busy} data-testid="intake-promote-confirm">{busy ? "Promoting…" : "Promote"}</button>
      </>}>
      <div className="col" style={{ gap: 10 }}>
        {!readiness.ready && <Banner tone="warn">{[...readiness.missing.map((label) => `Accept the ${label.toLowerCase()}.`), ...readiness.problems].join(" ")}</Banner>}
        <p style={{ margin: 0 }}>
          {pluralize(readiness.promoted, "accepted field")} will be written through the import path, each with a source locator (shown as <em>View source</em> on the record).
          {readiness.unreviewed > 0 && <> <strong>{pluralize(readiness.unreviewed, "unreviewed field")}</strong> and {pluralize(readiness.rejected, "rejected field")} will not be promoted.</>}
          {(unsupported + gapsRecorded) > 0 && <> {pluralize(unsupported + gapsRecorded, "system gap")} will be linked to the meeting.</>}
        </p>
        <fieldset className="intake-llm" style={{ gap: 6 }}>
          <legend>Meeting record</legend>
          {!merge && <span className="muted">Looking for existing meetings on this date…</span>}
          {merge && (
            <>
              <label className="intake-check"><input type="radio" name="promote-mode" checked={choice === "auto"} onChange={() => setChoice("auto")} /> Create the meeting, or merge into one with the same date and body</label>
              {merge.candidates.map((candidate) => (
                <label key={candidate.meetingId} className="intake-check">
                  <input type="radio" name="promote-mode" checked={choice === `merge:${candidate.meetingId}`} disabled={candidate.minutesApproved} onChange={() => setChoice(`merge:${candidate.meetingId}`)} />
                  <span>
                    Merge into <Link to={`/app/meetings/${candidate.meetingId}`} target="_blank">{candidate.title}</Link> <span className="muted">({formatDate(candidate.scheduledAt)}{candidate.committeeName ? ` · ${candidate.committeeName}` : ` · ${candidate.type}`})</span>
                    {" "}{candidate.sameBody ? <Badge tone="success">same body</Badge> : <Badge tone="warn">different body</Badge>}
                    {!candidate.hasMinutes && <Badge>no minutes yet</Badge>}
                    {candidate.minutesApproved && <Badge tone="danger">minutes approved</Badge>}
                    {candidate.alreadyHasThisSource && <Badge tone="info">already cites this file</Badge>}
                    <div className="muted" style={{ fontSize: 11 }}>Merging fills blank fields and appends new motions; approved minutes are never changed.</div>
                  </span>
                </label>
              ))}
              <label className="intake-check"><input type="radio" name="promote-mode" checked={choice === "new"} onChange={() => setChoice("new")} /> Create a separate meeting even if one exists</label>
            </>
          )}
        </fieldset>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>{storeNote}</p>
      </div>
    </Modal>
  );
}
