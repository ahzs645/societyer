import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, Button, Banner } from "../components/ui";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { KeyRound, Plus, Trash2, Copy, Check } from "lucide-react";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const base = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `sk_${base}`;
}

/**
 * API keys page — two stacked record tables. Clients (top) allow
 * inline edits for name/description/kind/status via `updateClient`.
 * Tokens (bottom) are fully read-only (their backend mutation set is
 * create / revoke only — you can't retitle a minted token); the
 * `clientName` column is projected client-side from the clients
 * query since tokens only store the FK `clientId`.
 */
export function ApiKeysPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const clients = useQuery(api.apiPlatform.listClients, society ? { societyId: society._id } : "skip");
  const tokens = useQuery(api.apiPlatform.listTokens, society ? { societyId: society._id } : "skip");
  const createClient = useMutation(api.apiPlatform.createClient);
  const updateClient = useMutation(api.apiPlatform.updateClient);
  const createToken = useMutation(api.apiPlatform.createToken);
  const revokeToken = useMutation(api.apiPlatform.revokeToken);
  const confirm = useConfirm();
  const toast = useToast();

  const [clientOpen, setClientOpen] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", description: "" });
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenForm, setTokenForm] = useState({ clientId: "", name: "", scopes: "read:records" });
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
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

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const saveClient = async () => {
    if (!clientForm.name.trim()) return;
    await createClient({
      societyId: society._id,
      name: clientForm.name.trim(),
      description: clientForm.description || undefined,
      createdByUserId: actingUserId,
    });
    setClientOpen(false);
    setClientForm({ name: "", description: "" });
    toast.success("Client created");
  };

  const saveToken = async () => {
    if (!tokenForm.clientId || !tokenForm.name.trim()) return;
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    await createToken({
      societyId: society._id,
      clientId: tokenForm.clientId as any,
      name: tokenForm.name.trim(),
      tokenHash,
      tokenStart: token.slice(0, 10),
      scopes: tokenForm.scopes.split(/\s+/).filter(Boolean),
      createdByUserId: actingUserId,
    });
    setRevealedToken(token);
    setTokenOpen(false);
    setTokenForm({ clientId: "", name: "", scopes: "read:records" });
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
      <PageHeader
        title="API keys"
        icon={<KeyRound size={16} />}
        iconColor="gray"
        subtitle="Programmatic access to Societyer — create clients, then mint tokens with scoped permissions."
        actions={
          <>
            <Button onClick={() => setClientOpen(true)}>
              <Plus size={12} /> New client
            </Button>
            <Button
              variant="accent"
              disabled={(clients ?? []).length === 0}
              onClick={() => {
                setTokenForm({
                  clientId: String(clients?.[0]?._id ?? ""),
                  name: "",
                  scopes: "read:records",
                });
                setTokenOpen(true);
              }}
            >
              <Plus size={12} /> New token
            </Button>
          </>
        }
      />

      {revealedToken && (
        <Banner
          tone="warn"
          title="Copy this token now — it won't be shown again"
          onDismiss={() => setRevealedToken(null)}
        >
          <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 6 }}>
            <code className="mono" style={{ padding: "4px 8px", background: "var(--bg-panel)", borderRadius: 4 }}>
              {revealedToken}
            </code>
            <Button size="sm" onClick={() => copyToken(revealedToken)}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Banner>
      )}

      <h2 style={{ marginTop: 24, fontSize: "var(--fs-md)" }}>Clients</h2>
      {clientsShowMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            apiClient object metadata + default view.
          </div>
        </div>
      ) : clientsTableData.objectMetadata ? (
        <RecordTableScope
          tableId="api-clients"
          objectMetadata={clientsTableData.objectMetadata}
          hydratedView={clientsTableData.hydratedView}
          records={(clients ?? []) as any[]}
          onUpdate={async ({ recordId, fieldName, value }) => {
            if (!["name", "description", "kind", "status"].includes(fieldName)) return;
            await updateClient({
              id: recordId as Id<"apiClients">,
              patch: { [fieldName]: value } as any,
            });
          }}
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

      <div style={{ height: 24 }} />
      <h2 style={{ fontSize: "var(--fs-md)" }}>Tokens</h2>
      {tokensShowMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            apiToken object metadata + default view.
          </div>
        </div>
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
              r.status === "active" ? (
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Revoke token ${r.name}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm({
                      title: "Revoke token?",
                      message:
                        "Revoking is permanent and will break any integrations using this token.",
                      confirmLabel: "Revoke",
                      tone: "danger",
                    });
                    if (!ok) return;
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

      <Drawer
        open={clientOpen}
        onClose={() => setClientOpen(false)}
        title="New API client"
        footer={
          <>
            <Button onClick={() => setClientOpen(false)}>Cancel</Button>
            <Button variant="accent" onClick={saveClient} disabled={!clientForm.name.trim()}>Create</Button>
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
            <Button variant="accent" onClick={saveToken} disabled={!tokenForm.name.trim() || !tokenForm.clientId}>Mint token</Button>
          </>
        }
      >
        <Field label="Client">
          <select className="input" value={tokenForm.clientId} onChange={(e) => setTokenForm({ ...tokenForm, clientId: e.target.value })}>
            {(clients ?? []).map((c: any) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input className="input" value={tokenForm.name} onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })} />
        </Field>
        <Field label="Scopes (space-separated)">
          <input className="input" value={tokenForm.scopes} onChange={(e) => setTokenForm({ ...tokenForm, scopes: e.target.value })} />
        </Field>
      </Drawer>
    </div>
  );
}
