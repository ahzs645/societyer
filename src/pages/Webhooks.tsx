import { authenticatedFetch } from "../lib/authToken";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Banner, Button, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { TooltipCopyable } from "../components/TooltipCopyable";
import { useToast } from "../components/Toast";
import { Webhook, Plus, Power } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { Tooltip } from "../components/Tooltip";
import {
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type RecordTableCardHelpers,
} from "../platform/record-engine/record-table";
import { FIELD_TYPES, type FieldMetadata } from "../platform/record-engine/types";

type Draft = {
  id?: string;
  name: string;
  targetUrl: string;
  eventTypesText: string;
  status: string;
};

function capitalize(value?: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

const EMPTY_DRAFT: Draft = { name: "", targetUrl: "", eventTypesText: "*", status: "active" };

/** A webhook endpoint as apiPlatform:listWebhookSubscriptions returns it. */
type WebhookEndpoint = {
  _id: string;
  name: string;
  targetUrl: string;
  eventTypes?: string[];
  hasSecret?: boolean;
  status: string;
};
type EndpointRecord = WebhookEndpoint & { events: string };

type WebhookDelivery = {
  _id: string;
  eventType: string;
  status: string;
  attempts?: number;
  lastAttemptAtISO?: string;
  createdAtISO?: string;
  lastError?: string;
};
type DeliveryRecord = WebhookDelivery & { attempts: number; when: string | null };

const ENDPOINTS_TABLE = staticRecordTable({
  id: "webhook-endpoints",
  nameSingular: "webhookEndpoint",
  namePlural: "webhookEndpoints",
  labelSingular: "Endpoint",
  labelPlural: "Endpoints",
  labelIdentifierFieldName: "name",
  fields: [
    { name: "name", label: "Name", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
    { name: "targetUrl", label: "Target URL", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    { name: "events", label: "Events", fieldType: FIELD_TYPES.TEXT, size: 220 },
    { name: "hasSecret", label: "Secret", fieldType: FIELD_TYPES.BOOLEAN, size: 100, config: { trueLabel: "Set", falseLabel: "None" } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      config: { options: [{ value: "active", label: "Active", color: "green" }, { value: "disabled", label: "Disabled", color: "gray" }] },
    },
  ],
});

const DELIVERIES_TABLE = staticRecordTable({
  id: "webhook-deliveries",
  nameSingular: "webhookDelivery",
  namePlural: "webhookDeliveries",
  labelSingular: "Delivery",
  labelPlural: "Deliveries",
  labelIdentifierFieldName: "eventType",
  fields: [
    { name: "eventType", label: "Event", fieldType: FIELD_TYPES.TEXT, size: 220 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "pending", label: "Pending", color: "amber" },
          { value: "delivered", label: "Delivered", color: "green" },
          { value: "failed", label: "Failed", color: "red" },
        ],
      },
    },
    { name: "attempts", label: "Attempts", fieldType: FIELD_TYPES.NUMBER, size: 100, config: { groupable: false } },
    { name: "when", label: "When", fieldType: FIELD_TYPES.DATE_TIME, size: 180 },
    { name: "lastError", label: "Error", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
  ],
});

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
  const endpointRecords = useMemo<EndpointRecord[]>(
    () => ((subscriptions ?? []) as WebhookEndpoint[]).map((sub) => ({ ...sub, events: (sub.eventTypes ?? []).join(", ") })),
    [subscriptions],
  );
  const deliveryRecords = useMemo<DeliveryRecord[]>(
    () => ((deliveries ?? []) as WebhookDelivery[]).slice(0, 50).map((delivery) => ({
      ...delivery,
      attempts: delivery.attempts ?? 0,
      when: delivery.lastAttemptAtISO ?? delivery.createdAtISO ?? null,
    })),
    [deliveries],
  );

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

  const toggle = async (sub: WebhookEndpoint) => {
    const next = sub.status === "active" ? "disabled" : "active";
    try {
      await setStatus({ id: sub._id, societyId: society._id, status: next });
      toast.success(next === "active" ? "Endpoint enabled" : "Endpoint disabled");
    } catch (error) { toast.error("Could not update endpoint", error instanceof Error ? error.message : "Please try again."); }
  };

  const renderEndpointCell = ({ record: sub, field }: { record: EndpointRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "name":
        return <strong>{sub.name}</strong>;
      case "targetUrl":
        return <span className="mono"><TooltipCopyable value={sub.targetUrl} label="target URL" className="copyable--truncate" /></span>;
      case "events":
        return <span>{(sub.eventTypes ?? []).map((e) => <code key={e} className="chip" style={{ fontSize: 11, marginRight: 4 }}>{e}</code>)}</span>;
      case "hasSecret":
        return sub.hasSecret ? <Badge tone="success">Set</Badge> : <Badge tone="warn">None</Badge>;
      case "status":
        return <Badge tone={sub.status === "active" ? "success" : "neutral"}>{capitalize(sub.status)}</Badge>;
      default:
        return undefined;
    }
  };

  const renderEndpointActions = (sub: EndpointRecord) => (
    <>
      <button type="button" className="btn btn--ghost btn--sm" aria-label={`Edit ${sub.name}`} onClick={() => setDraft({ id: sub._id, name: sub.name, targetUrl: sub.targetUrl, eventTypesText: (sub.eventTypes ?? []).join(", "), status: sub.status })}>Edit</button>
      <Tooltip content={sub.status === "active" ? "Disable deliveries" : "Enable deliveries"}>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`${sub.status === "active" ? "Disable" : "Enable"} ${sub.name}`} onClick={() => toggle(sub)}>
          <Power size={12} />
        </button>
      </Tooltip>
    </>
  );

  const renderEndpointCard = (sub: EndpointRecord, { selecting }: RecordTableCardHelpers) => {
    return (
      <RecordTablePhoneCard
        title={sub.name}
        badge={<Badge tone={sub.status === "active" ? "success" : "neutral"}>{capitalize(sub.status)}</Badge>}
        meta={[<span className="mono">{sub.targetUrl}</span>]}
        detail={[sub.events, sub.hasSecret ? "Secret set" : "No secret"]}
        selecting={selecting}
      />
    );
  };

  const deliveryTone = (status: string) => status === "delivered" ? "success" : status === "failed" ? "danger" : "warn";

  const renderDeliveryCell = ({ record: delivery, field }: { record: DeliveryRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "eventType":
        return <span className="mono">{delivery.eventType}</span>;
      case "status":
        return <Badge tone={deliveryTone(delivery.status)}>{capitalize(delivery.status)}</Badge>;
      case "attempts":
        return <span className="mono">{delivery.attempts}</span>;
      case "when":
        return <span>{delivery.when ? formatDateTime(delivery.when) : "—"}</span>;
      case "lastError":
        return <span className="muted">{delivery.lastError ?? "—"}</span>;
      default:
        return undefined;
    }
  };

  const renderDeliveryCard = (delivery: DeliveryRecord, { selecting }: RecordTableCardHelpers) => {
    return (
      <RecordTablePhoneCard
        title={<span className="mono">{delivery.eventType}</span>}
        recordName={delivery.eventType}
        badge={<Badge tone={deliveryTone(delivery.status)}>{capitalize(delivery.status)}</Badge>}
        meta={[delivery.when ? formatDateTime(delivery.when) : "", `${delivery.attempts} attempt${delivery.attempts === 1 ? "" : "s"}`]}
        detail={[delivery.lastError ?? ""]}
        selecting={selecting}
      />
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Webhooks"
        icon={<Webhook size={16} />}
        iconColor="gray"
        subtitle="Send signed event notifications to other systems."
        info={
          <p>
            Send signed event notifications to external systems (n8n, Zapier, your own service). Each delivery is signed
            with the endpoint's secret and retried on failure.
          </p>
        }
        actions={
          <>
            {/* The API reference is served by the API server, which a local
              * workspace doesn't run — hide the link rather than show it greyed. */}
            {!isLocalDataRuntime() && (
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
        <RecordListTable<EndpointRecord>
          variant="card"
          table={ENDPOINTS_TABLE}
          tableId="webhook-endpoints"
          label="All endpoints"
          icon={<Webhook size={14} />}
          records={endpointRecords}
          loading={subscriptions === undefined}
          renderCell={renderEndpointCell}
          renderRowActions={canConfigure ? renderEndpointActions : undefined}
          renderPhoneCard={renderEndpointCard}
          emptyState={<RecordTableEmpty title="No webhook endpoints yet." />}
        />
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Recent deliveries</h2><Badge>{deliveries?.length ?? 0}</Badge></div>
        <RecordListTable<DeliveryRecord>
          variant="card"
          table={DELIVERIES_TABLE}
          tableId="webhook-deliveries"
          label="Latest deliveries"
          icon={<Webhook size={14} />}
          records={deliveryRecords}
          loading={deliveries === undefined}
          renderCell={renderDeliveryCell}
          renderPhoneCard={renderDeliveryCard}
          emptyState={<RecordTableEmpty title="No deliveries yet." />}
        />
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
