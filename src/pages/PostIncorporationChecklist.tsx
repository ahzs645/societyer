import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { ListChecks, ExternalLink, MoreHorizontal, ClipboardCheck, FileText } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Link, useNavigate } from "react-router-dom";
import { Menu } from "../components/Menu";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { Select } from "../components/Select";
import { entityPreparationDecision } from "../../shared/entitySetup";
import { isSociety } from "../../shared/organizationDomain";
import { Badge, Banner, Drawer, EmptyState, Field, SkeletonRows } from "../components/ui";
import { useToast } from "../components/Toast";
import { setupViewStepLink } from "../lib/organizationSetupLinks";
import { PathwayPipelineCard } from "../components/PathwayPipelineCard";
import { todayDateOnly } from "../../shared/dateOnly";
import type { PostIncorporationStep, PostIncorporationStepCategory } from "../../shared/postIncorporationSteps";

const CATEGORIES: readonly PostIncorporationStepCategory[] = ["organize", "registration", "good_standing"];

const CATEGORY_LABEL: Record<PostIncorporationStepCategory, string> = {
  organize: "Prepare and organize the entity",
  registration: "Register with governments",
  good_standing: "Stay in good standing",
};

const CADENCE_LABEL: Record<string, string> = {
  one_time: "One-time",
  recurring: "Recurring",
  event_driven: "When it changes",
};

const STAGE_LABEL: Record<string, string> = {
  preparing: "Preparing",
  executed: "Executed evidence",
  filed: "Filing receipt recorded",
  certified: "Certified registry evidence",
};

const STAGE_OPTIONS = [
  { value: "preparing", label: "Preparing — draft only" },
  { value: "executed", label: "Executed — signed internal document" },
  { value: "filed", label: "Filed — official submission receipt" },
  { value: "certified", label: "Certified — official registry document" },
];

/** Evidence recorded against a step (society.postIncorporationEvidence). */
type StepEvidence = {
  stepKey: string;
  stage: string;
  documentId?: string;
  confirmationNumber?: string;
  notes?: string;
};

type ChecklistData = {
  steps: PostIncorporationStep[];
  generatedPacketKeys: string[];
  evidence?: StepEvidence[];
  preparation?: { allowed: boolean; message: string };
};

type EvidenceDraft = {
  stepKey: string;
  title: string;
  stage: string;
  documentId: string;
  confirmationNumber: string;
  notes: string;
};

type DocumentSummary = { _id: string; title: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Post-incorporation checklist — the ordered "what do I do now?" steps after
 * incorporating, from shared/postIncorporationSteps.ts. Each step links to the
 * document packet that produces its paperwork (one-click generate) and to the
 * authoritative government page.
 */
export function PostIncorporationChecklistPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("documents:write");
  const data = useQuery(
    api.postIncorporation.checklist,
    society ? { societyId: society._id } : "skip",
  ) as ChecklistData | undefined;
  const generate = usePermissionedMutation(api.legalOperations.generateDocumentFromCatalog, canWrite);
  const recordEvidence = usePermissionedMutation(api.postIncorporation.recordEvidence, canWrite);
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip") as DocumentSummary[] | undefined;
  const toast = useToast();
  const navigate = useNavigate();
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft | null>(null);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const steps = data?.steps ?? [];
  const generated = new Set(data?.generatedPacketKeys ?? []);
  const evidence = new Map((data?.evidence ?? []).map((entry) => [entry.stepKey, entry]));
  const preparation = data?.preparation ?? entityPreparationDecision(society);
  const sections = CATEGORIES
    .map((category) => ({ category, steps: steps.filter((step) => step.category === category) }))
    .filter((section) => section.steps.length > 0);
  // Steps are shown grouped by section, so number them in the order they
  // appear (1, 2, 3…) rather than by their global order, which read 1, 2, 3, 5, 4.
  const displayNumber = new Map(
    sections.flatMap((section) => section.steps).map((step, index) => [step.key, index + 1]),
  );

  const onGenerate = async (packetKey: string) => {
    if (!canWrite) return;
    setBusy(packetKey);
    try {
      await generate({ societyId: society._id, packetKey, effectiveDate: todayDateOnly() });
      toast.success("Packet staged", "The editable draft is ready in the Template Engine.");
    } catch (error) {
      toast.error("Could not generate", errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const openEvidence = (step: PostIncorporationStep, recorded: StepEvidence | undefined) => {
    if (!canWrite) return;
    setEvidenceDraft({
      stepKey: step.key,
      title: step.title,
      stage: recorded?.stage ?? "preparing",
      documentId: recorded?.documentId ?? "",
      confirmationNumber: recorded?.confirmationNumber ?? "",
      notes: recorded?.notes ?? "",
    });
  };

  const saveEvidence = async () => {
    if (!canWrite || !evidenceDraft) return;
    setSavingEvidence(true);
    try {
      await recordEvidence({
        societyId: society._id,
        stepKey: evidenceDraft.stepKey,
        stage: evidenceDraft.stage,
        documentId: evidenceDraft.documentId || undefined,
        confirmationNumber: evidenceDraft.confirmationNumber || undefined,
        notes: evidenceDraft.notes || undefined,
      });
      toast.success("Evidence recorded", "The checklist now distinguishes preparation, execution and registry evidence.");
      setEvidenceDraft(null);
    } catch (error) {
      toast.error("Could not save evidence", errorMessage(error));
    } finally {
      setSavingEvidence(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Post-incorporation checklist"
        icon={<ListChecks size={16} />}
        iconColor="green"
        subtitle="What to do after incorporating, step by step."
        info={
          <>
            <p>Prepare, organize and maintain your entity, with separate records for drafts, execution and official registry evidence.</p>
            {preparation.allowed && <p>{preparation.message}</p>}
            <p>
              Generating a packet starts preparation. Signed documents, filing receipts and certified registry documents each
              require their own evidence. Filing and payment take place in the official registry workflow.
            </p>
          </>
        }
        actions={
          <MoreActionsMenu
            items={[
              { id: "society", label: "Edit entity and tax account facts", onSelect: () => navigate("/app/society") },
              { id: "documents", label: "Upload evidence in Documents", onSelect: () => navigate("/app/documents") },
              { id: "filings", label: "Registry filings", onSelect: () => navigate("/app/filings") },
            ]}
          />
        }
      />
      {!preparation.allowed && <Banner tone="warn">Review required. {preparation.message}</Banner>}
      {data === undefined ? (
        <div className="card">
          <div className="card__body">
            <SkeletonRows rows={4} columns={3} />
          </div>
        </div>
      ) : sections.length === 0 ? (
        <div className="card">
          <div className="card__body">
            <EmptyState
              icon={<ListChecks size={20} />}
              title="No post-incorporation steps for this kind of entity yet"
              description={`${isSociety(society) ? "BC ordinary/member-funded societies, ordinary" : "Ordinary"} private BC companies and federal CBCA corporations have preparation flows. Confirm the entity route or arrange specialist review.`}
            />
          </div>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.category} className="card" aria-labelledby={`post-incorporation-${section.category}`}>
            <div className="card__head">
              <h2 className="card__title" id={`post-incorporation-${section.category}`}>{CATEGORY_LABEL[section.category]}</h2>
              <Badge>{section.steps.length}</Badge>
            </div>
            <ol className="post-incorporation-steps">
              {section.steps.map((step) => (
                <ChecklistStep
                  key={step.key}
                  step={step}
                  number={displayNumber.get(step.key) ?? step.order}
                  started={Boolean(step.packetKey && generated.has(step.packetKey))}
                  recorded={evidence.get(step.key)}
                  documents={documents}
                  canWrite={canWrite}
                  generating={Boolean(step.packetKey) && busy === step.packetKey}
                  onGenerate={onGenerate}
                  onRecordEvidence={openEvidence}
                  onOpenPacket={() => navigate("/app/template-engine")}
                />
              ))}
            </ol>
          </section>
        ))
      )}
      <PathwayPipelineCard societyId={society._id} />
      {["preparing", "submitted"].includes(society.formationStatus ?? "") && (
        <Banner className="setup-filing-link" title="Filing the incorporation">
          What to prepare and the official filing link are in the filing step of setup.{" "}
          <Link className="setup-inline-link" to={setupViewStepLink("file")}>Open the filing step</Link>
        </Banner>
      )}
      <EvidenceDrawer
        draft={evidenceDraft}
        documents={documents}
        canWrite={canWrite}
        saving={savingEvidence}
        onChange={setEvidenceDraft}
        onClose={() => setEvidenceDraft(null)}
        onSave={saveEvidence}
      />
    </div>
  );
}

function evidenceSummary(recorded: StepEvidence, documents: DocumentSummary[] | undefined) {
  const document = documents?.find((candidate) => candidate._id === recorded.documentId)?.title
    ?? (recorded.documentId ? "Attached document" : "Preparation record");
  const confirmation = recorded.confirmationNumber ? ` · ${recorded.confirmationNumber}` : "";
  const notes = recorded.notes ? ` — ${recorded.notes}` : "";
  return `${document}${confirmation}${notes}`;
}

/** One checklist step: its title and state, its actions, and the facts behind it. */
function ChecklistStep({ step, number, started, recorded, documents, canWrite, generating, onGenerate, onRecordEvidence, onOpenPacket }: {
  step: PostIncorporationStep;
  number: number;
  started: boolean;
  recorded: StepEvidence | undefined;
  documents: DocumentSummary[] | undefined;
  canWrite: boolean;
  generating: boolean;
  onGenerate: (packetKey: string) => void;
  onRecordEvidence: (step: PostIncorporationStep, recorded: StepEvidence | undefined) => void;
  onOpenPacket: () => void;
}) {
  const packetKey = step.packetKey;
  return (
    <li className="post-incorporation-step">
      <div className="post-incorporation-step__head">
        <div className="post-incorporation-step__heading">
          <h3 className="post-incorporation-step__title">{number}. {step.title}</h3>
          <div className="post-incorporation-step__badges">
            <Badge tone="neutral">{CADENCE_LABEL[step.cadence] ?? step.cadence}</Badge>
            {started && <Badge tone="info">Preparation started</Badge>}
            {recorded && <Badge tone={recorded.stage === "preparing" ? "info" : "success"}>{STAGE_LABEL[recorded.stage]}</Badge>}
          </div>
        </div>
        <div className="post-incorporation-step__actions">
          {packetKey ? (
            <>
              <button className="btn btn--sm" disabled={!canWrite || generating} onClick={() => onGenerate(packetKey)}>
                {generating ? "Generating…" : started ? "Regenerate" : "Generate packet"}
              </button>
              <Menu
                align="right"
                trigger={
                  <button className="btn btn--sm btn--icon" aria-label={`More actions for ${step.title}`}>
                    <MoreHorizontal size={14} />
                  </button>
                }
                sections={[{
                  id: "step",
                  items: [
                    { id: "evidence", label: "Record evidence", icon: <ClipboardCheck size={14} />, disabled: !canWrite, onSelect: () => onRecordEvidence(step, recorded) },
                    ...(started ? [{ id: "open-packet", label: "Open in Template Engine", icon: <FileText size={14} />, onSelect: onOpenPacket }] : []),
                  ],
                }]}
              />
            </>
          ) : (
            <button className="btn btn--sm" disabled={!canWrite} onClick={() => onRecordEvidence(step, recorded)}>
              Record evidence
            </button>
          )}
        </div>
      </div>
      <p className="post-incorporation-step__summary">{step.summary}</p>
      <dl className="post-incorporation-step__facts">
        <div>
          <dt>Timing</dt>
          <dd>{step.timing}</dd>
        </div>
        <div>
          <dt>Authority</dt>
          <dd>
            {step.authority.body} — {step.authority.citation}{" "}
            <a className="post-incorporation-step__source" href={step.authority.officialUrl} target="_blank" rel="noreferrer">
              official page <ExternalLink size={11} aria-hidden="true" />
            </a>
          </dd>
        </div>
        {step.obligation?.filingKind && (
          <div>
            <dt>Recurring filing</dt>
            <dd>{filingKindLabel(step.obligation.filingKind)}</dd>
          </div>
        )}
        {recorded && (
          <div>
            <dt>Evidence</dt>
            <dd>{evidenceSummary(recorded, documents)}</dd>
          </div>
        )}
      </dl>
      {step.caveat && <p className="post-incorporation-step__caveat">{step.caveat}</p>}
    </li>
  );
}

/** Records which evidence stage a step has reached, and the document and reference behind it. */
function EvidenceDrawer({ draft, documents, canWrite, saving, onChange, onClose, onSave }: {
  draft: EvidenceDraft | null;
  documents: DocumentSummary[] | undefined;
  canWrite: boolean;
  saving: boolean;
  onChange: (draft: EvidenceDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Drawer
      open={!!draft}
      onClose={onClose}
      title={draft?.title ?? "Checklist evidence"}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" disabled={!canWrite || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save evidence"}
          </button>
        </>
      }
    >
      {draft && (
        <>
          <Field label="Evidence stage">
            <Select
              disabled={!canWrite}
              value={draft.stage}
              onChange={(stage) => onChange({ ...draft, stage })}
              options={STAGE_OPTIONS}
            />
          </Field>
          <Field label="Evidence document" hint="Required for executed, filed and certified stages.">
            <Select
              disabled={!canWrite}
              value={draft.documentId}
              onChange={(documentId) => onChange({ ...draft, documentId })}
              options={[
                { value: "", label: "Select an uploaded document" },
                ...(documents ?? []).map((document) => ({ value: document._id, label: document.title })),
              ]}
            />
          </Field>
          <Field label="Confirmation / certificate reference" hint="Required for filed and certified evidence.">
            <input
              disabled={!canWrite}
              className="input"
              value={draft.confirmationNumber}
              onChange={(event) => onChange({ ...draft, confirmationNumber: event.target.value })}
            />
          </Field>
          <Field label="Evidence notes">
            <textarea
              disabled={!canWrite}
              className="input"
              value={draft.notes}
              onChange={(event) => onChange({ ...draft, notes: event.target.value })}
            />
          </Field>
          <p className="muted">
            Choose the stage supported by the attached evidence. Recording an internal signed document does not confirm
            registry filing or incorporation.
          </p>
        </>
      )}
    </Drawer>
  );
}

/** "BCSocietyAnnualReport" -> "BC society annual report"; acronyms keep their case. */
function filingKindLabel(kind: string) {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(" ");
  return words.map((word, index) => (index > 0 && /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word)).join(" ");
}

export default PostIncorporationChecklistPage;
