/** Server-only provider selection shared by capability checks and delivery. */
export type EmailProviderId = "resend" | "microsoft365" | "demo";
type EmailEnv = Record<string, string | undefined>;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mailbox = /^[^\s@<>/\\]+@[^\s@<>/\\]+\.[^\s@<>/\\]+$/;

export function emailProviderConfiguration(env: EmailEnv): { id: EmailProviderId; live: boolean } {
  const selected = env.SOCIETYER_EMAIL_PROVIDER?.trim().toLowerCase();
  if (selected && selected !== "resend" && selected !== "microsoft365") {
    throw new Error("SOCIETYER_EMAIL_PROVIDER must be resend or microsoft365.");
  }
  const resend = Boolean(env.RESEND_API_KEY?.trim() && (env.RESEND_FROM_EMAIL?.trim() || env.RESEND_FROM?.trim()));
  const microsoft = Boolean(
    guid.test(env.MICROSOFT_MAIL_TENANT_ID ?? "") &&
    guid.test(env.MICROSOFT_MAIL_CLIENT_ID ?? "") &&
    env.MICROSOFT_MAIL_CLIENT_SECRET?.trim() &&
    mailbox.test(env.MICROSOFT_MAIL_SENDER ?? ""),
  );
  if (selected === "microsoft365") return { id: "microsoft365", live: microsoft };
  if (selected === "resend") return { id: "resend", live: resend };
  // Preserve existing Resend deployments when no explicit selector is set.
  if (resend) return { id: "resend", live: true };
  if (microsoft) return { id: "microsoft365", live: true };
  return { id: "demo", live: false };
}
