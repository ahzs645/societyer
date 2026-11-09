/**
 * Cross-domain session handoff (docs/shared-workspaces/architecture.md,
 * "Cross-domain session handoff"). The destination tab starts it, so a code is
 * only redeemable by the tab that asked for it:
 *
 * 1. The switcher on the source goes to `<target>/handoff#from=<source>&workspace=…&next=…`.
 * 2. "begin" on the target keeps a random verifier in sessionStorage and goes
 *    to `<source>/handoff#issue=1&target=<target>&challenge=<sha256(verifier)>`.
 * 3. "issue" on the source mints a 60-second code bound to the target and the
 *    challenge and goes to `<target>/handoff#code=…`.
 * 4. "redeem" on the target redeems the code with the verifier before any
 *    session guard runs, then continues to the stored workspace and path.
 *
 * A code minted on someone else's session and sent as a link fails at step 4:
 * this tab holds no verifier for it. Every hop strips its fragment first. The
 * session itself is shared, so nothing is upgraded or copied.
 */
import { getSafeAuthRedirect } from "./authRedirect";

export const HANDOFF_PATH = "/handoff";
/** How long the target tab waits for the source to send a code back. */
export const HANDOFF_REQUEST_TTL_MS = 2 * 60_000;
const REQUEST_KEY = "societyer.handoff.request";
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE = /^[a-f0-9]{64}$/;
const CODE = /^[A-Za-z0-9_-]{1,200}$/;

/** A same-origin `/app` path, else `/app`. */
export function sanitizeHandoffNext(next: string | null | undefined): string {
  const safe = getSafeAuthRedirect(next ?? null);
  return /^\/app(?:[/?#]|$)/.test(safe) ? safe : "/app";
}

/** An exact http(s) origin, written as one (no path, no wildcard), as the server requires. */
export function exactHandoffOrigin(value: string | null | undefined): string | null {
  if (!value || value.includes("*")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin === value ? value : null;
  } catch { return null; }
}

/** Another exact origin. Whether it is a mapped workspace domain is the page's (async) check. */
function peerOrigin(value: string | null, currentOrigin: string): string | null {
  const origin = exactHandoffOrigin(value);
  return origin && origin !== currentOrigin ? origin : null;
}

export type HandoffBegin = { mode: "begin"; from: string; workspace: string | null; next: string };
export type HandoffIssue = { mode: "issue"; target: string; challenge: string };
export type HandoffFragment = HandoffBegin | HandoffIssue | { mode: "redeem"; code: string };

export function parseHandoffFragment(hash: string, currentOrigin: string): HandoffFragment | null {
  if (hash.length > 4096) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  // One step per link, so a crafted fragment can't mix them.
  if (["from", "issue", "code"].filter((key) => params.has(key)).length !== 1) return null;
  const code = params.get("code");
  if (code !== null) return CODE.test(code) ? { mode: "redeem", code } : null;
  if (params.has("issue")) {
    const target = peerOrigin(params.get("target"), currentOrigin);
    const challenge = params.get("challenge") ?? "";
    return target && params.get("issue") === "1" && CHALLENGE.test(challenge) ? { mode: "issue", target, challenge } : null;
  }
  const from = peerOrigin(params.get("from"), currentOrigin);
  if (!from) return null;
  const workspace = params.get("workspace");
  return { mode: "begin", from, workspace: workspace && WORKSPACE_ID.test(workspace) ? workspace : null, next: sanitizeHandoffNext(params.get("next")) };
}

function handoffUrl(origin: string, params: Record<string, string>): string {
  return `${new URL(origin).origin}${HANDOFF_PATH}#${new URLSearchParams(params).toString()}`;
}

/** Step 1 URL: ask the target to start a handoff from `sourceOrigin`. */
export function buildHandoffStartUrl({ targetOrigin, sourceOrigin, societyId, next }: {
  targetOrigin: string;
  sourceOrigin: string;
  societyId?: string | null;
  next?: string | null;
}): string {
  const params: Record<string, string> = { from: new URL(sourceOrigin).origin };
  if (societyId) params.workspace = societyId;
  params.next = sanitizeHandoffNext(next);
  return handoffUrl(targetOrigin, params);
}

/** Step 1, from the switcher. No server call: the target has to ask first. */
export function startHandoff({ targetOrigin, societyId, next }: {
  targetOrigin: string;
  societyId?: string | null;
  next?: string | null;
}): void {
  window.location.assign(buildHandoffStartUrl({ targetOrigin, sourceOrigin: window.location.origin, societyId, next }));
}

export type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type HandoffRequest = { verifier: string; from: string; workspace: string | null; next: string; expiresAt: number };

function tabStorage(): HandoffStorage | null {
  // Reading sessionStorage throws when the browser blocks storage.
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/** 32 random bytes, base64url without padding (43 characters). */
export function createHandoffVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function handoffChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Step 2, on the target: keep a verifier in this tab only and return the URL
 * that asks the source for a code bound to its hash. `begin.from` must already
 * be known to be a mapped workspace domain.
 */
export async function beginHandoff(begin: HandoffBegin, { currentOrigin, storage = tabStorage(), now = Date.now() }: {
  currentOrigin: string;
  storage?: HandoffStorage | null;
  now?: number;
}): Promise<string> {
  if (!storage) throw new Error("This browser is blocking site storage, so the workspace can't be opened here. Sign in on this site directly.");
  const verifier = createHandoffVerifier();
  const request: HandoffRequest = { verifier, from: begin.from, workspace: begin.workspace, next: begin.next, expiresAt: now + HANDOFF_REQUEST_TTL_MS };
  storage.setItem(REQUEST_KEY, JSON.stringify(request));
  return handoffUrl(begin.from, { issue: "1", target: currentOrigin, challenge: await handoffChallenge(verifier) });
}

/** This tab's pending request, removed as it is read so it is used once at most. */
export function takeHandoffRequest(storage: HandoffStorage | null = tabStorage(), now = Date.now()): HandoffRequest | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(REQUEST_KEY);
    storage.removeItem(REQUEST_KEY);
  } catch { return null; }
  let value: unknown;
  try { value = raw ? JSON.parse(raw) : null; } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const from = typeof row.from === "string" ? exactHandoffOrigin(row.from) : null;
  if (typeof row.verifier !== "string" || !VERIFIER.test(row.verifier) || !from
    || typeof row.expiresAt !== "number" || row.expiresAt <= now) return null;
  const workspace = typeof row.workspace === "string" && WORKSPACE_ID.test(row.workspace) ? row.workspace : null;
  return { verifier: row.verifier, from, workspace, next: sanitizeHandoffNext(typeof row.next === "string" ? row.next : null), expiresAt: row.expiresAt };
}

export type HandoffFetch = (path: string, options: { method: "POST"; body: Record<string, string>; throw: false }) =>
  Promise<{ data?: unknown; error?: { message?: string; status?: number } | null }>;

/**
 * Step 3, on the source: mint a code on this tab's session and return the URL
 * that hands it to the target. `issue.target` must already be known to be a
 * mapped workspace domain.
 */
export async function issueHandoff(issue: HandoffIssue, fetch: HandoffFetch): Promise<string> {
  const result = await fetch("/societyer-handoff/create", {
    method: "POST",
    body: { targetOrigin: issue.target, challenge: issue.challenge },
    throw: false,
  });
  const code = result.data && typeof result.data === "object" ? (result.data as { code?: unknown }).code : undefined;
  if (result.error || typeof code !== "string" || !CODE.test(code)) {
    throw new Error("That workspace couldn't be opened on its own site. Try again, or sign in there directly.");
  }
  return handoffUrl(issue.target, { code });
}

export type HandoffOutcome =
  | { status: "step"; step: HandoffBegin | HandoffIssue }
  | { status: "redeemed"; workspace: string | null; next: string }
  | { status: "failed"; next: string };

let outcome: HandoffOutcome | null = null;

/** What this load's `/handoff` fragment asked for, if there was one. */
export function handoffOutcome(): HandoffOutcome | null {
  return outcome;
}

/**
 * Reads `/handoff` before session-dependent routes mount, like the OAuth
 * one-time token: strips the fragment, redeems a code (step 4), and leaves
 * steps 2 and 3 for the landing page, which needs Convex and the session.
 * Never throws: a failure becomes an outcome the landing page explains.
 */
export function createHandoffRedeemer(
  client: { fetch: HandoffFetch; refreshSession: () => void; rememberWorkspace: (id: string) => void },
  page: { href: () => string; replace: (url: URL) => void; basePath: string; storage?: () => HandoffStorage | null; now?: () => number },
) {
  let pending: Promise<void> | undefined;
  return (): Promise<void> => {
    if (pending) return pending;
    const url = new URL(page.href());
    if (url.pathname.replace(/\/+$/, "") !== `${page.basePath}${HANDOFF_PATH}` || !url.hash) return Promise.resolve();
    const fragment = parseHandoffFragment(url.hash, url.origin);
    // Codes and challenges are single-use, but still must not linger in history.
    url.hash = "";
    page.replace(url);
    if (!fragment) {
      outcome = { status: "failed", next: "/app" };
      return Promise.resolve();
    }
    if (fragment.mode !== "redeem") {
      outcome = { status: "step", step: fragment };
      return Promise.resolve();
    }
    // Only a code this tab asked for: the verifier is the proof.
    const request = takeHandoffRequest(page.storage ? page.storage() : tabStorage(), page.now ? page.now() : Date.now());
    if (!request) {
      outcome = { status: "failed", next: "/app" };
      return Promise.resolve();
    }
    pending = (async () => {
      try {
        const result = await client.fetch("/societyer-handoff/redeem", {
          method: "POST",
          body: { code: fragment.code, verifier: request.verifier },
          throw: false,
        });
        if (result.error) throw new Error(result.error.message || "Handoff failed.");
        if (request.workspace) client.rememberWorkspace(request.workspace);
        client.refreshSession();
        outcome = { status: "redeemed", workspace: request.workspace, next: request.next };
      } catch (error) {
        console.warn("[societyer-auth] session handoff was not redeemed", error);
        outcome = { status: "failed", next: request.next };
      }
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
