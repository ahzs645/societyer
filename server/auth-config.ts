import "./env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { authSessionDurationSeconds, resolveAuthIssuer, validateHostedAuth } from "../shared/authConfiguration";
import { createMicrosoftSsoProvider, getMicrosoftSsoConfig } from "./microsoft-sso";

const DEVELOPMENT_AUTH_SECRET =
  "societyer-dev-secret-change-me-before-production-use";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function getAuthMode(): "none" | "better-auth" | "clerk" {
  return validateHostedAuth(process.env, process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? process.env.CONVEX_SELF_HOSTED_URL);
}

export const authIssuer = resolveAuthIssuer(process.env);

function authSecret(): string {
  const configured = env("BETTER_AUTH_SECRET")?.trim();
  if (
    process.env.NODE_ENV === "production" &&
    getAuthMode() !== "none" &&
    (!configured || configured.length < 32 || configured === DEVELOPMENT_AUTH_SECRET || configured === "change-me-before-production")
  ) {
    throw new Error(
      "A non-development BETTER_AUTH_SECRET of at least 32 characters is required for the session or machine JWT issuer in production.",
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

export const microsoftSsoConfig = getAuthMode() === "better-auth" ? getMicrosoftSsoConfig() : undefined;

export const auth = betterAuth({
  baseURL: authIssuer,
  secret: authSecret(),
  trustedOrigins: [new URL(authIssuer).origin],
  database: createAuthDatabase(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders: microsoftSsoConfig ? { microsoft: createMicrosoftSsoProvider(microsoftSsoConfig) } : {},
  account: {
    // Existing workspace access must be migrated deliberately, never inherited
    // because an identity provider returned a matching email address.
    accountLinking: { enabled: false, disableImplicitLinking: true, trustedProviders: [] },
  },
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
