// Email adapter — Resend in live mode, no-op (logged) in demo.
import { providers } from "./env";

export type SentEmail = {
  provider: "resend" | "demo";
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
}): Promise<SentEmail> {
  const p = providers.email();
  const sentAtISO = new Date().toISOString();
  const bodyPreview = (args.text ?? args.html ?? "").slice(0, 140);

  if (p.id === "demo") {
    // Demo mode logs but also returns a fake id — the caller can surface the
    // "email sent" state in the notification center without actually reaching
    // out over SMTP.
    console.log(`[email:demo] → ${args.to} | ${args.subject}`);
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

  const apiKey = (globalThis as any)?.process?.env?.RESEND_API_KEY;
  const from =
    (globalThis as any)?.process?.env?.RESEND_FROM_EMAIL ??
    (globalThis as any)?.process?.env?.RESEND_FROM ??
    "Societyer <noreply@example.com>";
  const endpoint =
    (globalThis as any)?.process?.env?.RESEND_API_BASE_URL ??
    "https://api.resend.com/emails";

  if (!apiKey) {
    throw new Error("Live email send requires RESEND_API_KEY.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
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
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `Resend request failed with status ${response.status}.`);
  }

  const data = await response.json().catch(() => ({}));
  return {
    provider: "resend" as const,
    accepted: true,
    id: String((data as any)?.id ?? `resend-${Date.now()}`),
    to: args.to,
    subject: args.subject,
    bodyPreview,
    sentAtISO,
  };
}
