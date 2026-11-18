import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { FileDropZone, type FileRejection } from "../../components/FileDropZone";
import { Select } from "../../components/Select";
import { Field } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { useWorkspaceStoragePolicy } from "../../hooks/useWorkspaceStoragePolicy";
import { uploadDocumentVersion } from "../../lib/documentVersionUpload";
import type { Id } from "../../../convex/_generated/dataModel";

const MAX_BYTES = 25 * 1024 * 1024;

type DocumentSummary = { _id: string; title?: string };

/**
 * The files a name request keeps (the submission confirmation, the NUANS
 * receipt, the decision letter): pick documents already in Documents, or
 * upload one here, which saves it to Documents first.
 */
export function NameRequestFiles({
  societyId,
  documentIds,
  onChange,
}: {
  societyId: Id<"societies">;
  documentIds: string[];
  onChange: (documentIds: string[]) => void;
}) {
  const { can, loaded } = usePermissions();
  const storagePolicy = useWorkspaceStoragePolicy();
  const canRead = loaded && can("documents:read");
  const canUpload = loaded && can("documents:write") && storagePolicy.documentVersions;
  const documents = useQuery(api.documents.listSummaries, canRead ? { societyId } : "skip") as DocumentSummary[] | undefined;
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  // Titles of files uploaded here, before the document list catches up.
  const [uploadedTitles, setUploadedTitles] = useState<Record<string, string>>({});

  const titles = useMemo(() => {
    const map = new Map<string, string>(Object.entries(uploadedTitles));
    for (const row of documents ?? []) map.set(String(row._id), row.title || "Untitled document");
    return map;
  }, [documents, uploadedTitles]);
  const options = useMemo(
    () => (documents ?? [])
      .filter((row) => !documentIds.includes(String(row._id)))
      .map((row) => ({ value: String(row._id), label: row.title || "Untitled document" })),
    [documents, documentIds],
  );

  const upload = async (files: File[]) => {
    if (!canUpload || !files.length) return;
    setUploading(true);
    setError("");
    const added: string[] = [];
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 25 MB.`);
        const title = `Name request: ${file.name.replace(/\.[^.]+$/, "")}`;
        const id: string = await createDocument({
          societyId,
          title,
          category: /receipt/i.test(file.name) ? "Receipt" : "Filing",
          fileName: file.name,
          mimeType: file.type || undefined,
          tags: ["name-request", "incorporation"],
        });
        await uploadDocumentVersion({ societyId, documentId: id, file, createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
        setUploadedTitles((prev) => ({ ...prev, [String(id)]: title }));
        added.push(String(id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file couldn't be uploaded.");
    } finally {
      if (added.length) onChange([...documentIds, ...added]);
      setUploading(false);
    }
  };

  const onReject = ([first]: FileRejection[]) => {
    if (!first) return;
    setError(first.reason === "size" ? "That file is over 25 MB." : "That file type isn't supported. Upload a PDF or an image.");
  };

  return (
    <>
      {documentIds.length > 0 && (
        <ul className="name-request-files">
          {documentIds.map((id) => (
            <li key={id} className="name-request-files__item">
              {canRead ? <Link to={`/app/documents/${id}`}>{titles.get(id) ?? "Document"}</Link> : <span>{titles.get(id) ?? "Document"}</span>}
              <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Remove ${titles.get(id) ?? "document"}`} onClick={() => onChange(documentIds.filter((value) => value !== id))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {canRead && (
        <Field label="Add a document">
          <Select
            value=""
            onChange={(value) => { if (value) onChange([...documentIds, value]); }}
            options={options}
            placeholder={documents === undefined ? "Loading documents…" : options.length ? "Choose from Documents" : "No other documents"}
            searchable={options.length > 8}
            disabled={!options.length}
          />
        </Field>
      )}
      {canUpload && (
        <FileDropZone
          ariaLabel="Name request files"
          title="Drop the confirmation or receipt here"
          touchTitle="Upload a file"
          chooseLabel="Choose files"
          busy={uploading}
          busyLabel="Uploading…"
          hint="PDF or image, up to 25 MB each. Saved to Documents."
          accept="application/pdf,image/*"
          maxBytes={MAX_BYTES}
          multiple
          error={error}
          onFiles={upload}
          onReject={onReject}
        />
      )}
    </>
  );
}
