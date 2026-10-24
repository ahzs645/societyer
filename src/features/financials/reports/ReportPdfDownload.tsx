import { useState } from "react";
import { useQuery } from "convex/react";
import { FileDown } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Checkbox } from "../../../components/Controls";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import type { InvoiceTemplate } from "../../../../shared/invoiceCommerce";
import type { InvoiceOrganization } from "../../invoicing/types";
import type { BrandedReportData } from "./brandedReportTypes";
import { useReportDocumentTemplates } from "./useReportDocumentTemplates";
export type { BrandedReportData, BrandedReportChart, BrandedReportColumn, BrandedReportRow, BrandedReportSection } from "./brandedReportTypes";

type TemplateWorkspace = { organization: InvoiceOrganization; templates: Array<{ _id: string; config: InvoiceTemplate; active: boolean }>; defaultTemplateId: string | null };
/** PDF has its own explicit action so existing Excel/CSV choices stay unchanged. */
export function ReportPdfDownload({ societyId, report, filename, disabled, label = "Download branded PDF", organizationOverride }: { societyId: string; report: BrandedReportData | undefined; filename?: string; disabled?: boolean; label?: string; organizationOverride?: Partial<InvoiceOrganization> }) {
  const workspace = useQuery(api.invoices.documentTemplates, { societyId }) as TemplateWorkspace | undefined;
  const collection = useReportDocumentTemplates(societyId);
  const [chosen, setChosen] = useState<string | null>(null);
  const [includeGraphs, setIncludeGraphs] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const templates = collection.templates;
  const validChoice = chosen === "__organization" || templates.some((item) => item._id === chosen) ? chosen : null;
  const templateId = validChoice ?? workspace?.defaultTemplateId ?? "__organization";
  const selected = templates.find((item) => item._id === templateId);
  const run = async () => {
    if (!report || !workspace || !collection.ready || busy) return;
    setBusy(true);
    try {
      const { downloadBrandedReportPdf } = await import("./reportPdf");
      await downloadBrandedReportPdf({ report, template: selected?.config, organization: { ...workspace.organization, ...organizationOverride }, includeGraphs }, filename);
      toast.success("Downloaded", `${filename ?? report.title}.pdf`);
    } catch (error) {
      toast.error("PDF download failed", error instanceof Error ? error.message : undefined);
    } finally { setBusy(false); }
  };
  return <div className="books-report-pdf-actions" role="group" aria-label="Branded report PDF" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", marginBlock: 12 }}>
    <label className="finance-report-control"><span className="finance-report-control__label">PDF template</span><Select aria-label="PDF template" size="sm" disabled={!collection.ready || busy} value={selected ? templateId : "__organization"} onChange={setChosen} options={[{ value: "__organization", label: collection.ready ? "Organization branding" : "Loading templates…" }, ...templates.map((item) => ({ value: item._id, label: item.config.name }))]} /></label>
    {Boolean(report?.charts?.length || report?.blocks?.some((block) => block.kind === "chart")) && <Checkbox label="Include graphs" checked={includeGraphs} onChange={setIncludeGraphs} disabled={busy} />}
    {collection.error && <span role="alert">{collection.error} <button type="button" className="btn btn--sm" onClick={collection.retry}>Retry templates</button></span>}
    <button type="button" className="btn btn--sm" disabled={disabled || !report || !workspace || !collection.ready || busy} aria-busy={busy || !collection.ready || undefined} onClick={() => void run()}><FileDown size={14} aria-hidden="true" />{busy ? "Generating PDF…" : label}</button>
  </div>;
}
