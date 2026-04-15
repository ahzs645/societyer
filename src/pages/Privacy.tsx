import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Flag } from "../components/ui";
import { Shield } from "lucide-react";
import { useBylawRules } from "../hooks/useBylawRules";
import { useModuleEnabled } from "../hooks/useModules";

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
  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const hasPolicy = !!society.privacyPolicyDocId;
  const hasOfficer = !!society.privacyOfficerName && !!society.privacyOfficerEmail;
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

  return (
    <div className="page">
      <PageHeader
        title="Privacy (PIPA)"
        subtitle="BC's Personal Information Protection Act applies to non-profits. Adopt a privacy policy, designate a privacy officer, train staff, and comply with CASL."
        actions={communicationsEnabled ? (
          <Link className="btn-action" to="/app/communications">
            Manage consent
          </Link>
        ) : undefined}
      />

      <div className="two-col">
        <div className="col" style={{ gap: 12 }}>
          <Flag level={hasPolicy ? "ok" : "warn"}>
            {hasPolicy ? "PIPA privacy policy on file." : "No PIPA privacy policy uploaded. Add one in Documents."}
          </Flag>
          <Flag level={hasOfficer ? "ok" : "warn"}>
            {hasOfficer ? (
              <>
                Privacy officer: <strong>{society.privacyOfficerName}</strong> ({society.privacyOfficerEmail})
              </>
            ) : (
              "No privacy officer designated. Add one on the Society page."
            )}
          </Flag>
          <Flag level={!communicationsEnabled || missingPrefCoverage ? "warn" : "ok"}>
            {!communicationsEnabled
              ? "Communications module is disabled, so member consent preferences are not being tracked in-app."
              : missingPrefCoverage
                ? `${prefCoverage}/${activeMembers.length} active member communication preference records are on file.`
                : "Communication preference records are on file for active members."}
          </Flag>
          <Flag level={!trainingEnabled || caslTrainingCount > 0 ? "ok" : "warn"}>
            {!trainingEnabled
              ? "PIPA training module is disabled, so training records are being handled outside this workspace."
              : caslTrainingCount > 0
                ? `${caslTrainingCount} privacy/CASL training record${caslTrainingCount === 1 ? "" : "s"} logged in the last 12 months.`
                : "No privacy/CASL training records logged in the last 12 months."}
          </Flag>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title"><Shield size={14} /> What your policy must cover</h2>
            </div>
            <div className="card__body col">
              <Item>Why personal information is collected and how it will be used and disclosed.</Item>
              <Item>How information is stored and who can access it.</Item>
              <Item>How individuals can request access to or correction of their information.</Item>
              <Item>Retention period and secure disposal practices.</Item>
              <Item>Contact details for the privacy officer.</Item>
              <Item>CASL compliance for electronic communications (consent, identification, unsubscribe).</Item>
              <Item>Member notice preferences should be recorded before newsletters or bulk updates are sent.</Item>
            </div>
          </div>
        </div>

        <div className="card">
        <div className="card__head"><h2 className="card__title">Records inspection rules</h2></div>
        <div className="card__body col">
          <Item>Members and directors may inspect most records; bylaws may restrict accounting records and directors' minutes.</Item>
          <Item>
            Members' register is{" "}
            {rules?.inspectionMemberRegisterByPublic ? <strong>available</strong> : <strong>not</strong>}{" "}
            available to the public under the active rule set.
          </Item>
          <Item>
            Members may inspect the member register: <strong>{rules?.inspectionMemberRegisterByMembers ? "yes" : "no"}</strong>.
          </Item>
          <Item>
            Members may inspect the director register: <strong>{rules?.inspectionDirectorRegisterByMembers ? "yes" : "no"}</strong>.
          </Item>
          <Item>Public may inspect financial statements and auditor's reports on request.</Item>
          <Item>{rules?.inspectionCopiesAllowed ? "Copies are allowed under the active rule set." : "Copies are restricted under the active rule set."}</Item>
          <Item>Non-members may be charged up to $10/day for inspection and $0.50/page ($0.10 electronic) for copies.</Item>
          <Item>Keep a current consent log for notices, newsletters, and electronic reminders.</Item>
        </div>
      </div>
      </div>
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <span style={{ color: "var(--text-tertiary)" }}>•</span>
      <span style={{ color: "var(--text-secondary)" }}>{children}</span>
    </div>
  );
}
