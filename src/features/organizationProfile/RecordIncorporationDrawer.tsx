import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Banner, Drawer, Field } from "../../components/ui";
import { Checkbox, RadioGroup } from "../../components/Controls";
import { DatePicker } from "../../components/DatePicker";
import { OptionSelect } from "../../components/OptionSelect";
import { useToast } from "../../components/Toast";
import { isDemoMode } from "../../lib/demoMode";
import { formatDate } from "../../lib/format";
import { DocumentSelect } from "./DocumentSelect";
import { addressLine } from "./detailRows";
import { REGISTRY_IMPORT_TAG } from "./registryFacts";
import { useProfileDocumentUpload } from "./useProfileDocumentUpload";
import { proposedRegisteredOffice } from "../../../shared/registeredOffice";
import type { OrganizationDetail, OrganizationRecord, ProfileDocument } from "./types";

/** Values the drawer opens with, e.g. from a registry import. */
export type RecordIncorporationPrefill = {
  certificateDocumentId?: string;
  incorporationNumber?: string;
  incorporationDate?: string;
  actFormedUnder?: string;
};

type CertificateSource = "existing" | "upload";


/**
 * "Record incorporation": turns a preparing or filed organization into a
 * verified incorporated one from its official certificate, through
 * `organizationDetails.recordIncorporation`. The certificate is an uploaded
 * document (chosen, or uploaded here); the number, date and Act come from it.
 */
export function RecordIncorporationDrawer({ open, onClose, society, detail, documents, canEdit, prefill, unsavedChanges, onRecorded }: {
  open: boolean;
  onClose: () => void;
  society: OrganizationRecord;
  detail: OrganizationDetail | undefined;
  documents: readonly ProfileDocument[] | undefined;
  canEdit: boolean;
  prefill?: RecordIncorporationPrefill;
  /** The profile has edits "Save changes" has not written; recording resets the form. */
  unsavedChanges: boolean;
  /** Called after the incorporation is recorded, before the drawer closes. */
  onRecorded: () => void;
}) {
  const toast = useToast();
  const recordIncorporation = useMutation(api.organizationDetails.recordIncorporation);
  const upload = useProfileDocumentUpload(society._id);
  const [source, setSource] = useState<CertificateSource>("existing");
  const [certificateId, setCertificateId] = useState<string | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [act, setAct] = useState<string | undefined>();
  const [makeOfficeCurrent, setMakeOfficeCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const demo = isDemoMode();
  const certificates = (documents ?? []).filter((document) => document.category === "CertificateOfIncorporation" || document._id === certificateId);
  const office = proposedRegisteredOffice(detail?.addresses ?? []);

  // Start from the prefill (or the profile) each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    const chosen = prefill?.certificateDocumentId ?? society.certificateEvidenceDocumentId;
    setSource(chosen || (documents ?? []).some((document) => document.category === "CertificateOfIncorporation") ? "existing" : "upload");
    setCertificateId(chosen);
    setFile(null);
    setNumber(prefill?.incorporationNumber ?? society.incorporationNumber ?? "");
    setDate(prefill?.incorporationDate ?? society.certificateDate ?? society.incorporationDate ?? "");
    setReference(society.certificateReference ?? "");
    setAct(prefill?.actFormedUnder ?? society.actFormedUnder);
    setMakeOfficeCurrent(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const submit = async () => {
    if (!canEdit || saving) return;
    setError(null);
    if (!number.trim()) return setError("Enter the corporation number shown on the certificate.");
    if (!date) return setError("Enter the date of incorporation shown on the certificate.");
    if (source === "existing" && !certificateId) return setError("Choose the uploaded certificate, or upload it here.");
    if (source === "upload" && !file) return setError("Choose the certificate file to upload.");
    setSaving(true);
    try {
      let documentId = source === "existing" ? certificateId : undefined;
      if (source === "upload" && file) {
        documentId = await upload(file, { title: `Certificate of incorporation – ${society.name}`, category: "CertificateOfIncorporation", tags: [REGISTRY_IMPORT_TAG] });
        // A retry uses the uploaded copy instead of uploading again.
        setSource("existing");
        setCertificateId(documentId);
        setFile(null);
      }
      if (!documentId) throw new Error("Choose the certificate.");
      const result = await recordIncorporation({
        societyId: society._id,
        incorporationNumber: number.trim(),
        incorporationDate: date,
        certificateEvidenceDocumentId: documentId,
        certificateReference: reference.trim() || undefined,
        actFormedUnder: act || undefined,
        registeredOfficeEffectiveFrom: date,
        makeRegisteredOfficeCurrent: Boolean(office) && makeOfficeCurrent,
      }) as { registeredOfficeUpdated: boolean };
      onRecorded();
      toast.success("Incorporation recorded", result.registeredOfficeUpdated ? `The registered office is current from ${formatDate(date)}.` : undefined);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record incorporation"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={!canEdit || saving} onClick={() => { void submit(); }}>
            {saving ? "Recording…" : "Record incorporation"}
          </button>
        </>
      }
    >
      <p className="muted org-drawer-intro">
        Fills the number, date and certificate from the Certificate of Incorporation and marks the organization incorporated.
      </p>
      {demo && (
        <Banner tone="warn" title="Demo workspace">
          A demo upload can't verify a certificate, so the incorporation can't be recorded here.
        </Banner>
      )}
      {unsavedChanges && (
        <Banner tone="warn">The profile has unsaved changes. Recording the incorporation reloads the profile and discards them.</Banner>
      )}
      {error && <Banner tone="danger" title="Not recorded">{error}</Banner>}
      <div className="field" role="group" aria-labelledby="record-incorporation-source">
        <span className="field__label" id="record-incorporation-source">Official certificate</span>
        <RadioGroup<CertificateSource>
          name="record-incorporation-source"
          value={source}
          onChange={setSource}
          options={[
            { value: "existing", label: "Choose an uploaded certificate" },
            { value: "upload", label: "Upload it now" },
          ]}
        />
      </div>
      {source === "existing" ? (
        <Field label="Certificate document" hint="Documents filed as a certificate of incorporation. Drafts and links can't verify it.">
          <DocumentSelect value={certificateId} onChange={setCertificateId} documents={certificates} placeholder="Choose the certificate" />
        </Field>
      ) : (
        <Field label="Certificate file" hint="The PDF from the registry. Every director can open uploaded documents.">
          <input className="input" type="file" accept="application/pdf,.pdf,image/*" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        </Field>
      )}
      <div className="row" style={{ gap: 12 }}>
        <Field label="Corporation number"><input className="input mono" value={number} onChange={(event) => setNumber(event.target.value)} /></Field>
        <Field label="Date of incorporation"><DatePicker value={date} onChange={setDate} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Certificate reference" hint="Defaults to the corporation number."><input className="input" value={reference} placeholder={number || "Corporation number"} onChange={(event) => setReference(event.target.value)} /></Field>
        <OptionSelect label="Act" setName="actsFormedUnder" value={act ?? ""} onChange={setAct} emptyLabel="Keep the profile's Act" />
      </div>
      {office ? (
        <Checkbox
          checked={makeOfficeCurrent}
          onChange={setMakeOfficeCurrent}
          label="Make the registered office current from this date"
          hint={`${addressLine(office) || "The proposed registered office"} is marked Proposed.`}
        />
      ) : (
        <p className="muted org-drawer-note">No proposed registered office to make current.</p>
      )}
    </Drawer>
  );
}
