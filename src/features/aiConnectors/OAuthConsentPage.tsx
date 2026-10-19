import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Navigate, useSearchParams } from "react-router-dom";
import { Plug } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useAuth } from "../../auth/AuthProvider";
import { AuthPending, AuthShell, BusyLabel } from "../../auth/AuthShell";
import { Badge, Banner, Button } from "../../components/ui";
import { Checkbox, RadioGroup } from "../../components/Controls";
import type { Id } from "../../../convex/_generated/dataModel";
import { consentIdentity, type ConsentIdentity } from "./connectorDisplay";

/** What convex/mcpOAuth.ts `consentDetails` returns. */
type ConsentScope = { permission: string; kind: "read" | "write"; label: string; description: string; held: boolean };
type ConsentWorkspace = {
  societyId: Id<"societies">;
  name: string;
  role: string;
  connectorsEnabled: boolean;
  scopeOptions: ConsentScope[];
  connectedScopes?: string[];
  connectedSessions?: number;
};
type ConsentClient = {
  name: string;
  /** The metadata document's host (who publishes the app). */
  host: string | null;
  /** A self-registered app's own client_uri host: unverified. */
  declaredHost: string | null;
  registration: "cimd" | "dcr";
  redirectHost: string;
  loopback: boolean;
};
type ConsentDetails =
  | { status: "pending"; client: ConsentClient; requestedScopes: string[]; expiresAtMs: number; workspaces: ConsentWorkspace[] }
  | { status: "expired" | "used" | "not_found"; client: null; requestedScopes: string[]; workspaces: ConsentWorkspace[] };

const STATUS_MESSAGES: Record<Exclude<ConsentDetails["status"], "pending">, string> = {
  expired: "This connection request expired. Go back to the app and connect again.",
  used: "This connection request was already answered. Go back to the app and connect again if you need to.",
  not_found: "This connection link isn't valid. Go back to the app and connect again.",
};

/** The write scope, in plain language: under A4 a connector's writes are drafts a person approves. */
const WRITE_LABEL = "Can propose changes for you to approve";
/** Approve stays off until the page has been visible and focused this long without a break. */
const APPROVE_DELAY_MS = 500;

function withArticle(role: string): string {
  return `${/^[AEIOU]/.test(role) ? "an" : "a"} ${role}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null) {
    const message = (error.data as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

/**
 * True once the page has been visible and focused for `delayMs` without a
 * break. A page that pops up under the pointer (or behind another window)
 * can't catch a click meant for something else.
 */
function useSettledAttention(delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const restart = () => {
      window.clearTimeout(timer);
      setSettled(false);
      if (document.visibilityState === "visible" && document.hasFocus()) timer = window.setTimeout(() => setSettled(true), delayMs);
    };
    restart();
    window.addEventListener("focus", restart);
    window.addEventListener("blur", restart);
    document.addEventListener("visibilitychange", restart);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", restart);
      window.removeEventListener("blur", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [delayMs]);
  return settled;
}

/** What convex/mcpOAuth.ts `approve` and `deny` return: the form to post back to the issuer. */
type Completion = { action: string; fields: Record<string, string> };

/**
 * Submit the completion form: a top-level POST navigation to Societyer's
 * sign-in server, which checks it came from this page, the one-time token and
 * that this browser started connecting, then returns to the app.
 */
function submitCompletion({ action, fields }: Completion) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.hidden = true;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

/** Scopes to tick when a workspace is picked: what the app asked to read, within the role. Writes start off. */
function initialScopes(workspace: ConsentWorkspace | undefined, requested: readonly string[]): string[] {
  if (!workspace) return [];
  return workspace.scopeOptions
    .filter((scope) => scope.held && scope.kind === "read" && requested.includes(scope.permission))
    .map((scope) => scope.permission);
}

/**
 * The OAuth consent screen for AI connectors (`/oauth/consent?request=…`). The
 * authorization server (convex/mcpOAuthHttp.ts) sends the browser here; the
 * person signs in, picks a workspace and what the app may read, then
 * approves or denies. See docs/mcp-connector.md.
 */
export function OAuthConsentPage() {
  const [searchParams] = useSearchParams();
  const request = searchParams.get("request") ?? "";
  const auth = useAuth();
  const loadDetails = useAction(api.mcpOAuth.consentDetails);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Clickjacking: the app's CSP can't forbid framing from a meta tag, so never offer a decision inside a frame.
  const framed = typeof window !== "undefined" && window.top !== window.self;
  const ready = Boolean(request && auth.session && auth.isConvexAuthenticated && auth.membershipState === "ready");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loadDetails({ request })
      .then((result) => { if (!cancelled) setDetails(result as ConsentDetails); })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error, "This connection request couldn't be loaded. Try again from the app."));
      });
    return () => { cancelled = true; };
  }, [loadDetails, ready, request]);

  if (auth.mode === "none") return <Navigate to="/app" replace />;
  if (!request) return <ConsentState message={STATUS_MESSAGES.not_found} />;
  if (auth.sessionStatus === "loading") return <ConsentState pending message="Checking your sign-in…" />;
  if (!auth.session) {
    const back = `/oauth/consent?request=${encodeURIComponent(request)}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(back)}`} replace />;
  }
  if (framed) return <ConsentState message="For your security, this page can't be shown inside another site. Open it in its own browser tab." />;
  if (loadError) return <ConsentState message={loadError} />;
  if (!details) return <ConsentState pending message="Loading the connection request…" />;
  if (details.status !== "pending") return <ConsentState message={STATUS_MESSAGES[details.status]} />;
  return <ConsentForm request={request} details={details} />;
}

type PendingDetails = Extract<ConsentDetails, { status: "pending" }>;

function ConsentForm({ request, details }: { request: string; details: PendingDetails }) {
  const approve = useAction(api.mcpOAuth.approve);
  const deny = useAction(api.mcpOAuth.deny);
  const { client } = details;
  const identity = consentIdentity(client);
  const enabledWorkspaces = details.workspaces.filter((entry) => entry.connectorsEnabled);
  const [societyId, setSocietyId] = useState<string>(enabledWorkspaces[0]?.societyId ?? "");
  const [scopes, setScopes] = useState<string[]>(() => initialScopes(enabledWorkspaces[0], details.requestedScopes));
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const workspace = useMemo(() => details.workspaces.find((entry) => entry.societyId === societyId), [details, societyId]);
  const attentive = useSettledAttention(APPROVE_DELAY_MS);
  // Someone can send you an app's sign-in link they started; approving it would connect their app to your workspace.
  const [startedHere, setStartedHere] = useState(false);

  const decide = async (choice: "approve" | "deny") => {
    if (busy) return;
    setBusy(choice);
    setSubmitError(null);
    try {
      const chosen = workspace?.connectorsEnabled ? workspace.societyId : undefined;
      const completion: Completion = choice === "approve"
        ? await approve({ request, societyId: societyId as Id<"societies">, scopes })
        : await deny({ request, ...(chosen ? { societyId: chosen } : {}) });
      submitCompletion(completion);
    } catch (error) {
      setSubmitError(errorMessage(error, "That didn't work. Try again."));
      setBusy(null);
    }
  };
  const pickWorkspace = (id: string) => {
    setSocietyId(id);
    setScopes(initialScopes(details.workspaces.find((entry) => entry.societyId === id), details.requestedScopes));
  };

  return (
    <AuthShell
      title={identity.title}
      icon={<Plug size={18} />}
      lede={<ConsentLede identity={identity} />}
      help="Not sure about this app?"
    >
      <div className="oauth-consent">
        <ClientFacts client={client} identity={identity} />

        {enabledWorkspaces.length === 0 ? (
          <Banner tone="info" title="No workspace allows AI connectors">
            {details.workspaces.length
              ? "An Owner or Admin has to turn on AI connectors in Settings → AI connectors before you can connect an app."
              : "Your account isn't an active member of any workspace."}
          </Banner>
        ) : (
          <>
            <WorkspaceChoice workspaces={details.workspaces} workspace={workspace} onPick={pickWorkspace} />
            {workspace?.connectedScopes && (
              <p className="oauth-consent__note">
                This app is already connected to this workspace{sessionCount(workspace.connectedSessions)}. Approving adds a new
                session, listed in Settings → AI connectors, and sets what every session can read.
              </p>
            )}
            {workspace && <ScopeChoice workspace={workspace} scopes={scopes} onChange={setScopes} />}
          </>
        )}

        <p className="oauth-consent__privacy">
          What {identity.name} reads goes to the company that runs it, under your own account and plan with them.
          It can only read what your role can read, and nothing from an in-camera session is shared: not minutes, transcripts or documents.
          You can disconnect it any time in Settings → AI connectors.
        </p>

        {enabledWorkspaces.length > 0 && (
          <Checkbox
            checked={startedHere}
            onChange={setStartedHere}
            label={`I just started connecting ${identity.name} myself`}
            hint="If someone sent you this link, or you didn't start connecting, choose Deny."
          />
        )}

        {submitError && <Banner tone="danger">{submitError}</Banner>}

        <div className="auth__actions">
          {enabledWorkspaces.length > 0 && (
            <Button
              variant="primary"
              className={`auth__submit${busy === "approve" ? " is-busy" : ""}`}
              disabled={busy !== null || !attentive || !startedHere || !workspace || !scopes.length}
              onClick={() => void decide("approve")}
            >
              <BusyLabel busy={busy === "approve"} busyText="Connecting…">Approve</BusyLabel>
            </Button>
          )}
          <Button
            className={`auth__submit${busy === "deny" ? " is-busy" : ""}`}
            disabled={busy !== null}
            onClick={() => void decide("deny")}
          >
            <BusyLabel busy={busy === "deny"} busyText="Declining…">{enabledWorkspaces.length ? "Deny" : "Cancel"}</BusyLabel>
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}

function sessionCount(sessions: number | undefined): string {
  if (!sessions) return "";
  return sessions === 1 ? " (1 session)" : ` (${sessions} sessions)`;
}

/** Under the title: who vouches for the app, or that nobody does and what it calls itself. */
function ConsentLede({ identity }: { identity: ConsentIdentity }) {
  if (identity.verified) {
    return <>{identity.secondary && <>{identity.secondary}. </>}It wants to read your Societyer workspace.</>;
  }
  return (
    <span className="oauth-consent__lede">
      <Badge tone="warn">Unverified</Badge>
      <span>{identity.secondary}. It wants to read your Societyer workspace.</span>
    </span>
  );
}

/** Who is asking and where the browser returns: the MCP spec asks for the redirect host and a loopback warning. */
function ClientFacts({ client, identity }: { client: ConsentClient; identity: ConsentIdentity }) {
  return (
    <>
      <dl className="oauth-consent__facts">
        <div><dt>App</dt><dd>{identity.verified ? identity.name : identity.secondary}</dd></div>
        {client.host && <div><dt>Published by</dt><dd className="mono">{client.host}</dd></div>}
        {client.declaredHost && (
          <div>
            <dt>Website</dt>
            <dd><span className="mono">{client.declaredHost}</span> <span className="oauth-consent__unverified">unverified, self-declared</span></dd>
          </div>
        )}
        <div><dt>Returns to</dt><dd className="mono">{client.redirectHost}</dd></div>
      </dl>
      {client.registration === "dcr" && (
        <p className="oauth-consent__note">This app registered itself, so Societyer can't confirm who made it. Only continue if you just started connecting from it.</p>
      )}
      {client.loopback && (
        <Banner tone="warn" title="This app runs on your computer">
          It returns to {client.redirectHost}. Only continue if you just started connecting from Claude Code, Codex or
          another app on this computer: any program here can wait at that address.
        </Banner>
      )}
    </>
  );
}

function WorkspaceChoice({ workspaces, workspace, onPick }: {
  workspaces: ConsentWorkspace[];
  workspace: ConsentWorkspace | undefined;
  onPick: (societyId: string) => void;
}) {
  if (workspaces.length === 1) {
    return workspace ? <p className="oauth-consent__note">Workspace: <strong>{workspace.name}</strong> (you're {withArticle(workspace.role)}).</p> : null;
  }
  return (
    <fieldset className="oauth-consent__group">
      <legend className="oauth-consent__legend">Workspace</legend>
      <RadioGroup
        value={workspace?.societyId ?? ""}
        onChange={onPick}
        name="oauth-workspace"
        options={workspaces.map((entry) => ({
          value: entry.societyId,
          label: entry.name,
          hint: entry.connectorsEnabled ? `You're ${withArticle(entry.role)}.` : "AI connectors are off here.",
          disabled: !entry.connectorsEnabled,
        }))}
      />
    </fieldset>
  );
}

/** Read scopes the role holds; the draft-change scope is opt-in and starts off. */
function ScopeChoice({ workspace, scopes, onChange }: { workspace: ConsentWorkspace; scopes: string[]; onChange: (scopes: string[]) => void }) {
  const toggle = (permission: string, on: boolean) =>
    onChange(on ? [...new Set([...scopes, permission])] : scopes.filter((entry) => entry !== permission));
  const reads = workspace.scopeOptions.filter((scope) => scope.kind === "read" && scope.held);
  const writes = workspace.scopeOptions.filter((scope) => scope.kind === "write" && scope.held);
  return (
    <>
      <fieldset className="oauth-consent__group">
        <legend className="oauth-consent__legend">It can read</legend>
        <div className="oauth-consent__scopes">
          {reads.map((scope) => (
            <Checkbox
              key={scope.permission}
              checked={scopes.includes(scope.permission)}
              onChange={(on) => toggle(scope.permission, on)}
              label={scope.label}
              hint={scope.description}
            />
          ))}
        </div>
      </fieldset>
      {writes.length > 0 && (
        <fieldset className="oauth-consent__group">
          <legend className="oauth-consent__legend">Optional</legend>
          <div className="oauth-consent__scopes">
            {writes.map((scope) => (
              <Checkbox
                key={scope.permission}
                checked={scopes.includes(scope.permission)}
                onChange={(on) => toggle(scope.permission, on)}
                label={WRITE_LABEL}
                hint={`${scope.label}: nothing changes until you approve it in Societyer.`}
              />
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

function ConsentState({ message, pending = false }: { message: string; pending?: boolean }) {
  return (
    <AuthShell title="Connect an app" stateKey={pending ? "pending" : message} announce={pending ? undefined : message}>
      <div className="auth__state">
        {pending ? <AuthPending>{message}</AuthPending> : <p className="auth__message">{message}</p>}
      </div>
    </AuthShell>
  );
}
