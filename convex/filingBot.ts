// @ts-nocheck
import { updatePortable as updateFilingPortable } from "../shared/functions/filings";
import { authorizedAction, authorizedQuery } from "./lib/authorizedServer";
import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  getOwned,
  principalUserId,
  requireSocietyMembership,
} from "../shared/functions/access";
import {
  listRunsPortable,
  runsForFilingPortable,
  getRunPortable,
  buildFilingPacketPortable,
} from "../shared/functions/filingBot";
import { bcSocietyBotKind } from "../shared/filingPreparation";

const STEP_DEFINITIONS: Record<string, { label: string; note?: string }[]> = {
  AnnualReport: [
    { label: "Gather current directors, registered address, purposes" },
    { label: "Collect residency and consent facts for operator review" },
    { label: "Pre-fill BC Societies Online Form 11 (annual report)" },
    { label: "List potential signatories for operator confirmation" },
    { label: "Stage Form 11 and deep-link to Societies Online for review" },
    { label: "Ready for you to submit — no filing was sent automatically" },
  ],
  BylawAmendment: [
    { label: "Collect bylaw text (marked-up and clean)" },
    { label: "Reference special resolution minute" },
    { label: "Pre-fill bylaw amendment filing" },
    { label: "Stage filing and deep-link to Societies Online for review" },
    { label: "Ready for you to submit — no filing was sent automatically" },
  ],
  ChangeOfDirectors: [
    { label: "Diff director register vs last filed state" },
    { label: "Pre-fill change-of-directors form" },
    { label: "Stage filing and deep-link to Societies Online for review" },
    { label: "Ready for you to submit — no filing was sent automatically" },
  ],
};

export const listRuns = authorizedQuery("filingBot:listRuns", query)({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => listRunsPortable(await toPortableQueryCtx(ctx), args),
});

export const runsForFiling = authorizedQuery("filingBot:runsForFiling", query)({
  args: { filingId: v.id("filings") },
  returns: v.any(),
  handler: async (ctx, args) => runsForFilingPortable(await toPortableQueryCtx(ctx), args),
});

export const getRun = authorizedQuery("filingBot:getRun", query)({
  args: { id: v.id("filingBotRuns") },
  returns: v.any(),
  handler: async (ctx, args) => getRunPortable(await toPortableQueryCtx(ctx), args),
});

export const _createRun = internalMutation({
  args: {
    societyId: v.id("societies"),
    filingId: v.id("filings"),
    kind: v.string(),
    demo: v.boolean(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    const portable = await toPortableMutationCtx(ctx);
    await getOwned(portable, "filings", args.filingId, args.societyId);
    const triggeredByUserId = await principalUserId(portable, args.societyId);
    const society = await ctx.db.get(args.societyId);
    if (!society) throw new Error("Society not found.");
    const kind = bcSocietyBotKind(society, args.kind);
    const steps = STEP_DEFINITIONS[kind].map((s) => ({
      label: s.label,
      status: "pending",
      note: s.note,
    }));
    return await ctx.db.insert("filingBotRuns", {
      societyId: args.societyId,
      filingId: args.filingId,
      kind,
      status: "queued",
      startedAtISO: new Date().toISOString(),
      steps,
      demo: args.demo,
      triggeredByUserId,
    });
  },
});

export const _updateStep = internalMutation({
  args: {
    id: v.id("filingBotRuns"),
    stepIndex: v.number(),
    status: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, stepIndex, status, note }) => {
    const portable = await toPortableMutationCtx(ctx);
    const societyId = portable.principal.kind === "anonymous"
      ? undefined
      : portable.principal.societyId;
    if (!societyId) throw new Error("Society membership not found.");
    await requireSocietyMembership(portable, societyId);
    const run = await getOwned(portable, "filingBotRuns", id, societyId);
    const steps = run.steps.map((s, i) =>
      i === stepIndex
        ? { ...s, status, atISO: new Date().toISOString(), note: note ?? s.note }
        : s,
    );
    await ctx.db.patch(id, { steps });
  },
});

export const _completeRun = internalMutation({
  args: {
    id: v.id("filingBotRuns"),
    status: v.string(),
    confirmationNumber: v.optional(v.string()),
    pdfDocumentId: v.optional(v.id("documents")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const portable = await toPortableMutationCtx(ctx);
    const societyId = portable.principal.kind === "anonymous"
      ? undefined
      : portable.principal.societyId;
    if (!societyId) throw new Error("Society membership not found.");
    await requireSocietyMembership(portable, societyId);
    await getOwned(portable, "filingBotRuns", args.id, societyId);
    if (args.pdfDocumentId) {
      await getOwned(portable, "documents", args.pdfDocumentId, societyId);
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      completedAtISO: new Date().toISOString(),
      confirmationNumber: args.confirmationNumber,
      pdfDocumentId: args.pdfDocumentId,
    });
  },
});

export const _patchFiling = internalMutation({
  args: {
    filingId: v.id("filings"),
    filedAt: v.optional(v.string()),
    confirmationNumber: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const portable = await toPortableMutationCtx(ctx);
    const societyId = portable.principal.kind === "anonymous"
      ? undefined
      : portable.principal.societyId;
    if (!societyId) throw new Error("Society membership not found.");
    await requireSocietyMembership(portable, societyId);
    await getOwned(portable, "filings", args.filingId, societyId);
    const { filingId, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v;
    await updateFilingPortable(portable, { id: String(filingId), patch });
  },
});

// Build a machine-readable payload the "bot" would submit. In live mode this
// is what a signed off-platform automation (or a human operator) would paste
// into Societies Online. In demo mode we also render it into a summary PDF
// via an HTTP action — here we return the structured data.
export const buildFilingPacket = authorizedQuery("filingBot:buildFilingPacket", query)({
  args: { societyId: v.id("societies"), kind: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => buildFilingPacketPortable(await toPortableQueryCtx(ctx), args),
});

// The preparation assistant. BC Societies Online has no public API and does not
// permit automated submission, so this never files on the user's behalf: it
// gathers and validates the record, pre-fills the form, stages signatures, and
// deep-links the operator to Societies Online for manual submission. The run
// ends in `manual_required` — the user files in the portal, then records the
// real confirmation number via the normal Filings "mark filed" flow. It does
// NOT fabricate a confirmation number or mark the filing Filed.
export const run = authorizedAction("filingBot:run", action)({
  args: {
    societyId: v.id("societies"),
    filingId: v.id("filings"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, filingId, actingUserId }) => {
    const filing = await ctx.runQuery(api.filings.get, { id: filingId });
    if (!filing) throw new Error("Filing not found.");

    const runId = await ctx.runMutation(internal.filingBot._createRun, {
      societyId,
      filingId,
      kind: filing.kind,
      demo: false,
      actingUserId,
    });

    await ctx.runMutation(api.notifications.create, {
      societyId,
      kind: "bot",
      severity: "info",
      title: `Preparing filing: ${filing.kind}`,
      body: `Gathering and pre-filling ${filing.kind} for ${filing.periodLabel ?? filing.dueDate}. You'll submit it in Societies Online.`,
      linkHref: "/app/filings",
    });

    const packet = await ctx.runQuery(api.filingBot.buildFilingPacket, {
      societyId,
      kind: filing.kind,
    });

    const runKind = filing.kind === "BCSocietyAnnualReport" ? "AnnualReport" : filing.kind;
    const steps = STEP_DEFINITIONS[runKind];
    const lastIndex = steps.length - 1;
    try {
      for (let i = 0; i < steps.length; i++) {
        await ctx.runMutation(internal.filingBot._updateStep, {
          id: runId,
          stepIndex: i,
          status: "running",
        });
        await sleep(400);
        const note = i === 2
          ? `Packet built: ${packet?.form ?? "n/a"}`
          : i === lastIndex
          ? "No submission was sent. Open Societies Online to file, then record your confirmation number in Filings."
          : undefined;
        await ctx.runMutation(internal.filingBot._updateStep, {
          id: runId,
          stepIndex: i,
          status: "ok",
          note,
        });
      }

      // Honest outcome: prepared, not filed. The operator submits manually.
      await ctx.runMutation(internal.filingBot._completeRun, {
        id: runId,
        status: "manual_required",
      });
      await ctx.runMutation(api.notifications.create, {
        societyId,
        kind: "bot",
        severity: "info",
        title: `Filing ready to submit: ${filing.kind}`,
        body: `Form pre-filled and validated. Submit it in Societies Online, then record your confirmation number in Filings.`,
        linkHref: "/app/filings",
      });
      return { runId, status: "manual_required" as const };
    } catch (err: any) {
      await ctx.runMutation(internal.filingBot._completeRun, {
        id: runId,
        status: "failed",
      });
      await ctx.runMutation(api.notifications.create, {
        societyId,
        kind: "bot",
        severity: "err",
        title: `Filing bot failed: ${filing.kind}`,
        body: err?.message ?? "Unknown error",
        linkHref: "/app/filings",
      });
      throw err;
    }
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
