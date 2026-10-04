import "./env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { authSessionDurationSeconds, resolveAuthIssuer, validateHostedAuth } from "../shared/authConfiguration";

const DEVELOPMENT_AUTH_SECRET =
  "societyer-dev-secret-change-me-before-production-use";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function getAuthMode(): "none" | "better-auth" {
  return validateHostedAuth(process.env, process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL);
}

export const authIssuer = resolveAuthIssuer(process.env);
if (process.env.NODE_ENV === "production" && getAuthMode() === "none" && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(authIssuer).hostname)) {
  throw new Error("An internet-facing deployment requires Better Auth. Keep auth-disabled deployments local.");
}

function authSecret(): string {
  const configured = env("BETTER_AUTH_SECRET")?.trim();
  if (
    process.env.NODE_ENV === "production" &&
    getAuthMode() === "better-auth" &&
    (!configured || configured === DEVELOPMENT_AUTH_SECRET)
  ) {
    throw new Error(
      "A non-development BETTER_AUTH_SECRET is required when AUTH_MODE=better-auth in production.",
    );
  }
  if (configured) return configured;
  return DEVELOPMENT_AUTH_SECRET;
}

function resolveAuthDbPath(): string {
  const configured = env("AUTH_DB_PATH", "./data/auth.sqlite")!;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export function createAuthDatabase() {
  const filePath = resolveAuthDbPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  return new DatabaseSync(filePath);
}

export const auth = betterAuth({
  baseURL: authIssuer,
  secret: authSecret(),
  trustedOrigins: [new URL(authIssuer).origin],
  database: createAuthDatabase(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  account: { accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: [] } },
  session: { expiresIn: authSessionDurationSeconds(process.env), disableSessionRefresh: true },
  plugins: [
    jwt({
      jwks: { keyPairConfig: { alg: "ES256" } },
      jwt: { issuer: authIssuer, audience: authIssuer, expirationTime: "5m" },
    }),
  ],
  user: {
    additionalFields: {
      appRoleHint: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
});
