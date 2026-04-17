// @ts-nocheck
import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireRole } from "./users";

// Catalog of recipes. Each entry is a templated automation with pre-defined
// steps. The runner walks the steps, calling the recipe's handler at each
// index; handlers reuse existing mutations (notifications, filings) rather
// than introducing a generic action DSL.
type RecipeStep = { label: string; note?: string };
type RecipeKey =
  | "agm_prep"
  | "insurance_renewal"
  | "annual_report_filing";

const RECIPE_LABELS: Record<RecipeKey, string> = {
  agm_prep: "AGM prep",
  insurance_renewal: "Insurance renewal reminder",
  annual_report_filing: "Annual report filing",
};

const RECIPE_DESCRIPTIONS: Record<RecipeKey, string> = {
  agm_prep:
    "T-minus reminders before an AGM — draft agenda, queue notice-of-meeting, confirm quorum threshold.",
  insurance_renewal:
    "Watches insurancePolicies.renewalDate and pings the board 60/30/7 days before each policy lapses.",
  annual_report_filing:
    "When the annual-report filing is due, runs the Societies Online filing bot and records the confirmation.",
};

const RECIPE_STEPS: Record<RecipeKey, RecipeStep[]> = {
  agm_prep: [
    { label: "Collect active members and director roster" },
    { label: "Draft agenda from bylaw-required items" },
    { label: "Queue notice-of-meeting communication" },
    { label: "Confirm quorum threshold and proxy window" },
    { label: "Open dashboard reminder for the chair" },
  ],
  insurance_renewal: [
    { label: "Scan insurance policies nearing renewal" },
    { label: "Compare coverage to funder requirements" },
    { label: "Notify responsible director + treasurer" },
    { label: "Open a renewal task with broker contact" },
  ],
  annual_report_filing: [
    { label: "Locate the open AnnualReport filing" },
    { label: "Hand off to the Societies Online filing bot" },
    { label: "Record confirmation number on the filing" },
  ],
};

export const RECIPE_CATALOG = (Object.keys(RECIPE_STEPS) as RecipeKey[]).map(
  (key) => ({
    key,
    label: RECIPE_LABELS[key],
    description: RECIPE_DESCRIPTIONS[key],
    steps: RECIPE_STEPS[key].map((s) => s.label),
  }),
);

// ---- queries -----------------------------------------------------------

export const listCatalog = query({
  args: {},
  handler: async () => RECIPE_CATALOG,
});

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("workflows")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const listRuns = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("workflowRuns")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 50),
});

export const runsForWorkflow = query({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) =>
    ctx.db
      .query("workflowRuns")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .order("desc")
      .collect(),
});

export const getRun = query({
  args: { id: v.id("workflowRuns") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

// ---- mutations ---------------------------------------------------------

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    recipe: v.string(),
    name: v.string(),
    trigger: v.object({
      kind: v.string(),
      cron: v.optional(v.string()),
      offset: v.optional(
        v.object({
          anchor: v.string(),
          anchorId: v.optional(v.string()),
          daysBefore: v.number(),
        }),
      ),
    }),
    config: v.optional(v.any()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    if (!(args.recipe in RECIPE_STEPS)) {
      throw new Error(`Unknown recipe: ${args.recipe}`);
    }
    return await ctx.db.insert("workflows", {
      societyId: args.societyId,
      recipe: args.recipe,
      name: args.name,
      status: "active",
      trigger: args.trigger,
      config: args.config,
      nextRunAtISO: computeNextRunAt(args.trigger),
      createdByUserId: args.actingUserId,
    });
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("workflows"),
    status: v.string(), // active | paused | archived
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, status, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, { status });
  },
});

export const remove = mutation({
  args: { id: v.id("workflows"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.delete(id);
  },
});

export const _createRun = internalMutation({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    recipe: v.string(),
    demo: v.boolean(),
    triggeredBy: v.string(),
    triggeredByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const steps = (RECIPE_STEPS[args.recipe as RecipeKey] ?? []).map((s) => ({
      label: s.label,
      status: "pending",
      note: s.note,
    }));
    return await ctx.db.insert("workflowRuns", {
      societyId: args.societyId,
      workflowId: args.workflowId,
      recipe: args.recipe,
      status: "queued",
      startedAtISO: new Date().toISOString(),
      steps,
      demo: args.demo,
      triggeredBy: args.triggeredBy,
      triggeredByUserId: args.triggeredByUserId,
    });
  },
});

export const _updateStep = internalMutation({
  args: {
    id: v.id("workflowRuns"),
    stepIndex: v.number(),
    status: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, stepIndex, status, note }) => {
    const run = await ctx.db.get(id);
    if (!run) return;
    const steps = run.steps.map((s, i) =>
      i === stepIndex
        ? { ...s, status, atISO: new Date().toISOString(), note: note ?? s.note }
        : s,
    );
    await ctx.db.patch(id, {
      steps,
      status: status === "running" && run.status === "queued" ? "running" : run.status,
    });
  },
});

export const _completeRun = internalMutation({
  args: {
    id: v.id("workflowRuns"),
    status: v.string(),
    output: v.optional(v.any()),
  },
  handler: async (ctx, { id, status, output }) => {
    await ctx.db.patch(id, {
      status,
      completedAtISO: new Date().toISOString(),
      output,
    });
  },
});

export const _touchSchedule = internalMutation({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return;
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      lastRunAtISO: now,
      nextRunAtISO: computeNextRunAt(wf.trigger, new Date()),
    });
  },
});

// ---- triggers / scheduler ---------------------------------------------

function computeNextRunAt(
  trigger: { kind: string; cron?: string; offset?: { daysBefore: number } },
  from: Date = new Date(),
): string | undefined {
  // v1: rough-cut scheduling. Cron expressions are stored for display but
  // we advance by 24h per tick — the scanner is the source of truth.
  if (trigger.kind === "manual") return undefined;
  if (trigger.kind === "cron") {
    const next = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    return next.toISOString();
  }
  if (trigger.kind === "date_offset") {
    const next = new Date(from.getTime() + 60 * 60 * 1000);
    return next.toISOString();
  }
  return undefined;
}

export const scan = internalAction({
  args: {},
  handler: async (ctx) => {
    const dueBefore = new Date().toISOString();
    const candidates: any[] = await ctx.runQuery(internal.workflows._listDue, {
      dueBefore,
    });
    for (const wf of candidates) {
      await ctx.runAction(api.workflows.run, {
        societyId: wf.societyId,
        workflowId: wf._id,
        triggeredBy: "cron",
      });
    }
  },
});

export const _listDue = query({
  args: { dueBefore: v.string() },
  handler: async (ctx, { dueBefore }) => {
    // No cross-society index on status — scan by next_run and filter.
    const rows = await ctx.db
      .query("workflows")
      .withIndex("by_next_run")
      .collect();
    return rows.filter(
      (w) =>
        w.status === "active" &&
        typeof w.nextRunAtISO === "string" &&
        w.nextRunAtISO <= dueBefore,
    );
  },
});

// ---- the runner --------------------------------------------------------

export const run = action({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    triggeredBy: v.optional(v.string()), // cron | manual | event
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const wf: any = await ctx.runQuery(api.workflows.get, {
      id: args.workflowId,
    });
    if (!wf) throw new Error("Workflow not found");

    const runId = await ctx.runMutation(internal.workflows._createRun, {
      societyId: args.societyId,
      workflowId: args.workflowId,
      recipe: wf.recipe,
      demo: true,
      triggeredBy: args.triggeredBy ?? "manual",
      triggeredByUserId: args.actingUserId,
    });

    const steps = RECIPE_STEPS[wf.recipe as RecipeKey] ?? [];
    try {
      for (let i = 0; i < steps.length; i++) {
        await ctx.runMutation(internal.workflows._updateStep, {
          id: runId,
          stepIndex: i,
          status: "running",
        });
        await sleep(400);
        const note = await handleStep(ctx, wf, i);
        await ctx.runMutation(internal.workflows._updateStep, {
          id: runId,
          stepIndex: i,
          status: "ok",
          note,
        });
      }

      await ctx.runMutation(internal.workflows._completeRun, {
        id: runId,
        status: "success",
      });
      await ctx.runMutation(internal.workflows._touchSchedule, {
        id: args.workflowId,
      });
      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        kind: "bot",
        severity: "success",
        title: `Workflow finished: ${wf.name}`,
        body: `Recipe ${RECIPE_LABELS[wf.recipe as RecipeKey] ?? wf.recipe} completed ${steps.length} steps.`,
        linkHref: "/app/workflow-runs",
      });
      return { runId };
    } catch (err: any) {
      await ctx.runMutation(internal.workflows._completeRun, {
        id: runId,
        status: "failed",
        output: { error: err?.message ?? "unknown" },
      });
      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        kind: "bot",
        severity: "err",
        title: `Workflow failed: ${wf.name}`,
        body: err?.message ?? "Unknown error",
        linkHref: "/app/workflow-runs",
      });
      throw err;
    }
  },
});

export const get = query({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

// Step handlers. In demo mode these just annotate the step; in live mode
// they'd chain into real mutations. Additive: adding a recipe means adding
// a case here, not a new action type.
async function handleStep(ctx: any, wf: any, stepIndex: number): Promise<string | undefined> {
  if (wf.recipe === "insurance_renewal" && stepIndex === 0) {
    const policies = await ctx.runQuery(api.insurance.list, {
      societyId: wf.societyId,
    });
    const soon = (policies ?? []).filter((p: any) => {
      if (!p.renewalDate) return false;
      const days = (new Date(p.renewalDate).getTime() - Date.now()) / 86_400_000;
      return days >= 0 && days <= 60;
    });
    return soon.length
      ? `${soon.length} policy/policies renewing within 60 days`
      : "No policies renewing in the next 60 days";
  }
  if (wf.recipe === "agm_prep" && stepIndex === 2) {
    return "Would dispatch notice via Communications (demo: skipped send).";
  }
  if (wf.recipe === "annual_report_filing" && stepIndex === 1) {
    return "Would invoke filingBot.run for the open AnnualReport filing.";
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
