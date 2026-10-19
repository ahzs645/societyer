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

export function ProcurementReviewPage() {
  return isStaticDemoRuntime() ? <SnapshotReviewPage /> : <HostedProcurementReview />;
}

function HostedProcurementReview() {
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const [settings, setSettings] = useState(false);
  const folder = society?.integrationSettings?.procurementReviewFolder ?? "";
  const catalog = useQuery(api.procurementReview.catalog, society && loaded && folder ? { societyId: society._id } : "skip") as ReaderCatalog | null | undefined;
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
        <div className="card procurement-review__state">
          <div className="card__head"><h2 className="card__title">The catalog is being prepared</h2></div>
          <div className="card__body"><p className="muted">The catalog is being imported or updated. Complete publications become available automatically; an interrupted update resumes from its checkpoint.</p></div>
        </div>
      </> : <HostedReader key={`${society._id}:${catalog.generation}`} societyId={society._id} catalog={catalog} header={header} />}
    </div>
  );
}

function HostedReader({ societyId, catalog, header }: { societyId: string; catalog: ReaderCatalog; header: ReactNode }) {
  const source = useConvexReaderSource(societyId, catalog);
  return <ProcurementReader source={source} header={header} />;
}
