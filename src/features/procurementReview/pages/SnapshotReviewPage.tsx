import { useCallback, useState, type ReactNode } from "react";
import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { RefreshCw, Settings2 } from "lucide-react";
import { PageHeader, PageLoading } from "../../../pages/_helpers";
import { Progress } from "../../../components/primitives";
import { useToast } from "../../../components/Toast";
import { Tooltip } from "../../../components/Tooltip";
import { pluralize } from "../../../lib/format";
import { useIsMobile } from "../../../lib/useIsMobile";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import type { SnapshotManifest } from "../../../../shared/procurementReview/manifest";
import { FolderSetupCard } from "../components/FolderSetupCard";
import { ReviewWorkspace, sourceLabel } from "../components/ReviewWorkspace";
import { fetchSnapshotManifest, type SnapshotProgress } from "../lib/snapshot";
import { useProcurementSnapshot, type SnapshotFailure } from "../lib/useProcurementSnapshot";
import { useReviewArtifact } from "../lib/useReviewArtifact";

const STAGE_LABELS: Record<SnapshotProgress["stage"], string> = {
  manifest: "Reading the snapshot manifest",
  download: "Downloading the catalog",
  decompress: "Checking and unpacking the catalog",
  open: "Opening the catalog",
};

const FAILURE_TITLES: Record<SnapshotFailure, string> = {
  integrity: "The snapshot failed its integrity check",
  format: "This snapshot can't be read",
  access: "The snapshot folder couldn't be read",
  open: "The snapshot couldn't be opened",
};

const FAILURE_HELP: Record<SnapshotFailure, string> = {
  integrity: "Nothing from it was opened or kept. If Zoer is publishing right now, refresh in a minute; otherwise republish from Zoer.",
  format: "It was published by a Zoer whose snapshot format this Societyer doesn't know. Update one of them so they match, then republish.",
  access: "Check the folder path, that the deployment's SharePoint app can read that folder, and that you're still signed in.",
  open: "Refresh to try again. If it keeps failing, republish from Zoer.",
};

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "opportunity" → "opportunities", "notice_change" → "notice changes", "address" → "addresses". */
function pluralKind(singular: string): string {
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`;
  return `${singular}s`;
}

/** "today, 8:00 AM", "yesterday, 8:00 AM", "Oct 18, 8:00 AM", or "Oct 18, 2025" in another year. */
function publishedWhen(published: Date): string {
  if (isToday(published)) return `today, ${format(published, "h:mm a")}`;
  if (isYesterday(published)) return `yesterday, ${format(published, "h:mm a")}`;
  return format(published, isThisYear(published) ? "MMM d, h:mm a" : "MMM d, yyyy");
}

/** "41 opportunities · 15 awards · published today, 8:00 AM", from the manifest's record counts. */
function SnapshotSummary({ manifest }: { manifest: SnapshotManifest }) {
  const counts = Object.entries(manifest.counts).sort(([, left], [, right]) => right - left);
  const shown = counts.slice(0, 3).map(([kind, count]) => {
    const singular = kind.replace(/_/g, " ");
    return pluralize(count, singular, pluralKind(singular));
  });
  if (counts.length > 3) shown.push(pluralize(counts.length - 3, "more kind"));
  const published = new Date(manifest.publishedAt);
  const full = published.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
  return (
    <>
      {shown.map((part) => `${part} · `).join("")}
      <span title={`Snapshot published ${full}`}>published {publishedWhen(published)}</span>
    </>
  );
}

function StateCard({ title, children, tone }: { title: string; children: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <div className="card procurement-review__state" role={tone ? "alert" : undefined}>
      <div className="card__head"><h2 className="card__title">{title}</h2></div>
      <div className="card__body col">{children}</div>
    </div>
  );
}

function LoadingCard({ progress }: { progress: SnapshotProgress }) {
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const sized = progress.stage === "download" && progress.total > 1;
  return (
    <StateCard title="Loading the published snapshot">
      <div className="procurement-review__progress" aria-live="polite">
        <div className="procurement-review__progress-label">
          <span>{STAGE_LABELS[progress.stage]}…</span>
          {sized && <span>{formatBytes(progress.done)} of {formatBytes(progress.total)}</span>}
        </div>
        <div role="progressbar" aria-label={STAGE_LABELS[progress.stage]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={sized ? percent : undefined}>
          <Progress value={sized ? percent : progress.done >= progress.total ? 100 : 15} />
        </div>
        <p className="muted">Each part is checked against the published checksums before it opens. A verified snapshot is kept on this device, so the next visit is quicker.</p>
      </div>
    </StateCard>
  );
}

export function SnapshotReviewPage() {
  const society = useSociety();
  const { can, loaded: permissionsLoaded } = usePermissions();
  const toast = useToast();
  const phone = useIsMobile();
  const canConfigure = can("settings:write");
  const folder = society?.integrationSettings?.procurementReviewFolder ?? "";
  const [reloadKey, setReloadKey] = useState(0);
  const [editingFolder, setEditingFolder] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const artifact = useReviewArtifact(Boolean(folder));
  const snapshot = useProcurementSnapshot(society?._id, artifact.status === "not-installed" ? "" : folder, reloadKey);
  const onMountError = useCallback((message: string) => setMountError(message), []);

  const refresh = async () => {
    if (snapshot.status !== "ready") {
      setMountError(null);
      setReloadKey((key) => key + 1);
      return;
    }
    setRefreshing(true);
    try {
      const latest = await fetchSnapshotManifest(snapshot.read);
      if (latest?.snapshotId === snapshot.manifest.snapshotId) {
        toast.success("Already up to date", sourceLabel(snapshot.manifest));
      } else {
        setMountError(null);
        setReloadKey((key) => key + 1);
      }
    } catch (error) {
      toast.error("Couldn't check for a newer snapshot", error instanceof Error ? error.message : undefined);
    } finally {
      setRefreshing(false);
    }
  };

  if (!society || !permissionsLoaded) return <PageLoading variant="detail" />;

  const subtitle = snapshot.status === "ready"
    ? <SnapshotSummary manifest={snapshot.manifest} />
    : "A read-only copy of the bid opportunities Zoer publishes for this workspace.";
  const refreshLabel = refreshing ? "Checking…" : "Refresh";
  // Refresh is the one everyday action; the folder is an admin setting, so it
  // sits behind an icon. Phones keep both as icons on the title's row.
  const actions = folder && (canConfigure || artifact.status !== "not-installed") ? (
    <>
      {canConfigure && !editingFolder && (
        <Tooltip content="Snapshot folder">
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Snapshot folder settings" onClick={() => setEditingFolder(true)}>
            <Settings2 size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      {artifact.status !== "not-installed" && (
        phone ? (
          <Tooltip content={refreshLabel}>
            <button type="button" className="btn btn--icon" aria-label={refreshing ? "Checking for a newer snapshot" : "Refresh snapshot"} disabled={refreshing || snapshot.status === "loading"} onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : (
          <button type="button" className="btn" disabled={refreshing || snapshot.status === "loading"} onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden="true" /> {refreshLabel}
          </button>
        )
      )}
    </>
  ) : undefined;

  let body: ReactNode;
  if (!folder || editingFolder) {
    body = (
      <FolderSetupCard
        societyId={society._id}
        folder={folder}
        canConfigure={canConfigure}
        onSaved={() => { setEditingFolder(false); setReloadKey((key) => key + 1); }}
        onCancel={folder ? () => setEditingFolder(false) : undefined}
      />
    );
  } else if (artifact.status === "not-installed" || artifact.status === "unavailable") {
    body = (
      <StateCard title="The review plugin bundle isn't installed" tone="warning">
        <p className="muted">
          {artifact.status === "unavailable" ? artifact.message : "This build of Societyer doesn't include the Zoer procurement review plugin."}
        </p>
        <p className="procurement-review__details">
          An operator builds it in the Zoer plugin checkout (bun run societyer:build), installs it here with
          tsx scripts/sync-procurement-review.ts, and redeploys the app. The snapshot folder is already set: {folder}
        </p>
      </StateCard>
    );
  } else if (snapshot.status === "unpublished") {
    body = (
      <StateCard title="Nothing has been published yet">
        <p className="muted">There's no snapshot in this workspace's folder. The Zoer publisher must run at least once to put one there; this page shows it as soon as it does.</p>
        <p className="procurement-review__details">Folder: {folder}</p>
      </StateCard>
    );
  } else if (snapshot.status === "failed") {
    body = (
      <StateCard title={FAILURE_TITLES[snapshot.failure]} tone="danger">
        <p>{snapshot.message}</p>
        <p className="muted">{FAILURE_HELP[snapshot.failure]}</p>
        <p className="procurement-review__details">Folder: {folder}</p>
      </StateCard>
    );
  } else if (mountError) {
    body = (
      <StateCard title="The review plugin couldn't start" tone="danger">
        <p>{mountError}</p>
        <p className="muted">Refresh to try again. If it keeps failing, the installed plugin bundle may not match this snapshot's plugin version.</p>
      </StateCard>
    );
  } else if (snapshot.status === "ready" && artifact.status === "ready") {
    body = (
      <ReviewWorkspace
        key={snapshot.manifest.snapshotId}
        artifact={artifact.loaded}
        manifest={snapshot.manifest}
        catalog={snapshot.catalog}
        read={snapshot.read}
        onMountError={onMountError}
      />
    );
  } else {
    body = <LoadingCard progress={snapshot.status === "loading" ? snapshot.progress : { stage: "open", done: 0, total: 1 }} />;
  }

  return (
    <div className="page procurement-review">
      <PageHeader title="Procurement review" subtitle={subtitle} actions={actions} />
      {body}
    </div>
  );
}
