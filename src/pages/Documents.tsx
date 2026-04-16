import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
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

const CATS = ["Constitution", "Bylaws", "Minutes", "FinancialStatement", "Policy", "Filing", "Other"] as const;

const DOC_FIELDS: FilterField<any>[] = [
  { id: "title", label: "Title", icon: <Tag size={14} />, match: (d, q) => d.title.toLowerCase().includes(q.toLowerCase()) },
  { id: "category", label: "Category", icon: <Tag size={14} />, options: [...CATS], match: (d, q) => d.category === q },
  { id: "tag", label: "Tag", icon: <Tag size={14} />, match: (d, q) => d.tags.some((t: string) => t.toLowerCase().includes(q.toLowerCase())) },
  { id: "flagged", label: "Flagged for deletion", options: ["Yes", "No"], match: (d, q) => (d.flaggedForDeletion ? "Yes" : "No") === q },
  { id: "hasFile", label: "Attachment", options: ["Uploaded", "Metadata only"], match: (d, q) => (d.storageId ? "Uploaded" : "Metadata only") === q },
];

export function DocumentsPage() {
  const society = useSociety();
  const docs = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.documents.create);
  const flag = useMutation(api.documents.flagForDeletion);
  const remove = useMutation(api.documents.remove);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attach = useMutation(api.files.attachUploadedFileToDocument);
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [versionsFor, setVersionsFor] = useState<{ id: any; title: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ title: "", category: "Other", tags: [], retentionYears: 10 });
    setOpen(true);
  };

  const uploadFile = async (documentId: any, file: File) => {
    const url = await generateUploadUrl({});
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    if (!res.ok) throw new Error("Upload failed");
    const { storageId } = await res.json();
    await attach({ documentId, storageId, fileName: file.name, mimeType: file.type, fileSizeBytes: file.size });
  };

  const save = async () => {
    const newDocId = await create({ societyId: society._id, ...form, tags: form.tags ?? [] });
    if (form._file) await uploadFile(newDocId, form._file);
    setOpen(false);
  };

  const quickUpload = async (file: File) => {
    const docId = await create({ societyId: society._id, title: file.name, category: "Other", tags: [], retentionYears: 10 });
    await uploadFile(docId, file);
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
            <button className="btn-action" onClick={() => fileInputRef.current?.click()}>
              <Upload size={12} /> Upload
            </button>
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New document
            </button>
          </>
        }
      />

      <DataTable
        label="All documents"
        icon={<FolderOpen size={14} />}
        data={(docs ?? []) as any[]}
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
            render: (r) => <Badge tone={catTone(r.category)}>{r.category}</Badge>,
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
            {r.storageId && <DownloadLink storageId={r.storageId} />}
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
                  message: `"${r.title}" will be permanently removed${r.storageId ? ", including its attached file" : ""}.`,
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
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
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
            <Field label="Attach file" hint="Stored in the local self-hosted Convex backend.">
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

function DownloadLink({ storageId }: { storageId: any }) {
  const url = useQuery(api.files.getUrl, { storageId });
  if (!url) return null;
  return (
    <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noreferrer">
      <Download size={12} /> Open
    </a>
  );
}

function catTone(cat: string) {
  switch (cat) {
    case "Constitution":
    case "Bylaws": return "accent" as const;
    case "FinancialStatement": return "warn" as const;
    case "Policy": return "info" as const;
    case "Minutes": return "success" as const;
    default: return "neutral" as const;
  }
}
