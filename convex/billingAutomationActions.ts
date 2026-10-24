"use node";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalAction } from "./lib/untypedServer";
import { authorizedAction } from "./lib/authorizedServer";
import { BillingEmailError, sendBillingEmail } from "./providers/billingEmail";
import { renderBillingDocument } from "./lib/renderBillingDocument";
import { runReportPortable } from "../shared/functions/commerceReports";
import { automationError, billingRetryAt } from "../shared/billingAutomation";
const ref = (name: string) => makeFunctionReference(name) as any;
const internal = (name: string) => ref(`billingAutomation:${name}`);
async function deliver(ctx: any, societyId: string, id: string) {
  const run = await ctx.runMutation(internal("claimInternal"), { societyId, id }); if (!run) return { id, status: "not_due" };
  if (run.alreadyAccepted) { try { await ctx.runMutation(internal("finalizeInternal"), { societyId, id }); return { id, status: "accepted" }; } catch (error) { return { id, status: "accepted", error: automationError(error) }; } }
  let deliveries = run.deliveries.map((d: any) => ({ ...d }));
  const update = (event: string, patch: Record<string, any>) => ctx.runMutation(internal("updateInternal"), { societyId, id, token: run.leaseToken, event, patch });
  try {
    const branding = await ctx.runQuery(internal("workerContext"), { societyId, id });
    let snapshot = run.snapshot;
    if (run.snapshotStorageId) { const blob = await ctx.storage.get(run.snapshotStorageId); if (!blob) throw new Error("The frozen document snapshot is missing."); snapshot = JSON.parse(await blob.text()); }
    let pdf: Uint8Array;
    if (run.pdfStorageId) { const blob = await ctx.storage.get(run.pdfStorageId); if (!blob) throw new Error("The frozen PDF attachment is missing."); pdf = new Uint8Array(await blob.arrayBuffer()); }
    else {
      if (snapshot.kind === "report") {
        const result = await runReportPortable((name, args) => ctx.runQuery(internal("reportSourceInternal"), { societyId, id, sourceTable: args.sourceTable, cursor: args.cursor, pageSize: args.pageSize }), { societyId, definition: snapshot.definition.definition });
        snapshot = { ...snapshot, result, organization: branding.organization, config: branding.config };
      } else snapshot = { ...snapshot, organization: { ...snapshot.organization, logoUrl: branding.organization.logoUrl } };
      pdf = await renderBillingDocument(snapshot);
      const pdfStorageId = await ctx.storage.store(new Blob([pdf.slice().buffer as ArrayBuffer], { type: "application/pdf" }));
      const snapshotStorageId = await ctx.storage.store(new Blob([JSON.stringify(snapshot)], { type: "application/json" }));
      const artifactHash = Buffer.from(await crypto.subtle.digest("SHA-256", pdf.slice().buffer as ArrayBuffer)).toString("hex");
      const fileName = `${String(snapshot.invoice?.number ?? snapshot.result?.title ?? run.schedule.name).replace(/[^a-z0-9_-]/gi, "_").slice(0, 100)}.pdf`;
      await update("document_frozen", { pdfStorageId, snapshotStorageId, artifactHash, fileName });
      run.pdfStorageId = pdfStorageId; run.fileName = fileName;
    }
    const pdfBase64 = Buffer.from(pdf).toString("base64");
    for (let index = 0; index < deliveries.length; index++) {
      const delivery = deliveries[index];
      const outboxAccepted = () => ctx.runMutation(internal("outboxInternal"), { societyId, id, token: run.leaseToken, index, patch: { status: "sent", providerState: "accepted", providerMessageId: delivery.providerId, sentAtISO: delivery.acceptedAtISO, sentChannel: delivery.provider, automationPdfStorageId: run.pdfStorageId, automationPdfFileName: run.fileName, notes: "Provider accepted this message; delivery to the recipient is not confirmed." } });
      if (delivery.status === "accepted") { await outboxAccepted(); continue; }
      const subject = `${run.schedule.kind === "invoice_reminder" ? "Payment reminder: " : ""}${snapshot.invoice?.number ?? run.schedule.name}`;
      const envelope = delivery.envelope ?? { from: run.settings.fromEmail, fromName: run.settings.fromName, replyTo: run.settings.replyTo, subject, text: `Please find the attached ${run.schedule.kind === "report" ? "financial report" : "invoice"}.` };
      const accepted = await sendBillingEmail({ ...envelope, to: delivery.to, idempotencyKey: `${id}:${index}`, pdfBase64, fileName: run.fileName ?? "document.pdf", provider: delivery.provider, providerDraftId: delivery.providerDraftId, submissionStartedAtISO: delivery.submissionStartedAtISO }, {
        draft: async (providerDraftId) => { delivery.providerDraftId = providerDraftId; delivery.provider = "microsoft365"; delivery.envelope = envelope; await update("provider_draft_prepared", { deliveries }); },
        submission: async (submissionStartedAtISO, provider) => { delivery.submissionStartedAtISO = submissionStartedAtISO; delivery.provider = provider; delivery.envelope = envelope; await update("provider_submission_started", { deliveries }); },
      });
      Object.assign(delivery, { status: "accepted", provider: accepted.provider, providerId: accepted.id, acceptedAtISO: accepted.acceptedAtISO, error: undefined });
      await update("provider_accepted", { deliveries });
      await outboxAccepted();
    }
    await update("accepted", { status: "accepted", lastError: undefined, leaseUntilISO: undefined });
    try { await ctx.runMutation(internal("finalizeInternal"), { societyId, id }); }
    catch (error) { await update("bookkeeping_blocked", { lastError: `Provider accepted the message; invoice bookkeeping needs attention: ${automationError(error)}` }); }
    return { id, status: "accepted" };
  } catch (error) {
    const status = error instanceof BillingEmailError && error.uncertain ? "uncertain" : error instanceof BillingEmailError && error.blocked ? "blocked" : run.attempts >= 6 ? "failed" : "retry";
    await update(status, { status, deliveries, lastError: automationError(error), leaseUntilISO: undefined, nextAttemptAtISO: billingRetryAt(new Date().toISOString(), run.attempts) });
    return { id, status, error: automationError(error) };
  }
}
export const runDue = authorizedAction("billingAutomationActions:runDue", action)({ args: { societyId: v.id("societies") }, returns: v.any(), handler: async (ctx, { societyId }) => { const ids = await ctx.runMutation(ref("billingAutomation:prepareDue"), { societyId }); const results: Array<{ id: string; status: string; error?: string }> = [], deadline = Date.now() + 8 * 60_000; for (const id of ids.slice(0, 10)) { if (Date.now() >= deadline) break; results.push(await deliver(ctx, societyId, id)); } return results; } });
export const scan = internalAction({ args: { cursor: v.optional(v.union(v.string(), v.null())), scanAtISO: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.runQuery(internal("dueWork"), { cursor: args.cursor, scanAtISO: args.scanAtISO });
  const actors = page.actors;
  const seen = new Set<string>(), deadline = Date.now() + 8 * 60_000;
  for (const actor of actors) {
    if (seen.size >= 10 || Date.now() >= deadline) break;
    try { const ids = await ctx.runMutation(internal("prepareInternal"), { societyId: actor.societyId, actorUserId: actor.createdByUserId }); for (const id of ids) { if (seen.size >= 10 || Date.now() >= deadline) break; if (seen.has(id)) continue; seen.add(id); await deliver(ctx, actor.societyId, id); } }
    catch (error) { console.error("Billing automation scan failed", actor.societyId, automationError(error)); }
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, ref("billingAutomationActions:scan"), { cursor: page.continueCursor, scanAtISO: page.scanAtISO });
  return null;
} });
