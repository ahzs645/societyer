import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Webhook, Plus, Power } from "lucide-react";
import { formatDateTime } from "../lib/format";

type Draft = {
  id?: string;
  name: string;
  targetUrl: string;
  eventTypesText: string;
  secret: string;
  status: string;
};

const EMPTY_DRAFT: Draft = { name: "", targetUrl: "", eventTypesText: "*", secret: "", status: "active" };

export function WebhooksPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const { can } = usePermissions();
  const canManage = can("settings:write");
  const subscriptions = useQuery(
    api.apiPlatform.listWebhookSubscriptions,
    society ? { societyId: society._id } : "skip",
  );
  const deliveries = useQuery(
    api.apiPlatform.listWebhookDeliveries,
    society ? { societyId: society._id } : "skip",
  );
  const upsert = useMutation(api.apiPlatform.upsertWebhookSubscription);
  const setStatus = useMutation(api.apiPlatform.setWebhookSubscriptionStatus);
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.targetUrl.trim()) {
      toast.warn("Name and target URL are required");
      return;
    }
    if (!draft.id && !draft.secret.trim()) {
      toast.warn("A signing secret is required for a new endpoint");
      return;
    }
    const eventTypes = draft.eventTypesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await upsert({
      id: draft.id as any,
      societyId: society._id,
      name: draft.name.trim(),
      targetUrl: draft.targetUrl.trim(),
      eventTypes: eventTypes.length ? eventTypes : ["*"],
      secretEncrypted: draft.secret,
      status: draft.status,
      createdByUserId: actingUserId as any,
    } as any);
    toast.success(draft.id ? "Endpoint updated" : "Endpoint created");
    setDraft(null);
  };

  const toggle = async (sub: any) => {
    const next = sub.status === "active" ? "disabled" : "active";
    await setStatus({ id: sub._id, societyId: society._id, status: next, actingUserId } as any);
    toast.success(next === "active" ? "Endpoint enabled" : "Endpoint disabled");
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
            <a className="btn-action" href="/api/docs" target="_blank" rel="noreferrer">
              API docs
            </a>
            {canManage && (
              <button className="btn-action btn-action--primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
                <Plus size={12} /> Add endpoint
              </button>
            )}
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Endpoints</h2><Badge>{subscriptions?.length ?? 0}</Badge></div>
        <table className="table">
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
                  {canManage && (
                    <>
                      <button className="btn btn--ghost btn--sm" onClick={() => setDraft({ id: sub._id, name: sub.name, targetUrl: sub.targetUrl, eventTypesText: (sub.eventTypes ?? []).join(", "), secret: "", status: sub.status })}>Edit</button>
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label={sub.status === "active" ? "Disable" : "Enable"} title={sub.status === "active" ? "Disable" : "Enable"} onClick={() => toggle(sub)}>
                        <Power size={12} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(subscriptions ?? []).length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>No webhook endpoints yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Recent deliveries</h2><Badge>{deliveries?.length ?? 0}</Badge></div>
        <table className="table">
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
              <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No deliveries yet. Deliveries appear here once an event fires for an active endpoint.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit webhook endpoint" : "Add webhook endpoint"}
        footer={
          <>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save endpoint</button>
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
            <Field label={draft.id ? "Signing secret (leave to re-enter; required to save edits)" : "Signing secret"}>
              <input className="input" type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} placeholder="Used to sign each delivery (HMAC)" />
            </Field>
            <Field label="Status">
              <Select value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
