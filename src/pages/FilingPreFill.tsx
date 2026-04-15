import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Field, Badge } from "../components/ui";
import { FileCog, Copy, FileDown } from "lucide-react";
import { exportWordDoc, escapeHtml } from "../lib/exportWord";

const SOCIETIES_KINDS = [
  { id: "AnnualReport", label: "Annual Report ($40)" },
  { id: "ChangeOfDirectors", label: "Change of Directors (free, 30 days)" },
  { id: "ChangeOfAddress", label: "Change of Address ($15)" },
  { id: "BylawAmendment", label: "Bylaw Amendment ($50)" },
  { id: "ConstitutionAlteration", label: "Constitution Alteration ($50)" },
];

const CRA_KINDS = [
  { id: "T3010", label: "T3010 Registered Charity Return" },
  { id: "T2", label: "T2 Corporation Income Tax" },
  { id: "T1044", label: "T1044 NPO Information Return" },
];

export function FilingPreFillPage() {
  const society = useSociety();
  const [provider, setProvider] = useState<"societies" | "cra">("societies");
  const [kind, setKind] = useState(SOCIETIES_KINDS[0].id);
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear() - 1));

  const societiesData = useQuery(
    api.filingExports.societiesOnlinePreFill,
    society && provider === "societies" ? { societyId: society._id, kind } : "skip",
  );
  const craData = useQuery(
    api.filingExports.craPreFill,
    society && provider === "cra" ? { societyId: society._id, kind, fiscalYear } : "skip",
  );
  const data = provider === "societies" ? societiesData : craData;

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const kinds = provider === "societies" ? SOCIETIES_KINDS : CRA_KINDS;

  const copy = () => {
    if (!data) return;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  const exportDoc = () => {
    if (!data) return;
    const eh = escapeHtml;
    const rows = Object.entries(data)
      .map(([k, v]) => {
        const val = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
        return `<tr><th>${eh(k)}</th><td><pre style="margin:0; font-family: Consolas, monospace; font-size: 10pt;">${eh(val)}</pre></td></tr>`;
      })
      .join("");
    exportWordDoc({
      filename: `prefill-${kind}.doc`,
      title: `${kind} pre-fill`,
      bodyHtml: `<h1>${eh((data as any).formName ?? kind)}</h1>
        <p class="meta">Generated ${eh(new Date().toLocaleString())}</p>
        <table>${rows}</table>`,
    });
  };

  return (
    <div className="page">
      <PageHeader
        title="Filing pre-fill"
        icon={<FileCog size={16} />}
        iconColor="orange"
        subtitle="Review the values we'd submit, then copy them into Societies Online or your CRA form. (Direct submission via RPA is on the roadmap — BC Registry has no public API yet.)"
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body">
          <div className="row" style={{ gap: 12 }}>
            <Field label="Provider">
              <select className="input" value={provider} onChange={(e) => {
                const p = e.target.value as "societies" | "cra";
                setProvider(p);
                setKind((p === "societies" ? SOCIETIES_KINDS : CRA_KINDS)[0].id);
              }}>
                <option value="societies">BC Societies Online</option>
                <option value="cra">CRA</option>
              </select>
            </Field>
            <Field label="Form">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </Field>
            {provider === "cra" && (
              <Field label="Fiscal year">
                <input className="input" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} />
              </Field>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">{(data as any)?.formName ?? kind}</h2>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button className="btn-action" onClick={copy}><Copy size={12} /> Copy JSON</button>
            <button className="btn-action btn-action--primary" onClick={exportDoc}><FileDown size={12} /> Export .doc</button>
          </div>
        </div>
        <div className="card__body">
          {!data ? (
            <div className="muted">Loading pre-fill…</div>
          ) : (data as any).error ? (
            <Badge tone="warn">{(data as any).error}</Badge>
          ) : (
            <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)", background: "var(--bg-subtle)", padding: 12, borderRadius: 6, overflow: "auto" }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
