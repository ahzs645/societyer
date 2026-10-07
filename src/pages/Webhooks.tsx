import { authenticatedFetch } from "../lib/authToken";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Banner, Button, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { Webhook, Plus, Power } from "lucide-react";
import { formatDateTime } from "../lib/format";

type Draft = {
  id?: string;
  name: string;
  targetUrl: string;
  eventTypesText: string;
  status: string;
};

const EMPTY_DRAFT: Draft = { name: "", targetUrl: "", eventTypesText: "*", status: "active" };

export function WebhooksPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canManage = can("settings:manage");
  const canConfigure = canManage && !isLocalDataRuntime();
  const subscriptions = useQuery(
    api.apiPlatform.listWebhookSubscriptions,
    society ? { societyId: society._id } : "skip",
  );
  const deliveries = useQuery(
    api.apiPlatform.listWebhookDeliveries,
    society ? { societyId: society._id } : "skip",
  );
  const setStatus = useMutation(api.apiPlatform.setWebhookSubscriptionStatus);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [signingSecret, setSigningSecret] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.targetUrl.trim()) {
      toast.warn("Name and target URL are required");
      return;
    }
    const eventTypes = draft.eventTypesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!canConfigure || saving) return;
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/v1/webhook-subscriptions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, societyId: society._id, name: draft.name.trim(), targetUrl: draft.targetUrl.trim(), eventTypes: eventTypes.length ? eventTypes : ["*"], status: draft.status }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.data?.signingSecret !== "string") {
        throw new Error(result?.error?.message || "The API server could not save this endpoint.");
      }
      setSigningSecret(result.data.signingSecret);
      toast.success(draft.id ? "Endpoint updated; signing secret rotated" : "Endpoint created");
      setDraft(null);
    } catch (error) {
      toast.error("Could not save endpoint", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  };

  const toggle = async (sub: any) => {
    const next = sub.status === "active" ? "disabled" : "active";
    try {
      await setStatus({ id: sub._id, societyId: society._id, status: next } as any);
      toast.success(next === "active" ? "Endpoint enabled" : "Endpoint disabled");
    } catch (error) { toast.error("Could not update endpoint", error instanceof Error ? error.message : "Please try again."); }
  };

  return (
    <div className="page">
      <PageHeader
        title="Webhooks"
        icon={<Webhook size={16} />}
        iconColor="gray"
        subtitle="Send signed event notifications to external systems (n8n, Zapier, your own service). Each delivery is signed with the endpoint's secret and retried on failure."
        actions={
          <>
            {isLocalDataRuntime() ? (
              <button
                className="btn-action"
                disabled
                title="The API reference is served by the Societyer API server, which is not running in this local workspace."
              >
                API docs
              </button>
            ) : (
              <a className="btn-action" href="/api/docs" target="_blank" rel="noreferrer">
                API docs
              </a>
            )}
            {canConfigure && (
              <button className="btn-action btn-action--primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
                <Plus size={12} /> Add endpoint
              </button>
            )}
          </>
        }
      />

      {isLocalDataRuntime() && <Banner tone="info" title="Webhook delivery requires a connected server">Configure endpoints in your hosted workspace so its API server can protect signing secrets and dispatch notifications.</Banner>}
      {signingSecret && <Banner tone="warn" title="Copy this signing secret now — it will not be shown again" onDismiss={() => setSigningSecret(null)}><code className="mono" style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>{signingSecret}</code><Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(signingSecret); toast.success("Signing secret copied"); } catch { toast.error("Clipboard unavailable"); } }}>Copy signing secret</Button></Banner>}
      <div className="card">
        <div className="card__head"><h2 className="card__title">Endpoints</h2><Badge>{subscriptions?.length ?? 0}</Badge></div>
        <div style={{ overflowX: "auto" }}><table className="table">
          <thead>
            <tr><th>Name</th><th>Target URL</th><th>Events</th><th>Secret</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {(subscriptions ?? []).map((sub: any) => (
              <tr key={sub._id}>
                <td><strong>{sub.name}</strong></td>
                <td className="mono" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.targetUrl}</td>
                <td>{(sub.eventTypes ?? []).map((e: string) => <code key={e} className="chip" style={{ fontSize: 11, marginRight: 4 }}>{e}</code>)}</td>
                <td>{sub.hasSecret ? <Badge tone="success">set</Badge> : <Badge tone="warn">none</Badge>}</td>
                <td><Badge tone={sub.status === "active" ? "success" : "neutral"}>{sub.status}</Badge></td>
                <td className="table__actions">
                  {canConfigure && (
                    <>
                      <button className="btn btn--ghost btn--sm" onClick={() => setDraft({ id: sub._id, name: sub.name, targetUrl: sub.targetUrl, eventTypesText: (sub.eventTypes ?? []).join(", "), status: sub.status })}>Edit</button>
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label={sub.status === "active" ? "Disable" : "Enable"} title={sub.status === "active" ? "Disable" : "Enable"} onClick={() => toggle(sub)}>
                        <Power size={12} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(subscriptions ?? []).length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>{subscriptions === undefined ? "Loading endpoints…" : "No webhook endpoints yet."}</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Recent deliveries</h2><Badge>{deliveries?.length ?? 0}</Badge></div>
        <div style={{ overflowX: "auto" }}><table className="table">
          <thead>
            <tr><th>Event</th><th>Status</th><th>Attempts</th><th>When</th><th>Error</th></tr>
          </thead>
          <tbody>
            {(deliveries ?? []).slice(0, 50).map((d: any) => (
              <tr key={d._id}>
                <td className="mono">{d.eventType}</td>
                <td><Badge tone={d.status === "delivered" ? "success" : d.status === "failed" ? "danger" : "warn"}>{d.status}</Badge></td>
                <td className="mono">{d.attempts ?? 0}</td>
                <td className="mono">{d.lastAttemptAtISO ? formatDateTime(d.lastAttemptAtISO) : d.createdAtISO ? formatDateTime(d.createdAtISO) : "—"}</td>
                <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.lastError ?? "—"}</td>
              </tr>
            ))}
            {(deliveries ?? []).length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>{deliveries === undefined ? "Loading deliveries…" : "No deliveries yet. Deliveries appear here once an event fires for an active endpoint."}</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit webhook endpoint" : "Add webhook endpoint"}
        footer={
          <>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={save} disabled={!canConfigure || saving || !draft?.name.trim() || !draft?.targetUrl.trim()}>{saving ? "Saving…" : "Save endpoint"}</button>
          </>
        }
      >
        {draft && (
          <div>
            <Field label="Name"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. n8n governance pipeline" /></Field>
            <Field label="Target URL"><input className="input" value={draft.targetUrl} onChange={(e) => setDraft({ ...draft, targetUrl: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Event types (comma-separated, * for all)">
              <input className="input" value={draft.eventTypesText} onChange={(e) => setDraft({ ...draft, eventTypesText: e.target.value })} placeholder="*, meeting.created, filing.due" />
            </Field>
            <p className="muted">{draft.id ? "Saving rotates the signing secret. Update your receiving service with the new secret." : "The server generates a signing secret and shows it once after saving."}</p>
            <Field label="Status">
              <Select value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
