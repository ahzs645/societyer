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
import { openableExternalUrl } from "../lib/externalUrl";
import { InfoPopover } from "../components/InfoPopover";

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
  const rawServerUrl = connection?.baseUrl ?? runtime?.baseUrl;
  // Demo adapters report placeholder addresses (demo://…) and versions
  // ("demo"); those are not something a user can act on.
  const serverUrl = rawServerUrl && /^https?:\/\//i.test(rawServerUrl) ? rawServerUrl : null;
  const serverLabel = serverUrl ?? (demoAvailable ? "Demo adapter" : "Not configured");
  const showVersion = Boolean(connection?.apiVersion && connection.apiVersion !== "demo");

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
        subtitle="Connect a Paperless-ngx archive for OCR and tagging."
        info={
          <p>An administrator usually sets this up once. Paperless scans (OCR) and tags uploaded files so they're searchable from Societyer.</p>
        }
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

      {!localOnly && !providerAvailable && <p className="muted" role="status">Paperless isn't configured on this server yet. An administrator sets it up.</p>}
      {localOnly && <p className="muted" role="status">Paperless connections and OCR synchronization require a connected workspace. Local document records and files remain available in Documents and Library.</p>}
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Connection</h2>
            <InfoPopover label="About the Paperless connection">
              <p>
                The server address and API token are set by an administrator in the hosting environment, not typed in
                here (<code>PAPERLESS_NGX_URL</code> and <code>PAPERLESS_NGX_TOKEN</code>).
              </p>
            </InfoPopover>
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
            {(serverUrl || !demoAvailable) && (
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <span className="muted">Server</span>
                <span className={serverUrl ? "mono" : undefined} style={{ overflowWrap: "anywhere", textAlign: "right" }}>{serverLabel}</span>
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">API token</span>
              <span>{runtime?.configured ? "Configured" : demoAvailable ? "Not needed for the demo" : "Not configured"}</span>
            </div>
            {showVersion && (
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Paperless version</span>
                <span>
                  {connection?.apiVersion}
                  {connection?.serverVersion ? ` · ${connection.serverVersion}` : ""}
                </span>
              </div>
            )}
            {connection?.lastError && <div className="alert alert--danger">{connection.lastError}</div>}
            {connection && (
            <div className="row">
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
            </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Tagging</h2>
            <InfoPopover label="About tagging">
              <p>Controls how Societyer's document categories are labeled once they reach Paperless.</p>
            </InfoPopover>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <Toggle
              disabled={!canConfigure}
              checked={autoCreateTags}
              onChange={setAutoCreateTags}
              label="Create missing Paperless tags"
              hint="Creates tags that don't exist in Paperless yet before uploading."
            />
            <Toggle
              disabled
              checked={false}
              onChange={setAutoUpload}
              label="Auto-upload new document versions"
              hint="Not available yet — use Sync to Paperless on a document."
            />
            <Field label="Tag prefix">
              <input
                disabled={!canConfigure}
                className="input"
                style={{ maxWidth: 320 }}
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
          <InfoPopover label="About tag profiles">
            <p>These are inferred from existing document references across modules.</p>
          </InfoPopover>
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
                    {sync.status ? sync.status.charAt(0).toUpperCase() + sync.status.slice(1) : "Queued"}
                  </Badge>
                  {openableExternalUrl(sync.paperlessDocumentUrl) && (
                    <a className="btn btn--ghost btn--sm" href={openableExternalUrl(sync.paperlessDocumentUrl)!} target="_blank" rel="noreferrer">
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
