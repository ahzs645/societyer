import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function getAuthMode(): "none" | "better-auth" {
  const mode = env("AUTH_MODE", env("VITE_AUTH_MODE", "none"));
  return mode === "better-auth" ? "better-auth" : "none";
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
  secret:
    env(
      "BETTER_AUTH_SECRET",
      "societyer-dev-secret-change-me-before-production-use",
    )!,
  trustedOrigins: [env("BETTER_AUTH_BASE_URL", "http://127.0.0.1:5173")!],
  database: createAuthDatabase(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
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
