import "./env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { createMicrosoftSsoProvider, getMicrosoftSsoConfig } from "./microsoft-sso";

const DEVELOPMENT_AUTH_SECRET =
  "societyer-dev-secret-change-me-before-production-use";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function getAuthMode(): "none" | "better-auth" | "clerk" {
  const mode = env("AUTH_MODE", env("VITE_AUTH_MODE", "none"));
  if (mode === "none" || mode === "better-auth" || mode === "clerk") return mode;
  throw new Error(`Unsupported AUTH_MODE: ${mode}.`);
}

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
  baseURL: microsoftSsoConfig?.baseURL ?? env("BETTER_AUTH_BASE_URL", "http://127.0.0.1:5173"),
  secret: authSecret(),
  trustedOrigins: [microsoftSsoConfig?.baseURL ?? env("BETTER_AUTH_BASE_URL", "http://127.0.0.1:5173")!],
  database: createAuthDatabase(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders: microsoftSsoConfig ? { microsoft: createMicrosoftSsoProvider(microsoftSsoConfig) } : {},
  account: {
    // Existing workspace access must be migrated deliberately, never inherited
    // because an identity provider returned a matching email address.
    accountLinking: { enabled: false, disableImplicitLinking: true },
  },
  plugins: [
    jwt({
      jwks: { keyPairConfig: { alg: "ES256" } },
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
