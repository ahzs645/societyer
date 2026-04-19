import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Trash2, Flag as FlagIcon, Upload, Download, FolderOpen, Tag, History } from "lucide-react";
import { formatDate } from "../lib/format";
import { DocumentVersionsDrawer } from "../components/DocumentVersions";
import { PaperlessDocumentAction } from "../components/PaperlessDocumentAction";
import { isDemoMode } from "../lib/demoMode";

const CATS = ["Constitution", "Bylaws", "Minutes", "FinancialStatement", "Policy", "Filing", "WorkflowGenerated", "Other"] as const;

const CAT_LABELS: Record<string, string> = {
  FinancialStatement: "Financial Statement",
  WorkflowGenerated: "Workflow Generated",
};

const DOC_FIELDS: FilterField<any>[] = [
  { id: "title", label: "Title", icon: <Tag size={14} />, match: (d, q) => d.title.toLowerCase().includes(q.toLowerCase()) },
  { id: "category", label: "Category", icon: <Tag size={14} />, options: [...CATS], match: (d, q) => d.category === q },
  { id: "tag", label: "Tag", icon: <Tag size={14} />, match: (d, q) => d.tags.some((t: string) => t.toLowerCase().includes(q.toLowerCase())) },
  { id: "flagged", label: "Flagged for deletion", options: ["Yes", "No"], match: (d, q) => (d.flaggedForDeletion ? "Yes" : "No") === q },
  { id: "hasFile", label: "Attachment", options: ["Uploaded", "Metadata only"], match: (d, q) => ((d.storageId || d.fileName) ? "Uploaded" : "Metadata only") === q },
];

export function DocumentsPage() {
  const society = useSociety();
  const docs = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const importSessions = useQuery(api.importSessions.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.documents.create);
  const flag = useMutation(api.documents.flagForDeletion);
  const remove = useMutation(api.documents.remove);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginVersionUpload = useAction(api.documentVersions.beginUpload);
  const recordVersionUpload = useMutation(api.documentVersions.recordUploadedVersion);
  const syncDocument = useAction(api.paperless.syncDocument);
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const paperlessConnection = useQuery(api.paperless.listConnection, society ? { societyId: society._id } : "skip");
  const actingUserId = useCurrentUserId() ?? undefined;
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [versionsFor, setVersionsFor] = useState<{ id: any; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const visibleDocs = useMemo(() => (docs ?? []).filter((doc: any) => !isInternalDocumentRecord(doc)), [docs]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ title: "", category: "Other", tags: [], retentionYears: 10 });
    setOpen(true);
  };
  const documentImportSession = (importSessions ?? []).find(
    (session: any) => (session.summary?.byKind?.documentCandidate ?? 0) > 0,
  );

  const uploadFile = async (documentId: any, file: File) => {
    if (isDemoMode()) {
      return await createDemoVersion({
        societyId: society._id,
        documentId,
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        actingUserId,
      });
    }

    const { version, presigned } = await beginVersionUpload({
      societyId: society._id,
      documentId,
      fileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
      actingUserId,
    });
    if (presigned.provider === "rustfs") {
      const res = await fetch(presigned.url, {
        method: "PUT",
        headers: presigned.headers ?? (file.type ? { "Content-Type": file.type } : {}),
        body: file,
      });
      if (!res.ok) throw new Error(`RustFS upload failed (${res.status})`);
    }
    return await recordVersionUpload({
      societyId: society._id,
      documentId,
      version,
      storageProvider: presigned.provider,
      storageKey: presigned.key,
      fileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
      actingUserId,
    });
  };

  const maybeSyncToPaperless = async (documentId: any) => {
    if (!paperlessConnection?.autoUpload || paperlessConnection.status !== "connected") return;
    try {
      await syncDocument({ societyId: society._id, documentId, actingUserId });
      toast.success("Uploaded and sent to Paperless-ngx");
    } catch (error: any) {
      toast.error(error?.message ?? "Uploaded locally, but Paperless-ngx sync failed");
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const newDocId = await create({ societyId: society._id, ...documentPayload(form) });
      if (form._file) {
        await uploadFile(newDocId, form._file);
        await maybeSyncToPaperless(newDocId);
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
    setBusy(true);
    try {
      const docId = await create({ societyId: society._id, title: file.name, category: "Other", tags: [], retentionYears: 10 });
      await uploadFile(docId, file);
      await maybeSyncToPaperless(docId);
      toast.success("Document uploaded");
    } catch (error: any) {
      toast.error(error?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Documents"
        icon={<FolderOpen size={16} />}
        iconColor="gray"
        subtitle="Constitution, bylaws, minutes, financial statements, policies. Records ≥ 10 years (CRA: 7 years financial)."
        actions={
          <>
            <input ref={fileInputRef} type="file" style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await quickUpload(file);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button className="btn-action" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <Upload size={12} /> Upload
            </button>
            <button className="btn-action btn-action--primary" disabled={busy} onClick={openNew}>
              <Plus size={12} /> New document
            </button>
          </>
        }
      />

      {documentImportSession && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <div>
              <h2 className="card__title">Paperless document candidates</h2>
              <p className="card__subtitle">
                {documentImportSession.summary.byKind.documentCandidate} Paperless records are staged for section-by-section review before becoming Documents records.
              </p>
            </div>
            <Link className="btn-action" to="/app/imports">
              Review import
            </Link>
          </div>
          <div className="card__body">
            <div className="stat-grid" style={{ marginBottom: 0 }}>
              <div className="stat">
                <div className="stat__label">Candidates</div>
                <div className="stat__value">{documentImportSession.summary.byKind.documentCandidate}</div>
                <div className="stat__sub">metadata-only until approved</div>
              </div>
              <div className="stat">
                <div className="stat__label">Review flags</div>
                <div className="stat__value">{documentImportSession.summary.riskCount}</div>
                <div className="stat__sub">restricted, OCR, duplicate, date risk</div>
              </div>
              <div className="stat">
                <div className="stat__label">Created docs</div>
                <div className="stat__value">{documentImportSession.summary.documentsApplied ?? 0}</div>
                <div className="stat__sub">approve then use Create docs</div>
              </div>
              <div className="stat">
                <div className="stat__label">Top section</div>
                <div className="stat__value">{topTargetLabel(documentImportSession.summary.byTarget)}</div>
                <div className="stat__sub">filter by target in Import sessions</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <DataTable
        label="All documents"
        icon={<FolderOpen size={14} />}
        data={visibleDocs as any[]}
        rowKey={(r) => r._id}
        filterFields={DOC_FIELDS}
        searchPlaceholder="Search title, tag, file name…"
        searchExtraFields={[(r) => r.fileName, (r) => r.tags.join(" ")]}
        defaultSort={{ columnId: "createdAtISO", dir: "desc" }}
        columns={[
          {
            id: "title", header: "Title", sortable: true,
            accessor: (r) => r.title,
            render: (r) => (
              <div>
                <strong>{r.title}</strong>
                {r.fileName && <div className="mono muted" style={{ fontSize: 11 }}>{r.fileName}</div>}
              </div>
            ),
          },
          {
            id: "category", header: "Category", sortable: true,
            accessor: (r) => r.category,
            render: (r) => <Badge tone={catTone(r.category)}>{CAT_LABELS[r.category] ?? r.category}</Badge>,
          },
          {
            id: "createdAtISO", header: "Created", sortable: true,
            accessor: (r) => r.createdAtISO,
            render: (r) => <span className="mono">{formatDate(r.createdAtISO)}</span>,
          },
          {
            id: "retentionYears", header: "Retention", sortable: true,
            accessor: (r) => r.retentionYears ?? 0,
            render: (r) => <span className="muted">{r.retentionYears ? `${r.retentionYears}y` : "—"}</span>,
          },
          {
            id: "tags", header: "Tags",
            render: (r) => (
              <div className="tag-list">
                {r.tags.map((t: string) => <Badge key={t}>{t}</Badge>)}
              </div>
            ),
          },
          {
            id: "flagged", header: "Flags",
            render: (r) => r.flaggedForDeletion ? <Badge tone="danger"><FlagIcon size={11} /> Purge</Badge> : null,
          },
        ]}
        renderRowActions={(r) => (
          <>
            {(r.storageId || r.fileName) && (
              <CurrentDocumentDownload documentId={r._id} legacyStorageId={r.storageId} />
            )}
            <PaperlessDocumentAction
              societyId={society._id}
              documentId={r._id}
              disabled={!r.storageId && !r.fileName}
            />
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setVersionsFor({ id: r._id, title: r.title })}
              title="Version history"
            >
              <History size={12} /> Versions
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => flag({ id: r._id, flagged: !r.flaggedForDeletion })}>
              {r.flaggedForDeletion ? "Unflag" : "Flag"}
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete ${r.title}`}
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete document?",
                  message: `"${r.title}" will be permanently removed${(r.storageId || r.fileName) ? ", including its attached file metadata" : ""}.`,
                  confirmLabel: "Delete",
                  tone: "danger",
                });
                if (!ok) return;
                await remove({ id: r._id });
                toast.success("Document deleted");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Add document"
        footer={<><button className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Category">
              <Select
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
                options={CATS.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Attach file" hint="Stored as document version history.">
              <input type="file" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setForm({ ...form, _file: file, fileName: file.name });
              }} />
              {form.fileName && <div className="mono muted" style={{ fontSize: 11 }}>{form.fileName}</div>}
            </Field>
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
            <Field label="Retention (years)"><input className="input" type="number" value={form.retentionYears ?? 10} onChange={(e) => setForm({ ...form, retentionYears: Number(e.target.value) })} /></Field>
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

function CurrentDocumentDownload({ documentId, legacyStorageId }: { documentId: any; legacyStorageId?: any }) {
  const latest = useQuery(api.documentVersions.latest, { documentId });
  const legacyUrl = useQuery(api.files.getUrl, legacyStorageId ? { storageId: legacyStorageId } : "skip");
  const getDownloadUrl = useAction(api.documentVersions.getDownloadUrl);
  const toast = useToast();

  const open = async () => {
    if (latest) {
      const url = await getDownloadUrl({ versionId: latest._id });
      if (!url) return;
      if (url.startsWith("demo://")) {
        toast.info("Demo mode — no real file is stored, so the download URL is simulated.");
        return;
      }
      window.open(url, "_blank");
      return;
    }
    if (legacyUrl) window.open(legacyUrl, "_blank");
  };

  if (latest === undefined && !legacyUrl) return null;
  if (!latest && !legacyUrl) return null;
  return (
    <button className="btn btn--ghost btn--sm" onClick={open}>
      <Download size={12} /> Open
    </button>
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
    tags: rest.tags ?? [],
  };
}

function catTone(cat: string) {
  switch (cat) {
    case "Constitution":
    case "Bylaws": return "accent" as const;
    case "FinancialStatement": return "warn" as const;
    case "Policy": return "info" as const;
    case "Minutes": return "success" as const;
    case "WorkflowGenerated": return "purple" as const;
    default: return "neutral" as const;
  }
}

function isInternalDocumentRecord(doc: any) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  return (
    tags.includes("import-session") ||
    tags.includes("org-history") ||
    doc.category === "Import Session" ||
    doc.category === "Import Candidate" ||
    doc.category === "Org History Source" ||
    doc.category === "Org History Item"
  );
}

function topTargetLabel(byTarget: Record<string, number> | undefined) {
  const top = Object.entries(byTarget ?? {}).sort((a, b) => b[1] - a[1])[0];
  if (!top) return "—";
  return top[0].length > 13 ? `${top[0].slice(0, 12)}…` : top[0];
}
