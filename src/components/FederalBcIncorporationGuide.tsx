import { Link } from "react-router-dom";
import { FEDERAL_BC_PREPARATION } from "../../shared/federalBcIncorporation";
import { incorporationPreparationForOrganization } from "../../shared/incorporationPreparation";
import type { LegalEntityLike } from "../../shared/organizationDomain";

const requirementLabels = {
  required: "Required",
  conditional: "Conditional",
  decision: "Founder decision",
  recommended: "Recommended",
};

const visibilityLabels = {
  "public-filing": "Public filing",
  restricted: "Restricted record",
  internal: "Internal record",
  mixed: "Public and private parts",
};

function PreparationSources({ sourceIds }: { sourceIds: readonly string[] }) {
  const sources = FEDERAL_BC_PREPARATION.sources.filter((source) => sourceIds.includes(source.id));
  if (!sources.length) return null;
  return (
    <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>
      Sources: {sources.map((source, index) => (
        <span key={source.id}>
          {index > 0 ? " · " : ""}
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </span>
      ))}
    </p>
  );
}

/** Static preparation guidance. It never reads or collects founder particulars. */
export function FederalBcIncorporationGuide({ organization }: { organization?: LegalEntityLike | null }) {
  if (incorporationPreparationForOrganization(organization)?.id !== "federal_cbca") return null;
  const guide = FEDERAL_BC_PREPARATION;
  const fieldCount = guide.sections.reduce((count, section) => count + section.fields.length, 0);

  return (
    <details style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)", overflowWrap: "anywhere" }}>
      <summary style={{ cursor: "pointer", padding: "6px 0" }}>
        <strong>Detailed federal and BC preparation checklist</strong> ({fieldCount} information items)
      </summary>
      <h3 style={{ fontSize: 16 }}>{guide.title}</h3>
      <p>{guide.scope}</p>
      <p className="muted">This detailed inventory was reviewed on <time dateTime={guide.reviewedOn}>{guide.reviewedOn}</time>. Check the linked official instructions when filing; the review date applies to this inventory.</p>
      <p>{guide.privacyNote}</p>
      <p><Link to="/app/document-catalog">Download the complete preparation worksheet from Document catalog</Link>.</p>

      <details style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <summary style={{ cursor: "pointer" }}><strong>Filing and organization sequence</strong></summary>
        <ol style={{ paddingLeft: 22 }}>
          {guide.sequence.map((step) => (
            <li key={step.id} style={{ marginBottom: 14 }}>
              <strong>{step.title}</strong>
              <p style={{ margin: "6px 0" }}>{step.detail}</p>
              <PreparationSources sourceIds={step.sourceIds} />
            </li>
          ))}
        </ol>
      </details>

      {guide.sections.map((section) => (
        <details key={section.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
          <summary style={{ cursor: "pointer" }}><strong>{section.title}</strong> ({section.fields.length} items)</summary>
          <p>{section.summary}</p>
          <ul style={{ paddingLeft: 22 }}>
            {section.fields.map((field) => (
              <li key={field.id} style={{ marginBottom: 18 }}>
                <strong>{field.label}</strong>
                <p className="muted" style={{ margin: "4px 0", fontSize: 12 }}>
                  {requirementLabels[field.requirement]} · {visibilityLabels[field.visibility]}
                </p>
                {field.appliesWhen && <p style={{ margin: "6px 0" }}><strong>Applies when: </strong>{field.appliesWhen}</p>}
                <p style={{ margin: "6px 0" }}>{field.detail}</p>
                <PreparationSources sourceIds={field.sourceIds} />
              </li>
            ))}
          </ul>
        </details>
      ))}

      <details style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <summary style={{ cursor: "pointer" }}><strong>Rules and decisions to check</strong></summary>
        <ul style={{ paddingLeft: 22 }}>
          {guide.rules.map((rule) => (
            <li key={rule.id} style={{ marginBottom: 14 }}>
              <strong>{rule.title}</strong>
              <p style={{ margin: "6px 0" }}>{rule.detail}</p>
              <PreparationSources sourceIds={rule.sourceIds} />
            </li>
          ))}
        </ul>
      </details>

      <details style={{ padding: "10px 0" }}>
        <summary style={{ cursor: "pointer" }}><strong>Sources for this detailed inventory</strong></summary>
        <ul style={{ paddingLeft: 22 }}>
          {guide.sources.map((source) => (
            <li key={source.id} style={{ marginBottom: 6 }}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.label}<span className="sr-only"> (opens in a new tab)</span></a>
            </li>
          ))}
        </ul>
      </details>
    </details>
  );
}
