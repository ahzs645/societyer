"use node";

/** Intake field extraction on the server: schema-constrained generateObject
 * (ai SDK v6) through the same provider resolution as AI chat (workspace AI
 * settings → secret vault → OPENAI_API_KEY / OPENROUTER_API_KEY), with the
 * deterministic per-class extractors as the no-key fallback. Restricted files and
 * personal-data classes (consents, rosters, proxies, invoices, correspondence) are
 * never sent; PII is redacted (length-preserving) before every call; every
 * quote is re-verified when the extraction is saved; each call is logged. */
import { v } from "convex/values";
import { api } from "./_generated/api";
import { authorizedAction } from "./lib/authorizedServer";
import { action } from "./lib/untypedServer";
import { resolveAiRuntimeConfig } from "./aiChatActions";
import { makeGenerateObject } from "../shared/intake/aiGenerate";
import { extractWithLlm, mapWithConcurrency, TokenBudget, type GenerateObjectFn } from "../shared/intake/llm";
import { EXTRACTION_CLASSES, PROVIDER_EXCLUDED_CLASSES } from "../shared/intake/classify";
import { extractForClass } from "../shared/intake/extractors";
import type { DocClass } from "../shared/intake/schemas";

type Outcome = { fileKey: string; engine: "llm" | "deterministic" | "skipped"; reason?: string; extractionId?: string };

async function extractOne(ctx: any, args: { societyId: any; runId: any; fileKey: string; docClass?: string; modelId?: string; budget?: TokenBudget; runtime?: any }): Promise<Outcome> {
  const input = await ctx.runQuery((api as any).intake.getExtractionInput, { societyId: args.societyId, runId: args.runId, fileKey: args.fileKey });
  const { file, extract } = input ?? {};
  if (!file || !extract) return { fileKey: args.fileKey, engine: "skipped", reason: "No stored text extract for this file." };
  const docClass = (args.docClass ?? file.docClass ?? "meetingMinutes") as DocClass;
  const fullExtract = { method: extract.method, methodVersion: extract.methodVersion, blocks: extract.blocks, text: extract.text ?? "", warnings: extract.warnings ?? [] };
  const runtime = args.runtime ?? await resolveAiRuntimeConfig(ctx, args.societyId, undefined, args.modelId);
  const restricted = file.sensitivity === "restricted" || PROVIDER_EXCLUDED_CLASSES.has(docClass);
  if (runtime?.model && !restricted) {
    const generate: GenerateObjectFn = makeGenerateObject(runtime.model);
    try {
      const result = await extractWithLlm({ fileId: args.fileKey, fileName: file.name, docClass, extract: fullExtract, restricted, generate, provider: runtime.provider, model: runtime.modelId, budget: args.budget });
      await ctx.runMutation((api as any).intake.appendProcessingLog, { societyId: args.societyId, runId: args.runId, entries: result.log });
      if (result.envelope) {
        const extractionId = await ctx.runMutation((api as any).intake.saveExtraction, { societyId: args.societyId, runId: args.runId, fileKey: args.fileKey, extraction: result.envelope });
        return { fileKey: args.fileKey, engine: "llm", extractionId };
      }
      if (result.skippedReason === "budget") return { fileKey: args.fileKey, engine: "skipped", reason: "Run token budget exhausted." };
    } catch (error) {
      await ctx.runMutation((api as any).intake.appendProcessingLog, { societyId: args.societyId, runId: args.runId, entries: [{ atISO: new Date().toISOString(), fileKey: args.fileKey, stage: "llm_skipped", provider: runtime.provider, model: runtime.modelId, sentToProvider: true, note: `Provider error; deterministic fallback used: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}` }] });
    }
  } else {
    await ctx.runMutation((api as any).intake.appendProcessingLog, { societyId: args.societyId, runId: args.runId, entries: [{ atISO: new Date().toISOString(), fileKey: args.fileKey, stage: "llm_skipped", sentToProvider: false, note: restricted ? "Restricted file: never sent to a model provider." : "No AI provider configured; deterministic extractor used." }] });
  }
  const envelope = extractForClass(docClass, { fileId: args.fileKey, fileName: file.name, path: file.path, extract: fullExtract as any, asOfISO: new Date().toISOString().slice(0, 10) });
  if (!envelope) return { fileKey: args.fileKey, engine: "skipped", reason: `No deterministic extractor for ${docClass}.` };
  const extractionId = await ctx.runMutation((api as any).intake.saveExtraction, { societyId: args.societyId, runId: args.runId, fileKey: args.fileKey, extraction: envelope });
  return { fileKey: args.fileKey, engine: "deterministic", extractionId };
}

export const extractFile = authorizedAction("intakeActions:extractFile", action)({
  args: { societyId: v.id("societies"), runId: v.id("intakeRuns"), fileKey: v.string(), docClass: v.optional(v.string()), modelId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => extractOne(ctx, args),
});

export const extractRun = authorizedAction("intakeActions:extractRun", action)({
  args: {
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    modelId: v.optional(v.string()),
    limit: v.optional(v.number()),
    concurrency: v.optional(v.number()),
    budgetTokens: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = await ctx.runQuery((api as any).intake.listFiles, { societyId: args.societyId, runId: args.runId });
    const targets = (files as any[]).filter((file) => file.disposition === "extract" && EXTRACTION_CLASSES.has(file.docClass)).slice(0, Math.max(0, Math.min(args.limit ?? 200, 500)));
    const budget = new TokenBudget(Math.max(10_000, Math.min(args.budgetTokens ?? 1_000_000, 20_000_000)));
    const runtime = await resolveAiRuntimeConfig(ctx, args.societyId, undefined, args.modelId);
    await ctx.runMutation((api as any).intake.updateRun, { societyId: args.societyId, runId: args.runId, patch: { status: "running", engine: { minutes: runtime?.model ? "llm+deterministic-fallback" : "deterministic", classes: runtime?.model ? "llm+deterministic-fallback (personal-data classes deterministic only)" : "deterministic", ...(runtime?.model ? { llm: { provider: runtime.provider, model: runtime.modelId } } : {}) } } });
    const outcomes = await mapWithConcurrency(targets, Math.max(1, Math.min(args.concurrency ?? 4, 16)), (file) => extractOne(ctx, { societyId: args.societyId, runId: args.runId, fileKey: file.fileKey, docClass: file.docClass, budget, runtime }));
    const stats = outcomes.reduce<Record<string, number>>((acc, outcome) => ({ ...acc, [outcome.engine]: (acc[outcome.engine] ?? 0) + 1 }), {});
    await ctx.runMutation((api as any).intake.updateRun, { societyId: args.societyId, runId: args.runId, patch: { status: "extracted", stats: { extraction: stats, tokensUsed: budget.used } } });
    return { files: targets.length, stats, tokensUsed: budget.used, outcomes };
  },
});
