import { importPKCS8, SignJWT } from "jose";
import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import type { DBAdapter } from "better-auth/types";
import { createMicrosoftSsoProvider, type MicrosoftSsoConfig } from "./microsoftSso";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const proofKey = (id: string) => `societyer-entra-session:${id}`;
export type HostedEntraConfig = MicrosoftSsoConfig & { groupIds: string[] };
type Environment = Record<string, string | undefined>;

/** Explicitly opt in: unrelated Microsoft storage/mail credentials never enable login. */
export function hostedEntraConfig(env: Environment = process.env): HostedEntraConfig | undefined {
  if (env.SOCIETYER_ENTRA_LOGIN !== "1") return undefined;
  const tenantId = env.MICROSOFT_LOGIN_TENANT_ID?.trim().toLowerCase();
  const clientId = env.MICROSOFT_LOGIN_CLIENT_ID?.trim().toLowerCase();
  const groupIds = [...new Set((env.MICROSOFT_LOGIN_GROUP_IDS ?? "").split(",").map(s => s.trim().toLowerCase()))];
  const baseURL = env.CONVEX_SITE_URL;
  if (!tenantId || !UUID.test(tenantId) || !clientId || !UUID.test(clientId)
    || !groupIds.length || groupIds.some(id => !UUID.test(id)) || !baseURL || new URL(baseURL).origin !== baseURL
    || new URL(baseURL).protocol !== "https:") throw new Error("Entra login requires exact tenant/client/group UUIDs and an HTTPS CONVEX_SITE_URL.");
  const pem = env.MICROSOFT_LOGIN_PRIVATE_KEY;
  const thumbprint = env.MICROSOFT_LOGIN_CERT_SHA256;
  if (!pem?.includes("-----BEGIN PRIVATE KEY-----") || !thumbprint || !/^[\w-]{43}$/.test(thumbprint)) {
    throw new Error("Entra login requires its server-only PKCS8 private key and SHA-256 certificate thumbprint.");
  }
  const key = importPKCS8(pem, "PS256");
  return {
    clientId, tenantId, groupIds, baseURL,
    clientAssertion: async () => new SignJWT({})
      .setProtectedHeader({ alg: "PS256", typ: "JWT", "x5t#S256": thumbprint })
      .setIssuer(clientId).setSubject(clientId)
      .setAudience(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`)
      .setJti(crypto.randomUUID()).setIssuedAt().setNotBefore("-30s").setExpirationTime("5m")
      .sign(await key),
  };
}

export function entraSsoRequired(env: Environment = process.env): boolean {
  return env.SOCIETYER_ENTRA_SSO_REQUIRED === "1";
}

/** Only signed, recent, employee tokens with the configured group can open a session. */
export function createHostedEntraProvider(config: HostedEntraConfig) {
  const provider = createMicrosoftSsoProvider({ ...config, onRejectedToken: (reason, details) => console.warn("Entra identity rejected", { reason, ...details }) });
  return {
    ...provider,
    // Accounts are explicitly provisioned from the reviewed directory roster.
    disableSignUp: true,
    async getUserInfo(tokens: Parameters<NonNullable<typeof provider.getUserInfo>>[0]) {
      const info = await provider.getUserInfo!(tokens);
      if (!info) return null;
      const claims = info.data;
      const age = Date.now() / 1000 - Number(claims.auth_time);
      const member = claims.acct === 0 || (claims.acct as unknown) === "0";
      const reason = !UUID.test(claims.oid ?? "") ? "object_id"
        : !member ? "account_type"
        : !Number.isFinite(age) || age < -60 || age > 300 ? "authentication_time"
        : !Array.isArray(claims.groups) || !config.groupIds.some(id => claims.groups.includes(id)) ? "group_membership" : null;
      if (reason) {
        // Log only the failed check, never tokens, claim values or profiles.
        console.warn("Entra identity rejected", { reason, hasAuthTime: claims.auth_time != null, accountTypeFormat: typeof claims.acct, hasGroupArray: Array.isArray(claims.groups) });
        return null;
      }
      return info;
    },
  };
}

export type EntraProof = { userId: string; tenantId: string; objectId: string; groupIds: string[]; authenticatedAt: number; expiresAt: number };

/** Proof is server-owned and tied to one app session, never to the user's email. */
export function hostedEntraPlugin(config: HostedEntraConfig): BetterAuthPlugin {
  const verifier = createHostedEntraProvider(config);
  return {
    id: "societyer-hosted-entra",
    init(ctx) {
      return { context: { socialProviders: ctx.socialProviders.map(provider => provider.id !== "microsoft" ? provider : {
        ...provider,
        // New hosted connections use Entra's immutable directory object ID.
        // The Node broker retains its existing app-specific sub policy.
        accountSubject: ({ profile }) => (profile as { oid: string }).oid,
        async createAuthorizationURL(data) {
          const url = await provider.createAuthorizationURL(data);
          url.searchParams.set("prompt", "login");
          // Entra issued immediately expired ID tokens with max_age=0 in the
          // live tenant. prompt=login still requests fresh authentication;
          // the optional auth_time claim is checked independently below.
          url.searchParams.delete("max_age");
          return url;
        },
      }) } };
    },
    hooks: { after: [{
      matcher: ({ path, params }) => (path === "/callback/:id" && params?.id === "microsoft") || path === "/callback/microsoft",
      handler: createAuthMiddleware(async ({ context }) => {
        const signedIn = context.newSession;
        if (!signedIn) return;
        const account = await context.adapter.findOne<{ accountId: string; idToken?: string }>({
          model: "account", where: [{ field: "userId", value: signedIn.user.id }, { field: "providerId", value: "microsoft" }],
        });
        const info = account?.idToken ? await verifier.getUserInfo({ idToken: account.idToken }) : null;
        if (!info || info.data.oid !== account?.accountId) {
          await context.internalAdapter.deleteSession(signedIn.session.token);
          throw new Error("Entra session verification failed.");
        }
        const authenticatedAt = Number(info.data.auth_time) * 1000;
        const expiresAt = Math.min(new Date(signedIn.session.expiresAt).getTime(), authenticatedAt + 8 * 3600_000);
        const proof: EntraProof = {
          userId: signedIn.user.id, tenantId: config.tenantId, objectId: info.data.oid,
          groupIds: config.groupIds.filter(id => info.data.groups.includes(id)), authenticatedAt, expiresAt,
        };
        await context.internalAdapter.createVerificationValue({
          identifier: proofKey(signedIn.session.id), value: JSON.stringify(proof), expiresAt: new Date(expiresAt),
        });
      }),
    }] },
  };
}

export async function hostedEntraClaims(adapter: Pick<DBAdapter, "findOne">, userId: string, sessionId: string, config?: HostedEntraConfig) {
  if (!config) return {};
  const record = await adapter.findOne<{ value: string; expiresAt: Date | number | string }>({
    model: "verification", where: [{ field: "identifier", value: proofKey(sessionId) }],
  });
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) return {};
  let proof: EntraProof;
  try { proof = JSON.parse(record.value); } catch { return {}; }
  if (proof.userId !== userId || !validEntraProof(proof, config)) return {};
  return { societyer_entra: proof };
}

export function validEntraProof(value: unknown, config: Pick<HostedEntraConfig, "tenantId" | "groupIds">, now = Date.now()): value is EntraProof {
  const proof = value as EntraProof | undefined;
  return Boolean(proof && proof.tenantId === config.tenantId && UUID.test(proof.objectId)
    && Array.isArray(proof.groupIds) && config.groupIds.some(id => proof.groupIds.includes(id))
    && Number.isFinite(proof.authenticatedAt) && proof.authenticatedAt <= now + 60_000
    && proof.authenticatedAt > now - 8 * 3600_000 && Number.isFinite(proof.expiresAt)
    && proof.expiresAt > now && proof.expiresAt <= proof.authenticatedAt + 8 * 3600_000);
}
