import { useEffect, useRef, useState, type ReactNode } from "react";
import { MonthDayPicker } from "./MonthDayPicker";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, ChevronLeft } from "lucide-react";
import { Badge, Field } from "./ui";
import { Select } from "./Select";
import { StructuredAddressTextFields } from "./StructuredAddressFields";
import { resolvePathway } from "../../shared/pathways/registry";
import { isCorporation, validateWorkspaceLegalIdentity } from "../../shared/organizationDomain";
import { validateEntitySetup } from "../../shared/entitySetup";
import { readOnboardingAnswersJson, validateInitialOrganizationProfile, type OrganizationOnboardingAnswers } from "../../shared/onboarding";
import {
  ANOTHER_ACT_VALUE, ENTITY_KIND_LABELS, INCORPORATION_JURISDICTIONS, OTHER_ACT_NAME_MAX, SUPPORT_LABELS,
  incorporationActById, incorporationActSetup, incorporationActSummary, incorporationActTitle, incorporationActsFor, incorporationJurisdiction,
  type IncorporationAct, type IncorporationEntityKind, type IncorporationJurisdictionId,
} from "../../shared/incorporationActs";

type Stage = "preparing" | "existing";
type Level = "federal" | "provincial";

/**
 * One question per screen: what is being set up, where it is (or will be)
 * incorporated, the governing Act, its name, then a review. Everything else
 * keeps a valid default (tax and charity status "unknown", governance "needs
 * review", people "add later") and becomes a follow-up on the organization's
 * checklist; addresses and governance notes can still be added now from
 * optional sections.
 */
const STEPS = ["Starting point", "Jurisdiction", "Governing Act", "Name and basics", "Review and create"];
const STEP = { start: 0, jurisdiction: 1, act: 2, basics: 3, review: 4 } as const;
const LAST_STEP = STEPS.length - 1;

function stepHeading(step: number, stage: Stage | null) {
  const planned = stage === "preparing";
  if (step === STEP.start) return "What are you setting up?";
  if (step === STEP.jurisdiction) return planned ? "Where will the organization be incorporated?" : "Where is the organization incorporated?";
  if (step === STEP.act) return planned ? "Which Act will it be incorporated under?" : "Which Act is it incorporated under?";
  return STEPS[step];
}

const PROVINCE_OPTIONS = INCORPORATION_JURISDICTIONS.filter((place) => place.level !== "federal").map((place) => ({
  value: place.id,
  label: place.name,
  hint: place.level === "territorial" ? "Territory" : undefined,
}));

const BLANK_IDENTITY = { jurisdictionCode: "", entityType: "", actFormedUnder: "", legalSubtype: "other" };

export function GuidedOrganizationSetup({ onCreate, saving, restoreCard, restoreRequested, canRestore }: {
  onCreate: (values: Record<string, any>) => Promise<void>;
  saving: boolean;
  restoreCard: ReactNode;
  restoreRequested: boolean;
  canRestore: boolean;
}) {
  const [step, setStep] = useState<number>(STEP.start);
  const [restoring, setRestoring] = useState(restoreRequested);
  const [stage, setStage] = useState<Stage | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [provinceId, setProvinceId] = useState<IncorporationJurisdictionId | "">("");
  const [actId, setActId] = useState("");
  const [entityKind, setEntityKind] = useState<IncorporationEntityKind | "">("");
  const [otherActName, setOtherActName] = useState("");
  const [sameMailing, setSameMailing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState({ governanceStructure: "needs_review", classDetails: "", governanceDocuments: "needs_review", peopleReadiness: "add_later", operatingRegions: "" });
  const [form, setForm] = useState<Record<string, any>>({
    name: "", incorporationNumber: "", incorporationDate: "", fiscalYearEnd: "", officialEmail: "",
    ...BLANK_IDENTITY, isMemberFunded: false, isCharity: false,
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

  const jurisdictionId: IncorporationJurisdictionId | "" = level === "federal" ? "CA" : level === "provincial" ? provinceId : "";
  const jurisdiction = incorporationJurisdiction(jurisdictionId);
  const acts = jurisdictionId ? incorporationActsFor(jurisdictionId) : [];
  const act = acts.find((candidate) => candidate.id === actId);
  const another = act?.actFormedUnder === ANOTHER_ACT_VALUE;
  const corporate = isCorporation(form);
  const route = resolvePathway(form);
  const set = (key: string, value: any) => setForm((current) => ({ ...current, [key]: value }));

  const chooseStage = (value: Stage) => {
    setStage(value);
    setForm((current) => ({ ...current, formationStatus: value === "preparing" ? "preparing" : "unverified_existing", organizationStatus: value === "preparing" ? "pre_incorporation" : "active", ...(value === "preparing" ? { incorporationNumber: "", incorporationDate: "" } : {}) }));
  };
  /** Record the Act's setup values; the entity kind is taken from the Act unless it allows several. */
  const applyAct = (next: IncorporationAct | undefined, kind: IncorporationEntityKind | "") => {
    if (!next || (next.entityKinds.length > 1 && !kind)) {
      setForm((current) => ({ ...current, ...BLANK_IDENTITY }));
      return;
    }
    const { pathwayKey: _pathwayKey, ...setup } = incorporationActSetup(next, kind || undefined);
    setForm((current) => ({ ...current, ...setup }));
  };
  const clearAct = () => { setActId(""); setEntityKind(""); setOtherActName(""); applyAct(undefined, ""); };
  const chooseJurisdiction = (nextLevel: Level, nextProvince: IncorporationJurisdictionId | "") => {
    setLevel(nextLevel);
    setProvinceId(nextProvince);
    const nextJurisdiction = nextLevel === "federal" ? "CA" : nextProvince;
    // An Act belongs to one jurisdiction; a new place starts the Act question over.
    if (act && act.jurisdiction !== nextJurisdiction) clearAct();
  };
  const chooseAct = (id: string) => {
    const next = incorporationActById(id);
    setActId(id);
    const kind = next && next.entityKinds.length === 1 ? next.entityKinds[0] : "";
    setEntityKind(kind);
    if (next?.actFormedUnder !== ANOTHER_ACT_VALUE) setOtherActName("");
    applyAct(next, kind);
    setAnswers((current) => ({ ...current, governanceStructure: "needs_review", classDetails: "" }));
  };
  const chooseEntityKind = (kind: IncorporationEntityKind) => {
    setEntityKind(kind);
    applyAct(act, kind);
  };

  const buildValues = () => {
    const setup = act ? incorporationActSetup(act, entityKind || undefined) : undefined;
    const setupAnswers = {
      version: 1, previousUse: restoreRequested ? "returning" : "new", organizationStage: stage,
      pathwayKey: setup?.pathwayKey, incorporationActId: act?.id, ...(another ? { otherActName: otherActName.trim() } : {}), ...answers,
    } as OrganizationOnboardingAnswers;
    return { ...form, mailingAddress: sameMailing ? form.registeredOfficeAddress : form.mailingAddress, onboardingAnswersJson: JSON.stringify(setupAnswers) };
  };
  const next = () => {
    setError(null);
    try {
      if (step === STEP.start && !stage) throw new Error("Choose whether the organization already exists or is preparing incorporation.");
      if (step === STEP.jurisdiction && !level) throw new Error("Choose federal or provincial incorporation.");
      if (step === STEP.jurisdiction && level === "provincial" && !provinceId) throw new Error("Choose the province or territory.");
      if (step === STEP.act) {
        if (!act) throw new Error(stage === "preparing" ? "Choose the Act you plan to incorporate under." : "Choose the Act the organization was formed under.");
        if (another && !otherActName.trim()) throw new Error("Enter the name of the Act.");
        if (act.entityKinds.length > 1 && !entityKind) throw new Error("Choose what kind of organization it is.");
        validateWorkspaceLegalIdentity(form);
      }
      if (step >= STEP.basics) validateInitialOrganizationProfile(form);
      setStep((current) => Math.min(LAST_STEP, current + 1));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the setup answers."); }
  };
  const goTo = (target: number) => { setError(null); setStep(target); };
  const back = () => goTo(Math.max(0, step - 1));
  const create = async () => {
    setError(null);
    try { const values = buildValues(); validateInitialOrganizationProfile(values); validateEntitySetup(values); readOnboardingAnswersJson(values.onboardingAnswersJson, values); await onCreate(values); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the workspace."); }
  };

  const progress = restoring ? null : ((step + 1) / STEPS.length) * 100;

  return <div className="society-create-shell"><div className="society-create">
    <aside className="society-create__intro">
      <div className="society-create__brand"><div className="society-create__logo"><Building2 size={18} /></div><span>Societyer setup</span></div>
      <div className="society-create__copy">
        <div className="society-create__title-row">
          <h1>New organization workspace</h1>
          {/* Stacked (phone) layout: Cancel sits on the title row instead of a row of its own. */}
          <Link className="society-create__cancel society-create__cancel--stacked" to="/app/society">Cancel</Link>
        </div>
        <p>Answer a few questions to create the workspace. Everything else becomes a checklist you can work through afterwards.</p>
      </div>
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
        <Link className="society-create__cancel society-create__cancel--side" to="/app/society">Cancel</Link>
      </div>
      {progress !== null && (
        <div className="society-create__progress">
          {/* The step title is the card heading; the bar alone shows progress. */}
          <div
            className="society-create__progress-bar"
            role="progressbar"
            aria-label={`Step ${step + 1} of ${STEPS.length}`}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={step + 1}
          ><span style={{ width: `${progress}%` }} /></div>
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
          <div className="card__head"><h2 ref={heading} tabIndex={-1} className="card__title">{stepHeading(step, stage)}</h2></div>
          <form id="guided-setup-form" className="card__body society-create__form" onSubmit={(event) => { event.preventDefault(); if (step === LAST_STEP) void create(); else next(); }}>
            <fieldset disabled={saving} aria-label="Setup answers" className="society-create__fields">
            {error && <div className="notice notice--danger" role="alert">{error}</div>}

            {step === STEP.start && <>
              <div className="society-create__question">
                <p>Is the organization already incorporated?</p>
                <div className="society-create__choices">
                  <button type="button" className="society-create__choice" aria-pressed={stage === "existing"} onClick={() => chooseStage("existing")}>{stage === "existing" && <CheckCircle2 size={16} aria-hidden="true" />}Yes, set up an existing organization</button>
                  <button type="button" className="society-create__choice" aria-pressed={stage === "preparing"} onClick={() => chooseStage("preparing")}>{stage === "preparing" && <CheckCircle2 size={16} aria-hidden="true" />}No, prepare a new incorporation</button>
                </div>
              </div>
              {canRestore && <button type="button" className="society-create__link" onClick={() => setRestoring(true)}>Have a Societyer backup? Restore it instead</button>}
            </>}

            {step === STEP.jurisdiction && <>
              <div className="society-create__choices">
                <ChoiceButton pressed={level === "federal"} onClick={() => chooseJurisdiction("federal", "")} title="Federally (Canada-wide)" hint="Incorporated with Corporations Canada." />
                <ChoiceButton pressed={level === "provincial"} onClick={() => chooseJurisdiction("provincial", provinceId)} title="Provincially or territorially" hint="Incorporated with a provincial or territorial registry." />
              </div>
              {level === "provincial" && <Field label="Province or territory">
                <Select value={provinceId} onChange={(value) => chooseJurisdiction("provincial", value as IncorporationJurisdictionId)} options={PROVINCE_OPTIONS} placeholder="Choose a province or territory" searchable />
              </Field>}
            </>}

            {step === STEP.act && jurisdiction && <>
              <p className="society-create__context">
                <span>{jurisdiction.level === "federal" ? "Federal (Canada-wide)" : jurisdiction.name}</span>
                <button type="button" className="society-create__edit" onClick={() => goTo(STEP.jurisdiction)} aria-label="Change jurisdiction">Change</button>
              </p>
              <fieldset className="society-create__acts">
                <legend className="sr-only">Governing Act</legend>
                {acts.map((candidate) => <ActChoice key={candidate.id} act={candidate} checked={candidate.id === actId} onChoose={chooseAct} />)}
              </fieldset>
              {another && <Field label="Name of the Act" hint="As written on the certificate or articles.">
                <input className="input" required maxLength={OTHER_ACT_NAME_MAX} value={otherActName} onChange={(event) => setOtherActName(event.target.value)} />
              </Field>}
              {act && act.entityKinds.length > 1 && <fieldset className="society-create__acts society-create__acts--compact">
                <legend className="society-create__legend">What kind of organization is it?</legend>
                {act.entityKinds.map((kind) => (
                  <label key={kind} className="society-create__act" data-checked={entityKind === kind || undefined}>
                    <input type="radio" name="incorporation-entity-kind" value={kind} checked={entityKind === kind} onChange={() => chooseEntityKind(kind)} />
                    <span className="society-create__act-body">
                      <span className="society-create__act-name">{ENTITY_KIND_LABELS[kind].label}</span>
                      <span className="society-create__act-summary">{ENTITY_KIND_LABELS[kind].hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>}
              {act && <ActNotice act={act} stage={stage} preparationMessage={route.message} />}
            </>}

            {step === STEP.basics && <>
              <Field label={stage === "preparing" ? "Proposed name / working name" : "Recorded legal name"}><input required maxLength={300} className="input" value={form.name} onChange={(event) => set("name", event.target.value)} autoComplete="organization" /></Field>
              {corporate && stage === "preparing" && <label className="checkbox"><input type="checkbox" checked={form.numbered} onChange={(event) => set("numbered", event.target.checked)} /> Use a registry-assigned numbered company name</label>}
              {stage === "existing" && <div className="society-field-grid"><Field label="Incorporation #" hint="Optional"><input className="input" value={form.incorporationNumber} onChange={(event) => set("incorporationNumber", event.target.value)} /></Field><Field label="Incorporation date"><input className="input" type="date" value={form.incorporationDate} onChange={(event) => set("incorporationDate", event.target.value)} /></Field></div>}
              <div className="society-field-grid"><Field label="Official email"><input className="input" type="email" value={form.officialEmail} onChange={(event) => set("officialEmail", event.target.value)} /></Field><Field label="Fiscal year end" hint="Optional"><MonthDayPicker ariaLabel="Fiscal year end" value={form.fiscalYearEnd} onChange={(value) => set("fiscalYearEnd", value)} /></Field></div>
              <OptionalAddresses form={form} set={set} sameMailing={sameMailing} setSameMailing={setSameMailing} />
            </>}

            {step === LAST_STEP && <>
              <ReviewSummary form={form} stage={stage} act={act} entityKind={entityKind} otherActName={otherActName} goTo={goTo} />
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

function ChoiceButton({ pressed, onClick, title, hint }: { pressed: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button type="button" className="society-create__choice society-create__choice--described" aria-pressed={pressed} onClick={onClick}>
      {pressed && <CheckCircle2 size={16} aria-hidden="true" />}
      <span className="society-create__choice-text"><span>{title}</span><span className="society-create__choice-hint">{hint}</span></span>
    </button>
  );
}

/** A radio card: the Act's name, a one-line explanation and how much guidance Societyer has for it. */
function ActChoice({ act, checked, onChoose }: { act: IncorporationAct; checked: boolean; onChoose: (id: string) => void }) {
  const full = act.support === "full";
  return (
    <label className="society-create__act" data-checked={checked || undefined}>
      <input type="radio" name="incorporation-act" value={act.id} checked={checked} onChange={() => onChoose(act.id)} />
      <span className="society-create__act-body">
        <span className="society-create__act-name">{incorporationActTitle(act)}</span>
        <span className="society-create__act-summary">{act.summary}</span>
        <span className="society-create__act-badge"><Badge tone={full ? "success" : "neutral"}>{full ? SUPPORT_LABELS.full.badge : `${SUPPORT_LABELS.records_only.badge} — no reviewed guidance yet`}</Badge></span>
      </span>
    </label>
  );
}

function ActNotice({ act, stage, preparationMessage }: { act: IncorporationAct; stage: Stage | null; preparationMessage: string }) {
  if (act.support === "full") {
    return <div className="notice notice--info">{stage === "existing"
      ? "After setup, the checklist asks for the certificate of incorporation, governing documents and filing history so the records can be verified."
      : preparationMessage}</div>;
  }
  return (
    <div className="notice notice--warn" role="note">
      {stage === "preparing"
        ? "Societyer can't guide this incorporation yet. File it with the registry directly, then record the certificate here. The workspace still keeps your records, documents, people and tasks."
        : "Societyer doesn't have reviewed guidance for this Act yet. The workspace keeps your records, documents, people and tasks, but it won't check the Act's rules or deadlines. Confirm those with the registry or an adviser."}
    </div>
  );
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

function ReviewSummary({ form, stage, act, entityKind, otherActName, goTo }: {
  form: Record<string, any>;
  stage: Stage | null;
  act?: IncorporationAct;
  entityKind: IncorporationEntityKind | "";
  otherActName: string;
  goTo: (step: number) => void;
}) {
  const kind = entityKind || act?.entityKinds[0];
  return (
    <dl className="society-create__summary">
      <div><dt>Organization</dt><dd>{form.name}</dd><button type="button" className="society-create__edit" aria-label="Edit organization name" onClick={() => goTo(STEP.basics)}>Edit</button></div>
      <div><dt>Setup</dt><dd>{stage === "preparing" ? "Preparing incorporation" : "Existing organization, evidence pending"}</dd><button type="button" className="society-create__edit" aria-label="Edit setup" onClick={() => goTo(STEP.start)}>Edit</button></div>
      <div>
        <dt>Governing Act</dt>
        <dd>
          {act ? incorporationActSummary(act, otherActName) : "Not chosen"}
          {act && <span className="society-create__summary-note">
            {kind ? `${ENTITY_KIND_LABELS[kind].label} · ` : ""}{act.support === "full" ? SUPPORT_LABELS.full.badge : "Records only — no reviewed guidance yet"}
          </span>}
        </dd>
        <button type="button" className="society-create__edit" aria-label="Edit governing Act" onClick={() => goTo(STEP.act)}>Edit</button>
      </div>
      <div><dt>Registered office</dt><dd className="society-create__summary-address">{form.registeredOfficeAddress || "Add later from the checklist"}</dd><button type="button" className="society-create__edit" aria-label="Edit registered office" onClick={() => goTo(STEP.basics)}>Edit</button></div>
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
