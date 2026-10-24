"use node";
/** Live billing transport. Tests inject fetch; production never opts into demo acceptance. */
import { emailProviderConfiguration } from "../../shared/emailConfiguration";
export class BillingEmailError extends Error { constructor(message: string, readonly uncertain = false, readonly blocked = false) { super(message); } }
export type BillingEmailInput = { to: string; from: string; fromName?: string; replyTo?: string; subject: string; text: string; idempotencyKey: string; pdfBase64: string; fileName: string; provider?: string; providerDraftId?: string; submissionStartedAtISO?: string };
export type BillingEmailCheckpoints = { draft(id: string): Promise<void>; submission(atISO: string, provider: string): Promise<void> };
const mailbox = (value: string) => value.match(/<([^<>]+)>/)?.[1]?.trim().toLowerCase() ?? value.trim().toLowerCase();
export function billingEmailConfiguration(env: Record<string, string | undefined> = process.env) {
  const provider = emailProviderConfiguration(env);
  return { ...provider, sender: provider.id === "microsoft365" ? env.MICROSOFT_MAIL_SENDER : env.RESEND_FROM_EMAIL ?? env.RESEND_FROM };
}
export async function sendBillingEmail(input: BillingEmailInput, checkpoints: BillingEmailCheckpoints, deps: { fetch?: typeof fetch; env?: Record<string, string | undefined>; now?: () => string } = {}) {
  const env = deps.env ?? process.env, request = deps.fetch ?? fetch, at = deps.now?.() ?? new Date().toISOString(), config = billingEmailConfiguration(env);
  if (!config.live || config.id === "demo") throw new BillingEmailError("Configure RESEND_API_KEY and RESEND_FROM_EMAIL, or MICROSOFT_MAIL_TENANT_ID, CLIENT_ID, CLIENT_SECRET and SENDER on the server. Automatic delivery never uses demo transport.", false, true);
  if ((input.provider && input.provider !== config.id) || (input.providerDraftId && config.id !== "microsoft365")) throw new BillingEmailError("This delivery was started with another provider. Restore that provider and reconcile its acceptance before changing transport.", false, true);
  if (!config.sender || mailbox(config.sender) !== mailbox(input.from)) throw new BillingEmailError(`Sender settings must match the configured provider mailbox (${config.sender ?? "not configured"}).`, false, true);
  if (input.pdfBase64.length > 20_000_000 || !input.pdfBase64.startsWith("JVBERi0")) throw new BillingEmailError("The PDF attachment is missing or exceeds the 15 MB delivery limit.", false, true);
  if (config.id === "resend") {
    // Resend retains idempotency keys for 24h; never retry an ambiguous older submission.
    if (input.submissionStartedAtISO && Date.parse(at) - Date.parse(input.submissionStartedAtISO) >= 23 * 60 * 60_000) throw new BillingEmailError("The provider idempotency window expired. Reconcile this message in Resend before sending again.", true);
    if (!input.submissionStartedAtISO) await checkpoints.submission(at, config.id);
    let response: Response;
    try { response = await request(env.RESEND_API_BASE_URL ?? "https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000), headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({ from: input.fromName ? `${input.fromName.replace(/[<>\r\n"]/g, "")} <${input.from}>` : input.from, to: [input.to], reply_to: input.replyTo, subject: input.subject, text: input.text, attachments: [{ filename: input.fileName, content: input.pdfBase64, content_type: "application/pdf" }], tags: [{ name: "kind", value: "billing_automation" }] }) }); }
    catch { throw new BillingEmailError("Resend acceptance is unconfirmed; retry will reuse the same idempotency key."); }
    if (!response.ok) throw new BillingEmailError(`Resend rejected the request (${response.status}).${response.status === 409 ? " The idempotency key is already associated with different content; reconcile the provider message." : ""}`, response.status === 409, [400, 401, 403, 422].includes(response.status));
    const data = await response.json().catch(() => ({}));
    if (typeof data.id !== "string" || !data.id) throw new BillingEmailError("Resend returned no message identifier; acceptance is unconfirmed.");
    return { provider: "resend", id: data.id, accepted: true as const, acceptedAtISO: at };
  }
  const tokenResponse = await request(`https://login.microsoftonline.com/${env.MICROSOFT_MAIL_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.MICROSOFT_MAIL_CLIENT_ID!, client_secret: env.MICROSOFT_MAIL_CLIENT_SECRET!, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }) });
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer") throw new BillingEmailError("Microsoft mail authentication failed. Check the dedicated application credentials and Mail.ReadWrite/Mail.Send application permissions.", false, true);
  const root = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MICROSOFT_MAIL_SENDER!)}`;
  const headers = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' };
  let draftId = input.providerDraftId;
  if (!draftId) {
    // Durable occurrence marker allows recovery if draft creation succeeded before the response was persisted.
    const property = "String {b9744176-ec84-49bc-b61f-d240f652b220} Name SocietyerBillingDelivery";
    const escaped = input.idempotencyKey.replace(/'/g, "''");
    const lookup = await request(`${root}/messages?$filter=${encodeURIComponent(`singleValueExtendedProperties/Any(ep: ep/id eq '${property}' and ep/value eq '${escaped}')`)}&$select=id,isDraft&$top=2`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!lookup.ok) throw new BillingEmailError(`Microsoft cannot reconcile durable delivery markers (${lookup.status}). Check Mail.ReadWrite permission.`, false, true);
    const matches = (await lookup.json()).value ?? [];
    if (matches.length > 1) throw new BillingEmailError("Multiple Microsoft messages have this delivery marker. Reconcile them before retrying.", true);
    if (matches.length) { draftId = matches[0].id; await checkpoints.draft(draftId!); if (matches[0].isDraft === false) return { provider: "microsoft365", id: draftId!, accepted: true as const, acceptedAtISO: at }; }
    else {
      const draft = await request(`${root}/messages`, { method: "POST", redirect: "error", headers, signal: AbortSignal.timeout(25_000), body: JSON.stringify({ subject: input.subject, body: { contentType: "Text", content: input.text }, toRecipients: [{ emailAddress: { address: input.to } }], ...(input.replyTo ? { replyTo: [{ emailAddress: { address: input.replyTo } }] } : {}), singleValueExtendedProperties: [{ id: property, value: input.idempotencyKey }], attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: input.fileName, contentType: "application/pdf", contentBytes: input.pdfBase64 }] }) });
      if (!draft.ok) throw new BillingEmailError(`Microsoft draft preparation failed (${draft.status}).`, false, [400, 401, 403, 413].includes(draft.status));
      const data = await draft.json(); if (!data.id) throw new BillingEmailError("Microsoft returned no immutable draft identifier.");
      draftId = data.id; await checkpoints.draft(draftId!);
    }
  }
  if (input.submissionStartedAtISO) {
    const probe = await request(`${root}/messages/${encodeURIComponent(draftId!)}?$select=id,isDraft`, { headers, signal: AbortSignal.timeout(15_000) });
    if (probe.ok) { const message = await probe.json(); if (message.isDraft === false) return { provider: "microsoft365", id: draftId!, accepted: true as const, acceptedAtISO: at }; }
    throw new BillingEmailError("Microsoft submission was already attempted. Acceptance remains unconfirmed; inspect this immutable message in Microsoft 365 before retrying.", true);
  }
  await checkpoints.submission(at, config.id);
  let response: Response;
  try { response = await request(`${root}/messages/${encodeURIComponent(draftId!)}/send`, { method: "POST", redirect: "error", headers, signal: AbortSignal.timeout(25_000) }); }
  catch { throw new BillingEmailError("Microsoft submission timed out. Probe the immutable draft on the next run; do not create another message."); }
  if (response.status !== 202) throw new BillingEmailError(`Microsoft submission was not confirmed (${response.status}). The immutable draft must be reconciled before another submission.`, true);
  return { provider: "microsoft365", id: draftId!, accepted: true as const, acceptedAtISO: at };
}
