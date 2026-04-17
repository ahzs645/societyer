import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { PageHeader, SeedPrompt } from "./_helpers";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Field } from "../components/ui";
import { Toggle } from "../components/Controls";
import { formatDateTime } from "../lib/format";
import { Database, ExternalLink, RefreshCw, Tags, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

export function PaperlessPage() {
  const society = useSociety();
  const status = useQuery(api.paperless.connectionStatus, society ? { societyId: society._id } : "skip");
  const recentSyncs = useQuery(api.paperless.recentSyncs, society ? { societyId: society._id, limit: 12 } : "skip");
  const tagProfiles = useQuery(api.paperless.tagProfiles, {});
  const upsertConnection = useMutation(api.paperless.upsertConnection);
  const disconnect = useMutation(api.paperless.disconnect);
  const testConnection = useAction(api.paperless.testConnection);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [autoCreateTags, setAutoCreateTags] = useState(true);
  const [autoUpload, setAutoUpload] = useState(false);
  const [tagPrefix, setTagPrefix] = useState("societyer");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const connection = status?.connection;
    if (!connection) return;
    setAutoCreateTags(connection.autoCreateTags);
    setAutoUpload(connection.autoUpload);
    setTagPrefix(connection.tagPrefix ?? "societyer");
  }, [status?.connection]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const connection = status?.connection;
  const runtime = status?.runtime;
  const connected = connection?.status === "connected";

  const save = async () => {
    setBusy(true);
    try {
      await upsertConnection({
        societyId: society._id,
        autoCreateTags,
        autoUpload,
        tagPrefix,
        actingUserId,
      });
      toast.success("Paperless-ngx plugin enabled");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't save Paperless-ngx settings");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      const result = await testConnection({ societyId: society._id });
      if (result.ok) {
        toast.success(result.demo ? "Paperless demo adapter is ready" : "Paperless-ngx connection works");
      } else {
        toast.error(result.error ?? "Paperless-ngx connection failed");
      }
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
        subtitle="External document storage, OCR, and tag sync for Societyer records."
        actions={
          <>
            <button className="btn-action" disabled={busy} onClick={runTest}>
              <RefreshCw size={12} /> Test
            </button>
            <button className="btn-action btn-action--primary" disabled={busy} onClick={save}>
              <UploadCloud size={12} /> {connected ? "Save plugin" : "Enable plugin"}
            </button>
          </>
        }
      />

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Connection</h2>
            <span className="card__subtitle">Credentials stay in Convex environment variables.</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Status</span>
              <Badge tone={connected ? "success" : connection?.status === "error" ? "danger" : "warn"}>
                {connected ? "Connected" : connection?.status ?? "Not enabled"}
              </Badge>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Runtime</span>
              <Badge tone={runtime?.live ? "success" : "info"}>
                {runtime?.live ? "Live Paperless-ngx" : "Demo adapter"}
              </Badge>
            </div>
            <div className="muted">
              URL: <code className="mono">{connection?.baseUrl ?? runtime?.baseUrl ?? "PAPERLESS_NGX_URL not set"}</code>
            </div>
            <div className="muted">
              Token: <code className="mono">{runtime?.configured ? "PAPERLESS_NGX_TOKEN configured" : "PAPERLESS_NGX_TOKEN not set"}</code>
            </div>
            {connection?.apiVersion && (
              <div className="muted">
                API: <code className="mono">{connection.apiVersion}</code>
                {connection.serverVersion ? ` · ${connection.serverVersion}` : ""}
              </div>
            )}
            {connection?.lastError && <div className="alert alert--danger">{connection.lastError}</div>}
            <div className="row">
              <button className="btn btn--accent" disabled={busy} onClick={save}>
                {connected ? "Save settings" : "Enable plugin"}
              </button>
              {connection && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    await disconnect({ societyId: society._id, actingUserId });
                    toast.success("Paperless-ngx plugin disabled");
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
            <span className="card__subtitle">Societyer context is converted to Paperless tags.</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <Toggle
              checked={autoCreateTags}
              onChange={setAutoCreateTags}
              label="Create missing Paperless tags"
              hint="When enabled, Societyer creates tag records before upload and sends their Paperless IDs."
            />
            <Toggle
              checked={autoUpload}
              onChange={setAutoUpload}
              label="Auto-upload new document versions"
              hint="New uploads from Documents and Versions are sent to Paperless-ngx after local storage succeeds."
            />
            <Field label="Tag prefix">
              <input
                className="input"
                value={tagPrefix}
                onChange={(event) => setTagPrefix(event.target.value)}
                placeholder="societyer"
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
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
