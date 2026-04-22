import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { SignaturePanel } from "../components/SignaturePanel";
import { useToast } from "../components/Toast";
import { formatDateTime } from "../lib/format";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  MessageSquare,
  PenLine,
  Save,
  Trash2,
} from "lucide-react";

export function DocumentWorkbenchPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const document = useQuery(api.documents.get, id ? { id: id as Id<"documents"> } : "skip");
  const latest = useQuery(api.documentVersions.latest, id ? { documentId: id as Id<"documents"> } : "skip");
  const legacyUrl = useQuery(api.files.getUrl, document?.storageId ? { storageId: document.storageId } : "skip");
  const comments = useQuery(api.documentComments.listForDocument, id ? { documentId: id as Id<"documents"> } : "skip");
  const signatures = useQuery(api.signatures.listForEntity, id ? { entityType: "document", entityId: id } : "skip");
  const markOpened = useMutation(api.documents.markOpened);
  const updateReviewStatus = useMutation(api.documents.updateReviewStatus);
  const createComment = useMutation(api.documentComments.create);
  const setCommentStatus = useMutation(api.documentComments.setStatus);
  const removeComment = useMutation(api.documentComments.remove);
  const getDownloadUrl = useAction(api.documentVersions.getDownloadUrl);
  const user = useCurrentUser();
  const userId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const openedRef = useRef(false);
  const [draft, setDraft] = useState({
    pageNumber: "",
    anchorText: "",
    body: "",
  });

  useEffect(() => {
    if (!document || openedRef.current) return;
    openedRef.current = true;
    void markOpened({
      id: document._id,
      userId,
      actorName: user?.displayName,
    }).catch(() => undefined);
  }, [document?._id, markOpened, user?.displayName, userId]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!document) return <div className="page">Loading…</div>;

  const openFile = async () => {
    if (latest) {
      const url = await getDownloadUrl({ versionId: latest._id });
      if (!url) return;
      if (url.startsWith("demo://")) {
        toast.info("Demo mode — no stored file is available.");
        return;
      }
      window.open(url, "_blank");
      return;
    }
    if (legacyUrl) {
      window.open(legacyUrl, "_blank");
      return;
    }
    if (document.url) {
      window.open(document.url, "_blank");
      return;
    }
    toast.info("No file or URL is attached to this document.");
  };

  const saveComment = async () => {
    const body = draft.body.trim();
    if (!body) {
      toast.error("Add a comment first.");
      return;
    }
    await createComment({
      societyId: society._id,
      documentId: document._id,
      pageNumber: numberOrUndefined(draft.pageNumber),
      anchorText: draft.anchorText.trim() || undefined,
      authorName: user?.displayName ?? "Reviewer",
      authorUserId: userId,
      body,
    });
    setDraft({ pageNumber: "", anchorText: "", body: "" });
    toast.success("Comment added");
  };

  const reviewStatus = document.reviewStatus ?? "none";
  const openComments = (comments ?? []).filter((comment: any) => comment.status !== "resolved").length;
  const downloadAvailable = Boolean(latest || legacyUrl || document.url);

  return (
    <div className="page page--narrow">
      <Link to="/app/documents" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Documents
      </Link>

      <PageHeader
        title={document.title}
        icon={<FileText size={16} />}
        iconColor="gray"
        subtitle={`${document.category} · ${document.fileName ?? "metadata record"}`}
        actions={
          <>
            <Badge tone={reviewStatusTone(reviewStatus)}>{reviewStatusLabel(reviewStatus)}</Badge>
            <button className="btn-action" onClick={openFile}>
              {downloadAvailable ? <Download size={12} /> : <ExternalLink size={12} />}
              Open file
            </button>
          </>
        }
      />

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Review workbench</h2>
              <span className="card__subtitle">
                {openComments} open comment{openComments === 1 ? "" : "s"} · {(signatures ?? []).length} signature{(signatures ?? []).length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="card__body">
              <div className="pdf-layout">
                <div className="pdf-page">
                  <div className="pdf-line short" />
                  <div className="pdf-line" />
                  <div className="pdf-line" />
                  <div className="pdf-line short" />
                  <br />
                  <div className="pdf-line" />
                  <div className="pdf-line" />
                  <div className="pdf-line short" />
                  <div className="signature-box">
                    {document.fileName ?? document.title}
                  </div>
                </div>
                <aside className="pdf-side">
                  <div className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
                    <h3 style={{ marginTop: 0, fontSize: "var(--fs-md)" }}>Document state</h3>
                    <div className="col" style={{ gap: 6 }}>
                      <Detail label="Created">{formatDateTime(document.createdAtISO)}</Detail>
                      <Detail label="Last opened">{document.lastOpenedAtISO ? formatDateTime(document.lastOpenedAtISO) : "Not opened"}</Detail>
                      <Detail label="Version">{latest ? `v${latest.version}` : document.fileName ? "legacy file" : "metadata only"}</Detail>
                    </div>
                  </div>
                  <div className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
                    <h3 style={{ marginTop: 0, fontSize: "var(--fs-md)" }}>Status</h3>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {["none", "in_review", "needs_signature", "approved", "blocked"].map((status) => (
                        <button
                          key={status}
                          className={`btn btn--sm ${reviewStatus === status ? "btn--accent" : "btn--ghost"}`}
                          onClick={async () => {
                            await updateReviewStatus({
                              id: document._id,
                              reviewStatus: status === "none" ? undefined : status,
                              actorName: user?.displayName,
                            });
                            toast.success("Review status updated");
                          }}
                        >
                          {reviewStatusLabel(status)}
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <MessageSquare size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                Page comments
              </h2>
              <span className="card__subtitle">Document-level or page-specific notes</span>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <div className="structured-minutes-editor__grid">
                <Field label="Page">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={draft.pageNumber}
                    onChange={(event) => setDraft({ ...draft, pageNumber: event.target.value })}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Anchor text">
                  <input
                    className="input"
                    value={draft.anchorText}
                    onChange={(event) => setDraft({ ...draft, anchorText: event.target.value })}
                    placeholder="Optional text or section"
                  />
                </Field>
              </div>
              <Field label="Comment">
                <textarea
                  className="textarea"
                  rows={3}
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  placeholder="Add a question, requested change, or review note."
                />
              </Field>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn-action btn-action--primary" onClick={saveComment}>
                  <Save size={12} /> Add comment
                </button>
              </div>

              {(comments ?? []).map((comment: any) => (
                <div key={comment._id} className="panel" style={{ padding: 12, borderRadius: 8 }}>
                  <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                    <Badge tone={comment.status === "resolved" ? "success" : "warn"}>
                      {comment.status === "resolved" ? "Resolved" : "Open"}
                    </Badge>
                    <div style={{ flex: 1 }}>
                      <strong>{comment.authorName}</strong>
                      <span className="muted"> · {formatDateTime(comment.createdAtISO)}</span>
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        {comment.pageNumber ? `Page ${comment.pageNumber}` : "Document"}
                        {comment.anchorText ? ` · ${comment.anchorText}` : ""}
                      </div>
                      <p style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{comment.body}</p>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setCommentStatus({
                          id: comment._id,
                          status: comment.status === "resolved" ? "open" : "resolved",
                          actingUserId: userId,
                        })}
                      >
                        <CheckCircle2 size={12} />
                        {comment.status === "resolved" ? "Reopen" : "Resolve"}
                      </button>
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label="Delete comment"
                        onClick={() => removeComment({ id: comment._id })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {(comments ?? []).length === 0 && (
                <div className="muted">No comments yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <PenLine size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                Signature flow
              </h2>
            </div>
            <div className="card__body">
              <p className="muted" style={{ marginTop: 0, fontSize: "var(--fs-sm)" }}>
                Use this for board package acknowledgements, approval sign-off, or reimbursement receipt certification.
              </p>
            </div>
          </div>
          <SignaturePanel
            societyId={society._id}
            entityType="document"
            entityId={document._id}
            title="Document signatures"
          />
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function numberOrUndefined(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function reviewStatusLabel(status: string) {
  switch (status) {
    case "in_review": return "In review";
    case "needs_signature": return "Needs signature";
    case "approved": return "Approved";
    case "blocked": return "Blocked";
    default: return "Not reviewed";
  }
}

function reviewStatusTone(status: string) {
  switch (status) {
    case "approved": return "success" as const;
    case "needs_signature": return "warn" as const;
    case "blocked": return "danger" as const;
    case "in_review": return "info" as const;
    default: return "neutral" as const;
  }
}
