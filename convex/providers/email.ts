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

  if (p.id === "demo") throw new Error("Email delivery requires RESEND_API_KEY and RESEND_FROM_EMAIL (or RESEND_FROM). Simulation is available only in an explicit demo workspace.");

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
