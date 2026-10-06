import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useConvex, useQuery } from "convex/react";
import { CheckCircle2, Database, Download, FileJson, Archive, ShieldAlert } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { Badge } from "../components/ui";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { useToast } from "../components/Toast";
import { escapeCsvCell } from "../lib/csv";
import { buildWorkspaceArchive, readWorkspaceArchiveFile, archiveDatabaseSnapshot, type ArchiveManifest } from "../lib/workspaceArchive";
import { collectWorkspaceFiles, type AttachmentDownload } from "../lib/workspaceArchiveFiles";
import { triggerBlobDownload } from "../lib/zip";
import { localWorkspaceRestoreSupported, restoreLocalWorkspaceBackup } from "../lib/localWorkspaceExport";
import { useConfirm } from "../components/Modal";
import { setStoredSocietyId } from "../hooks/useSociety";

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
  archive?: ArchiveManifest;
};

export function ExportsPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canDownload = loaded && can("exports:download");
  const convex = useConvex();
  const toast = useToast();
  const confirm = useConfirm();
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
  const [progress, setProgress] = useState("");
  const [lastArchive, setLastArchive] = useState<ArchiveManifest | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);

  const tableSummaries = useQuery(
    api.exports.listExportableTables,
    society && canDownload ? { societyId: society._id } : "skip",
  ) as TableSummary[] | undefined;
  const validation = useQuery(
    api.exports.validateCurrentDatabase,
    society && canDownload ? { societyId: society._id } : "skip",
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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!loaded) return <PageLoading />;
  if (!canDownload) return (
    <div className="page">
      <PageHeader title="Data export" icon={<Database size={16} />} iconColor="blue" />
      <p role="status">Your workspace role does not include export downloads. Ask an Owner or Admin for access.</p>
    </div>
  );

  const download = async (table: string) => {
    setBusy(table);
    try {
      const rows = await fetchTableRows(table);
      const body = format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const mime = format === "csv" ? "text/csv" : "application/json";
      downloadBlob(body, mime, `${slug(society.name)}-${table}-${today()}.${format}`);
    } catch (error) {
      toast.error("Could not export table", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const downloadWorkspace = async (archive = true) => {
    setWorkspaceBusy(true);
    setLastArchive(null);
    setProgress("Preparing records…");
    try {
      const tables: Record<string, Array<Record<string, unknown>>> = {};
      const summaries: TableSummary[] = [];
      let totalRows = 0;

      for (const table of tableSummaries ?? []) {
        setProgress(`Records: ${summaries.length + 1} of ${tableSummaries?.length} tables · ${table.name}`);
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
      if (archive) {
        const attachments: AttachmentDownload[] = [];
        for (const source of ["documentVersions", "documents"] as const) {
          let cursor: string | null = null;
          const seen = new Set<string>();
          do {
            const result: any = await convex.query(api.exports.exportAttachmentPage, { societyId: society._id, source, paginationOpts: { cursor, numItems: 100 } });
            attachments.push(...result.page);
            cursor = result.isDone ? null : result.continueCursor;
            if (cursor && seen.has(cursor)) throw new Error("The file listing did not advance.");
            if (cursor) seen.add(cursor);
          } while (cursor);
        }
        const result = await buildWorkspaceArchive(bundle, add => collectWorkspaceFiles(tables, attachments, add, (done, total, name) => setProgress(`Files: ${done} of ${total} · ${name}`)), percent => setProgress(`Creating ZIP: ${Math.round(percent)}%`));
        setLastArchive(result.manifest);
        triggerBlobDownload(result.blob, `${slug(society.name)}-workspace-${today()}${result.manifest.completeStoredFiles ? "" : "-incomplete"}.zip`);
        if (result.manifest.completeStoredFiles) toast.success("ZIP export downloaded", `${totalRows.toLocaleString()} records and ${result.manifest.includedFiles} saved files.`);
        else toast.warn("Export downloaded with missing files", `${result.manifest.unavailableFiles} saved files are unavailable. Their details are in manifest.json.`);
      } else downloadBlob(
        JSON.stringify(bundle, null, 2),
        "application/json",
        `${slug(society.name)}-workspace-export-${today()}.json`,
      );
    } catch (error) {
      toast.error("Could not export workspace", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(null);
      setWorkspaceBusy(false);
      setProgress("");
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
    } catch (error) {
      toast.error("Could not validate rows", error instanceof Error ? error.message : "Please try again.");
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
  const nonEmptyTableCount = allTablesCounted ? Object.values(tableCounts).filter(count => count > 0).length : validation?.nonEmptyTableCount;
  const redactedFields = includeRecoverySecrets ? ["storageId"] : ["secretEncrypted", "tokenHash", "storageId"];

  const inspectImportFile = async (file: File | undefined) => {
    setImportError("");
    setImportPreview(null);
    setRestoreFile(null);
    if (!file) return;
    setPreviewBusy(true);
    try {
      const { database, manifest } = await readWorkspaceArchiveFile(file);
      archiveDatabaseSnapshot(database);
      const preview = inspectWorkspaceExport(database, file.name);
      if (manifest) {
        preview.binaryFilesIncluded = manifest.includedFiles > 0;
        preview.issues = preview.issues.filter(issue => !issue.includes("document binaries"));
        if (manifest.unavailableFiles) preview.issues.push(`${manifest.unavailableFiles} saved files were unavailable when exported.`);
        if (manifest.externalFiles) preview.issues.push(`${manifest.externalFiles} files are external links; their bytes are not bundled.`);
      }
      setImportPreview({ ...preview, archive: manifest });
      setRestoreFile(file);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not read export file.");
    } finally { setPreviewBusy(false); }
  };

  const restorePreview = async () => {
    if (!restoreFile || !await confirm({ title: "Restore this backup?", message: `Replace this device's current local workspace with "${restoreFile.name}"? Export its current records first if you need to keep them.`, confirmLabel: "Restore", tone: "danger" })) return;
    setRestoreBusy(true);
    try {
      const summary = await restoreLocalWorkspaceBackup(restoreFile);
      if (summary.societies[0]?._id) setStoredSocietyId(summary.societies[0]._id as any);
      toast.success("Backup restored", `${summary.rowCount} records and ${summary.includedFiles} saved files.`);
    } catch (error) { toast.error("Restore failed", error instanceof Error ? error.message : "Please try again."); }
    finally { setRestoreBusy(false); }
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Data export"
        icon={<Database size={16} />}
        iconColor="blue"
        subtitle="Export this organization's records and saved files, or inspect a backup before restoring it."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="muted">Table format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className="input"
                disabled={workspaceBusy || busy !== null}
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <button className="btn-action" disabled={countBusy || workspaceBusy || busy !== null || !tablesReady} onClick={validateCounts}>
              <CheckCircle2 size={12} /> {countBusy ? "Validating..." : "Validate rows"}
            </button>
            <button className="btn-action" disabled={workspaceBusy || countBusy || busy !== null || !tablesReady} onClick={() => void downloadWorkspace(false)}><FileJson size={12} /> Records JSON</button>
            <button className="btn-action btn-action--primary" disabled={workspaceBusy || countBusy || busy !== null || !tablesReady} onClick={() => void downloadWorkspace()}>
              <Archive size={12} /> {workspaceBusy ? "Exporting…" : "Export ZIP"}
            </button>
          </div>
        }
      />
      {progress && <div className="notice" role="status" aria-live="polite">{progress}</div>}
      {lastArchive && <div className={`notice ${lastArchive.completeStoredFiles ? "notice--success" : "notice--warning"}`} role="status">
        <strong>{lastArchive.completeStoredFiles ? "ZIP export ready" : "ZIP export has missing saved files"}</strong>
        <div>{lastArchive.rowCount.toLocaleString()} records · {lastArchive.tableCount} tables · {lastArchive.includedFiles} saved files · {lastArchive.externalFiles} external links · {lastArchive.unavailableFiles} unavailable files.</div>
        <div>Saved files include their checksum-verified bytes. External links remain in the records. The ZIP manifest lists every file's status.</div>
      </div>}

      <div className="stat-grid stat-grid--3">
        <Stat
          label="Record coverage"
          value={validation ? (validationOk ? "Ready" : "Review") : "..."}
          icon={validationOk ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
          sub={validation ? `${validation.tableCount} available tables; saved files are checked during ZIP export` : "checking database coverage"}
        />
        <Stat
          label="Export rows"
          value={totalRows == null ? "Pending" : formatNumber(totalRows)}
          icon={<Database size={14} />}
          sub={
            totalRows == null
              ? "validate or export to count rows"
              : `${formatNumber(nonEmptyTableCount ?? 0)} non-empty tables for this organization`
          }
        />
        <Stat
          label="Redaction"
          value={includeRecoverySecrets ? "Recovery" : "On"}
          icon={<ShieldAlert size={14} />}
          sub={includeRecoverySecrets ? "encrypted secrets and token hashes included" : "storage IDs, token hashes, and encrypted secrets"}
        />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">What's included</h2>
            <span className="card__subtitle">ZIP includes every accessible record table, embedded source images, uploaded files, saved originals, a file inventory, and restore instructions.</span>
          </div>
        </div>
        <div className="card__body">
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={includeRecoverySecrets}
              disabled={workspaceBusy || countBusy || busy !== null}
              onChange={(event) => setIncludeRecoverySecrets(event.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Include recovery secrets</strong>
              <span className="muted" style={{ display: "block", fontSize: "var(--fs-sm)" }}>
                Keeps encrypted vault values, webhook encrypted secrets, and API token hashes in ZIP and JSON records. Storage IDs remain redacted in the records.
              </span>
            </span>
          </label>
          <div className="muted" style={{ marginTop: 10, fontSize: "var(--fs-sm)" }}>
            Current redaction: {redactedFields.join(", ") || "none"}
          </div>
          <p className="muted">External-only links are retained; their files are not downloaded from the external service. Any saved file that cannot be read is clearly marked unavailable. For a full backup of every organization on this device and its retained change journal, use Settings → Workspace storage.</p>
          {localWorkspaceRestoreSupported() && <Link className="btn-action" to="/app/settings?tab=runtime">Open full device backup</Link>}
        </div>
      </div>

      {validation && !validation.ok && (
        <div className="card">
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

      <div className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Import preview</h2>
            <span className="card__subtitle">Choose a ZIP or JSON backup to inspect records, saved files, and recovery settings. ZIP checksums are verified before restore.</span>
          </div>
        </div>
        <div className="card__body">
          <input
            className="input"
            type="file"
            accept="application/json,application/zip,.json,.zip"
            disabled={previewBusy || restoreBusy || workspaceBusy}
            onChange={(event) => void inspectImportFile(event.target.files?.[0])}
            aria-label="Workspace backup ZIP or JSON"
            style={{ width: "100%", minWidth: 0, maxWidth: 420, boxSizing: "border-box" }}
          />
          {previewBusy && <p role="status">Checking backup and saved-file checksums…</p>}
          {importPreview?.archive && <p>{importPreview.archive.includedFiles} saved files · {importPreview.archive.externalFiles} external links · {importPreview.archive.unavailableFiles} unavailable files.</p>}
          {restoreFile && localWorkspaceRestoreSupported() && <button className="btn" disabled={restoreBusy || previewBusy} onClick={() => void restorePreview()}>{restoreBusy ? "Restoring…" : "Restore on this device"}</button>}
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
                sub={importPreview.archive ? `${importPreview.archive.includedFiles} saved files verified` : "JSON records only"}
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
  if (!["societyer.workspaceExport", "societyer.localWorkspaceSnapshot"].includes(value.kind)) {
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
  if (value.kind !== "societyer.localWorkspaceSnapshot" && !manifest.recoverySecretsIncluded) {
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
    societyName: String(manifest.societyName ?? value.society?.name ?? value.tables?.societies?.map((row: any) => row.name).join(", ") ?? "Unknown society"),
    tableCount: Number(manifest.tableCount ?? validation.tableCount ?? exportedTableCount),
    exportedTableCount,
    totalRows,
    nonEmptyTables,
    binaryFilesIncluded: manifest.binaryFilesIncluded === true,
    recoverySecretsIncluded: value.kind === "societyer.localWorkspaceSnapshot" || manifest.recoverySecretsIncluded === true,
    redactedFields,
    issues,
  };
}
