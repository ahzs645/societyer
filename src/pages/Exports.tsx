import { useMemo, useState, type ReactNode } from "react";
import { useConvex, useQuery } from "convex/react";
import { CheckCircle2, Database, Download, FileJson, ShieldAlert } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Badge } from "../components/ui";
import { PageHeader, SeedPrompt } from "./_helpers";
import { escapeCsvCell } from "../lib/csv";
import { Select } from "../components/Select";

type TableSummary = {
  name: string;
  rowCount: number | null;
  exportable: boolean;
};

type Format = "csv" | "json";

type ImportPreview = {
  fileName: string;
  kind: string;
  societyName: string;
  sourceSocietyId: string;
  tableCount: number;
  exportedTableCount: number;
  totalRows: number;
  nonEmptyTables: number;
  binaryFilesIncluded: boolean;
  recoverySecretsIncluded: boolean;
  redactedFields: string[];
  issues: string[];
};

type ImportOverlapRow = {
  table: string;
  importRows: number;
  existingRows: number;
  nonOverlappingRows: number;
  overlappingIdCount: number;
  overlappingNaturalKeyCount: number;
  idSampled?: boolean;
  naturalKeySampled?: boolean;
  recommendedMode: "skip" | "restore-empty" | "merge-review" | "append-review";
  issues: string[];
};

type ImportPlan = {
  rows: ImportOverlapRow[];
  totalImportRows: number;
  totalExistingRows: number;
  totalOverlappingIds: number;
  totalOverlappingNaturalKeys: number;
  appendRows: number;
  replaceCandidates: number;
  sampledTables: number;
  recommendedMode: "restore-empty" | "merge-review" | "append-review";
  issues: string[];
};

export function ExportsPage() {
  const society = useSociety();
  const convex = useConvex();
  const [format, setFormat] = useState<Format>("csv");
  const [busy, setBusy] = useState<string | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [countBusy, setCountBusy] = useState(false);
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const [searchText, setSearchText] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [includeRecoverySecrets, setIncludeRecoverySecrets] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");

  const tableSummaries = useQuery(
    api.exports.listExportableTables,
    society ? { societyId: society._id } : "skip",
  ) as TableSummary[] | undefined;
  const validation = useQuery(
    api.exports.validateCurrentDatabase,
    society ? { societyId: society._id } : "skip",
  ) as any;

  const visibleTables = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return (tableSummaries ?? []).filter((table) => {
      const matchesSearch = !query || table.name.toLowerCase().includes(query);
      const count = tableCounts[table.name] ?? table.rowCount;
      const matchesEmpty = !hideEmpty || count == null || Number(count) > 0;
      return matchesSearch && matchesEmpty;
    });
  }, [hideEmpty, searchText, tableCounts, tableSummaries]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const download = async (table: string) => {
    setBusy(table);
    try {
      const rows = await fetchTableRows(table);
      const body = format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const mime = format === "csv" ? "text/csv" : "application/json";
      downloadBlob(body, mime, `${slug(society.name)}-${table}-${today()}.${format}`);
    } finally {
      setBusy(null);
    }
  };

  const downloadWorkspace = async () => {
    setWorkspaceBusy(true);
    try {
      const tables: Record<string, Array<Record<string, unknown>>> = {};
      const summaries: TableSummary[] = [];
      let totalRows = 0;

      for (const table of tableSummaries ?? []) {
        setBusy(table.name);
        const rows = await fetchTableRows(table.name);
        tables[table.name] = rows;
        summaries.push({ ...table, rowCount: rows.length });
        totalRows += rows.length;
      }

      const bundle = {
        kind: "societyer.workspaceExport",
        version: validation?.version ?? 2,
        generatedAtISO: new Date().toISOString(),
        society: tables.societies?.[0] ?? society,
        manifest: {
          societyId: society._id,
          societyName: society.name,
          tableCount: tableSummaries?.length ?? 0,
          exportedTableCount: Object.keys(tables).length,
          totalRows,
          redactedFields: includeRecoverySecrets ? ["storageId"] : ["secretEncrypted", "tokenHash", "storageId"],
          recoverySecretsIncluded: includeRecoverySecrets,
          binaryFilesIncluded: false,
          tables: summaries,
        },
        validation: {
          ok: true,
          version: validation?.version ?? 2,
          tableCount: tableSummaries?.length ?? 0,
          nonEmptyTableCount: summaries.filter((table) => Number(table.rowCount) > 0).length,
          totalRows,
          redactedFields: includeRecoverySecrets ? ["storageId"] : ["secretEncrypted", "tokenHash", "storageId"],
          recoverySecretsIncluded: includeRecoverySecrets,
          issues: [],
        },
        tables,
      };
      downloadBlob(
        JSON.stringify(bundle, null, 2),
        "application/json",
        `${slug(society.name)}-workspace-export-${today()}.json`,
      );
    } finally {
      setBusy(null);
      setWorkspaceBusy(false);
    }
  };

  const validateCounts = async () => {
    setCountBusy(true);
    try {
      for (const table of tableSummaries ?? []) {
        setBusy(table.name);
        const count = await countTableRows(table.name);
        setTableCounts((current) => ({ ...current, [table.name]: count }));
      }
    } finally {
      setBusy(null);
      setCountBusy(false);
    }
  };

  const fetchTableRows = async (table: string) => {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    do {
      const result = await convex.query(api.exports.exportTablePage, {
        societyId: society._id,
        table,
        includeRecoverySecrets,
        paginationOpts: { cursor, numItems: pageSizeFor(table) },
      });
      rows.push(...((result.page ?? []) as Array<Record<string, unknown>>));
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);
    setTableCounts((current) => ({ ...current, [table]: rows.length }));
    return rows;
  };

  const countTableRows = async (table: string) => {
    let count = 0;
    let cursor: string | null = null;
    do {
      const result = await convex.query(api.exports.countTablePage, {
        societyId: society._id,
        table,
        paginationOpts: { cursor, numItems: pageSizeFor(table) },
      });
      count += Number(result.count ?? 0);
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);
    return count;
  };

  const validationOk = validation?.ok === true;
  const countedRows = Object.values(tableCounts).reduce((sum, value) => sum + value, 0);
  const tablesReady = Boolean(tableSummaries?.length);
  const allTablesCounted = Boolean(tableSummaries?.length) && tableSummaries!.every((table) => tableCounts[table.name] != null);
  const totalRows = validation?.totalRows ?? (allTablesCounted ? countedRows : null);
  const redactedFields = includeRecoverySecrets ? ["storageId"] : ["secretEncrypted", "tokenHash", "storageId"];

  const inspectImportFile = async (file: File | undefined) => {
    setImportError("");
    setImportPreview(null);
    setImportPlan(null);
    if (!file) return;
    setImportBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const preview = inspectWorkspaceExport(parsed, file.name);
      setImportPreview(preview);
      setImportPlan(await previewWorkspaceImport(parsed));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not read export file.");
    } finally {
      setImportBusy(false);
    }
  };

  const previewWorkspaceImport = async (bundle: any): Promise<ImportPlan> => {
    const tables = bundle?.tables && typeof bundle.tables === "object" ? bundle.tables : {};
    const rows: ImportOverlapRow[] = [];
    for (const table of Object.keys(tables).sort()) {
      const tableRows = Array.isArray(tables[table]) ? tables[table] : [];
      if (tableRows.length === 0) continue;
      const source = sourceFingerprintForTable(table, tableRows);
      rows.push(await convex.query(api.exports.previewWorkspaceImportTable, {
        societyId: society._id,
        table,
        source,
      }) as ImportOverlapRow);
    }

    const totalImportRows = rows.reduce((sum, row) => sum + row.importRows, 0);
    const totalExistingRows = rows.reduce((sum, row) => sum + row.existingRows, 0);
    const totalOverlappingIds = rows.reduce((sum, row) => sum + row.overlappingIdCount, 0);
    const totalOverlappingNaturalKeys = rows.reduce((sum, row) => sum + row.overlappingNaturalKeyCount, 0);
    const appendRows = rows.reduce((sum, row) => sum + row.nonOverlappingRows, 0);
    const replaceCandidates = Math.max(totalOverlappingIds, totalOverlappingNaturalKeys);
    const sampledTables = rows.filter((row) => row.idSampled || row.naturalKeySampled).length;
    const issues = [
      ...(totalOverlappingIds > 0 ? [`${formatNumber(totalOverlappingIds)} exported row IDs already exist in this workspace.`] : []),
      ...(totalOverlappingNaturalKeys > 0 ? [`${formatNumber(totalOverlappingNaturalKeys)} likely duplicates were found by natural key.`] : []),
      ...(sampledTables > 0 ? [`${sampledTables} table${sampledTables === 1 ? "" : "s"} used sampled overlap checks.`] : []),
      ...(bundle?.manifest?.binaryFilesIncluded ? ["This export references an attachment manifest; binary rehydration is not part of this JSON preview."] : []),
      ...restoreLimitations(bundle),
    ];
    const recommendedMode = totalExistingRows === 0
      ? "restore-empty"
      : totalOverlappingIds > 0 || totalOverlappingNaturalKeys > 0
        ? "merge-review"
        : "append-review";
    return {
      rows,
      totalImportRows,
      totalExistingRows,
      totalOverlappingIds,
      totalOverlappingNaturalKeys,
      appendRows,
      replaceCandidates,
      sampledTables,
      recommendedMode,
      issues,
    };
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Data export"
        icon={<Database size={16} />}
        iconColor="blue"
        subtitle="Download workspace records, choose recovery redaction, and inspect export files before restore."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="muted">Format</span>
              <Select value={format} onChange={value => setFormat(value as Format)} options={[{
  value: "csv",
  label: "CSV"
}, {
  value: "json",
  label: "JSON"
}]} className="input" />
            </label>
            <button className="btn-action" disabled={countBusy || workspaceBusy || !tablesReady} onClick={validateCounts}>
              <CheckCircle2 size={12} /> {countBusy ? "Validating..." : "Validate rows"}
            </button>
            <button className="btn-action btn-action--primary" disabled={workspaceBusy || countBusy || !tablesReady} onClick={downloadWorkspace}>
              <FileJson size={12} /> {workspaceBusy ? "Exporting..." : "Export workspace"}
            </button>
          </div>
        }
      />

      <div className="stat-grid stat-grid--3">
        <Stat
          label="Validation"
          value={validation ? (validationOk ? "OK" : "Review") : "..."}
          icon={validationOk ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
          sub={validation ? `${validation.tableCount} schema tables covered` : "checking database coverage"}
        />
        <Stat
          label="Export rows"
          value={totalRows == null ? "Pending" : formatNumber(totalRows)}
          icon={<Database size={14} />}
          sub={
            totalRows == null
              ? "validate or export to count rows"
              : `${formatNumber(Object.values(tableCounts).filter((count) => count > 0).length)} non-empty tables`
          }
        />
        <Stat
          label="Redaction"
          value={includeRecoverySecrets ? "Recovery" : "On"}
          icon={<ShieldAlert size={14} />}
          sub={includeRecoverySecrets ? "encrypted secrets and token hashes included" : "storage IDs, token hashes, and encrypted secrets"}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">Export options</h2>
            <span className="card__subtitle">Recovery exports include encrypted secret ciphertext and API token hashes. Store them like credentials.</span>
          </div>
        </div>
        <div className="card__body">
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={includeRecoverySecrets}
              onChange={(event) => setIncludeRecoverySecrets(event.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Include recovery secrets</strong>
              <span className="muted" style={{ display: "block", fontSize: "var(--fs-sm)" }}>
                Keeps encrypted vault values, webhook encrypted secrets, and API token hashes in JSON exports. Storage IDs remain redacted.
              </span>
            </span>
          </label>
          <div className="muted" style={{ marginTop: 10, fontSize: "var(--fs-sm)" }}>
            Current redaction: {redactedFields.join(", ") || "none"}
          </div>
        </div>
      </div>

      {validation && !validation.ok && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Validation issues</h2>
            <Badge tone="danger">{validation.issues.length}</Badge>
          </div>
          <div className="card__body">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {validation.issues.map((issue: string) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">Import preview</h2>
            <span className="card__subtitle">Choose a workspace export JSON to inspect tables, rows, file manifest flags, and recovery-secret status before restore.</span>
          </div>
        </div>
        <div className="card__body">
          <input
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void inspectImportFile(event.target.files?.[0])}
            style={{ maxWidth: 420 }}
          />
          {importBusy && (
            <div className="notice notice--info" style={{ marginTop: 12 }}>
              Building import preview and checking overlap against the selected workspace...
            </div>
          )}
          {importError && (
            <div className="notice notice--danger" style={{ marginTop: 12 }}>
              {importError}
            </div>
          )}
          {importPreview && (
            <div className="stat-grid stat-grid--3" style={{ marginTop: 14 }}>
              <Stat label="Source" value={importPreview.societyName} icon={<FileJson size={14} />} sub={importPreview.fileName} />
              <Stat label="Rows" value={formatNumber(importPreview.totalRows)} icon={<Database size={14} />} sub={`${formatNumber(importPreview.exportedTableCount)} tables, ${formatNumber(importPreview.nonEmptyTables)} non-empty`} />
              <Stat
                label="Recovery"
                value={importPreview.recoverySecretsIncluded ? "Secrets" : "Redacted"}
                icon={<ShieldAlert size={14} />}
                sub={importPreview.binaryFilesIncluded ? "file manifest expected" : "JSON records only"}
              />
              {importPreview.issues.length > 0 && (
                <div className="notice notice--warning" style={{ gridColumn: "1 / -1" }}>
                  {importPreview.issues.join(" ")}
                </div>
              )}
            </div>
          )}
          {importPlan && (
            <div style={{ marginTop: 16 }}>
              <div className="stat-grid stat-grid--3">
                <Stat
                  label="Overlap"
                  value={formatNumber(importPlan.totalOverlappingIds + importPlan.totalOverlappingNaturalKeys)}
                  icon={<ShieldAlert size={14} />}
                  sub={`${formatNumber(importPlan.totalOverlappingIds)} ID, ${formatNumber(importPlan.totalOverlappingNaturalKeys)} likely duplicate`}
                />
                <Stat
                  label="Can append"
                  value={formatNumber(importPlan.appendRows)}
                  icon={<Database size={14} />}
                  sub="rows without same exported IDs in this workspace"
                />
                <Stat
                  label="Mode"
                  value={modeLabel(importPlan.recommendedMode)}
                  icon={<CheckCircle2 size={14} />}
                  sub={modeDescription(importPlan.recommendedMode)}
                />
              </div>
              {importPlan.issues.length > 0 && (
                <div className="notice notice--warning" style={{ marginTop: 12 }}>
                  {importPlan.issues.join(" ")}
                </div>
              )}
              <div className="notice notice--info" style={{ marginTop: 12 }}>
                This is a dry-run preview only. Generic workspace restore is intentionally blocked until the restore step can remap Convex IDs, rehydrate attachments, and write an audit record.
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Import</th>
                      <th>Existing</th>
                      <th>Overlap</th>
                      <th>Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPlan.rows
                      .filter((row) => row.importRows > 0)
                      .sort((a, b) => (b.overlappingIdCount + b.overlappingNaturalKeyCount) - (a.overlappingIdCount + a.overlappingNaturalKeyCount) || b.importRows - a.importRows)
                      .slice(0, 30)
                      .map((row) => (
                        <tr key={row.table}>
                          <td><strong>{row.table}</strong></td>
                          <td>{formatNumber(row.importRows)}</td>
                          <td>{formatNumber(row.existingRows)}</td>
                          <td>
                            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                              {row.overlappingIdCount > 0 && <Badge tone="warn">{formatNumber(row.overlappingIdCount)} IDs</Badge>}
                              {row.overlappingNaturalKeyCount > 0 && <Badge tone="warn">{formatNumber(row.overlappingNaturalKeyCount)} keys</Badge>}
                              {row.overlappingIdCount === 0 && row.overlappingNaturalKeyCount === 0 && <Badge tone="success">none</Badge>}
                              {(row.idSampled || row.naturalKeySampled) && <Badge tone="neutral">sampled</Badge>}
                            </div>
                          </td>
                          <td>{modeLabel(row.recommendedMode)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {importPlan.rows.length > 30 && (
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
                  Showing the 30 highest-risk tables from {formatNumber(importPlan.rows.length)} non-empty imported tables.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <h2 className="card__title">Tables</h2>
            <span className="card__subtitle">One file per table. Row counts fill in as validation or exports page through the current database.</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search tables..."
              style={{ width: 220, maxWidth: "100%" }}
            />
            <label className="row muted" style={{ gap: 6, alignItems: "center", fontSize: "var(--fs-sm)" }}>
              <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />
              Non-empty
            </label>
          </div>
        </div>
        <div className="card__body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))",
              gap: 8,
            }}
          >
            {visibleTables.map((table) => (
              (() => {
                const count = tableCounts[table.name] ?? table.rowCount;
                return (
              <button
                key={table.name}
                className="btn"
                disabled={busy !== null || workspaceBusy || countBusy}
                onClick={() => download(table.name)}
                style={{ justifyContent: "space-between" }}
              >
                <span className="row row--nowrap" style={{ gap: 8, minWidth: 0, overflow: "hidden" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{table.name}</span>
                  <Badge tone={count != null && Number(count) > 0 ? "info" : "neutral"}>
                    {count == null ? "pending" : formatNumber(Number(count))}
                  </Badge>
                </span>
                {busy === table.name ? <span className="muted">...</span> : <Download size={14} />}
              </button>
                );
              })()
            ))}
            {visibleTables.length === 0 && (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                No tables match this filter.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  sub: string;
}) {
  return (
    <div className="stat">
      <div className="stat__icon">{icon}</div>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      <div className="stat__sub">{sub}</div>
    </div>
  );
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows
    .map((row) => columns.map((col) => escapeCsvCell(serializeCell(row[col]))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

function serializeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function downloadBlob(body: string, mime: string, filename: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(value: string) {
  return value.replace(/\s+/g, "_").toLowerCase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function pageSizeFor(table: string) {
  return table === "documents" || table === "sourceEvidence" ? 25 : 100;
}

function inspectWorkspaceExport(value: any, fileName: string): ImportPreview {
  if (!value || typeof value !== "object") {
    throw new Error("The selected file is not a workspace export JSON object.");
  }
  if (value.kind !== "societyer.workspaceExport") {
    throw new Error("The selected file is not a Societyer workspace export.");
  }

  const manifest = value.manifest ?? {};
  const validation = value.validation ?? {};
  const tables = value.tables && typeof value.tables === "object" ? value.tables : {};
  const exportedTableCount = Number(manifest.exportedTableCount ?? Object.keys(tables).length ?? 0);
  const totalRows =
    Number(manifest.totalRows) ||
    Object.values(tables).reduce((sum: number, rows: any) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  const nonEmptyTables =
    Number(validation.nonEmptyTableCount) ||
    Object.values(tables).filter((rows: any) => Array.isArray(rows) && rows.length > 0).length;
  const redactedFields = Array.isArray(manifest.redactedFields)
    ? manifest.redactedFields.map(String)
    : Array.isArray(validation.redactedFields)
      ? validation.redactedFields.map(String)
      : [];
  const issues: string[] = [];

  if (!manifest.binaryFilesIncluded) {
    issues.push("This JSON does not include document binaries.");
  }
  if (!manifest.recoverySecretsIncluded) {
    issues.push("Encrypted secret values and API token hashes are redacted.");
  }
  if (redactedFields.includes("secretEncrypted") || redactedFields.includes("tokenHash")) {
    issues.push("This export cannot fully restore stored secrets or API tokens.");
  }
  if (!value.tables || typeof value.tables !== "object") {
    issues.push("No table payloads were found.");
  }

  return {
    fileName,
    kind: value.kind,
    societyName: String(manifest.societyName ?? value.society?.name ?? "Unknown society"),
    sourceSocietyId: String(manifest.societyId ?? value.society?._id ?? ""),
    tableCount: Number(manifest.tableCount ?? validation.tableCount ?? exportedTableCount),
    exportedTableCount,
    totalRows,
    nonEmptyTables,
    binaryFilesIncluded: manifest.binaryFilesIncluded === true,
    recoverySecretsIncluded: manifest.recoverySecretsIncluded === true,
    redactedFields,
    issues,
  };
}

function sourceFingerprintForTable(table: string, rows: Array<Record<string, unknown>>) {
  const sampleLimit = 5000;
  const sampledRows = rows.slice(0, sampleLimit);
  return {
    rowCount: rows.length,
    ids: sampledRows.map((row) => String(row._id ?? "")).filter(Boolean),
    naturalKeys: sampledRows.map((row) => naturalKeyForTable(table, row)).filter(Boolean) as string[],
    idSampled: rows.length > sampleLimit,
    naturalKeySampled: rows.length > sampleLimit,
  };
}

function restoreLimitations(bundle: any) {
  const manifest = bundle?.manifest ?? {};
  const redacted = Array.isArray(manifest.redactedFields) ? manifest.redactedFields.map(String) : [];
  const issues: string[] = [];
  if (redacted.includes("storageId")) {
    issues.push("Storage IDs are redacted, so document files must be rehydrated from the attachment manifest or another source.");
  }
  if (redacted.includes("secretEncrypted") || redacted.includes("tokenHash")) {
    issues.push("Stored secrets and API token hashes are redacted in this export.");
  }
  if (!bundle?.tables || typeof bundle.tables !== "object") {
    issues.push("No table payloads are available to restore.");
  }
  return issues;
}

function modeLabel(mode: ImportOverlapRow["recommendedMode"] | ImportPlan["recommendedMode"]) {
  if (mode === "restore-empty") return "Restore empty";
  if (mode === "merge-review") return "Merge review";
  if (mode === "append-review") return "Append review";
  return "Skip";
}

function modeDescription(mode: ImportPlan["recommendedMode"]) {
  if (mode === "restore-empty") return "target workspace has no rows in imported tables";
  if (mode === "merge-review") return "existing data overlaps; review before applying";
  return "no overlaps found; still needs ID remap before apply";
}

function naturalKeyForTable(table: string, row: Record<string, unknown>): string | null {
  const valuesByTable: Record<string, unknown[]> = {
    societies: [row.name],
    organizationAddresses: [row.type, row.street ?? row.address, row.city, row.postalCode],
    organizationRegistrations: [row.jurisdiction, row.registrationNumber],
    organizationIdentifiers: [row.kind ?? row.type, row.number],
    roleHolders: [row.roleType, row.fullName ?? row.name, row.startDate],
    users: [row.email, row.name],
    apiClients: [row.name],
    pluginInstallations: [row.slug],
    paperlessConnections: [row.baseUrl],
    financialConnections: [row.provider, row.externalId ?? row.name],
    waveCacheResources: [row.provider, row.resourceType, row.externalId],
    financialAccounts: [row.externalId, row.name, row.accountType],
    financialTransactions: [row.externalId, row.date, row.amountCents],
    budgets: [row.fiscalYear],
    budgetSnapshots: [row.fiscalYear, row.scenario, row.createdAtISO],
    financialStatementImports: [row.fiscalYear, row.periodLabel, row.sourceDocumentId],
    workflows: [row.name, row.eventType],
    workflowRuns: [row.workflowId, row.startedAtISO],
    membershipFeePeriods: [row.name, row.effectiveFrom],
    fundingSources: [row.name, row.sourceType],
    objectMetadata: [row.nameSingular, row.namePlural],
    fieldMetadata: [row.objectMetadataId, row.name],
    views: [row.objectMetadataId, row.name],
    members: [row.email, row.firstName, row.lastName],
    directors: [row.email, row.firstName, row.lastName, row.startDate],
    boardRoleAssignments: [row.personName, row.roleTitle, row.startDate],
    boardRoleChanges: [row.personName, row.roleTitle, row.effectiveDate, row.changeType],
    signingAuthorities: [row.personName, row.institutionName, row.effectiveDate],
    committees: [row.name],
    committeeMembers: [row.committeeId, row.memberName ?? row.personName, row.role],
    orgChartAssignments: [row.subjectType, row.subjectId],
    volunteers: [row.email, row.name],
    volunteerApplications: [row.email, row.name, row.createdAtISO],
    meetings: [row.title, row.scheduledAt],
    minutes: [row.meetingId, row.heldAt],
    meetingMaterials: [row.meetingId, row.documentId],
    documents: [row.title, row.category, row.fileName, row.createdAtISO],
    documentVersions: [row.documentId, row.version, row.fileName],
    sourceEvidence: [row.externalId, row.sourceTitle],
    filings: [row.kind, row.dueDate, row.filedAt],
    grants: [row.title, row.program, row.confirmationCode],
    grantApplications: [row.grantId, row.submittedAtISO],
    grantEmployeeLinks: [row.grantId, row.employeeId],
    deadlines: [row.title, row.dueDate],
    commitments: [row.title, row.status],
    policies: [row.policyName ?? row.name, row.effectiveDate],
    goals: [row.title],
    tasks: [row.title, row.dueDate],
    activity: [row.entityType, row.entityId, row.createdAtISO, row.type],
    notes: [row.entityType, row.entityId, row.createdAtISO],
    invitations: [row.email, row.createdAtISO],
    inspections: [row.title, row.scheduledAt],
    writtenResolutions: [row.title, row.resolutionDate],
    agmRuns: [row.meetingId],
    noticeDeliveries: [row.meetingId, row.recipientEmail],
    insurancePolicies: [row.policyNumber, row.policyTermLabel, row.insurer],
    pipaTrainings: [row.participantName, row.completedAtISO],
    proxies: [row.memberId, row.meetingId],
    auditorAppointments: [row.auditorName, row.fiscalYear],
    memberProposals: [row.title, row.submittedAtISO],
    elections: [row.title, row.opensAtISO],
    electionQuestions: [row.electionId, row.title],
    electionEligibleVoters: [row.electionId, row.memberId],
    electionBallots: [row.electionId, row.voterId],
    donationReceipts: [row.receiptNumber, row.donorEmail],
    employees: [row.email, row.name],
    courtOrders: [row.title, row.orderDate],
    bylawAmendments: [row.title, row.filedAtISO],
    agendas: [row.meetingId, row.title],
    agendaItems: [row.agendaId, row.position, row.title],
    meetingTemplates: [row.name],
    motionTemplates: [row.title, row.category],
    motionBacklog: [row.title, row.createdAtISO],
    recordsLocation: [row.title, row.address],
    secretVaultItems: [row.service, row.name],
    archiveAccessions: [row.accessionNumber, row.title],
  };
  const values = valuesByTable[table];
  if (!values) return null;
  const cleaned = values.map(normalizeKeyPart).filter(Boolean);
  return cleaned.length ? `${table}:${cleaned.join("|")}` : null;
}

function normalizeKeyPart(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}
