import type { AuthConfig } from "convex/server";
import { resolveSessionBroker, resolveClerkIssuer } from "../shared/authConfiguration";
import { betterAuthIssuer } from "./lib/authIdentity";

const mode = resolveSessionBroker(process.env);
const issuer = betterAuthIssuer();
const clerkDomain = mode === "clerk" ? resolveClerkIssuer(process.env) : undefined;
const jwks =
  process.env.BETTER_AUTH_JWKS_URL ??
  `${issuer.replace(/\/$/, "")}/api/auth/jwks`;

export default {
  providers: [
    ...(clerkDomain ? [{ domain: clerkDomain, applicationID: "convex" }] : []),
    {
      type: "customJwt",
      issuer,
      jwks,
      algorithm: "ES256",
      applicationID: issuer,
    },
  ],
} satisfies AuthConfig;
