"use node";

/**
 * Record-table "Ask AI": turn a plain-language request into a filter tree with
 * the workspace AI provider. Deliberately minimal next to AI chat: it creates
 * no chat thread, loads no workspace context or tools, and receives only the
 * table's column schema, the organisation-local date, the fiscal year end and
 * the request — never row data. The reply is validated against that schema on
 * the server (shared/nlFilterAi.ts) before it is returned for the person to
 * confirm in the browser.
 */
import { v } from "convex/values";
import { generateText } from "ai";
import { api, internal } from "./_generated/api";
import { authorizedAction } from "./lib/authorizedServer";
import { action } from "./lib/untypedServer";
import { resolveAiRuntimeConfig } from "./aiChatActions";
import {
  AI_FILTER_LIMITS,
  buildAiFilterPrompt,
  extractJsonObject,
  sanitizeAiFilterSchema,
  validateAiFilterJson,
  type AiFilterErrorCode,
  type AiFilterSuggestion,
} from "../shared/nlFilterAi";

const PROVIDER_TIMEOUT_MS = 20_000;

const schemaFieldValidator = v.object({
  id: v.string(),
  label: v.string(),
  type: v.string(),
  operators: v.array(v.string()),
  options: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
  isCents: v.optional(v.boolean()),
});

function failure(error: AiFilterErrorCode, message: string): AiFilterSuggestion {
  return { ok: false, error, message };
}

function normaliseFiscalYearEnd(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^(\d{4}-)?\d{2}-\d{2}$/.test(value) ? value : null;
}

export const suggestRecordFilter = authorizedAction("aiFilterActions:suggestRecordFilter", action)({
  args: {
    societyId: v.id("societies"),
    /** The table's object; the caller must be able to read it. */
    objectNameSingular: v.string(),
    /** Column schema only: ids, labels, types, operators, option values, isCents. */
    fields: v.array(schemaFieldValidator),
    /** Organisation-local today, YYYY-MM-DD. */
    today: v.string(),
    fiscalYearEnd: v.optional(v.union(v.string(), v.null())),
    query: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<AiFilterSuggestion> => {
    const query = args.query.trim();
    if (!query) return failure("invalid_request", "Type a request first.");
    if (query.length > AI_FILTER_LIMITS.query) {
      return failure("invalid_request", `Shorten the request to ${AI_FILTER_LIMITS.query} characters to ask AI.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.today)) return failure("invalid_request", "Today's date is missing.");
    const schema = sanitizeAiFilterSchema(args.fields);
    if (!schema.length) return failure("invalid_request", "This table has no columns AI can filter on.");

    // Read access to the table's object (scoped metadata permission), resolved
    // from the persisted object in this workspace, never from a client label.
    const object = await ctx.runQuery((api as any).objectMetadata.getByNameSingular, {
      societyId: args.societyId,
      nameSingular: args.objectNameSingular,
    });
    if (!object || object.societyId !== args.societyId) throw new Error("Record not found.");

    // Workspace provider only (no personal key): an inactive or removed
    // workspace setting turns Ask AI off even when the deployment has an
    // environment key for other AI features.
    const runtime = await resolveAiRuntimeConfig(ctx, args.societyId, undefined);
    if (runtime.settingScope !== "workspace" || !runtime.model) {
      return failure("no_provider", "No AI provider is set up for this workspace.");
    }

    const started = await ctx.runMutation((internal as any).aiFilter._beginFilterSuggestion, {
      societyId: args.societyId,
      objectNameSingular: object.nameSingular,
      fieldCount: schema.length,
      queryLength: query.length,
      provider: runtime.provider,
      modelId: runtime.modelId,
    });
    if (started?.limited) return failure("rate_limited", "Too many AI requests in the last minute. Try again shortly.");
    const finish = (outcome: string, extra: Record<string, number | undefined> = {}) =>
      ctx.runMutation((internal as any).aiFilter._finishFilterSuggestion, {
        societyId: args.societyId,
        eventId: started.eventId,
        outcome,
        ...Object.fromEntries(Object.entries(extra).filter(([, value]) => typeof value === "number" && Number.isFinite(value))),
      });

    const { system, user } = buildAiFilterPrompt(schema, query, {
      today: args.today,
      fiscalYearEnd: normaliseFiscalYearEnd(args.fiscalYearEnd),
    });
    let text: string;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      const reply = await generateText({
        model: runtime.model,
        system,
        prompt: user,
        temperature: 0,
        maxOutputTokens: 800,
        abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      } as any);
      text = reply.text ?? "";
      usage = (reply as any).usage;
    } catch {
      // Provider messages can echo request details; keep them out of the reply and the log.
      await finish("provider_error");
      return failure("provider_error", "The AI provider didn't answer. Try again, or use the filters directly.");
    }

    const raw = extractJsonObject(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      await finish("invalid_json", { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens });
      return failure("invalid_json", "The AI reply wasn't a filter. Try rephrasing the request.");
    }
    const validation = validateAiFilterJson(raw, schema);
    const conditionCount = validation.filter
      ? validation.filter.conditions.length + validation.filter.groups.reduce((sum, group) => sum + group.conditions.length, 0)
      : 0;
    await finish("ok", {
      conditionCount,
      droppedCount: validation.droppedCount,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    });
    return { ok: true, ...validation };
  },
});
