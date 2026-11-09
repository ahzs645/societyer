/**
 * Cross-domain session handoff (docs/shared-workspaces/architecture.md,
 * "Cross-domain session handoff"). The source asks the auth server for a
 * 60-second, single-use code bound to the target origin and navigates to
 * `<target>/handoff#code=…&workspace=…&next=…`. The target strips the fragment,
 * redeems the code before any session guard runs, and continues. The session
 * itself is shared, so nothing is upgraded or copied.
 */
import { getSafeAuthRedirect } from "./authRedirect";

export const HANDOFF_PATH = "/handoff";
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A same-origin `/app` path, else `/app`. */
export function sanitizeHandoffNext(next: string | null | undefined): string {
  const safe = getSafeAuthRedirect(next ?? null);
  return /^\/app(?:[/?#]|$)/.test(safe) ? safe : "/app";
}

export type HandoffFragment = { code: string; workspace: string | null; next: string };

export function buildHandoffUrl({ targetOrigin, code, societyId, next }: {
  targetOrigin: string;
  code: string;
  societyId?: string | null;
  next?: string | null;
}): string {
  const params = new URLSearchParams({ code });
  if (societyId) params.set("workspace", societyId);
  params.set("next", sanitizeHandoffNext(next));
  return `${new URL(targetOrigin).origin}${HANDOFF_PATH}#${params.toString()}`;
}

export function parseHandoffFragment(hash: string): HandoffFragment | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("code")?.trim();
  if (!code || code.length > 1024) return null;
  const workspace = params.get("workspace");
  return {
    code,
    workspace: workspace && WORKSPACE_ID.test(workspace) ? workspace : null,
    next: sanitizeHandoffNext(params.get("next")),
  };
}

export type HandoffFetch = (path: string, options: { method: "POST"; body: Record<string, string>; throw: false }) =>
  Promise<{ data?: unknown; error?: { message?: string; status?: number } | null }>;

/** Ask for a code on this origin's session and go to the target domain. */
export async function startHandoff({ targetOrigin, societyId, next }: {
  targetOrigin: string;
  societyId?: string | null;
  next?: string | null;
}): Promise<void> {
  const { loadSessionAuthClient } = await import("./sessionAuthClient");
  const { authClient } = await loadSessionAuthClient();
  const fetcher = authClient.$fetch as unknown as HandoffFetch;
  const result = await fetcher("/societyer-handoff/create", { method: "POST", body: { targetOrigin }, throw: false });
  const code = result.data && typeof result.data === "object" ? (result.data as { code?: unknown }).code : undefined;
  if (result.error || typeof code !== "string" || !code) {
    throw new Error("That workspace couldn't be opened on its own site. Try again, or sign in there directly.");
  }
  window.location.assign(buildHandoffUrl({ targetOrigin, code, societyId, next }));
}

export type HandoffOutcome =
  | { status: "redeemed"; workspace: string | null; next: string }
  | { status: "failed"; next: string };

let outcome: HandoffOutcome | null = null;

/** The result of this load's `/handoff` redemption, if there was one. */
export function handoffOutcome(): HandoffOutcome | null {
  return outcome;
}

/**
 * Redeems a handoff on `/handoff` before session-dependent routes mount, like
 * the OAuth one-time token. Never throws: a failure becomes an outcome the
 * landing page explains.
 */
export function createHandoffRedeemer(
  client: { fetch: HandoffFetch; refreshSession: () => void; rememberWorkspace: (id: string) => void },
  page: { href: () => string; replace: (url: URL) => void; basePath: string },
) {
  let pending: Promise<void> | undefined;
  return (): Promise<void> => {
    if (pending) return pending;
    const url = new URL(page.href());
    if (url.pathname.replace(/\/+$/, "") !== `${page.basePath}${HANDOFF_PATH}` || !url.hash) return Promise.resolve();
    const fragment = parseHandoffFragment(url.hash);
    // The code is single-use, but it still must not linger in history.
    url.hash = "";
    page.replace(url);
    if (!fragment) {
      outcome = { status: "failed", next: "/app" };
      return Promise.resolve();
    }
    pending = (async () => {
      try {
        const result = await client.fetch("/societyer-handoff/redeem", { method: "POST", body: { code: fragment.code }, throw: false });
        if (result.error) throw new Error(result.error.message || "Handoff failed.");
        if (fragment.workspace) client.rememberWorkspace(fragment.workspace);
        client.refreshSession();
        outcome = { status: "redeemed", workspace: fragment.workspace, next: fragment.next };
      } catch (error) {
        console.warn("[societyer-auth] session handoff was not redeemed", error);
        outcome = { status: "failed", next: fragment.next };
      }
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
