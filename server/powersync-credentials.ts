import type { Request, Router } from "express";

export type MeetingSyncConfiguration = { endpoint: string; trustedOrigin: string };
export type MeetingSyncIdentity = { actorKey: string; societyId: string; accessUntilEpochMs?: number };
export type MeetingSyncSession = { type: string; societyId?: string; convexAuthToken?: string };
export type MeetingSyncSigner = {
  signJWT(input: { body: { payload: Record<string, unknown>; overrideOptions?: { jwt: { audience: string; expirationTime: string } } } }): Promise<{ token: string }>;
};

/** Only explicit enablement registers a production credential route. No local signer or endpoint fallback. */
export function meetingSyncConfiguration(environment: NodeJS.ProcessEnv, issuer: string, authMode: string): MeetingSyncConfiguration | null {
  const enabled = environment.SOCIETYER_POWERSYNC_ENABLED?.trim();
  if (!enabled || enabled === "0") return null;
  if (enabled !== "1") throw new Error("SOCIETYER_POWERSYNC_ENABLED must be 0 or 1.");
  if (authMode !== "clerk" && authMode !== "better-auth") throw new Error("PowerSync requires hosted user authentication.");
  const endpoint = httpsOrigin(environment.PS_PUBLIC_ORIGIN, "PS_PUBLIC_ORIGIN");
  const trustedOrigin = httpsOrigin(issuer, "authentication issuer");
  if (environment.SOCIETYER_LOCAL_LIVE_PILOT === "1") throw new Error("Production PowerSync cannot enable the local test signer.");
  return { endpoint, trustedOrigin };
}

function httpsOrigin(value: string | undefined, label: string): string {
  let url: URL;
  try { url = new URL(value?.trim() ?? ""); } catch { throw new Error(`${label} must be a configured HTTPS origin.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost")) {
    throw new Error(`${label} must be a configured HTTPS origin without credentials, path, query or fragment.`);
  }
  return url.origin;
}

export function mountMeetingSyncCredentialRoute(router: Router, dependencies: {
  configuration: MeetingSyncConfiguration | null;
  resolveSession: (request: Request) => Promise<MeetingSyncSession | null>;
  queryIdentity: (token: string, societyId: string) => Promise<MeetingSyncIdentity>;
  signer: MeetingSyncSigner;
  now?: () => number;
}) {
  if (!dependencies.configuration) return;
  const { endpoint, trustedOrigin } = dependencies.configuration;
  const now = dependencies.now ?? Date.now;
  const rates = new Map<string, { until: number; count: number }>();
  router.post("/offline/meeting-preparation/credentials", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Vary", "Origin, Authorization, Cookie");
    try {
      // Cookies alone must never turn a cross-origin form into sync credentials.
      if (req.get("origin") !== trustedOrigin || req.get("sec-fetch-site") === "cross-site") {
        res.status(403).json({ error: "untrusted_origin" }); return;
      }
      const body = req.body as unknown;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "societyId")
          || typeof (body as { societyId?: unknown }).societyId !== "string"
          || !(body as { societyId: string }).societyId.trim() || (body as { societyId: string }).societyId.length > 200
          || Object.keys(req.query).length > 0 || req.get("x-society-id")) {
        res.status(400).json({ error: "invalid_sync_request", message: "Provide only the selected societyId in the JSON body." }); return;
      }
      const societyId = (body as { societyId: string }).societyId;
      const session = await dependencies.resolveSession(req);
      if (!session || !["clerk", "better-auth"].includes(session.type) || !session.convexAuthToken) {
        res.status(401).json({ error: "hosted_session_required" }); return;
      }
      if (session.societyId !== societyId) { res.status(403).json({ error: "workspace_mismatch" }); return; }
      // Convex derives the actor and rechecks membership, module and resource gates.
      // Identity query failures never mint credentials, including transient backend failures.
      let identity: MeetingSyncIdentity;
      try { identity = await dependencies.queryIdentity(session.convexAuthToken, societyId); }
      catch (error) {
        const data = (error as { data?: { code?: string }; status?: number; statusCode?: number })?.data;
        const message = error instanceof Error ? error.message : "";
        const denied = ["OFFLINE_ACCESS_DENIED", "FORBIDDEN", "UNAUTHORIZED"].includes(data?.code ?? "")
          || (error as { status?: number })?.status === 403 || (error as { statusCode?: number })?.statusCode === 403
          || /(?:Permission (?:meetings|minutes|agendas|documents):read required\.|Society membership not found\.|Society membership is not active\.|User is disabled\.|External identity is disabled(?: or its binding is invalid)?\.|Authentication required\.|Verified user identity required\.)/.test(message);
        res.status(denied ? 403 : 503).json({ error: denied ? "sync_access_denied" : "sync_identity_unavailable" }); return;
      }
      if (!identity?.actorKey || typeof identity.actorKey !== "string" || identity.societyId !== societyId) {
        res.status(403).json({ error: "invalid_sync_identity" }); return;
      }
      const current = now();
      const lifetimeSeconds = identity.accessUntilEpochMs === undefined ? 300
        : Math.min(300, Math.floor((identity.accessUntilEpochMs - current) / 1000));
      if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds < 1) { res.status(403).json({ error: "membership_expired" }); return; }
      for (const [key, rate] of rates) if (rate.until <= current) rates.delete(key);
      const rateKey = JSON.stringify([identity.actorKey, societyId]);
      const rate = rates.get(rateKey) ?? { until: current + 60_000, count: 0 };
      if (rate.count >= 20 || (!rates.has(rateKey) && rates.size >= 5000)) {
        res.setHeader("Retry-After", "60"); res.status(429).json({ error: "sync_credential_rate_limited" }); return;
      }
      rate.count++; rates.set(rateKey, rate);
      let signed: { token: string };
      try { signed = await dependencies.signer.signJWT({ body: {
        payload: { sub: identity.actorKey, society_id: identity.societyId, aud: endpoint, iat: Math.floor(current / 1000), exp: Math.floor(current / 1000) + lifetimeSeconds },
      } }); }
      catch { res.status(503).json({ error: "sync_signer_unavailable" }); return; }
      res.json({ endpoint, token: signed.token, expiresAtEpochMs: (Math.floor(current / 1000) + lifetimeSeconds) * 1000, identity: { actorKey: identity.actorKey, societyId: identity.societyId } });
    } catch (error) { next(error); }
  });
}
