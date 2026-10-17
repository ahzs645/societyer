import type { AuthConfig, AuthProvider } from "convex/server";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import { resolveSessionBroker, resolveClerkIssuer } from "../shared/authConfiguration";
import { betterAuthIssuer } from "./lib/authIdentity";

function gatewayProviders(): AuthProvider[] {
  const mode = resolveSessionBroker(process.env);
  const issuer = betterAuthIssuer();
  const clerkDomain = mode === "clerk" ? resolveClerkIssuer(process.env) : undefined;
  const jwks =
    process.env.BETTER_AUTH_JWKS_URL ??
    `${issuer.replace(/\/$/, "")}/api/auth/jwks`;
  return [
    ...(clerkDomain ? [{ domain: clerkDomain, applicationID: "convex" }] : []),
    {
      type: "customJwt",
      issuer,
      jwks,
      algorithm: "ES256",
      applicationID: issuer,
    },
  ];
}

export default {
  // The Convex-hosted broker trusts only this deployment's own signer, and
  // reads no gateway or Clerk settings, so AUTH_MODE is its only variable here.
  providers: process.env.AUTH_MODE === "convex" ? [getAuthConfigProvider()] : gatewayProviders(),
} satisfies AuthConfig;
