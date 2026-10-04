import type { AuthConfig } from "convex/server";
import { betterAuthIssuer } from "./lib/authIdentity";

const issuer = betterAuthIssuer();
const clerkDomain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim();
if (clerkDomain) {
  const url = new URL(clerkDomain);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("CLERK_JWT_ISSUER_DOMAIN must be an HTTPS origin.");
  }
}
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
