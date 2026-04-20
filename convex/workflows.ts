// @ts-nocheck
import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
  internalAction,
  internalQuery,
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
  config?: Record<string, any>;
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

// Node types the "Add Node" picker offers, and what each type is called in
// the UI. Keep the label in sync with `nodeTypeLabel` on the frontend.
export const NODE_TYPE_CATALOG: Array<{
  type: NodePreview["type"];
  label: string;
  description: string;
}> = [
  { type: "manual_trigger", label: "Manual trigger", description: "A person starts the workflow from Societyer." },
  { type: "form", label: "Form", description: "Collects structured input before handing off." },
  { type: "pdf_fill", label: "Fill PDF", description: "Hands a template + payload to the PDF fill endpoint." },
  { type: "document_create", label: "Save document", description: "Stores the generated file in Documents." },
  { type: "email", label: "Send notification", description: "Sends an email / in-app notification." },
  { type: "external_n8n", label: "External n8n step", description: "Delegates work to an n8n workflow node." },
];

type SetupCheck = { ok: boolean; message?: string };

function checkNodeSetup(
  node: NodePreview,
  providerConfig: { externalWebhookUrl?: string } | undefined,
): SetupCheck[] {
  const checks: SetupCheck[] = [];
  const cfg: Record<string, any> = node.config ?? {};

  if (node.type === "pdf_fill") {
    const hasTemplate = Boolean(cfg.templateDocumentId);
    checks.push({
      ok: hasTemplate,
      message: hasTemplate ? undefined : "Pick a fillable PDF template from Documents.",
    });
    const fields: string[] = Array.isArray(cfg.fields) ? cfg.fields : [];
    checks.push({
      ok: fields.length > 0,
      message:
        fields.length > 0
          ? undefined
          : "Define at least one PDF field to fill (or auto-detect from the template).",
    });
    const hasSecret = Boolean(env("SOCIETYER_WORKFLOW_CALLBACK_SECRET"));
    checks.push({
      ok: hasSecret,
      message: hasSecret
        ? undefined
        : "SOCIETYER_WORKFLOW_CALLBACK_SECRET is not set — the filler can't call back.",
    });
    const hasWebhook = Boolean(providerConfig?.externalWebhookUrl);
    checks.push({
      ok: hasWebhook,
      message: hasWebhook ? undefined : "No n8n webhook URL configured on this workflow.",
    });
  } else if (node.type === "external_n8n") {
    const overrideUrl = typeof cfg.webhookUrl === "string" ? cfg.webhookUrl : undefined;
    const hasWebhook = Boolean(overrideUrl ?? providerConfig?.externalWebhookUrl);
    checks.push({
      ok: hasWebhook,
      message: hasWebhook
        ? undefined
        : "Set an n8n webhook URL on the workflow or override it on this node.",
    });
  } else if (node.type === "email") {
    const hasRecipient = Boolean(cfg.to);
    checks.push({
      ok: hasRecipient,
      message: hasRecipient ? undefined : "Set a recipient (email address).",
    });
    const hasSubject = Boolean(cfg.subject);
    checks.push({
      ok: hasSubject,
      message: hasSubject ? undefined : "Set a subject line.",
    });
    const hasResend = Boolean(env("RESEND_API_KEY") && env("RESEND_FROM_EMAIL"));
    checks.push({
      ok: hasResend,
      message: hasResend
        ? undefined
        : "Resend is not configured — notifications will be skipped until RESEND_API_KEY and RESEND_FROM_EMAIL are set.",
    });
  } else if (node.type === "form") {
    const fields: string[] = Array.isArray(cfg.fields) ? cfg.fields : [];
    checks.push({
      ok: fields.length > 0,
      message: fields.length > 0 ? undefined : "Define at least one intake field.",
    });
  } else if (node.type === "document_create") {
    const hasCategory = Boolean(cfg.category);
    checks.push({
      ok: hasCategory,
      message: hasCategory ? undefined : "Set the document category to file under.",
    });
  }
  return checks;
}

// Computes the live node preview for rendering: starts from the stored
// (or catalog) preview and replaces each node's `status` based on the
// environment + provider config at read time. Also attaches `setupIssues`
// so the UI can explain *why* a node is not ready.
export function computeEffectiveNodePreview(
  baseNodes: NodePreview[] | undefined,
  providerConfig?: { externalWebhookUrl?: string },
) {
  const nodes = Array.isArray(baseNodes) ? baseNodes : [];
  return nodes.map((node) => {
    const checks = checkNodeSetup(node, providerConfig);
    const failing = checks.filter((c) => !c.ok);
    const setupIssues = failing.map((c) => c.message!).filter(Boolean);
    let status: NodePreview["status"] = node.status ?? "ready";
    if (failing.length > 0) {
      // Respect an explicit "draft" designation — if the recipe author flagged
      // a step as draft, keep it draft rather than downgrading the badge to a
      // setup warning. Everything else with failing checks becomes needs_setup.
      status = node.status === "draft" ? "draft" : "needs_setup";
    } else if (node.status !== "draft") {
      status = "ready";
    }
    return { ...node, status, setupIssues };
  });
}

// ---- queries -----------------------------------------------------------

export const listCatalog = query({
  args: {},
  handler: async () =>
    RECIPE_CATALOG.map((entry) => ({
      ...entry,
      // Recompute node statuses at read time so the preview reflects the
      // current server env (e.g. whether UNBC_AFFILIATE_TEMPLATE_PATH is set).
      nodePreview: computeEffectiveNodePreview(entry.nodePreview),
    })),
});

export const listNodeTypes = query({
  args: {},
  handler: async () => NODE_TYPE_CATALOG,
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
  handler: async (ctx, { id }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return null;
    return {
      ...wf,
      nodePreview: computeEffectiveNodePreview(wf.nodePreview, wf.providerConfig),
    };
  },
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

// Append (or insert) a node into the workflow's preview graph. For now this
// is additive only — no runner logic is attached to user-added nodes; they
// show up in the canvas, the sidepanel, and the run timeline as "pending"
// and are marked skipped if the workflow runs. Clarifying the execution
// contract is tracked for the full bridge MVP.
export const addNode = mutation({
  args: {
    id: v.id("workflows"),
    node: v.object({
      type: v.string(),
      label: v.string(),
      description: v.optional(v.string()),
    }),
    afterKey: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, node, afterKey, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });

    const valid = NODE_TYPE_CATALOG.some((entry) => entry.type === node.type);
    if (!valid) throw new Error(`Unknown node type: ${node.type}`);

    const existing: NodePreview[] = Array.isArray(wf.nodePreview) ? [...wf.nodePreview] : [];
    const baseKey = node.type.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || "node";
    const usedKeys = new Set(existing.map((n) => n.key));
    let newKey = baseKey;
    let suffix = 1;
    while (usedKeys.has(newKey)) {
      newKey = `${baseKey}_${suffix++}`;
    }

    const newNode: NodePreview = {
      key: newKey,
      type: node.type as NodePreview["type"],
      label: node.label,
      description: node.description,
      status: "draft",
    };

    let next: NodePreview[];
    if (afterKey) {
      const idx = existing.findIndex((n) => n.key === afterKey);
      if (idx === -1) {
        next = [...existing, newNode];
      } else {
        next = [...existing.slice(0, idx + 1), newNode, ...existing.slice(idx + 1)];
      }
    } else {
      next = [...existing, newNode];
    }

    await ctx.db.patch(id, { nodePreview: next });
    return { key: newKey };
  },
});

export const updateNodeConfig = mutation({
  args: {
    id: v.id("workflows"),
    key: v.string(),
    config: v.any(),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, key, config, label, description, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    const existing: NodePreview[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
    const idx = existing.findIndex((n) => n.key === key);
    if (idx === -1) throw new Error(`Node ${key} not found on workflow ${id}`);
    const prev = existing[idx];
    const next = [...existing];
    next[idx] = {
      ...prev,
      config: { ...(prev.config ?? {}), ...(config ?? {}) },
      label: label ?? prev.label,
      description: description ?? prev.description,
    };
    await ctx.db.patch(id, { nodePreview: next });
  },
});

export const removeNode = mutation({
  args: {
    id: v.id("workflows"),
    key: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, key, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    const existing: NodePreview[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
    const next = existing.filter((n) => n.key !== key);
    if (next.length === existing.length) return;
    await ctx.db.patch(id, { nodePreview: next });
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
    const isFailure = args.event === "run.failed" || args.event === "step.failed";
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
          : isFailure
            ? "fail"
            : "ok";
      steps = steps.map((step) =>
        step.key === args.stepKey
          ? { ...step, status, atISO: now, note: args.note ?? step.note }
          : step,
      );
    }

    if (isFailure) {
      steps = reconcileStepsOnFailure(
        steps,
        args.note ?? (args.event === "run.failed" ? "Workflow run failed." : "Step failed."),
        now,
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
    } else if (isFailure) {
      patch.status = "failed";
      patch.completedAtISO = now;
    } else if (run.status === "queued") {
      patch.status = "running";
    }

    await ctx.db.patch(args.runId, patch);

    if (args.event === "run.completed") {
      await enqueueEmailsForRunInline(ctx, args.runId);
    }
  },
});

// When a workflow run succeeds, turn every configured email-type node into
// a pendingEmails row for the Outbox. We only fire for nodes that have a
// `to` configured (via updateNodeConfig), and we skip ones already enqueued
// for this run so retries don't duplicate drafts.
async function enqueueEmailsForRunInline(ctx: any, runId: any) {
  const run = await ctx.db.get(runId);
  if (!run) return;
  const wf = await ctx.db.get(run.workflowId);
  if (!wf) return;
  const nodes: any[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
  const emailNodes = nodes.filter(
    (node) => node.type === "email" && node.config && typeof node.config.to === "string" && node.config.to.trim().length > 0,
  );
  if (emailNodes.length === 0) return;

  const existing = await ctx.db
    .query("pendingEmails")
    .withIndex("by_society", (q: any) => q.eq("societyId", run.societyId))
    .collect();
  const alreadyEnqueued = new Set<string>(
    existing
      .filter((row: any) => row.workflowRunId === runId)
      .map((row: any) => row.nodeKey),
  );

  const attachments: Array<{ documentId: any; fileName: string }> = [];
  if (run.generatedDocumentId) {
    const doc = await ctx.db.get(run.generatedDocumentId);
    if (doc) {
      attachments.push({
        documentId: run.generatedDocumentId,
        fileName: doc.fileName ?? doc.title ?? "attachment",
      });
    }
  }

  const nowISO = new Date().toISOString();
  for (const node of emailNodes) {
    if (alreadyEnqueued.has(node.key)) continue;
    const cfg = node.config ?? {};
    await ctx.db.insert("pendingEmails", {
      societyId: run.societyId,
      workflowId: run.workflowId,
      workflowRunId: runId,
      nodeKey: node.key,
      to: String(cfg.to),
      cc: typeof cfg.cc === "string" ? cfg.cc : undefined,
      bcc: typeof cfg.bcc === "string" ? cfg.bcc : undefined,
      subject: typeof cfg.subject === "string" && cfg.subject.length > 0 ? cfg.subject : node.label,
      body: typeof cfg.body === "string" ? cfg.body : "",
      attachments,
      status: "ready",
      createdAtISO: nowISO,
      notes: `Queued by workflow ${wf.name} · node ${node.key}`,
    });
  }
}

// Any step still running/pending when a run fails needs to be resolved so
// the timeline reflects where execution actually stopped. The first
// still-open step is attributed the failure; any pending steps after it are
// skipped. If the step that triggered the failure has already been marked
// "fail", that stays and only the trailing pending steps become "skip".
function reconcileStepsOnFailure(
  steps: Array<{ key?: string; label: string; status: string; atISO?: string; note?: string }>,
  errorNote: string,
  nowISO: string,
) {
  let failureAssigned = steps.some((s) => s.status === "fail");
  return steps.map((step) => {
    if (step.status === "ok" || step.status === "fail") return step;
    if (!failureAssigned && (step.status === "running" || step.status === "pending")) {
      failureAssigned = true;
      return { ...step, status: "fail", atISO: nowISO, note: errorNote };
    }
    if (step.status === "pending" || step.status === "running") {
      return {
        ...step,
        status: "skip",
        atISO: nowISO,
        note: "Skipped — earlier step failed.",
      };
    }
    return step;
  });
}

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
    const run = await ctx.db.get(id);
    const now = new Date().toISOString();
    let steps = run?.steps ?? [];
    if (status === "failed" && steps.length > 0) {
      const errorNote =
        (output && typeof output === "object" && typeof (output as any).error === "string"
          ? (output as any).error
          : undefined) ?? "Workflow failed.";
      steps = reconcileStepsOnFailure(steps, errorNote, now);
    }
    await ctx.db.patch(id, {
      status,
      completedAtISO: now,
      output,
      steps,
    });
    if (status === "success") {
      await enqueueEmailsForRunInline(ctx, id);
    }
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

    const affiliate = normalizeAffiliateInput(args.input?.affiliate ?? args.input);
    const resolved = await resolveFieldMappings(ctx, wf, args);
    // Resolved values take priority, falling back to form-supplied affiliate
    // input whenever the mapping is empty or skipped.
    const fieldValues: Record<string, any> = { ...affiliate, ...resolved };
    const templateDocumentId = findFillPdfNode(wf)?.config?.templateDocumentId;

    const payload = {
      workflowId: args.workflowId,
      runId,
      societyId: args.societyId,
      recipe: wf.recipe,
      callbackUrl,
      callbackSecret,
      pdfFillUrl,
      input: {
        affiliate: fieldValues,
        fieldValues,
        mapping: resolved,
        pdfTemplateKey: "unbc_affiliate_id",
        pdfTemplateDocumentId: templateDocumentId,
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

// ---- runtime mapping resolution ---------------------------------------

function findFillPdfNode(wf: any) {
  const nodes = Array.isArray(wf?.nodePreview) ? wf.nodePreview : [];
  return nodes.find((n: any) => n?.type === "pdf_fill");
}

function dynamicValue(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const now = new Date();
  if (source === "today") return now.toISOString().slice(0, 10);
  if (source === "today:long") {
    return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (source === "now") return now.toISOString();
  return undefined; // society.name / currentUser.* filled in via gathered context
}

function personFieldValue(person: any, source?: string): string | undefined {
  if (!person || !source) return undefined;
  if (source.startsWith("custom:")) return undefined; // handled separately
  if (source === "fullName") {
    const full = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
    return full || undefined;
  }
  if (source === "mailingAddress") return person.address ?? person.mailingAddress ?? undefined;
  const v = person[source];
  return typeof v === "string" ? v : v == null ? undefined : String(v);
}

// Called from within the run() action — gathers everything we need for
// resolution in one round-trip.
export const _gatherMappingContext = internalQuery({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    personRefs: v.array(v.object({ category: v.string(), personId: v.string() })),
  },
  handler: async (ctx, { societyId, actingUserId, personRefs }) => {
    const society = await ctx.db.get(societyId);
    const actor = actingUserId ? await ctx.db.get(actingUserId) : null;

    const byKey: Record<
      string,
      { person: any; customValues: Record<string, any> }
    > = {};
    for (const ref of personRefs) {
      const key = `${ref.category}:${ref.personId}`;
      if (byKey[key]) continue;
      let person: any = null;
      try {
        person = await ctx.db.get(ref.personId as any);
      } catch {
        person = null;
      }
      const defs = await ctx.db
        .query("customFieldDefinitions")
        .withIndex("by_society_entity", (q) =>
          q.eq("societyId", societyId).eq("entityType", ref.category),
        )
        .collect();
      const defKeyById = new Map<string, string>(defs.map((d: any) => [String(d._id), d.key]));
      const values = await ctx.db
        .query("customFieldValues")
        .withIndex("by_entity", (q) =>
          q.eq("entityType", ref.category).eq("entityId", ref.personId),
        )
        .collect();
      const customValues: Record<string, any> = {};
      for (const v of values) {
        const k = defKeyById.get(String(v.definitionId));
        if (k) customValues[k] = v.value;
      }
      byKey[key] = { person, customValues };
    }
    return {
      societyName: society?.name ?? "",
      actingUser: actor
        ? { name: actor.displayName ?? "", email: actor.email ?? "" }
        : null,
      personRefs: byKey,
    };
  },
});

// Resolve each PDF field mapping into a flat {fieldName: string} map.
// Unmapped fields are left out so callers can fall back to form input.
async function resolveFieldMappings(
  ctx: any,
  wf: any,
  args: any,
): Promise<Record<string, string>> {
  const node = findFillPdfNode(wf);
  const mappings: Record<string, any> = node?.config?.fieldMappings ?? {};
  if (!mappings || Object.keys(mappings).length === 0) return {};

  const personRefs: Array<{ category: string; personId: string }> = [];
  for (const m of Object.values(mappings) as any[]) {
    if (m?.kind === "personRef" && m.category && m.personId) {
      personRefs.push({ category: m.category, personId: m.personId });
    }
  }

  const gathered: any = await ctx.runQuery(internal.workflows._gatherMappingContext, {
    societyId: wf.societyId,
    actingUserId: args.actingUserId,
    personRefs,
  });

  const personInput = args.input?.person ?? args.input?.affiliate ?? args.input ?? {};
  const managerInput = args.input?.manager ?? {};

  const result: Record<string, string> = {};
  for (const [field, m] of Object.entries(mappings) as [string, any][]) {
    const value = computeMappingValue(m, gathered, personInput, managerInput);
    if (value !== undefined && value !== null && value !== "") {
      result[field] = String(value);
    }
  }
  return result;
}

function computeMappingValue(
  m: any,
  gathered: any,
  personInput: any,
  managerInput: any,
): string | undefined {
  if (!m) return undefined;
  switch (m.kind) {
    case "literal":
      return typeof m.value === "string" ? m.value : undefined;
    case "dynamic": {
      if (m.source === "society.name") return gathered?.societyName ?? undefined;
      if (m.source === "currentUser.name") return gathered?.actingUser?.name ?? undefined;
      if (m.source === "currentUser.email") return gathered?.actingUser?.email ?? undefined;
      return dynamicValue(m.source);
    }
    case "person": {
      if (!m.source) return undefined;
      // Common aliases mapped from the form / affiliate payload.
      const keyMap: Record<string, string[]> = {
        firstName: ["firstName", "Legal First Name of Affiliate"],
        lastName: ["lastName", "Legal Last Name of Affiliate"],
        email: ["email", "Personal email address"],
        phone: ["phone", "ManagerPhone"],
        mailingAddress: ["mailingAddress", "address", "Current Mailing Address"],
        birthdate: ["birthdate", "Birthdate of Affiliate (MM/DD/YYYY)"],
      };
      const candidates = keyMap[m.source] ?? [m.source];
      for (const k of candidates) {
        const v = personInput?.[k];
        if (v != null && v !== "") return String(v);
      }
      return undefined;
    }
    case "manager": {
      if (!m.source) return undefined;
      const keyMap: Record<string, string[]> = {
        name: ["name", "Name of requesting Manager"],
        email: ["email", "Manager Email"],
        phone: ["phone", "ManagerPhone"],
        department: ["department", "UNBC Department/Organization"],
      };
      const candidates = keyMap[m.source] ?? [m.source];
      for (const k of candidates) {
        const v = managerInput?.[k];
        if (v != null && v !== "") return String(v);
      }
      return undefined;
    }
    case "personRef": {
      if (!m.category || !m.personId || !m.source) return undefined;
      const key = `${m.category}:${m.personId}`;
      const bundle = gathered?.personRefs?.[key];
      if (!bundle?.person) return undefined;
      if (typeof m.source === "string" && m.source.startsWith("custom:")) {
        const customKey = m.source.slice("custom:".length);
        const raw = bundle.customValues?.[customKey];
        return raw == null ? undefined : String(raw);
      }
      return personFieldValue(bundle.person, m.source);
    }
    case "empty":
    default:
      return undefined;
  }
}
