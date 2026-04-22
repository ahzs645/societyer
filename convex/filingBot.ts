// @ts-nocheck
import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";

const STEP_DEFINITIONS: Record<string, { label: string; note?: string }[]> = {
  AnnualReport: [
    { label: "Gather current directors, registered address, purposes" },
    { label: "Validate BC-resident requirement and director consents" },
    { label: "Pre-fill BC Societies Online Form 11 (annual report)" },
    { label: "Queue signature from authorized signatory" },
    { label: "Open Societies Online and submit Form 11" },
    { label: "Capture confirmation number and save receipt PDF" },
  ],
  BylawAmendment: [
    { label: "Collect bylaw text (marked-up and clean)" },
    { label: "Reference special resolution minute" },
    { label: "Pre-fill bylaw amendment filing" },
    { label: "Submit via Societies Online" },
    { label: "Capture confirmation number" },
  ],
  ChangeOfDirectors: [
    { label: "Diff director register vs last filed state" },
    { label: "Pre-fill change-of-directors form" },
    { label: "Submit filing" },
    { label: "Capture confirmation number" },
  ],
};

export const listRuns = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("filingBotRuns")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 20),
});

export const runsForFiling = query({
  args: { filingId: v.id("filings") },
  returns: v.any(),
  handler: async (ctx, { filingId }) =>
    ctx.db
      .query("filingBotRuns")
      .withIndex("by_filing", (q) => q.eq("filingId", filingId))
      .order("desc")
      .collect(),
});

export const getRun = query({
  args: { id: v.id("filingBotRuns") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
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
    const steps = (STEP_DEFINITIONS[args.kind] ?? []).map((s) => ({
      label: s.label,
      status: "pending",
      note: s.note,
    }));
    return await ctx.db.insert("filingBotRuns", {
      societyId: args.societyId,
      filingId: args.filingId,
      kind: args.kind,
      status: "queued",
      startedAtISO: new Date().toISOString(),
      steps,
      demo: args.demo,
      triggeredByUserId: args.actingUserId,
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
    const run = await ctx.db.get(id);
    if (!run) return;
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
    const { filingId, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v;
    await ctx.db.patch(filingId, patch);
  },
});

// Build a machine-readable payload the "bot" would submit. In live mode this
// is what a signed off-platform automation (or a human operator) would paste
// into Societies Online. In demo mode we also render it into a summary PDF
// via an HTTP action — here we return the structured data.
export const buildFilingPacket = query({
  args: { societyId: v.id("societies"), kind: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, kind }) => {
    const [society, directors, members, minutes, meetings] = await Promise.all([
      ctx.db.get(societyId),
      ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    if (!society) return null;
    const activeDirectors = directors.filter((d) => d.status === "Active");
    const lastAgm = meetings
      .filter((m) => m.type === "AGM" && m.status === "Held")
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
    const lastAgmMinutes = lastAgm
      ? minutes.find((mn) => mn.meetingId === lastAgm._id)
      : undefined;

    if (kind === "AnnualReport") {
      return {
        form: "BC-Societies-Form-11",
        society: {
          name: society.name,
          incorporationNumber: society.incorporationNumber,
          incorporationDate: society.incorporationDate,
          registeredOfficeAddress: society.registeredOfficeAddress,
          mailingAddress: society.mailingAddress,
        },
        agmDate: lastAgm?.scheduledAt?.slice(0, 10),
        directors: activeDirectors.map((d) => ({
          name: `${d.firstName} ${d.lastName}`,
          position: d.position,
          bcResident: d.isBCResident,
          consentOnFile: d.consentOnFile,
          termStart: d.termStart,
        })),
        signatories: activeDirectors.slice(0, 2).map((d) => ({
          name: `${d.firstName} ${d.lastName}`,
          position: d.position,
        })),
        votingMembers: members.filter((m) => m.votingRights && m.status === "Active").length,
      };
    }
    if (kind === "BylawAmendment") {
      const specialResolutions = lastAgmMinutes?.motions.filter((m) =>
        /special resolution|bylaw/i.test(m.text),
      ) ?? [];
      return {
        form: "BC-Societies-BylawAmendment",
        society: { name: society.name, incorporationNumber: society.incorporationNumber },
        approvedAt: lastAgm?.scheduledAt?.slice(0, 10),
        specialResolutions,
      };
    }
    if (kind === "ChangeOfDirectors") {
      return {
        form: "BC-Societies-ChangeOfDirectors",
        society: { name: society.name, incorporationNumber: society.incorporationNumber },
        directors: activeDirectors.map((d) => ({
          name: `${d.firstName} ${d.lastName}`,
          position: d.position,
          bcResident: d.isBCResident,
          termStart: d.termStart,
          termEnd: d.termEnd,
        })),
      };
    }
    return { form: "unknown" };
  },
});

// The bot itself. In demo mode it walks the steps deterministically with
// short sleeps so the UI animates. In live mode you'd replace each step with
// real work — PDF generation, e-sign collection, a headless browser hop, etc.
export const run = action({
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
      demo: true,
      actingUserId,
    });

    await ctx.runMutation(api.notifications.create, {
      societyId,
      kind: "bot",
      severity: "info",
      title: `Filing bot started: ${filing.kind}`,
      body: `Auto-preparing ${filing.kind} for ${filing.periodLabel ?? filing.dueDate}.`,
      linkHref: "/filings",
    });

    const packet = await ctx.runQuery(api.filingBot.buildFilingPacket, {
      societyId,
      kind: filing.kind,
    });

    const steps = STEP_DEFINITIONS[filing.kind] ?? [];
    try {
      for (let i = 0; i < steps.length; i++) {
        await ctx.runMutation(internal.filingBot._updateStep, {
          id: runId,
          stepIndex: i,
          status: "running",
        });
        await sleep(600);
        const note = i === 2
          ? `Packet built: ${packet?.form ?? "n/a"}`
          : i === 4
          ? "Opened https://www.bcregistry.ca/societies — filled Form 11"
          : undefined;
        await ctx.runMutation(internal.filingBot._updateStep, {
          id: runId,
          stepIndex: i,
          status: "ok",
          note,
        });
      }

      const confirmationNumber = `BC-${filing.kind.slice(0, 2).toUpperCase()}-${Math.floor(Math.random() * 900_000 + 100_000)}`;
      await ctx.runMutation(internal.filingBot._completeRun, {
        id: runId,
        status: "success",
        confirmationNumber,
      });
      await ctx.runMutation(internal.filingBot._patchFiling, {
        filingId,
        filedAt: new Date().toISOString().slice(0, 10),
        confirmationNumber,
        status: "Filed",
      });
      await ctx.runMutation(api.notifications.create, {
        societyId,
        kind: "bot",
        severity: "success",
        title: `Filed: ${filing.kind}`,
        body: `Confirmation ${confirmationNumber}. Receipt saved to Filings.`,
        linkHref: "/filings",
      });
      return { runId, confirmationNumber };
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
        linkHref: "/filings",
      });
      throw err;
    }
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
