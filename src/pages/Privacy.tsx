import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import {
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  GraduationCap,
  MailCheck,
  Shield,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Banner } from "../components/ui";
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

type StepTone = "success" | "warn" | "info" | "neutral";

export function PrivacyPage() {
  const society = useSociety();
  const { rules } = useBylawRules();
  const communicationsEnabled = useModuleEnabled("communications");
  const trainingEnabled = useModuleEnabled("pipaTraining");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const training = useQuery(
    api.pipaTraining.list,
    society && trainingEnabled ? { societyId: society._id } : "skip",
  );
  const prefs = useQuery(
    api.communications.listMemberPrefs,
    society && communicationsEnabled ? { societyId: society._id } : "skip",
  );
  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const hasPolicyEvidence = !!society.privacyPolicyDocId;
  const hasOfficer = !!society.privacyOfficerName && !!society.privacyOfficerEmail;
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

  return (
    <div className="page">
      <PageHeader
        title="Privacy (PIPA)"
        subtitle={`A practical setup checklist for privacy policies, complaint handling, member-data access, consent, and training. ${LEGAL_COPY_REVIEWED}.`}
        actions={communicationsEnabled ? (
          <Link className="btn-action" to="/app/communications">
            Manage consent
          </Link>
        ) : undefined}
      />

      <Banner tone="info" title="Treat this as a setup workflow, not a public-registry filing">
        PIPA requires the society to adopt and follow privacy policies, practices, and a complaint process.
        A missing linked document in Societyer is an evidence gap; it is not normally a requirement to file a
        public registry privacy policy.
      </Banner>

      <div className="two-col privacy-layout">
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
              actions={<Link className="btn btn--ghost btn--sm" to="/app/society"><FileText size={12} /> Program status</Link>}
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
              actions={<Link className="btn btn--ghost btn--sm" to="/app/documents"><FileCheck2 size={12} /> Documents</Link>}
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
              actions={<Link className="btn btn--ghost btn--sm" to="/app/society"><UsersRound size={12} /> Data access</Link>}
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
                <ResourceRow key={resource.title} resource={resource} />
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
}: {
  resource: (typeof PIPA_TEMPLATE_RESOURCES)[number];
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
      ) : (
        <Link className="btn btn--ghost btn--sm" to="/app/documents">
          <FileCheck2 size={12} />
          Documents
        </Link>
      )}
    </div>
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
