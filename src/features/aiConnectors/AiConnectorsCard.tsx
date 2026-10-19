import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, Plug } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Banner, Button, Field } from "../../components/ui";
import { Checkbox, RadioGroup, Toggle } from "../../components/Controls";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime, relative } from "../../lib/format";
import { copyTextToClipboard } from "../../lib/regulatoryCitations";
import { connectorStatus } from "./connectorDisplay";
import type { Id } from "../../../convex/_generated/dataModel";

/** What convex/agentConnectors.ts `overview` returns. */
/** One session of a connected app: the token family a code exchange started (convex/lib/oauthSessions.ts). */
type ConnectorSession = {
  familyId: string;
  clientName: string;
  redirectHost: string;
  createdAtISO: string;
  lastUsedAtISO?: string;
  expiresAtISO: string;
};
type ConnectorScope = { permission: string; kind: "read" | "write"; label: string; description: string; held: boolean };
type ConnectorGrant = {
  _id: Id<"agentGrants">;
  /** "token": a personal token. "oauth": an app connected through OAuth (claude.ai, ChatGPT, CLI sign-in). */
  kind: "token" | "oauth";
  name: string;
  tokenHint?: string;
  clientHost?: string;
  scopes: string[];
  allowedTools?: string[];
  createdAtISO: string;
  expiresAtISO: string;
  lastUsedAtISO?: string;
  revokedAtISO?: string;
  createdBy?: string;
  /** Live OAuth grants: each consent's sessions. */
  sessions?: ConnectorSession[];
};
type ConnectorOverview = {
  enabled: boolean;
  canManageWorkspace: boolean;
  endpointUrl: string | null;
  oauthAvailable: boolean;
  scopeOptions: ConnectorScope[];
  defaultScopes: string[];
  limits: { defaultDays: number; maxDays: number; requestsPerMinute: number };
  grants: ConnectorGrant[];
  workspaceGrants: ConnectorGrant[];
};
type Minted = { token: string; grant: ConnectorGrant };

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
];
const ENDPOINT_PLACEHOLDER = "https://<your-deployment>.convex.site/mcp";

/** Copy-ready setup for the clients that take a bearer token today. */
export function connectorSetupSnippets(endpoint: string, token?: string) {
  const exportLine = `export SOCIETYER_MCP_TOKEN="${token ?? "soc_mcp_…"}"`;
  return [
    { id: "codex", label: "Codex CLI", code: `${exportLine}\ncodex mcp add societyer --url ${endpoint} --bearer-token-env-var SOCIETYER_MCP_TOKEN` },
    { id: "claude", label: "Claude Code", code: `${exportLine}\nclaude mcp add --transport http societyer ${endpoint} --header "Authorization: Bearer $SOCIETYER_MCP_TOKEN"` },
    { id: "inspector", label: "MCP Inspector", code: `${exportLine}\nnpx @modelcontextprotocol/inspector --cli ${endpoint} --transport http --method tools/list --header "Authorization: Bearer $SOCIETYER_MCP_TOKEN"` },
  ];
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={copied ? <Check size={12} /> : <Copy size={12} />}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        if (!(await copyTextToClipboard(value))) {
          toast.error("Clipboard unavailable", "Select the text and copy it instead.");
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Snippets({ endpoint, token }: { endpoint: string; token?: string }) {
  return (
    <div className="ai-connectors__snippets">
      {connectorSetupSnippets(endpoint, token).map((snippet) => (
        <div key={snippet.id} className="ai-connectors__snippet">
          <div className="ai-connectors__snippet-head">
            <strong>{snippet.label}</strong>
            <CopyButton value={snippet.code} label={`${snippet.label} setup`} />
          </div>
          <pre className="ai-connectors__code">{snippet.code}</pre>
        </div>
      ))}
    </div>
  );
}

function GrantRow({ grant, connectorsEnabled, onRevoke, onRevokeSession }: {
  grant: ConnectorGrant;
  connectorsEnabled: boolean;
  onRevoke: (grant: ConnectorGrant) => void;
  onRevokeSession: (grant: ConnectorGrant, session: ConnectorSession) => void;
}) {
  const status = connectorStatus({ ...grant, connectorsEnabled }, Date.now());
  return (
    <div className="settings-row ai-connectors__grant">
      <div className="ai-connectors__grant-body">
        <div className="ai-connectors__grant-title">
          <strong>{grant.name}</strong>
          <Badge tone={status.tone}>{status.label}</Badge>
          {grant.scopes.includes("tasks:write") && <Badge tone="warn">Can propose changes</Badge>}
        </div>
        <div className="muted ai-connectors__grant-meta">
          {grant.kind === "oauth"
            ? (
              <span className="ai-connectors__client-host">
                Connected with OAuth · {grant.clientHost ? <span className="mono">{grant.clientHost}</span> : "self-registered app (unverified)"}
              </span>
            )
            : <span className="mono">{grant.tokenHint}</span>}
          {status.note && <span>{status.note}</span>}
          {grant.createdBy && <span>{grant.createdBy}</span>}
          <span>Last used {grant.lastUsedAtISO ? relative(grant.lastUsedAtISO) : "never"}</span>
          <span title={formatDateTime(status.dateISO)}>{status.dateLabel} {formatDate(status.dateISO)}</span>
        </div>
        {grant.sessions && status.live && <SessionList grant={grant} sessions={grant.sessions} onRevoke={onRevokeSession} />}
      </div>
      {status.live && <Button size="sm" onClick={() => onRevoke(grant)}>{grant.kind === "oauth" ? "Disconnect" : "Revoke"}</Button>}
    </div>
  );
}

/**
 * The sessions of a connected app, one per time someone approved it. A
 * session you don't recognise (say, one started just after you approved a
 * link someone sent you) can be revoked alone.
 */
function SessionList({ grant, sessions, onRevoke }: {
  grant: ConnectorGrant;
  sessions: ConnectorSession[];
  onRevoke: (grant: ConnectorGrant, session: ConnectorSession) => void;
}) {
  if (!sessions.length) return <p className="muted ai-connectors__sessions-empty">No active sessions. The app asks you to connect again next time.</p>;
  return (
    <ul className="ai-connectors__sessions" aria-label={`${grant.name} sessions`}>
      {sessions.map((session) => (
        <li key={session.familyId} className="ai-connectors__session">
          <div className="ai-connectors__session-text">
            <span>
              {session.clientName} · returns to <span className="mono">{session.redirectHost}</span>
            </span>
            <span className="muted">
              Started <span title={formatDateTime(session.createdAtISO)}>{relative(session.createdAtISO)}</span>
              {" · "}last used {session.lastUsedAtISO ? relative(session.lastUsedAtISO) : "never"}
            </span>
          </div>
          {sessions.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => onRevoke(grant, session)}>Revoke</Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Name, expiry and scopes for a new token. Read-only is the default; task creation is opt-in. */
function CreateTokenForm({ societyId, overview, onCancel, onCreated }: {
  societyId: Id<"societies">;
  overview: ConnectorOverview;
  onCancel: () => void;
  onCreated: (minted: Minted) => void;
}) {
  const mintToken = useAction(api.agentConnectors.mintToken);
  const toast = useToast();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState(String(overview.limits.defaultDays));
  const [preset, setPreset] = useState<"read" | "custom">("read");
  const [custom, setCustom] = useState<string[]>(overview.defaultScopes);
  const [saving, setSaving] = useState(false);
  const scopes = preset === "read" ? overview.defaultScopes : custom;
  const toggleScope = (permission: string, on: boolean) =>
    setCustom((current) => (on ? [...current, permission] : current.filter((entry) => entry !== permission)));

  const create = async () => {
    if (saving || !name.trim() || !scopes.length) return;
    setSaving(true);
    try {
      onCreated((await mintToken({ societyId, name: name.trim(), expiresInDays: Number(expiry), scopes })) as Minted);
    } catch (error) {
      toast.error("Couldn't create the token", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const scopeBox = (scope: ConnectorScope) => (
    <Checkbox
      key={scope.permission}
      checked={custom.includes(scope.permission)}
      disabled={!scope.held}
      onChange={(on) => toggleScope(scope.permission, on)}
      label={scope.kind === "write"
        ? <span className="ai-connectors__write-label">{scope.label} <Badge tone="warn">Proposes changes</Badge></span>
        : scope.label}
      hint={scope.held ? scope.description : "Your role doesn't include this."}
    />
  );

  return (
    <div className="ai-connectors__form">
      <div className="ai-connectors__form-row">
        <Field label="Name" hint="Where you'll use it, e.g. “Codex on my laptop”." className="field--grow">
          <input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="Expires after">
          <Select value={expiry} onChange={setExpiry} options={EXPIRY_OPTIONS} />
        </Field>
      </div>
      <RadioGroup
        value={preset}
        onChange={setPreset}
        options={[
          { value: "read", label: "Read-only (recommended)", hint: "Everything your role can read: meetings, minutes, documents, tasks and deadlines." },
          { value: "custom", label: "Choose what it can read", hint: "Pick the record types. You can add task creation here." },
        ]}
      />
      {preset === "custom" && (
        <div className="ai-connectors__scopes">
          {overview.scopeOptions.filter((scope) => scope.kind === "read").map(scopeBox)}
          {overview.scopeOptions.filter((scope) => scope.kind === "write").map(scopeBox)}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" onClick={create} disabled={saving || !name.trim() || !scopes.length}>
          {saving ? "Creating…" : "Create token"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** Revoke one session of a connected app, after confirming; its other sessions keep working. */
function useRevokeSession() {
  const revokeToken = useMutation(api.agentConnectors.revokeToken);
  const confirm = useConfirm();
  const toast = useToast();
  return async (grant: ConnectorGrant, session: ConnectorSession) => {
    const ok = await confirm({
      title: `Revoke this ${grant.name} session?`,
      message: `The session started ${formatDateTime(session.createdAtISO)} loses access right away. ${grant.name}'s other sessions keep working.`,
      confirmLabel: "Revoke session",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeToken({ grantId: grant._id, familyId: session.familyId });
      toast.success("Session revoked");
    } catch (error) {
      toast.error("Couldn't revoke the session", error instanceof Error ? error.message : "Please try again.");
    }
  };
}

/**
 * Settings → AI connectors (hosted runtimes only): the workspace opt-in, personal
 * tokens for the remote MCP endpoint and setup for Codex CLI, Claude Code and
 * MCP Inspector. See docs/mcp-connector.md.
 */
export function AiConnectorsCard({ societyId }: { societyId: Id<"societies"> }) {
  const overview = useQuery(api.agentConnectors.overview, { societyId }) as ConnectorOverview | undefined;
  const setEnabled = useMutation(api.agentConnectors.setEnabled);
  const revokeToken = useMutation(api.agentConnectors.revokeToken);
  const confirm = useConfirm();
  const toast = useToast();
  const revokeSession = useRevokeSession();
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);

  if (!overview) return null;
  const endpoint = overview.endpointUrl ?? ENDPOINT_PLACEHOLDER;

  const revoke = async (grant: ConnectorGrant) => {
    const oauth = grant.kind === "oauth";
    const ok = await confirm({
      title: oauth ? `Disconnect ${grant.name}?` : `Revoke "${grant.name}"?`,
      message: oauth
        ? `${grant.name} loses access to this workspace right away. To use it again, connect it from the app and approve again.`
        : "Any AI client using this token loses access right away. This can't be undone; create a new token to reconnect.",
      confirmLabel: oauth ? "Disconnect" : "Revoke",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeToken({ grantId: grant._id });
      if (minted?.grant._id === grant._id) setMinted(null);
      toast.success(oauth ? `${grant.name} disconnected` : "Token revoked");
    } catch (error) {
      toast.error(oauth ? "Couldn't disconnect the app" : "Couldn't revoke the token", error instanceof Error ? error.message : "Please try again.");
    }
  };
  const row = (grant: ConnectorGrant) => (
    <GrantRow key={grant._id} grant={grant} connectorsEnabled={overview.enabled} onRevoke={revoke} onRevokeSession={revokeSession} />
  );
  const myApps = overview.grants.filter((grant) => grant.kind === "oauth");
  const myTokens = overview.grants.filter((grant) => grant.kind !== "oauth");

  const changeEnabled = async (enabled: boolean) => {
    try {
      await setEnabled({ societyId, enabled });
    } catch (error) {
      toast.error("Couldn't change AI connector access", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <div className="card ai-connectors" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">AI connectors</h2>
        <span className="card__subtitle">Use this workspace from Claude, ChatGPT, Codex and other MCP clients.</span>
        <Badge tone={overview.enabled ? "success" : "neutral"}>{overview.enabled ? "On" : "Off"}</Badge>
      </div>
      <div className="card__body col" style={{ gap: 16 }}>
        <div className="notice">
          A connector sends the records it reads to the AI company you connect, under your own account and plan with them.
          Check that company's data terms before connecting records with personal information. Tokens only read what your
          role can read, in-camera content is never sent, and changes an AI asks for wait for your approval in AI tool drafts.
        </div>

        {overview.canManageWorkspace ? (
          <Toggle
            checked={overview.enabled}
            onChange={changeEnabled}
            label="Allow AI connectors for this workspace"
            hint="Off by default. While off, nobody can create or use a token. Turning it off doesn't delete tokens."
          />
        ) : (
          !overview.enabled && <p className="muted">AI connectors are off for this workspace. An Owner or Admin can turn them on here.</p>
        )}

        {minted && (
          <Banner tone="warn" title="Copy this token now. It won't be shown again." onDismiss={() => setMinted(null)}>
            <div className="ai-connectors__reveal">
              <code className="ai-connectors__token mono">{minted.token}</code>
              <CopyButton value={minted.token} label="token" />
            </div>
            <Snippets endpoint={endpoint} token={minted.token} />
          </Banner>
        )}

        {overview.enabled && !creating && (
          <div>
            <Button variant="primary" icon={<Plug size={14} />} onClick={() => setCreating(true)}>Create token</Button>
          </div>
        )}

        {overview.enabled && creating && (
          <CreateTokenForm
            societyId={societyId}
            overview={overview}
            onCancel={() => setCreating(false)}
            onCreated={(result) => {
              setMinted(result);
              setCreating(false);
            }}
          />
        )}

        {myApps.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <h3 className="ai-connectors__heading">Your connected apps</h3>
            <div className="settings-list">
              {myApps.map(row)}
            </div>
          </div>
        )}

        {myTokens.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <h3 className="ai-connectors__heading">Your tokens</h3>
            <div className="settings-list">
              {myTokens.map(row)}
            </div>
          </div>
        )}

        {overview.workspaceGrants.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <h3 className="ai-connectors__heading">Other members' tokens and apps</h3>
            <div className="settings-list">
              {overview.workspaceGrants.map(row)}
            </div>
          </div>
        )}

        {overview.enabled && (
          <details className="ai-connectors__setup">
            <summary>Set up a client</summary>
            <p className="muted">Endpoint: <span className="mono">{endpoint}</span>. Each token is limited to {overview.limits.requestsPerMinute} requests a minute.</p>
            <Snippets endpoint={endpoint} />
          </details>
        )}

        {overview.oauthAvailable ? (
          overview.enabled && (
            <p className="muted ai-connectors__footnote">
              In claude.ai or ChatGPT, add a custom connector with the URL <span className="mono">{endpoint}</span> and
              sign in when asked; you'll pick this workspace and what it can read. Claude Code and Codex can sign in the
              same way instead of using a token.
            </p>
          )
        ) : (
          <p className="muted ai-connectors__footnote">
            claude.ai and ChatGPT connectors need OAuth sign-in, which isn't set up on this deployment. Connect from Codex
            CLI, Claude Code or MCP Inspector with a token instead.
          </p>
        )}
      </div>
    </div>
  );
}
