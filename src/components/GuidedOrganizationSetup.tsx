import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2 } from "lucide-react";
import { Field } from "./ui";
import { Select } from "./Select";
import { EntitySetupFields } from "./EntitySetupFields";
import { StructuredAddressTextFields } from "./StructuredAddressFields";
import { IncorporationPreparation } from "./IncorporationPreparation";
import { PATHWAY_REGISTRY, getPathway, resolvePathway } from "../../shared/pathways/registry";
import { isCorporation, validateWorkspaceLegalIdentity } from "../../shared/organizationDomain";
import { validateEntitySetup } from "../../shared/entitySetup";
import { readOnboardingAnswersJson, validateInitialOrganizationProfile, type OrganizationOnboardingAnswers } from "../../shared/onboarding";
import { optionChoices, optionLabel } from "../lib/orgHubOptions";

const STEPS = ["Your previous workspace", "Legal setup", "Organization profile", "People and governance", "Review and continue"];

export function GuidedOrganizationSetup({ onCreate, saving, restoreCard, restoreRequested, canRestore }: {
  onCreate: (values: Record<string, any>) => Promise<void>;
  saving: boolean;
  restoreCard: ReactNode;
  restoreRequested: boolean;
  canRestore: boolean;
}) {
  const [step, setStep] = useState(0);
  const [previousUse, setPreviousUse] = useState<"new" | "returning" | null>(restoreRequested ? "returning" : null);
  const [restoring, setRestoring] = useState(restoreRequested);
  const [stage, setStage] = useState<"preparing" | "existing" | null>(null);
  const [pathwayKey, setPathwayKey] = useState("");
  const [sameMailing, setSameMailing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState({ governanceStructure: "needs_review", classDetails: "", governanceDocuments: "needs_review", peopleReadiness: "add_later", operatingRegions: "" });
  const [form, setForm] = useState<Record<string, any>>({
    name: "", incorporationNumber: "", incorporationDate: "", fiscalYearEnd: "", officialEmail: "",
    ...getPathway("bc_society")!.setup, legalSubtype: "ordinary_society", isMemberFunded: false, isCharity: false,
    numbered: false, distributing: false, formationStatus: "preparing", organizationStatus: "pre_incorporation",
    registeredOfficeAddress: "", mailingAddress: "", purposes: "", privacyOfficerName: "", privacyOfficerEmail: "",
    craBnStatus: "unknown", craRcStatus: "unknown", gstHstStatus: "unknown", payrollStatus: "unknown", charityStatus: "unknown", taxStatusEvidence: "",
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const corporate = isCorporation(form);
  const route = resolvePathway(form);
  const set = (key: string, value: any) => setForm((current) => ({ ...current, [key]: value,
    ...(key === "isMemberFunded" ? { legalSubtype: value ? "member_funded_society" : "ordinary_society" } : key === "legalSubtype" ? { isMemberFunded: value === "member_funded_society" } : {}),
  }));
  const chooseStage = (value: "preparing" | "existing") => {
    setStage(value);
    setForm((current) => ({ ...current, formationStatus: value === "preparing" ? "preparing" : "unverified_existing", organizationStatus: value === "preparing" ? "pre_incorporation" : "active", ...(value === "preparing" ? { incorporationNumber: "", incorporationDate: "" } : {}) }));
    if (value === "preparing" && pathwayKey === "custom_existing") setPathwayKey("");
  };
  const choosePathway = (key: string) => {
    setPathwayKey(key);
    const pathway = getPathway(key);
    if (!pathway) {
      if (key === "custom_existing") setForm((current) => ({ ...current, jurisdictionCode: "", entityType: "", actFormedUnder: "", legalSubtype: "other", isMemberFunded: false, isCharity: false, charityStatus: "unknown", numbered: false, distributing: false }));
      return;
    }
    setForm((current) => ({ ...current, jurisdictionCode: pathway.setup.jurisdictionCode, entityType: pathway.setup.entityType, actFormedUnder: pathway.setup.actFormedUnder,
      legalSubtype: pathway.eligibility.subtypes[0] ?? "other", isMemberFunded: false, isCharity: false, numbered: false, distributing: false, charityStatus: "unknown" }));
    setAnswers((current) => ({ ...current, governanceStructure: "needs_review", classDetails: "" }));
  };
  const buildValues = () => {
    const setupAnswers = { version: 1, previousUse: previousUse ?? "new", organizationStage: stage, pathwayKey, ...answers } as OrganizationOnboardingAnswers;
    // The registry setup label/hint are presentation metadata, not database fields.
    const { label: _label, hint: _hint, ...values } = form;
    return { ...values, mailingAddress: sameMailing ? form.registeredOfficeAddress : form.mailingAddress, onboardingAnswersJson: JSON.stringify(setupAnswers) };
  };
  const next = () => {
    setError(null);
    try {
      if (step === 1 && !stage) throw new Error("Choose whether the organization already exists or is preparing incorporation.");
      if (step === 1 && !pathwayKey) throw new Error("Choose the actual or planned governing Act.");
      if (step === 1 && pathwayKey === "custom_existing" && (!form.jurisdictionCode || !form.entityType || !form.actFormedUnder)) throw new Error("Enter the existing organization's jurisdiction, entity type and governing Act.");
      if (step === 1) validateWorkspaceLegalIdentity(form);
      if (step >= 2) validateInitialOrganizationProfile(form);
      if (step >= 3) { validateEntitySetup(form); readOnboardingAnswersJson(buildValues().onboardingAnswersJson, form); }
      setStep((current) => Math.min(4, current + 1));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the setup answers."); }
  };
  const create = async () => {
    setError(null);
    try { const values = buildValues(); validateInitialOrganizationProfile(values); validateEntitySetup(values); readOnboardingAnswersJson(values.onboardingAnswersJson, values); await onCreate(values); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the workspace."); }
  };
  return <div className="society-create-shell"><div className="society-create">
    <aside className="society-create__intro">
      <div className="society-create__brand"><div className="society-create__logo"><Building2 size={18} /></div><span>Societyer setup</span></div>
      <div className="society-create__copy"><h1>New organization workspace</h1><p>Restore your records, set up an existing organization, or prepare a new incorporation. We will walk through the details and create a follow-up checklist.</p></div>
      <ol className="society-create__steps" aria-label="Setup progress" style={{ listStyle: "none", padding: 0 }}>
        {STEPS.map((title, index) => <li className="society-create__step" key={title} aria-current={step === index ? "step" : undefined}><span className="society-create__step-index">{index < step ? <CheckCircle2 size={14} /> : index + 1}</span><span>{title}</span></li>)}
      </ol>
    </aside>
    <main className="society-create__main">
      <div className="society-create__topbar"><Link className="btn" to="/app/society">Cancel</Link>{step > 0 && <button type="button" className="btn" disabled={saving} onClick={() => { setError(null); setStep(step - 1); }}>Back</button>}</div>
      <section className="card society-create__card"><div className="card__head"><h2 ref={heading} tabIndex={-1} className="card__title">{STEPS[step]}</h2></div>
        <form className="card__body" style={{ display: "grid", gap: 16 }} onSubmit={(event) => { event.preventDefault(); if (step === 4) void create(); else next(); }}>
          <fieldset disabled={saving} aria-label="Setup answers" style={{ display: "grid", gap: 16, margin: 0, padding: 0, minWidth: 0, border: 0 }}>
          {error && <div className="notice notice--danger" role="alert">{error}</div>}
          {step === 0 && <>
            <p style={{ margin: 0 }}>Have you used Societyer before?</p>
            <button type="button" className="btn btn--accent" onClick={() => { setPreviousUse("new"); setRestoring(false); setStep(1); }}>This is my first workspace</button>
            <button type="button" className="btn" aria-pressed={previousUse === "returning"} onClick={() => setPreviousUse("returning")}>I've used Societyer before</button>
            {previousUse === "returning" && <><p>Do you have a Societyer backup to bring back?</p><button type="button" className="btn" aria-pressed={restoring} onClick={() => setRestoring(true)}>Restore a backup</button><button type="button" className="btn" onClick={() => { setRestoring(false); setStep(1); }}>Continue without a backup</button></>}
          </>}
          {step === 1 && <>
            <p style={{ margin: 0 }}>Is the organization already incorporated?</p>
            <button type="button" className="btn" aria-pressed={stage === "existing"} onClick={() => chooseStage("existing")}>Yes, set up an existing organization</button>
            <button type="button" className="btn" aria-pressed={stage === "preparing"} onClick={() => chooseStage("preparing")}>No, prepare a new incorporation</button>
            <Field label={stage === "existing" ? "Act the organization was formed under" : "Act you plan to incorporate under"} hint="Choose the actual governing Act. Federal incorporation may also require registration in provinces where the organization operates.">
              <Select value={pathwayKey} onChange={choosePathway} options={[...PATHWAY_REGISTRY.map((pathway) => ({ value: pathway.key, label: `${pathway.setup.label} — ${optionLabel("actsFormedUnder", pathway.setup.actFormedUnder)}`, hint: pathway.setup.hint })), ...(stage === "existing" ? [{ value: "custom_existing", label: "Another existing organization — enter legal details", hint: "Reviewed incorporation guidance may be unavailable." }] : [])]} />
            </Field>
            {pathwayKey === "custom_existing" && <><Field label="Legal jurisdiction"><Select value={form.jurisdictionCode} onChange={(value) => set("jurisdictionCode", value)} options={optionChoices("entityJurisdictions")} /></Field><Field label="Entity type"><Select value={form.entityType} onChange={(value) => set("entityType", value)} options={optionChoices("entityTypes")} /></Field><Field label="Act formed under"><Select value={form.actFormedUnder} onChange={(value) => set("actFormedUnder", value)} options={optionChoices("actsFormedUnder")} /></Field></>}
            {pathwayKey && <div className="notice notice--info">{route.message}</div>}
            {stage === "existing" && <p className="muted">Your supplied details remain unverified until the official incorporation certificate is uploaded and reviewed in the workspace.</p>}
          </>}
          {step === 2 && <>
            <Field label={stage === "preparing" ? "Proposed name / working name" : "Recorded legal name"}><input required maxLength={300} className="input" value={form.name} onChange={(event) => set("name", event.target.value)} /></Field>
            {corporate && stage === "preparing" && <label className="field"><input type="checkbox" checked={form.numbered} onChange={(event) => set("numbered", event.target.checked)} /> Use a registry-assigned numbered company name</label>}
            {stage === "existing" && <div className="society-field-grid"><Field label="Incorporation #" hint="Leave blank if you need to look it up."><input className="input" value={form.incorporationNumber} onChange={(event) => set("incorporationNumber", event.target.value)} /></Field><Field label="Incorporation date"><input className="input" type="date" value={form.incorporationDate} onChange={(event) => set("incorporationDate", event.target.value)} /></Field></div>}
            <div className="society-field-grid"><Field label="Official email"><input className="input" type="email" value={form.officialEmail} onChange={(event) => set("officialEmail", event.target.value)} /></Field><Field label="Fiscal year end" hint="MM-DD; leave blank to decide later."><input className="input" placeholder="03-31" value={form.fiscalYearEnd} onChange={(event) => set("fiscalYearEnd", event.target.value)} /></Field></div>
            <fieldset style={{ minWidth: 0, margin: 0, border: "1px solid var(--border)", borderRadius: 8 }}><legend>Registered office address</legend><StructuredAddressTextFields value={form.registeredOfficeAddress} onChange={(value) => set("registeredOfficeAddress", value)} /></fieldset>
            <label><input type="checkbox" checked={sameMailing} onChange={(event) => setSameMailing(event.target.checked)} /> Mailing address is the same as the registered office</label>
            {!sameMailing && <fieldset style={{ minWidth: 0, margin: 0, border: "1px solid var(--border)", borderRadius: 8 }}><legend>Mailing address</legend><StructuredAddressTextFields value={form.mailingAddress} onChange={(value) => set("mailingAddress", value)} /></fieldset>}
            <p className="muted">Missing addresses or contact details remain follow-up tasks. No registry submission is made during setup.</p>
          </>}
          {step === 3 && <>
            <EntitySetupFields form={form} set={set} showFormationStatus={false} />
            <Field label={corporate ? "Shareholder / share class structure" : "Member / membership class structure"} hint="Use your articles or bylaws for an existing organization. These answers do not issue shares or enroll members."><Select value={answers.governanceStructure} onChange={(value) => setAnswers((current) => ({ ...current, governanceStructure: value }))} options={[{ value: "needs_review", label: "Not sure — review the governing documents" }, { value: "single_class", label: corporate ? "One share class" : "One membership class" }, { value: "multiple_classes", label: corporate ? "Multiple share classes" : "Multiple membership classes" }]} /></Field>
            <Field label={corporate ? "Share class names and rights to review" : "Membership types and voting rights to review"}><textarea className="input" rows={3} maxLength={2000} value={answers.classDetails} onChange={(event) => setAnswers((current) => ({ ...current, classDetails: event.target.value }))} placeholder={corporate ? "For example: Class A voting common shares; confirm the authorized rights in the articles." : "For example: voting members and non-voting associate members; confirm eligibility in the bylaws."} /></Field>
            <Field label="Governance documents"><Select value={answers.governanceDocuments} onChange={(value) => setAnswers((current) => ({ ...current, governanceDocuments: value }))} options={[{ value: "needs_review", label: "Need to locate or review them" }, { value: "available", label: "Have existing signed documents to upload" }, { value: "need_to_prepare", label: "Need to prepare drafts" }]} /></Field>
            <Field label={corporate ? "Directors, officers and shareholders" : "Directors, officers and members"}><Select value={answers.peopleReadiness} onChange={(value) => setAnswers((current) => ({ ...current, peopleReadiness: value }))} options={[{ value: "add_later", label: "Gather details and add people later" }, { value: "ready_to_add", label: "Have details ready for the people registers" }]} /></Field>
            <Field label="Purposes / business activities"><textarea className="input" rows={3} value={form.purposes} onChange={(event) => set("purposes", event.target.value)} /></Field>
            <Field label="Where will the organization operate?" hint="Provinces or countries; registration requirements are checked separately."><textarea className="input" rows={2} maxLength={2000} value={answers.operatingRegions} onChange={(event) => setAnswers((current) => ({ ...current, operatingRegions: event.target.value }))} /></Field>
            <div className="society-field-grid"><Field label="Privacy / records contact name"><input className="input" value={form.privacyOfficerName} onChange={(event) => set("privacyOfficerName", event.target.value)} /></Field><Field label="Privacy / records contact email"><input className="input" type="email" value={form.privacyOfficerEmail} onChange={(event) => set("privacyOfficerEmail", event.target.value)} /></Field></div>
          </>}
          {step === 4 && <>
            <dl><dt>Organization</dt><dd>{form.name}</dd><dt>Setup</dt><dd>{stage === "preparing" ? "Preparing incorporation" : "Existing organization — evidence pending"}</dd><dt>Governing Act</dt><dd>{optionLabel("actsFormedUnder", form.actFormedUnder)}</dd><dt>Registered office</dt><dd style={{ whiteSpace: "pre-line" }}>{form.registeredOfficeAddress || "To add during onboarding"}</dd><dt>Governance structure</dt><dd>{answers.governanceStructure.replaceAll("_", " ")}{answers.classDetails ? `: ${answers.classDetails}` : ""}</dd></dl>
            <p>We will create an organization profile and onboarding workflow, keep your answers in its checklist, and take you to the next steps for documents, people and access.</p>
            <p className="muted">Creating this workspace does not incorporate an organization, verify a certificate, issue shares, file documents, or grant access to the people you plan to add.</p>
            <button type="submit" className="btn btn--accent" disabled={saving}>{saving ? "Creating..." : "Create workspace"}</button>
          </>}
          {step > 0 && step < 4 && <button type="submit" className="btn btn--accent" disabled={saving}>Continue</button>}
          </fieldset>
        </form>
      </section>
      {step === 0 && restoring && (canRestore ? restoreCard : <section className="card society-create__card"><div className="card__body"><h2>Restore on this device</h2><p>Societyer backups restore into local storage. Hosted workspaces require a separate import with workspace mapping and permission checks.</p><Link className="btn btn--accent" to="/setup?restore=1">Open local backup setup</Link><p className="muted">Your hosted workspace will not be replaced by a local backup.</p></div></section>)}
      {step === 4 && stage === "preparing" && <IncorporationPreparation organization={form} />}
    </main>
    <aside className="society-create__side"><section className="card society-create__card"><div className="card__head"><h2 className="card__title">What happens next?</h2></div><div className="card__body"><p>{stage === "preparing" ? "Your preparation pathway includes the information, draft documents and official filing channels to review. Submit through the official registry and retain its certificate." : "Complete the profile, upload existing governing documents and official certificates, then populate the people registers and workspace access."}</p><div className="society-create__next-list"><span>Registered locations</span><span>Governance documents</span><span>People and access</span><span>Compliance and optional setup</span></div></div></section></aside>
  </div></div>;
}
