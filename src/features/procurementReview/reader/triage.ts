/**
 * The workspace's bid triage in the reader (shared/procurementTriage.ts,
 * convex/procurementTriage.ts). It belongs to the workspace, not to a catalog
 * publication, so it is its own context beside the reader source: both hosted
 * readers (the Convex copy and the catalog service) provide it from one live
 * query, and the list and the notice page join it by record key. The offline
 * snapshot and the demo provide none, and show no triage.
 *
 * Action items are tasks holding the opportunity as an attachment
 * (taskAttachments): read from their own query, so the triage still works
 * when they can't be read, and the action-item choices then stay hidden.
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
import type { TaskAttachmentOnTask } from "../../../../shared/taskAttachments";

/** One opportunity's saved triage, as procurementTriage:list returns it. */
export type TriageEntry = Triage & {
  recordKey: string;
  updatedBy: string | null;
  updatedAt: number;
};

/** A task an opportunity is on. */
export type ActionItem = { taskId: string; title: string; status: string };

export type ReaderTriage = {
  /** The workspace the triage belongs to. */
  societyId: string;
  /** Saved triage by record key; undefined while it loads. */
  entries: ReadonlyMap<string, TriageEntry> | undefined;
  /** documents:write: may change the triage. */
  canEdit: boolean;
  /** tasks:write as well: may make an action item or add to one. */
  canCreateTask: boolean;
  /**
   * The tasks each opportunity is on, by record key (opportunities on none
   * are absent); undefined while they load or when they can't be read.
   */
  actionItems: ReadonlyMap<string, readonly ActionItem[]> | undefined;
  /** Saves for the whole workspace; shows at once, and rolls back if the save fails. */
  set(recordKey: string, next: Triage): Promise<void>;
  /** A new task holding the opportunity; while it is on one, only with `another`. */
  createTask(recordKey: string, notice: TriageTaskNotice, another?: boolean): Promise<{ taskId: string; created: boolean }>;
  /** Put the opportunity on a task that exists. */
  addToTask(taskId: string, recordKey: string, notice: TriageTaskNotice): Promise<{ created: boolean }>;
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
  const cleared = !args.reviewed && !args.classification;
  const next: TriageEntry = {
    recordKey: args.recordKey,
    reviewed: args.reviewed,
    classification: args.classification,
    updatedBy: existing?.updatedBy ?? null,
    updatedAt: Date.now(),
  };
  store.setQuery(api.procurementTriage.list, query, cleared ? others : [...others, next]);
}

/**
 * The workspace's triage, for a hosted reader to provide; null when it can't
 * be read (a deployment without it yet, say), and the reader then shows none
 * rather than failing.
 */
export function useWorkspaceTriage(societyId: string): ReaderTriage | null {
  const { can } = usePermissions();
  const canReadTasks = can("tasks:read");
  // useQueries hands a server error back as a value; useQuery would throw it into the page.
  const queries = useMemo<RequestForQueries>(
    () => ({
      list: { query: api.procurementTriage.list, args: { societyId } },
      ...(canReadTasks ? { attachments: { query: api.taskAttachments.listByKind, args: { societyId, kind: "opportunity" } } } : {}),
    }),
    [societyId, canReadTasks],
  );
  const results = useQueries(queries);
  const result = results.list as TriageEntry[] | Error | undefined;
  const rows = result instanceof Error ? undefined : result;
  const attachments = results.attachments as TaskAttachmentOnTask[] | Error | undefined;
  const actionItems = useMemo(() => {
    if (!attachments || attachments instanceof Error) return undefined;
    const byRecord = new Map<string, ActionItem[]>();
    for (const row of attachments) {
      const items = byRecord.get(row.refKey) ?? [];
      items.push({ taskId: row.taskId, title: row.task.title, status: row.task.status });
      byRecord.set(row.refKey, items);
    }
    for (const items of byRecord.values()) items.sort((a, b) => a.title.localeCompare(b.title));
    return byRecord;
  }, [attachments]);
  const setTriage = useMutation(api.procurementTriage.set);
  const save = useMemo(() => setTriage.withOptimisticUpdate(applyOptimistically), [setTriage]);
  const create = useMutation(api.procurementTriage.createTask);
  const attach = useMutation(api.taskAttachments.attach);
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
      societyId,
      entries,
      canEdit,
      canCreateTask,
      actionItems,
      set: async (recordKey, next) => {
        await save({ societyId, recordKey, reviewed: next.reviewed, classification: next.classification });
      },
      createTask: async (recordKey, notice, another) =>
        (await create({ societyId, recordKey, notice, ...(another ? { another: true } : {}) })) as { taskId: string; created: boolean },
      addToTask: async (taskId, recordKey, notice) =>
        (await attach({ taskId, kind: "opportunity", refKey: recordKey, snapshot: attachmentSnapshot(notice) })) as { created: boolean },
    }),
    [entries, canEdit, canCreateTask, actionItems, save, create, attach, societyId],
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

/** What a task's attachment shows of the notice. */
function attachmentSnapshot(notice: TriageTaskNotice) {
  return {
    title: notice.title.trim() || "Untitled notice",
    ...(notice.buyer.trim() ? { subtitle: notice.buyer.trim() } : {}),
    ...(notice.closes ? { dueDate: notice.closes } : {}),
    ...(notice.closesText.trim() ? { dueText: notice.closesText.trim() } : {}),
  };
}

/** Where an action item opens: its own panel in Tasks. */
export const taskHref = (taskId: string) => `/app/tasks?record=${encodeURIComponent(taskId)}`;
