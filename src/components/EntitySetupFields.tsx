import { Field, Badge } from "./ui";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";
import { CHARITY_STATUS_OPTIONS, FORMATION_STATUS_OPTIONS, ENTITY_DATE_FIELDS, LEGAL_SUBTYPE_OPTIONS, TAX_STATUS_OPTIONS, entityPreparationDecision } from "../../shared/entitySetup";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isSociety } from "../../shared/organizationDomain";

export function EntitySetupFields({ form, set, includeDates = false, documents = [], showFormationStatus = true }: { form: Record<string, any>; set: (key: string, value: any) => void; includeDates?: boolean; documents?: any[]; showFormationStatus?: boolean }) {
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(form));
  const society = isSociety(form);
  const route = entityPreparationDecision(form);
  const subtypeOptions = LEGAL_SUBTYPE_OPTIONS.filter(({ value }) => value === "other" || (code === "CA-BC" ? society ? value.includes("society") : value.includes("company") : code === "CA-FED-CBCA" && value === "federal_private_corporation"));
  const dateFields = ENTITY_DATE_FIELDS.filter(({ value }) => value === "anniversaryDate" || value === "annualMeetingDate" || (society ? value === "agmExtensionDate" : code === "CA-BC" ? ["annualReferenceDate", "transparencyAwarenessDate", "transparencyEntryDate", "transparencyCessationEntryDate"].includes(value) : code === "CA-FED-CBCA" && ["iscAwarenessDate", "iscRegisterEntryDate"].includes(value)));
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {showFormationStatus && <Field label="Legal formation status" hint="This is separate from workspace active/archive status. Creating a workspace or draft does not establish incorporation.">
      <Select value={form.formationStatus ?? ""} onChange={(value) => set("formationStatus", value || undefined)} options={FORMATION_STATUS_OPTIONS.filter((option) => form._id || ["preparing", "submitted", "unverified_existing"].includes(option.value))} />
    </Field>}
    {form._id && <div className="society-field-grid">
      <Field label="Official certificate evidence" hint="Upload the official registry certificate in Documents, then select it. Drafts and URL-only records are insufficient."><Select value={form.certificateEvidenceDocumentId ?? ""} onChange={(value) => set("certificateEvidenceDocumentId", value || undefined)} options={[{ value: "", label: "Select an uploaded certificate" }, ...documents.map((document) => ({ value: document._id, label: document.title }))]} /></Field>
      <Field label="Official certificate reference"><input className="input" value={form.certificateReference ?? ""} onChange={(event) => set("certificateReference", event.target.value)} /></Field>
      <Field label="Actual certificate date" hint="When incorporation is verified, this replaces a planned incorporation date for legal deadlines."><DatePicker value={form.certificateDate ?? ""} onChange={(value) => set("certificateDate", value)} /></Field>
    </div>}
    <p className="muted" style={{ margin: 0 }}>{form.formationStatus === "incorporated" ? "Save after checking the attached official certificate, its reference and date. This records your evidence verification; it does not submit a registry application." : form.formationStatus === "unverified_existing" ? "Record the existing entity details now, then upload its official certificate and verify the reference/date on this profile. An unverified app record does not determine whether the entity legally exists." : form.formationStatus ? "Preparation can proceed. Registry acceptance and statutory incorporation duties remain pending until official certificate evidence is verified." : "Legacy formation status is unverified. Existing dates are retained; no certificate acceptance has been inferred."}</p>
    <Field label="Legal subtype / preparation route" hint="Special BC company types and Ontario require a separate reviewed route.">
      <Select value={form.legalSubtype ?? ""} onChange={(value) => {
        set("legalSubtype", value);
        if (society) set("isMemberFunded", value === "member_funded_society");
      }} options={[{ value: "", label: "Confirm classification" }, ...subtypeOptions]} />
    </Field>
    <div><Badge tone={route.allowed ? "info" : "warn"}>{route.allowed ? "Preparation route" : "Review required"}</Badge><p className="muted" style={{ margin: "6px 0 0" }}>{route.message}</p></div>
    <div className="society-field-grid">
      {[{ key: "craBnStatus", label: "Business number (BN) receipt" }, { key: "craRcStatus", label: "Corporation income tax (RC) account" }, { key: "gstHstStatus", label: "GST/HST account assessment" }, { key: "payrollStatus", label: "Payroll account assessment" }].map(({ key, label }) => <Field key={key} label={label}><Select value={form[key] ?? "unknown"} onChange={(value) => set(key, value)} options={TAX_STATUS_OPTIONS} /></Field>)}
      <Field label="Charitable registration"><Select value={form.charityStatus ?? (form.isCharity ? "registered" : "unknown")} onChange={(value) => { set("isCharity", value === "registered"); set("charityStatus", value); }} options={CHARITY_STATUS_OPTIONS} /></Field>
      <Field label="Tax / charity evidence reference" hint="Reference the CRA receipt or approval document; do not include account credentials."><input className="input" value={form.taxStatusEvidence ?? ""} onChange={(event) => set("taxStatusEvidence", event.target.value)} /></Field>
    </div>
    <p className="muted" style={{ margin: 0 }}>Participating BC and federal business incorporations normally receive BN and RC accounts automatically. Verify receipt before requesting a new account. GST/HST, payroll and charitable registration depend on separate assessments and approvals.</p>
    {includeDates && <>
      <div className="society-field-grid">{dateFields.map(({ value, label }) => <Field key={value} label={label}><DatePicker value={form[value] ?? ""} onChange={(date) => set(value, date)} /></Field>)}</div>
      {society && <div className="society-field-grid">
        <Field label="AGM reporting year" hint="If an AGM is held under an extension, record the year that it satisfies."><input className="input" inputMode="numeric" value={form.annualMeetingYear ?? ""} onChange={(event) => set("annualMeetingYear", event.target.value ? Number(event.target.value) : undefined)} placeholder="2026" /></Field>
        <Field label="AGM extension approval evidence"><input className="input" value={form.agmExtensionEvidence ?? ""} onChange={(event) => set("agmExtensionEvidence", event.target.value)} /></Field>
      </div>}
      <p className="muted" style={{ margin: 0 }}>The registry anniversary, AGM / annual reference date, extra-provincial registration and start of business activity are separate anchors. Save registration and activity dates in Registration records below.</p>
    </>}
  </div>;
}
