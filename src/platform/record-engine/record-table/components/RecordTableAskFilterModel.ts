import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { filterTreeSignature } from "../utils/filterTree";
import { useUndoableAction } from "@/hooks/useUndoableAction";
import { useAction, useQuery } from "convex/react";
import { readLlmPrefs, readLocalApiKey, providerBaseUrl } from "@/features/intake/localLlm";
import { api } from "@/lib/convexApi";
import { isLocalDataRuntime, isStaticDemoRuntime } from "@/lib/staticRuntime";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { useAiChatVisibility } from "@/hooks/useAiChatVisibility";
import { AI_FILTER_LIMITS, type AiFilterSuggestion } from "../../../../../shared/nlFilterAi";
import {
  aiFilterSchema,
  aiFilterToParseResult,
  buildAiFilterPrompt,
  combineFilterTrees,
  extractJsonObject,
  nlFieldsFromColumns,
  parseNlFilter,
  pushRecentQuery,
  validateAiFilterReply,
  type ApplyMode,
  type NlContext,
  type NlField,
  type NlParseResult,
} from "@/lib/nlFilter";

/** The parser's inputs for the mounted table: its columns (no rows) and calendar. */
export function useAskFilterModel() {
  const columns = useRecordTableState((s) => s.columns);
  const dateContext = useRecordTableState((s) => s.dateContext);
  const { objectMetadata } = useRecordTableContextOrThrow();
  const fields = useMemo<NlField[]>(
    () => nlFieldsFromColumns(columns, { labelIdentifierFieldName: objectMetadata.labelIdentifierFieldName }),
    [columns, objectMetadata.labelIdentifierFieldName],
  );
  const context = useMemo<NlContext>(
    () => ({
      today: dateContext.today,
      fiscalYearEnd: dateContext.fiscalYearEnd,
      objectLabelPlural: objectMetadata.labelPlural,
      objectLabelSingular: objectMetadata.labelSingular,
    }),
    [dateContext.today, dateContext.fiscalYearEnd, objectMetadata.labelPlural, objectMetadata.labelSingular],
  );
  const parse = useCallback((query: string) => parseNlFilter(query, fields, context), [fields, context]);
  return { fields, context, parse, recentScope: objectMetadata._id ?? objectMetadata.nameSingular };
}

/**
 * Apply a parsed request through the same store path as the filter editor:
 * the view turns dirty (Save / Discard appear) and the toast offers Undo.
 */
export function useApplyAskFilter() {
  const handle = useRecordTableStoreHandle();
  const undoable = useUndoableAction();
  const { recentScope } = useAskFilterModel();
  return useCallback(
    (result: NlParseResult, mode: ApplyMode) => {
      const state = handle.get();
      const before = { filters: state.filters, filterGroups: state.filterGroups };
      const next = combineFilterTrees(before, result, mode);
      pushRecentQuery(recentScope, result.query);
      if (filterTreeSignature(next.filters, next.filterGroups) === filterTreeSignature(before.filters, before.filterGroups)) return;
      void undoable({
        message: "Filters applied",
        description: result.chips.map((chip) => chip.text).join(" · "),
        run: () => handle.set(next),
        undo: () => handle.set(before),
        undoneMessage: "Filters restored",
        dedupeKey: `ask-filter:${state.tableId}`,
      });
    },
    [handle, undoable, recentScope],
  );
}

/**
 * Where "Ask AI" sends a request, if anywhere:
 * - "workspace": hosted workspaces with an active workspace AI provider, for
 *   people who may use the AI assistant (tasks:write). Runs the minimal
 *   aiFilterActions:suggestRecordFilter server action — no chat thread, no
 *   workspace context, schema only.
 * - "device": local/desktop workspaces (no server to hold a provider key) with
 *   the device-local key from the intake AI settings.
 * - null: the static demo, AI hidden by the person, or no provider. Hosted
 *   workspaces never fall back to a device key, so the workspace's AI choice
 *   (including turning its provider off) always holds.
 */
export type AskAiRoute = "workspace" | "device" | null;

function useDeviceAiKey(enabled: boolean): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !readLlmPrefs().enabled) {
      setAvailable(false);
      return;
    }
    readLocalApiKey()
      .then((key) => {
        if (!cancelled) setAvailable(Boolean(key));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return available;
}

/** The optional AI path for the mounted table: whether it is offered, and how to ask. */
export function useAskAi(): { route: AskAiRoute; ask: (query: string, signal?: AbortSignal) => Promise<NlParseResult> } {
  const society = useSociety() as { _id?: string } | null | undefined;
  const societyId = society?._id;
  const { can } = usePermissions();
  const { hidden: aiHidden } = useAiChatVisibility();
  const { fields, context } = useAskFilterModel();
  const { objectMetadata } = useRecordTableContextOrThrow();
  const demo = isStaticDemoRuntime();
  const local = isLocalDataRuntime();
  const workspaceEligible = !local && !aiHidden && Boolean(societyId) && can("tasks:write") && can("settings:read");
  const settings = useQuery(api.aiSettings.getEffective, workspaceEligible && societyId ? { societyId } : "skip") as
    | { effective?: { scope?: string; status?: string } | null }
    | undefined;
  const workspaceProvider = workspaceEligible && settings?.effective?.scope === "workspace" && settings.effective.status === "active";
  const deviceKey = useDeviceAiKey(local && !demo && !aiHidden);
  const route: AskAiRoute = workspaceProvider ? "workspace" : local && !demo && !aiHidden && deviceKey ? "device" : null;
  const suggest = useAction(api.aiFilterActions.suggestRecordFilter);
  const nameSingular = objectMetadata.nameSingular;

  const ask = useCallback(
    async (query: string, signal?: AbortSignal): Promise<NlParseResult> => {
      if (route === "device") return askDeviceAiForFilter(fields, query, context, signal);
      if (route !== "workspace" || !societyId) throw new Error("AI isn't available for this table.");
      const reply = (await suggest({
        societyId,
        objectNameSingular: nameSingular,
        fields: aiFilterSchema(fields),
        today: context.today,
        fiscalYearEnd: context.fiscalYearEnd ?? null,
        query: query.trim().slice(0, AI_FILTER_LIMITS.query),
      })) as AiFilterSuggestion | null;
      if (!reply) throw new Error("AI isn't available here.");
      if (!reply.ok) throw new Error(reply.message);
      return aiFilterToParseResult(reply, fields, query);
    },
    [route, fields, context, societyId, suggest, nameSingular],
  );
  return { route, ask };
}

/**
 * Ask the device's AI provider for a filter (local/desktop workspaces). Sends
 * the column schema, today's date and the request — never row data — and
 * validates the reply with the same shared validator as the server.
 */
async function askDeviceAiForFilter(fields: NlField[], query: string, context: NlContext, signal?: AbortSignal): Promise<NlParseResult> {
  const prefs = readLlmPrefs();
  const apiKey = await readLocalApiKey();
  if (!prefs.enabled || !apiKey) throw new Error("No AI provider is set up on this device.");
  const [{ createOpenAI }, { generateText }] = await Promise.all([import("@ai-sdk/openai"), import("ai")]);
  const baseURL = providerBaseUrl(prefs);
  const provider = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const model = prefs.provider === "openai" ? provider(prefs.modelId) : provider.chat(prefs.modelId);
  const { system, user } = buildAiFilterPrompt(fields, query.trim().slice(0, AI_FILTER_LIMITS.query), context);
  const reply = await generateText({ model, system, prompt: user, abortSignal: signal, maxOutputTokens: 800, temperature: 0 });
  const raw = extractJsonObject(reply.text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The AI reply wasn't a filter. Try rephrasing the request.");
  return validateAiFilterReply(raw, fields, query);
}
