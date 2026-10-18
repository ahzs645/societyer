// Live delivery through the selected provider; simulation must be explicit.
import { providers } from "./env";

export type SentEmail = {
  provider: "resend" | "microsoft365" | "demo";
  accepted: boolean;
  id: string;
  to: string;
  subject: string;
  bodyPreview: string;
  sentAtISO: string;
};

export async function sendEmail(args: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  tag?: string;
  demo?: boolean;
}): Promise<SentEmail> {
  const p = providers.email();
  const sentAtISO = new Date().toISOString();
  const bodyPreview = (args.text ?? args.html ?? "").slice(0, 140);

  if (args.demo === true) {
    // Demo mode logs but also returns a fake id — the caller can surface the
    // "email sent" state in the notification center without actually reaching
    // out over SMTP.
    // Explicit simulation never sends to an external provider.
    return {
      provider: "demo",
      accepted: true,
      id: `demo-${Math.random().toString(36).slice(2, 10)}`,
      to: args.to,
      subject: args.subject,
      bodyPreview,
      sentAtISO,
    };
  }

  if (!p.live) throw new Error("Email delivery requires a configured provider: RESEND_API_KEY and RESEND_FROM_EMAIL, or Microsoft 365 mail tenant, client, secret and sender settings. Simulation is available only in an explicit demo workspace.");

  if (p.id === "microsoft365") {
    // Dedicated credentials: never inherit the SharePoint app's permissions.
    const tenant = process.env.MICROSOFT_MAIL_TENANT_ID!;
    const client = process.env.MICROSOFT_MAIL_CLIENT_ID!;
    const secret = process.env.MICROSOFT_MAIL_CLIENT_SECRET!;
    const sender = process.env.MICROSOFT_MAIL_SENDER!;
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
    });
    if (!tokenResponse.ok) throw new Error(`Microsoft mail authentication failed with status ${tokenResponse.status}.`);
    const token = await tokenResponse.json().catch(() => ({}));
    if (typeof token.access_token !== "string" || !token.access_token.trim() || token.token_type?.toLowerCase() !== "bearer") {
      throw new Error("Microsoft mail authentication returned an invalid token response.");
    }
    const requestId = crypto.randomUUID();
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "client-request-id": requestId },
      body: JSON.stringify({
        message: {
          subject: args.subject,
          body: { contentType: args.html !== undefined ? "HTML" : "Text", content: args.html ?? args.text ?? "" },
          toRecipients: [{ emailAddress: { address: args.to } }],
        },
        saveToSentItems: true,
      }),
    });
    // Graph returns 202 with no message ID. This is acceptance, not proof of delivery.
    if (response.status !== 202) throw new Error(`Microsoft mail request failed with status ${response.status}.`);
    return { provider: "microsoft365", accepted: true, id: `microsoft365:${requestId}`, to: args.to, subject: args.subject, bodyPreview, sentAtISO };
  }

  const apiKey = (globalThis as any)?.process?.env?.RESEND_API_KEY;
  const from =
    (globalThis as any)?.process?.env?.RESEND_FROM_EMAIL ??
    (globalThis as any)?.process?.env?.RESEND_FROM ??
    undefined;
  const endpoint =
    (globalThis as any)?.process?.env?.RESEND_API_BASE_URL ??
    "https://api.resend.com/emails";

  if (!apiKey || !from) {
    throw new Error("Live email send requires RESEND_API_KEY and RESEND_FROM_EMAIL (or RESEND_FROM).");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      tags: args.tag ? [{ name: "kind", value: args.tag }] : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend request failed with status ${response.status}.`);
  }

  const data = await response.json().catch(() => ({}));
  if (typeof (data as any)?.id !== "string" || !(data as any).id.trim()) throw new Error("Resend did not return a delivery identifier; acceptance is unconfirmed.");
  return {
    provider: "resend" as const,
    accepted: true,
    id: String((data as any).id),
    to: args.to,
    subject: args.subject,
    bodyPreview,
    sentAtISO,
  };
}
