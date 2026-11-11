/**
 * The workspace's bid triage in the reader (shared/procurementTriage.ts,
 * convex/procurementTriage.ts). It belongs to the workspace, not to a catalog
 * publication, so it is its own context beside the reader source: both hosted
 * readers (the Convex copy and the catalog service) provide it from one live
 * query, and the list and the notice page join it by record key. The offline
 * snapshot and the demo provide none, and show no triage.
 */
import { createContext, useContext, useMemo } from "react";
import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "../../../lib/convexApi";
import { usePermissions } from "../../../hooks/usePermissions";
import {
  triageClassification,
  type Triage,
  type TriageTaskNotice,
} from "../../../../shared/procurementTriage";

/** One opportunity's saved triage, as procurementTriage:list returns it. */
export type TriageEntry = Triage & {
  recordKey: string;
  updatedBy: string | null;
  updatedAt: number;
  /** The action item made from it, while that task exists. */
  taskId: string | null;
};

export type ReaderTriage = {
  /** Saved triage by record key; undefined while it loads. */
  entries: ReadonlyMap<string, TriageEntry> | undefined;
  /** documents:write: may change the triage. */
  canEdit: boolean;
  /** tasks:write as well: may make an action item. */
  canCreateTask: boolean;
  /** Saves for the whole workspace; shows at once, and rolls back if the save fails. */
  set(recordKey: string, next: Triage): Promise<void>;
  createTask(recordKey: string, notice: TriageTaskNotice): Promise<{ taskId: string; created: boolean }>;
};

export const ReaderTriageContext = createContext<ReaderTriage | null>(null);

/** The reader's triage, or null where there is none (the offline snapshot, the demo). */
export const useReaderTriage = () => useContext(ReaderTriageContext);

type ListArgs = { societyId: string };
type SetArgs = ListArgs & Triage & { recordKey: string };

/** Show a save before the server confirms it (Convex replaces it with the real result). */
function applyOptimistically(store: OptimisticLocalStore, args: SetArgs) {
  const query = { societyId: args.societyId };
  const current = store.getQuery(api.procurementTriage.list, query) as TriageEntry[] | undefined;
  if (!current) return;
  const existing = current.find((entry) => entry.recordKey === args.recordKey);
  const others = current.filter((entry) => entry.recordKey !== args.recordKey);
  const cleared = !args.reviewed && !args.classification && !existing?.taskId;
  const next: TriageEntry = {
    recordKey: args.recordKey,
    reviewed: args.reviewed,
    classification: args.classification,
    updatedBy: existing?.updatedBy ?? null,
    updatedAt: Date.now(),
    taskId: existing?.taskId ?? null,
  };
  store.setQuery(api.procurementTriage.list, query, cleared ? others : [...others, next]);
}

/**
 * The workspace's triage, for a hosted reader to provide; null when it can't
 * be read (a deployment without it yet, say), and the reader then shows none
 * rather than failing.
 */
export function useWorkspaceTriage(societyId: string): ReaderTriage | null {
  // useQueries hands a server error back as a value; useQuery would throw it into the page.
  const queries = useMemo<RequestForQueries>(() => ({ list: { query: api.procurementTriage.list, args: { societyId } } }), [societyId]);
  const result = useQueries(queries).list as TriageEntry[] | Error | undefined;
  const rows = result instanceof Error ? undefined : result;
  const setTriage = useMutation(api.procurementTriage.set);
  const save = useMemo(() => setTriage.withOptimisticUpdate(applyOptimistically), [setTriage]);
  const create = useMutation(api.procurementTriage.createTask);
  const { can } = usePermissions();
  const canEdit = can("documents:write");
  const canCreateTask = canEdit && can("tasks:write");
  const entries = useMemo(
    () =>
      rows &&
      new Map(rows.map((row) => [row.recordKey, { ...row, classification: triageClassification(row.classification) }])),
    [rows],
  );
  const triage = useMemo<ReaderTriage>(
    () => ({
      entries,
      canEdit,
      canCreateTask,
      set: async (recordKey, next) => {
        await save({ societyId, recordKey, reviewed: next.reviewed, classification: next.classification });
      },
      createTask: async (recordKey, notice) =>
        (await create({ societyId, recordKey, notice })) as { taskId: string; created: boolean },
    }),
    [entries, canEdit, canCreateTask, save, create, societyId],
  );
  return result instanceof Error ? null : triage;
}

/** The facts an action item is written from, out of a list row or a notice. */
export function triageTaskNotice(notice: { title: string; buyer: string; date?: string; dateText?: string; reference?: string }): TriageTaskNotice {
  return {
    title: notice.title,
    buyer: notice.buyer,
    closes: /^\d{4}-\d{2}-\d{2}/.exec(notice.date ?? "")?.[0] ?? "",
    closesText: notice.dateText ?? "",
    reference: notice.reference ?? "",
  };
}

/** Where an action item opens: its own panel in Tasks. */
export const taskHref = (taskId: string) => `/app/tasks?record=${encodeURIComponent(taskId)}`;
