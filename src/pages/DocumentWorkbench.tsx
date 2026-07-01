import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { renderAsync } from "docx-preview";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { SignaturePanel } from "../components/SignaturePanel";
import { useToast } from "../components/Toast";
import { formatDateTime } from "../lib/format";
import { openDocumentDownloadTarget } from "../lib/documentStorage";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FileWarning,
  Loader2,
  MessageSquare,
  PenLine,
  Save,
  Trash2,
} from "lucide-react";

export function DocumentWorkbenchPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const userId = useCurrentUserId() ?? undefined;
  const document = useQuery(api.documents.get, id ? { id: id as Id<"documents">, actingUserId: userId } : "skip");
  const latest = useQuery(api.documentVersions.latest, id ? { documentId: id as Id<"documents"> } : "skip");
  const legacyUrl = useQuery(api.files.getUrl, document?.storageId ? { storageId: document.storageId } : "skip");
  const comments = useQuery(api.documentComments.listForDocument, id ? { documentId: id as Id<"documents"> } : "skip");
  const signatures = useQuery(api.signatures.listForEntity, id ? { entityType: "document", entityId: id } : "skip");
  const markOpened = useMutation(api.documents.markOpened);
  const updateReviewStatus = useMutation(api.documents.updateReviewStatus);
  const createComment = useMutation(api.documentComments.create);
  const setCommentStatus = useMutation(api.documentComments.setStatus);
  const removeComment = useMutation(api.documentComments.remove);
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const user = useCurrentUser();
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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!document) return <PageLoading />;

  const openFile = async () => {
    if (latest) {
      const target = await getDownloadTarget({ versionId: latest._id });
      if (!target) return;
      if (target.kind === "url" && target.url?.startsWith("demo://")) {
        toast.info("Demo mode — no stored file is available.");
        return;
      }
      await openDocumentDownloadTarget(target);
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
                <DocumentPreviewPane
                  getDownloadTarget={getDownloadTarget}
                  versionId={latest?._id}
                  fallbackUrl={legacyUrl ?? document.url ?? null}
                  fileName={document.fileName ?? undefined}
                  hasAnyFile={downloadAvailable}
                />
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
                <MarkdownEditor
                  rows={3}
                  value={draft.body}
                  onChange={(markdown) => setDraft({ ...draft, body: markdown })}
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

type PreviewStatus = "loading" | "pdf" | "docx" | "unsupported" | "unavailable" | "error";

/**
 * Renders the real file inline where possible instead of a static placeholder:
 * PDFs via a browser-native iframe, .docx via the same docx-preview library the
 * minutes preview already uses (rendering the actual uploaded bytes, not a
 * built-from-HTML approximation). Everything else falls back to a clear
 * "use Open file" message rather than pretending to show content it can't.
 */
function DocumentPreviewPane({
  getDownloadTarget,
  versionId,
  fallbackUrl,
  fileName,
  hasAnyFile,
}: {
  getDownloadTarget: (args: { versionId: Id<"documentVersions"> }) => Promise<any>;
  versionId: Id<"documentVersions"> | undefined;
  fallbackUrl: string | null;
  fileName: string | undefined;
  hasAnyFile: boolean;
}) {
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let createdBlobUrl: string | null = null;
    setStatus("loading");
    setPdfBlobUrl(null);
    if (!hasAnyFile) {
      setStatus("unavailable");
      return;
    }
    (async () => {
      try {
        let url = fallbackUrl;
        let mimeType: string | undefined;
        if (versionId) {
          const target = await getDownloadTarget({ versionId });
          if (target?.kind === "url") {
            url = target.url ?? url;
            mimeType = target.mimeType;
          }
        }
        if (cancelled) return;
        if (!url || url.startsWith("demo://")) {
          setStatus("unavailable");
          return;
        }
        const lowerName = (fileName ?? "").toLowerCase();
        const isPdf = mimeType?.includes("pdf") || lowerName.endsWith(".pdf");
        const isDocx = mimeType?.includes("wordprocessingml") || lowerName.endsWith(".docx");
        if (!isPdf && !isDocx) {
          setStatus("unsupported");
          return;
        }
        // Fetch and re-host as a same-origin blob: URL rather than framing the
        // storage URL directly — keeps the CSP's frame-src scoped to
        // 'self' data: blob: instead of needing to allowlist every possible
        // storage host, and works identically for data: URLs (demo) and real
        // remote storage URLs (hosted deployments).
        const response = await fetch(url);
        if (!response.ok) throw new Error("Couldn't load the file");
        const blob = await response.blob();
        if (cancelled) return;
        if (isPdf) {
          createdBlobUrl = URL.createObjectURL(blob);
          setPdfBlobUrl(createdBlobUrl);
          setStatus("pdf");
          return;
        }
        const container = renderRef.current;
        if (!container) throw new Error("Preview container missing");
        container.replaceChildren();
        await renderAsync(blob, container);
        if (cancelled) return;
        setStatus("docx");
      } catch (error) {
        console.error("Failed to render document preview", error);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [getDownloadTarget, versionId, fallbackUrl, fileName, hasAnyFile]);

  return (
    <div className="document-preview-pane">
      {status === "loading" && (
        <div className="minutes-docx-preview__status">
          <Loader2 size={18} className="minutes-docx-preview__spinner" aria-hidden />
          <span>Loading preview…</span>
        </div>
      )}
      {status === "pdf" && pdfBlobUrl && (
        <iframe src={pdfBlobUrl} title="Document preview" className="document-preview-pane__pdf" />
      )}
      {status === "unsupported" && (
        <div className="minutes-docx-preview__status">
          <span>Preview isn't available for this file type — use "Open file" above to view or download it.</span>
        </div>
      )}
      {status === "unavailable" && (
        <div className="minutes-docx-preview__status">
          <span>{hasAnyFile ? "No previewable file could be loaded." : "No file is attached to this document — it's a metadata-only record."}</span>
        </div>
      )}
      {status === "error" && (
        <div className="minutes-docx-preview__status">
          <FileWarning size={18} aria-hidden />
          <span>Couldn't render a preview — "Open file" above still works.</span>
        </div>
      )}
      <div
        ref={renderRef}
        className="minutes-docx-preview__render"
        style={{ display: status === "docx" ? "block" : "none" }}
      />
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
