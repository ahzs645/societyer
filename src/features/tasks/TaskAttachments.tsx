/**
 * The task drawer's "Attachments": what the work is about (shared/taskAttachments.ts).
 * Documents are added here from the workspace's documents, any number;
 * opportunities are added from procurement review and listed here with their
 * buyer and closing date. Each opens and can be removed. Unlike the form
 * above, every change saves at once.
 *
 * Also `useTaskAttachmentKinds`, which adds attachments to the Tasks table's
 * read-only "Linked to" column.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import { FileSearch, FileText, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { usePermissions } from "../../hooks/usePermissions";
import { formatDate } from "../../lib/format";
import { documentHref, opportunityHref, type TaskAttachment, type TaskAttachmentOnTask } from "../../../shared/taskAttachments";
import type { TaskLinkKind } from "./taskModel";

type DocumentOption = { _id: string; title?: string };

export function TaskAttachments({
  taskId,
  documents,
  canManage,
}: {
  taskId: string;
  /** The workspace's documents the reader may open (the form's data). */
  documents: readonly DocumentOption[] | undefined;
  canManage: boolean;
}) {
  const toast = useToast();
  // useQueries hands a server error back as a value; the drawer then says so instead of failing.
  const queries = useMemo<RequestForQueries>(() => ({ list: { query: api.taskAttachments.listForTask, args: { taskId } } }), [taskId]);
  const result = useQueries(queries).list as TaskAttachment[] | Error | undefined;
  const attach = useMutation(api.taskAttachments.attach);
  const detach = useMutation(api.taskAttachments.detach);
  const attachments = result instanceof Error ? [] : result ?? [];
  const attachedDocuments = new Set(attachments.filter((row) => row.kind === "document").map((row) => row.refKey));
  const options = (documents ?? [])
    .filter((document) => !attachedDocuments.has(String(document._id)))
    .map((document) => ({ value: String(document._id), label: document.title || "Untitled document" }));

  const add = async (documentId: string) => {
    if (!documentId) return;
    try {
      await attach({ taskId, kind: "document", refKey: documentId });
    } catch (error) {
      toast.error("Couldn't attach the document", error instanceof Error ? error.message : "Try again in a moment.");
    }
  };
  const remove = async (row: TaskAttachment) => {
    try {
      await detach({ id: row._id });
      toast.success("Removed from the task", row.title);
    } catch (error) {
      toast.error("Couldn't remove it", error instanceof Error ? error.message : "Try again in a moment.");
    }
  };

  return (
    <section className="task-attachments" aria-label="Attachments">
      <div className="task-attachments__head">
        <span className="task-attachments__title">Attachments</span>
        {attachments.length > 0 && <span className="task-attachments__count">{attachments.length}</span>}
      </div>
      {result instanceof Error ? (
        <p className="muted small">Attachments can't be shown right now.</p>
      ) : result === undefined ? (
        <p className="muted small">Loading…</p>
      ) : attachments.length === 0 ? (
        <p className="muted small">Nothing attached yet.</p>
      ) : (
        <ul className="task-attachments__items">
          {attachments.map((row) => (
            <li key={row._id} className="task-attachments__item">
              <span className="task-attachments__icon" aria-hidden="true">
                {row.kind === "opportunity" ? <FileSearch size={14} /> : <FileText size={14} />}
              </span>
              <span className="task-attachments__body">
                <Link className="task-attachments__link" to={row.kind === "opportunity" ? opportunityHref(row.refKey) : documentHref(row.refKey)}>
                  {row.title || (row.kind === "opportunity" ? "Untitled notice" : "Untitled document")}
                </Link>
                {row.kind === "opportunity" && (row.subtitle || row.dueDate || row.dueText) && (
                  <span className="task-attachments__meta">
                    {[row.subtitle, row.dueText || row.dueDate ? `Closes ${row.dueText || formatDate(row.dueDate ?? "")}` : ""].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {canManage && (
                <button type="button" className="btn btn--ghost btn--sm btn--icon task-attachments__remove" aria-label={`Remove ${row.title} from the task`} onClick={() => void remove(row)}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <Select
          value=""
          placeholder={documents === undefined ? "Loading documents…" : "Attach a document"}
          aria-label="Attach a document"
          sheetTitle="Attach a document"
          disabled={!options.length || result instanceof Error}
          searchable
          onChange={(documentId) => void add(documentId)}
          options={options}
        />
      )}
      {canManage && (
        <p className="muted small">Saved as soon as you add or remove one. Opportunities are added from Procurement review.</p>
      )}
    </section>
  );
}

/**
 * What each task holds, as values of the Tasks table's "Linked to" column:
 * attached documents read as "document", opportunities as "opportunity".
 * Empty where attachments can't be read (procurement off, say).
 */
export function useTaskAttachmentKinds(societyId: string | undefined): ReadonlyMap<string, readonly TaskLinkKind[]> {
  const { can } = usePermissions();
  const canRead = can("tasks:read");
  const queries = useMemo(() => {
    const request: RequestForQueries = {};
    if (societyId && canRead) {
      request.document = { query: api.taskAttachments.listByKind, args: { societyId, kind: "document" } };
      request.opportunity = { query: api.taskAttachments.listByKind, args: { societyId, kind: "opportunity" } };
    }
    return request;
  }, [societyId, canRead]);
  const results = useQueries(queries);
  const documentRows = results.document as TaskAttachmentOnTask[] | Error | undefined;
  const opportunityRows = results.opportunity as TaskAttachmentOnTask[] | Error | undefined;
  return useMemo(() => {
    const kinds = new Map<string, TaskLinkKind[]>();
    for (const [kind, rows] of [["document", documentRows], ["opportunity", opportunityRows]] as const) {
      if (!rows || rows instanceof Error) continue;
      for (const row of rows) {
        const list = kinds.get(row.taskId) ?? [];
        if (!list.includes(kind)) list.push(kind);
        kinds.set(row.taskId, list);
      }
    }
    return kinds;
  }, [documentRows, opportunityRows]);
}

/** A task's "Linked to" values with what it holds added (each once). */
export function withAttachmentKinds(linked: TaskLinkKind[], attached: readonly TaskLinkKind[] | undefined): TaskLinkKind[] {
  if (!attached?.length) return linked;
  return [...linked, ...attached.filter((kind) => !linked.includes(kind))];
}
