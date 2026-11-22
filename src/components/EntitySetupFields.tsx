import type { ReactNode } from "react";
import { Field, Badge } from "./ui";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";
import { CHARITY_STATUS_OPTIONS, FORMATION_STATUS_OPTIONS, ENTITY_DATE_FIELDS, LEGAL_SUBTYPE_OPTIONS, TAX_STATUS_OPTIONS, entityPreparationDecision } from "../../shared/entitySetup";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, isSociety } from "../../shared/organizationDomain";

/**
 * The entity-setup fields of the organization profile, split so each lives on
 * its own profile tab: formation (Legal profile), tax statuses (Tax accounts)
 * and annual and ISC dates (Legal profile, "Business & year").
 */
type EntitySetupProps = { form: Record<string, any>; set: (key: string, value: any) => void };

/** The one formation status, the certificate evidence and the preparation route. */
export function FormationFields({ form, set, documents = [], registryFields }: EntitySetupProps & {
  documents?: readonly { _id: string; title?: string }[];
  /** The registry number and date, shown between the status and the certificate. */
  registryFields?: ReactNode;
}) {
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(form));
  const society = isSociety(form);
  const route = entityPreparationDecision(form);
  const subtypeOptions = LEGAL_SUBTYPE_OPTIONS.filter(({ value }) => value === "other" || (code === "CA-BC" ? society ? value.includes("society") : value.includes("company") : code === "CA-FED-CBCA" && value === "federal_private_corporation"));
  return <div className="entity-setup-group">
    <Field label="Status" hint="The legal formation status. Creating a workspace or draft does not establish incorporation.">
      <Select value={form.formationStatus ?? ""} onChange={(value) => set("formationStatus", value || undefined)} options={FORMATION_STATUS_OPTIONS.filter((option) => form._id || ["preparing", "submitted", "unverified_existing"].includes(option.value))} />
    </Field>
    {registryFields}
    {form._id && <div className="society-field-grid society-field-grid--three">
      <Field label="Certificate evidence" hint="Upload the official registry certificate in Documents, then select it. Drafts and URL-only records are insufficient."><Select value={form.certificateEvidenceDocumentId ?? ""} onChange={(value) => set("certificateEvidenceDocumentId", value || undefined)} options={[{ value: "", label: "Select an uploaded certificate" }, ...documents.map((document) => ({ value: document._id, label: document.title ?? "Untitled document" }))]} /></Field>
      <Field label="Certificate reference"><input className="input" value={form.certificateReference ?? ""} onChange={(event) => set("certificateReference", event.target.value)} /></Field>
      <Field label="Certificate date" hint="When incorporation is verified, this replaces a planned incorporation date for legal deadlines."><DatePicker value={form.certificateDate ?? ""} onChange={(value) => set("certificateDate", value)} /></Field>
    </div>}
    <p className="entity-setup-group__note">{form.formationStatus === "incorporated" ? "Save after checking the attached official certificate, its reference and date. This records your evidence verification; it does not submit a registry application." : form.formationStatus === "unverified_existing" ? "Record the existing entity details now, then upload its official certificate and verify the reference/date on this profile. An unverified app record does not determine whether the entity legally exists." : form.formationStatus ? "Preparation can proceed. Registry acceptance and statutory incorporation duties remain pending until official certificate evidence is verified." : "Legacy formation status is unverified. Existing dates are retained; no certificate acceptance has been inferred."}</p>
    <Field label="Legal subtype / preparation route" hint="Special BC company types and Ontario require a separate reviewed route.">
      <Select value={form.legalSubtype ?? ""} onChange={(value) => {
        set("legalSubtype", value);
        if (society) set("isMemberFunded", value === "member_funded_society");
      }} options={[{ value: "", label: "Confirm classification" }, ...subtypeOptions]} />
    </Field>
    <div className="entity-setup-group__route"><Badge tone={route.allowed ? "info" : "warn"}>{route.allowed ? "Preparation route" : "Review required"}</Badge><p className="entity-setup-group__note">{route.message}</p></div>
  </div>;
}

/** The CRA account statuses, as the Tax tab's program rows read them. */
export const TAX_STATUS_FIELDS = [
  { key: "craBnStatus", label: "Business number (BN) receipt" },
  { key: "craRcStatus", label: "Corporation income tax (RC) account" },
  { key: "gstHstStatus", label: "GST/HST account assessment" },
  { key: "payrollStatus", label: "Payroll account assessment" },
] as const;
export type TaxStatusField = (typeof TAX_STATUS_FIELDS)[number]["key"];

/** One tax status select. */
export function TaxStatusSelect({ form, set, field, ariaLabel }: EntitySetupProps & { field: TaxStatusField; ariaLabel?: string }) {
  return <Select value={form[field] ?? "unknown"} onChange={(value) => set(field, value)} options={TAX_STATUS_OPTIONS} aria-label={ariaLabel} />;
}

/** The charity claim (not for a business corporation) and the tax evidence reference. */
export function TaxEvidenceFields({ form, set }: EntitySetupProps) {
  const corporation = isCorporation(form);
  return <div className="entity-setup-group">
    <div className="society-field-grid">
      {/* Charitable registration is not available to a business corporation; the stored field is kept. */}
      {!corporation && <Field label="Charitable registration profile claim" hint="This records an unreviewed profile claim. Use Charity registration and evidence on Donations and receipts to record reviewed decisions and effective dates; this claim does not authorize official receipts."><Select value={form.charityStatus ?? (form.isCharity ? "registered" : "unknown")} onChange={(value) => { set("isCharity", value === "registered"); set("charityStatus", value); }} options={CHARITY_STATUS_OPTIONS} /></Field>}
      <Field label={corporation ? "Tax evidence reference" : "Tax / charity evidence reference"} hint="Reference the CRA receipt or approval document; do not include account credentials."><input className="input" value={form.taxStatusEvidence ?? ""} onChange={(event) => set("taxStatusEvidence", event.target.value)} /></Field>
    </div>
    <p className="entity-setup-group__note">BC and federal incorporations usually get a BN and RC account automatically, so check for them before requesting new ones. {corporation ? "GST/HST and payroll are" : "GST/HST, payroll and charitable registration are"} registered separately.</p>
  </div>;
}

/** The entity-specific annual and ISC / transparency dates. */
export function annualDateFields(form: Record<string, any>) {
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(form));
  const society = isSociety(form);
  return ENTITY_DATE_FIELDS.filter(({ value }) => value === "anniversaryDate" || value === "annualMeetingDate" || (society ? value === "agmExtensionDate" : code === "CA-BC" ? ["annualReferenceDate", "transparencyAwarenessDate", "transparencyEntryDate", "transparencyCessationEntryDate"].includes(value) : code === "CA-FED-CBCA" && ["iscAwarenessDate", "iscRegisterEntryDate"].includes(value)));
}

/** Anniversary, last annual meeting and ISC dates; a society's AGM year and extension evidence. */
export function AnnualDateFields({ form, set }: EntitySetupProps) {
  const society = isSociety(form);
  return <div className="entity-setup-group">
    <div className="society-field-grid">{annualDateFields(form).map(({ value, label }) => <Field key={value} label={value === "annualMeetingDate" && !society ? "Last annual meeting date" : label}><DatePicker value={form[value] ?? ""} onChange={(date) => set(value, date)} /></Field>)}</div>
    {society && <div className="society-field-grid">
      <Field label="AGM reporting year" hint="If an AGM is held under an extension, record the year that it satisfies."><input className="input" inputMode="numeric" value={form.annualMeetingYear ?? ""} onChange={(event) => set("annualMeetingYear", event.target.value ? Number(event.target.value) : undefined)} placeholder="2026" /></Field>
      <Field label="AGM extension approval evidence"><input className="input" value={form.agmExtensionEvidence ?? ""} onChange={(event) => set("agmExtensionEvidence", event.target.value)} /></Field>
    </div>}
    <p className="entity-setup-group__note">The registry anniversary, {society ? "AGM" : "annual meeting"} / annual reference date, extra-provincial registration and start of business activity are separate anchors. Registration and activity dates are kept on the Registrations tab.</p>
  </div>;
}
