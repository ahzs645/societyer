import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileDown } from "lucide-react";
import { useToast } from "../../components/Toast";
import { authenticatedFetch } from "@/lib/authToken";
import { formatDate } from "../../lib/format";
import { isModuleEnabled } from "../../lib/modules";
import {
  EvidenceActions,
  EvidenceBadge,
  GoverningDocumentPicker,
  GoverningDocumentRow,
  HeldElsewhereLine,
  useGoverningDocumentActions,
} from "../governingDocuments/GoverningDocuments";
import { governingDocumentSlots, type GoverningDocumentField } from "../../../shared/governingDocuments";
import {
  attestationLine,
  governingDocumentCurrentness,
  shortText,
  type Currentness,
  type PrivacyProgramReview,
} from "../../../shared/governingDocumentEvidence";
import { jurisdictionDisplayCopy, jurisdictionModuleContract } from "../../../shared/jurisdictionWorkspace";
import { documentUploadHref } from "./detailRows";
import { EvidenceDialogHost, useEvidenceDialog } from "./EvidenceDialogHost";
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
  const evidenceDialog = useEvidenceDialog(canEdit);
  const open = evidenceDialog.open;
  const jurisdictionCopy = jurisdictionDisplayCopy(form);
  const registryImport = jurisdictionModuleContract(form).registryImportSupported && isModuleEnabled(society, "browserConnectors");
  const slots = governingDocumentSlots(form);
  const choosingSlot = slots.find((slot) => slot.field === choosingField);
  // Auto-fill looks for uploaded copies only; a copy held elsewhere can still be imported.
  const missingCount = [society.constitutionDocId, society.bylawsDocId, society.privacyPolicyDocId].filter((value) => !value).length;
  const privacyCurrentness = governingDocumentCurrentness(society, "privacyPolicyDocId");
  const privacyDocument = society.privacyPolicyDocId ? documents?.find((row) => String(row._id) === String(society.privacyPolicyDocId)) : undefined;

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
                    currentness={governingDocumentCurrentness(society, slot.field)}
                    onChoose={() => setChoosingField(slot.field)}
                    onUnlink={() => { void governingActions.unlink(slot); }}
                    onHeldElsewhere={() => open("held-elsewhere", slot.field)}
                    onVerify={() => open("verify", slot.field)}
                  />
                ))}
                <PrivacyPolicyRow
                  label={jurisdictionCopy.privacyPolicyLabel}
                  docId={society.privacyPolicyDocId}
                  documentTitle={privacyDocument?.title}
                  currentness={privacyCurrentness}
                  review={society.privacyProgramReview}
                  canEdit={canEdit}
                  onHeldElsewhere={() => open("held-elsewhere", "privacyPolicyDocId")}
                  onReview={() => open("privacy-review", "privacyPolicyDocId")}
                />
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
          <EvidenceDialogHost
            dialog={evidenceDialog.dialog}
            onClose={evidenceDialog.close}
            society={society}
            documents={documents}
            slots={slots}
            privacyPolicyLabel={jurisdictionCopy.privacyPolicyLabel}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * The privacy policy: where it is held (uploaded or elsewhere) and the latest
 * review attestation. Its currentness is the review, so it offers Record
 * review rather than Verify current.
 */
function PrivacyPolicyRow({ label, docId, documentTitle, currentness, review, canEdit, onHeldElsewhere, onReview }: {
  label: string;
  docId?: string;
  documentTitle?: string;
  currentness: Currentness;
  review?: PrivacyProgramReview;
  canEdit: boolean;
  onHeldElsewhere: () => void;
  onReview: () => void;
}) {
  const present = Boolean(docId);
  const heldElsewhere = currentness.evidence?.kind === "document" ? currentness.evidence.heldElsewhere : currentness.evidence?.entry;
  return (
    <tr className="gov-doc-row" data-field="privacyPolicyDocId">
      <td>
        <strong>{label}</strong>
        {documentTitle && <span className="gov-doc-row__title">{documentTitle}</span>}
        {heldElsewhere && <HeldElsewhereLine entry={heldElsewhere} alsoUploaded={present} />}
        {review ? (
          <>
            <span className={`gov-doc-row__title${review.unresolvedFindings ? "" : " gov-doc-row__verified"}`}>
              {attestationLine("Reviewed", review.reviewedByName, formatDate(review.reviewedOn))}
              {review.versionOrEffectiveDate ? ` · ${review.versionOrEffectiveDate}` : ""}
            </span>
            {review.unresolvedFindings && <span className="gov-doc-row__note">Unresolved findings: {shortText(review.unresolvedFindings, 160)}</span>}
          </>
        ) : (
          <span className="gov-doc-row__title">No privacy review recorded.</span>
        )}
        <div className="gov-doc-row__actions">
          {present
            ? <Link className="btn btn--ghost btn--sm" to={`/app/documents/${docId}`} aria-label={`Open ${label}`}>Open</Link>
            : <Link className="btn btn--sm" to="/app/privacy" aria-label={`Add ${label}`}>Add</Link>}
          {canEdit && <EvidenceActions label={label} currentness={currentness} uploaded={present} onHeldElsewhere={onHeldElsewhere} />}
          {canEdit && <button type="button" className="btn btn--ghost btn--sm" onClick={onReview}>Record review</button>}
        </div>
      </td>
      <td>
        <EvidenceBadge currentness={currentness} />
      </td>
    </tr>
  );
}
