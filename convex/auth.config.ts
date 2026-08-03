import type { AuthConfig } from "convex/server";

const issuer =
  process.env.BETTER_AUTH_BASE_URL ?? "http://127.0.0.1:5173";
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
