import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Braces, Database, ExternalLink, Link2, PiggyBank } from "lucide-react";
import { useSociety } from "../../../hooks/useSociety";
import { PageHeader, SeedPrompt } from "../../../pages/_helpers";
import { Badge } from "../../../components/ui";
import { RecordShowPage } from "../../../components/RecordShowPage";
import { formatDate } from "../../../lib/format";
import { DetailCell } from "../components/WaveCacheExplorer";

function auditStatusTone(status: string) {
  if (status === "Audited") return "success";
  if (["ReviewEngagement", "Review engagement", "Compilation", "Compiled", "T2/GIFI"].includes(status)) return "info";
  return "warn";
}

function auditStatusLabel(status: string) {
  if (status === "ReviewEngagement") return "Review engagement";
  return status;
}

export function FinancialYearDetailPage() {
  const society = useSociety();
  const { fiscalYear: routeFiscalYear } = useParams();
  const fiscalYear = routeFiscalYear ? decodeURIComponent(routeFiscalYear) : "";
  const detail = useQuery(
    api.financials.detailByFiscalYear,
    society && fiscalYear ? { societyId: society._id, fiscalYear } : "skip",
  );

  if (society === undefined || detail === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const financial = detail.financial;
  const imports = detail.imports ?? [];
  const exactImports = financial ? imports.filter((row: any) => isExactStatementImport(financial, row)) : [];
  const relatedImports = imports.filter((row: any) => !exactImports.some((exact: any) => exact._id === row._id));
  const statementImports = exactImports.length > 0 ? [...exactImports, ...relatedImports] : imports;
  const documents = detail.documents ?? [];
  const lineCount = imports.reduce((sum: number, row: any) => sum + (row.lines?.length ?? 0), 0);

  if (!financial && imports.length === 0) {
    return (
      <div className="page">
        <PageHeader
          title={`FY ${fiscalYear || "financials"}`}
          icon={<PiggyBank size={16} />}
          iconColor="green"
          subtitle="No financial statement rows or import evidence were found for this fiscal year."
          actions={<Link className="btn-action" to="/app/financials"><ArrowLeft size={12} /> Back to financials</Link>}
        />
      </div>
    );
  }

  return (
    <RecordShowPage
      layout={{ societyId: society._id, pageId: "financial-year-detail", objectId: fiscalYear }}
      title={`FY ${fiscalYear} financials`}
      subtitle={financial ? `Period end ${formatDate(financial.periodEnd)}` : "Import evidence without an approved financial row."}
      icon={<PiggyBank size={16} />}
      iconColor="green"
      actions={<Link className="btn-action" to="/app/financials"><ArrowLeft size={12} /> Back</Link>}
      chips={
        <>
          {financial && <Badge tone={auditStatusTone(financial.auditStatus)}>{auditStatusLabel(financial.auditStatus)}</Badge>}
          {exactImports.length > 0 && <Badge tone="success">{exactImports.length} matched import{exactImports.length === 1 ? "" : "s"}</Badge>}
          {documents.length > 0 && <Badge tone="info">{documents.length} source document{documents.length === 1 ? "" : "s"}</Badge>}
          {lineCount > 0 && <Badge tone="neutral">{lineCount} line item{lineCount === 1 ? "" : "s"}</Badge>}
        </>
      }
      summary={[
        { label: "Revenue", value: financial ? moneyDetailed(financial.revenueCents) : "—" },
        { label: "Expenses", value: financial ? moneyDetailed(financial.expensesCents) : "—" },
        {
          label: "Net surplus / (deficit)",
          value: financial ? moneyDetailed(financial.revenueCents - financial.expensesCents) : "—",
        },
        { label: "Net assets", value: financial ? moneyDetailed(financial.netAssetsCents) : "—" },
        { label: "Restricted", value: financial ? moneyDetailed(financial.restrictedFundsCents) : "—" },
        { label: "Board approval", value: financial?.approvedByBoardAt ? formatDate(financial.approvedByBoardAt) : "—" },
      ]}
      tabs={[
        {
          id: "tables",
          label: "Tables",
          count: lineCount,
          icon: <Database size={14} />,
          content: (
            <StatementImportTables
              imports={statementImports}
              exactImportIds={new Set(exactImports.map((row: any) => row._id))}
            />
          ),
        },
        {
          id: "docs",
          label: "Docs",
          count: documents.length,
          icon: <Link2 size={14} />,
          content: <SourceDocumentsTable documents={documents} />,
        },
        {
          id: "imports",
          label: "Imports",
          count: imports.length,
          icon: <Braces size={14} />,
          content: (
            <ImportSummaryTable
              imports={imports}
              exactImportIds={new Set(exactImports.map((row: any) => row._id))}
            />
          ),
        },
      ]}
      inspector={
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Evidence status</h2>
          </div>
          <div className="card__body col">
            <DetailCell label="Financial row" value={financial?._id ?? "Not created"} mono />
            <DetailCell label="Matched imports" value={String(exactImports.length)} />
            <DetailCell label="Related imports" value={String(relatedImports.length)} />
            <DetailCell label="Source documents" value={String(documents.length)} />
            <DetailCell label="Line items" value={String(lineCount)} />
            <DetailCell label="Presented at meeting" value={detail.presentedAtMeeting?.title ?? "—"} />
          </div>
        </div>
      }
    />
  );
}

function StatementImportTables({
  imports,
  exactImportIds,
}: {
  imports: any[];
  exactImportIds: Set<string>;
}) {
  if (imports.length === 0) {
    return <div className="card"><div className="card__body muted">No statement import tables are linked to this fiscal year.</div></div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      {imports.map((row) => (
        <div className="card" key={row._id}>
          <div className="card__head">
            <div>
              <h2 className="card__title">{row.title}</h2>
              <span className="card__subtitle">
                {formatDate(row.periodEnd)} · {row.lines?.length ?? 0} line{(row.lines?.length ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {exactImportIds.has(row._id) && <Badge tone="success">Matches table row</Badge>}
              <Badge tone={row.status === "Verified" ? "success" : row.status === "Rejected" ? "danger" : "warn"}>{row.status}</Badge>
              <Badge tone={row.confidence === "High" ? "success" : row.confidence === "Medium" ? "info" : "warn"}>{row.confidence}</Badge>
            </div>
          </div>
          <div className="stat-grid" style={{ margin: "0 16px 16px" }}>
            <Stat label="Revenue" value={moneyDetailed(row.revenueCents)} />
            <Stat label="Expenses" value={moneyDetailed(row.expensesCents)} />
            <Stat label="Net assets" value={moneyDetailed(row.netAssetsCents)} />
            <Stat label="Restricted" value={moneyDetailed(row.restrictedFundsCents)} />
          </div>
          {row.lines?.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Line</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {row.lines.map((line: any) => (
                  <tr key={line._id}>
                    <td>{line.section}</td>
                    <td>{line.label}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{moneyDetailed(line.amountCents)}</td>
                    <td><Badge tone={line.confidence === "High" ? "success" : line.confidence === "Medium" ? "info" : "warn"}>{line.confidence}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="card__body muted">No line items were extracted for this import.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SourceDocumentsTable({ documents }: { documents: any[] }) {
  if (documents.length === 0) {
    return <div className="card"><div className="card__body muted">No source documents are linked to this fiscal year.</div></div>;
  }

  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">Source documents</h2>
        <span className="card__subtitle">{documents.length} linked document{documents.length === 1 ? "" : "s"}</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Source</th>
            <th>Category</th>
            <th>Created</th>
            <th>Access</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc._id}>
              <td>
                <strong>{doc.title}</strong>
                {doc.fileName && <div className="mono muted" style={{ fontSize: 11 }}>{doc.fileName}</div>}
              </td>
              <td className="table__cell--mono">{documentExternalId(doc) ?? "—"}</td>
              <td><Badge tone={documentCategoryTone(doc.category)}>{doc.category ?? "Document"}</Badge></td>
              <td className="table__cell--mono">{formatDate(doc.createdAtISO)}</td>
              <td>
                {doc.url ? (
                  <a className="btn btn--ghost btn--sm" href={doc.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} /> Open
                  </a>
                ) : (
                  <span className="muted">Metadata only</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportSummaryTable({ imports, exactImportIds }: { imports: any[]; exactImportIds: Set<string> }) {
  if (imports.length === 0) {
    return <div className="card"><div className="card__body muted">No import records are linked to this fiscal year.</div></div>;
  }

  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">Financial statement imports</h2>
        <span className="card__subtitle">Matched and related records for this fiscal year.</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Import</th>
            <th>Period end</th>
            <th>Status</th>
            <th>Revenue</th>
            <th>Expenses</th>
            <th>Net assets</th>
            <th>Lines</th>
            <th>Sources</th>
          </tr>
        </thead>
        <tbody>
          {imports.map((row) => (
            <tr key={row._id}>
              <td>
                <strong>{row.title}</strong>
                {exactImportIds.has(row._id) && <div><Badge tone="success">Matches table row</Badge></div>}
              </td>
              <td className="table__cell--mono">{formatDate(row.periodEnd)}</td>
              <td><Badge tone={row.status === "Verified" ? "success" : row.status === "Rejected" ? "danger" : "warn"}>{row.status}</Badge></td>
              <td className="table__cell--mono">{moneyDetailed(row.revenueCents)}</td>
              <td className="table__cell--mono">{moneyDetailed(row.expensesCents)}</td>
              <td className="table__cell--mono">{moneyDetailed(row.netAssetsCents)}</td>
              <td className="table__cell--mono">{row.lines?.length ?? 0}</td>
              <td>
                <div className="tag-list">
                  {(row.sourceExternalIds ?? []).map((id: string) => <Badge key={id}>{id}</Badge>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isExactStatementImport(financial: any, statementImport: any) {
  if (statementImport.periodEnd !== financial.periodEnd) return false;
  return (
    optionalCentsMatch(statementImport.revenueCents, financial.revenueCents) &&
    optionalCentsMatch(statementImport.expensesCents, financial.expensesCents) &&
    optionalCentsMatch(statementImport.netAssetsCents, financial.netAssetsCents)
  );
}

function optionalCentsMatch(importValue: number | undefined, financialValue: number | undefined) {
  return importValue == null || importValue === financialValue;
}

function moneyDetailed(cents?: number) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function documentExternalId(doc: any) {
  if (Array.isArray(doc.tags)) {
    const tag = doc.tags.find((value: string) => value.startsWith("paperless:"));
    if (tag) return tag;
  }
  try {
    const parsed = JSON.parse(doc.content ?? "{}");
    return parsed.externalId;
  } catch {
    return null;
  }
}

function documentCategoryTone(category: string): "success" | "warn" | "info" | "neutral" {
  if (category === "FinancialStatement") return "warn";
  if (category === "Restricted Paperless Source") return "warn";
  if (category === "Org History Source") return "info";
  return "neutral";
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "danger" ? "var(--danger)" : undefined }}>{value}</div>
    </div>
  );
}
