import { DocumentPreviewByIdButton } from "../../components/DocumentFilePreview";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { Search } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { Checkbox } from "../../components/Controls";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { categoryMatchKey, documentCategoryLabel, isInternalDocumentRecord } from "../../../shared/documentCategories";
import { categoryFitsGoverningField, governingDocumentAudience, type GoverningDocumentSlot } from "../../../shared/governingDocuments";

/**
 * Governing documents on the organization profile: each row shows whether
 * the articles / by-laws (constitution / bylaws) are on file, and lets people
 * upload one, choose a document already in the workspace, replace it or
 * unlink it (with Undo).
 */

type DocumentRow = { _id: string; title?: string; category?: string; createdAtISO?: string; fileName?: string; archivedAtISO?: string };
type LinkResult = { field: string; documentId: string | null; previousDocumentId: string | null; changed: boolean; categoryChange: { from: string; to: string } | null };

/** Rows that can be chosen: this workspace's open documents, recent first. */
export function choosableDocuments(documents: readonly DocumentRow[] | undefined) {
  return (documents ?? [])
    .filter((doc) => !doc.archivedAtISO && !isInternalDocumentRecord(doc))
    .slice()
    .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
}

export function useGoverningDocumentActions(society: any) {
  const link = useMutation(api.society.linkGoverningDocument);
  const updateCategory = useMutation(api.documents.updateCategory);
  const toast = useToast();
  const societyId = society?._id;

  const undo = async (slot: GoverningDocumentSlot, result: LinkResult) => {
    try {
      await link({ societyId, field: slot.field, documentId: result.previousDocumentId ?? null });
      if (result.categoryChange && result.documentId) {
        await updateCategory({ id: result.documentId, category: result.categoryChange.from, fillProfile: false });
      }
      toast.info("Change undone");
    } catch (error: any) {
      toast.error("Could not undo", error?.message ?? String(error));
    }
  };

  const choose = async (slot: GoverningDocumentSlot, document: DocumentRow, refile: boolean) => {
    const result = await link({ societyId, field: slot.field, documentId: document._id, updateCategory: refile }) as LinkResult;
    const replaced = Boolean(result.previousDocumentId && result.previousDocumentId !== document._id);
    toast.success(`${slot.label} ${replaced ? "replaced" : "on file"}`, {
      description: result.categoryChange
        ? `${document.title ?? "The document"} is now filed as ${slot.categoryLabel}.`
        : document.title,
      ...(result.changed ? { action: { label: "Undo", onClick: () => { void undo(slot, result); } } } : {}),
    });
  };

  const unlink = async (slot: GoverningDocumentSlot) => {
    try {
      const result = await link({ societyId, field: slot.field, documentId: null }) as LinkResult;
      toast.success(`${slot.label} unlinked`, {
        description: "The document stays in Documents.",
        ...(result.changed ? { action: { label: "Undo", onClick: () => { void undo(slot, result); } } } : {}),
      });
    } catch (error: any) {
      toast.error(`Could not unlink ${slot.phrase}`, error?.message ?? String(error));
    }
  };

  return { choose, unlink };
}

export function GoverningDocumentRow({
  slot,
  docId,
  documents,
  organization,
  canEdit,
  uploadHref,
  onChoose,
  onUnlink,
}: {
  slot: GoverningDocumentSlot;
  docId?: string;
  documents: readonly DocumentRow[] | undefined;
  organization: any;
  canEdit: boolean;
  uploadHref: string;
  onChoose: () => void;
  onUnlink: () => void;
}) {
  const present = Boolean(docId);
  const document = present ? documents?.find((row) => String(row._id) === String(docId)) : undefined;
  // A linked document filed under another category stays linked; say so.
  const refiled = document && !categoryFitsGoverningField(document.category, slot.field, organization)
    ? documentCategoryLabel(document.category, governingDocumentAudience(organization))
    : undefined;
  return (
    <tr className="gov-doc-row" data-field={slot.field}>
      <td>
        <strong>{slot.label}</strong>
        {document?.title && <span className="gov-doc-row__title">{document.title}</span>}
        {refiled && <span className="gov-doc-row__note">This document is now filed as {refiled}.</span>}
        <div className="gov-doc-row__actions">
          {present ? (
            <>
              <Link className="btn btn--ghost btn--sm" to={`/app/documents/${docId}`} aria-label={`Open ${slot.label}`}>Open</Link>
              <DocumentPreviewByIdButton documentId={docId!} />
              {canEdit && <button type="button" className="btn btn--ghost btn--sm" onClick={onChoose} aria-label={`Replace ${slot.label}`}>Replace</button>}
              {canEdit && <button type="button" className="btn btn--ghost btn--sm" onClick={onUnlink} aria-label={`Unlink ${slot.label}`}>Unlink</button>}
            </>
          ) : (
            <>
              <Link className="btn btn--sm" to={uploadHref} aria-label={`Upload ${slot.label}`}>Upload</Link>
              {canEdit && <button type="button" className="btn btn--ghost btn--sm" onClick={onChoose} aria-label={`Choose a document for ${slot.label}`}>Choose a document</button>}
            </>
          )}
        </div>
      </td>
      <td>
        <Badge tone={present ? "success" : "warn"}>{present ? "On file" : "Missing"}</Badge>
      </td>
    </tr>
  );
}

const PICKER_LIMIT = 100;

export function GoverningDocumentPicker({
  open,
  slot,
  organization,
  currentDocumentId,
  documents,
  onClose,
  onChoose,
}: {
  open: boolean;
  slot: GoverningDocumentSlot | null;
  organization: any;
  currentDocumentId?: string;
  documents: readonly DocumentRow[] | undefined;
  onClose: () => void;
  onChoose: (document: DocumentRow, refile: boolean) => Promise<void>;
}) {
  const audience = useMemo(() => governingDocumentAudience(organization), [organization]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refile, setRefile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(null);
    setRefile(true);
    setError(null);
  }, [open, slot?.field]);

  const rows = useMemo(() => choosableDocuments(documents), [documents]);
  const matches = useMemo(() => {
    const needle = categoryMatchKey(query);
    if (!needle) return rows;
    return rows.filter((doc) =>
      [doc.title, doc.fileName, documentCategoryLabel(doc.category, audience)].some((value) => categoryMatchKey(value).includes(needle)));
  }, [rows, query, audience]);
  const shown = matches.slice(0, PICKER_LIMIT);
  const selected = rows.find((doc) => String(doc._id) === selectedId);
  const mismatch = Boolean(slot && selected && !categoryFitsGoverningField(selected.category, slot.field, organization));

  if (!slot) return null;
  const submit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChoose(selected, mismatch && refile);
      onClose();
    } catch (cause: any) {
      setError(cause?.message ?? String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Choose ${slot.phrase}`}
      resizeKey="governing-document-picker"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn--accent" onClick={submit} disabled={!selected || busy}>
            {busy ? "Saving…" : "Use this document"}
          </button>
        </>
      }
    >
      <div className="gov-doc-picker">
        <p className="gov-doc-picker__intro">Pick a document already in Documents. It shows as {slot.phrase} on the profile.</p>
        <label className="gov-doc-picker__search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or category"
            aria-label="Search documents"
            autoFocus
          />
        </label>
        {documents === undefined ? (
          <p className="gov-doc-picker__empty">Loading documents…</p>
        ) : rows.length === 0 ? (
          <p className="gov-doc-picker__empty">No documents yet. Upload {slot.phrase} instead.</p>
        ) : shown.length === 0 ? (
          <p className="gov-doc-picker__empty">No documents match “{query.trim()}”.</p>
        ) : (
          <div className="gov-doc-picker__list" role="radiogroup" aria-label="Documents">
            {shown.map((doc) => {
              const id = String(doc._id);
              const current = id === String(currentDocumentId ?? "");
              return (
                <label key={id} className={`gov-doc-picker__option${selectedId === id ? " is-selected" : ""}${current ? " is-current" : ""}`}>
                  <input
                    type="radio"
                    name={name}
                    value={id}
                    checked={selectedId === id}
                    disabled={current}
                    onChange={() => setSelectedId(id)}
                  />
                  <span className="gov-doc-picker__text">
                    <span className="gov-doc-picker__title">{doc.title || "Untitled document"}</span>
                    <span className="gov-doc-picker__meta">
                      {documentCategoryLabel(doc.category, audience)}
                      {doc.createdAtISO ? ` · ${formatDate(doc.createdAtISO)}` : ""}
                    </span>
                  </span>
                  {current && <Badge tone="success">On file now</Badge>}
                </label>
              );
            })}
          </div>
        )}
        {matches.length > shown.length && (
          <p className="gov-doc-picker__more">Showing the {shown.length} most recent of {matches.length}. Search to find others.</p>
        )}
        {mismatch && selected && (
          <div className="gov-doc-picker__refile">
            <Checkbox
              checked={refile}
              onChange={setRefile}
              label={`Also file it as ${slot.categoryLabel}`}
              hint={`It's filed as ${documentCategoryLabel(selected.category, audience)} now.`}
            />
          </div>
        )}
        {error && <p className="gov-doc-picker__error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
