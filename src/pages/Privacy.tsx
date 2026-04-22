import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileDown,
  FileCheck2,
  FileText,
  GraduationCap,
  MailCheck,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Shield,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Banner, Field } from "../components/ui";
import { Modal, useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useBylawRules } from "../hooks/useBylawRules";
import { useModuleEnabled } from "../hooks/useModules";
import { CitationBadge } from "../components/CitationTooltip";
import { formatDate } from "../lib/format";
import {
  LEGAL_COPY_REVIEWED,
  PIPA_POLICY_REQUIREMENTS,
  PIPA_TEMPLATE_RESOURCES,
  RECORDS_INSPECTION_GUIDANCE,
} from "../lib/legalCopy";
import { exportMarkdownWordDoc, markdownToHtml } from "../lib/exportWord";

type StepTone = "success" | "warn" | "info" | "neutral";
type DraftEditorKind = "policy" | "memberDataMemo";
type DraftViewMode = "edit" | "preview";
type DraftEditorState = {
  id: any;
  kind: DraftEditorKind;
  title: string;
  content: string;
  tags: string[];
};

export function PrivacyPage() {
  const society = useSociety();
  const { rules } = useBylawRules();
  const toast = useToast();
  const confirm = useConfirm();
  const communicationsEnabled = useModuleEnabled("communications");
  const trainingEnabled = useModuleEnabled("pipaTraining");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const training = useQuery(
    api.pipaTraining.list,
    society && trainingEnabled ? { societyId: society._id } : "skip",
  );
  const prefs = useQuery(
    api.communications.listMemberPrefs,
    society && communicationsEnabled ? { societyId: society._id } : "skip",
  );
  const motionBacklog = useQuery(api.motionBacklog.list, society ? { societyId: society._id } : "skip");
  const createPolicyDraft = useMutation(api.documents.createPipaPolicyDraft);
  const createMemberDataGapMemoDraft = useMutation(api.documents.createMemberDataGapMemoDraft);
  const updateDraftContent = useMutation(api.documents.updateDraftContent);
  const linkPrivacyPolicyEvidence = useMutation(api.documents.linkPrivacyPolicyEvidence);
  const seedPipaSetupMotions = useMutation(api.motionBacklog.seedPipaSetup);
  const [draftEditor, setDraftEditor] = useState<DraftEditorState | null>(null);
  const [draftViewMode, setDraftViewMode] = useState<DraftViewMode>("edit");
  const [draftBusy, setDraftBusy] = useState(false);
  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const hasPolicyEvidence = !!society.privacyPolicyDocId;
  const hasOfficer = !!society.privacyOfficerName && !!society.privacyOfficerEmail;
  const documentRows = documents ?? [];
  const policyDraft = documentRows.find(isPrivacyPolicyDraft);
  const memberDataMemoDraft = documentRows.find(isMemberDataMemoDraft);
  const pipaSetupMotionCount = (motionBacklog ?? []).filter((item: any) => item.source === "pipa-setup").length;
  const adoptedPolicyDocument = society.privacyPolicyDocId
    ? documentRows.find((document) => String(document._id) === String(society.privacyPolicyDocId))
    : null;
  const privacyProgramStatus = society.privacyProgramStatus ?? (hasPolicyEvidence ? "Documented" : "Unknown");
  const privacyProgramDocumented = privacyProgramStatus === "Documented";
  const memberDataAccessStatus = society.memberDataAccessStatus ?? "Unknown";
  const memberDataGapDocumented = !!society.memberDataGapDocumented;
  const memberDataReady = isMemberDataReady(memberDataAccessStatus, memberDataGapDocumented);
  const activeMembers = (members ?? []).filter((member) => member.status === "Active");
  const prefCoverage = activeMembers.filter((member) =>
    (prefs ?? []).some((pref) => String(pref.memberId) === String(member._id)),
  ).length;
  const missingPrefCoverage = activeMembers.length > 0 && prefCoverage < activeMembers.length;
  const recentTraining = (training ?? []).filter((item) => {
    const completedAt = item.completedAtISO ? new Date(item.completedAtISO).getTime() : 0;
    return completedAt >= Date.now() - 365 * 864e5;
  });
  const caslTrainingCount = recentTraining.filter((item) =>
    ["CASL", "Privacy-refresh", "PIPA"].includes(item.topic),
  ).length;
  const consentReady = communicationsEnabled && !missingPrefCoverage;
  const trainingReady = !trainingEnabled || caslTrainingCount > 0;
  const consentTrainingTone: StepTone =
    (!communicationsEnabled && !trainingEnabled)
      ? "info"
      : consentReady && trainingReady
        ? "success"
        : "warn";
  const completedSetupCount = [
    hasOfficer,
    privacyProgramDocumented,
    hasPolicyEvidence,
    memberDataReady,
    consentTrainingTone === "success" || consentTrainingTone === "info",
  ].filter(Boolean).length;

  const openPolicyDraft = async () => {
    if (policyDraft) {
      const prepared = preparePolicyDraftForSociety(policyDraft, society);
      setDraftEditor(editorStateFromDocument(prepared, "policy"));
      setDraftViewMode("edit");
      toast.success(
        prepared !== policyDraft
          ? "Filled policy draft with society details"
          : "Opened existing policy draft",
        prepared !== policyDraft ? "Review and save the draft to persist these template fields." : undefined,
      );
      return;
    }

    setDraftBusy(true);
    try {
      const result = await createPolicyDraft({ societyId: society._id });
      if (!result?.document) throw new Error("Draft document was not returned.");
      setDraftEditor(editorStateFromDocument(preparePolicyDraftForSociety(result.document, society), "policy"));
      setDraftViewMode("edit");
      toast.success(
        result.refreshed
          ? "Filled existing policy draft with society details"
          : result.reused
            ? "Opened existing policy draft"
            : "Policy draft created",
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Could not create the policy draft");
    } finally {
      setDraftBusy(false);
    }
  };

  const rebuildPolicyDraft = async () => {
    if (!draftEditor || draftEditor.kind !== "policy") return;
    const ok = await confirm({
      title: "Use current society details?",
      message:
        `This will replace the draft body with a fresh PIPA starter template filled with ${society.name}'s current Society page details. Any unsaved edits in this editor will be overwritten.`,
      confirmLabel: "Use society details",
      tone: "warn",
    });
    if (!ok) return;
    setDraftBusy(true);
    try {
      setDraftEditor({
        ...draftEditor,
        title: `Draft PIPA privacy policy - ${society.name}`,
        content: buildClientPipaPolicyDraft(society),
        tags: withDraftTags(draftEditor.tags, ["privacy", "privacy-policy", "pipa", "draft", "societyer-template", "society-filled"]),
      });
      setDraftViewMode("edit");
      toast.success("Policy draft filled from society details", "Review and save the draft to persist these template fields.");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not fill the draft from society details");
    } finally {
      setDraftBusy(false);
    }
  };

  const openMemberDataMemoDraft = async () => {
    setDraftBusy(true);
    try {
      const result = memberDataMemoDraft
        ? { document: memberDataMemoDraft, reused: true }
        : await createMemberDataGapMemoDraft({ societyId: society._id });
      if (!result?.document) throw new Error("Draft document was not returned.");
      setDraftEditor(editorStateFromDocument(result.document, "memberDataMemo"));
      setDraftViewMode("edit");
      toast.success(result.reused ? "Opened existing data-gap memo" : "Data-gap memo draft created");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not create the data-gap memo");
    } finally {
      setDraftBusy(false);
    }
  };

  const saveDraftEditor = async () => {
    if (!draftEditor) return;
    setDraftBusy(true);
    try {
      const updated = await updateDraftContent({
        id: draftEditor.id,
        title: draftEditor.title,
        content: draftEditor.content,
        tags: draftEditor.tags,
      });
      if (updated) setDraftEditor(editorStateFromDocument(updated, draftEditor.kind));
      toast.success("Draft saved");
    } catch (error: any) {
      toast.error(error?.message ?? "Draft save failed");
    } finally {
      setDraftBusy(false);
    }
  };

  const linkDraftAsEvidence = async () => {
    if (!draftEditor || draftEditor.kind !== "policy") return;
    const ok = await confirm({
      title: "Link as adopted evidence?",
      message:
        "Only do this after the draft has been reviewed and approved by the society. This links the document as PIPA policy evidence, but it does not file anything publicly.",
      confirmLabel: "Link evidence",
      tone: "warn",
    });
    if (!ok) return;
    setDraftBusy(true);
    try {
      await updateDraftContent({
        id: draftEditor.id,
        title: draftEditor.title,
        content: draftEditor.content,
        tags: Array.from(new Set([...draftEditor.tags.filter((tag) => tag !== "draft"), "adopted-evidence"])),
      });
      await linkPrivacyPolicyEvidence({ societyId: society._id, documentId: draftEditor.id });
      setDraftEditor(null);
      toast.success("Privacy policy evidence linked");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not link privacy policy evidence");
    } finally {
      setDraftBusy(false);
    }
  };

  const exportDraftToWord = () => {
    if (!draftEditor) return;
    exportMarkdownWordDoc({
      filename: `${slugifyFileName(draftEditor.title)}.doc`,
      title: draftEditor.title,
      markdown: draftEditor.content,
    });
    toast.success("Word document exported", "Uses the same rendered Markdown as the preview.");
  };

  const addPipaSetupMotions = async () => {
    const result = await seedPipaSetupMotions({ societyId: society._id });
    toast.success(
      result.inserted ? `Added ${result.inserted} PIPA setup motions` : "PIPA setup motions already exist",
      result.existing ? `${result.existing} already in the backlog.` : undefined,
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Privacy (PIPA)"
        subtitle={`A practical setup checklist for privacy policies, complaint handling, member-data access, consent, and training. ${LEGAL_COPY_REVIEWED}.`}
        actions={
          <>
            <button className="btn-action btn-action--primary" disabled={draftBusy} onClick={openPolicyDraft}>
              {policyDraft ? <PenLine size={12} /> : <Plus size={12} />}
              {policyDraft ? "Edit policy draft" : "Create policy draft"}
            </button>
            {communicationsEnabled && (
              <Link className="btn-action" to="/app/communications">
                Manage consent
              </Link>
            )}
          </>
        }
      />

      <Banner tone="info" title="Treat this as a setup workflow, not a public-registry filing">
        PIPA requires the society to adopt and follow privacy policies, practices, and a complaint process.
        A missing linked document in Societyer is an evidence gap; it is not normally a requirement to file a
        public registry privacy policy.
      </Banner>

      <div className="two-col privacy-layout">
        <div className="col privacy-main-col">
          <div className="card privacy-create-card">
            <div className="card__head">
              <div>
                <h2 className="card__title">
                  <FileText size={14} />
                  Create the policy document
                </h2>
                <p className="card__subtitle">
                  Start with a Societyer draft, edit it here, then link the final approved version as evidence.
                </p>
              </div>
            </div>
            <div className="card__body">
              <div className="privacy-document-path">
                <div className="privacy-document-path__copy">
                  <strong>{policyDraft ? policyDraft.title : "No starter privacy policy draft yet"}</strong>
                  <span>
                    {adoptedPolicyDocument
                      ? `${adoptedPolicyDocument.title} is linked as the adopted privacy policy evidence.`
                      : policyDraft
                        ? "Open the draft, tailor it to the society, and link it as evidence only after approval."
                        : "Create a Markdown draft populated with this society's name, privacy officer fields, member-data status, and PIPA baseline sections."}
                  </span>
                </div>
                <div className="privacy-document-path__actions">
                  <button className="btn btn--accent btn--sm" disabled={draftBusy} onClick={openPolicyDraft}>
                    {policyDraft ? <PenLine size={12} /> : <Plus size={12} />}
                    {policyDraft ? "Edit draft" : "Create draft"}
                  </button>
                  <button className="btn btn--ghost btn--sm" disabled={draftBusy} onClick={openMemberDataMemoDraft}>
                    {memberDataMemoDraft ? <PenLine size={12} /> : <Plus size={12} />}
                    {memberDataMemoDraft ? "Edit data memo" : "Create data memo"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card privacy-create-card">
            <div className="card__head">
              <div>
                <h2 className="card__title">
                  <ClipboardList size={14} />
                  Setup motions backlog
                </h2>
                <p className="card__subtitle">
                  Keep draft motions separate until you are ready to place them on a future agenda and seed them into minutes.
                </p>
              </div>
            </div>
            <div className="card__body">
              <div className="privacy-document-path">
                <div className="privacy-document-path__copy">
                  <strong>{pipaSetupMotionCount ? `${pipaSetupMotionCount} PIPA setup motions in backlog` : "No PIPA setup motions in backlog"}</strong>
                  <span>
                    Seed motions for designating the privacy officer, adopting the policy and complaint process, documenting member-data access, and setting the training review cycle.
                  </span>
                </div>
                <div className="privacy-document-path__actions">
                  <button className="btn btn--accent btn--sm" onClick={addPipaSetupMotions}>
                    <Plus size={12} />
                    Add setup motions
                  </button>
                  <Link className="btn btn--ghost btn--sm" to="/app/motion-backlog">
                    <ClipboardList size={12} /> Backlog
                  </Link>
                  <Link className="btn btn--ghost btn--sm" to="/app/agendas">
                    <CalendarPlus size={12} /> Agendas
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="card privacy-setup-card">
            <div className="card__head">
              <div>
                <h2 className="card__title">
                  <ClipboardCheck size={14} />
                  Privacy setup checklist
                </h2>
                <p className="card__subtitle">
                  {completedSetupCount}/5 baseline items are ready. Work through these before marking the program documented.
                </p>
              </div>
            </div>
            <div className="card__body privacy-step-list">
            <PrivacyStep
              icon={UserRound}
              title="Designate the privacy officer"
              status={hasOfficer ? "Ready" : "Needed"}
              tone={hasOfficer ? "success" : "warn"}
              citationIds={["PIPA-OFFICER"]}
              actions={<Link className="btn btn--ghost btn--sm" to="/app/society"><UserRound size={12} /> Society</Link>}
            >
              {hasOfficer ? (
                <>
                  Questions and complaints go to <strong>{society.privacyOfficerName}</strong> at {society.privacyOfficerEmail}.
                </>
              ) : (
                "Pick a role or person and a monitored email address for privacy questions, access requests, corrections, and complaints."
              )}
            </PrivacyStep>

            <PrivacyStep
              icon={FileText}
              title="Adopt the policy and complaint process"
              status={privacyProgramDocumented ? "Adopted" : "Draft/adopt"}
              tone={privacyProgramDocumented ? "success" : "warn"}
              citationIds={["PIPA-POLICY", "OIPC-PIPA-PRIVACY-POLICY-GUIDE"]}
              actions={(
                <>
                  <button className="btn btn--accent btn--sm" disabled={draftBusy} onClick={openPolicyDraft}>
                    {policyDraft ? <PenLine size={12} /> : <Plus size={12} />}
                    {policyDraft ? "Edit draft" : "Create draft"}
                  </button>
                  <Link className="btn btn--ghost btn--sm" to="/app/society"><FileText size={12} /> Program status</Link>
                </>
              )}
            >
              {privacyProgramDocumented ? (
                <>
                  The privacy program is marked documented
                  {society.privacyProgramReviewedAtISO ? ` and was reviewed ${formatDate(society.privacyProgramReviewedAtISO)}` : ""}.
                </>
              ) : (
                "Use the starter template as a draft, tailor it to the society's real systems, then approve the policy, complaint process, access/correction process, safeguards, and retention approach."
              )}
            </PrivacyStep>

            <PrivacyStep
              icon={FileCheck2}
              title="Link the adopted evidence"
              status={hasPolicyEvidence ? "Linked" : "Evidence gap"}
              tone={hasPolicyEvidence ? "success" : "info"}
              citationIds={["PIPA-POLICY"]}
              actions={(
                <>
                  {policyDraft && (
                    <button className="btn btn--ghost btn--sm" disabled={draftBusy} onClick={openPolicyDraft}>
                      <PenLine size={12} /> Review draft
                    </button>
                  )}
                  <Link className="btn btn--ghost btn--sm" to="/app/documents"><FileCheck2 size={12} /> Documents</Link>
                </>
              )}
            >
              {hasPolicyEvidence
                ? "An adopted privacy policy or equivalent evidence is linked in Documents."
                : "Once the policy/process is adopted, link the final version or board approval record here. Keep draft templates separate from adopted evidence."}
            </PrivacyStep>

            <PrivacyStep
              icon={UsersRound}
              title="Document member-data access"
              status={memberDataReady ? "Recorded" : "Needs memo"}
              tone={memberDataReady ? "success" : "warn"}
              citationIds={["PIPA-POLICY", "BC-SOC-RECORDS"]}
              actions={(
                <>
                  <button className="btn btn--ghost btn--sm" disabled={draftBusy} onClick={openMemberDataMemoDraft}>
                    {memberDataMemoDraft ? <PenLine size={12} /> : <Plus size={12} />}
                    {memberDataMemoDraft ? "Edit memo" : "Create memo"}
                  </button>
                  <Link className="btn btn--ghost btn--sm" to="/app/society"><UsersRound size={12} /> Data access</Link>
                </>
              )}
            >
              {memberDataStepText(memberDataAccessStatus, memberDataGapDocumented)}
            </PrivacyStep>

            <PrivacyStep
              icon={MailCheck}
              title="Track consent and training"
              status={consentTrainingLabel(communicationsEnabled, trainingEnabled, consentReady, trainingReady)}
              tone={consentTrainingTone}
              citationIds={["PIPA-CONSENT", "CASL-CONSENT"]}
              actions={(
                <>
                  {communicationsEnabled && (
                    <Link className="btn btn--ghost btn--sm" to="/app/communications"><MailCheck size={12} /> Consent</Link>
                  )}
                  {trainingEnabled && (
                    <Link className="btn btn--ghost btn--sm" to="/app/pipa-training"><GraduationCap size={12} /> Training</Link>
                  )}
                </>
              )}
            >
              {consentTrainingText({
                communicationsEnabled,
                trainingEnabled,
                activeMemberCount: activeMembers.length,
                prefCoverage,
                missingPrefCoverage,
                caslTrainingCount,
              })}
            </PrivacyStep>
          </div>
        </div>
        </div>

        <div className="col privacy-side-col">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Shield size={14} />
                Template and source material
              </h2>
            </div>
            <div className="card__body privacy-resource-list">
              <p className="privacy-note">
                Societyer can provide a starter policy draft. BC OIPC provides the BC-specific guidance; the federal OPC tool is only a drafting aid.
              </p>
              {PIPA_TEMPLATE_RESOURCES.map((resource) => (
                <ResourceRow
                  key={resource.title}
                  resource={resource}
                  onCreateDraft={resource.title.includes("starter") ? openPolicyDraft : undefined}
                  draftBusy={draftBusy}
                  hasDraft={!!policyDraft}
                />
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Shield size={14} />
                Policy baseline
              </h2>
            </div>
            <div className="card__body">
              <ul className="privacy-bullet-list">
                {PIPA_POLICY_REQUIREMENTS.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Records inspection rules</h2>
            </div>
            <div className="card__body">
              <ul className="privacy-bullet-list">
                {RECORDS_INSPECTION_GUIDANCE.map((item) => <li key={item}>{item}</li>)}
                <li>
                  Members' register is{" "}
                  {rules?.inspectionMemberRegisterByPublic ? <strong>available</strong> : <strong>not</strong>}{" "}
                  available to the public under the active rule set.
                </li>
                <li>
                  Members may inspect the member register: <strong>{rules?.inspectionMemberRegisterByMembers ? "yes" : "no"}</strong>.
                </li>
                <li>
                  Members may inspect the director register: <strong>{rules?.inspectionDirectorRegisterByMembers ? "yes" : "no"}</strong>.
                </li>
                <li>
                  {rules?.inspectionCopiesAllowed ? "Copies are allowed under the active rule set." : "Copies are restricted under the active rule set."}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={!!draftEditor}
        onClose={() => setDraftEditor(null)}
        title={draftEditor?.kind === "memberDataMemo" ? "Edit member-data gap memo" : "Edit privacy policy draft"}
        size="xl"
        footer={
          <>
            <button className="btn" disabled={draftBusy} onClick={() => setDraftEditor(null)}>
              Close
            </button>
            <button className="btn" disabled={draftBusy || !draftEditor} onClick={exportDraftToWord}>
              <FileDown size={12} />
              Export Word
            </button>
            {draftEditor?.kind === "policy" && (
              <>
                <button className="btn" disabled={draftBusy} onClick={rebuildPolicyDraft}>
                  <RefreshCw size={12} />
                  Use society details
                </button>
                <button className="btn" disabled={draftBusy} onClick={linkDraftAsEvidence}>
                  <FileCheck2 size={12} />
                  Link as adopted evidence
                </button>
              </>
            )}
            <button className="btn btn--accent" disabled={draftBusy} onClick={saveDraftEditor}>
              <Save size={12} />
              Save draft
            </button>
          </>
        }
      >
        {draftEditor && (
          <div className="privacy-editor">
            <Banner tone="warn" title={draftEditor.kind === "policy" ? "Draft first, evidence after approval" : "Document the data-access gap"}>
              {draftEditor.kind === "policy"
                ? "Edit the policy here. Use Link as adopted evidence only after the society has approved the final version."
                : "Record what the society controls, what the university or parent body controls, and the evidence for that conclusion."}
            </Banner>
            <Field label="Document title">
              <input
                className="input"
                value={draftEditor.title}
                onChange={(event) => setDraftEditor({ ...draftEditor, title: event.target.value })}
              />
            </Field>
            <div className="segmented privacy-editor__mode" role="tablist" aria-label="Draft view">
              <button
                type="button"
                role="tab"
                aria-selected={draftViewMode === "edit"}
                className={`segmented__btn ${draftViewMode === "edit" ? "is-active" : ""}`}
                onClick={() => setDraftViewMode("edit")}
              >
                Edit Markdown
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draftViewMode === "preview"}
                className={`segmented__btn ${draftViewMode === "preview" ? "is-active" : ""}`}
                onClick={() => setDraftViewMode("preview")}
              >
                Preview
              </button>
            </div>
            {draftViewMode === "edit" ? (
              <Field label="Markdown draft" hint="Replace bracketed placeholders before adoption.">
                <textarea
                  className="textarea privacy-editor__textarea"
                  value={draftEditor.content}
                  onChange={(event) => setDraftEditor({ ...draftEditor, content: event.target.value })}
                />
              </Field>
            ) : (
              <div
                className="privacy-editor__preview markdown-preview"
                aria-label="Rendered Markdown preview"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(draftEditor.content) }}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function PrivacyStep({
  icon: Icon,
  title,
  status,
  tone,
  citationIds,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  tone: StepTone;
  citationIds?: string[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`privacy-step privacy-step--${tone}`}>
      <span className="privacy-step__icon">
        <Icon size={14} aria-hidden="true" />
      </span>
      <div className="privacy-step__content">
        <div className="privacy-step__head">
          <strong>{title}</strong>
          <Badge tone={tone}>{status}</Badge>
        </div>
        <div className="privacy-step__body">{children}</div>
        <div className="privacy-step__footer">
          {citationIds && citationIds.length > 0 && (
            <div className="privacy-step__citations">
              {citationIds.map((citationId) => (
                <CitationBadge key={citationId} citationId={citationId} label={privacyCitationLabel(citationId)} />
              ))}
            </div>
          )}
          {actions && <div className="privacy-step__actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

function ResourceRow({
  resource,
  onCreateDraft,
  draftBusy,
  hasDraft,
}: {
  resource: (typeof PIPA_TEMPLATE_RESOURCES)[number];
  onCreateDraft?: () => void;
  draftBusy?: boolean;
  hasDraft?: boolean;
}) {
  const externalHref = "href" in resource ? resource.href : undefined;
  return (
    <div className="privacy-resource">
      <div className="privacy-resource__main">
        <strong>{resource.title}</strong>
        <div>{resource.body}</div>
        <div className="privacy-resource__citations">
          {resource.citationIds.map((citationId) => (
            <CitationBadge key={citationId} citationId={citationId} label={privacyCitationLabel(citationId)} />
          ))}
        </div>
      </div>
      {externalHref ? (
        <a className="btn btn--ghost btn--sm" href={externalHref} target="_blank" rel="noreferrer">
          <ExternalLink size={12} />
          Open
        </a>
      ) : onCreateDraft ? (
        <button className="btn btn--ghost btn--sm" disabled={draftBusy} onClick={onCreateDraft}>
          {hasDraft ? <PenLine size={12} /> : <Plus size={12} />}
          {hasDraft ? "Edit" : "Create"}
        </button>
      ) : (
        <Link className="btn btn--ghost btn--sm" to="/app/documents">
          <FileCheck2 size={12} />
          Documents
        </Link>
      )}
    </div>
  );
}

function editorStateFromDocument(document: any, kind: DraftEditorKind): DraftEditorState {
  return {
    id: document._id,
    kind,
    title: String(document.title ?? ""),
    content: String(document.content ?? ""),
    tags: Array.isArray(document.tags) ? document.tags : [],
  };
}

function preparePolicyDraftForSociety(document: any, society: any) {
  if (!isGenericPipaPolicyTemplate(document)) return document;
  return {
    ...document,
    title: `Draft PIPA privacy policy - ${society.name}`,
    content: buildClientPipaPolicyDraft(society),
    tags: withDraftTags(document.tags, ["privacy", "privacy-policy", "pipa", "draft", "societyer-template", "society-filled"]),
  };
}

function isGenericPipaPolicyTemplate(document: any) {
  const title = String(document.title ?? "").toLowerCase();
  const content = String(document.content ?? "");
  const hasGenericName = content.includes("[Legal organization name]") || content.includes("[legal name]");
  if (!hasGenericName) return false;
  return (
    title.includes("draft pipa privacy policy template") ||
    content.includes("This template is not legal advice") ||
    content.includes("PIPA Privacy Policy Template")
  );
}

function buildClientPipaPolicyDraft(society: any) {
  const today = new Date().toISOString().slice(0, 10);
  const legalName = valueOrPlaceholder(society.name, "Legal organization name");
  const privacyOfficerName = valueOrPlaceholder(society.privacyOfficerName, "Privacy officer role or name");
  const privacyOfficerEmail = valueOrPlaceholder(society.privacyOfficerEmail, "privacy email");
  const mailingAddress = valueOrPlaceholder(society.mailingAddress, "mailing address");
  const generalContactEmail = valueOrPlaceholder(society.officialEmail ?? society.publicContactEmail, "general contact email");
  const memberDataStatus = valueOrPlaceholder(society.memberDataAccessStatus, "Society-controlled / Partially available / Institution-held / Not applicable");

  return `# ${legalName} Privacy Policy

Draft created: ${today}

Status: Draft - not adopted until approved by the authorized board, executive, or officer.

This draft is a Societyer starter template based on BC PIPA guidance. It is not legal advice and it is not an official BC OIPC template. Replace bracketed text and remove options that do not apply before adoption.

## 1. Organization

${legalName} collects, uses, discloses, stores, and disposes of personal information in accordance with British Columbia's Personal Information Protection Act (PIPA) and other applicable laws.

- Legal name: ${legalName}
- Incorporation number: ${valueOrPlaceholder(society.incorporationNumber, "incorporation number, if applicable")}
- Mailing address: ${mailingAddress}
- General contact: ${generalContactEmail}

## 2. Privacy Officer

The privacy officer is responsible for privacy questions, access and correction requests, privacy complaints, and maintaining this policy.

- Privacy officer: ${privacyOfficerName}
- Email: ${privacyOfficerEmail}
- Mailing address: ${mailingAddress}

## 3. Personal Information We Collect

We collect only the personal information that is reasonable for our purposes. Depending on the activity, this may include:

- name and contact information;
- membership or eligibility information;
- director, officer, staff, contractor, and volunteer records;
- event registration and attendance information;
- communication preferences and mailing-list records;
- payment, reimbursement, grant, funding, accounting, or payroll records;
- application, intake, complaint, dispute, access-request, and correction-request records;
- meeting, election, referendum, filing, insurance, governance, and legal-compliance records; and
- technical information generated when people use our websites, forms, email systems, or other tools.

## 4. Why We Collect Personal Information

We may collect personal information to administer the organization, maintain required records, manage membership or eligibility where applicable, communicate with stakeholders, run meetings and programs, process payments or reimbursements, respond to privacy requests and complaints, protect safety and security, and meet legal, regulatory, audit, funding, insurance, and reporting obligations.

## 5. Consent, Use, and Disclosure

When we collect personal information directly from an individual, we explain the purpose for collection at or before collection unless the purpose is obvious and the individual voluntarily provides the information for that purpose.

We collect, use, and disclose personal information with consent unless PIPA or another law authorizes collection, use, or disclosure without consent. Access is limited to people who need the information for their role.

We do not sell personal information.

## 6. Member Records and Institution-Held Data

Current member-data access status in Societyer: ${memberDataStatus}.

Choose and adapt the correct member-records language before adoption. If a university or parent body holds the member list, describe what the society actually controls and keep a separate member-data access gap memo.

## 7. Safeguards

We protect personal information using safeguards appropriate to the sensitivity and amount of information. These may include role-limited access, password protection, multi-factor authentication where practical, restricted cloud folders, locked physical storage, secure deletion or disposal, training, service-provider controls, and access review after role changes.

## 8. Retention and Disposal

We keep personal information only as long as needed for the purpose for which it was collected, or as long as needed for legal, governance, funding, audit, insurance, tax, accounting, dispute-resolution, or business purposes.

If personal information is used to make a decision that directly affects an individual, we retain that information for at least one year after the decision so the individual has a reasonable opportunity to request access.

## 9. Access and Correction Requests

Individuals may ask for access to their own personal information under the organization's control. They may also ask how their information has been used and disclosed, and may request correction if they believe it is inaccurate.

Requests should be sent to the privacy officer. We may ask for information needed to confirm identity and locate records. We respond within the timelines required by law unless an extension or exception applies.

## 10. Complaints

Privacy complaints should be sent to the privacy officer. The organization will review the complaint, gather relevant information, respond within a reasonable time, and take appropriate corrective steps where needed.

If a complaint is not resolved, the individual may contact the Office of the Information and Privacy Commissioner for British Columbia.

## 11. Electronic Communications

Where electronic messages are subject to Canada's Anti-Spam Legislation (CASL), we send them only with an applicable consent basis, include required sender identification, and provide unsubscribe handling where required.

## 12. Adoption

Policy adopted by: [board / executive / authorized officer]

Adoption date: [YYYY-MM-DD]

Last review date: ${today}

Next review date: [YYYY-MM-DD]

`;
}

function valueOrPlaceholder(value: unknown, placeholder: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || `[${placeholder}]`;
}

function withDraftTags(existing: unknown, additions: string[]) {
  const tags = Array.isArray(existing) ? existing.map(String) : [];
  return Array.from(new Set([...tags, ...additions]));
}

function slugifyFileName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "privacy-policy-draft";
}

function isPrivacyPolicyDraft(document: any) {
  if (!document || document.archivedAtISO || document.flaggedForDeletion) return false;
  const tags = Array.isArray(document.tags) ? document.tags : [];
  const title = String(document.title ?? "").toLowerCase();
  return (
    (tags.includes("privacy-policy") && tags.includes("draft")) ||
    (title.includes("draft") && title.includes("privacy policy"))
  );
}

function isMemberDataMemoDraft(document: any) {
  if (!document || document.archivedAtISO || document.flaggedForDeletion) return false;
  const tags = Array.isArray(document.tags) ? document.tags : [];
  const title = String(document.title ?? "").toLowerCase();
  const normalizedTitle = title.replace(/[-_]+/g, " ");
  return (
    (tags.includes("member-data-gap") && tags.includes("draft")) ||
    (normalizedTitle.includes("draft") && normalizedTitle.includes("member data") && normalizedTitle.includes("gap"))
  );
}

function privacyCitationLabel(citationId: string) {
  switch (citationId) {
    case "PIPA-POLICY":
      return "PIPA s.5";
    case "PIPA-OFFICER":
      return "PIPA s.4";
    case "PIPA-CONSENT":
      return "PIPA consent";
    case "CASL-CONSENT":
      return "CASL consent";
    case "BC-SOC-RECORDS":
      return "Societies Act records";
    case "OIPC-PIPA-PRIVACY-POLICY-GUIDE":
      return "OIPC guide";
    case "OIPC-PRIVACYRIGHT-WRITE-POLICY":
      return "OIPC PrivacyRight";
    case "OPC-PRIVACY-PLAN-TOOL":
      return "Federal OPC tool";
    default:
      return undefined;
  }
}

function isMemberDataReady(status: string, gapDocumented: boolean) {
  if (status === "Unknown") return false;
  if ((status === "Institution-held" || status === "Partially available") && !gapDocumented) return false;
  return true;
}

function memberDataStepText(status: string, gapDocumented: boolean) {
  if (status === "Society-controlled") {
    return "The society controls the member list. Keep access restrictions, member-register handling, and retention rules current.";
  }
  if (status === "Institution-held") {
    return gapDocumented
      ? "The list is marked institution-held and the data-access gap memo is documented."
      : "The list is marked institution-held. Complete a member-data access gap memo that records what the university or parent body holds, what the society can access, and what evidence supports that conclusion.";
  }
  if (status === "Partially available") {
    return gapDocumented
      ? "Member data is marked partially available and the access gap is documented."
      : "Document which member records the society controls, which records remain with the university or parent body, and how requests will be handled.";
  }
  if (status === "Not applicable") {
    return "Member data access is marked not applicable. Keep the rationale with the privacy records.";
  }
  return "Choose whether the society controls the member list, partially has it, or relies on a university or parent body. If the society cannot access the list, document that gap.";
}

function consentTrainingLabel(
  communicationsEnabled: boolean,
  trainingEnabled: boolean,
  consentReady: boolean,
  trainingReady: boolean,
) {
  if (!communicationsEnabled && !trainingEnabled) return "Outside app";
  if (consentReady && trainingReady) return "Tracked";
  return "Review";
}

function consentTrainingText({
  communicationsEnabled,
  trainingEnabled,
  activeMemberCount,
  prefCoverage,
  missingPrefCoverage,
  caslTrainingCount,
}: {
  communicationsEnabled: boolean;
  trainingEnabled: boolean;
  activeMemberCount: number;
  prefCoverage: number;
  missingPrefCoverage: boolean;
  caslTrainingCount: number;
}) {
  const parts: string[] = [];
  if (!communicationsEnabled) {
    parts.push("Communication preferences are handled outside this workspace.");
  } else if (missingPrefCoverage) {
    parts.push(`${prefCoverage}/${activeMemberCount} active member communication preference records are on file.`);
  } else {
    parts.push("Communication preferences are tracked for active members.");
  }

  if (!trainingEnabled) {
    parts.push("Privacy/CASL training is handled outside this workspace.");
  } else if (caslTrainingCount > 0) {
    parts.push(`${caslTrainingCount} privacy/CASL training record${caslTrainingCount === 1 ? "" : "s"} logged in the last 12 months.`);
  } else {
    parts.push("No privacy/CASL training records are logged in the last 12 months.");
  }

  return parts.join(" ");
}
