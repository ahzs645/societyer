/** Deliberately pinned to this project's development deployment, never production. */
export const DEVELOPMENT_MAIL_SITE = "https://gallant-anteater-27.convex.site";
export function developmentMailConfigured(env: Record<string, string | undefined>): boolean {
  if (env.SOCIETYER_AUTH_DEVELOPMENT_MAIL !== "1" || env.CONVEX_SITE_URL !== DEVELOPMENT_MAIL_SITE) return false;
  const origins = (env.SITE_URL ?? "").split(",").map(value => value.trim());
  return origins.length > 0 && origins.every(value => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "5173" && url.origin === value;
    } catch { return false; }
  });
}
export function assertDevelopmentMail(env: Record<string, string | undefined>) {
  if (!developmentMailConfigured(env)) throw new Error("Development mail requires the pinned development deployment and localhost-only site origins.");
}
