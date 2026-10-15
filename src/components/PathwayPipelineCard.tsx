import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Field } from "./ui";
import { Checkbox } from "./Controls";
import { Select } from "./Select";
import { useToast } from "./Toast";
import { formatDate, formatDateTime } from "../lib/format";

type InputValue = string | number | boolean;
type InputField = { key: string; label: string; type: "text" | "boolean" | "select" | "number"; required?: boolean; options?: { value: string; label: string }[] };
const STATE_LABEL: Record<string, string> = { ready: "Ready", blocked: "Waiting", skipped: "Branch skipped", completed: "Completed", approved: "Approved", rejected: "Review rejected", queued: "Handoff queued", manual_required: "Human filing required", submitted: "Submission recorded" };

/** Persisted graph state and action rights come from the backend, including branches and review separation. */
export function PathwayPipelineCard({ societyId }: { societyId: string }) {
  const data = useQuery((api as any).pathways.status, { societyId }) as any;
  const start = useMutation((api as any).pathways.start);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (data === undefined) return <section className="card" style={{ padding: 16, marginBottom: 20 }} aria-busy="true">Loading saved pathway…</section>;
  const pathway = data.pathway;
  const runs = data.runs ?? [];
  const run = runs.find((entry: any) => entry._id === selectedId) ?? runs[0];
  const startRun = async () => {
    setBusy(true);
    try { setSelectedId(String(await start({ societyId }))); toast.success("Pathway started", "This run keeps its own pathway version and evidence history."); }
    catch (error: any) { toast.error("Could not start pathway", error?.message ?? String(error)); }
    finally { setBusy(false); }
  };
  return <section className="card" style={{ padding: 16, marginBottom: 20 }} aria-label="Saved incorporation pathway">
    <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><h2 style={{ fontSize: 16, margin: "0 0 6px" }}>Saved incorporation pathway</h2><div className="muted">{pathway?.title ?? "No supported pathway"}</div></div>
      {data.canStart && <button className="btn btn--sm" disabled={busy} onClick={startRun}>{busy ? "Starting…" : runs.length ? "Start new pathway run" : "Start pathway"}</button>}
    </div>
    <p className="muted">{pathway?.message ?? data.message ?? "Confirm the entity route on the organization profile before starting."}</p>
    {!run && <p className="muted">{data.canStart ? "Start a run to save inputs, attach documents and request an independent review." : "A permitted workspace member can start a supported preparation pathway."}</p>}
    {runs.length > 1 && <Field label="Resume saved run"><Select value={run?._id ?? ""} onChange={setSelectedId} options={runs.map((entry: any) => ({ value: entry._id, label: `${entry.pathwayTitle ?? entry.pathwayKey} · ${entry.createdAtISO?.slice(0, 10) ?? "saved"} · ${entry.status}` }))} /></Field>}
    {run && <PipelineRun key={run._id} run={run} data={data} societyId={societyId} />}
  </section>;
}

type WorkspaceSource = { kind: "workspace"; source: string; label: string; href: string };
type InputSource = WorkspaceSource | { kind: "user" };
type WorkspaceDefault = WorkspaceSource & { value: InputValue };

const AUDIT_LABEL: Record<string, string> = {
  "run.started": "Pathway started",
  "inputs.saved": "Inputs saved",
  "inputs.frozen": "Inputs saved with the run, including values from your workspace",
  "step.evidence-recorded": "Step completed",
  "review.approved": "Review approved",
  "review.self-approved": "Reviewed by the person who prepared it (no one else could review)",
  "review.rejected": "Review sent back",
  "review.self-rejected": "Sent back by the person who prepared it (no one else could review)",
  "submission.manual-handoff": "Filing handoff recorded",
  "submission.manual-receipt-attested": "Filing receipt recorded",
};

const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** "From your workspace" with the register the value came from. */
function WorkspaceSourceNote({ source, onReset, resetLabel }: { source?: InputSource; onReset?: () => void; resetLabel?: string }) {
  if (source?.kind === "workspace") {
    return <div className="pathway-input__source">
      <Badge tone="info">From your workspace</Badge>
      <Link className="setup-inline-link" to={source.href}>{source.label}</Link>
    </div>;
  }
  if (onReset) {
    return <div className="pathway-input__source">
      <span className="muted">Typed here</span>
      <button type="button" className="pathway-input__reset" onClick={onReset}>{resetLabel ?? "Use the workspace value"}</button>
    </div>;
  }
  return null;
}

function PipelineRun({ run, data, societyId }: { run: any; data: any; societyId: string }) {
  const saveInput = useMutation((api as any).pathways.saveInput);
  const complete = useMutation((api as any).pathways.completeStep);
  const approve = useMutation((api as any).pathways.approve);
  const reject = useMutation((api as any).pathways.reject);
  const submit = useMutation((api as any).pathways.requestSubmission);
  const recordReceipt = useMutation((api as any).pathways.recordManualReceipt);
  const documents = useQuery(api.documents.list, { societyId }) as any[] | undefined;
  // Only what the user typed in this run; everything else follows the workspace.
  const savedInputsJson = JSON.stringify(run.inputsFrozen ? run.inputs ?? {} : run.savedInputs ?? run.inputs ?? {});
  const [edits, setEdits] = useState<Record<string, InputValue>>(() => JSON.parse(savedInputsJson));
  const [drafts, setDrafts] = useState<Record<string, { documentId?: string; notes?: string; reference?: string; confirmSelfReview?: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { setEdits(JSON.parse(savedInputsJson)); }, [run._id, savedInputsJson]);
  const fields: InputField[] = run.graph?.inputFields ?? data.pathway?.pipeline?.inputFields ?? [];
  const nodes: any[] = run.nodes ?? [];
  const defaults: Record<string, WorkspaceDefault> = run.inputsFrozen ? {} : run.workspaceDefaults ?? {};
  const frozenSources: Record<string, InputSource> = run.inputSources ?? {};
  const valueOf = (key: string): InputValue | undefined => run.inputsFrozen ? run.inputs?.[key] : hasOwn(edits, key) ? edits[key] : defaults[key]?.value;
  const sourceOf = (key: string): InputSource | undefined => run.inputsFrozen ? frozenSources[key] : hasOwn(edits, key) ? { kind: "user" } : defaults[key] ? defaults[key] : undefined;
  const dirty = JSON.stringify(edits) !== savedInputsJson;
  const missing = fields.filter((field) => field.required && (valueOf(field.key) === undefined || valueOf(field.key) === ""));
  const update = (key: string, value: InputValue | undefined) => setEdits((current) => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; });
  const resetToWorkspace = (key: string) => setEdits((current) => { const next = { ...current }; delete next[key]; return next; });
  const updateDraft = (key: string, value: object) => setDrafts((current) => ({ ...current, [key]: { ...current[key], ...value } }));
  const act = async (key: string, operation: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try { await operation(); toast.success(message); }
    catch (error: any) { toast.error("Pathway action failed", error?.message ?? String(error)); }
    finally { setBusy(null); }
  };
  const evidenceOptions = [{ value: "", label: "Select a workspace document" }, ...(documents ?? []).map((document) => ({ value: document._id, label: document.title }))];
  const prefilled = fields.filter((field) => sourceOf(field.key)?.kind === "workspace").length;
  const editable = !run.inputsFrozen && data.canAdvance && !busy;
  const confirmation: string = data.selfReviewConfirmation ?? "No one else can review this; I've checked it myself";
  return <div data-testid="pathway-run">
    <p className="muted" title={`Pathway version ${run.pathwayVersion}`}>Status: {run.status}. Completing this preparation doesn't confirm incorporation.</p>
    {run.message && <p role="status">{run.message}</p>}
    <details open>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Pathway inputs {run.inputsFrozen ? "— saved and frozen" : "— save before completing a step"}</summary>
      <div style={{ marginTop: 12 }}>
        {prefilled > 0 && !run.inputsFrozen && <p className="muted pathway-inputs__intro">Filled in from your workspace where it already has the answer. Change anything here; edits stay in this run and don't change your records.</p>}
        {fields.map((field) => {
          const value = valueOf(field.key);
          const source = sourceOf(field.key);
          const fallback = defaults[field.key];
          const canReset = !run.inputsFrozen && source?.kind === "user" && fallback !== undefined && edits[field.key] !== fallback.value;
          return <div key={field.key} className="pathway-input" data-testid={`pathway-input-${field.key}`} data-source={source?.kind ?? "none"}>
            <Field label={field.label} hint={field.required ? "Required" : "Optional"}>
              {field.type === "boolean" ? <Select aria-label={field.label} value={value === undefined ? "" : String(value)} onChange={(next) => update(field.key, next === "true")} options={[{ value: "", label: "Choose an option", disabled: true }, { value: "true", label: "Yes" }, { value: "false", label: "No" }]} disabled={!editable} /> : field.type === "select" ? <Select aria-label={field.label} value={String(value ?? "")} onChange={(next) => update(field.key, next || undefined)} options={[{ value: "", label: "Choose an option" }, ...(field.options ?? [])]} disabled={!editable} /> : <input aria-label={field.label} className="input" type={field.type === "number" ? "number" : "text"} value={String(value ?? "")} disabled={!editable} onChange={(event) => { if (field.type === "number") update(field.key, event.target.value === "" ? undefined : Number(event.target.value)); else update(field.key, event.target.value); }} />}
            </Field>
            <WorkspaceSourceNote source={source} onReset={canReset && editable ? () => resetToWorkspace(field.key) : undefined} resetLabel={fallback ? `Use the value from ${fallback.label.toLowerCase()}` : undefined} />
          </div>;
        })}
        {run.inputsFrozen ? <p className="muted">Inputs froze when this run first advanced. Start a new run to change the preparation facts; the earlier evidence and review remain in this run.</p> : <button className="btn btn--sm" disabled={!data.canAdvance || !!busy || !dirty} onClick={() => act("inputs", () => saveInput({ runId: run._id, inputs: edits }), "Pathway inputs saved")}>Save pathway inputs</button>}
        {missing.length > 0 && !run.inputsFrozen && <p className="muted">Complete all required inputs before advancing.</p>}
      </div>
    </details>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      {nodes.map((node) => {
        const draft = drafts[node.key] ?? {};
        const actionable = node.canComplete || node.canApprove || node.canReject || node.canSelfReview;
        const capacity = (data.submissionCapabilities ?? []).find((entry: any) => entry.adapterId === node.submission?.adapterId);
        const receipt = (run.submissions ?? []).find((entry: any) => entry.stepKey === node.key);
        const params = { runId: run._id, nodeKey: node.key, notes: draft.notes || undefined };
        const disabled = !!busy || dirty || missing.length > 0;
        const fourEyes = node.kind === "approval" && node.approval?.distinctInitiator !== false;
        return <article key={node.key} className="card" style={{ padding: 12 }} data-testid={`pathway-node-${node.key}`}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}><strong>{node.title}</strong><Badge tone={node.state === "approved" || node.state === "completed" ? "success" : node.state === "rejected" ? "warn" : "neutral"}>{STATE_LABEL[node.state] ?? node.state}</Badge></div>
          <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            {node.dependsOn?.length > 0 && <div>Depends on: {node.dependsOn.map((key: string) => nodes.find((entry) => entry.key === key)?.title ?? key).join("; ")}. Skipped branches do not require completion.</div>}
            {node.condition && <div>Branch: {fields.find((field) => field.key === node.condition.field)?.label ?? node.condition.field} {node.condition.operator.replaceAll("_", " ")}{node.condition.value !== undefined ? ` ${JSON.stringify(node.condition.value)}` : ""}.</div>}
            {node.blockedReason && <div>{node.blockedReason}</div>}
            {node.documentId && <div>Evidence: {documents?.find((document) => document._id === node.documentId)?.title ?? "Attached permitted document"}</div>}
            {node.notes && <div>Recorded notes: {node.notes}</div>}
            {node.kind === "approval" && !node.selfReview && <div>{!fourEyes ? "Needs someone who can edit documents." : node.independentReviewerAvailable === false ? "A second person normally reviews this. No one else in this workspace can, so the person who started this run may review it and record that." : "Needs a second person who can edit documents, not the person who started this run."}</div>}
          </div>
          {node.selfReview && <div className="pathway-self-review__record" data-testid="pathway-self-review-record">
            <p><strong>{node.selfReview.byName === "You" ? "You" : node.selfReview.byName}</strong> {node.state === "rejected" ? "sent this back" : "reviewed this"} on {formatDate(node.selfReview.atISO)} as the only person who could review it.</p>
            {node.selfReview.confirmation && <p className="muted">Confirmed: “{node.selfReview.confirmation}”</p>}
            {node.selfReview.secondReviewerAvailable && <p className="pathway-self-review__note" role="note">Someone else in your workspace can review now. If you'd like a second look, ask them to check this preparation. Nothing is blocked.</p>}
          </div>}
          {actionable && <div style={{ marginTop: 10 }}>
            {node.canComplete && <Field label={`Evidence for ${node.title}`} hint={node.requiresUploadedEvidence ? "An uploaded official evidence document and its recorded version are required." : node.kind === "document" || node.requiresEvidence ? "A permitted workspace document is required." : "Optional supporting evidence."}><Select aria-label={`Evidence for ${node.title}`} value={draft.documentId ?? ""} onChange={(documentId) => updateDraft(node.key, { documentId })} options={evidenceOptions} disabled={!!busy} /></Field>}
            <Field label={`Notes for ${node.title}`} hint={node.canReject ? "Include the reason when rejecting a review." : undefined}><textarea aria-label={`Notes for ${node.title}`} className="input" value={draft.notes ?? ""} onChange={(event) => updateDraft(node.key, { notes: event.target.value })} disabled={!!busy} /></Field>
            {node.canSelfReview && <div className="pathway-self-review" data-testid="pathway-self-review">
              <p>You're the only person in this workspace who can review this. Check the prepared documents yourself, then record your review.</p>
              <Checkbox checked={Boolean(draft.confirmSelfReview)} onChange={(checked) => updateDraft(node.key, { confirmSelfReview: checked })} label={confirmation} disabled={!!busy} />
            </div>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {node.canComplete && <button className="btn btn--sm" disabled={disabled || ((node.kind === "document" || node.requiresEvidence) && !draft.documentId)} onClick={() => act(node.key, () => complete({ ...params, documentId: draft.documentId || undefined }), "Step completed")}>Complete step</button>}
              {node.canApprove && <button className="btn btn--sm btn--accent" disabled={disabled} onClick={() => act(node.key, () => approve(params), "Preparation review approved")}>Approve review</button>}
              {node.canSelfReview && <button className="btn btn--sm btn--accent" disabled={disabled || !draft.confirmSelfReview} onClick={() => act(node.key, () => approve({ ...params, confirmSelfReview: true }), "Your review is recorded")}>Record my review</button>}
              {node.canReject && <button className="btn btn--sm" disabled={disabled || !draft.notes?.trim()} onClick={() => act(node.key, () => reject(params), "Preparation review rejected")}>Reject review</button>}
            </div>
          </div>}
          {node.kind === "submission" && <div style={{ marginTop: 10 }}>
            <p className="muted">{capacity?.reason ?? "No submission adapter capability is confirmed."}{capacity?.available ? " The configured adapter is available; its outbox status is recorded separately." : " Complete filing and payment through the official service."}</p>
            {node.submission?.officialUrl && <a href={node.submission.officialUrl} target="_blank" rel="noreferrer">Open official filing service <ExternalLink size={12} style={{ verticalAlign: "middle" }} /></a>}
            {node.canSubmit && <button className="btn btn--sm" style={{ marginLeft: 10 }} disabled={disabled} onClick={() => act(node.key, () => submit({ runId: run._id, nodeKey: node.key }), "Filing handoff recorded")}>{capacity?.available ? "Queue configured submission" : "Record manual filing handoff"}</button>}
            {receipt && <p className="muted">Outbox status: {receipt.status}{receipt.error ? ` · ${receipt.error}` : ""}. A handoff does not establish registry acceptance. Keep the official filing receipt and certificate.</p>}
            {(node.canRecordReceipt || receipt?.canRecordReceipt) && <div>
              <Field label="Official filing receipt"><Select aria-label="Official filing receipt" value={draft.documentId ?? ""} onChange={(documentId) => updateDraft(node.key, { documentId })} options={evidenceOptions} disabled={!!busy} /></Field>
              <Field label="Official receipt reference"><input aria-label="Official receipt reference" className="input" value={draft.reference ?? ""} onChange={(event) => updateDraft(node.key, { reference: event.target.value })} disabled={!!busy} /></Field>
              <Field label="Manual filing notes"><textarea aria-label="Manual filing notes" className="input" value={draft.notes ?? ""} onChange={(event) => updateDraft(node.key, { notes: event.target.value })} disabled={!!busy} /></Field>
              <button className="btn btn--sm" disabled={disabled || !draft.documentId || !draft.reference?.trim()} onClick={() => act(node.key, () => recordReceipt({ runId: run._id, nodeKey: node.key, documentId: draft.documentId, reference: draft.reference, notes: draft.notes || undefined }), "Manual filing receipt recorded")}>Attest official filing receipt</button>
              <p className="muted">Attach the uploaded receipt from the official service. This records a human attestation; certificate verification remains separate.</p>
            </div>}
          </div>}
        </article>;
      })}
    </div>
    <p className="muted"><Link to="/app/documents">Upload supporting evidence</Link>{" · "}<Link to="/app/society">Record official certificate verification on the organization profile</Link></p>
    {run.audit?.length > 0 && <details data-testid="pathway-history"><summary style={{ cursor: "pointer" }}>Run history ({run.audit.length})</summary><ol>{run.audit.map((entry: any, index: number) => {
      const event = entry.action ?? entry.event ?? entry.type;
      let detail: any = {};
      try { detail = entry.detailJson ? JSON.parse(entry.detailJson) : {}; } catch { detail = {}; }
      const confirmed = event === "review.self-approved" ? detail?.selfReview?.confirmation : undefined;
      return <li key={index}>{formatDateTime(entry.atISO ?? entry.createdAtISO)} · {AUDIT_LABEL[event] ?? event}{entry.nodeKey ? ` · ${nodes.find((node) => node.key === entry.nodeKey)?.title ?? entry.nodeKey}` : ""}{confirmed ? ` · “${confirmed}”` : ""}{entry.notes ? ` · ${entry.notes}` : ""}</li>;
    })}</ol></details>}
  </div>;
}
