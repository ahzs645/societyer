import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Field } from "../components/ui";
import { Toggle } from "../components/Controls";
import { formatDateTime } from "../lib/format";
import { Database, ExternalLink, RefreshCw, Tags, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

export function PaperlessPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const localOnly = isLocalDataRuntime() && !isStaticDemoRuntime();
  const canConfigure = can("settings:write") && can("documents:write") && !localOnly;
  const status = useQuery(api.paperless.connectionStatus, society ? { societyId: society._id } : "skip");
  const recentSyncs = useQuery(api.paperless.recentSyncs, society ? { societyId: society._id, limit: 12 } : "skip");
  const tagProfiles = useQuery(api.paperless.tagProfiles, {});
  const upsertConnection = useMutation(api.paperless.upsertConnection);
  const disconnect = useMutation(api.paperless.disconnect);
  const testConnection = useAction(api.paperless.testConnection);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [autoCreateTags, setAutoCreateTags] = useState(true);
  const [, setAutoUpload] = useState(false);
  const [tagPrefix, setTagPrefix] = useState("societyer");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const connection = status?.connection;
    if (!connection) return;
    setAutoCreateTags(connection.autoCreateTags);
    setAutoUpload(connection.autoUpload);
    setTagPrefix(connection.tagPrefix ?? "societyer");
  }, [status?.connection]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const connection = status?.connection;
  const runtime = status?.runtime;
  const connected = connection?.status === "connected";
  const demoAvailable = society.demoMode === true || isStaticDemoRuntime();
  const providerAvailable = runtime?.live === true || demoAvailable;

  const save = async () => {
    if (!canConfigure || !providerAvailable || busy) return;
    setBusy(true);
    try {
      await upsertConnection({
        societyId: society._id,
        autoCreateTags,
        autoUpload: false,
        tagPrefix,
      });
      toast.success(demoAvailable ? "Paperless demo connection enabled" : "Paperless-ngx connection enabled");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't save Paperless-ngx settings");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!canConfigure || busy) return;
    setBusy(true);
    try {
      const result = await testConnection({ societyId: society._id });
      if (result.ok) {
        toast.success(result.demo ? "Paperless demo adapter is ready" : "Paperless-ngx connection works");
      } else {
        toast.error(result.error ?? "Paperless-ngx connection failed");
      }
    } catch (error) {
      toast.error("Could not test Paperless-ngx", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Paperless-ngx"
        icon={<Database size={16} />}
        iconColor="gray"
        subtitle="Technical setup area. Connects Societyer to an external document archive that automatically scans (OCR) and tags uploaded files so they're searchable — typically configured once by an administrator, not a page a board member needs to visit."
        actions={
          <>
            <button className="btn-action" disabled={busy || !canConfigure} onClick={runTest}>
              <RefreshCw size={12} /> Test
            </button>
            <button className="btn-action btn-action--primary" disabled={busy || !canConfigure || !providerAvailable} onClick={save}>
              <UploadCloud size={12} /> {connected ? "Save connection" : "Enable connection"}
            </button>
          </>
        }
      />

      {!localOnly && !providerAvailable && <p className="muted" role="status">Paperless is not configured on this server. An administrator must configure its server address and API token before enabling synchronization. Test reports missing configuration.</p>}
      {localOnly && <p className="muted" role="status">Paperless connections and OCR synchronization require a connected workspace. Local document records and files remain available in Documents and Library.</p>}
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Connection</h2>
            <span className="card__subtitle">Server address and API token are set by an administrator in the hosting environment, not typed in here.</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Status</span>
              <Badge tone={connected ? "success" : connection?.status === "error" ? "danger" : "warn"}>
                {localOnly ? "Unavailable locally" : connected ? connection?.demo ? "Demo connection" : "Connected" : connection?.status ?? "Not enabled"}
              </Badge>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Runtime</span>
              <Badge tone={runtime?.live ? "success" : "info"}>
                {localOnly ? "Local records" : demoAvailable ? "Demo adapter" : runtime?.live ? "Live Paperless-ngx" : "Not configured"}
              </Badge>
            </div>
            <div className="muted">
              Paperless server URL: <code className="mono">{connection?.baseUrl ?? runtime?.baseUrl ?? "Not set (admin: set PAPERLESS_NGX_URL)"}</code>
            </div>
            <div className="muted">
              API token: <code className="mono">{runtime?.configured ? "Configured" : "Not set (admin: set PAPERLESS_NGX_TOKEN)"}</code>
            </div>
            {connection?.apiVersion && (
              <div className="muted">
                Paperless version: <code className="mono">{connection.apiVersion}</code>
                {connection.serverVersion ? ` · ${connection.serverVersion}` : ""}
              </div>
            )}
            {connection?.lastError && <div className="alert alert--danger">{connection.lastError}</div>}
            {isLocalDataRuntime() && <p className="muted">This local adapter previews Paperless records. Disconnect the external provider from its connected server workspace.</p>}
            <div className="row">
              <button className="btn btn--accent" disabled={busy || !canConfigure || !providerAvailable} onClick={save}>
                {connected ? "Save settings" : "Enable connection"}
              </button>
              {connection && (
                <button
                  className="btn"
                  disabled={busy || !canConfigure || isLocalDataRuntime()}
                  onClick={async () => {
                    if (!canConfigure || isLocalDataRuntime() || busy) return;
                    setBusy(true);
                    try {
                      await disconnect({ societyId: society._id });
                      toast.success("Paperless-ngx connection disabled");
                    } catch (error) { toast.error("Could not disconnect Paperless-ngx", error instanceof Error ? error.message : "Please try again."); }
                    finally { setBusy(false); }
                  }}
                >
                  Disable
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Tagging</h2>
            <span className="card__subtitle">Controls how Societyer's document categories are labeled once they reach Paperless.</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <Toggle
              disabled={!canConfigure}
              checked={autoCreateTags}
              onChange={setAutoCreateTags}
              label="Create missing Paperless tags"
              hint="When enabled, Societyer creates any tags that don't already exist in Paperless before uploading a document."
            />
            <Toggle
              disabled
              checked={false}
              onChange={setAutoUpload}
              label="Auto-upload new document versions"
              hint="Automatic uploads are not available yet. Use Sync to Paperless on a stored document or version; existing automatic-upload settings do not start background jobs."
            />
            <Field label="Tag prefix">
              <input
                disabled={!canConfigure}
                className="input"
                value={tagPrefix}
                onChange={(event) => setTagPrefix(event.target.value)}
                placeholder="societyer"
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Cross-app tag profiles</h2>
          <span className="card__subtitle">These are inferred from existing document references across modules.</span>
        </div>
        <div className="card__body grid two">
          {(tagProfiles ?? []).map((profile: any) => (
            <div key={profile.scope} className="panel" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Tags size={14} />
                <strong>{profile.scope}</strong>
              </div>
              <div className="tag-list" style={{ marginBottom: 8 }}>
                {profile.tags.map((tag: string) => <Badge key={tag}>{tag}</Badge>)}
              </div>
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{profile.usage}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Recent syncs</h2>
          <span className="card__subtitle">Document uploads sent from the shared repository.</span>
        </div>
        <div className="card__body col" style={{ gap: 8 }}>
          {recentSyncs === undefined && <div className="muted">Loading…</div>}
          {recentSyncs?.length === 0 && <div className="muted">No documents have been sent to Paperless-ngx yet.</div>}
          {(recentSyncs ?? []).map((sync: any) => (
            <div key={sync._id} className="panel" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <strong>{sync.documentTitle}</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                    {sync.fileName ?? "No file name"} · {formatDateTime(sync.queuedAtISO)}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={sync.status === "complete" ? "success" : sync.status === "failed" ? "danger" : "info"}>
                    {sync.status}
                  </Badge>
                  {sync.paperlessDocumentUrl && (
                    <a className="btn btn--ghost btn--sm" href={sync.paperlessDocumentUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> Open
                    </a>
                  )}
                </div>
              </div>
              <div className="tag-list" style={{ marginTop: 8 }}>
                {sync.tags.map((tag: string) => <Badge key={tag}>{tag}</Badge>)}
              </div>
              {sync.lastError && <div className="alert alert--danger" style={{ marginTop: 8 }}>{sync.lastError}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
