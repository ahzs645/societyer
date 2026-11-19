import { Link } from "react-router-dom";
import { Select, type SelectOption } from "../../components/Select";
import { documentCategoryLabel } from "../../../shared/documentCategories";
import type { ProfileDocument } from "./types";

/**
 * Picks one uploaded document. Documents in `preferredCategories` are listed
 * first; archived ones are left out unless already chosen.
 */
export function DocumentSelect({ value, onChange, documents, preferredCategories = [], placeholder = "Choose a document", disabled, ariaLabel, id, "aria-describedby": describedBy }: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  documents: readonly ProfileDocument[];
  preferredCategories?: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Set by a surrounding Field, which labels the trigger. */
  id?: string;
  "aria-describedby"?: string;
}) {
  const rank = (document: ProfileDocument) => {
    const index = preferredCategories.indexOf(document.category ?? "");
    return index < 0 ? preferredCategories.length : index;
  };
  const options: SelectOption[] = documents
    .filter((document) => !document.archivedAtISO || document._id === value)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")))
    .map((document) => ({
      value: document._id,
      label: document.title?.trim() || document.fileName || "Untitled document",
      hint: [document.category ? documentCategoryLabel(document.category) : "", document.fileName].filter(Boolean).join(" · ") || undefined,
      keywords: document.fileName,
    }));
  return (
    <Select
      value={value ?? ""}
      onChange={(next) => onChange(next || undefined)}
      options={options}
      placeholder={documents.length ? placeholder : "No documents uploaded yet"}
      searchable={options.length > 8}
      clearable
      disabled={disabled || (!options.length && !value)}
      aria-label={ariaLabel}
      id={id}
      aria-describedby={describedBy}
    />
  );
}

/** A link to a document by id, titled from the list when it is loaded. */
export function DocumentLink({ id, documents, fallback = "Open document" }: { id: string; documents: readonly ProfileDocument[] | undefined; fallback?: string }) {
  const document = documents?.find((candidate) => candidate._id === id);
  return <Link to={`/app/documents/${id}`}>{document?.title?.trim() || document?.fileName || fallback}</Link>;
}
