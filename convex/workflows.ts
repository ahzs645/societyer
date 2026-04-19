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

type WorkflowProvider = "internal" | "n8n";

type RecipeStep = {
  key: string;
  label: string;
  note?: string;
};

type NodePreview = {
  key: string;
  type:
    | "manual_trigger"
    | "form"
    | "pdf_fill"
    | "document_create"
    | "email"
    | "external_n8n";
  label: string;
  description?: string;
  status?: "draft" | "ready" | "needs_setup";
};

type RecipeKey =
  | "agm_prep"
  | "insurance_renewal"
  | "annual_report_filing"
  | "unbc_affiliate_id_request";

const UNBC_AFFILIATE_FIELDS = [
  "Legal First Name of Affiliate",
  "Legal Middle Name of Affiliate",
  "Legal Last Name of Affiliate",
  "Current Mailing Address",
  "Emergency Contact(Name and Ph)",
  "UNBC ID #",
  "Birthdate of Affiliate (MM/DD/YYYY)",
  "Personal email address",
  "Name of requesting Manager",
  "UNBC Department/Organization",
  "Length of Affiliate status(lf known)",
  "ManagerPhone",
  "Manager Email",
  "Authorizing Name (if different from Manager)",
  "Date signed",
  "Check Box0",
  "Check Box1",
];

const RECIPE_LABELS: Record<RecipeKey, string> = {
  agm_prep: "AGM prep",
  insurance_renewal: "Insurance renewal reminder",
  annual_report_filing: "Annual report filing",
  unbc_affiliate_id_request: "UNBC Affiliate ID Request",
};

const RECIPE_DESCRIPTIONS: Record<RecipeKey, string> = {
  agm_prep:
    "T-minus reminders before an AGM — draft agenda, queue notice-of-meeting, confirm quorum threshold.",
  insurance_renewal:
    "Watches insurancePolicies.renewalDate and pings the board 60/30/7 days before each policy lapses.",
  annual_report_filing:
    "When the annual-report filing is due, runs the Societies Online filing bot and records the confirmation.",
  unbc_affiliate_id_request:
    "Collects affiliate intake, hands execution to n8n, fills the UNBC PDF, and saves the generated document.",
};

const RECIPE_PROVIDERS: Record<RecipeKey, WorkflowProvider> = {
  agm_prep: "internal",
  insurance_renewal: "internal",
  annual_report_filing: "internal",
  unbc_affiliate_id_request: "n8n",
};

const RECIPE_STEPS: Record<RecipeKey, RecipeStep[]> = {
  agm_prep: [
    { key: "collect_rosters", label: "Collect active members and director roster" },
    { key: "draft_agenda", label: "Draft agenda from bylaw-required items" },
    { key: "queue_notice", label: "Queue notice-of-meeting communication" },
    { key: "confirm_quorum", label: "Confirm quorum threshold and proxy window" },
    { key: "chair_reminder", label: "Open dashboard reminder for the chair" },
  ],
  insurance_renewal: [
    { key: "scan_policies", label: "Scan insurance policies nearing renewal" },
    { key: "compare_coverage", label: "Compare coverage to funder requirements" },
    { key: "notify_board", label: "Notify responsible director + treasurer" },
    { key: "open_task", label: "Open a renewal task with broker contact" },
  ],
  annual_report_filing: [
    { key: "locate_filing", label: "Locate the open AnnualReport filing" },
    { key: "run_bot", label: "Hand off to the Societies Online filing bot" },
    { key: "record_confirmation", label: "Record confirmation number on the filing" },
  ],
  unbc_affiliate_id_request: [
    { key: "manual", label: "Launch manually" },
    { key: "intake", label: "Affiliate intake form" },
    { key: "fill_pdf", label: "Fill UNBC ID PDF" },
    { key: "save_document", label: "Save generated PDF" },
    { key: "notify", label: "Notify/request manager review" },
  ],
};

const RECIPE_NODE_PREVIEWS: Partial<Record<RecipeKey, NodePreview[]>> = {
  unbc_affiliate_id_request: [
    {
      key: "manual",
      type: "manual_trigger",
      label: "Launch manually",
      description: "A Societyer user starts the affiliate request.",
      status: "ready",
    },
    {
      key: "intake",
      type: "form",
      label: "Affiliate intake form",
      description: "Collects the fields that map to the UNBC AcroForm widgets.",
      status: "ready",
    },
    {
      key: "fill_pdf",
      type: "pdf_fill",
      label: "Fill UNBC ID PDF",
      description: "n8n calls Societyer's PDF fill endpoint using the configured local template path.",
      status: "needs_setup",
    },
    {
      key: "save_document",
      type: "document_create",
      label: "Save generated PDF",
      description: "Stores the generated affiliate request as a Societyer document.",
      status: "ready",
    },
    {
      key: "notify",
      type: "email",
      label: "Notify manager",
      description: "Marks the workflow complete and leaves room for a real email/signature step later.",
      status: "draft",
    },
  ],
};

const UNBC_SAMPLE_AFFILIATE = {
  "Legal First Name of Affiliate": "Sample",
  "Legal Middle Name of Affiliate": "A",
  "Legal Last Name of Affiliate": "Affiliate",
  "Current Mailing Address": "3333 University Way, Prince George, BC V2N 4Z9",
  "Emergency Contact(Name and Ph)": "Sample Contact 250 555 0100",
  "UNBC ID #": "000000000",
  "Birthdate of Affiliate (MM/DD/YYYY)": "01/01/1990",
  "Personal email address": "sample.affiliate@example.com",
  "Name of requesting Manager": "Sample Manager",
  "UNBC Department/Organization": "Sample Department",
  "Length of Affiliate status(lf known)": "1 year",
  ManagerPhone: "250-555-0101",
  "Manager Email": "manager@example.com",
  "Authorizing Name (if different from Manager)": "",
  "Date signed": "2026-04-18",
  "Check Box0": true,
  "Check Box1": false,
};

export const RECIPE_CATALOG = (Object.keys(RECIPE_STEPS) as RecipeKey[]).map(
  (key) => ({
    key,
    label: RECIPE_LABELS[key],
    description: RECIPE_DESCRIPTIONS[key],
    provider: RECIPE_PROVIDERS[key],
    steps: RECIPE_STEPS[key].map((s) => s.label),
    nodePreview: nodePreviewForRecipe(key),
    config: configForRecipe(key),
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

export const get = query({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

// ---- mutations ---------------------------------------------------------

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    recipe: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerConfig: v.optional(
      v.object({
        externalWorkflowId: v.optional(v.string()),
        externalWebhookUrl: v.optional(v.string()),
        externalEditUrl: v.optional(v.string()),
      }),
    ),
    nodePreview: v.optional(v.any()),
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

    const recipe = args.recipe as RecipeKey;
    const provider = (args.provider ?? RECIPE_PROVIDERS[recipe] ?? "internal") as WorkflowProvider;
    const providerConfig =
      provider === "n8n"
        ? { ...providerConfigForRecipe(recipe), ...(args.providerConfig ?? {}) }
        : args.providerConfig;

    return await ctx.db.insert("workflows", {
      societyId: args.societyId,
      recipe: args.recipe,
      name: args.name,
      status: args.status ?? "active",
      provider,
      providerConfig,
      nodePreview: args.nodePreview ?? nodePreviewForRecipe(recipe),
      trigger: args.trigger,
      config: { ...configForRecipe(recipe), ...(args.config ?? {}) },
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

export const updateProviderLink = mutation({
  args: {
    id: v.id("workflows"),
    provider: v.optional(v.string()),
    providerConfig: v.object({
      externalWorkflowId: v.optional(v.string()),
      externalWebhookUrl: v.optional(v.string()),
      externalEditUrl: v.optional(v.string()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, provider, providerConfig, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, {
      provider: provider ?? wf.provider ?? "n8n",
      providerConfig,
    });
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

export const receiveExternalCallback = mutation({
  args: {
    workflowId: v.id("workflows"),
    runId: v.id("workflowRuns"),
    externalRunId: v.optional(v.string()),
    event: v.string(),
    stepKey: v.optional(v.string()),
    note: v.optional(v.string()),
    output: v.optional(v.any()),
    generatedDocument: v.optional(
      v.object({
        documentId: v.id("documents"),
        versionId: v.id("documentVersions"),
        fileName: v.string(),
        storageKey: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workflowId !== args.workflowId) {
      throw new Error("Workflow run not found.");
    }

    const now = new Date().toISOString();
    let steps = run.steps ?? [];
    if (args.event === "document.created" && args.generatedDocument) {
      steps = steps.map((step) => {
        if (step.key === "fill_pdf") {
          return { ...step, status: "ok", atISO: now, note: "n8n returned a filled PDF." };
        }
        if (step.key === "save_document") {
          return { ...step, status: "ok", atISO: now, note: args.note ?? "Generated PDF saved to Societyer Documents." };
        }
        return step;
      });
    } else if (args.stepKey) {
      const status =
        args.event === "step.started"
          ? "running"
          : args.event === "step.failed"
          ? "fail"
          : "ok";
      steps = steps.map((step) =>
        step.key === args.stepKey
          ? { ...step, status, atISO: now, note: args.note ?? step.note }
          : step,
      );
    }

    const output = {
      ...(run.output ?? {}),
      ...(args.output ?? {}),
      ...(args.generatedDocument ? { generatedDocument: args.generatedDocument } : {}),
    };

    const patch: any = {
      steps,
      output,
      externalRunId: args.externalRunId ?? run.externalRunId,
      externalStatus: args.event,
    };

    if (args.generatedDocument) {
      patch.generatedDocumentId = args.generatedDocument.documentId;
      patch.generatedDocumentVersionId = args.generatedDocument.versionId;
    }

    if (args.event === "run.completed") {
      patch.status = "success";
      patch.completedAtISO = now;
    } else if (args.event === "run.failed" || args.event === "step.failed") {
      patch.status = "failed";
      patch.completedAtISO = now;
    } else if (run.status === "queued") {
      patch.status = "running";
    }

    await ctx.db.patch(args.runId, patch);
  },
});

export const recordGeneratedDocument = mutation({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    runId: v.id("workflowRuns"),
    storageKey: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    fileSizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workflowId !== args.workflowId || run.societyId !== args.societyId) {
      throw new Error("Workflow run not found.");
    }

    const title = args.fileName.replace(/\.pdf$/i, "");
    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title,
      category: "WorkflowGenerated",
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      retentionYears: 10,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      tags: ["workflow-generated", "unbc-affiliate-id", `workflow-run:${args.runId}`],
    });

    const versionId = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId,
      version: 1,
      storageProvider: "local",
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      uploadedAtISO: new Date().toISOString(),
      uploadedByName: "n8n workflow",
      changeNote: "Generated by UNBC Affiliate ID Request workflow.",
      isCurrent: true,
    });

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "n8n workflow",
      entityType: "document",
      entityId: documentId,
      action: "workflow-generated",
      summary: `Generated ${args.fileName} from workflow run ${args.runId}.`,
      createdAtISO: new Date().toISOString(),
    });

    return { documentId, versionId };
  },
});

export const _createRun = internalMutation({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    recipe: v.string(),
    provider: v.optional(v.string()),
    nodePreview: v.optional(v.any()),
    demo: v.boolean(),
    triggeredBy: v.string(),
    triggeredByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const steps = stepsForRun(args.recipe, args.nodePreview);
    return await ctx.db.insert("workflowRuns", {
      societyId: args.societyId,
      workflowId: args.workflowId,
      recipe: args.recipe,
      status: "queued",
      startedAtISO: new Date().toISOString(),
      steps,
      provider: args.provider ?? "internal",
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

export const _markExternalQueued = internalMutation({
  args: {
    id: v.id("workflowRuns"),
    externalRunId: v.optional(v.string()),
    externalStatus: v.optional(v.string()),
    output: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run) return;
    await ctx.db.patch(args.id, {
      status: "running",
      externalRunId: args.externalRunId,
      externalStatus: args.externalStatus ?? "queued",
      output: { ...(run.output ?? {}), ...(args.output ?? {}) },
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
    input: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const wf: any = await ctx.runQuery(api.workflows.get, {
      id: args.workflowId,
    });
    if (!wf) throw new Error("Workflow not found");
    if (wf.societyId !== args.societyId) throw new Error("Workflow does not belong to this society.");
    if (wf.status !== "active") throw new Error(`Workflow is ${wf.status}; activate it before running.`);

    const provider = (wf.provider ?? "internal") as WorkflowProvider;
    const runId = await ctx.runMutation(internal.workflows._createRun, {
      societyId: args.societyId,
      workflowId: args.workflowId,
      recipe: wf.recipe,
      provider,
      nodePreview: wf.nodePreview,
      demo: provider === "internal",
      triggeredBy: args.triggeredBy ?? "manual",
      triggeredByUserId: args.actingUserId,
    });

    if (provider === "n8n") {
      return await runExternalWorkflow(ctx, wf, runId, args);
    }

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
      return { runId, status: "success" };
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

async function runExternalWorkflow(ctx: any, wf: any, runId: any, args: any) {
  const webhookUrl = wf.providerConfig?.externalWebhookUrl;
  const callbackSecret = env("SOCIETYER_WORKFLOW_CALLBACK_SECRET");
  const callbackUrl =
    env("SOCIETYER_WORKFLOW_CALLBACK_URL") ??
    "http://host.docker.internal:8787/api/v1/workflow-callbacks/n8n";
  const pdfFillUrl =
    env("SOCIETYER_WORKFLOW_PDF_FILL_URL") ??
    "http://host.docker.internal:8787/api/v1/workflow-pdf/unbc-affiliate-id/fill";

  try {
    if (!webhookUrl) {
      throw new Error("n8n webhook URL is missing. Set N8N_WEBHOOK_BASE_URL or add providerConfig.externalWebhookUrl.");
    }
    if (!callbackSecret) {
      throw new Error("SOCIETYER_WORKFLOW_CALLBACK_SECRET is missing.");
    }

    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 0,
      status: "ok",
      note: "Manual launch accepted by Societyer.",
    });
    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 1,
      status: "ok",
      note: "Affiliate intake payload prepared for n8n.",
    });
    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 2,
      status: "running",
      note: "Waiting for n8n PDF fill step.",
    });

    const payload = {
      workflowId: args.workflowId,
      runId,
      societyId: args.societyId,
      recipe: wf.recipe,
      callbackUrl,
      callbackSecret,
      pdfFillUrl,
      input: {
        affiliate: normalizeAffiliateInput(args.input?.affiliate ?? args.input),
        pdfTemplateKey: "unbc_affiliate_id",
      },
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`n8n webhook returned ${response.status}: ${text.slice(0, 240)}`);
    }
    const responseJson = safeJson(text);
    const externalRunId =
      responseJson?.executionId ??
      responseJson?.id ??
      responseJson?.data?.executionId ??
      undefined;

    await ctx.runMutation(internal.workflows._markExternalQueued, {
      id: runId,
      externalRunId,
      externalStatus: "webhook.accepted",
      output: {
        n8n: {
          webhookUrl,
          response: responseJson ?? text.slice(0, 400),
        },
      },
    });
    await ctx.runMutation(internal.workflows._touchSchedule, {
      id: args.workflowId,
    });
    await ctx.runMutation(api.notifications.create, {
      societyId: args.societyId,
      kind: "bot",
      severity: "info",
      title: `Workflow queued in n8n: ${wf.name}`,
      body: "Societyer is waiting for n8n callbacks to update the run timeline.",
      linkHref: "/app/workflow-runs",
    });
    return { runId, status: "running", externalRunId };
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
}

// Step handlers. In demo mode these just annotate the step; in live mode
// they chain into real mutations. Additive: adding a recipe means adding
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

function nodePreviewForRecipe(recipe: RecipeKey) {
  return (
    RECIPE_NODE_PREVIEWS[recipe] ??
    RECIPE_STEPS[recipe].map((step, index) => ({
      key: step.key,
      type: index === 0 ? "manual_trigger" : "external_n8n",
      label: step.label,
      status: "ready",
    }))
  );
}

function configForRecipe(recipe: RecipeKey) {
  if (recipe !== "unbc_affiliate_id_request") return {};
  return {
    pdfTemplateKey: "unbc_affiliate_id",
    pdfFields: UNBC_AFFILIATE_FIELDS,
    sampleAffiliate: UNBC_SAMPLE_AFFILIATE,
  };
}

function providerConfigForRecipe(recipe: RecipeKey) {
  if (recipe !== "unbc_affiliate_id_request") return undefined;
  const base = env("N8N_WEBHOOK_BASE_URL") ?? "http://127.0.0.1:5678/webhook";
  const webhookPath =
    env("N8N_UNBC_AFFILIATE_WEBHOOK_PATH") ??
    "societyer-unbc-affiliate-id/societyer%2520webhook/societyer/unbc-affiliate-id";
  const externalEditUrl = env("N8N_BASE_URL")
    ? `${env("N8N_BASE_URL")}/workflow`
    : "http://127.0.0.1:5678/workflow";
  return {
    externalWorkflowId: "societyer-unbc-affiliate-id",
    externalWebhookUrl: `${base.replace(/\/$/, "")}/${webhookPath}`,
    externalEditUrl,
  };
}

function stepsForRun(recipe: string, nodePreview?: NodePreview[]) {
  const previewSteps = Array.isArray(nodePreview) && nodePreview.length > 0
    ? nodePreview
    : nodePreviewForRecipe(recipe as RecipeKey);
  return previewSteps.map((node) => ({
    key: node.key,
    label: node.label,
    status: "pending",
    note: node.description,
  }));
}

function normalizeAffiliateInput(input: any) {
  const source = typeof input === "object" && input ? input : {};
  return {
    ...UNBC_SAMPLE_AFFILIATE,
    ...source,
    "Check Box0": Boolean(source["Check Box0"] ?? source.previousUnbcIdYes ?? UNBC_SAMPLE_AFFILIATE["Check Box0"]),
    "Check Box1": Boolean(source["Check Box1"] ?? source.previousUnbcIdNo ?? UNBC_SAMPLE_AFFILIATE["Check Box1"]),
  };
}

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function env(name: string) {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
