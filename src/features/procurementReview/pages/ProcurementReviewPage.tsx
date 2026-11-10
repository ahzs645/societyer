import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Settings2, TriangleAlert } from "lucide-react";
import { api } from "../../../lib/convexApi";
import { PageHeader, PageLoading } from "../../../pages/_helpers";
import { Tooltip } from "../../../components/Tooltip";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import { isStaticDemoRuntime } from "../../../lib/staticRuntime";
import { FolderSetupCard } from "../components/FolderSetupCard";
import { ProcurementReader } from "../reader/ProcurementReader";
import { useConvexReaderSource } from "../reader/convexSource";
import type { ReaderCatalog } from "../reader/source";
import { exactWhen, updatedSummary } from "../reader/summary";
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
    : <HostedProcurementReview />;
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
  // The source said this publication doesn't cover everything (or didn't say): a caveat a reviewer should see, in a few words.
  const unverified = Boolean(catalog && publication?.source && !publication.source.complete);
  const header = (
    <PageHeader
      title="Procurement review"
      subtitle={catalog ? <span className="procurement-review__summary">
        <span>{updatedSummary(catalog.publishedAt)}</span>
        {unverified && <span className="procurement-review__caveat"><TriangleAlert size={12} aria-hidden="true" /> Some sources unverified</span>}
      </span> : "Bid opportunities and awards published by Zoer."}
      info={catalog && publication ? <PublicationDetails status={publication} /> : undefined}
      actions={canConfigure && !settings && folder && (
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
      </> : catalog === undefined ? <>
        {header}
        <p className="muted" role="status">Loading procurement…</p>
      </> : catalog === null ? <>
        {header}
        <PublicationState status={publication} />
      </> : <HostedReader key={`${society._id}:${catalog.generation}`} societyId={society._id} catalog={catalog} confirmed={live !== undefined} header={<>{header}<PublicationState status={publication} whileReading /></>} />}
    </div>
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

/** Behind the title's ⓘ: what this catalog is and how fresh, for whoever wants more than "Updated today". */
function PublicationDetails({ status }: { status: PublicationStatus }) {
  return (
    <div className="procurement-review__about">
      <p>Bid opportunities and awards that Zoer collects and publishes for this workspace. They can be read here, not changed.</p>
      <PublicationDates status={status} />
      {status.source && !status.source.complete && (
        <p className="procurement-review__about-caveat">
          <TriangleAlert size={12} aria-hidden="true" /> Zoer didn't confirm that every source was collected in full for this update, so some notices may be missing.
        </p>
      )}
    </div>
  );
}

/**
 * The publication's state as a card: nothing published yet, an import under
 * way, or one that failed. `whileReading` is the card above a catalog that is
 * being read; a healthy one shows nothing there (its dates are behind the ⓘ).
 */
function PublicationState({ status, whileReading = false }: { status: PublicationStatus | undefined; whileReading?: boolean }) {
  const now = useProcurementClock();
  if (!status) return whileReading ? null : <p className="muted" role="status">Reading publication status…</p>;
  const stalled = status.state === "importing" && status.run && now - status.run.heartbeatAt > 5 * 60_000;
  const state = stalled ? "stalled" : status.state;
  if (whileReading && state === "ready") return null;
  const title = { ready: "Publication ready", available: "New source publication available", empty: "No catalog has been activated", unconfigured: "Choose a publication folder", importing: "Import in progress", failed: "Publication import failed — recovery available", stalled: "Import stopped reporting progress" }[state];
  return <section className="card procurement-review__state" aria-live="polite">
    <div className="card__head"><h2 className="card__title">{title}</h2></div>
    <div className="card__body">
      <PublicationDates status={status} />
      {status.source && !status.source.complete && <p className="muted">Source coverage is incomplete or unverified.</p>}
      {status.run && <p>{status.run.operations ? `${status.run.applied.toLocaleString()} of ${status.run.operations.toLocaleString()} operations applied. Next batch ${status.run.nextBatch}. ` : "Validating and importing publication tables. "}Last heartbeat: {exactWhen(status.run.heartbeatAt)}.</p>}
      {status.run?.error && <p role="alert">{status.run.error}</p>}
      {status.source?.error && status.source.error !== status.run?.error && <p role="alert">{status.source.error}</p>}
      {!status.run && status.source && state !== "ready" && <p className="muted">Source workflow: {status.source.phase}. Last reported: {exactWhen(status.source.heartbeatAt)}.</p>}
      {status.lastSuccessful && <p className="muted">Last successful publication: {status.lastSuccessful.generation} ({Object.entries(status.lastSuccessful.counts).map(([kind, n]) => `${n.toLocaleString()} ${kind}`).join(", ")}).</p>}
      {status.recovery && <p>{status.recovery}</p>}
      {state === "empty" && <p className="muted">Publish and validate a Zoer catalog, then activate it using the procurement import workflow.</p>}
    </div>
  </section>;
}

function HostedReader({ societyId, catalog, confirmed, header }: { societyId: string; catalog: ReaderCatalog; confirmed: boolean; header: ReactNode }) {
  const source = useConvexReaderSource(societyId, catalog, confirmed);
  return <ProcurementReader source={source} header={header} />;
}
