/** Server-owned instance access policy. An empty allowlist preserves open registration. */
export function allowedAuthEmailDomains(env: Record<string, string | undefined>): string[] {
  const configured = env.SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS;
  if (configured === undefined) return [];
  const domains = [...new Set(configured.split(",").map(value => value.trim().toLowerCase()))];
  if (domains.some(domain => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(domain))) {
    throw new Error("SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS must contain comma-separated domain names, without @ or wildcards. Unset it for open registration.");
  }
  return domains;
}

export function authEmailAllowed(email: unknown, domains: readonly string[]): boolean {
  if (!domains.length) return true;
  if (typeof email !== "string") return false;
  const parts = email.trim().toLowerCase().split("@");
  return parts.length === 2 && Boolean(parts[0]) && !/\s/.test(parts[0]) && domains.includes(parts[1]);
}

export function authEmailPolicyMessage(domains: readonly string[]): string {
  return `Use a verified email address at ${domains.map(domain => `@${domain}`).join(" or ")} to access this instance.`;
}
