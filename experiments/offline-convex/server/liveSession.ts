// Isolated test broker: never enabled by a production build or app server.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import type { ViteDevServer } from "vite";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { importJWK, SignJWT } from "jose";

const issuer = "http://127.0.0.1:43212";
const endpoint = "http://127.0.0.1:43220";
type LocalPilotRequest = { method?: string; socket: { remoteAddress?: string }; headers: { host?: string; origin?: string; "sec-fetch-site"?: string | string[] } };

/** The fixture signer must reject untrusted requests before any actor is seeded. */
export function assertLocalPilotRequest(req: LocalPilotRequest) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") || req.method !== "GET") throw new Error("Loopback GET required.");
  // This middleware runs before Vite's Host check. Socket loopback alone
  // cannot protect a fixture signer against DNS rebinding or cross-origin
  // requests from another page on this machine.
  const requestOrigin = new URL(`http://${req.headers.host ?? "invalid"}`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(requestOrigin.hostname)) throw new Error("Loopback Host required.");
  if (req.headers.origin && req.headers.origin !== requestOrigin.origin) throw new Error("Same-origin request required.");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new Error("Cross-site fixture access denied.");
}

export async function configureLiveSession(server: Pick<ViteDevServer, "middlewares">) {
  if (process.env.SOCIETYER_LOCAL_LIVE_PILOT !== "1") return;
  const settings = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
  if (settings.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:43210" || !settings.CONVEX_SELF_HOSTED_ADMIN_KEY?.startsWith("societyer-offline-pilot|")) throw new Error("Isolated local pilot target required.");
  const jwk = JSON.parse(readFileSync(new URL("../.env.signer.local", import.meta.url), "utf8"));
  const key = await importJWK(jwk, "ES256");
  const admin = new ConvexHttpClient(settings.CONVEX_SELF_HOSTED_URL, { logger: false }) as ConvexHttpClient & { setAdminAuth(key: string): void; function(ref: unknown, component: undefined, args: unknown): Promise<any> };
  admin.setAdminAuth(settings.CONVEX_SELF_HOSTED_ADMIN_KEY);
  type Seed = { societyA: string; societyB: string; users: Record<string, string> };
  mkdirSync(new URL("../../../tmp/", import.meta.url), { recursive: true });
  const runsFile = new URL("../../../tmp/pilot-live-runs.json", import.meta.url);
  const stored: Record<string, Seed> = existsSync(runsFile) ? JSON.parse(readFileSync(runsFile, "utf8")) : {};
  const seeds = new Map<string, Promise<Seed>>(Object.entries(stored).map(([run, ids]) => [run, Promise.resolve(ids)]));
  const reference = (name: string) => makeFunctionReference<"mutation">(name);
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/__live/")) return next();
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    try {
      assertLocalPilotRequest(req);
      const url = new URL(req.url, "http://127.0.0.1");
      const run = url.searchParams.get("run") ?? "manual-live";
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(run)) throw new Error("Invalid test run.");
      const actor = url.searchParams.get("actor") ?? "owner-a";
      if (!["owner-a", "viewer-a", "owner-b"].includes(actor)) throw new Error("Unknown local test actor.");
      if (!seeds.has(run)) {
        if (seeds.size >= 500) throw new Error("Restart local broker after 500 isolated runs.");
        seeds.set(run, admin.function(reference("localPilotAdmin:seed"), undefined, { issuer, run }).then(ids => {
          stored[run] = ids; writeFileSync(runsFile, JSON.stringify(stored), { mode: 0o600 }); return ids;
        }));
      }
      const ids = await seeds.get(run)!;
      const subject = `${actor}-${run}`;
      const societyId = actor === "owner-b" ? ids.societyB : ids.societyA;
      const jwt = (audience: string, payload: Record<string, string>, sub: string) => new SignJWT(payload)
        .setProtectedHeader({ alg: "ES256", kid: jwk.kid }).setSubject(sub).setIssuer(issuer)
        .setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(key);
      if (url.pathname === "/__live/session") {
        const verified = new ConvexHttpClient(settings.CONVEX_SELF_HOSTED_URL!, { logger: false });
        verified.setAuth(await jwt(issuer, {}, subject));
        await verified.query(makeFunctionReference<"query">("offlineMeetings:syncIdentity"), { societyId });
        const state = await admin.function(makeFunctionReference<"query">("localPilotAdmin:inspect"), undefined, { societyId });
        const user = state.users.find((row: { _id: string }) => row._id === ids.users[actor]);
        res.end(JSON.stringify({ issuer, subject, societyId, userId: ids.users[actor], role: user?.role, deployment: settings.CONVEX_SELF_HOSTED_URL, token: await jwt(issuer, {}, subject) }));
      } else if (url.pathname === "/__live/credentials") {
        // Current native membership is checked on every refresh. No token is
        // accepted from the browser and no admin credential leaves this server.
        const client = new ConvexHttpClient(settings.CONVEX_SELF_HOSTED_URL!, { logger: false });
        client.setAuth(await jwt(issuer, {}, subject));
        const identity = await client.query(makeFunctionReference<"query">("offlineMeetings:syncIdentity"), { societyId });
        res.end(JSON.stringify({ endpoint, token: await jwt(endpoint, { society_id: societyId }, identity.actorKey) }));
      } else { res.statusCode = 404; res.end(JSON.stringify({ error: "Unknown local route." })); }
    } catch (error) { res.statusCode = 403; res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
  });
}
