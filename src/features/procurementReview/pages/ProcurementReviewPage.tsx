import { lazy, Suspense, useEffect, useMemo, useState, useRef, useCallback, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { RefreshCw, Settings2, TriangleAlert } from "lucide-react";
import { api } from "../../../lib/convexApi";
import { PageHeader, PageLoading } from "../../../pages/_helpers";
import { Tooltip } from "../../../components/Tooltip";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import { isStaticDemoRuntime } from "../../../lib/staticRuntime";
import { FolderSetupCard } from "../components/FolderSetupCard";
import { CatalogSourceControls } from "../components/CatalogSourceControls";
import { ProcurementReader } from "../reader/ProcurementReader";
import { useConvexReaderSource } from "../reader/convexSource";
import type { ReaderCatalog, ReaderSource } from "../reader/source";
import { createHttpReaderSource, useCatalogAccess, type ServiceCatalog } from "../reader/httpSource";
import { useWorkspaceTriage } from "../reader/triage";
import { exactWhen, sinceWhen } from "../reader/summary";
import { CatalogFreshness } from "../reader/CatalogFreshness";
import { useProcurementClock } from "../lib/clock";
import { readLastCatalog, rememberCatalog } from "../lib/lastCatalog";

type PublicationStatus = {
  state: "unconfigured" | "empty" | "ready" | "available" | "importing" | "stalled" | "failed";
  lastSuccessful: { generation: string; publishedAt: string; collectedAt: string | null; activatedAt: number | null; counts: Record<string, number> } | null;
  source: { generation: string; publishedAt: string; collectedAt: string | null; complete: boolean; phase: string; error: string | null; heartbeatAt: number | null } | null;
  run: { id: string; applied: number; operations: number; nextBatch: number; heartbeatAt: number; error: string | null } | null;
  recovery: string | null;
};

/** The no-login demo's bundled-snapshot reader (plugin bridge, catalog worker) is never needed by a signed-in workspace. */
const SnapshotReviewPage = lazy(() => import("./SnapshotReviewPage").then((m) => ({ default: m.SnapshotReviewPage })));

export function ProcurementReviewPage() {
  return isStaticDemoRuntime()
    ? <Suspense fallback={<PageLoading variant="detail" />}><SnapshotReviewPage /></Suspense>
    : <HostedSourceChoice />;
}

function HostedSourceChoice() {
  const society = useSociety();
  const [params] = useSearchParams(), preview = params.get("catalogPreview") === "service";
  return society && (society.integrationSettings?.procurementCatalogSource === "service" || preview) && society.integrationSettings?.procurementReviewFolder
    ? <ServiceHost key={society._id} societyId={society._id} preview={preview} /> : <HostedProcurementReview />;
}
function ServiceHost({ societyId, preview }: { societyId: string; preview: boolean }) {
  const configuration = useQuery(api.procurementCatalog.configuration, { societyId, preview }) as { source: string; baseUrl: string | null } | undefined;
  return configuration?.baseUrl ? <ServiceReaderHost societyId={societyId} baseUrl={configuration.baseUrl} preview={preview && configuration.source !== "service"} /> : <PageLoading variant="detail" />;
}
function ServiceReaderHost({ societyId, baseUrl, preview }: { societyId: string; baseUrl: string; preview: boolean }) {
  const { can, loaded } = usePermissions(), [settings, setSettings] = useState(false);
  const access = useCatalogAccess(societyId, baseUrl);
  const triage = useWorkspaceTriage(societyId);
  const publication = useQuery(api.procurementStatus.get, { societyId }) as PublicationStatus | undefined;
  const [source, setSource] = useState<ReaderSource | null>(null), [error, setError] = useState<string | null>(null);
  const current = useRef<ReaderSource | null>(null), sequence = useRef(0);
  const refresh = useCallback(async (live: () => boolean = () => true) => {
    const attempt = ++sequence.current;
    try {
      const catalog = await access.read<ServiceCatalog | null>("/catalog");
      if (!catalog) { if (!current.current && live()) setError("No catalog has been activated yet."); return; }
      if (catalog.publicationId === current.current?.catalog.publicationId) { if (live()) setError(null); return; }
      const next = createHttpReaderSource(access, catalog);
      // Keep the entire previous reader visible until the replacement list is ready.
      const kind = new URLSearchParams(window.location.search).get("kind") === "award" ? "award" : "opportunity";
      await next.warm(catalog.counts[kind] ? kind : catalog.counts.opportunity ? "opportunity" : "award");
      if (attempt !== sequence.current || !live()) return;
      current.current = next; setSource(next); setError(null);
    } catch (failure) { if (attempt === sequence.current && live()) setError(failure instanceof Error ? failure.message : "The catalog is temporarily unavailable."); }
  }, [access]);
  useEffect(() => { let active = true; const load = () => void refresh(() => active); load(); window.addEventListener("focus", load); return () => { active = false; window.removeEventListener("focus", load); }; }, [refresh, publication?.lastSuccessful?.generation]);
  const canConfigure = loaded && can("settings:write");
  const header = <>
    <PageHeader title="Procurement review"
      subtitle={source ? undefined : NO_CATALOG_YET}
      status={source && <CatalogStatus catalog={source.catalog} publication={publication} readOnly={loaded && !can("documents:write")} operator={canConfigure}
        onSettings={canConfigure && !preview && !settings ? () => setSettings(true) : undefined} settingsLabel="Catalog source settings" />}
      info={!source && publication ? <PublicationDetails status={publication} operator={canConfigure} /> : undefined}
      actions={!source && canConfigure && !preview && !settings ? <button type="button" className="btn btn--ghost btn--icon" aria-label="Catalog source settings" onClick={() => setSettings(true)}><Settings2 size={14} aria-hidden="true" /></button> : undefined} />
    {canConfigure && (preview || settings) && <CatalogSourceControls societyId={societyId} previewReady={Boolean(source) && !error} onClose={preview ? undefined : () => setSettings(false)} />}
    {source && <PublicationState status={publication} whileReading operator={canConfigure} />}
    {error && <div className="card"><div className="card__body" role="alert">{error} <button type="button" className="btn" onClick={() => void refresh()}>Retry</button></div></div>}
  </>;
  return <div className="page procurement-review">{source ? <ProcurementReader key={source.catalog.publicationId} source={source} header={header} triage={triage} /> : <>{header}{!error && <p role="status">Loading procurement…</p>}</>}</div>;
}

function HostedProcurementReview() {
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const [settings, setSettings] = useState(false);
  const folder = society?.integrationSettings?.procurementReviewFolder ?? "";
  const societyId = society?._id;
  // The server authorizes both reads itself; they needn't wait for the permissions query (only the settings button does).
  const live = useQuery(api.procurementReview.catalog, societyId && folder ? { societyId } : "skip") as ReaderCatalog | null | undefined;
  const publication = useQuery(api.procurementStatus.get, societyId && folder ? { societyId } : "skip") as PublicationStatus | undefined;
  // Start the reader's queries from the catalog this device saw last rather than a round trip later; the live one confirms or replaces it.
  const remembered = useMemo(() => (societyId && folder ? readLastCatalog(societyId, folder) : null), [societyId, folder]);
  useEffect(() => {
    if (societyId && folder && live !== undefined) rememberCatalog(societyId, folder, live);
  }, [societyId, folder, live]);
  const catalog = live === undefined ? remembered ?? undefined : live;
  if (!society || !loaded) return <PageLoading variant="detail" />;
  const canConfigure = can("settings:write");
  const header = (
    <PageHeader
      title="Procurement review"
      subtitle={catalog ? undefined : NO_CATALOG_YET}
      status={catalog && <CatalogStatus catalog={catalog} publication={publication} readOnly={!can("documents:write")} operator={canConfigure}
        onSettings={canConfigure && !settings && folder ? () => setSettings(true) : undefined} settingsLabel="Snapshot folder settings" />}
      info={!catalog && publication ? <PublicationDetails status={publication} operator={canConfigure} /> : undefined}
      actions={!catalog && canConfigure && !settings && folder && (
        <Tooltip content="Snapshot folder">
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Snapshot folder settings" onClick={() => setSettings(true)}><Settings2 size={14} aria-hidden="true" /></button>
        </Tooltip>
      )}
    />
  );
  return (
    <div className="page procurement-review">
      {!folder || settings ? <>
        {header}
        <FolderSetupCard societyId={society._id} folder={folder} canConfigure={canConfigure} onSaved={() => setSettings(false)} onCancel={folder ? () => setSettings(false) : undefined} />
        {canConfigure && folder && <CatalogSourceControls societyId={society._id} />}
      </> : catalog === undefined ? <>
        {header}
        <p className="muted" role="status">Loading procurement…</p>
      </> : catalog === null ? <>
        {header}
        <PublicationState status={publication} operator={canConfigure} />
      </> : <HostedReader key={`${society._id}:${catalog.generation}`} societyId={society._id} catalog={catalog} confirmed={live !== undefined} header={<>{header}<PublicationState status={publication} whileReading operator={canConfigure} /></>} />}
    </div>
  );
}

/** Under the title until a catalog is in service; after that the freshness icon beside the title says when it was updated. */
const NO_CATALOG_YET = "Bid opportunities and awards published by Zoer.";

/**
 * The status control beside the title (CatalogFreshness): freshness on hover;
 * on click, the publication's details, which used to sit behind the title's
 * ⓘ, and the source settings for whoever may change them. Source coverage
 * caveats are identical for Convex and the service reader.
 */
function CatalogStatus({ catalog, publication, readOnly, operator, onSettings, settingsLabel }: {
  catalog: ReaderCatalog;
  publication: PublicationStatus | undefined;
  readOnly: boolean;
  operator: boolean;
  onSettings?: () => void;
  settingsLabel: string;
}) {
  return (
    <CatalogFreshness
      publishedAt={catalog.publishedAt}
      readOnly={readOnly}
      unverified={Boolean(publication?.source && !publication.source.complete)}
      details={publication ? <PublicationDetails status={publication} operator={operator} /> : undefined}
      actions={onSettings ? [{ label: settingsLabel, icon: <Settings2 size={14} aria-hidden="true" />, onSelect: onSettings }] : []}
    />
  );
}

/** When the catalog was collected, published and put in service: a short list, not a sentence of timestamps. */
function PublicationDates({ status }: { status: PublicationStatus }) {
  return (
    <dl className="procurement-review__dates">
      <div><dt>Collected</dt><dd>{exactWhen(status.source?.collectedAt ?? status.lastSuccessful?.collectedAt)}</dd></div>
      <div><dt>Published</dt><dd>{exactWhen(status.source?.publishedAt)}</dd></div>
      <div><dt>Imported here</dt><dd>{exactWhen(status.lastSuccessful?.activatedAt)}</dd></div>
    </dl>
  );
}

type PublicationStage = PublicationStatus["state"];
/** The reported state, except that an import silent for five minutes has stopped. */
function stageOf(status: PublicationStatus, now: number): PublicationStage {
  return status.state === "importing" && status.run && now - status.run.heartbeatAt > 5 * 60_000 ? "stalled" : status.state;
}
const STAGE_TITLES: Record<PublicationStage, string> = {
  ready: "Publication ready", available: "New source publication available", empty: "No catalog has been activated", unconfigured: "Choose a publication folder",
  importing: "Import in progress", failed: "Publication import failed — recovery available", stalled: "Import stopped reporting progress",
};

/**
 * Behind the title's ⓘ: what this catalog is and how fresh, for whoever wants
 * more than "Updated today". Whoever runs the catalog (`settings:write`) also
 * gets what the importer is doing: its batches, heartbeat, errors and the
 * source workflow's phase, which mean nothing to a reviewer.
 */
function PublicationDetails({ status, operator }: { status: PublicationStatus; operator: boolean }) {
  const now = useProcurementClock();
  const stage = stageOf(status, now);
  return (
    <div className="procurement-review__about">
      <p>Bid opportunities and awards that Zoer collects and publishes for this workspace.</p>
      <PublicationDates status={status} />
      {status.source && !status.source.complete && (
        <p className="procurement-review__about-caveat">
          <TriangleAlert size={12} aria-hidden="true" /> Zoer didn't confirm that every source was collected in full for this update, so some notices may be missing.
        </p>
      )}
      {operator && (
        <div className="procurement-review__importer">
          <h3>Import</h3>
          <p>{STAGE_TITLES[stage]}</p>
          {status.run && <p>{status.run.operations ? `${status.run.applied.toLocaleString()} of ${status.run.operations.toLocaleString()} operations applied. Next batch ${status.run.nextBatch}. ` : "Validating and importing publication tables. "}Last heartbeat: {exactWhen(status.run.heartbeatAt)}.</p>}
          {status.run?.error && <p role="alert">{status.run.error}</p>}
          {status.source?.error && status.source.error !== status.run?.error && <p role="alert">{status.source.error}</p>}
          {!status.run && status.source && stage !== "ready" && <p className="muted">Source workflow: {status.source.phase}. Last reported: {exactWhen(status.source.heartbeatAt)}.</p>}
          {status.lastSuccessful && <p className="muted">Last successful publication: {status.lastSuccessful.generation} ({Object.entries(status.lastSuccessful.counts).map(([kind, n]) => `${n.toLocaleString()} ${kind}`).join(", ")}).</p>}
          {status.recovery && <p>{status.recovery}</p>}
          {stage === "empty" && <p className="muted">Publish and validate a Zoer catalog, then activate it using the procurement import workflow.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The publication's state in one plain line for everyone who reads the
 * catalog: how fresh it is, and whether an update is under way or failed
 * ("Catalog updated 2 h ago · updating now", "Couldn't update. Showing the
 * catalog from Nov 12"). `whileReading` is the line above a catalog that is
 * being read; a healthy one shows nothing there (its dates are behind the ⓘ,
 * and so is what the importer is doing, for whoever runs it).
 */
function PublicationState({ status, whileReading = false, operator = false }: { status: PublicationStatus | undefined; whileReading?: boolean; operator?: boolean }) {
  const now = useProcurementClock();
  if (!status) return whileReading ? null : <p className="muted" role="status">Reading publication status…</p>;
  const stage = stageOf(status, now);
  if (whileReading && stage === "ready") return null;
  const last = status.lastSuccessful;
  const since = sinceWhen(last?.activatedAt ?? last?.publishedAt, now);
  const published = last ? new Date(last.publishedAt) : null;
  const from = published && !Number.isNaN(published.getTime()) ? format(published, "MMM d") : "";
  const failed = stage === "failed" || stage === "stalled";
  const line = failed ? (from ? `Couldn't update. Showing the catalog from ${from}.` : "Couldn't prepare the catalog yet.")
    : stage === "importing" ? (since ? `Catalog updated ${since} · updating now` : "Preparing the catalog…")
    : stage === "available" ? (since ? `Catalog updated ${since} · a newer one is on its way` : "A catalog is on its way.")
    : stage === "empty" ? "No catalog has been published here yet."
    : stage === "unconfigured" ? "No catalog has been set up here yet."
    : since ? `Catalog updated ${since}.` : "Catalog ready.";
  return (
    <p className="procurement-review__status" data-tone={failed ? "warn" : undefined} role="status">
      {failed ? <TriangleAlert size={14} aria-hidden="true" /> : stage === "importing" || stage === "available" ? <RefreshCw size={14} aria-hidden="true" /> : null}
      <span>{line}{operator && (failed || stage === "empty") && " The import details are behind the ⓘ beside the title."}</span>
    </p>
  );
}

function HostedReader({ societyId, catalog, confirmed, header }: { societyId: string; catalog: ReaderCatalog; confirmed: boolean; header: ReactNode }) {
  const source = useConvexReaderSource(societyId, catalog, confirmed);
  const triage = useWorkspaceTriage(societyId);
  return <ProcurementReader source={source} header={header} triage={triage} />;
}
