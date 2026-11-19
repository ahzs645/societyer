import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { documentCategoryLabel } from "../../../../shared/documentCategories";
import { restrictedWarning, type ImportDocumentRow } from "./importModel";

const STATUS_BADGES: Record<string, { label: string; tone: "neutral" | "info" | "warn" }> = {
  duplicate: { label: "Duplicate", tone: "neutral" },
  contained: { label: "Also in the package", tone: "neutral" },
  superseded: { label: "Superseded", tone: "warn" },
};

/** Each file with its suggested title and category, flags, and "Upload to Documents". */
export function DocumentsReview({ rows, upload, onChange }: {
  rows: readonly ImportDocumentRow[];
  upload: Readonly<Record<string, boolean>>;
  onChange: (fileId: string, checked: boolean) => void;
}) {
  const parentName = (id: string | undefined) => rows.find((row) => row.file.id === id)?.file.name;
  return (
    <section className="registry-import__section" aria-labelledby="registry-documents">
      <h3 className="registry-import__section-title" id="registry-documents">Documents</h3>
      <ul className="registry-import__fields">
        {rows.map((row) => {
          const status = STATUS_BADGES[row.entry.status];
          const checked = Boolean(upload[row.file.id]);
          const fromEmail = parentName(row.file.parentId);
          return (
            <li key={row.file.id} className="registry-import__field">
              <div className="registry-import__field-head">
                <span className="registry-import__field-label">{row.entry.suggestedTitle}</span>
                {row.entry.kind === "unknown" && <Badge tone="warn">Not recognised</Badge>}
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
                {row.reasons.length > 0 && <Badge tone="warn">Restricted</Badge>}
                {row.existing && <Badge tone="info">Already in Documents</Badge>}
              </div>
              <div className="muted registry-import__source">
                {documentCategoryLabel(row.entry.suggestedCategory)} · {row.file.name}{fromEmail ? ` · attached to ${fromEmail}` : ""}
              </div>
              {row.entry.note && <div className="muted registry-import__source">{row.entry.note}</div>}
              {row.existing && !checked && (
                <div className="muted registry-import__source">
                  The import links to <Link to={`/app/documents/${row.existing._id}`}>the copy on file</Link> instead of uploading another.
                </div>
              )}
              <Checkbox
                checked={checked}
                onChange={(next) => onChange(row.file.id, next)}
                label="Upload to Documents"
                hint={row.reasons.length ? restrictedWarning(row.reasons) : undefined}
              />
              {row.file.readWarnings.length > 0 && <div className="registry-import__note registry-import__note--warn">{row.file.readWarnings.join(" ")}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
