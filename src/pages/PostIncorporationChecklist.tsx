import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { ListChecks, ExternalLink } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Link } from "react-router-dom";
import { Select } from "../components/Select";
import { entityPreparationDecision } from "../../shared/entitySetup";
import { Badge, Drawer, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import { IncorporationPreparation } from "../components/IncorporationPreparation";
import { PathwayPipelineCard } from "../components/PathwayPipelineCard";

const CATEGORY_LABEL: Record<string, string> = {
  organize: "Prepare and organize the entity",
  registration: "Register with governments",
  good_standing: "Stay in good standing",
};

const CADENCE_LABEL: Record<string, string> = {
  one_time: "One-time",
  recurring: "Recurring",
  event_driven: "When it changes",
};

/**
 * Post-incorporation checklist — the ordered "what do I do now?" steps after
 * incorporating, from shared/postIncorporationSteps.ts. Each step links to the
 * document packet that produces its paperwork (one-click generate) and to the
 * authoritative government page.
 */
export function PostIncorporationChecklistPage() {
  const society = useSociety();
  const data = useQuery(
    api.postIncorporation.checklist,
    society ? { societyId: society._id } : "skip",
  ) as { steps: any[]; generatedPacketKeys: string[]; evidence?: any[]; preparation?: { allowed: boolean; message: string } } | undefined;
  const generate = useMutation(api.legalOperations.generateDocumentFromCatalog);
  const recordEvidence = useMutation(api.postIncorporation.recordEvidence);
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const toast = useToast();
  const [evidenceDraft, setEvidenceDraft] = useState<any>(null);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const steps = data?.steps ?? [];
  const generated = new Set(data?.generatedPacketKeys ?? []);
  const evidence = new Map((data?.evidence ?? []).map((entry) => [entry.stepKey, entry]));
  const preparation = data?.preparation ?? entityPreparationDecision(society);
  const categories = ["organize", "registration", "good_standing"] as const;

  const onGenerate = async (packetKey: string) => {
    setBusy(packetKey);
    try {
      await generate({ societyId: society._id, packetKey, effectiveDate: new Date().toISOString().slice(0, 10) });
      toast.success("Packet staged", "The editable draft is ready in the Template Engine.");
    } catch (err: any) {
      toast.error("Could not generate", err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveEvidence = async () => {
    if (!evidenceDraft) return;
    setSavingEvidence(true);
    try {
      await recordEvidence({ societyId: society._id, stepKey: evidenceDraft.stepKey, stage: evidenceDraft.stage, documentId: evidenceDraft.documentId || undefined, confirmationNumber: evidenceDraft.confirmationNumber || undefined, notes: evidenceDraft.notes || undefined });
      toast.success("Evidence recorded", "The checklist now distinguishes preparation, execution and registry evidence.");
      setEvidenceDraft(null);
    } catch (error: any) { toast.error("Could not save evidence", error?.message ?? String(error)); }
    finally { setSavingEvidence(false); }
  };

  return (
    <div className="page">
      <PageHeader
        title="Post-incorporation checklist"
        icon={<ListChecks size={16} />}
        iconColor="green"
        subtitle="Prepare, organize and maintain your entity, with separate records for drafts, execution and official registry evidence."
      />
      <IncorporationPreparation organization={society} />
      <PathwayPipelineCard societyId={society._id} />
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <Badge tone={preparation.allowed ? "info" : "warn"}>{preparation.allowed ? "Preparation route" : "Review required"}</Badge>
        <p style={{ margin: "8px 0" }}>{preparation.message}</p>
        <p className="muted" style={{ margin: 0 }}>Generating a packet starts preparation. Signed documents, filing receipts and certified registry documents each require their own evidence. Filing and payment take place in the official registry workflow.</p>
        <Link to="/app/society">Edit entity and tax account facts</Link>{" · "}<Link to="/app/documents">Upload evidence in Documents</Link>{" · "}<Link to="/app/filings">Registry filings</Link>
      </div>
      {data === undefined ? <PageLoading /> : steps.length === 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            No post-incorporation flow is defined for this entity's jurisdiction/type yet.
            BC ordinary/member-funded societies, ordinary private BC companies and federal CBCA corporations have preparation flows. Confirm the entity route or arrange specialist review.
          </p>
        </div>
      ) : (
        categories.map((cat) => {
          const catSteps = steps.filter((s) => s.category === cat);
          if (catSteps.length === 0) return null;
          return (
            <section key={cat} style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>{CATEGORY_LABEL[cat]}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {catSteps.map((step) => {
                  const started = step.packetKey && generated.has(step.packetKey);
                  const recorded = evidence.get(step.key);
                  return (
                    <div key={step.key} className="card" style={{ padding: 14 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div>
                          <strong>{step.order}. {step.title}</strong>
                          <div className="row" style={{ gap: 6, marginTop: 4 }}>
                            <Badge tone="neutral">{CADENCE_LABEL[step.cadence] ?? step.cadence}</Badge>
                            {started && <Badge tone="info">Preparation started</Badge>}
                            {recorded && <Badge tone={recorded.stage === "preparing" ? "info" : "success"}>{({ preparing: "Preparing", executed: "Executed evidence", filed: "Filing receipt recorded", certified: "Certified registry evidence" } as Record<string, string>)[recorded.stage]}</Badge>}
                          </div>
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><button className="btn btn--sm" onClick={() => setEvidenceDraft({ stepKey: step.key, title: step.title, stage: "preparing", documentId: "", confirmationNumber: "", notes: "", ...recorded })}>Record evidence</button>
                        {step.packetKey && (
                          <button className="btn btn--sm" disabled={busy === step.packetKey} onClick={() => onGenerate(step.packetKey)}>
                            {busy === step.packetKey ? "Generating…" : started ? "Regenerate" : "Generate packet"}
                          </button>
                        )}</div>
                      </div>
                      <p style={{ margin: "8px 0 6px" }}>{step.summary}</p>
                      <div className="muted" style={{ fontSize: 13 }}>
                        <div><strong>Timing:</strong> {step.timing}</div>
                        <div>
                          <strong>Authority:</strong> {step.authority.body} — {step.authority.citation}{" "}
                          <a href={step.authority.officialUrl} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>
                            official page <ExternalLink size={11} style={{ verticalAlign: "middle" }} />
                          </a>
                        </div>
                        {step.obligation?.filingKind && <div><strong>Recurring filing:</strong> {step.obligation.filingKind}</div>}
                        {recorded && <div style={{ marginTop: 4 }}><strong>Evidence:</strong> {documents?.find((document) => document._id === recorded.documentId)?.title ?? (recorded.documentId ? "Attached document" : "Preparation record")}{recorded.confirmationNumber ? ` · ${recorded.confirmationNumber}` : ""}{recorded.notes ? ` — ${recorded.notes}` : ""}</div>}
                        {step.caveat && <div style={{ marginTop: 4, fontStyle: "italic" }}>{step.caveat}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
      <Drawer open={!!evidenceDraft} onClose={() => setEvidenceDraft(null)} title={evidenceDraft?.title ?? "Checklist evidence"} footer={<><button className="btn" onClick={() => setEvidenceDraft(null)}>Cancel</button><button className="btn btn--accent" disabled={savingEvidence} onClick={saveEvidence}>{savingEvidence ? "Saving…" : "Save evidence"}</button></>}>
        {evidenceDraft && <>
          <Field label="Evidence stage"><Select value={evidenceDraft.stage} onChange={(value) => setEvidenceDraft({ ...evidenceDraft, stage: value })} options={[{ value: "preparing", label: "Preparing — draft only" }, { value: "executed", label: "Executed — signed internal document" }, { value: "filed", label: "Filed — official submission receipt" }, { value: "certified", label: "Certified — official registry document" }]} /></Field>
          <Field label="Evidence document" hint="Required for executed, filed and certified stages."><Select value={evidenceDraft.documentId ?? ""} onChange={(value) => setEvidenceDraft({ ...evidenceDraft, documentId: value })} options={[{ value: "", label: "Select an uploaded document" }, ...(documents ?? []).map((document) => ({ value: document._id, label: document.title }))]} /></Field>
          <Field label="Confirmation / certificate reference" hint="Required for filed and certified evidence."><input className="input" value={evidenceDraft.confirmationNumber ?? ""} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, confirmationNumber: event.target.value })} /></Field>
          <Field label="Evidence notes"><textarea className="input" value={evidenceDraft.notes ?? ""} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, notes: event.target.value })} /></Field>
          <p className="muted">Choose the stage supported by the attached evidence. Recording an internal signed document does not confirm registry filing or incorporation.</p>
        </>}
      </Drawer>
    </div>
  );
}

export default PostIncorporationChecklistPage;
