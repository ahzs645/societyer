import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../components/Toast";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Field, Badge } from "../components/ui";
import { Select } from "../components/Select";
import { FileCog, Copy, FileDown, ExternalLink } from "lucide-react";
import { exportWordDocx } from "../lib/docx";
import { escapeHtml } from "../lib/html";
import { isBcSociety } from "../../shared/organizationDomain";
import { BC_SOCIETY_PRE_FILL_KINDS, CRA_PRE_FILL_KINDS } from "../../shared/filingPreparation";
import { jurisdictionModuleContract } from "../../shared/jurisdictionWorkspace";

export function FilingPreFillPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const toast = useToast();
  const [selection, setSelection] = useState<{ workspace: string; provider: "societies" | "cra"; kind: string } | null>(null);
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear() - 1));
  const canRead = loaded && can("filings:read");
  const canReadCRA = canRead && can("financials:read");
  const canExport = loaded && can("exports:download");
  const supportsSocieties = !!society && isBcSociety(society);
  // Workspace changes recompute the route rather than reusing a previous entity's form.
  const requestedProvider = selection?.workspace === society?._id ? selection.provider : null;
  const provider = requestedProvider === "societies" && supportsSocieties ? "societies"
    : requestedProvider === "cra" && canReadCRA ? "cra" : supportsSocieties ? "societies" : "cra";
  const kinds = provider === "societies" ? BC_SOCIETY_PRE_FILL_KINDS
    : CRA_PRE_FILL_KINDS.filter(option => option.id !== "T3010" || society?.isCharity);
  const requestedKind = selection?.workspace === society?._id && selection.provider === provider ? selection.kind : null;
  const kind = kinds.find(option => option.id === requestedKind)?.id ?? kinds[0]?.id ?? "";
  const validYear = /^[1-9]\d{3}$/.test(fiscalYear);
  const societiesData = useQuery(api.filingExports.societiesOnlinePreFill,
    society && canRead && provider === "societies" && supportsSocieties ? { societyId: society._id, kind } : "skip");
  const craData = useQuery(api.filingExports.craPreFill,
    society && canReadCRA && provider === "cra" && validYear ? { societyId: society._id, kind, fiscalYear } : "skip");
  const data = provider === "societies" ? societiesData : craData;

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  const jurisdiction = jurisdictionModuleContract(society);
  const registryUrl = jurisdiction.filingKinds[0]?.registryUrl;
  const ready = !!data && !(data as any).error && canExport;
  const copy = async () => {
    if (!ready) return;
    try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); toast.success("Pre-fill copied"); }
    catch (error: any) { toast.error("Could not copy pre-fill", error?.message ?? "Clipboard access is unavailable."); }
  };
  const exportDoc = async () => {
    if (!ready) return;
    const rows = Object.entries(data).map(([key, value]) =>
      `<tr><th>${escapeHtml(key)}</th><td><pre style="margin:0;font-family:Consolas,monospace;font-size:10pt;">${escapeHtml(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value))}</pre></td></tr>`).join("");
    try {
      await exportWordDocx({ filename: `prefill-${kind}.docx`, title: `${kind} pre-fill`,
        bodyHtml: `<h1>${escapeHtml((data as any).formName ?? (data as any).form ?? kind)}</h1><p>Preparation summary. Review and submit through the official government workflow.</p><table>${rows}</table>` });
    } catch (error: any) { toast.error("Could not export pre-fill", error?.message ?? String(error)); }
  };

  return <div className="page">
    <PageHeader title="Filing pre-fill" icon={<FileCog size={16} />} iconColor="orange"
      subtitle="Review a preparation summary, then complete the official form or portal submission. Preparing or exporting this summary does not file a return." />
    <div className="card"><div className="card__body">
      <p className="muted">Registry route: {jurisdiction.registryPortalLabel}. {supportsSocieties
        ? "BC society form preparation is available below. Confirm current fees and required evidence in the registry."
        : "This entity does not use BC Societies Online. Use its jurisdiction filing checklist and official registry; CRA preparation is separate."}</p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Link className="btn-action" to="/app/filings">Filing checklist and evidence</Link>
        <Link className="btn-action" to="/app/formation-maintenance">Formation and annual maintenance</Link>
        {registryUrl && <a className="btn-action" href={registryUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {jurisdiction.registryPortalLabel}</a>}
      </div>
    </div></div>
    <div className="card"><div className="card__body"><div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <Field label="Provider"><Select value={provider} onChange={value => setSelection({ workspace: society._id, provider: value as "societies" | "cra", kind: "" })}
        options={[...(supportsSocieties ? [{ value: "societies", label: "BC Societies Online" }] : []), ...(canReadCRA ? [{ value: "cra", label: "CRA" }] : [])]} /></Field>
      <Field label="Form"><Select value={kind} onChange={value => setSelection({ workspace: society._id, provider, kind: value })}
        options={kinds.map(option => ({ value: option.id, label: option.label }))} /></Field>
      {provider === "cra" && <Field label="Fiscal year"><input className="input" inputMode="numeric" maxLength={4} value={fiscalYear} aria-invalid={!validYear}
        onChange={event => setFiscalYear(event.target.value)} />{!validYear && <p role="status" className="muted">Enter a four-digit fiscal year.</p>}</Field>}
    </div></div></div>
    <div className="card"><div className="card__head" style={{ flexWrap: "wrap", gap: 8 }}>
      <h2 className="card__title">{(data as any)?.formName ?? (data as any)?.form ?? kind}</h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button className="btn-action" disabled={!ready} onClick={() => void copy()}><Copy size={12} /> Copy JSON</button>
        <button className="btn-action btn-action--primary" disabled={!ready} onClick={() => void exportDoc()}><FileDown size={12} /> Export .docx</button>
      </div></div><div className="card__body">
        {!canRead ? <p className="muted">Filing read access is required.</p>
          : provider === "cra" && !canReadCRA ? <p className="muted">Financial read access is required for CRA preparation.</p>
          : provider === "cra" && !validYear ? <p className="muted">Enter a fiscal year to load the financial summary.</p>
          : !data ? <p className="muted">Loading pre-fill…</p>
          : (data as any).error ? <Badge tone="warn">{(data as any).error}</Badge>
          : <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)", background: "var(--bg-subtle)", padding: 12, borderRadius: 6, overflow: "auto" }}>{JSON.stringify(data, null, 2)}</pre>}
      {!canExport && <p className="muted">Your role can review this summary. Download permission is required to copy or export it.</p>}
    </div></div>
  </div>;
}
