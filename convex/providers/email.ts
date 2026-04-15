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

  // Live Resend call stub.
  throw new Error("Live email send requires RESEND_API_KEY plus action-context fetch.");
}
