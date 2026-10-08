import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Field } from "./ui";
import { Select } from "./Select";
import { useToast } from "./Toast";

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

function PipelineRun({ run, data, societyId }: { run: any; data: any; societyId: string }) {
  const saveInput = useMutation((api as any).pathways.saveInput);
  const complete = useMutation((api as any).pathways.completeStep);
  const approve = useMutation((api as any).pathways.approve);
  const reject = useMutation((api as any).pathways.reject);
  const submit = useMutation((api as any).pathways.requestSubmission);
  const recordReceipt = useMutation((api as any).pathways.recordManualReceipt);
  const documents = useQuery(api.documents.list, { societyId }) as any[] | undefined;
  const [inputs, setInputs] = useState<Record<string, InputValue>>(run.inputs ?? {});
  const [drafts, setDrafts] = useState<Record<string, { documentId?: string; notes?: string; reference?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const savedInputsJson = JSON.stringify(run.inputs ?? {});
  useEffect(() => { setInputs(JSON.parse(savedInputsJson)); }, [run._id, savedInputsJson]);
  const fields: InputField[] = run.graph?.inputFields ?? data.pathway?.pipeline?.inputFields ?? [];
  const nodes: any[] = run.nodes ?? [];
  const dirty = JSON.stringify(inputs) !== JSON.stringify(run.inputs ?? {});
  const missing = fields.filter((field) => field.required && (inputs[field.key] === undefined || inputs[field.key] === ""));
  const update = (key: string, value: InputValue | undefined) => setInputs((current) => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; });
  const updateDraft = (key: string, value: object) => setDrafts((current) => ({ ...current, [key]: { ...current[key], ...value } }));
  const act = async (key: string, operation: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try { await operation(); toast.success(message); }
    catch (error: any) { toast.error("Pathway action failed", error?.message ?? String(error)); }
    finally { setBusy(null); }
  };
  const evidenceOptions = [{ value: "", label: "Select a workspace document" }, ...(documents ?? []).map((document) => ({ value: document._id, label: document.title }))];
  return <div data-testid="pathway-run">
    <p className="muted" title={`Pathway version ${run.pathwayVersion}`}>Status: {run.status}. Completing this preparation doesn't confirm incorporation.</p>
    {run.message && <p role="status">{run.message}</p>}
    <details open>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Pathway inputs {run.inputsFrozen ? "— saved and frozen" : "— save before completing a step"}</summary>
      <div style={{ marginTop: 12 }}>
        {fields.map((field) => <Field key={field.key} label={field.label} hint={field.required ? "Required" : undefined}>
          {field.type === "boolean" ? <Select aria-label={field.label} value={inputs[field.key] === undefined ? "" : String(inputs[field.key])} onChange={(value) => update(field.key, value === "true")} options={[{ value: "", label: "Choose an option", disabled: true }, { value: "true", label: "Yes" }, { value: "false", label: "No" }]} disabled={run.inputsFrozen || !data.canAdvance || !!busy} /> : field.type === "select" ? <Select aria-label={field.label} value={String(inputs[field.key] ?? "")} onChange={(value) => update(field.key, value || undefined)} options={[{ value: "", label: "Choose an option" }, ...(field.options ?? [])]} disabled={run.inputsFrozen || !data.canAdvance || !!busy} /> : <input aria-label={field.label} className="input" type={field.type === "number" ? "number" : "text"} value={String(inputs[field.key] ?? "")} disabled={run.inputsFrozen || !data.canAdvance || !!busy} onChange={(event) => { if (field.type === "number") update(field.key, event.target.value === "" ? undefined : Number(event.target.value)); else update(field.key, event.target.value); }} />}
        </Field>)}
        {run.inputsFrozen ? <p className="muted">Inputs froze when this run first advanced. Start a new run to change the preparation facts; the earlier evidence and review remain in this run.</p> : <button className="btn btn--sm" disabled={!data.canAdvance || !!busy || !dirty} onClick={() => act("inputs", () => saveInput({ runId: run._id, inputs }), "Pathway inputs saved")}>Save pathway inputs</button>}
        {missing.length > 0 && !run.inputsFrozen && <p className="muted">Complete all required inputs before advancing.</p>}
      </div>
    </details>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      {nodes.map((node) => {
        const draft = drafts[node.key] ?? {};
        const actionable = node.canComplete || node.canApprove || node.canReject;
        const capacity = (data.submissionCapabilities ?? []).find((entry: any) => entry.adapterId === node.submission?.adapterId);
        const receipt = (run.submissions ?? []).find((entry: any) => entry.stepKey === node.key);
        const params = { runId: run._id, nodeKey: node.key, notes: draft.notes || undefined };
        const disabled = !!busy || dirty || missing.length > 0;
        return <article key={node.key} className="card" style={{ padding: 12 }} data-testid={`pathway-node-${node.key}`}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}><strong>{node.title}</strong><Badge tone={node.state === "approved" || node.state === "completed" ? "success" : node.state === "rejected" ? "warn" : "neutral"}>{STATE_LABEL[node.state] ?? node.state}</Badge></div>
          <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            {node.dependsOn?.length > 0 && <div>Depends on: {node.dependsOn.map((key: string) => nodes.find((entry) => entry.key === key)?.title ?? key).join("; ")}. Skipped branches do not require completion.</div>}
            {node.condition && <div>Branch: {fields.find((field) => field.key === node.condition.field)?.label ?? node.condition.field} {node.condition.operator.replaceAll("_", " ")}{node.condition.value !== undefined ? ` ${JSON.stringify(node.condition.value)}` : ""}.</div>}
            {node.blockedReason && <div>{node.blockedReason}</div>}
            {node.documentId && <div>Evidence: {documents?.find((document) => document._id === node.documentId)?.title ?? "Attached permitted document"}</div>}
            {node.notes && <div>Recorded notes: {node.notes}</div>}
            {node.kind === "approval" && <div>Requires {node.approval?.permission ?? "review permission"}{node.approval?.distinctInitiator !== false ? " and a reviewer different from the run initiator" : ""}.</div>}
          </div>
          {actionable && <div style={{ marginTop: 10 }}>
            {node.canComplete && <Field label={`Evidence for ${node.title}`} hint={node.requiresUploadedEvidence ? "An uploaded official evidence document and its recorded version are required." : node.kind === "document" || node.requiresEvidence ? "A permitted workspace document is required." : "Optional supporting evidence."}><Select aria-label={`Evidence for ${node.title}`} value={draft.documentId ?? ""} onChange={(documentId) => updateDraft(node.key, { documentId })} options={evidenceOptions} disabled={!!busy} /></Field>}
            <Field label={`Notes for ${node.title}`} hint={node.canReject ? "Include the reason when rejecting a review." : undefined}><textarea aria-label={`Notes for ${node.title}`} className="input" value={draft.notes ?? ""} onChange={(event) => updateDraft(node.key, { notes: event.target.value })} disabled={!!busy} /></Field>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {node.canComplete && <button className="btn btn--sm" disabled={disabled || ((node.kind === "document" || node.requiresEvidence) && !draft.documentId)} onClick={() => act(node.key, () => complete({ ...params, documentId: draft.documentId || undefined }), "Step completed")}>Complete step</button>}
              {node.canApprove && <button className="btn btn--sm btn--accent" disabled={disabled} onClick={() => act(node.key, () => approve(params), "Preparation review approved")}>Approve review</button>}
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
    {run.audit?.length > 0 && <details><summary style={{ cursor: "pointer" }}>Run history ({run.audit.length})</summary><ol>{run.audit.map((entry: any, index: number) => <li key={index}>{entry.atISO ?? entry.createdAtISO ?? ""} {entry.action ?? entry.event ?? entry.type}{entry.nodeKey ? ` · ${entry.nodeKey}` : ""}{entry.notes ? ` · ${entry.notes}` : ""}</li>)}</ol></details>}
  </div>;
}
