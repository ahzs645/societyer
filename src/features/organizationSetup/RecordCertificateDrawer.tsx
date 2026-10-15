import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { FileUp, Loader2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { DatePicker } from "../../components/DatePicker";
import { Select } from "../../components/Select";
import { Drawer, Field } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { uploadDocumentVersion } from "../../lib/documentVersionUpload";
import { isNativeFileStorageEnabled } from "../../lib/runtimeMode";

const MAX_BYTES = 25 * 1024 * 1024;

export type CertificateValues = {
  certificateDocumentId: string;
  incorporationNumber: string;
  certificateDate: string;
  certificateReference?: string;
};

/**
 * Record the certificate of incorporation: pick an uploaded document (or
 * upload the scan here), then the number and date printed on it.
 */
export function RecordCertificateDrawer({
  open,
  society,
  corporation,
  today,
  onClose,
  onSave,
}: {
  open: boolean;
  society: any;
  corporation: boolean;
  today: string;
  onClose: () => void;
  onSave: (values: CertificateValues) => Promise<void>;
}) {
  const { can, loaded } = usePermissions();
  const canReadDocuments = loaded && can("documents:read");
  const canUpload = loaded && can("documents:write") && isNativeFileStorageEnabled();
  const documents = useQuery(api.documents.listSummaries, open && canReadDocuments ? { societyId: society._id } : "skip") as any[] | undefined;
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  const fileRef = useRef<HTMLInputElement>(null);

  const [documentId, setDocumentId] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploaded, setUploaded] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDocumentId(society?.certificateEvidenceDocumentId ?? "");
    setNumber(society?.incorporationNumber ?? "");
    setDate(society?.certificateDate ?? "");
    setReference(society?.certificateReference ?? "");
    setErrors({});
    setSaving(false);
    setUploaded(null);
  }, [open, society]);

  const options = useMemo(() => {
    const rows = [...(documents ?? [])];
    // Likely certificates first, then the most recent.
    rows.sort((a, b) => Number(/certificate/i.test(b.title ?? "")) - Number(/certificate/i.test(a.title ?? "")));
    const list = rows.map((row) => ({ value: String(row._id), label: row.title || "Untitled document" }));
    if (uploaded && !list.some((row) => row.value === uploaded.id)) list.unshift({ value: uploaded.id, label: uploaded.title });
    return list;
  }, [documents, uploaded]);

  const upload = async (file: File | undefined) => {
    if (!file || !canUpload) return;
    if (file.size > MAX_BYTES) { setErrors({ document: "That file is over 25 MB. Upload a smaller scan." }); return; }
    setUploading(true);
    setErrors({});
    try {
      const title = `Certificate of incorporation: ${society.name}`;
      const id: string = await createDocument({
        societyId: society._id,
        title,
        category: "Certificate",
        fileName: file.name,
        mimeType: file.type || undefined,
        tags: ["certificate", "incorporation"],
      });
      await uploadDocumentVersion({ societyId: society._id, documentId: id, file, createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
      setUploaded({ id: String(id), title });
      setDocumentId(String(id));
    } catch (err: any) {
      setErrors({ document: err?.message ?? "The certificate couldn't be uploaded." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const numberLabel = corporation ? "Corporation number" : "Society number";
  const save = async () => {
    const next: Record<string, string> = {};
    if (!documentId) next.document = "Choose or upload the certificate.";
    if (!number.trim()) next.number = `Enter the ${numberLabel.toLowerCase()} shown on the certificate.`;
    if (!date) next.date = "Enter the date on the certificate.";
    else if (date > today) next.date = "The certificate date can't be in the future.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await onSave({ certificateDocumentId: documentId, incorporationNumber: number.trim(), certificateDate: date, certificateReference: reference.trim() || undefined });
    } catch (err: any) {
      setErrors({ form: err?.message ?? "The certificate couldn't be recorded." });
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record your certificate"
      className="setup-sheet"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={saving || uploading} onClick={save}>
            {saving ? "Saving…" : "Record certificate"}
          </button>
        </>
      }
    >
      <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="setup-form__lead">
          Your {corporation ? "corporation" : "society"} exists from the date on the certificate. Recording it marks the {corporation ? "corporation" : "society"} as incorporated and active, and starts its deadlines from that date.
        </p>
        <Field label="Certificate" required error={errors.document} hint={canReadDocuments ? undefined : "You need access to Documents to choose the certificate."}>
          <Select
            value={documentId}
            onChange={(value) => { setDocumentId(value); setErrors((prev) => ({ ...prev, document: "" })); }}
            options={options}
            placeholder={documents === undefined && canReadDocuments ? "Loading documents…" : "Choose an uploaded document"}
            searchable={options.length > 8}
            disabled={!canReadDocuments}
          />
        </Field>
        {canUpload && (
          <div className="setup-upload">
            <button type="button" className="btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FileUp size={14} aria-hidden="true" />}
              {uploading ? "Uploading…" : "Upload the certificate"}
            </button>
            <span className="setup-step__hint">PDF or photo, up to 25 MB. It's saved to Documents.</span>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden tabIndex={-1} onChange={(event) => void upload(event.target.files?.[0])} />
          </div>
        )}
        <Field label={numberLabel} required error={errors.number}>
          <input className="input" value={number} maxLength={40} autoComplete="off" onChange={(event) => { setNumber(event.target.value); setErrors((prev) => ({ ...prev, number: "" })); }} />
        </Field>
        <Field label="Date on the certificate" required error={errors.date}>
          <DatePicker value={date} max={today} onChange={(value) => { setDate(value); setErrors((prev) => ({ ...prev, date: "" })); }} />
        </Field>
        <Field label="Certificate reference" hint="Optional. Any other reference printed on the certificate.">
          <input className="input" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
        </Field>
        {errors.form && <p className="field__error" role="alert">{errors.form}</p>}
      </form>
    </Drawer>
  );
}
