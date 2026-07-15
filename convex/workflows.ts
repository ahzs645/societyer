import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
  internalAction,
  internalQuery,
} from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { requireRole } from "./users";
import { PDFDocument } from "pdf-lib";
import {
  buildPdfTableImportBundle,
  normalizePdfTableStructures,
} from "./lib/pdfTableNormalization";
import {
  parseWorkflowNodes,
  parseWorkflowStatus,
  parseWorkflowTrigger,
  workflowProviderSchema,
  type WorkflowProvider,
} from "../shared/workflows/schemas";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  listPortable,
  listRunsPortable,
  runsForWorkflowPortable,
  getRunPortable,
  setStatusPortable,
  updatePortable,
  addNodePortable,
  removePortable,
  updateNodeConfigPortable,
  removeNodePortable,
  listNodeTypesPortable,
} from "../shared/functions/workflows";

import {
  UNBC_AFFILIATE_FIELDS,
  UNBC_KEY_ACCESS_FIELDS,
  UNBC_KEY_ACCESS_INTAKE_FIELDS,
  RECIPE_LABELS,
  RECIPE_DESCRIPTIONS,
  RECIPE_PROVIDERS,
  RECIPE_STEPS,
  UNBC_DOCUMENT_DEFAULTS,
  UNBC_EMAIL_DEFAULTS,
  UNBC_KEY_DOCUMENT_DEFAULTS,
  UNBC_KEY_EMAIL_DEFAULTS,
  OTE_KEYCARD_EMAIL_DEFAULTS,
  OTE_KEYCARD_INTAKE_FIELDS,
  CSJ_ORIENTATION_EMAIL_DEFAULTS,
  RECIPE_NODE_PREVIEWS,
  UNBC_SAMPLE_AFFILIATE,
  UNBC_SAMPLE_KEY_REQUEST,
  OTE_SAMPLE_KEYCARD_REQUEST,
  RECIPE_CATALOG,
  effectivePdfFields,
  effectiveIntakeFields,
  effectiveDocumentConfig,
  effectiveEmailConfig,
  checkNodeSetup,
  computeEffectiveNodePreview,
  enqueueEmailsForRunInline,
  reconcileStepsOnFailure,
  computeNextRunAt,
  runExternalWorkflow,
  runExternalGovernanceRecipe,
  runExternalNotificationWorkflow,
  handleStep,
  renderWorkflowPrompt,
  nodePreviewForRecipe,
  slugifyFieldKey,
  inferIntakeFieldType,
  intakeFieldsForRecipe,
  configForRecipe,
  providerConfigForRecipe,
  stepsForRun,
  cleanConnectorKey,
  labelizeConnector,
  normalizeConnectorRunStatus,
  normalizeIntakeInput,
  normalizeWorkflowRunInput,
  normalizeAffiliateInput,
  normalizeWorkflowPdfInput,
  pdfFillUrlForWorkflow,
  safeJson,
  env,
  sleep,
  inspectPdfTemplateBytes,
  inspectPdfField,
  pdfFieldType,
  pdfFieldValue,
  cleanPdfValue,
  roundRectNumber,
  detectRepeatedPdfFieldTables,
  parseRepeatedFieldName,
  tableBounds,
  findFillPdfNode,
  findWorkflowNode,
  buildExternalEmailDraft,
  buildWorkflowTemplateContext,
  renderWorkflowTemplate,
  resolveTemplatePath,
  dynamicValue,
  personFieldValue,
  resolveFieldMappings,
  computeMappingValue,
} from "./workflowCatalog";
import type {
  RecipeStep,
  NodePreview,
  RecipeKey,
  SetupCheck,
} from "./workflowCatalog";

export const listCatalog = query({
  args: {},
  returns: v.any(),
  handler: async () =>
    RECIPE_CATALOG.map((entry) => ({
      ...entry,
      // Recompute node statuses at read time so the preview reflects the
      // current server env (e.g. whether UNBC_AFFILIATE_TEMPLATE_PATH is set).
      nodePreview: computeEffectiveNodePreview(entry.nodePreview, undefined, entry.config),
    })),
});


export const listNodeTypes = query({
  args: {},
  returns: v.any(),
  handler: () => listNodeTypesPortable(),
});


export const inspectPdfTemplate = action({
  args: {
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
  },
  returns: v.any(),
  handler: async (ctx, { documentId, versionId }) => {
    const document = await ctx.runQuery(api.documents.get, { id: documentId });
    if (!document) throw new Error("Document not found.");
    const version = versionId
      ? await ctx.runQuery(api.documentVersions.get, { id: versionId })
      : await ctx.runQuery(api.documentVersions.latest, { documentId });
    if (!version) throw new Error("This document has no uploaded PDF version.");
    if (version.documentId !== documentId) throw new Error("Version does not belong to this document.");
    if (!/pdf/i.test(version.mimeType ?? document.mimeType ?? version.fileName ?? document.fileName ?? "")) {
      throw new Error("The selected document version is not a PDF.");
    }

    const target = await ctx.runAction(api.documentVersions.getDownloadTarget, {
      versionId: version._id,
    });
    const url = target?.kind === "url" ? target.url : null;
    if (!url || typeof url !== "string") throw new Error("Could not create a PDF download URL.");
    if (url.startsWith("demo://")) {
      throw new Error("Demo documents do not contain real PDF bytes to inspect.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not read selected PDF (${response.status}).`);
    }
    const bytes = await response.arrayBuffer();
    return await inspectPdfTemplateBytes(bytes, {
      documentId: String(documentId),
      versionId: String(version._id),
      fileName: version.fileName ?? document.fileName,
      title: document.title,
      externalSystem: "societyer-documents",
      externalId: String(documentId),
    });
  },
});


export const createPdfTemplateImportSession = action({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, documentId, versionId, actingUserId }) => {
    if (!actingUserId) throw new Error("Role Director required - no authenticated actor.");
    await ctx.runQuery(api.paperless.authorizeMeetingImport, {
      societyId,
      actingUserId,
    });

    const document = await ctx.runQuery(api.documents.get, { id: documentId });
    if (!document || document.societyId !== societyId) throw new Error("Document not found.");
    const version = versionId
      ? await ctx.runQuery(api.documentVersions.get, { id: versionId })
      : await ctx.runQuery(api.documentVersions.latest, { documentId });
    if (!version) throw new Error("This document has no uploaded PDF version.");
    if (version.documentId !== documentId) throw new Error("Version does not belong to this document.");
    if (!/pdf/i.test(version.mimeType ?? document.mimeType ?? version.fileName ?? document.fileName ?? "")) {
      throw new Error("The selected document version is not a PDF.");
    }

    const target = await ctx.runAction(api.documentVersions.getDownloadTarget, {
      versionId: version._id,
    });
    const url = target?.kind === "url" ? target.url : null;
    if (!url || typeof url !== "string") throw new Error("Could not create a PDF download URL.");
    if (url.startsWith("demo://")) {
      throw new Error("Demo documents do not contain real PDF bytes to inspect.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not read selected PDF (${response.status}).`);
    }
    const bytes = await response.arrayBuffer();
    const inspection = await inspectPdfTemplateBytes(bytes, {
      documentId: String(documentId),
      versionId: String(version._id),
      fileName: version.fileName ?? document.fileName,
      title: document.title,
      externalSystem: "societyer-documents",
      externalId: String(documentId),
    });
    const sessionId = await ctx.runMutation(api.importSessions.createFromBundle, {
      societyId,
      name: `PDF template fields - ${document.title ?? version.fileName ?? "inspection"}`,
      bundle: inspection.importBundle,
    });
    return {
      sessionId,
      normalizedTables: inspection.normalizedTables?.length ?? 0,
      normalizedRows: inspection.normalizedTables?.reduce((sum: number, table: any) => sum + Number(table.rowCount ?? 0), 0) ?? 0,
      dataFields: inspection.importBundle?.legalTemplateDataFields?.length ?? 0,
    };
  },
});


export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});


export const listRuns = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: (ctx, args) => listRunsPortable(toPortableQueryCtx(ctx), args),
});


export const runsForWorkflow = query({
  args: { workflowId: v.id("workflows") },
  returns: v.any(),
  handler: (ctx, args) => runsForWorkflowPortable(toPortableQueryCtx(ctx), args),
});


export const getRun = query({
  args: { id: v.id("workflowRuns") },
  returns: v.any(),
  handler: (ctx, args) => getRunPortable(toPortableQueryCtx(ctx), args),
});


export const get = query({
  args: { id: v.id("workflows") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return null;
    return {
      ...wf,
      nodePreview: computeEffectiveNodePreview(wf.nodePreview, wf.providerConfig, wf.config),
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
  returns: v.any(),
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
    const trigger = parseWorkflowTrigger(args.trigger);
    const provider = workflowProviderSchema.parse(args.provider ?? RECIPE_PROVIDERS[recipe] ?? "internal");
    const providerConfig =
      provider === "n8n"
        ? { ...providerConfigForRecipe(recipe), ...(args.providerConfig ?? {}) }
        : args.providerConfig;
    const nodePreview = args.nodePreview ? parseWorkflowNodes(args.nodePreview) : nodePreviewForRecipe(recipe);

    return await ctx.db.insert("workflows", {
      societyId: args.societyId,
      recipe: args.recipe,
      name: args.name,
      status: args.status ?? "active",
      provider,
      providerConfig,
      nodePreview,
      trigger,
      config: { ...configForRecipe(recipe), ...(args.config ?? {}) },
      nextRunAtISO: computeNextRunAt(trigger),
      createdByUserId: args.actingUserId,
    });
  },
});


export const setupGovernanceN8nRecipes = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, actingUserId }) => {
    await requireRole(ctx, {
      actingUserId,
      societyId,
      required: "Director",
    });
    const recipes: RecipeKey[] = [
      "agm_date_deadlines",
      "filing_due_notify_officer",
      "conflict_disclosed_agenda_item",
    ];
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const created: string[] = [];
    const updated: string[] = [];
    for (const recipe of recipes) {
      const providerConfig = providerConfigForRecipe(recipe);
      const config = configForRecipe(recipe);
      const match = existing.find((workflow) => workflow.recipe === recipe);
      if (match) {
        await ctx.db.patch(match._id, {
          provider: "n8n",
          providerConfig: {
            ...(match.providerConfig ?? {}),
            ...(providerConfig ?? {}),
          },
          config: {
            ...(match.config ?? {}),
            ...config,
          },
          nodePreview: computeEffectiveNodePreview(
            match.nodePreview ?? nodePreviewForRecipe(recipe),
            providerConfig,
            config,
          ),
          status: match.status === "archived" ? "active" : match.status,
        });
        updated.push(RECIPE_LABELS[recipe]);
        continue;
      }
      await ctx.db.insert("workflows", {
        societyId,
        recipe,
        name: RECIPE_LABELS[recipe],
        status: "active",
        provider: "n8n",
        providerConfig,
        nodePreview: nodePreviewForRecipe(recipe),
        trigger:
          recipe === "filing_due_notify_officer"
            ? { kind: "date_offset", offset: { anchor: "filings.dueDate", daysBefore: 14 } }
            : { kind: "manual" },
        config,
        nextRunAtISO: undefined,
        createdByUserId: actingUserId,
      });
      created.push(RECIPE_LABELS[recipe]);
    }
    return { created, updated };
  },
});


export const setStatus = mutation({
  args: {
    id: v.id("workflows"),
    status: v.string(), // active | paused | archived
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => setStatusPortable(toPortableMutationCtx(ctx), args),
});

// Light-touch patch for inline edits from the record table. Only
// exposes the fields that are safe to tweak without re-computing the
// trigger / provider config: the human-facing `name` and the SELECT
// status. For status parity with the dedicated `setStatus` mutation,
// this also enforces Director role.

export const update = mutation({
  args: {
    id: v.id("workflows"),
    patch: v.object({
      name: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});


export const configure = mutation({
  args: {
    id: v.id("workflows"),
    patch: v.object({
      name: v.optional(v.string()),
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
      trigger: v.optional(
        v.object({
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
      ),
      config: v.optional(v.any()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    const next: any = { ...patch };
    if (patch.trigger) {
      next.trigger = parseWorkflowTrigger(patch.trigger);
      const nextRunAtISO = computeNextRunAt(next.trigger);
      if (nextRunAtISO) next.nextRunAtISO = nextRunAtISO;
    }
    if (patch.status) next.status = parseWorkflowStatus(patch.status);
    if (patch.provider) next.provider = workflowProviderSchema.parse(patch.provider);
    if (patch.nodePreview) next.nodePreview = parseWorkflowNodes(patch.nodePreview);
    await ctx.db.patch(id, next);
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
  returns: v.any(),
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
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => addNodePortable(toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
  handler: (ctx, args) => updateNodeConfigPortable(toPortableMutationCtx(ctx), args),
});


export const removeNode = mutation({
  args: {
    id: v.id("workflows"),
    key: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => removeNodePortable(toPortableMutationCtx(ctx), args),
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
  returns: v.any(),
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
// a pendingEmails row for the Outbox. We only fire for nodes with an
// effective `to` address, and we skip ones already enqueued for this run so
// retries don't duplicate drafts.

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
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workflowId !== args.workflowId || run.societyId !== args.societyId) {
      throw new Error("Workflow run not found.");
    }
    const wf = await ctx.db.get(args.workflowId);
    if (!wf) throw new Error("Workflow not found.");
    const saveNode = findWorkflowNode(wf, "document_create");
    const documentConfig = effectiveDocumentConfig(saveNode?.config ?? {}, wf.config ?? {});
    const templateContext = await buildWorkflowTemplateContext(ctx, wf, run, {
      document: {
        title: args.fileName.replace(/\.pdf$/i, ""),
        fileName: args.fileName,
        category: documentConfig.category,
      },
    });

    const defaultTitle = args.fileName.replace(/\.pdf$/i, "");
    const title = renderWorkflowTemplate(documentConfig.titleTemplate ?? defaultTitle, templateContext).trim() || defaultTitle;
    const tags = Array.from(
      new Set([
        ...(Array.isArray(documentConfig.tags) ? documentConfig.tags : []),
        `workflow-run:${args.runId}`,
      ]),
    );
    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title,
      category: documentConfig.category ?? "WorkflowGenerated",
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      retentionYears: documentConfig.retentionYears,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      tags,
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
      changeNote: documentConfig.changeNote ?? "Generated by workflow.",
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
  returns: v.any(),
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
    output: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, { id, stepIndex, status, note, output }) => {
    const run = await ctx.db.get(id);
    if (!run) return;
    const steps = run.steps.map((s, i) =>
      i === stepIndex
        ? { ...s, status, atISO: new Date().toISOString(), note: note ?? s.note, output: output ?? (s as any).output }
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
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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


export const recordConnectorRun = mutation({
  args: {
    societyId: v.id("societies"),
    connectorId: v.string(),
    connectorName: v.optional(v.string()),
    actionId: v.string(),
    actionName: v.optional(v.string()),
    status: v.string(),
    externalRunId: v.optional(v.string()),
    profileKey: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    startedAtISO: v.optional(v.string()),
    completedAtISO: v.optional(v.string()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    triggeredByUserId: v.optional(v.id("users")),
  },
  returns: v.id("workflowRuns"),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const recipe = `connector_${cleanConnectorKey(args.connectorId)}`;
    const connectorLabel = args.connectorName ?? labelizeConnector(args.connectorId);
    const actionLabel = args.actionName ?? labelizeConnector(args.actionId);
    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const existing = workflows.find((workflow) => workflow.recipe === recipe);
    const nodePreview = [
      {
        key: "authenticate",
        type: "connector",
        label: `${connectorLabel} authentication`,
        description: args.sessionId ? `Browser session ${args.sessionId}` : "Saved browser profile or live session.",
        status: "ok",
      },
      {
        key: "run_action",
        type: "connector",
        label: actionLabel,
        description: `Connector action ${args.actionId}.`,
        status: args.status === "failed" ? "fail" : "ok",
      },
      {
        key: "record_result",
        type: "audit",
        label: "Record connector result",
        description: "Persist connector output into workflow-run history.",
        status: args.status === "failed" ? "fail" : "ok",
      },
    ];
    const workflowId = existing?._id ?? await ctx.db.insert("workflows", {
      societyId: args.societyId,
      recipe,
      name: `${connectorLabel} connector`,
      status: "active",
      provider: "browser-connector",
      providerConfig: {
        externalWorkflowId: args.connectorId,
      },
      nodePreview,
      trigger: { kind: "manual" },
      config: {
        connectorId: args.connectorId,
        connectorName: connectorLabel,
      },
      lastRunAtISO: now,
      createdByUserId: args.triggeredByUserId,
    });
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: existing.name || `${connectorLabel} connector`,
        provider: existing.provider ?? "browser-connector",
        nodePreview,
        lastRunAtISO: now,
      });
    }
    const status = normalizeConnectorRunStatus(args.status);
    const completedAtISO = args.completedAtISO ?? (status === "running" || status === "queued" ? undefined : now);
    const steps = nodePreview.map((node) => ({
      key: node.key,
      label: node.label,
      status: node.status === "fail" ? "fail" : status === "running" ? "running" : "ok",
      atISO: completedAtISO ?? now,
      note: node.description,
    }));
    const runId = await ctx.db.insert("workflowRuns", {
      societyId: args.societyId,
      workflowId,
      recipe,
      status,
      startedAtISO: args.startedAtISO ?? now,
      completedAtISO,
      steps,
      provider: "browser-connector",
      externalRunId: args.externalRunId,
      externalStatus: args.status,
      output: {
        connectorId: args.connectorId,
        connectorName: connectorLabel,
        actionId: args.actionId,
        actionName: actionLabel,
        profileKey: args.profileKey,
        sessionId: args.sessionId,
        error: args.error,
        ...(args.output ?? {}),
      },
      demo: false,
      triggeredBy: "connector",
      triggeredByUserId: args.triggeredByUserId,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: args.triggeredByUserId ? "User" : "Browser connector",
      entityType: "workflowRun",
      entityId: String(runId),
      action: "connector-run-recorded",
      summary: `${connectorLabel} ${actionLabel} ${status}.`,
      createdAtISO: now,
    });
    return runId;
  },
});

// ---- triggers / scheduler ---------------------------------------------


export const scan = internalAction({
  args: {},
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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

    const rawIntake = normalizeWorkflowRunInput(wf, args.input);
    const steps = stepsForRun(wf.recipe, wf.nodePreview);
    const nodes = Array.isArray(wf.nodePreview) && wf.nodePreview.length > 0
      ? wf.nodePreview
      : nodePreviewForRecipe(wf.recipe as RecipeKey);
    try {
      // Steps that only describe an action they cannot perform internally (e.g.
      // "dispatch the AGM notice") are reported honestly: the step is marked
      // "skip" and the run ends "manual_required" rather than a false "success".
      const manualSteps: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        await ctx.runMutation(internal.workflows._updateStep, {
          id: runId,
          stepIndex: i,
          status: "running",
        });
        await sleep(400);
        const result = await handleStep(ctx, wf, i, rawIntake, nodes[i], args.actingUserId);
        const manualRequired = typeof result === "object" && result?.manualRequired === true;
        const note = typeof result === "string" ? result : result?.note;
        if (manualRequired) manualSteps.push(note ?? steps[i]?.label ?? `Step ${i + 1}`);
        await ctx.runMutation(internal.workflows._updateStep, {
          id: runId,
          stepIndex: i,
          status: manualRequired ? "skip" : "ok",
          note,
          output: typeof result === "string" ? undefined : result?.output,
        });
      }

      const needsManual = manualSteps.length > 0;
      await ctx.runMutation(internal.workflows._completeRun, {
        id: runId,
        status: needsManual ? "manual_required" : "success",
        output: { intake: rawIntake, fieldValues: rawIntake, manualSteps },
      });
      await ctx.runMutation(internal.workflows._touchSchedule, {
        id: args.workflowId,
      });
      const recipeLabel = RECIPE_LABELS[wf.recipe as RecipeKey] ?? wf.recipe;
      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        kind: "bot",
        severity: needsManual ? "info" : "success",
        title: needsManual
          ? `Workflow needs manual action: ${wf.name}`
          : `Workflow finished: ${wf.name}`,
        body: needsManual
          ? `Recipe ${recipeLabel} prepared ${steps.length} steps; ${manualSteps.length} require manual action: ${manualSteps.join(" ")}`
          : `Recipe ${recipeLabel} completed ${steps.length} steps.`,
        linkHref: "/app/workflow-runs",
      });
      return { runId, status: needsManual ? "manual_required" : "success" };
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


export const _gatherMappingContext = internalQuery({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    personRefs: v.array(v.object({ category: v.string(), personId: v.string() })),
  },
  returns: v.any(),
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
