import "./env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";

const DEVELOPMENT_AUTH_SECRET =
  "societyer-dev-secret-change-me-before-production-use";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function getAuthMode(): "none" | "better-auth" {
  const mode = env("AUTH_MODE", env("VITE_AUTH_MODE", "none"));
  return mode === "better-auth" ? "better-auth" : "none";
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
  baseURL: env("BETTER_AUTH_BASE_URL", "http://127.0.0.1:5173"),
  secret: authSecret(),
  trustedOrigins: [env("BETTER_AUTH_BASE_URL", "http://127.0.0.1:5173")!],
  database: createAuthDatabase(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
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
