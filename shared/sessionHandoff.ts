/**
 * Cross-domain session handoff between trusted frontend origins
 * (docs/shared-workspaces/architecture.md, "Cross-domain session handoff").
 *
 * The Convex-hosted broker keeps each origin's session in that origin's own
 * storage (the cross-domain plugin), so a second domain starts signed out. The
 * source origin asks for a short-lived, single-use code bound to the target
 * origin; the target redeems it and receives THE SAME session through the
 * cross-domain cookie transport (`Set-Better-Auth-Cookie`, readable only by
 * the target because CORS echoes only the request's own trusted origin).
 * Nothing new is minted, so expiry, Microsoft proof and second-factor proof
 * carry over unchanged, and signing out anywhere ends it everywhere.
 *
 * The target tab starts the exchange: it keeps a random verifier and sends
 * only its SHA-256 (the challenge) to the source, which binds the code to it.
 * Redeeming needs the verifier, so a code minted on someone else's session
 * (from curl, with a forged Origin) and mailed as a link can't sign a victim
 * into it: the victim's tab never asked for it and holds no verifier.
 *
 * Only the SHA-256 of the code is stored. The code travels in a URL fragment
 * (never sent to a server) and is redeemed by POST body. The session token is
 * never put in a URL or a response body.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { constantTimeEqual, generateRandomString } from "better-auth/crypto";
import { z } from "zod";

export const SESSION_HANDOFF_CREATE = "/societyer-handoff/create";
export const SESSION_HANDOFF_REDEEM = "/societyer-handoff/redeem";
export const SESSION_HANDOFF_TTL_MS = 60_000;
const IDENTIFIER_PREFIX = "societyer-handoff:";
/** SHA-256 hex of the target tab's verifier. */
const CHALLENGE = /^[a-f0-9]{64}$/;
/** 32 random bytes, base64url without padding. */
const VERIFIER = /^[A-Za-z0-9_-]{43}$/;

const storedValue = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  targetOrigin: z.string().min(1),
  challenge: z.string().regex(CHALLENGE),
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionHandoffIdentifier(code: string): Promise<string> {
  return `${IDENTIFIER_PREFIX}${await sha256Hex(code)}`;
}

/** Exact http(s) origins only, as the cross-domain plugin does: wildcards never qualify. */
function exactOrigin(value: string | null | undefined): string | null {
  if (!value || value.includes("*")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin === "null" ? null : url.origin;
  } catch { return null; }
}

/**
 * App origins a handoff may start from or land on: the SITE_URL entries that
 * Better Auth also trusts exactly. Its own trusted list also holds the auth
 * server's origin, which is never an app.
 */
function appOrigins(siteUrls: readonly string[], trustedOrigins: readonly string[]): Set<string> {
  const trusted = new Set(trustedOrigins.map(exactOrigin));
  return new Set(siteUrls.map(exactOrigin).filter((origin): origin is string => origin !== null && trusted.has(origin)));
}

/** The browser's Origin header, when it names an app origin exactly. Server-side calls have none. */
function appRequestOrigin(request: Request | undefined, apps: Set<string>): string | null {
  const header = request?.headers.get("origin");
  const origin = exactOrigin(header);
  return origin && header === origin && apps.has(origin) ? origin : null;
}

/** `siteUrls` is the deployment's SITE_URL list (resolveConvexAuthSiteUrls). */
export const sessionHandoff = (siteUrls: readonly string[]) => ({
  id: "societyer-session-handoff",
  endpoints: {
    createSessionHandoff: createAuthEndpoint(SESSION_HANDOFF_CREATE, {
      method: "POST",
      body: z.object({ targetOrigin: z.string().min(1).max(300), challenge: z.string().regex(CHALLENGE) }),
      use: [sessionMiddleware],
    }, async (ctx) => {
      ctx.setHeader("Cache-Control", "no-store");
      const apps = appOrigins(siteUrls, ctx.context.trustedOrigins);
      const source = appRequestOrigin(ctx.request, apps);
      if (!source) throw new APIError("FORBIDDEN", { message: "Start a handoff from a trusted app origin." });
      const target = exactOrigin(ctx.body.targetOrigin);
      if (!target || target !== ctx.body.targetOrigin || !apps.has(target)) {
        throw new APIError("FORBIDDEN", { message: "The handoff destination is not a trusted app origin." });
      }
      if (target === source) throw new APIError("BAD_REQUEST", { message: "The handoff destination is this origin." });
      const { session, user } = ctx.context.session;
      const code = generateRandomString(43);
      const expiresAt = new Date(Date.now() + SESSION_HANDOFF_TTL_MS);
      await ctx.context.internalAdapter.createVerificationValue({
        identifier: await sessionHandoffIdentifier(code),
        value: JSON.stringify({ sessionId: session.id, userId: user.id, targetOrigin: target, challenge: ctx.body.challenge }),
        expiresAt,
      });
      return ctx.json({ code, expiresAt: expiresAt.toISOString() });
    }),
    redeemSessionHandoff: createAuthEndpoint(SESSION_HANDOFF_REDEEM, {
      method: "POST",
      // The verifier is optional here so that a missing one still burns the
      // code below instead of failing validation before the lookup.
      body: z.object({ code: z.string().min(1).max(200), verifier: z.string().max(200).optional() }),
    }, async (ctx) => {
      ctx.setHeader("Cache-Control", "no-store");
      const origin = appRequestOrigin(ctx.request, appOrigins(siteUrls, ctx.context.trustedOrigins));
      if (!origin) throw new APIError("FORBIDDEN", { message: "Redeem a handoff from a trusted app origin." });
      // Without this header the cross-domain plugin would leave the session as
      // a plain Set-Cookie on the auth origin instead of handing it to the app.
      if (!ctx.request?.headers.has("better-auth-cookie")) throw new APIError("BAD_REQUEST", { message: "Use the app's sign-in client to redeem a handoff." });
      // Consume before any check, so a code that reached the wrong origin is
      // burned rather than left for a second try.
      const consumed = await ctx.context.internalAdapter.consumeVerificationValue(await sessionHandoffIdentifier(ctx.body.code));
      const parsed = consumed ? storedValue.safeParse(safeJson(consumed.value)) : null;
      if (!parsed?.success) throw new APIError("BAD_REQUEST", { message: "This sign-in link is invalid or has expired." });
      const { sessionId, userId, targetOrigin, challenge } = parsed.data;
      if (targetOrigin !== origin) throw new APIError("FORBIDDEN", { message: "This sign-in link was issued for another site." });
      const verifier = ctx.body.verifier;
      if (!verifier || !VERIFIER.test(verifier) || !constantTimeEqual(await sha256Hex(verifier), challenge)) {
        throw new APIError("FORBIDDEN", { message: "This sign-in link was not requested by this browser tab." });
      }
      const row = await ctx.context.adapter.findOne<{ token: string }>({ model: "session", where: [{ field: "id", value: sessionId }] });
      const found = row ? await ctx.context.internalAdapter.findSession(row.token) : null;
      if (!found || found.session.id !== sessionId || found.session.userId !== userId || found.user.id !== userId
        || new Date(found.session.expiresAt).getTime() <= Date.now()) {
        throw new APIError("UNAUTHORIZED", { message: "The session you started from has ended. Sign in again." });
      }
      await setSessionCookie(ctx, found);
      return ctx.json({ redeemed: true });
    }),
  },
}) satisfies BetterAuthPlugin;

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
