import { legalGovernanceProfile, type GovernanceOrganization } from "../../shared/legalGovernanceProfiles";
import { CitationBadge } from "./CitationTooltip";
import { Badge } from "./ui";
import { formatDueDate } from "../lib/format";

/** Legal inventory, separate from document completeness and workspace access. */
export function LegalRecordsRequirements({ organization, inspection = false }: { organization: GovernanceOrganization; inspection?: boolean }) {
  const profile = legalGovernanceProfile(organization);
  if (!profile) return <section className="card" style={{ marginBottom: 16 }}><div className="card__body"><strong>Review the records requirements for the governing Act.</strong><p>This entity does not have a verified records profile yet. Identify required registers, retention periods and requester-specific access rights before approving an inspection or disposal.</p></div></section>;
  return <section className="card" style={{ marginBottom: 16 }}>
    <div className="card__head"><h2 className="card__title">{inspection ? "Inspection rights by record category" : "Required records and retention"}</h2><Badge>{profile.name}</Badge></div>
    <div className="card__body">
      <p className="muted">A linked document or an empty register alone does not establish completeness, an access entitlement, or permission to destroy a record. Check conditional duties and any legal hold.</p>
      {profile.records.map((record) => <details key={record.key} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <summary style={{ cursor: "pointer" }}><strong>{record.label}</strong> <Badge tone={record.requirement === "statutory" ? "info" : "neutral"}>{record.requirement === "statutory" ? "Required" : record.requirement === "conditional" ? "Conditional" : "Recommended evidence"}</Badge></summary>
        <p><strong>Access. </strong>{record.access}</p><p><strong>Retention. </strong>{record.retention}</p>
        {record.caveat && <p>{record.caveat}</p>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{record.sourceIds.map((id) => <CitationBadge key={id} citationId={id} />)}</div>
      </details>)}
      <p className="muted">Source review: {formatDueDate(profile.reviewedOn)}. Statutory access rights are assessed separately from workspace permissions.</p>
    </div>
  </section>;
}
