import type { MicrosoftOptions } from "better-auth/social-providers";
import { createRemoteJWKSet, jwtVerify } from "jose";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
const IDENTITY_SCOPES = ["openid", "profile", "email"];

export interface MicrosoftSsoConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  baseURL: string;
}

/** Microsoft application credentials belong only on the auth server. */
export function getMicrosoftSsoConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MicrosoftSsoConfig | undefined {
  const names = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"] as const;
  const values = names.map((name) => environment[name]?.trim());
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value)) {
    throw new Error(`Microsoft SSO requires all of ${names.join(", ")}.`);
  }
  const [clientId, clientSecret, rawTenantId] = values as [string, string, string];
  if (!UUID_PATTERN.test(clientId)) {
    throw new Error("MICROSOFT_CLIENT_ID must be the Entra application (client) UUID.");
  }
  if (!UUID_PATTERN.test(rawTenantId) || rawTenantId.toLowerCase() === CONSUMER_TENANT_ID) {
    throw new Error("MICROSOFT_TENANT_ID must be your company Entra directory (tenant) UUID, not a SharePoint hostname or a shared Microsoft tenant.");
  }
  const configuredBaseURL = environment.BETTER_AUTH_BASE_URL?.trim() || "http://127.0.0.1:5173";
  let baseURL: URL;
  try {
    baseURL = new URL(configuredBaseURL);
  } catch {
    throw new Error("BETTER_AUTH_BASE_URL must be the public application origin for Microsoft SSO.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname);
  if (
    baseURL.username || baseURL.password || baseURL.search || baseURL.hash || baseURL.pathname !== "/" ||
    (baseURL.protocol !== "https:" && !(baseURL.protocol === "http:" && loopback && environment.NODE_ENV !== "production"))
  ) {
    throw new Error("BETTER_AUTH_BASE_URL must be an HTTPS application origin (HTTP loopback is allowed for local development only).");
  }
  return { clientId: clientId.toLowerCase(), clientSecret, tenantId: rawTenantId.toLowerCase(), baseURL: baseURL.origin };
}

export function microsoftProviderDiscovery(
  mode: "none" | "better-auth" | "clerk",
  config: MicrosoftSsoConfig | undefined,
) {
  return { mode, microsoft: { enabled: mode === "better-auth" && Boolean(config) } };
}

/**
 * The installed provider otherwise decodes OAuth callback tokens without
 * verification and fetches a Graph profile photo, even when photos are disabled.
 * Verify the tenant-scoped ID token before reading claims and never call Graph.
 */
export function createMicrosoftSsoProvider(config: MicrosoftSsoConfig): MicrosoftOptions {
  const options: MicrosoftOptions = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tenantId: config.tenantId,
    disableDefaultScope: true,
    scope: [...IDENTITY_SCOPES],
    disableProfilePhoto: true,
  };
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  const keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`));
  return {
    ...options,
    // Browser sign-in must use the authorization-code flow with state and PKCE.
    disableIdTokenSignIn: true,
    async getUserInfo(tokens) {
      if (!tokens.idToken) return null;
      let claims: Record<string, unknown>;
      try {
        const verified = await jwtVerify(tokens.idToken, keys, {
          algorithms: ["RS256"],
          audience: config.clientId,
          issuer,
          maxTokenAge: "1h",
          requiredClaims: ["exp", "iat", "sub", "tid"],
        });
        claims = verified.payload;
      } catch {
        // Rejected token claims can contain personal information. Do not log
        // verification errors or the raw token.
        return null;
      }
      if (claims.tid !== config.tenantId || typeof claims.sub !== "string" || !claims.sub) return null;
      // Entra email is optional. Require it rather than treating a mutable UPN
      // as proof of mailbox ownership. The stable identity is tenant + subject.
      if (typeof claims.email !== "string" || !claims.email.trim()) return null;
      const email = claims.email.trim();
      const verifiedPrimary = Array.isArray(claims.verified_primary_email) && claims.verified_primary_email.includes(email);
      const verifiedSecondary = Array.isArray(claims.verified_secondary_email) && claims.verified_secondary_email.includes(email);
      return {
        user: {
          id: claims.sub,
          name: typeof claims.name === "string" ? claims.name : "",
          email,
          emailVerified: claims.email_verified === true || verifiedPrimary || verifiedSecondary,
        },
        data: claims,
      };
    },
  };
}
