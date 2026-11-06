import "./env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt, twoFactor } from "better-auth/plugins";
import { authenticatorEnrollmentEnabled, authSessionDurationSeconds, resolveAuthIssuer, validateHostedAuth, type SessionBroker } from "../shared/authConfiguration";
import { authInstanceDetails } from "../shared/authInstance";
import { betterAuthMfaClaims, workspaceMfaProof } from "../shared/betterAuthMfa";
import { passwordResetLink } from "../shared/passwordResetLink";
import { createMicrosoftSsoProvider, getMicrosoftSsoConfig, microsoftAccountSubject } from "./microsoft-sso";

const DEVELOPMENT_AUTH_SECRET =
  "societyer-dev-secret-change-me-before-production-use";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function getAuthMode(): SessionBroker {
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

const managesUserSignIn = getAuthMode() === "better-auth";
export const microsoftSsoConfig = managesUserSignIn ? getMicrosoftSsoConfig() : undefined;

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
  hooks: {
    before: createAuthMiddleware(async ({ path }) => {
      if (path === "/two-factor/enable" && !authenticatorEnrollmentEnabled(process.env)) {
        throw new APIError("FORBIDDEN", { message: "Authenticator enrollment is closed for this instance." });
      }
    }),
  },
  plugins: [
    ...(managesUserSignIn ? [
      twoFactor({ issuer: authInstanceDetails(process.env).instanceName ?? "Societyer" }),
      workspaceMfaProof,
      passwordResetLink,
    ] : []),
    ...(microsoftSsoConfig ? [microsoftAccountSubject] : []),
    jwt({
      jwks: { keyPairConfig: { alg: "ES256" } },
      jwt: {
        issuer: authIssuer, audience: authIssuer, expirationTime: "5m",
        definePayload: async ({ user, session }): Promise<Record<string, unknown>> => ({
          ...user,
          ...await betterAuthMfaClaims((await auth.$context).adapter, user, session),
        }),
      },
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
