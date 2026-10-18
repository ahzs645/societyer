import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Eye, Settings2 } from "lucide-react";
import { api } from "../../../lib/convexApi";
import { PageHeader, PageLoading } from "../../../pages/_helpers";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import { isStaticDemoRuntime } from "../../../lib/staticRuntime";
import { FolderSetupCard } from "../components/FolderSetupCard";
import { SnapshotReviewPage } from "./SnapshotReviewPage";
import { FilePreviewDialog, MAX_FILE_PREVIEW_BYTES } from "../../../components/FilePreviewDialog";
import { readProcurementDocument, type StoredProcurementDocument } from "../lib/documents";

export function ProcurementReviewPage() {
  return isStaticDemoRuntime() ? <SnapshotReviewPage /> : <HostedProcurementReview />;
}

type RecordSummary = { recordKey: string; kind: string; title: string; organization: string; date: string; status: string };
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
type Catalog = { generation: string; publishedAt: string; counts: Record<string, number> };
function label(kind: string) { return kind.replaceAll("-", " ").replaceAll("_", " "); }
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return; }
}

function HostedProcurementReview() {
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const [settings, setSettings] = useState(false);
  const folder = society?.integrationSettings?.procurementReviewFolder ?? "";
  const catalog = useQuery(api.procurementReview.catalog, society && loaded && folder ? { societyId: society._id } : "skip") as Catalog | null | undefined;
  if (!society || !loaded) return <PageLoading variant="detail" />;
  return <div className="page procurement-review">
    <PageHeader title="Procurement review" subtitle={catalog ? `Published ${new Date(catalog.publishedAt).toLocaleString()} · Read only` : "Bid opportunities and awards published by Zoer."}
      actions={can("settings:write") && <button className="btn btn--ghost btn--icon" aria-label="Procurement folder settings" onClick={() => setSettings(true)}><Settings2 size={16} /></button>} />
    {!folder || settings ? <FolderSetupCard societyId={society._id} folder={folder} canConfigure={can("settings:write")} onSaved={() => setSettings(false)} onCancel={folder ? () => setSettings(false) : undefined} />
      : catalog === undefined ? <p role="status">Loading procurement…</p>
      : catalog === null ? <div className="card"><div className="card__body"><h2>The catalog is being prepared</h2><p>Procurement records have not been imported for this workspace's folder yet. You can return here once the import is complete.</p></div></div>
      : <CatalogBrowser key={`${society._id}:${catalog.generation}`} societyId={society._id} catalog={catalog} />}
  </div>;
}

function CatalogBrowser({ societyId, catalog }: { societyId: string; catalog: Catalog }) {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") || "opportunity";
  const recordKey = params.get("record");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSearch(input.trim()), 250); return () => clearTimeout(timer); }, [input]);
  const choose = (key: string | null) => setParams(current => { const next = new URLSearchParams(current); key ? next.set("record", key) : next.delete("record"); return next; });
  return recordKey ? <RecordDetail societyId={societyId} generation={catalog.generation} recordKey={recordKey} onBack={() => choose(null)} /> : <>
    <div className="procurement-catalog__filters">
      <label className="field"><span>Catalog</span><select className="input" value={kind} onChange={event => { setStatus(""); setParams({ kind: event.target.value }); }}>
        {Object.keys(catalog.counts).sort((a, b) => (a === "opportunity" ? -1 : b === "opportunity" ? 1 : a.localeCompare(b))).map(value => <option value={value} key={value}>{label(value)} ({catalog.counts[value].toLocaleString()})</option>)}
      </select></label>
      <label className="field"><span>Search</span><input className="input" type="search" value={input} maxLength={200} placeholder="Title, organization, keyword…" onChange={event => setInput(event.target.value)} /></label>
      {kind === "opportunity" && <label className="field"><span>Status</span><select className="input" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{["Open", "Closed", "Awarded", "Cancelled"].map(value => <option key={value}>{value}</option>)}</select></label>}
    </div>
    <RecordPage key={`${kind}:${search}:${status}`} societyId={societyId} generation={catalog.generation} kind={kind} search={search} status={status} onSelect={choose} />
  </>;
}

function RecordPage(props: { societyId: string; generation: string; kind: string; search: string; status: string; onSelect: (key: string) => void }) {
  const { onSelect, ...args } = props;
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const page = useQuery(api.procurementReview.records, { ...args, paginationOpts: { numItems: 25, cursor: cursors[cursors.length - 1] } }) as Page<RecordSummary> | undefined;
  if (!page) return <p role="status">Loading records…</p>;
  return <section aria-label="Procurement records">
    {!page.page.length && <p className="muted">No records match these filters.</p>}
    <div className="procurement-catalog__list">{page.page.map(row => <button key={row.recordKey} className="procurement-catalog__record" onClick={() => onSelect(row.recordKey)}>
      <strong>{row.title}</strong><span>{row.organization}</span><span className="muted">{[row.status, row.date].filter(Boolean).join(" · ")}</span>
    </button>)}</div>
    <div className="procurement-catalog__pager"><button className="btn" disabled={cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</button><span>Page {cursors.length}</span><button className="btn" disabled={page.isDone} onClick={() => setCursors(values => [...values, page.continueCursor])}>Next</button></div>
  </section>;
}

type StoredDocument = StoredProcurementDocument;
function RecordDetail({ societyId, generation, recordKey, onBack }: { societyId: string; generation: string; recordKey: string; onBack: () => void }) {
  const args = { societyId, generation, recordKey };
  const record = useQuery(api.procurementReview.record, args) as { summary: RecordSummary; dataJson: string } | null | undefined;
  const [preview, setPreview] = useState<StoredDocument | null>(null);
  const loadPreview = useCallback((signal: AbortSignal) => {
    if (!preview) throw new Error("No document selected.");
    return readProcurementDocument(societyId, preview, signal);
  }, [societyId, preview]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = async (document: StoredDocument) => {
    if (busy) return;
    setBusy(document.documentKey); setError(null);
    try {
      const bytes = await readProcurementDocument(societyId, document);
      const url = URL.createObjectURL(new Blob([bytes], { type: document.mediaType }));
      const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file couldn't be downloaded."); }
    finally { setBusy(null); }
  };
  const data = record ? JSON.parse(record.dataJson) : null;
  const source = safeUrl(data?.detailUrl ?? data?.sourceUrl);
  return <div className="col">
    <button className="btn" style={{ alignSelf: "start" }} onClick={onBack}><ArrowLeft size={16} /> Back to catalog</button>
    {record === undefined ? <p role="status">Loading notice…</p> : !record ? <p>This record is no longer available in this published catalog.</p> : <>
      <div className="card"><div className="card__body col"><h2>{record.summary.title}</h2><p>{record.summary.organization} · {record.summary.status} {record.summary.date}</p>
        {source && <a href={source} target="_blank" rel="noopener noreferrer">View original notice</a>}
        {data.descriptionText && <p className="procurement-catalog__description">{String(data.descriptionText)}</p>}
        {Array.isArray(data.detailFields) ? <dl className="procurement-catalog__fields">{data.detailFields.map((field: any, index: number) => <div key={index}><dt>{String(field.label)}</dt><dd>{String(field.value ?? "")}</dd></div>)}</dl> : <dl className="procurement-catalog__fields">{Object.entries(data).filter(([key, value]) => !key.startsWith("_") && ["string", "number", "boolean"].includes(typeof value) && !["searchText", "descriptionText"].includes(key)).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{String(value)}</dd></div>)}</dl>}
        <details><summary>Source record</summary><pre className="procurement-catalog__json">{JSON.stringify(data, null, 2)}</pre></details>
      </div></div>
      <div className="card"><div className="card__body col"><h2>Documents</h2>{error && <p className="notice notice--danger" role="alert">{error}</p>}
        <DocumentPage {...args} busy={busy} download={download} onPreview={setPreview} />
      </div></div>
      <Evidence {...args} />
      {preview && <FilePreviewDialog file={{ id: `procurement:${societyId}:${generation}:${preview.documentKey}`, name: preview.name, mimeType: preview.mediaType, sha256: preview.sha256, bytes: preview.bytes }} loadBytes={loadPreview} onClose={() => setPreview(null)} onDownload={() => void download(preview)} downloading={busy !== null} />}
    </>}
  </div>;
}

function DocumentPage({ busy, download, onPreview, ...args }: { societyId: string; generation: string; recordKey: string; busy: string | null; download: (row: StoredDocument) => void; onPreview: (row: StoredDocument) => void }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const documents = useQuery(api.procurementReview.documents, { ...args, paginationOpts: { numItems: 10, cursor: cursors[cursors.length - 1] } }) as Page<StoredDocument> | undefined;
  return !documents ? <p role="status">Loading document names…</p> : <>
    {!documents.page.length && <p className="muted">No stored documents for this record.</p>}
    {documents.page.map(document => <div className="procurement-catalog__document" key={document.documentKey}><span>{document.name}</span>{document.available && <button className="btn" disabled={document.bytes > MAX_FILE_PREVIEW_BYTES} title={document.bytes > MAX_FILE_PREVIEW_BYTES ? "Inline preview supports files up to 25 MB" : "Preview document"} onClick={() => onPreview(document)}><Eye size={14} /> Preview</button>}<button className="btn" disabled={!document.available || busy !== null} onClick={() => download(document)}><Download size={14} />{busy === document.documentKey ? "Downloading…" : document.available ? `Download (${(document.bytes / 1024 / 1024).toFixed(1)} MB)` : "Not published"}</button></div>)}
    {(cursors.length > 1 || !documents.isDone) && <div className="procurement-catalog__pager"><button className="btn" disabled={cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous documents</button><button className="btn" disabled={documents.isDone} onClick={() => setCursors(values => [...values, documents.continueCursor])}>More documents</button></div>}
  </>;
}

function Evidence(args: { societyId: string; generation: string; recordKey: string }) {
  const [source, setSource] = useState("");
  const sources = ["reviews", "procurement_stage_runs", "procurement_requirements", "procurement_facts", "procurement_assessments", "procurement_decisions", "procurement_tasks", "procurement_changes", "procurement_matches", "procurement_judgements"];
  return <div className="card"><div className="card__body col"><h2>Published reviews and evidence</h2><label className="field"><span>Section</span><select className="input" value={source} onChange={event => setSource(event.target.value)}><option value="">Choose a section…</option>{sources.map(value => <option key={value} value={value}>{label(value.replace("procurement_", ""))}</option>)}</select></label>{source && <EvidencePage key={`${args.recordKey}:${source}`} {...args} source={source} />}</div></div>;
}
function EvidencePage(args: { societyId: string; generation: string; recordKey: string; source: string }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const result = useQuery(api.procurementReview.evidence, { ...args, paginationOpts: { numItems: 5, cursor: cursors[cursors.length - 1] } }) as Page<{ dataJson: string }> | undefined;
  if (!result) return <p role="status">Loading section…</p>;
  return <>{!result.page.length && <p className="muted">Nothing published in this section.</p>}{result.page.map((row, index) => <pre className="procurement-catalog__json" key={index}>{JSON.stringify(JSON.parse(row.dataJson), null, 2)}</pre>)}{(cursors.length > 1 || !result.isDone) && <div className="procurement-catalog__pager"><button className="btn" disabled={cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</button><button className="btn" disabled={result.isDone} onClick={() => setCursors(values => [...values, result.continueCursor])}>Next</button></div>}</>;
}
