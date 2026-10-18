import { DocumentPreviewButton } from "../components/DocumentFilePreview";
import {PersonRecordLinks} from "../components/PersonRecordLinks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { DocumentPreviewPane } from "../components/DocumentPreviewPane";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { setStoredSocietyId, useSocieties, useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState, Field } from "../components/ui";
import { MarkdownEditor, type MarkdownEditorHandle } from "../components/MarkdownEditor";
import { SignaturePanel } from "../components/SignaturePanel";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { Select } from "../components/Select";
import { RecordNotFound } from "../components/RecordNotFound";
import { UnsupportedDetailsBadge } from "../components/UnsupportedDetailsBadge";
import { PaperlessDocumentAction } from "../components/PaperlessDocumentAction";
import { useRecordQuery } from "../hooks/useRecordQuery";
import { formatDate, formatDateTime } from "../lib/format";
import { documentHasFile, formatBytes, openDocumentFile, restoredDocumentFile } from "../lib/documentOpen";
import { hashBytes } from "../lib/workspaceArchive";
import {
  documentProvenance,
  parseDocumentContent,
  readableFields,
  sourceSystemLabel,
  type ReadableField,
} from "../../shared/documentProvenance";
import {
  DOCUMENT_REVIEW_STATUSES,
  documentReviewStatusLabel,
  documentReviewStatusTone,
  evidenceReviewStatusLabel,
  evidenceReviewStatusTone,
  normalizeDocumentReviewStatus,
} from "../../shared/documentReviewStatus";
import { documentCategoryLabel, documentCategoryOptions, normalizeDocumentCategory } from "../../shared/documentCategories";
import { governingDocumentAudience } from "../../shared/governingDocuments";
import { SOURCE_VERSION_STATUSES, SOURCE_VERSION_STATUS_LABELS, type SourceVersionStatus } from "../../shared/documentVersioning";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  Lock,
  MessageSquare,
  PenLine,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";

export function DocumentWorkbenchPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const userId = useCurrentUserId() ?? undefined;
  const document = useRecordQuery<any>(api.documents.get, id ? { id: id as Id<"documents"> } : "skip");
  // In-camera material this reader may not see comes back as a placeholder; nothing else about it is read.
  const withheld = document?.inCameraWithheld === "in_camera";
  // Panels read the document's versions, comments and signatures once it exists
  // (a missing or foreign id shows the not-found state, not a failed panel).
  const documentId = withheld ? undefined : document?._id as Id<"documents"> | undefined;
  const latest = useQuery(api.documentVersions.latest, documentId ? { documentId } : "skip");
  const legacyUrl = useQuery(api.files.getUrl, document?.storageId ? { storageId: document.storageId } : "skip");
  const comments = useQuery(api.documentComments.listForDocument, documentId ? { documentId } : "skip");
  const signatures = useQuery(api.signatures.listForEntity, documentId ? { entityType: "document", subjectId: String(documentId) } : "skip");
  const markOpened = useMutation(api.documents.markOpened);
  const updateReviewStatus = useMutation(api.documents.updateReviewStatus);
  const updateCategory = useMutation(api.documents.updateCategory);
  const createComment = useMutation(api.documentComments.create);
  const setCommentStatus = useMutation(api.documentComments.setStatus);
  const removeComment = useMutation(api.documentComments.remove);
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const convex = useConvex();
  const user = useCurrentUser();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const toast = useToast();
  const openedRef = useRef(false);
  const commentEditorRef = useRef<MarkdownEditorHandle>(null);
  const [draft, setDraft] = useState({
    pageNumber: "",
    anchorText: "",
    body: "",
  });
  const [savingComment, setSavingComment] = useState(false);
  const [savedOriginal, setSavedOriginal] = useState<{ bytes: number; verified: boolean | null } | null>(null);
  const provenance = useMemo(() => (document ? documentProvenance(document) : null), [document]);
  const openable = useMemo(() => document ? {
    _id: String(document._id),
    title: document.title,
    fileName: document.fileName ?? latest?.fileName,
    mimeType: document.mimeType ?? latest?.mimeType,
    url: document.url,
    storageId: document.storageId,
    sha256: provenance?.sha256 ?? latest?.sha256,
    latestVersionId: latest?._id,
  } : null, [document, latest, provenance]);

  const societies = useSocieties();
  const documentSocietyId = document?.societyId ? String(document.societyId) : undefined;
  const canSwitchToDocumentSociety = Boolean(documentSocietyId && societies?.some((candidate: any) => String(candidate._id) === documentSocietyId));
  useEffect(() => {
    if (!society || !documentSocietyId || documentSocietyId === String(society._id) || !canSwitchToDocumentSociety) return;
    setStoredSocietyId(documentSocietyId as Id<"societies">);
  }, [society?._id, documentSocietyId, canSwitchToDocumentSociety]);

  useEffect(() => {
    if (!document || withheld || openedRef.current) return;
    openedRef.current = true;
    void markOpened({
      id: document._id,
      userId,
      actorName: user?.displayName,
    }).catch(() => undefined);
  }, [document?._id, withheld, markOpened, user?.displayName, userId]);

  // "Original saved" indicator (finding D-03): a restored copy of the source
  // file on this device, checked against the SHA-256 recorded at import.
  useEffect(() => {
    let active = true;
    setSavedOriginal(null);
    if (!openable || latest === undefined) return;
    void restoredDocumentFile(openable).then(async (blob) => {
      if (!active || !blob) return;
      const expected = openable.sha256;
      const verified = expected ? (await hashBytes(await blob.arrayBuffer())) === expected : null;
      if (active) setSavedOriginal({ bytes: blob.size, verified });
    });
    return () => { active = false; };
  }, [openable?._id, openable?.latestVersionId, openable?.sha256, latest === undefined]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (document === undefined) return <PageLoading />;
  // P-O1: a document of another organization (a link, the palette, a search hit)
  // opens in that organization, so every panel reads the right workspace.
  if (document && documentSocietyId && documentSocietyId !== String(society._id) && canSwitchToDocumentSociety) return <PageLoading />;
  if (document === null) {
    return <RecordNotFound recordLabel="Document" backTo="/app/documents" backLabel="All documents" icon={<FileText size={16} />} />;
  }
  if (withheld) return <InCameraDocumentNotice document={document} />;

  const openFile = async () => {
    if (!openable) return;
    const result = await openDocumentFile(openable, {
      getDownloadTarget: (args) => getDownloadTarget(args as any),
      getLegacyUrl: (storageId) => convex.query(api.files.getUrl, { storageId }),
    });
    if (result === "simulated") toast.info("Demo mode — no stored file is available.");
    else if (result === "none") toast.info("No file or link is attached to this document.", "Upload the file from File history to keep a copy here.");
  };

  const saveComment = async () => {
    if (!canEdit || savingComment) return;
    const body = (commentEditorRef.current?.getMarkdown() ?? draft.body).trim();
    if (!body) {
      toast.error("Add a comment first.");
      return;
    }
    if (draft.pageNumber.trim() && (!Number.isInteger(Number(draft.pageNumber)) || Number(draft.pageNumber) < 1)) {
      toast.error("Page must be a positive whole number.");
      return;
    }
    setSavingComment(true);
    try {
      await createComment({
        societyId: society._id,
        documentId: document._id,
        pageNumber: numberOrUndefined(draft.pageNumber),
        anchorText: draft.anchorText.trim() || undefined,
        authorName: user?.displayName ?? "Reviewer",
        authorUserId: userId,
        body,
      });
      commentEditorRef.current?.setMarkdown("");
      setDraft({ pageNumber: "", anchorText: "", body: "" });
      toast.success("Comment added");
    } catch (error: any) {
      toast.error("Could not add comment", error?.message ?? String(error));
    } finally {
      setSavingComment(false);
    }
  };

  const reviewStatus = normalizeDocumentReviewStatus(document.reviewStatus);
  const openComments = (comments ?? []).filter((comment: any) => comment.status !== "resolved").length;
  const downloadAvailable = Boolean(openable && documentHasFile(openable)) || Boolean(legacyUrl);
  const fileName = document.fileName ?? latest?.fileName;

  return (
    <div className="page document-workbench-page">
      <Link to="/app/documents" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Documents
      </Link>

      <PageHeader
        title={document.title}
        icon={<FileText size={16} />}
        iconColor="gray"
        subtitle={`${documentCategoryLabel(document.category)} · ${fileName ?? "metadata record"}${provenance?.sourceSystem ? ` · from ${sourceSystemLabel(provenance.sourceSystem)}` : ""}`}
        actions={
          <>
            <UnsupportedDetailsBadge table="documents" id={document._id} />
            <PaperlessDocumentAction societyId={society._id} documentId={document._id} disabled={!canEdit || !downloadAvailable} />
            <button className="btn-action" disabled={!downloadAvailable} onClick={() => { void openFile().catch((error: any) => toast.error("Could not open document", error?.message ?? String(error))); }}>
              {savedOriginal || latest ? <Download size={12} /> : <ExternalLink size={12} />}
              {savedOriginal ? "Open saved original" : latest ? "Open file" : document.url ? "Open source link" : "Open file"}
            </button>
          </>
        }
      />
      {document.preparationReviewWarning && <p className="muted" role="alert">{document.preparationReviewWarning}</p>}
      {document.archivedAtISO && <p className="muted" role="status">Archived {formatDate(document.archivedAtISO)}{document.archivedReason ? ` — ${document.archivedReason}` : ""}</p>}
      {permissions.loaded && !canEdit && <p className="muted">Your role can read this document. Document editing permission is required to change review status or comments.</p>}

      <div className="document-workbench-layout">
        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          {!downloadAvailable && !extractedTextOf(document.content) ? (
            <p className="muted document-metadata-note" role="note">No file is attached to this document — it is a metadata record. Its source and content are shown below.</p>
          ) : (
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Review workbench</h2>
              {openable && downloadAvailable && <DocumentPreviewButton document={openable} label="Expand preview" />}
              <span className="card__subtitle">
                {openComments} open comment{openComments === 1 ? "" : "s"} · {(signatures ?? []).length} signature{(signatures ?? []).length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="card__body">
              <DocumentPreviewPane
                document={openable}
                getDownloadTarget={getDownloadTarget}
                fallbackUrl={legacyUrl ?? document.url ?? null}
                hasAnyFile={downloadAvailable}
                extractedText={extractedTextOf(document.content)}
                onOpenFile={() => { void openFile(); }}
              />
            </div>
          </div>
          )}

          <SourceDetailsCard document={document} provenance={provenance} savedOriginal={savedOriginal} latest={latest} />
          <DocumentVersionsPanel documentId={document._id} canEdit={canEdit} />
          <DocumentEvidencePanel documentId={document._id} />

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
                  ref={commentEditorRef}
                  rows={3}
                  value={draft.body}
                  onChange={(markdown) => setDraft({ ...draft, body: markdown })}
                  placeholder="Add a question, requested change, or review note."
                />
              </Field>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn-action btn-action--primary" disabled={!canEdit || savingComment} onClick={saveComment}>
                  <Save size={12} /> {savingComment ? "Adding…" : "Add comment"}
                </button>
              </div>

              {(comments ?? []).map((comment: any) => (
                <div key={comment._id} className="panel document-comment">
                  <Badge tone={comment.status === "resolved" ? "success" : "warn"}>
                    {comment.status === "resolved" ? "Resolved" : "Open"}
                  </Badge>
                  <div className="document-comment__meta">
                    <strong>{comment.authorName}</strong>
                    <span className="muted"> · {formatDateTime(comment.createdAtISO)}</span>
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {comment.pageNumber ? `Page ${comment.pageNumber}` : "Document"}
                      {comment.anchorText ? ` · ${comment.anchorText}` : ""}
                    </div>
                  </div>
                  {/* The body spans the full card width so it isn't squeezed
                      between the status badge and the actions on phones. */}
                  <p className="document-comment__body">{comment.body}</p>
                  <div className="row document-comment__actions" style={{ gap: 4 }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={!canEdit}
                      onClick={() => setCommentStatus({
                        id: comment._id,
                        status: comment.status === "resolved" ? "open" : "resolved",
                      }).catch((error: any) => toast.error("Could not update comment", error?.message ?? String(error)))}
                    >
                      <CheckCircle2 size={12} />
                      {comment.status === "resolved" ? "Reopen" : "Resolve"}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label="Delete comment"
                      disabled={!canEdit}
                      onClick={() => removeComment({ id: comment._id }).catch((error: any) => toast.error("Could not delete comment", error?.message ?? String(error)))}
                    >
                      <Trash2 size={12} />
                    </button>
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
            <div className="card__head"><h2 className="card__title">Review status</h2></div>
            <div className="card__body">
              <div className="row document-status-buttons" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label="Review status">
                {DOCUMENT_REVIEW_STATUSES.map((status) => (
                  <button
                    key={status}
                    className={`btn btn--sm ${reviewStatus === status ? "btn--accent" : "btn--ghost"}`}
                    aria-pressed={reviewStatus === status}
                    disabled={!canEdit}
                    onClick={async () => {
                      try {
                        await updateReviewStatus({
                          id: document._id,
                          reviewStatus: status === "none" ? undefined : status,
                          actorName: user?.displayName,
                        });
                        toast.success("Review status updated", documentReviewStatusLabel(status));
                      } catch (error: any) {
                        toast.error("Could not update review status", error?.message ?? String(error));
                      }
                    }}
                  >
                    {documentReviewStatusLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><h2 className="card__title">Document state</h2></div>
            <div className="card__body col" style={{ gap: 6 }}>
              <Field label="Category">
                <Select
                  value={normalizeDocumentCategory(document.category)}
                  disabled={!canEdit}
                  searchable
                  options={documentCategoryOptions([document.category], governingDocumentAudience(society))}
                  onChange={async (value) => {
                    if (!value || value === normalizeDocumentCategory(document.category)) return;
                    try {
                      const result: any = await updateCategory({ id: document._id, category: value });
                      const label = documentCategoryLabel(result?.category ?? value, governingDocumentAudience(society));
                      // Re-filed as a governing document: it fills the empty profile field.
                      if (result?.filledLabel) toast.success(`${result.filledLabel} on file`, `Filed as ${label}. The organization profile now lists this document.`);
                      else toast.success("Category saved", label);
                    } catch (error: any) {
                      toast.error("Could not change the category", error?.message ?? String(error));
                    }
                  }}
                />
              </Field>
              <Detail label="Added">{formatDateTime(document.createdAtISO)}</Detail>
              {provenance?.sourceDate && <Detail label="Source date">{provenance.sourceDate}</Detail>}
              <Detail label="Last opened">{document.lastOpenedAtISO ? formatDateTime(document.lastOpenedAtISO) : "Not opened"}</Detail>
              <Detail label="File">{latest ? `v${latest.version}` : savedOriginal ? "saved original" : document.url ? "external link" : fileName ? "legacy file" : "metadata only"}</Detail>
            </div>
          </div>
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
      {/* Who the document names: below the document, not above its title. */}
      {document && society && <PersonRecordLinks societyId={String(document.societyId ?? society._id)} recordTable="documents" recordId={document._id} />}
    </div>
  );
}

/**
 * A document that holds in-camera content, for a reader without in-camera
 * access (security review H1): it exists and why it's withheld, nothing more.
 */
function InCameraDocumentNotice({ document }: { document: { category?: string; meetingId?: string; createdAtISO?: string } }) {
  return (
    <div className="page document-workbench-page">
      <Link to="/app/documents" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Documents
      </Link>
      <PageHeader
        title="In-camera material"
        icon={<Lock size={16} />}
        iconColor="gray"
        subtitle={`${documentCategoryLabel(document.category)}${document.createdAtISO ? ` · added ${formatDate(document.createdAtISO)}` : ""}`}
        actions={<Badge tone="warn">Restricted</Badge>}
      />
      <div role="status">
        <EmptyState
          icon={<Lock size={20} />}
          title="Restricted: in-camera material"
          description="This document holds content from an in-camera session, so its title, file and text aren't shown. Owners, Admins and Directors can open it. AI connectors never receive it."
          action={document.meetingId ? <Link className="btn" to={`/app/meetings/${document.meetingId}`}>Open the meeting</Link> : undefined}
        />
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

function extractedTextOf(content: unknown) {
  const parsed = parseDocumentContent(content);
  if (parsed.kind === "text") return String(parsed.value);
  if (parsed.kind === "json" && parsed.value && typeof parsed.value === "object") {
    const value = parsed.value as Record<string, any>;
    return typeof value.extractedText === "string" ? value.extractedText : typeof value.text === "string" ? value.text : undefined;
  }
  return undefined;
}

/* ------------------------------- source details ------------------------------ */

function SourceDetailsCard({ document, provenance, savedOriginal, latest }: {
  document: any;
  provenance: ReturnType<typeof documentProvenance> | null;
  savedOriginal: { bytes: number; verified: boolean | null } | null;
  latest: any;
}) {
  const parsed = useMemo(() => parseDocumentContent(document.content), [document.content]);
  const fields = useMemo(() => parsed.kind === "json" ? readableFields(parsed.value) : [], [parsed]);
  const sha = provenance?.sha256 ?? latest?.sha256;
  const size = formatBytes(document.fileSizeBytes ?? latest?.fileSizeBytes ?? savedOriginal?.bytes);
  const hasAnything = parsed.kind !== "none" || sha || provenance?.sourcePath || document.url || provenance?.externalIds.length;
  if (!hasAnything) return null;
  return (
    <div className="card document-source-card">
      <div className="card__head">
        <h2 className="card__title"><Link2 size={14} /> Source and content</h2>
        <span className="card__subtitle">Where this record came from and what was read from it</span>
      </div>
      <div className="card__body col" style={{ gap: 12 }}>
        <dl className="document-facts">
          {provenance?.sourceSystem && <><dt>Source</dt><dd>{sourceSystemLabel(provenance.sourceSystem)}</dd></>}
          {provenance?.sourcePath && <><dt>Path</dt><dd className="mono">{provenance.sourcePath}</dd></>}
          {provenance?.sourceDate && <><dt>Source date</dt><dd>{provenance.sourceDate}</dd></>}
          {document.url && /^https?:\/\//i.test(document.url) && <><dt>Link</dt><dd><a href={document.url} target="_blank" rel="noreferrer noopener">Open at source <ExternalLink size={11} /></a></dd></>}
          {!!provenance?.externalIds.length && <><dt>Source ids</dt><dd className="mono">{provenance.externalIds.slice(0, 4).join(", ")}</dd></>}
          {size && <><dt>Size</dt><dd>{size}</dd></>}
          {sha && <><dt>SHA-256</dt><dd className="mono document-facts__hash" title={sha}>{sha}</dd></>}
          <dt>Original</dt>
          <dd>
            {savedOriginal
              ? <span className="row" style={{ gap: 6 }}><ShieldCheck size={13} /> Saved on this device ({formatBytes(savedOriginal.bytes)}){savedOriginal.verified === true ? " · SHA-256 matches" : savedOriginal.verified === false ? " · SHA-256 differs from the recorded value" : ""}</span>
              : latest ? "Stored as an uploaded version" : document.url ? "Only the external link is kept" : "No file kept"}
          </dd>
          {provenance?.importSessionId && <><dt>Import</dt><dd><Link to={`/app/imports?sessionId=${encodeURIComponent(provenance.importSessionId)}`}>Import session</Link></dd></>}
        </dl>
        {parsed.kind === "text" && (
          <details className="document-content-text" open={String(parsed.value).length < 2000}>
            <summary>Document text ({String(parsed.value).length.toLocaleString()} characters)</summary>
            <pre>{String(parsed.value)}</pre>
          </details>
        )}
        {fields.length > 0 && <ReadableFieldList fields={fields} />}
      </div>
    </div>
  );
}

function ReadableFieldList({ fields }: { fields: ReadableField[] }) {
  return (
    <dl className="document-fields">
      {fields.map((field) => (
        <div key={field.path} className={`document-fields__item document-fields__item--${field.kind}`}>
          <dt>{field.label}</dt>
          <dd>
            {field.kind === "text" && <span>{field.value}</span>}
            {field.kind === "longText" && !(field.value ?? "").includes("\n") && (field.value ?? "").length < 1500 && (
              <p className="document-fields__prose">{field.value}</p>
            )}
            {field.kind === "longText" && ((field.value ?? "").includes("\n") || (field.value ?? "").length >= 1500) && (
              <details open={(field.value ?? "").length < 600}>
                <summary>{(field.value ?? "").length.toLocaleString()} characters</summary>
                <pre>{field.value}</pre>
              </details>
            )}
            {field.kind === "list" && (
              <ul>{(field.items ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul>
            )}
            {field.kind === "table" && (
              <div className="table-wrap document-fields__table">
                <table className="table">
                  <tbody>
                    {(field.rows ?? []).map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {field.kind === "group" && <ReadableFieldList fields={field.children ?? []} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------ versions panel ------------------------------ */

function DocumentVersionsPanel({ documentId, canEdit }: { documentId: string; canEdit: boolean }) {
  const data = useQuery(api.documents.versionsFor, { id: documentId });
  const setVersionInfo = useMutation(api.documents.setVersionInfo);
  const markDuplicate = useMutation(api.documents.markDuplicate);
  const clearDuplicate = useMutation(api.documents.clearDuplicate);
  const mergeDuplicates = useMutation(api.documents.mergeDuplicates);
  const confirm = useConfirm();
  const toast = useToast();
  if (!data) return null;
  const current = data.document;
  const duplicates: any[] = data.duplicates ?? [];
  const versions: any[] = data.versions ?? [];
  const canonical = duplicates.find((row) => row.isCanonical);
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not update this document");
    }
  };
  const merge = async () => {
    if (!canonical) return;
    const copies = duplicates.filter((row) => !row.isCanonical && !row.archivedAtISO);
    if (!copies.length) return;
    const ok = await confirm({
      title: `Merge ${copies.length} duplicate cop${copies.length === 1 ? "y" : "ies"}?`,
      message: `"${canonical.title}" stays as the record. ${copies.length} other cop${copies.length === 1 ? "y is" : "ies are"} archived and marked as duplicates; their tags, source ids, meeting packet links and source evidence move to the kept copy. Nothing is deleted.`,
      confirmLabel: "Merge duplicates",
    });
    if (!ok) return;
    await run(() => mergeDuplicates({ keepId: canonical._id, duplicateIds: copies.map((row) => row._id) }), "Duplicates merged");
  };
  return (
    <div className="card document-versions-card">
      <div className="card__head">
        <h2 className="card__title"><Layers size={14} /> Versions and duplicates</h2>
        <span className="card__subtitle">
          {duplicates.length > 1 ? `${duplicates.length} copies of this file` : "No duplicate copies"}
          {" · "}
          {versions.length > 1 ? `${versions.length} versions` : "no other versions found"}
        </span>
      </div>
      <div className="card__body col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="This file's version status" hint={current.sourceVersionStatusDetected ? "Read from the file name; choose to confirm or correct it." : undefined}>
            <Select
              value={current.sourceVersionStatus ?? ""}
              disabled={!canEdit}
              clearable
              onChange={(value) => { void run(() => setVersionInfo({ id: documentId, sourceVersionStatus: value || null }), "Version status saved"); }}
              options={SOURCE_VERSION_STATUSES.map((status) => ({ value: status, label: SOURCE_VERSION_STATUS_LABELS[status] }))}
            />
          </Field>
        </div>

        {duplicates.length > 1 && (
          <section aria-label="Duplicate copies">
            <h3 className="document-versions-card__heading"><Copy size={13} /> Same file ({duplicates[0]?.duplicateReason === "sha256" ? "identical bytes" : duplicates[0]?.duplicateReason === "source" ? "same source file" : "marked as duplicates"})</h3>
            <ul className="document-version-list">
              {duplicates.map((row) => (
                <li key={row._id} className={row.current ? "is-current" : undefined}>
                  <div className="document-version-list__main">
                    {row.current ? <strong>{row.title}</strong> : <Link to={`/app/documents/${row._id}`}>{row.title}</Link>}
                    <span className="muted">{[row.fileName && row.fileName !== row.title ? row.fileName : null, `added ${formatDate(row.createdAtISO)}`, row.archivedAtISO ? "archived" : null].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    {row.isCanonical ? <Badge tone="success">Kept record</Badge> : <Badge tone="warn">Copy</Badge>}
                    {row.duplicateOfDocumentId && row.current && canEdit && (
                      <button className="btn btn--ghost btn--sm" onClick={() => { void run(() => clearDuplicate({ id: documentId }), "Duplicate mark cleared"); }}>Clear mark</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {canEdit && canonical && duplicates.some((row) => !row.isCanonical && !row.archivedAtISO) && (
              <button className="btn-action" onClick={() => { void merge(); }}><Copy size={12} /> Merge copies into the kept record</button>
            )}
          </section>
        )}

        {versions.length > 1 && (
          <section aria-label="Versions">
            <h3 className="document-versions-card__heading"><Layers size={13} /> Versions of this record {data.versionKeySource === "name" ? <span className="muted">(matched by file name)</span> : null}</h3>
            <ol className="document-version-list">
              {versions.map((row) => (
                <li key={row._id} className={row.current ? "is-current" : undefined}>
                  <div className="document-version-list__main">
                    {row.current ? <strong>{row.title}</strong> : <Link to={`/app/documents/${row._id}`}>{row.title}</Link>}
                    <span className="muted">{[row.sourceDate, row.sourceSystemLabel, row.archivedAtISO ? "archived" : null].filter(Boolean).join(" · ") || `added ${formatDate(row.createdAtISO)}`}</span>
                  </div>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {row.sourceVersionStatus && <Badge tone={row.sourceVersionStatus === "approved" || row.sourceVersionStatus === "signed" ? "success" : "neutral"}>{SOURCE_VERSION_STATUS_LABELS[row.sourceVersionStatus as SourceVersionStatus]}</Badge>}
                    {row.supersededById && <Badge tone="warn">Superseded</Badge>}
                    {canEdit && !row.current && (
                      <>
                        <button className="btn btn--ghost btn--sm" title="Record that this document replaces that version" onClick={() => { void run(() => setVersionInfo({ id: documentId, supersedesDocumentId: row._id }), "Supersedes link saved"); }}>
                          This supersedes it
                        </button>
                        <button className="btn btn--ghost btn--sm" title="They are the same file; keep the other one as the record" onClick={() => { void run(() => markDuplicate({ id: documentId, duplicateOfDocumentId: row._id }), "Marked as a duplicate"); }}>
                          Same file
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {canEdit && data.versionKeySource === "name" && (
              <button className="btn btn--ghost btn--sm" onClick={() => { void run(() => setVersionInfo({ id: documentId, versionGroupKey: `separate:${documentId}` }), "Separated from this group"); }}>
                Not a version of these — separate it
              </button>
            )}
          </section>
        )}
        {duplicates.length <= 1 && versions.length <= 1 && (
          <p className="muted" style={{ margin: 0 }}>No other copies or versions of this record were found by file contents, source id or file name.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- evidence panel ------------------------------ */

const TARGET_ROUTES: Record<string, (id: string) => string> = {
  meetings: (id) => `/app/meetings/${id}`,
  minutes: () => "/app/minutes",
  motions: () => "/app/motions",
  policies: () => "/app/policies",
  financials: () => "/app/financials",
  insurancePolicies: () => "/app/insurance",
  filings: () => "/app/filings",
  documents: (id) => `/app/documents/${id}`,
  committees: (id) => `/app/committees/${id}`,
};

function DocumentEvidencePanel({ documentId }: { documentId: string }) {
  const data = useQuery(api.documents.evidenceFor, { id: documentId });
  if (!data || (!data.evidenceTotal && !data.meetings.length)) return null;
  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title"><Link2 size={14} /> What this document feeds</h2>
        <span className="card__subtitle">{data.evidenceTotal} source evidence link{data.evidenceTotal === 1 ? "" : "s"}{data.meetings.length ? ` · ${data.meetings.length} meeting${data.meetings.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      <div className="card__body col" style={{ gap: 8 }}>
        {data.meetings.map((meeting: any) => (
          <Link key={meeting._id} to={`/app/meetings/${meeting._id}`}>{meeting.title} · {formatDate(meeting.scheduledAt)}</Link>
        ))}
        {data.evidence.map((row: any) => {
          const route = row.targetTable && row.targetId ? TARGET_ROUTES[row.targetTable]?.(row.targetId) : undefined;
          return (
            <div key={row._id} className="document-evidence-row">
              <Badge tone={evidenceReviewStatusTone(row.status)}>{evidenceReviewStatusLabel(row.status)}</Badge>
              <span>{row.targetTable ? (route ? <Link to={route}>{humanTable(row.targetTable)}</Link> : humanTable(row.targetTable)) : "No target yet"}</span>
              <span className="muted">{row.summary}</span>
              {row.excerpt && <span className="muted document-evidence-row__excerpt">“{row.excerpt}”</span>}
            </div>
          );
        })}
        {data.evidenceTotal > data.evidence.length && <span className="muted">Showing {data.evidence.length} of {data.evidenceTotal}. The full list is in Records archive.</span>}
      </div>
    </div>
  );
}

function humanTable(table: string) {
  return table.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}


function numberOrUndefined(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
