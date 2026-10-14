/**
 * Glue between a mounted RecordTable's "Ask" filter and app-level surfaces
 * (the command palette). Kept free of React and of the record engine so
 * generic components can import it.
 */

/** Registered command ids for a table's Ask filter start with this. */
export const ASK_FILTER_COMMAND_PREFIX = "record-table-ask:";

export type AskFilterTarget = {
  /** "transactions" — used in "Filter transactions by: …". */
  label: string;
  /** Parse and apply (or open the preview when the request isn't fully understood). */
  run: (query: string) => void;
  /** How well the query parses here: drives where the palette lists the row. */
  preview: (query: string) => "empty" | "ok" | "partial" | "none";
};

const targets = new Map<string, AskFilterTarget>();

export function registerAskFilterTarget(commandId: string, target: AskFilterTarget): () => void {
  targets.set(commandId, target);
  return () => {
    if (targets.get(commandId) === target) targets.delete(commandId);
  };
}

export function getAskFilterTarget(commandId: string): AskFilterTarget | undefined {
  return targets.get(commandId);
}

export type PendingAsk = { query: string; preview: boolean };

const pending = new Map<string, PendingAsk>();

/** Hand a query to a table's Ask box before asking its filter editor to open. */
export function setPendingAsk(tableId: string, request: PendingAsk) {
  pending.set(tableId, request);
}

/** Read without clearing: safe in React state initialisers (StrictMode runs them twice). */
export function peekPendingAsk(tableId: string): PendingAsk | undefined {
  return pending.get(tableId);
}

export function clearPendingAsk(tableId: string) {
  pending.delete(tableId);
}
