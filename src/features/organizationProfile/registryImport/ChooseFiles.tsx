import { FileText, Mail, Trash2, Upload } from "lucide-react";
import { isRegistryFile, MAX_REGISTRY_FILE_BYTES, MAX_REGISTRY_FILES } from "./readRegistryFiles";

export type ChosenFile = { id: string; file: File };

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

let nextId = 0;

/** Adds chosen files to the list: PDFs and emails only, no repeats, within the size and count limits. */
export function addChosenFiles(current: readonly ChosenFile[], incoming: readonly File[]): { files: ChosenFile[]; skipped: string[] } {
  const files = [...current];
  const skipped: string[] = [];
  for (const file of incoming) {
    if (!isRegistryFile(file)) skipped.push(`${file.name}: only PDF and .eml files are read.`);
    else if (file.size > MAX_REGISTRY_FILE_BYTES) skipped.push(`${file.name}: larger than ${sizeLabel(MAX_REGISTRY_FILE_BYTES)}.`);
    else if (files.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
    else if (files.length >= MAX_REGISTRY_FILES) skipped.push(`${file.name}: at most ${MAX_REGISTRY_FILES} files at a time.`);
    else files.push({ id: `f${nextId++}`, file });
  }
  return { files, skipped };
}

/** Step 1: choose the registry PDFs and saved emails. Nothing leaves the device until "Apply". */
export function ChooseFiles({ files, skipped, onAdd, onRemove }: {
  files: readonly ChosenFile[];
  skipped: readonly string[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="registry-import__choose">
      <p className="muted org-drawer-intro">
        Add the certificate package, articles, information sheet, ISC filing, BC registration documents and the registry emails (.eml).
        They are read on this device. Nothing is saved or uploaded until you review the changes and apply them.
      </p>
      <label className="btn registry-import__pick">
        <Upload size={14} /> Choose PDFs and emails
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf,message/rfc822,.eml"
          className="registry-import__file-input"
          onChange={(event) => {
            onAdd(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </label>
      {skipped.length > 0 && (
        <ul className="registry-import__skipped" aria-label="Files not added">
          {skipped.map((message) => <li key={message}>{message}</li>)}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="registry-import__files" aria-label="Chosen files">
          {files.map(({ id, file }) => (
            <li key={id}>
              {/\.eml$/i.test(file.name) ? <Mail size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
              <span className="registry-import__file-name">{file.name}</span>
              <span className="muted registry-import__file-size">{sizeLabel(file.size)}</span>
              <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(id)}><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
