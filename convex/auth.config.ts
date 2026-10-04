import type { AuthConfig } from "convex/server";
import { resolveAuthIssuer, resolveSessionBroker } from "../shared/authConfiguration";

resolveSessionBroker(process.env);
const issuer = resolveAuthIssuer(process.env);
const jwks =
  process.env.BETTER_AUTH_JWKS_URL ??
  `${issuer.replace(/\/$/, "")}/api/auth/jwks`;

export default {
  providers: [
    {
      type: "customJwt",
      issuer,
      jwks,
      algorithm: "ES256",
      applicationID: issuer,
    },
  ],
} satisfies AuthConfig;
