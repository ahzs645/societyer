import { useMemo, useState, type ReactNode } from "react";
import { useConvex, useQuery } from "convex/react";
import { CheckCircle2, Database, Download, FileJson, ShieldAlert } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Badge } from "../components/ui";
import { PageHeader, SeedPrompt } from "./_helpers";

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
  tableCount: number;
  exportedTableCount: number;
  totalRows: number;
  nonEmptyTables: number;
  binaryFilesIncluded: boolean;
  recoverySecretsIncluded: boolean;
  redactedFields: string[];
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
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      setImportPreview(inspectWorkspaceExport(parsed, file.name));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not read export file.");
    }
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
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className="input"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
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
  const header = columns.map(csvEscape).join(",");
  const body = rows
    .map((row) => columns.map((col) => csvEscape(serializeCell(row[col]))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

function serializeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
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
