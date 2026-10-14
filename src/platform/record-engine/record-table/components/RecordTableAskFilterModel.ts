import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { filterTreeSignature } from "../utils/filterTree";
import { useUndoableAction } from "@/hooks/useUndoableAction";
import { readLlmPrefs, readLocalApiKey, providerBaseUrl } from "@/features/intake/localLlm";
import {
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

/** Whether this device has an AI provider key for the optional "Ask AI" path. */
export function useAskAiAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!readLlmPrefs().enabled) return;
    readLocalApiKey()
      .then((key) => {
        if (!cancelled) setAvailable(Boolean(key));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

/**
 * Ask the device's AI provider for a filter. Sends the column schema, today's
 * date and the request — never row data — and validates the reply strictly.
 */
export async function askAiForFilter(fields: NlField[], query: string, context: NlContext, signal?: AbortSignal): Promise<NlParseResult> {
  const prefs = readLlmPrefs();
  const apiKey = await readLocalApiKey();
  if (!prefs.enabled || !apiKey) throw new Error("No AI provider is set up on this device.");
  const [{ createOpenAI }, { generateText }] = await Promise.all([import("@ai-sdk/openai"), import("ai")]);
  const baseURL = providerBaseUrl(prefs);
  const provider = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const model = prefs.provider === "openai" ? provider(prefs.modelId) : provider.chat(prefs.modelId);
  const { system, user } = buildAiFilterPrompt(fields, query, context);
  const reply = await generateText({ model, system, prompt: user, abortSignal: signal, maxOutputTokens: 800 });
  return validateAiFilterReply(extractJsonObject(reply.text), fields, query);
}
