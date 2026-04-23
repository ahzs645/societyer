import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import {
  Inbox,
  Plus,
  CheckCircle2,
  XCircle,
  Send,
  Copy,
  Paperclip,
  Trash2,
} from "lucide-react";
import { formatDateTime } from "../lib/format";
import {
  RecordTable,
  RecordTableScope,
  RecordTableToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

type PendingEmail = {
  _id: string;
  societyId: string;
  workflowId?: string;
  workflowRunId?: string;
  nodeKey?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments: { documentId: string; fileName: string }[];
  status: string;
  createdAtISO: string;
  sentAtISO?: string;
  sentChannel?: string;
  notes?: string;
};

const STATUS_TONE: Record<string, "neutral" | "warn" | "success" | "danger" | "info"> = {
  draft: "neutral",
  ready: "warn",
  sent: "success",
  cancelled: "danger",
};

/**
 * Outbox of queued / sent emails. Metadata-driven columns; mutations
 * (mark-sent, cancel, delete) fire from row actions because the
 * underlying rows are a state machine, not free-edit rows.
 */
export function OutboxPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const confirm = useConfirm();
  const emails = useQuery(
    api.pendingEmails.list,
    society ? { societyId: society._id } : "skip",
  );
  const documents = useQuery(
    api.documents.list,
    society ? { societyId: society._id } : "skip",
  );
  const create = useMutation(api.pendingEmails.create);
  const update = useMutation(api.pendingEmails.update);
  const markSent = useMutation(api.pendingEmails.markSent);
  const cancel = useMutation(api.pendingEmails.cancel);
  const remove = useMutation(api.pendingEmails.remove);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<PendingEmail | null>(null);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "outboxMessage",
    viewId: currentViewId,
  });

  const documentsById = useMemo(
    () => new Map<string, any>((documents ?? []).map((d: any) => [d._id, d])),
    [documents],
  );

  // Derive `attachmentCount` on each record so the metadata-driven
  // column has something to display. Keeps the Convex schema clean —
  // the count is computed from `attachments.length` client-side.
  const records = useMemo(
    () =>
      (emails ?? []).map((email: any) => ({
        ...email,
        attachmentCount: email.attachments?.length ?? 0,
      })),
    [emails],
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const openNew = () => {
    setSelected({
      _id: "",
      societyId: society._id as any,
      to: "",
      subject: "",
      body: "",
      attachments: [],
      status: "draft",
      createdAtISO: new Date().toISOString(),
    });
    setDrawerOpen(true);
  };

  const openExisting = (row: PendingEmail) => {
    setSelected({ ...row });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!selected) return;
    const { _id, societyId: _s, createdAtISO: _c, sentAtISO: _sa, ...rest } = selected;
    if (_id) {
      await update({
        id: _id as any,
        patch: {
          fromName: rest.fromName,
          fromEmail: rest.fromEmail,
          replyTo: rest.replyTo,
          to: rest.to,
          cc: rest.cc,
          bcc: rest.bcc,
          subject: rest.subject,
          body: rest.body,
          attachments: rest.attachments,
          status: rest.status,
          notes: rest.notes,
        },
        actingUserId,
      });
      toast.success("Saved");
    } else {
      const id = await create({
        societyId: society._id,
        fromName: rest.fromName,
        fromEmail: rest.fromEmail,
        replyTo: rest.replyTo,
        to: rest.to,
        cc: rest.cc,
        bcc: rest.bcc,
        subject: rest.subject,
        body: rest.body,
        attachments: rest.attachments,
        status: rest.status ?? "ready",
        notes: rest.notes,
        actingUserId,
      });
      toast.success("Email queued");
      setSelected({ ...selected, _id: id as unknown as string });
    }
  };

  const doMarkSent = async (row: PendingEmail, channel: string = "personal_email") => {
    await markSent({ id: row._id as any, sentChannel: channel, actingUserId });
    toast.success("Marked as sent");
    if (selected?._id === row._id) {
      setSelected({ ...row, status: "sent", sentAtISO: new Date().toISOString(), sentChannel: channel });
    }
  };

  const doCancel = async (row: PendingEmail) => {
    const reason = await confirm({
      title: "Cancel this draft?",
      message: "The email will stay in the outbox marked cancelled.",
      confirmLabel: "Cancel draft",
      tone: "danger",
    });
    if (!reason) return;
    await cancel({ id: row._id as any, actingUserId });
    toast.success("Cancelled");
  };

  const doDelete = async (row: PendingEmail) => {
    const ok = await confirm({
      title: "Delete pending email?",
      message: "This removes the record entirely.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id as any, actingUserId });
    toast.success("Deleted");
    setDrawerOpen(false);
  };

  const mailtoHref = (row: PendingEmail | null) => {
    if (!row) return "#";
    const params = new URLSearchParams();
    if (row.cc) params.set("cc", row.cc);
    if (row.bcc) params.set("bcc", row.bcc);
    params.set("subject", row.subject ?? "");
    params.set("body", row.body ?? "");
    return `mailto:${encodeURIComponent(row.to)}?${params.toString()}`;
  };

  const copyBody = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard not available");
    }
  };

  const addAttachment = (doc: any) => {
    if (!selected) return;
    if (selected.attachments.some((a) => a.documentId === doc._id)) return;
    setSelected({
      ...selected,
      attachments: [
        ...selected.attachments,
        { documentId: doc._id, fileName: doc.fileName ?? doc.title ?? "attachment" },
      ],
    });
  };

  const removeAttachment = (documentId: string) => {
    if (!selected) return;
    setSelected({
      ...selected,
      attachments: selected.attachments.filter((a) => a.documentId !== documentId),
    });
  };

  return (
    <div className="page">
      <PageHeader
        title="Outbox"
        icon={<Inbox size={16} />}
        iconColor="orange"
        subtitle="Queue manual-send emails when no email provider is configured. Review content, attach documents, then mark each one sent once you've dispatched it from your own inbox."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New draft
          </button>
        }
      />

      {showMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            outbox object metadata + default view.
          </div>
        </div>
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="outbox"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_, row) => openExisting(row as PendingEmail)}
        >
          <RecordTableToolbar
            icon={<Inbox size={14} />}
            label="Pending emails"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || emails === undefined}
            emptyState={
              <div className="record-table__empty">
                <div className="record-table__empty-title">No queued emails yet</div>
                <div className="record-table__empty-desc">
                  Create a draft or queue one from a workflow Email node.
                </div>
              </div>
            }
            renderCell={({ record, field, value }) => {
              // Show attachment-count as the familiar paperclip + number
              // rather than a bare number, and fold it into the subject
              // cell for continuity with the old layout.
              if (field.name === "subject") {
                return (
                  <div>
                    <strong>{String(value) || "(no subject)"}</strong>
                    {record.attachmentCount > 0 && (
                      <span className="muted" style={{ marginLeft: 6, fontSize: "var(--fs-xs)" }}>
                        <Paperclip size={10} /> {record.attachmentCount}
                      </span>
                    )}
                  </div>
                );
              }
              return undefined;
            }}
            renderRowActions={(row: PendingEmail) =>
              row.status === "sent" || row.status === "cancelled" ? (
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label="Delete record"
                  onClick={() => doDelete(row)}
                >
                  <Trash2 size={12} />
                </button>
              ) : (
                <>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => doMarkSent(row)}
                    title="Mark this email as sent"
                  >
                    <CheckCircle2 size={12} /> Mark sent
                  </button>
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label="Cancel draft"
                    onClick={() => doCancel(row)}
                  >
                    <XCircle size={12} />
                  </button>
                </>
              )
            }
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setAttachPickerOpen(false);
        }}
        title={selected?._id ? "Edit pending email" : "New pending email"}
        footer={
          <>
            <button className="btn" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
            {selected && selected.status !== "sent" && (
              <button className="btn btn--accent" onClick={save}>
                Save
              </button>
            )}
          </>
        }
      >
        {selected && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <span
                className="badge"
                data-tone={STATUS_TONE[selected.status] ?? "neutral"}
              >
                {selected.status}
              </span>
              {selected.sentAtISO && (
                <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                  Sent {formatDateTime(selected.sentAtISO)}
                </span>
              )}
            </div>

            <div className="row" style={{ gap: 12 }}>
              <Field label="From name">
                <input
                  className="input"
                  value={selected.fromName ?? ""}
                  onChange={(e) => setSelected({ ...selected, fromName: e.target.value })}
                  disabled={selected.status === "sent"}
                />
              </Field>
              <Field label="From email">
                <input
                  className="input"
                  value={selected.fromEmail ?? ""}
                  onChange={(e) => setSelected({ ...selected, fromEmail: e.target.value })}
                  disabled={selected.status === "sent"}
                />
              </Field>
            </div>
            <Field label="To">
              <input
                className="input"
                value={selected.to}
                onChange={(e) => setSelected({ ...selected, to: e.target.value })}
                disabled={selected.status === "sent"}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Reply-To">
                <input
                  className="input"
                  value={selected.replyTo ?? ""}
                  onChange={(e) => setSelected({ ...selected, replyTo: e.target.value })}
                  disabled={selected.status === "sent"}
                />
              </Field>
              <Field label="CC">
                <input
                  className="input"
                  value={selected.cc ?? ""}
                  onChange={(e) => setSelected({ ...selected, cc: e.target.value })}
                  disabled={selected.status === "sent"}
                />
              </Field>
              <Field label="BCC">
                <input
                  className="input"
                  value={selected.bcc ?? ""}
                  onChange={(e) => setSelected({ ...selected, bcc: e.target.value })}
                  disabled={selected.status === "sent"}
                />
              </Field>
            </div>
            <Field label="Subject">
              <input
                className="input"
                value={selected.subject}
                onChange={(e) => setSelected({ ...selected, subject: e.target.value })}
                disabled={selected.status === "sent"}
              />
            </Field>
            <Field label="Body">
              <textarea
                className="textarea"
                rows={10}
                value={selected.body}
                onChange={(e) => setSelected({ ...selected, body: e.target.value })}
                disabled={selected.status === "sent"}
              />
            </Field>

            <Field label="Attachments">
              <div className="outbox-attachments">
                {selected.attachments.length === 0 && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    No attachments.
                  </div>
                )}
                {selected.attachments.map((att) => {
                  const doc = documentsById.get(att.documentId);
                  return (
                    <div key={att.documentId} className="outbox-attachment">
                      <Paperclip size={12} />
                      <div style={{ flex: 1 }}>
                        <div>{att.fileName}</div>
                        {doc && (
                          <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                            {doc.title} · {doc.category}
                          </div>
                        )}
                      </div>
                      {selected.status !== "sent" && (
                        <button
                          className="btn btn--ghost btn--sm btn--icon"
                          onClick={() => removeAttachment(att.documentId)}
                          aria-label={`Remove ${att.fileName}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {selected.status !== "sent" && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setAttachPickerOpen((v) => !v)}
                  >
                    <Paperclip size={12} /> {attachPickerOpen ? "Close picker" : "Add attachment"}
                  </button>
                )}
                {attachPickerOpen && (
                  <div className="outbox-doc-picker">
                    {(documents ?? []).length === 0 && (
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        No documents available.
                      </div>
                    )}
                    {(documents ?? []).map((doc: any) => (
                      <button
                        key={doc._id}
                        className="outbox-doc-pick"
                        onClick={() => {
                          addAttachment(doc);
                          setAttachPickerOpen(false);
                        }}
                      >
                        <strong>{doc.title ?? doc.fileName}</strong>
                        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                          {doc.fileName} · {doc.category}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            {selected.notes && (
              <Field label="Notes">
                <textarea
                  className="textarea"
                  rows={2}
                  value={selected.notes}
                  onChange={(e) => setSelected({ ...selected, notes: e.target.value })}
                  disabled={selected.status === "sent"}
                />
              </Field>
            )}

            <div className="outbox-drawer-actions">
              <a
                className="btn btn--ghost btn--sm"
                href={mailtoHref(selected)}
                target="_blank"
                rel="noreferrer"
              >
                <Send size={12} /> Open in mail client
              </a>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => copyBody(selected.body)}
              >
                <Copy size={12} /> Copy body
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => copyBody(selected.subject)}
              >
                <Copy size={12} /> Copy subject
              </button>
              {selected._id && selected.status !== "sent" && (
                <button
                  className="btn btn--accent btn--sm"
                  onClick={() => doMarkSent(selected)}
                >
                  <CheckCircle2 size={12} /> Mark sent
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
