import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HeldElsewhereDialog, PrivacyReviewDialog, VerifyCurrentDialog } from "../governingDocuments/EvidenceDialogs";
import type { GoverningDocumentSlot } from "../../../shared/governingDocuments";
import {
  governingDocumentCurrentness,
  hasIdentifiedEvidence,
  isEvidenceField,
  shortText,
  type EvidenceField,
} from "../../../shared/governingDocumentEvidence";
import type { OrganizationRecord, ProfileDocument } from "./types";

export type EvidenceDialogState = { record: "held-elsewhere" | "verify" | "privacy-review"; field: EvidenceField };
const EVIDENCE_RECORDS = ["held-elsewhere", "verify", "privacy-review"] as const;

/**
 * A dashboard action opens one of the evidence forms with
 * `?tab=documents&record=held-elsewhere&field=constitutionDocId`
 * (governingEvidenceHref in shared/governingDocumentEvidence.ts).
 */
function dialogFromSearch(search: string): EvidenceDialogState | null {
  const params = new URLSearchParams(search);
  const record = params.get("record");
  const field = params.get("field");
  if (!record || !(EVIDENCE_RECORDS as readonly string[]).includes(record) || !isEvidenceField(field)) return null;
  return { record: record as EvidenceDialogState["record"], field };
}

/** Which evidence form is open: one the row opened, or one the URL asks for. */
export function useEvidenceDialog(canEdit: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const [local, setLocal] = useState<EvidenceDialogState | null>(null);
  const fromUrl = canEdit ? dialogFromSearch(location.search) : null;
  const close = () => {
    setLocal(null);
    if (!fromUrl) return;
    // Drop the dashboard's intent so a refresh doesn't reopen the form.
    const params = new URLSearchParams(location.search);
    params.delete("record");
    params.delete("field");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
  };
  const open = (record: EvidenceDialogState["record"], field: EvidenceField) => setLocal({ record, field });
  return { dialog: local ?? fromUrl, open, close };
}

export function EvidenceDialogHost({ dialog, onClose, society, documents, slots, privacyPolicyLabel }: {
  dialog: EvidenceDialogState | null;
  onClose: () => void;
  society: OrganizationRecord;
  documents: readonly ProfileDocument[] | undefined;
  slots: readonly GoverningDocumentSlot[];
  privacyPolicyLabel: string;
}) {
  if (!dialog) return null;
  const { record, field } = dialog;
  const title = field === "privacyPolicyDocId" ? privacyPolicyLabel : slots.find((slot) => slot.field === field)?.label ?? "Document";
  const phrase = field === "privacyPolicyDocId" ? "the privacy policy" : slots.find((slot) => slot.field === field)?.phrase ?? "the document";
  const documentTitle = (id: unknown) => id ? documents?.find((row) => String(row._id) === String(id))?.title : undefined;

  // The privacy policy's currentness is its review attestation.
  if (record === "privacy-review" || (record === "verify" && field === "privacyPolicyDocId")) {
    const evidence = governingDocumentCurrentness(society, "privacyPolicyDocId").evidence;
    const linkedTitle = documentTitle(society.privacyPolicyDocId);
    const defaultLocation = linkedTitle ? `Societyer Documents: ${linkedTitle}` : evidence && evidence.kind !== "document" ? evidence.entry.reference : undefined;
    return <PrivacyReviewDialog open onClose={onClose} society={society} defaultLocation={defaultLocation} />;
  }
  // Nothing to verify until the copy is identified: record where it is held first.
  if (record === "held-elsewhere" || !hasIdentifiedEvidence(society, field)) {
    return <HeldElsewhereDialog open onClose={onClose} society={society} field={field} title={title} phrase={phrase} />;
  }
  const evidence = governingDocumentCurrentness(society, field).evidence;
  const copyLabel = evidence?.kind === "document"
    ? shortText(documentTitle(evidence.documentId) ?? "the uploaded document", 80)
    : evidence ? shortText(evidence.entry.reference, 80) : "the copy on record";
  return <VerifyCurrentDialog open onClose={onClose} society={society} field={field} title={title} phrase={phrase} copyLabel={copyLabel} />;
}
