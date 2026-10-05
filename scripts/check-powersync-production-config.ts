import { meetingSyncConfiguration } from "../server/powersync-credentials";
import { resolveAuthIssuer, validateHostedAuth } from "../shared/authConfiguration";

/** Read-only validation; output never contains configured secret values. */
export function validatePowerSyncProductionEnvironment(environment: NodeJS.ProcessEnv) {
  const failures: string[] = [];
  const requireValue = (name: string) => {
    const value = environment[name]?.trim();
    if (!value || /replace|change-me|not-configured|placeholder|example\.(test|com)|fixture|disposable|dev-secret/i.test(value)) {
      failures.push(`${name}: supply the real production value through the secret manager`); return "";
    }
    return value;
  };
  const publicUrl = (name: string, allowPath = false) => {
    const value = requireValue(name);
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
          || (!allowPath && url.pathname !== "/") || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error();
      return url;
    } catch { failures.push(`${name}: requires a valid HTTPS endpoint without credentials or query`); return null; }
  };
  const origin = publicUrl("PS_PUBLIC_ORIGIN");
  const jwks = publicUrl("PS_JWKS_URL", true);
  publicUrl("PS_CONVEX_DEPLOYMENT_URL");
  const key = requireValue("PS_CONVEX_DEPLOY_KEY");
  if (key && key.length < 32) failures.push("PS_CONVEX_DEPLOY_KEY: malformed deployment credential");
  const storage = requireValue("PS_STORAGE_URI");
  if (storage) {
    try {
      const url = new URL(storage);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password || !url.hostname || !url.pathname || url.pathname === "/") throw new Error();
      if (url.searchParams.has("sslmode") && url.searchParams.get("sslmode") !== "verify-full") failures.push("PS_STORAGE_URI: insecure sslmode requested");
    } catch { failures.push("PS_STORAGE_URI: requires database, user and secret password"); }
  }
  try {
    const mode = validateHostedAuth(environment, environment.CONVEX_SELF_HOSTED_URL ?? environment.VITE_CONVEX_URL);
    const issuer = resolveAuthIssuer(environment);
    if (mode === "clerk") {
      publicUrl("CLERK_JWT_ISSUER_DOMAIN");
      const parties = requireValue("CLERK_AUTHORIZED_PARTIES").split(",").map(value => value.trim());
      if (!parties.includes(new URL(issuer).origin)) failures.push("CLERK_AUTHORIZED_PARTIES: must include the application origin");
      if (!environment.CLERK_SECRET_KEY?.trim() && !environment.CLERK_JWT_KEY?.trim()) failures.push("Clerk: supply CLERK_SECRET_KEY or CLERK_JWT_KEY");
    }
    if (!meetingSyncConfiguration(environment, issuer, mode)) failures.push("SOCIETYER_POWERSYNC_ENABLED: must be 1 for this release");
    if (jwks && (jwks.origin !== new URL(issuer).origin || jwks.pathname !== "/api/auth/jwks")) failures.push("PS_JWKS_URL: must identify the existing machine broker /api/auth/jwks");
  } catch { failures.push("Hosted authentication: requires consistent Clerk or Better Auth settings and a configured HTTPS issuer"); }
  const secret = requireValue("BETTER_AUTH_SECRET");
  if (secret && secret.length < 32) failures.push("BETTER_AUTH_SECRET: requires at least 32 characters");
  if (environment.OFFLINE_MEETING_PREPARATION_ENABLED !== "1") failures.push("OFFLINE_MEETING_PREPARATION_ENABLED: set to 1 in the Convex function deployment environment");
  if (environment.VITE_POWERSYNC_MEETING_PREPARATION !== "1") failures.push("VITE_POWERSYNC_MEETING_PREPARATION: build the frontend with 1");
  if (environment.SOCIETYER_LOCAL_LIVE_PILOT === "1") failures.push("SOCIETYER_LOCAL_LIVE_PILOT: local signer must remain disabled");
  const databasePath = requireValue("AUTH_DB_PATH");
  if (databasePath && !databasePath.startsWith("/")) failures.push("AUTH_DB_PATH: requires an absolute path on persistent storage");
  return { ok: failures.length === 0, failures, scope: "meeting-preparation", audienceConfigured: Boolean(origin) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validatePowerSyncProductionEnvironment(process.env);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
