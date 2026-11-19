import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileDown } from "lucide-react";
import { Badge } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { authenticatedFetch } from "@/lib/authToken";
import { isModuleEnabled } from "../../lib/modules";
import { GoverningDocumentPicker, GoverningDocumentRow, useGoverningDocumentActions } from "../governingDocuments/GoverningDocuments";
import { governingDocumentSlots, type GoverningDocumentField } from "../../../shared/governingDocuments";
import { jurisdictionDisplayCopy, jurisdictionModuleContract } from "../../../shared/jurisdictionWorkspace";
import { documentUploadHref } from "./detailRows";
import type { OrganizationRecord, ProfileDocument, ProfileForm } from "./types";

type DocumentsProps = {
  society: OrganizationRecord;
  form: ProfileForm;
  canEdit: boolean;
  documents: readonly ProfileDocument[] | undefined;
  /** Phase 2's "Registry package" card, shown above the governing documents. */
  registryPackage?: ReactNode;
};

type ImportMessage = { message?: string; reason?: string };

/** Documents: the governing documents (with the picker and registry auto-fill), and a slot for the registry package. */
export function DocumentsTab({ society, form, canEdit, documents, registryPackage }: DocumentsProps) {
  const toast = useToast();
  const governingActions = useGoverningDocumentActions(society);
  const [choosingField, setChoosingField] = useState<GoverningDocumentField | null>(null);
  const [importing, setImporting] = useState(false);
  const jurisdictionCopy = jurisdictionDisplayCopy(form);
  const registryImport = jurisdictionModuleContract(form).registryImportSupported && isModuleEnabled(society, "browserConnectors");
  const slots = governingDocumentSlots(form);
  const choosingSlot = slots.find((slot) => slot.field === choosingField);
  const missingCount = [society.constitutionDocId, society.bylawsDocId, society.privacyPolicyDocId].filter((value) => !value).length;

  const importGovernanceDocuments = async () => {
    setImporting(true);
    try {
      const response = await authenticatedFetch("/api/v1/browser-connectors/governance-documents/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ societyId: society._id, corpNum: society.incorporationNumber }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.message ?? `Request failed with ${response.status}`);
      }
      const data = payload.data ?? {};
      const imported: unknown[] = Array.isArray(data.imported) ? data.imported : [];
      const missing: ImportMessage[] = Array.isArray(data.missing) ? data.missing : [];
      if (imported.length) {
        toast.success("Governance documents imported", `${imported.length} document${imported.length === 1 ? "" : "s"} linked from BC Registry.`);
      } else if (missing.length) {
        toast.warn("No registry documents imported", missing.map((item) => item.message ?? item.reason).filter(Boolean).join(" "));
      } else {
        toast.info("Governance documents already on file");
      }
    } catch (error) {
      toast.error("Could not import governance documents", error instanceof Error ? error.message : "Open a BC Registry browser session and try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="org-profile-panel">
      {registryPackage}
      <section className="card" id="governing-documents" aria-labelledby="org-governing-documents">
        <div className="card__head">
          <h2 className="card__title" id="org-governing-documents">Governing documents</h2>
          {registryImport && (
            <button
              className="btn btn--sm org-profile-card-link"
              onClick={importGovernanceDocuments}
              disabled={importing || missingCount === 0}
              type="button"
              title="Fill missing documents from the registry"
            >
              <FileDown size={12} />
              {importing ? "Checking…" : "Auto-fill"}
            </button>
          )}
        </div>
        <div className="card__body">
          <div className="table-wrap society-doc-table-wrap">
            <table className="table society-doc-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {/* Uploading or re-filing with the matching category puts the first
                    document on file; "Choose a document" links any document here.
                    A BC company's articles take the place of separate by-laws. */}
                {slots.map((slot) => (
                  <GoverningDocumentRow
                    key={slot.field}
                    slot={slot}
                    docId={society[slot.field]}
                    documents={documents}
                    organization={form}
                    canEdit={canEdit}
                    uploadHref={documentUploadHref(slot.category, slot.categoryLabel)}
                    onChoose={() => setChoosingField(slot.field)}
                    onUnlink={() => { void governingActions.unlink(slot); }}
                  />
                ))}
                <DocTableRow label={jurisdictionCopy.privacyPolicyLabel} docId={society.privacyPolicyDocId} uploadHref="/app/privacy" uploadLabel="Add" />
              </tbody>
            </table>
          </div>
          <GoverningDocumentPicker
            open={Boolean(choosingSlot)}
            slot={choosingSlot ?? null}
            organization={form}
            currentDocumentId={choosingSlot ? society[choosingSlot.field] : undefined}
            documents={documents}
            onClose={() => setChoosingField(null)}
            onChoose={(document, refile) => governingActions.choose(choosingSlot!, document, refile)}
          />
        </div>
      </section>
    </div>
  );
}

function DocTableRow({ label, docId, uploadHref, uploadLabel = "Upload" }: { label: string; docId?: string; uploadHref: string; uploadLabel?: string }) {
  const present = Boolean(docId);
  return (
    <tr className="gov-doc-row">
      <td>
        <strong>{label}</strong>
        <div className="gov-doc-row__actions">
          {present
            ? <Link className="btn btn--ghost btn--sm" to={`/app/documents/${docId}`} aria-label={`Open ${label}`}>Open</Link>
            : <Link className="btn btn--sm" to={uploadHref} aria-label={`${uploadLabel} ${label}`}>{uploadLabel}</Link>}
        </div>
      </td>
      <td>
        <Badge tone={present ? "success" : "warn"}>{present ? "On file" : "Missing"}</Badge>
      </td>
    </tr>
  );
}
