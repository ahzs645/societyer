import type { PayrollRuleProvenance } from "../../../shared/payrollRules";
export function PayrollRuleSnapshot({
  value,
  frozen,
}: {
  value: PayrollRuleProvenance;
  frozen: boolean;
}) {
  return (
    <details className="payroll-calculator__notice">
      <summary>
        {frozen ? "Frozen" : "Selected"} published rule edition · {value.name} ·
        revision {value.revision}
      </summary>
      <p>
        Published version {value.version} · reviewed {value.reviewedAtISO} ·
        published {value.publishedAtISO}.
      </p>
      <p>
        The calculation retains this edition’s complete parameters and reviewed
        source evidence.
      </p>
      <p className="payroll-calculator__fingerprint">
        Content fingerprint: {value.contentHash}
      </p>
      <ul>
        {value.sourceEvidence.map((source, index) => (
          <li key={index}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.authority}: {source.title}
            </a>{" "}
            · reviewed {source.reviewedOn}
            <p>{source.notes}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
