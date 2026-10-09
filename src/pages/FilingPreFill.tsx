import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../components/Toast";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Field, Badge } from "../components/ui";
import { Select } from "../components/Select";
import { FileCog, Copy, FileDown, ExternalLink, MoreHorizontal } from "lucide-react";
import { Menu } from "../components/Menu";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { formatDate } from "../lib/format";
import { humanizeKey } from "../../shared/documentProvenance";
import { exportWordDocx } from "../lib/docx";
import { escapeHtml } from "../lib/html";
import { isBcSociety } from "../../shared/organizationDomain";
import { BC_SOCIETY_PRE_FILL_KINDS, CRA_PRE_FILL_KINDS } from "../../shared/filingPreparation";
import { jurisdictionModuleContract } from "../../shared/jurisdictionWorkspace";

const PREFILL_LABELS: Record<string, string> = {
  societyName: "Society",
  charityName: "Charity",
  corporationName: "Corporation",
  incorporationNumber: "Incorporation number",
  agmHeldOn: "AGM held on",
  registeredOffice: "Registered office",
  mailingAddress: "Mailing address",
  newRegisteredOffice: "New registered office",
  newMailingAddress: "New mailing address",
  directors: "Directors",
  active: "Active directors",
  ceased: "Ceased directors",
  feeCad: "Fee",
  mustBeFiledWithin: "File within",
  specialResolutionRequired: "Special resolution required",
  thresholdPercent: "Approval threshold",
  fiscalPeriodEnd: "Fiscal period end",
  fiscalYear: "Fiscal year",
  totalRevenue: "Total revenue",
  totalExpenditures: "Total expenditures",
  totalExpenses: "Total expenses",
  netAssets: "Net assets",
  netIncome: "Net income",
  directorCount: "Active directors",
  dueDate: "Due",
  fullName: "Name",
  isBCResident: "BC resident",
  termStart: "Term start",
  consentOnFile: "Consent on file",
  resignedAt: "Resigned",
};
const PREFILL_MONEY_KEYS = new Set(["feeCad", "totalRevenue", "totalExpenditures", "totalExpenses", "netAssets", "netIncome"]);
const PREFILL_HIDDEN_KEYS = new Set(["formName", "form", "kind"]);
const cadFormatter = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function prefillLabel(key: string) {
  return PREFILL_LABELS[key] ?? humanizeKey(key);
}

/** One pre-fill value as a person reads it: dates, money, yes/no instead of raw JSON. */
function prefillValueText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (PREFILL_MONEY_KEYS.has(key)) return cadFormatter.format(value);
    if (key === "thresholdPercent") return `${value}%`;
    return String(value);
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return formatDate(value.slice(0, 10));
    return value;
  }
  return JSON.stringify(value);
}

function prefillRows(data: Record<string, unknown>) {
  return Object.entries(data).filter(([key]) => !PREFILL_HIDDEN_KEYS.has(key));
}

/** A list of people (directors) as one line each: name first, then the other facts. */
function prefillListItemParts(item: unknown): { title: string; details: string[] } {
  if (!item || typeof item !== "object") return { title: prefillValueText("", item), details: [] };
  const entries = Object.entries(item as Record<string, unknown>);
  const [first, ...rest] = entries;
  return {
    title: first ? prefillValueText(first[0], first[1]) : "—",
    details: rest
      .filter(([, value]) => value !== "" && value !== undefined && value !== null)
      .map(([key, value]) => (typeof value === "boolean" || key === "termStart" || key === "resignedAt")
        ? `${prefillLabel(key)}: ${prefillValueText(key, value)}`
        : prefillValueText(key, value)),
  };
}

function PrefillValue({ name, value }: { name: string; value: unknown }): ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">None</span>;
    return <ul className="review-kv__list">{value.map((item, index) => {
      const { title, details } = prefillListItemParts(item);
      return <li key={index}><strong>{title}</strong>{details.length > 0 && <span className="muted"> · {details.join(" · ")}</span>}</li>;
    })}</ul>;
  }
  return <>{prefillValueText(name, value)}</>;
}

function PrefillSummary({ data }: { data: Record<string, unknown> }) {
  return <dl className="review-kv">
    {prefillRows(data).map(([key, value]) => <div className="review-kv__row" key={key}>
      <dt>{prefillLabel(key)}</dt>
      <dd><PrefillValue name={key} value={value} /></dd>
    </div>)}
  </dl>;
}

function prefillValueHtml(key: string, value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return `<ul>${value.map((item) => {
      const { title, details } = prefillListItemParts(item);
      return `<li><strong>${escapeHtml(title)}</strong>${details.length ? ` · ${escapeHtml(details.join(" · "))}` : ""}</li>`;
    }).join("")}</ul>`;
  }
  return escapeHtml(prefillValueText(key, value));
}

export function FilingPreFillPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();
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
    const rows = prefillRows(data as Record<string, unknown>).map(([key, value]) =>
      `<tr><th>${escapeHtml(prefillLabel(key))}</th><td>${prefillValueHtml(key, value)}</td></tr>`).join("");
    try {
      await exportWordDocx({ filename: `prefill-${kind}.docx`, title: `${kind} pre-fill`,
        bodyHtml: `<h1>${escapeHtml((data as any).formName ?? (data as any).form ?? kind)}</h1><p>Preparation summary. Review and submit through the official government workflow.</p><table>${rows}</table>` });
    } catch (error: any) { toast.error("Could not export pre-fill", error?.message ?? String(error)); }
  };

  return <div className="page">
    <PageHeader title="Filing pre-fill" icon={<FileCog size={16} />} iconColor="orange"
      subtitle="Review a preparation summary before the official filing."
      info={<>
        <p>Preparing or exporting this summary does not file a return. Complete the official form or portal submission afterwards.</p>
        <p>Registry route: {jurisdiction.registryPortalLabel}. {supportsSocieties
          ? "BC society form preparation is available here. Confirm current fees and required evidence in the registry."
          : "This entity does not use BC Societies Online. Use its jurisdiction filing checklist and official registry; CRA preparation is separate."}</p>
        <p><Link to="/app/filings">Filing checklist and evidence</Link> · <Link to="/app/formation-maintenance">Formation and annual maintenance</Link></p>
      </>}
      actions={<>
        {registryUrl && <a className="btn-action" href={registryUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {jurisdiction.registryPortalLabel}</a>}
        <MoreActionsMenu items={[
          { id: "filings", label: "Filing checklist and evidence", onSelect: () => navigate("/app/filings") },
          { id: "formation", label: "Formation and annual maintenance", onSelect: () => navigate("/app/formation-maintenance") },
        ]} />
      </>} />
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
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <button className="btn-action btn-action--primary" disabled={!ready} onClick={() => void exportDoc()}><FileDown size={12} /> Export .docx</button>
        <Menu align="right" trigger={<button className="btn-action btn-action--icon" aria-label="More pre-fill actions" disabled={!ready}><MoreHorizontal size={14} /></button>}
          sections={[{ id: "copy", items: [{ id: "copy-json", label: "Copy as JSON", icon: <Copy size={14} />, disabled: !ready, onSelect: () => void copy() }] }]} />
      </div></div><div className="card__body">
        {!canRead ? <p className="muted">Filing read access is required.</p>
          : provider === "cra" && !canReadCRA ? <p className="muted">Financial read access is required for CRA preparation.</p>
          : provider === "cra" && !validYear ? <p className="muted">Enter a fiscal year to load the financial summary.</p>
          : !data ? <p className="muted">Loading pre-fill…</p>
          : (data as any).error ? <Badge tone="warn">{(data as any).error}</Badge>
          : <PrefillSummary data={data as Record<string, unknown>} />}
      {!canExport && <p className="muted">Your role can review this summary. Download permission is required to copy or export it.</p>}
    </div></div>
  </div>;
}
