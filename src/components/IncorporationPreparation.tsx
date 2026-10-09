import { ExternalLink } from "lucide-react";
import { InfoPopover } from "./InfoPopover";
import {
  incorporationPreparationForOrganization,
} from "../../shared/incorporationPreparation";
import type { LegalEntityLike } from "../../shared/organizationDomain";
import { PATHWAY_REGISTRY } from "../../shared/pathways/registry";

export function IncorporationPreparation({ organization }: { organization?: LegalEntityLike | null }) {
  const guide = incorporationPreparationForOrganization(organization);
  if (!guide) {
    return (
      <section className="card" style={{ padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Before incorporation</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Available preparation guides: {PATHWAY_REGISTRY.filter((entry) => entry.availability === "preparation" && entry.preparation).map((entry) => entry.title).join(", ")}.
          Confirm this workspace's entity type, jurisdiction, classification and governing Act to select an available guide.
        </p>
      </section>
    );
  }

  return (
    <section className="card" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{guide.title}</h2>
        <InfoPopover label="About filing">
          <p>{guide.statute}. Prepare the information here, then complete incorporation in the official registry service.</p>
          <p><strong>Online filing:</strong> {guide.filingChannel.summary}</p>
          <p><strong>Paper or mail:</strong> {guide.filingChannel.mailSummary}</p>
        </InfoPopover>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Prepare it here, then file with the registry.{" "}
        <a href={guide.filingChannel.onlineUrl} target="_blank" rel="noreferrer">Open official service <ExternalLink size={12} style={{ verticalAlign: "middle" }} /></a>
      </p>
      <details>
        <summary style={{ cursor: "pointer" }}>What to prepare ({guide.requirements.length} steps)</summary>
        <ol style={{ paddingLeft: 22 }}>
          {guide.requirements.map((requirement) => (
            <li key={requirement.key} style={{ marginBottom: 12 }}>
              <strong>{requirement.title}</strong>
              <p style={{ margin: "4px 0" }}>{requirement.detail}</p>
              <a href={requirement.sourceUrl} target="_blank" rel="noreferrer">Official source <ExternalLink size={11} style={{ verticalAlign: "middle" }} /></a>
            </li>
          ))}
        </ol>
        <h3 style={{ fontSize: 14 }}>Keep after incorporation</h3>
        <ul>{guide.retainedDocuments.map((document) => <li key={document}>{document}</li>)}</ul>
      </details>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer" }}>Sources and verification</summary>
        <p className="muted">Draft preparation guidance uses existing repository sources. Filing channels, fees, forms, and mail availability need a current registry check; these links were not reverified for this checklist.</p>
        <ul>
          {guide.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
              {source.evidenceDate ? ` — repository evidence dated ${source.evidenceDate}` : " — verify current instructions"}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
