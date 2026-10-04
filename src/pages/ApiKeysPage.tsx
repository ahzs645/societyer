import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { authenticatedFetch } from "../lib/authToken";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { usePermissions } from "../hooks/usePermissions";
import { PERMISSIONS } from "../../shared/functions/permissions";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field, Button, Banner, SettingsShell } from "../components/ui";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { ArrowLeft, KeyRound, Plus, Trash2, Copy, Check } from "lucide-react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";

export function ApiKeysPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const clients = useQuery(api.apiPlatform.listClients, society ? { societyId: society._id } : "skip");
  const tokens = useQuery(api.apiPlatform.listTokens, society ? { societyId: society._id } : "skip");
  const createClient = useMutation(api.apiPlatform.createClient);
  const updateClient = useMutation(api.apiPlatform.updateClient);
  const { can, loaded } = usePermissions();
  const canManageClients = loaded && can("settings:write");
  const canMint = loaded && can("settings:manage") && !isLocalDataRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "tokens" ? "tokens" : "clients";
  const changeTab = (tab: string) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous); next.set("tab", tab); return next;
  });
  const revokeToken = useMutation(api.apiPlatform.revokeToken);
  const confirm = useConfirm();
  const toast = useToast();

  const [clientOpen, setClientOpen] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", description: "" });
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenForm, setTokenForm] = useState({ clientId: "", name: "", scopes: "documents:read" });
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [clientsViewId, setClientsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [clientsFilterOpen, setClientsFilterOpen] = useState(false);
  const [tokensViewId, setTokensViewId] = useState<Id<"views"> | undefined>(undefined);
  const [tokensFilterOpen, setTokensFilterOpen] = useState(false);

  const clientsTableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "apiClient",
    viewId: clientsViewId,
  });
  const tokensTableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "apiToken",
    viewId: tokensViewId,
  });

  const clientById = useMemo(
    () => new Map<string, any>((clients ?? []).map((c: any) => [String(c._id), c])),
    [clients],
  );
  const tokenRecords = useMemo(
    () =>
      (tokens ?? []).map((t: any) => ({
        ...t,
        clientName: clientById.get(String(t.clientId))?.name ?? "—",
      })),
    [tokens, clientById],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const saveClient = async () => {
    if (!canManageClients || !clientForm.name.trim() || saving) return;
    setSaving(true);
    try {
      await createClient({ societyId: society._id, name: clientForm.name.trim(),
        description: clientForm.description || undefined, createdByUserId: actingUserId });
      setClientOpen(false);
      setClientForm({ name: "", description: "" });
      changeTab("clients");
      toast.success("Client created");
    } catch (error) {
      toast.error("Could not create client", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  };

  const saveToken = async () => {
    if (!canMint || !tokenForm.clientId || !tokenForm.name.trim() || saving) return;
    const scopes = tokenForm.scopes.split(/\s+/).filter(Boolean);
    if (!scopes.length || scopes.some((scope) => !(PERMISSIONS as readonly string[]).includes(scope))) {
      toast.warn("Choose supported permission scopes", "For example: documents:read members:read");
      return;
    }
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/v1/api-tokens", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ societyId: society._id, clientId: tokenForm.clientId, name: tokenForm.name.trim(), scopes }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.data?.token !== "string") {
        throw new Error(result?.error?.message || "The API server could not mint this token.");
      }
      setRevealedToken(result.data.token);
      setTokenOpen(false);
      changeTab("tokens");
      setTokenForm({ clientId: "", name: "", scopes: "documents:read" });
    } catch (error) {
      toast.error("Could not mint token", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  };

  const copyToken = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const clientsShowMetadataWarning = !clientsTableData.loading && !clientsTableData.objectMetadata;
  const tokensShowMetadataWarning = !tokensTableData.loading && !tokensTableData.objectMetadata;

  return (
    <div className="page">
      <Link to="/app/settings" className="row muted" style={{ marginBottom: 12, fontSize: 12 }}>
        <ArrowLeft size={12} /> Back to settings
      </Link>
      <SettingsShell
        title="API keys"
        description="Programmatic access to Societyer — create clients, then mint tokens with scoped permissions."
        tabs={[
          { id: "clients", label: "Clients", icon: <KeyRound size={14} /> },
          { id: "tokens", label: "Tokens", icon: <ShieldCheckIcon /> },
        ]}
        activeTab={activeTab}
        onTabChange={changeTab}
        actions={
          <>
            <Button disabled={!canManageClients} onClick={() => setClientOpen(true)}>
              <Plus size={12} /> New client
            </Button>
            <Button
              variant="accent"
              disabled={!canMint || !(clients ?? []).some((client: any) => client.status === "active")}
              onClick={() => {
                setTokenForm({
                  clientId: String(clients?.find((client: any) => client.status === "active")?._id ?? ""),
                  name: "",
                  scopes: "documents:read",
                });
                setTokenOpen(true);
              }}
            >
              <Plus size={12} /> New token
            </Button>
          </>
        }
      >

      {isLocalDataRuntime() && <Banner tone="info" title="API tokens require a connected server">Client records can be managed here. Mint tokens from your hosted workspace so its API server can issue and verify them.</Banner>}
      {revealedToken && (
        <Banner
          tone="warn"
          title="Copy this token now — it won't be shown again"
          onDismiss={() => setRevealedToken(null)}
        >
          <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <code className="mono" style={{ maxWidth: "100%", overflowWrap: "anywhere", whiteSpace: "normal", padding: "4px 8px", background: "var(--bg-panel)", borderRadius: 4 }}>
              {revealedToken}
            </code>
            <Button size="sm" onClick={() => copyToken(revealedToken)}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Banner>
      )}

      {activeTab === "clients" && <section role="tabpanel" aria-label="Clients">
      <h2 style={{ marginTop: 24, fontSize: "var(--fs-md)" }}>Clients</h2>
      {clientsShowMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="apiClient" />
      ) : clientsTableData.objectMetadata ? (
        <RecordTableScope
          tableId="api-clients"
          objectMetadata={clientsTableData.objectMetadata}
          hydratedView={clientsTableData.hydratedView}
          records={(clients ?? []) as any[]}
          onUpdate={canManageClients ? async ({ recordId, fieldName, value }) => {
            if (!canManageClients || !["name", "description", "kind", "status"].includes(fieldName)) return;
            await updateClient({
              id: recordId as Id<"apiClients">,
              patch: { [fieldName]: value } as any,
            });
          } : undefined}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={clientsTableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<KeyRound size={14} />}
            label="API clients"
            views={clientsTableData.views}
            currentViewId={clientsViewId ?? clientsTableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setClientsViewId(viewId as Id<"views">)}
            onOpenFilter={() => setClientsFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover
            open={clientsFilterOpen}
            onClose={() => setClientsFilterOpen(false)}
          />
          <RecordTableFilterChips />
          <RecordTable loading={clientsTableData.loading || clients === undefined} />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      </section>}
      {activeTab === "tokens" && <section role="tabpanel" aria-label="Tokens">
      <h2 style={{ fontSize: "var(--fs-md)" }}>Tokens</h2>
      {tokensShowMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="apiToken" />
      ) : tokensTableData.objectMetadata ? (
        <RecordTableScope
          tableId="api-tokens"
          objectMetadata={tokensTableData.objectMetadata}
          hydratedView={tokensTableData.hydratedView}
          records={tokenRecords}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tokensTableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<KeyRound size={14} />}
            label="API tokens"
            views={tokensTableData.views}
            currentViewId={tokensViewId ?? tokensTableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setTokensViewId(viewId as Id<"views">)}
            onOpenFilter={() => setTokensFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover
            open={tokensFilterOpen}
            onClose={() => setTokensFilterOpen(false)}
          />
          <RecordTableFilterChips />
          <RecordTable
            loading={tokensTableData.loading || tokens === undefined}
            renderRowActions={(r) =>
              canManageClients && r.status === "active" ? (
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Revoke token ${r.name}`}
                  disabled={isLocalDataRuntime()}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!canManageClients || isLocalDataRuntime()) return;
                    const ok = await confirm({
                      title: "Revoke token?",
                      message:
                        "Revoking is permanent and will break any integrations using this token.",
                      confirmLabel: "Revoke",
                      tone: "danger",
                    });
                    if (!ok || !canManageClients || isLocalDataRuntime()) return;
                    await revokeToken({ id: r._id });
                    toast.success("Token revoked");
                  }}
                >
                  <Trash2 size={12} />
                </button>
              ) : null
            }
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      </section>}
      <Drawer
        open={clientOpen}
        onClose={() => setClientOpen(false)}
        title="New API client"
        footer={
          <>
            <Button onClick={() => setClientOpen(false)}>Cancel</Button>
            <Button variant="accent" onClick={saveClient} disabled={!canManageClients || saving || !clientForm.name.trim()}>Create</Button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" value={clientForm.description} onChange={(e) => setClientForm({ ...clientForm, description: e.target.value })} />
        </Field>
      </Drawer>

      <Drawer
        open={tokenOpen}
        onClose={() => setTokenOpen(false)}
        title="New API token"
        footer={
          <>
            <Button onClick={() => setTokenOpen(false)}>Cancel</Button>
            <Button variant="accent" onClick={saveToken} disabled={!canMint || saving || !tokenForm.name.trim() || !tokenForm.clientId}>Mint token</Button>
          </>
        }
      >
        <Field label="Client">
          <Select
            value={tokenForm.clientId}
            onChange={(value) => setTokenForm({ ...tokenForm, clientId: value })}
            options={(clients ?? []).filter((client: any) => client.status === "active").map((c: any) => ({ value: c._id, label: c.name }))}
          />
        </Field>
        <Field label="Name">
          <input className="input" value={tokenForm.name} onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })} />
        </Field>
        <Field label="Scopes (space-separated)" hint="Use current permission names, such as documents:read or members:read. Your role limits every token action.">
          <input className="input" value={tokenForm.scopes} onChange={(e) => setTokenForm({ ...tokenForm, scopes: e.target.value })} />
        </Field>
      </Drawer>
      </SettingsShell>
    </div>
  );
}

function ShieldCheckIcon() {
  return <KeyRound size={14} />;
}
