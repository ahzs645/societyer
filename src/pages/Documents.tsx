import { DocumentFilePreview } from "../components/DocumentFilePreview";
import { hasErrors, validateDocumentInput, type FieldErrors } from "../../shared/recordValidation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, RelatedDocumentViews, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { FileDropZone, useFileDrop } from "../components/FileDropZone";
import { Tabs } from "../components/primitives";
import { useIsMobile } from "../lib/useIsMobile";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import type { MenuSection } from "../components/Menu";
import { Plus, Trash2, Flag as FlagIcon, Upload, Download, FolderOpen, History, BookOpen, ClipboardCheck, MessageSquare, Copy, Layers, FileSearch, Lock } from "lucide-react";
import { formatDate, formatDateTime, pluralize } from "../lib/format";
import { DocumentVersionsDrawer } from "../components/DocumentVersions";
import { isDocumentVersionStorageEnabled } from "../lib/runtimeMode";
import { uploadDocumentVersion } from "../lib/documentVersionUpload";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { organizationVocabulary } from "../lib/organizationVocabulary";
import { isCorporation } from "../../shared/organizationDomain";
import { documentHasFile, openDocumentFile } from "../lib/documentOpen";
import {
  documentCategoryFacets,
  documentCategoryGroupKey,
  documentCategoryLabel,
  documentCategoryOptions,
  documentCategoryTone,
} from "../../shared/documentCategories";
import {
  documentReviewStatusLabel,
  documentReviewStatusTone,
} from "../../shared/documentReviewStatus";
import { SOURCE_VERSION_STATUS_LABELS, type SourceVersionStatus } from "../../shared/documentVersioning";

type ShowFilter = "all" | "needs_review" | "duplicates" | "versions";

export function DocumentsPage() {
  const [previewFile, setPreviewFile] = useState<any | null>(null);
  const society = useSociety();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const canReviewImports = permissions.loaded && permissions.can("settings:read");
  // Light projection: no content blobs, no per-row queries (findings D-16, D-21).
  const browse = useQuery(api.documents.browse, society ? { societyId: society._id } : "skip");
  const reviewQueues = useQuery(api.documents.reviewQueues, society ? { societyId: society._id } : "skip");
  const pendingImports = useQuery(api.importSessions.pendingByTarget, society && canReviewImports ? { societyId: society._id } : "skip");
  const create = useMutation(api.documents.create);
  const flag = useMutation(api.documents.flagForDeletion);
  const remove = useMutation(api.documents.remove);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginVersionUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordVersionUpload = useMutation(api.documentVersions.recordUploadedVersion);
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const convex = useConvex();
  const committees = useQuery(api.committees.list, society && permissions.loaded && permissions.can("committees:read") ? { societyId: society._id } : "skip");
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [versionsFor, setVersionsFor] = useState<{ id: any; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const nativeStorage = isDocumentVersionStorageEnabled();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const categoryParam = searchParams.get("category");
  const categoryKey = categoryParam ? documentCategoryGroupKey(categoryParam) : null;
  const show = (searchParams.get("show") as ShowFilter | null) ?? "all";
  const showArchived = searchParams.get("archived") === "1";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "document",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  // Workspaces restored from older backups carry document metadata without the
  // review columns; top it up once (idempotent seed) for people who may.
  const ensureMetadata = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const metadataUpgradeTried = useRef(false);
  const canSeedMetadata = permissions.loaded && permissions.can("settings:write");
  const missingReviewFields = Boolean(tableData.objectMetadata && !tableData.objectMetadata.fields.some((field: any) => field.name === "reviewStatus"));
  useEffect(() => {
    if (!society || !missingReviewFields || !canSeedMetadata || metadataUpgradeTried.current) return;
    metadataUpgradeTried.current = true;
    void ensureMetadata({ societyId: society._id }).catch(() => undefined);
  }, [society, missingReviewFields, canSeedMetadata, ensureMetadata]);
  // Open the review layout by default when the workspace has it.
  const reviewViewId = tableData.views.find((view) => view.name === "Review and provenance")?._id;
  const effectiveViewId = currentViewId ?? (reviewViewId as Id<"views"> | undefined);
  useEffect(() => {
    if (!currentViewId && reviewViewId) setCurrentViewId(reviewViewId as Id<"views">);
  }, [currentViewId, reviewViewId]);
  const allRows: any[] = useMemo(() => browse?.rows ?? [], [browse]);
  const activeRows = useMemo(() => allRows.filter((row) => showArchived || !row.archivedAtISO), [allRows, showArchived]);
  // Corporations file articles and a certificate of incorporation; societies a constitution and bylaws.
  const corporationAudience = society ? isCorporation(society) : undefined;
  const bcCompanyAudience = society ? organizationVocabulary(society).bcCompany : undefined;
  const categoryAudience = useMemo(
    () => (corporationAudience === undefined ? undefined : { corporation: corporationAudience, bcCompany: bcCompanyAudience }),
    [corporationAudience, bcCompanyAudience],
  );
  const facets = useMemo(() => documentCategoryFacets(activeRows, categoryAudience), [activeRows, categoryAudience]);
  const showCounts = useMemo(() => ({
    all: activeRows.length,
    needs_review: activeRows.filter((row) => row.reviewStatus === "needs_review" || row.reviewStatus === "in_review").length,
    duplicates: activeRows.filter((row) => row.duplicateCount > 1).length,
    versions: activeRows.filter((row) => row.versionKey && row.versionCount > 1).length,
  }), [activeRows]);
  const records = useMemo(
    () => activeRows
      .filter((row) => !categoryKey || row.categoryKey === categoryKey)
      .filter((row) => show === "all"
        || (show === "needs_review" && (row.reviewStatus === "needs_review" || row.reviewStatus === "in_review"))
        || (show === "duplicates" && row.duplicateCount > 1)
        || (show === "versions" && row.versionKey && row.versionCount > 1))
      .map((row) => ({ ...row, flagged: row.flaggedForDeletion ? "Purge" : "" })),
    [activeRows, categoryKey, show],
  );
  // ?intent=new&category=…&title=… (dashboard remediation "Upload evidence")
  // opens the new-document form prefilled instead of a bare list (G-24).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("intent") !== "new" || !canEdit || !society) return;
    setForm({ title: params.get("title") ?? "", category: params.get("category") ?? "Other", tags: [], retentionYears: 10 });
    setOpen(true);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      next.delete("category");
      next.delete("title");
      return next;
    }, { replace: true });
  }, [canEdit, params, setParams, society]);
  const categoryOptions = useMemo(() => documentCategoryOptions(allRows.map((row) => row.category), categoryAudience), [allRows, categoryAudience]);
  // Quick upload: the overflow menu's Upload opens the picker, and a file
  // dropped anywhere on the page becomes a new document. Drags inside a
  // drawer or dialog (Add document, File history) or onto a zone belong to
  // that surface, so the page leaves them alone. Any type, no size cap, no
  // paste, as before.
  // quickUpload is declared after the loading returns; the ref reaches it.
  const quickUploadRef = useRef<((file: File) => Promise<void>) | null>(null);
  const quickDrop = useFileDrop({
    disabled: !nativeStorage || busy || !canEdit,
    onFiles: ([file]) => { if (file) void quickUploadRef.current?.(file); },
  });
  const onPage = (event: DragEvent<HTMLElement>) => !(event.target instanceof Element && event.target.closest('[role="dialog"], .file-drop'));
  // A file let go elsewhere in a drawer that nothing there took must not
  // open in the tab and drop the user out of the app.
  const swallow = (event: DragEvent<HTMLElement>) => {
    if (event.defaultPrevented || !Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  };
  const pageDropHandlers = nativeStorage ? {
    onDragEnter: (event: DragEvent<HTMLElement>) => { if (onPage(event)) quickDrop.rootProps.onDragEnter(event); },
    onDragOver: (event: DragEvent<HTMLElement>) => { if (onPage(event)) quickDrop.rootProps.onDragOver(event); else swallow(event); },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (onPage(event)) quickDrop.rootProps.onDragLeave(event); },
    onDrop: (event: DragEvent<HTMLElement>) => { if (onPage(event)) quickDrop.rootProps.onDrop(event); else swallow(event); },
  } : {};

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canEdit) return;
    setFormErrors({});
    setForm({ title: "", category: "Other", tags: [], retentionYears: 10 });
    setOpen(true);
  };

  const uploadFile = async (documentId: any, file: File) => {
    const result = await uploadDocumentVersion({
      societyId: society._id,
      documentId,
      file,
      createDemoVersion,
      beginUpload: beginVersionUpload,
      recordUploadedVersion: recordVersionUpload,
      completeUpload,
    });
    return result.versionId;
  };

  const save = async () => {
    if (!canEdit || busy) return;
    const payload = documentPayload(form);
    // An attached file names an otherwise untitled document.
    if (!String(payload.title ?? "").trim() && form._file?.name) payload.title = form._file.name;
    const validation = validateDocumentInput(payload);
    setFormErrors(validation);
    if (hasErrors(validation)) return;
    setBusy(true);
    try {
      const newDocId = await create({ societyId: society._id, ...payload });
      if (form._file) {
        await uploadFile(newDocId, form._file);
      }
      setOpen(false);
      toast.success("Document saved");
    } catch (error: any) {
      toast.error(error?.message ?? "Document save failed");
    } finally {
      setBusy(false);
    }
  };

  const quickUpload = async (file: File) => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const docId = await create({ societyId: society._id, title: file.name, category: "Other", tags: [], retentionYears: 10 });
      await uploadFile(docId, file);
      toast.success("Document uploaded");
    } catch (error: any) {
      toast.error(error?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };
  quickUploadRef.current = quickUpload;

  const openFile = async (row: any) => {
    try {
      const result = await openDocumentFile(row, {
        getDownloadTarget: (args) => getDownloadTarget(args as any),
        getLegacyUrl: (storageId) => convex.query(api.files.getUrl, { storageId }),
      });
      if (result === "simulated") toast.info("Demo mode — no real file is stored, so the download is simulated.");
      else if (result === "none") toast.info("No file or link is attached to this document.");
    } catch (error: any) {
      toast.error("Could not open the file", error?.message ?? String(error));
    }
  };

  const deleteDocument = async (row: any) => {
    const ok = await confirm({
      title: "Delete document?",
      message: `"${row.title}" will be permanently removed${row.linkedRecordCount ? `, and ${row.linkedRecordCount} linked record${row.linkedRecordCount === 1 ? "" : "s"} will lose this source` : ""}${documentHasFile(row) ? ". Its attached file metadata goes with it" : ""}.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove({ id: row._id });
      toast.success("Document deleted");
    } catch (error: any) {
      toast.error("Could not delete document", error?.message ?? String(error));
    }
  };

  const menuSections = (row: any): MenuSection[] => [
    {
      id: "open",
      items: [
        { id: "review", label: "Open review page", icon: <ClipboardCheck size={14} />, onSelect: () => navigate(`/app/documents/${row._id}`) },
        { id: "preview", label: "Preview file", icon: <FileSearch size={14} />, disabled: !documentHasFile(row), onSelect: () => setPreviewFile(row) },
        { id: "file", label: "Download original", icon: <Download size={14} />, disabled: !documentHasFile(row), onSelect: () => { void openFile(row); } },
        { id: "history", label: "File history", icon: <History size={14} />, onSelect: () => setVersionsFor({ id: row._id, title: row.title }) },
      ],
    },
    {
      id: "manage",
      items: [
        { id: "flag", label: row.flaggedForDeletion ? "Unflag for purge" : "Flag for purge", icon: <FlagIcon size={14} />, disabled: !canEdit, onSelect: () => { void flag({ id: row._id, flagged: !row.flaggedForDeletion }).catch((error: any) => toast.error("Could not update document flag", error?.message ?? String(error))); } },
        { id: "delete", label: "Delete…", icon: <Trash2 size={14} />, destructive: true, disabled: !canEdit, onSelect: () => { void deleteDocument(row); } },
      ],
    },
  ];

  const pendingDocumentCandidates = Number(pendingImports?.byKind?.documentCandidate ?? 0);

  return (
    <div className={`page file-drop-target is-${quickDrop.dragState}`} {...pageDropHandlers}>
      {previewFile && <DocumentFilePreview document={previewFile} onClose={() => setPreviewFile(null)} />}
      <PageHeader
        title="Documents"
        icon={<FolderOpen size={16} />}
        iconColor="gray"
        subtitle="Every record and source file the organization keeps."
        info={
          // The 10-year records default follows the society records rules.
          !organizationVocabulary(society).isSociety
            ? <p>{organizationVocabulary(society).governingDocumentsTitle}, minutes, statements, policies, imported sources, and other records.</p>
            : <p>Constitution, bylaws, minutes, statements, policies and imported sources. Keep records at least 10 years; financial records 7 years (CRA).</p>
        }
        actions={
          <>
            {nativeStorage && (
              <input {...quickDrop.inputProps} />
            )}
            <MoreActionsMenu
              items={[
                {
                  id: "library",
                  label: "Library",
                  icon: <BookOpen size={14} />,
                  onSelect: () => navigate("/app/library"),
                },
                {
                  id: "archived",
                  label: showArchived ? "Hide archived and merged copies" : "Show archived and merged copies",
                  icon: <Layers size={14} />,
                  onSelect: () => setParam("archived", showArchived ? null : "1"),
                },
                ...(nativeStorage
                  ? [
                      {
                        id: "upload",
                        label: "Upload",
                        icon: <Upload size={14} />,
                        disabled: busy || !canEdit,
                        onSelect: quickDrop.open,
                      },
                    ]
                  : []),
              ]}
            />
            <button className="btn-action btn-action--primary" disabled={busy || !canEdit} onClick={openNew}>
              <Plus size={12} /> New document
            </button>
          </>
        }
      />

      <RelatedDocumentViews current="/app/documents" />
      {permissions.loaded && !canEdit && <p className="muted">Your role can read accessible documents. Document editing permission is required to create, upload, sync or delete records.</p>}

      {reviewQueues && <DocumentQueues queues={reviewQueues} />}

      {(pendingImports?.pending ?? 0) > 0 && (
        <div className="card documents-import-card">
          <div className="card__head">
            <div>
              <h2 className="card__title"><FileSearch size={14} /> Import candidates awaiting review</h2>
              <p className="card__subtitle">
                {pendingImports.pending.toLocaleString()} staged record{pendingImports.pending === 1 ? "" : "s"}
                {pendingDocumentCandidates ? `, ${pendingDocumentCandidates.toLocaleString()} of them document candidates,` : ""} stay metadata-only until a reviewer approves them in one queue across every import session.
              </p>
            </div>
            <Link className="btn-action btn-action--primary" to="/app/imports">Open review queue</Link>
          </div>
        </div>
      )}

      {browse && (
        <div className="documents-facets documents-facets--single" aria-label="Document filters">
          <div className="documents-facets__row" role="group" aria-label="Show">
            {([
              ["all", "All", undefined],
              ["needs_review", "Needs review", <ClipboardCheck key="r" size={12} />],
              ["duplicates", "Duplicates", <Copy key="d" size={12} />],
              ["versions", "Version groups", <Layers key="v" size={12} />],
            ] as [ShowFilter, string, ReactNode][])
              // Empty queues add nothing to choose from; keep the active one so it can be cleared.
              .filter(([value]) => value === "all" || show === value || showCounts[value] > 0)
              .map(([value, label, icon]) => (
                <button key={value} type="button" className={`chip${show === value ? " is-active" : ""}`} aria-pressed={show === value} onClick={() => setParam("show", value === "all" ? null : value)}>
                  {icon}{label} <span className="chip__count">{showCounts[value].toLocaleString()}</span>
                </button>
              ))}
            {showArchived && (
              <button type="button" className="chip is-active" aria-pressed="true" onClick={() => setParam("archived", null)}>
                <Layers size={12} /> Including archived ×
              </button>
            )}
          </div>
          <span className="documents-facets__divider" aria-hidden="true" />
          <div className="documents-facets__row" role="group" aria-label="Category">
            {facets.map((facet) => (
              <button key={facet.key} type="button" className={`chip${categoryKey === facet.key ? " is-active" : ""}`} aria-pressed={categoryKey === facet.key} onClick={() => setParam("category", categoryKey === facet.key ? null : facet.value)}>
                {facet.label} <span className="chip__count">{facet.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="document" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="documents"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(recordId) => navigate(`/app/documents/${recordId}`)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<FolderOpen size={14} />}
            label="All documents"
            views={tableData.views}
            currentViewId={effectiveViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || browse === undefined}
            emptyState={<div className="muted" style={{ padding: 16 }}>No documents match these filters.</div>}
            renderCell={({ record: r, field }) => {
              if (field.name === "title") return <DocumentTitleCell row={r} />;
              if (field.name === "category") return <Badge tone={documentCategoryTone(r.category)}>{documentCategoryLabel(r.category, categoryAudience)}</Badge>;
              if (field.name === "reviewStatus") return <Badge tone={documentReviewStatusTone(r.reviewStatus)}>{documentReviewStatusLabel(r.reviewStatus)}</Badge>;
              if (field.name === "sourceDate") return r.sourceDate ? <span>{r.sourceDate}</span> : <span className="muted">—</span>;
              if (field.name === "sourceSystemLabel") return r.sourceSystemLabel ? <span>{r.sourceSystemLabel}</span> : <span className="muted">Added here</span>;
              if (field.name === "sourceVersionStatus") return r.sourceVersionStatus
                ? <Badge tone={r.sourceVersionStatus === "approved" || r.sourceVersionStatus === "signed" ? "success" : r.sourceVersionStatus === "draft" ? "neutral" : "info"}>{SOURCE_VERSION_STATUS_LABELS[r.sourceVersionStatus as SourceVersionStatus] ?? r.sourceVersionStatus}{r.sourceVersionStatusDetected ? "*" : ""}</Badge>
                : <span className="muted">—</span>;
              if (field.name === "linkedRecordCount") return r.linkedRecordCount
                ? <span title={(r.linkedTargets ?? []).join(", ") || undefined}>{r.linkedRecordCount}</span>
                : <span className="muted">0</span>;
              if (field.name === "createdAtISO") return <span>{formatDate(r.createdAtISO)}</span>;
              if (field.name === "retentionYears") return <span className="muted">{r.retentionYears ? `${r.retentionYears}y` : "—"}</span>;
              if (field.name === "tags") return (
                <div className="tag-list">
                  {displayTags(r.tags).map((t: string) => <Badge key={t}>{t}</Badge>)}
                </div>
              );
              if (field.name === "flagged") return r.flaggedForDeletion ? <Badge tone="danger"><FlagIcon size={11} /> Purge</Badge> : null;
              return undefined;
            }}
            rowMenuSections={menuSections}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Add document"
        footer={<><button className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" disabled={busy || !canEdit} onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title" required error={formErrors.title}><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Category" error={formErrors.category}>
              <Select
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
                searchable
                options={categoryOptions}
              />
            </Field>
            {nativeStorage ? (
              <Field label="Attach file" hint="Stored as document version history.">
                <FileDropZone
                  ariaLabel="Attach file"
                  title="Drop a file here"
                  touchTitle="Attach a file"
                  onFiles={([file]) => { if (file) setForm({ ...form, _file: file, fileName: file.name }); }}
                />
                {form.fileName && <div className="mono muted" style={{ fontSize: 11 }}>{form.fileName}</div>}
              </Field>
            ) : (
              <Field label="Attach file" hint="Native file storage is disabled — create the record here and link it to a document connector (e.g. Paperless) as the source.">
                <div className="muted" style={{ fontSize: 12 }}>File upload is disabled on this deployment.</div>
              </Field>
            )}
            <Field label="Committee (optional)">
              <Select
                value={form.committeeId ?? ""}
                onChange={(v) => setForm({ ...form, committeeId: v || undefined })}
                clearable
                searchable
                options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
              />
            </Field>
            <Field label="Tags (comma-separated)">
              <input className="input" value={(form.tags ?? []).join(", ")} onChange={(e) => setForm({ ...form, tags: e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Retention (years)" error={formErrors.retentionYears}><input className="input" type="number" value={form.retentionYears ?? 10} onChange={(e) => setForm({ ...form, retentionYears: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Drawer>

      <DocumentVersionsDrawer
        open={!!versionsFor}
        onClose={() => setVersionsFor(null)}
        documentId={versionsFor?.id ?? null}
        societyId={society._id}
        title={versionsFor?.title ?? ""}
      />
    </div>
  );
}

/** Title, the file name only when it adds something, and duplicate/version markers. */
function DocumentTitleCell({ row }: { row: any }) {
  const showFileName = row.fileName && row.fileName.trim().toLowerCase() !== String(row.title ?? "").trim().toLowerCase();
  const secondary = showFileName ? row.fileName : row.sourcePath;
  return (
    <div className="record-table__identifier-lines document-title-cell">
      <strong className="record-table__identifier-primary" title={row.title}>{row.title}</strong>
      <div className="record-table__identifier-secondary document-title-markers">
        {row.duplicateCount > 1 && (
          <span title={row.isDuplicate ? "Another copy of this file is the canonical record" : "Other copies of this file exist"}>
            <Badge tone={row.isDuplicate ? "warn" : "info"}>
              <Copy size={10} /> {row.isDuplicate ? "Duplicate" : `${row.duplicateCount} copies`}
            </Badge>
          </span>
        )}
        {row.versionKey && row.versionCount > 1 && (
          <span title="Other versions of this record exist (draft, approved, revised…)"><Badge tone="purple"><Layers size={10} /> {row.versionCount} versions</Badge></span>
        )}
        {row.inCameraWithheld && <span title="Holds in-camera content. Owners, Admins and Directors can open it."><Badge tone="warn"><Lock size={10} /> Restricted</Badge></span>}
        {row.archivedAtISO && <Badge>Archived</Badge>}
        {secondary && <span className="mono muted document-title-markers__file" title={secondary}>{secondary}</span>}
      </div>
    </div>
  );
}

type QueueDocument = {
  _id: string;
  title: string;
  category?: string;
  createdAtISO?: string;
  lastOpenedAtISO?: string;
  reviewStatus?: string;
  openCommentCount: number;
  openTaskCount: number;
  signatureCount: number;
  linkedToMeetingPackage: boolean;
};
type DocumentQueueSet = { recent: QueueDocument[]; actionRequired: QueueDocument[]; workInProgress: QueueDocument[] };
type QueueId = "action" | "recent" | "progress";

/**
 * Quick access: recent documents, documents needing action, and work in
 * progress. A document needing action is listed there only, not again under
 * Recent. Phones show one card with a tab per queue (needing action first)
 * instead of three stacked cards under a stacked "Quick access" heading.
 */
function DocumentQueues({ queues }: { queues: DocumentQueueSet }) {
  const isMobile = useIsMobile();
  const actionIds = new Set(queues.actionRequired.map((doc) => String(doc._id)));
  const recent = queues.recent.filter((doc) => !actionIds.has(String(doc._id)));
  const recentEmpty = queues.recent.length > 0 ? "Your recent documents are all under Action required." : "No recent document activity.";
  const lists: Record<QueueId, { title: string; tab: string; icon: ReactNode; documents: QueueDocument[]; empty: string }> = {
    action: { title: "Action required", tab: "Action required", icon: <MessageSquare size={14} />, documents: queues.actionRequired, empty: "No document actions waiting." },
    recent: { title: "Recent documents", tab: "Recent", icon: <History size={14} />, documents: recent, empty: recentEmpty },
    progress: { title: "Work in progress", tab: "In progress", icon: <ClipboardCheck size={14} />, documents: queues.workInProgress, empty: "Nothing awaiting review." },
  };
  const [chosen, setChosen] = useState<QueueId | null>(null);
  const active: QueueId = chosen ?? (queues.actionRequired.length > 0 ? "action" : "recent");

  if (isMobile) {
    const list = lists[active];
    return (
      <section className="card document-queue-card document-queues-tabs" aria-label="Quick access">
        <Tabs<QueueId>
          tabRoles
          ariaLabel="Quick access"
          value={active}
          onChange={setChosen}
          items={(["action", "recent", "progress"] as const).map((id) => ({ id, label: lists[id].tab, count: lists[id].documents.length || null }))}
        />
        <DocumentQueueList key={active} documents={list.documents} empty={list.empty} panelLabel={list.title} />
      </section>
    );
  }

  return (
    <>
      <h2 className="card__title" style={{ marginBottom: 8 }}>Quick access</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12, marginBottom: 16 }}>
        {(["recent", "action", "progress"] as const).map((id) => (
          <DocumentQueueCard key={id} title={lists[id].title} icon={lists[id].icon} documents={lists[id].documents} empty={lists[id].empty} />
        ))}
      </div>
      <div className="hr" style={{ marginBottom: 16 }} />
    </>
  );
}

function DocumentQueueCard({
  title,
  icon,
  documents,
  empty,
}: {
  title: string;
  icon: ReactNode;
  documents: QueueDocument[];
  empty: string;
}) {
  return (
    <div className="card document-queue-card">
      <div className="card__head">
        <h2 className="card__title">{icon} {title}</h2>
        {documents.length > 0 && <Badge>{documents.length}</Badge>}
      </div>
      <DocumentQueueList documents={documents} empty={empty} />
    </div>
  );
}

function DocumentQueueList({ documents, empty, panelLabel }: { documents: QueueDocument[]; empty: string; panelLabel?: string }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? documents : documents.slice(0, 3);
  return (
    <div className="card__body col document-queue-list" style={{ gap: 8 }} role={panelLabel ? "tabpanel" : undefined} aria-label={panelLabel}>
      {shown.map((doc) => (
        <Link key={doc._id} to={`/app/documents/${doc._id}`} className="col document-queue-link">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <strong className="document-queue-link__title">{doc.title}</strong>
            {doc.reviewStatus && doc.reviewStatus !== "none" && <Badge tone={documentReviewStatusTone(doc.reviewStatus)}>{documentReviewStatusLabel(doc.reviewStatus)}</Badge>}
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            {doc.lastOpenedAtISO ? `Opened ${formatDateTime(doc.lastOpenedAtISO)}` : `Added ${formatDate(doc.createdAtISO)}`} · {documentCategoryLabel(doc.category)}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {doc.openCommentCount > 0 && <Badge tone="warn">{pluralize(doc.openCommentCount, "comment")}</Badge>}
            {doc.openTaskCount > 0 && <Badge tone="warn">{pluralize(doc.openTaskCount, "task")}</Badge>}
            {doc.linkedToMeetingPackage && <Badge tone="info">Meeting packet</Badge>}
            {doc.signatureCount > 0 && <Badge tone="success">{doc.signatureCount} signed</Badge>}
          </div>
        </Link>
      ))}
      {documents.length > shown.length && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setExpanded(true)}>Show {documents.length - shown.length} more</button>
      )}
      {documents.length === 0 && <div className="muted">{empty}</div>}
    </div>
  );
}

function documentPayload(form: any) {
  const {
    _file,
    fileName,
    mimeType,
    fileSizeBytes,
    storageId,
    ...rest
  } = form;
  void _file;
  void fileName;
  void mimeType;
  void fileSizeBytes;
  void storageId;
  return {
    ...rest,
    tags: uniqueTags(rest.tags),
  };
}

function uniqueTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const value = String(tag ?? "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Tags a person reads: drop raw source ids (shown as Source) and import bookkeeping. */
function displayTags(tags: unknown) {
  return uniqueTags(tags).filter((tag) => !/^(google-drive|paperless|onedrive|drive):/i.test(tag) && !/^(import-candidate|google-drive-import|transposed-source)$/i.test(tag));
}
