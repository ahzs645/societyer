import { makeFunctionReference } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";

type Signer = { signJWT(input: { body: { payload: Record<string, unknown>; overrideOptions: { jwt: { audience: string; expirationTime: string } } } }): Promise<{ token: string }> };
/** Server-only adapter. Pass the existing authenticated client and auth.api.
 * The HTTP route must use Societyer's existing session resolver. Never expose
 * the signer directly, accept client identity claims, or allow local-dev actors.
 */
export async function issueMeetingSyncCredential(client: ConvexHttpClient, signer: Signer, societyId: string, configuredEndpoint: string) {
  const endpoint = new URL(configuredEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") throw new Error("A configured HTTPS PowerSync origin is required.");
  const identity = await client.query(makeFunctionReference<"query", { societyId: string }, { actorKey: string; societyId: string }>("offlineMeetings:syncIdentity"), { societyId });
  if (!identity.actorKey || identity.societyId !== societyId) throw new Error("Invalid sync identity.");
  // Uses the existing Better Auth machine signer even in Clerk user mode.
  // No new human sign-in flow, provider, or signing-key store.
  const signed = await signer.signJWT({ body: { payload: { sub: identity.actorKey, society_id: identity.societyId },
    overrideOptions: { jwt: { audience: endpoint.origin, expirationTime: "5m" } } } });
  return { endpoint: endpoint.origin, token: signed.token };
}
