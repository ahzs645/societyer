import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Settings2 } from "lucide-react";
import { api } from "../../../lib/convexApi";
import { PageHeader, PageLoading } from "../../../pages/_helpers";
import { Tooltip } from "../../../components/Tooltip";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import { isStaticDemoRuntime } from "../../../lib/staticRuntime";
import { FolderSetupCard } from "../components/FolderSetupCard";
import { SnapshotReviewPage } from "./SnapshotReviewPage";
import { ProcurementReader } from "../reader/ProcurementReader";
import { useConvexReaderSource } from "../reader/convexSource";
import type { ReaderCatalog } from "../reader/source";
import { publishedSummary } from "../reader/summary";
import { useProcurementClock } from "../lib/clock";

type PublicationStatus = {
  state: "unconfigured" | "empty" | "ready" | "available" | "importing" | "stalled" | "failed";
  lastSuccessful: { generation: string; publishedAt: string; collectedAt: string | null; activatedAt: number | null; counts: Record<string, number> } | null;
  source: { generation: string; publishedAt: string; collectedAt: string | null; complete: boolean; phase: string; error: string | null; heartbeatAt: number | null } | null;
  run: { id: string; applied: number; operations: number; nextBatch: number; heartbeatAt: number; error: string | null } | null;
  recovery: string | null;
};

export function ProcurementReviewPage() {
  return isStaticDemoRuntime() ? <SnapshotReviewPage /> : <HostedProcurementReview />;
}

function HostedProcurementReview() {
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const [settings, setSettings] = useState(false);
  const folder = society?.integrationSettings?.procurementReviewFolder ?? "";
  const catalog = useQuery(api.procurementReview.catalog, society && loaded && folder ? { societyId: society._id } : "skip") as ReaderCatalog | null | undefined;
  const publication = useQuery(api.procurementStatus.get, society && loaded && folder ? { societyId: society._id } : "skip") as PublicationStatus | undefined;
  if (!society || !loaded) return <PageLoading variant="detail" />;
  const canConfigure = can("settings:write");
  const header = (
    <PageHeader
      title="Procurement review"
      subtitle={catalog ? publishedSummary(catalog) : "Bid opportunities and awards published by Zoer."}
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
      </> : <HostedReader key={`${society._id}:${catalog.generation}`} societyId={society._id} catalog={catalog} header={<>{header}<PublicationState status={publication} compact /></>} />}
    </div>
  );
}

function PublicationState({ status, compact = false }: { status: PublicationStatus | undefined; compact?: boolean }) {
  const now = useProcurementClock();
  if (!status) return <p className="muted" role="status">Reading publication status…</p>;
  const stalled = status.state === "importing" && status.run && now - status.run.heartbeatAt > 5 * 60_000;
  const state = stalled ? "stalled" : status.state;
  const title = { ready: "Publication ready", available: "New source publication available", empty: "No catalog has been activated", unconfigured: "Choose a publication folder", importing: "Import in progress", failed: "Publication import failed — recovery available", stalled: "Import stopped reporting progress" }[state];
  const when = (value: string | number | null | undefined) => value ? new Date(value).toLocaleString(undefined, { timeZone: "America/Vancouver" }) : "Not recorded";
  const dates = <p className="muted">Collected: {when(status.source?.collectedAt ?? status.lastSuccessful?.collectedAt)} · Published to SharePoint: {when(status.source?.publishedAt)} · Serving activated: {when(status.lastSuccessful?.activatedAt)}{status.source && !status.source.complete ? " · Source coverage incomplete or unverified" : ""}</p>;
  if (compact && state === "ready") return dates;
  return <section className="card procurement-review__state" aria-live="polite">
    <div className="card__head"><h2 className="card__title">{title}</h2></div>
    <div className="card__body">
      {dates}
      {status.run && <p>{status.run.operations ? `${status.run.applied.toLocaleString()} of ${status.run.operations.toLocaleString()} operations applied. Next batch ${status.run.nextBatch}. ` : "Validating and importing publication tables. "}Last heartbeat: {when(status.run.heartbeatAt)}.</p>}
      {status.run?.error && <p role="alert">{status.run.error}</p>}
      {status.source?.error && status.source.error !== status.run?.error && <p role="alert">{status.source.error}</p>}
      {!status.run && status.source && state !== "ready" && <p className="muted">Source workflow: {status.source.phase}. Last reported: {when(status.source.heartbeatAt)}.</p>}
      {status.lastSuccessful && <p className="muted">Last successful publication: {status.lastSuccessful.generation} ({Object.entries(status.lastSuccessful.counts).map(([kind, n]) => `${n.toLocaleString()} ${kind}`).join(", ")}).</p>}
      {status.recovery && <p>{status.recovery}</p>}
      {state === "empty" && <p className="muted">Publish and validate a Zoer catalog, then activate it using the procurement import workflow.</p>}
    </div>
  </section>;
}

function HostedReader({ societyId, catalog, header }: { societyId: string; catalog: ReaderCatalog; header: ReactNode }) {
  const source = useConvexReaderSource(societyId, catalog);
  return <ProcurementReader source={source} header={header} />;
}
