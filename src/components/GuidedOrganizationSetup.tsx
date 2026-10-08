import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, ChevronLeft } from "lucide-react";
import { Field } from "./ui";
import { Select } from "./Select";
import { StructuredAddressTextFields } from "./StructuredAddressFields";
import { PATHWAY_REGISTRY, getPathway, resolvePathway } from "../../shared/pathways/registry";
import { isCorporation, validateWorkspaceLegalIdentity } from "../../shared/organizationDomain";
import { validateEntitySetup } from "../../shared/entitySetup";
import { readOnboardingAnswersJson, validateInitialOrganizationProfile, type OrganizationOnboardingAnswers } from "../../shared/onboarding";
import { optionChoices, optionLabel } from "../lib/orgHubOptions";

/**
 * Three decisions before a usable workspace: what is being set up, its name,
 * and a review. Everything else keeps a valid default (tax and charity status
 * "unknown", governance "needs review", people "add later") and becomes a
 * follow-up on the organization's checklist; addresses and governance notes
 * can still be added now from optional sections.
 */
const STEPS = ["What are you setting up?", "Name and basics", "Review and create"];
const LAST_STEP = STEPS.length - 1;

export function GuidedOrganizationSetup({ onCreate, saving, restoreCard, restoreRequested, canRestore }: {
  onCreate: (values: Record<string, any>) => Promise<void>;
  saving: boolean;
  restoreCard: ReactNode;
  restoreRequested: boolean;
  canRestore: boolean;
}) {
  const [step, setStep] = useState(0);
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
  const mounted = useRef(false);
  useEffect(() => {
    // Move focus to the new step's heading on navigation, not on first load.
    if (mounted.current) heading.current?.focus();
    mounted.current = true;
  }, [step, restoring]);
  const corporate = isCorporation(form);
  const route = resolvePathway(form);
  const set = (key: string, value: any) => setForm((current) => ({ ...current, [key]: value }));
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
    const setupAnswers = { version: 1, previousUse: restoreRequested ? "returning" : "new", organizationStage: stage, pathwayKey, ...answers } as OrganizationOnboardingAnswers;
    // The registry setup label/hint are presentation metadata, not database fields.
    const { label: _label, hint: _hint, ...values } = form;
    return { ...values, mailingAddress: sameMailing ? form.registeredOfficeAddress : form.mailingAddress, onboardingAnswersJson: JSON.stringify(setupAnswers) };
  };
  const next = () => {
    setError(null);
    try {
      if (step === 0 && !stage) throw new Error("Choose whether the organization already exists or is preparing incorporation.");
      if (step === 0 && !pathwayKey) throw new Error("Choose the actual or planned governing Act.");
      if (step === 0 && pathwayKey === "custom_existing" && (!form.jurisdictionCode || !form.entityType || !form.actFormedUnder)) throw new Error("Enter the existing organization's jurisdiction, entity type and governing Act.");
      if (step === 0) validateWorkspaceLegalIdentity(form);
      if (step >= 1) validateInitialOrganizationProfile(form);
      setStep((current) => Math.min(LAST_STEP, current + 1));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the setup answers."); }
  };
  const back = () => { setError(null); setStep((current) => Math.max(0, current - 1)); };
  const create = async () => {
    setError(null);
    try { const values = buildValues(); validateInitialOrganizationProfile(values); validateEntitySetup(values); readOnboardingAnswersJson(values.onboardingAnswersJson, values); await onCreate(values); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the workspace."); }
  };

  const progress = restoring ? null : ((step + 1) / STEPS.length) * 100;

  return <div className="society-create-shell"><div className="society-create">
    <aside className="society-create__intro">
      <div className="society-create__brand"><div className="society-create__logo"><Building2 size={18} /></div><span>Societyer setup</span></div>
      <div className="society-create__copy"><h1>New organization workspace</h1><p>Answer three questions to create the workspace. Everything else becomes a checklist you can work through afterwards.</p></div>
      {!restoring && (
        <ol className="society-create__steps" aria-label="Setup progress">
          {STEPS.map((stepTitle, index) => <li className="society-create__step" key={stepTitle} aria-current={step === index ? "step" : undefined}><span className="society-create__step-index">{index < step ? <CheckCircle2 size={14} /> : index + 1}</span><span>{stepTitle}</span></li>)}
        </ol>
      )}
    </aside>
    <main className="society-create__main">
      <div className="society-create__topbar">
        {!restoring && step > 0
          ? <button type="button" className="society-create__back" disabled={saving} onClick={back}><ChevronLeft size={16} /> Back</button>
          : <span />}
        <Link className="society-create__cancel" to="/app/society">Cancel</Link>
      </div>
      {progress !== null && (
        <div className="society-create__progress">
          <span>Step {step + 1} of {STEPS.length}</span>
          <div className="society-create__progress-bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      {restoring ? (
        <>
          <h2 ref={heading} tabIndex={-1} className="sr-only">Restore your records</h2>
          {canRestore ? restoreCard : (
            <section className="card society-create__card"><div className="card__body">
              <h2 className="card__title">Restore on this device</h2>
              <p className="muted">Backups restore into a device-local workspace. In a hosted or demo workspace, restore from Settings › Runtime on the device that should hold the records.</p>
            </div></section>
          )}
          <button type="button" className="society-create__link" onClick={() => setRestoring(false)}>Start a new organization instead</button>
        </>
      ) : (
        <section className="card society-create__card">
          <div className="card__head"><h2 ref={heading} tabIndex={-1} className="card__title">{STEPS[step]}</h2></div>
          <form id="guided-setup-form" className="card__body society-create__form" onSubmit={(event) => { event.preventDefault(); if (step === LAST_STEP) void create(); else next(); }}>
            <fieldset disabled={saving} aria-label="Setup answers" className="society-create__fields">
            {error && <div className="notice notice--danger" role="alert">{error}</div>}

            {step === 0 && <>
              <div className="society-create__question">
                <p>Is the organization already incorporated?</p>
                <div className="society-create__choices">
                  <button type="button" className="society-create__choice" aria-pressed={stage === "existing"} onClick={() => chooseStage("existing")}>Yes, set up an existing organization</button>
                  <button type="button" className="society-create__choice" aria-pressed={stage === "preparing"} onClick={() => chooseStage("preparing")}>No, prepare a new incorporation</button>
                </div>
              </div>
              <Field label={stage === "existing" ? "Act the organization was formed under" : "Act you plan to incorporate under"}>
                <Select value={pathwayKey} onChange={choosePathway} options={[...PATHWAY_REGISTRY.map((pathway) => ({ value: pathway.key, label: `${pathway.setup.label} — ${optionLabel("actsFormedUnder", pathway.setup.actFormedUnder)}`, hint: pathway.setup.hint })), ...(stage === "existing" ? [{ value: "custom_existing", label: "Another existing organization — enter legal details", hint: "Reviewed incorporation guidance may be unavailable." }] : [])]} />
              </Field>
              {pathwayKey === "custom_existing" && <div className="society-field-grid"><Field label="Legal jurisdiction"><Select value={form.jurisdictionCode} onChange={(value) => set("jurisdictionCode", value)} options={optionChoices("entityJurisdictions")} /></Field><Field label="Entity type"><Select value={form.entityType} onChange={(value) => set("entityType", value)} options={optionChoices("entityTypes")} /></Field><Field label="Act formed under"><Select value={form.actFormedUnder} onChange={(value) => set("actFormedUnder", value)} options={optionChoices("actsFormedUnder")} /></Field></div>}
              {pathwayKey && <div className="notice notice--info">{route.message}</div>}
              {canRestore && <button type="button" className="society-create__link" onClick={() => setRestoring(true)}>Have a Societyer backup? Restore it instead</button>}
            </>}

            {step === 1 && <>
              <Field label={stage === "preparing" ? "Proposed name / working name" : "Recorded legal name"}><input required maxLength={300} className="input" value={form.name} onChange={(event) => set("name", event.target.value)} autoComplete="organization" /></Field>
              {corporate && stage === "preparing" && <label className="checkbox"><input type="checkbox" checked={form.numbered} onChange={(event) => set("numbered", event.target.checked)} /> Use a registry-assigned numbered company name</label>}
              {stage === "existing" && <div className="society-field-grid"><Field label="Incorporation #" hint="Optional"><input className="input" value={form.incorporationNumber} onChange={(event) => set("incorporationNumber", event.target.value)} /></Field><Field label="Incorporation date"><input className="input" type="date" value={form.incorporationDate} onChange={(event) => set("incorporationDate", event.target.value)} /></Field></div>}
              <div className="society-field-grid"><Field label="Official email"><input className="input" type="email" value={form.officialEmail} onChange={(event) => set("officialEmail", event.target.value)} /></Field><Field label="Fiscal year end" hint="MM-DD, optional"><input className="input" placeholder="03-31" value={form.fiscalYearEnd} onChange={(event) => set("fiscalYearEnd", event.target.value)} /></Field></div>
              <OptionalAddresses form={form} set={set} sameMailing={sameMailing} setSameMailing={setSameMailing} />
            </>}

            {step === LAST_STEP && <>
              <ReviewSummary form={form} stage={stage} goTo={setStep} />
              <GovernanceNotes corporate={corporate} answers={answers} setAnswers={setAnswers} form={form} set={set} />
              <p className="muted society-create__fineprint">Creating the workspace doesn't file anything with a registry or verify incorporation.</p>
            </>}
            </fieldset>
          </form>
        </section>
      )}
      {!restoring && (
        <div className="society-create__actions">
          <button type="submit" form="guided-setup-form" className="btn btn--accent" disabled={saving}>
            {step === LAST_STEP ? (saving ? "Creating…" : "Create workspace") : "Continue"}
          </button>
        </div>
      )}
    </main>
  </div></div>;
}

type GovernanceAnswers = { governanceStructure: string; classDetails: string; governanceDocuments: string; peopleReadiness: string; operatingRegions: string };

/** Optional governance answers. Only collectable here (nothing edits the
 * onboarding answers afterwards), so they stay available behind a toggle. */
function GovernanceNotes({ corporate, answers, setAnswers, form, set }: {
  corporate: boolean;
  answers: GovernanceAnswers;
  setAnswers: (update: (current: GovernanceAnswers) => GovernanceAnswers) => void;
  form: Record<string, any>;
  set: (key: string, value: any) => void;
}) {
  return (
    <details className="society-create__optional">
      <summary>Add governance notes now <span>Optional</span></summary>
      <div className="society-create__optional-body">
        <Field label={corporate ? "Shareholder / share class structure" : "Member / membership class structure"}><Select value={answers.governanceStructure} onChange={(value) => setAnswers((current) => ({ ...current, governanceStructure: value }))} options={[{ value: "needs_review", label: "Not sure — review the governing documents" }, { value: "single_class", label: corporate ? "One share class" : "One membership class" }, { value: "multiple_classes", label: corporate ? "Multiple share classes" : "Multiple membership classes" }]} /></Field>
        <Field label={corporate ? "Share class names and rights to review" : "Membership types and voting rights to review"}><textarea className="input" rows={3} maxLength={2000} value={answers.classDetails} onChange={(event) => setAnswers((current) => ({ ...current, classDetails: event.target.value }))} placeholder={corporate ? "e.g. Class A voting common shares" : "e.g. Voting members and non-voting associates"} /></Field>
        <Field label="Governance documents"><Select value={answers.governanceDocuments} onChange={(value) => setAnswers((current) => ({ ...current, governanceDocuments: value }))} options={[{ value: "needs_review", label: "Need to locate or review them" }, { value: "available", label: "Have existing signed documents to upload" }, { value: "need_to_prepare", label: "Need to prepare drafts" }]} /></Field>
        <Field label={corporate ? "Directors, officers and shareholders" : "Directors, officers and members"}><Select value={answers.peopleReadiness} onChange={(value) => setAnswers((current) => ({ ...current, peopleReadiness: value }))} options={[{ value: "add_later", label: "Gather details and add people later" }, { value: "ready_to_add", label: "Have details ready for the people registers" }]} /></Field>
        <Field label="Purposes / business activities"><textarea className="input" rows={3} value={form.purposes} onChange={(event) => set("purposes", event.target.value)} /></Field>
        <Field label="Where will the organization operate?" hint="Provinces or countries"><textarea className="input" rows={2} maxLength={2000} value={answers.operatingRegions} onChange={(event) => setAnswers((current) => ({ ...current, operatingRegions: event.target.value }))} /></Field>
        <div className="society-field-grid"><Field label="Privacy / records contact name"><input className="input" value={form.privacyOfficerName} onChange={(event) => set("privacyOfficerName", event.target.value)} /></Field><Field label="Privacy / records contact email"><input className="input" type="email" value={form.privacyOfficerEmail} onChange={(event) => set("privacyOfficerEmail", event.target.value)} /></Field></div>
      </div>
    </details>
  );
}

function ReviewSummary({ form, stage, goTo }: { form: Record<string, any>; stage: "preparing" | "existing" | null; goTo: (step: number) => void }) {
  return (
    <dl className="society-create__summary">
      <div><dt>Organization</dt><dd>{form.name}</dd><button type="button" className="society-create__edit" onClick={() => goTo(1)}>Edit</button></div>
      <div><dt>Setup</dt><dd>{stage === "preparing" ? "Preparing incorporation" : "Existing organization, evidence pending"}</dd><button type="button" className="society-create__edit" onClick={() => goTo(0)}>Edit</button></div>
      <div><dt>Governing Act</dt><dd>{optionLabel("actsFormedUnder", form.actFormedUnder)}</dd><button type="button" className="society-create__edit" onClick={() => goTo(0)}>Edit</button></div>
      <div><dt>Registered office</dt><dd style={{ whiteSpace: "pre-line" }}>{form.registeredOfficeAddress || "Add later from the checklist"}</dd><button type="button" className="society-create__edit" onClick={() => goTo(1)}>Edit</button></div>
    </dl>
  );
}

function OptionalAddresses({ form, set, sameMailing, setSameMailing }: { form: Record<string, any>; set: (key: string, value: any) => void; sameMailing: boolean; setSameMailing: (value: boolean) => void }) {
  return (
    <details className="society-create__optional">
      <summary>Add the registered office and mailing address now <span>Optional</span></summary>
      <div className="society-create__optional-body">
        <fieldset className="society-create__address"><legend>Registered office address</legend><StructuredAddressTextFields value={form.registeredOfficeAddress} onChange={(value) => set("registeredOfficeAddress", value)} /></fieldset>
        <label className="checkbox"><input type="checkbox" checked={sameMailing} onChange={(event) => setSameMailing(event.target.checked)} /> Mailing address is the same as the registered office</label>
        {!sameMailing && <fieldset className="society-create__address"><legend>Mailing address</legend><StructuredAddressTextFields value={form.mailingAddress} onChange={(value) => set("mailingAddress", value)} /></fieldset>}
      </div>
    </details>
  );
}
