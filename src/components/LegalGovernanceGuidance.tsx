import type { LegalEntityLike } from "../../shared/organizationDomain";
import { governancePageGuidance, type GovernanceGuidanceTopic } from "../lib/governancePageGuidance";
import { ChevronDown } from "lucide-react";
import { CitationBadge } from "./CitationTooltip";
import { useIsMobile } from "../lib/useIsMobile";

const TITLES: Record<GovernanceGuidanceTopic, string> = {
  conflicts: "Disclosure requirements and exceptions",
  auditors: "Audit requirement and appointment authority",
  court_orders: "Orders and governing records",
  qualifications: "Continuing director qualifications",
};

export function LegalGovernanceGuidance({ organization, topic }: { organization: LegalEntityLike; topic: GovernanceGuidanceTopic }) {
  const { profile, sources } = governancePageGuidance(organization, topic);
  // The guidance runs several paragraphs; on phones it starts folded so the
  // register itself is on the first screen.
  const isMobile = useIsMobile();
  return <details className="card legal-guidance" open={!isMobile}>
    <summary className="card__head legal-guidance__head">
      <h2 className="card__title">{TITLES[topic]}</h2>
      {sources.length > 0 && <span className="card__subtitle">{sources.length} {sources.length === 1 ? "source" : "sources"}</span>}
      <ChevronDown size={14} className="legal-guidance__chevron" aria-hidden="true" />
    </summary>
    <div className="card__body">
      {sources.length ? <>
        <p className="muted">{profile?.name}. Review the actual governing documents and any applicable exception.</p>
        {sources.map((source) => <div key={source.id} style={{ marginBottom: 12 }}>
          <p className="legal-guidance__summary">{source.summary} <CitationBadge citationId={source.id} /></p>
          {source.caveat && <p className="muted">{source.caveat}</p>}
        </div>)}
      </> : <p>Confirm the governing Act and entity-specific requirements. This organization does not yet have a reviewed legal profile for this topic.</p>}
      {topic === "conflicts" && <p className="muted">This register links disclosures to directors. Keep any separate officer or senior-manager disclosure with the relevant decision record. Record abstention, departure, permitted participation and the reason as facts from that decision.</p>}
      {topic === "court_orders" && <p className="muted">Link the entered order and record its court or tribunal, operative terms, filing requirements and deadlines. The order and applicable law determine who may inspect it and how long it must be kept.</p>}
      {topic === "qualifications" && <p className="muted">Qualifications apply continuously. An annual attestation is an optional governance practice unless the organization has separately adopted it. An unchecked item needs review; it does not by itself establish disqualification.</p>}
    </div>
  </details>;
}
