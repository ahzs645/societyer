import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, LockedField } from "../../components/ui";
import { DatePicker } from "../../components/DatePicker";
import { MonthDayPicker } from "../../components/MonthDayPicker";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { OptionSelect } from "../../components/OptionSelect";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Controls";
import { GoverningActSelect, jurisdictionChoices } from "../../components/GoverningActSelect";
import { AnnualDateFields, FormationFields } from "../../components/EntitySetupFields";
import { JURISDICTION_OPTIONS } from "../../lib/jurisdictionGuideTracks";
import { organizationVocabulary } from "../../lib/organizationVocabulary";
import { workspaceGovernanceCopy } from "../../../shared/jurisdictionWorkspace";
import { isCorporation, isPreparingIncorporation } from "../../../shared/organizationDomain";
import type { IncorporationAct } from "../../../shared/incorporationActs";
import { NaicsSectorField } from "./NaicsSectorField";
import { hasText, setupOtherActName } from "./detailRows";
import type { OrganizationRecord, ProfileDocument, ProfileForm, SetProfileField } from "./types";

type LegalProfileProps = {
  society: OrganizationRecord;
  form: ProfileForm;
  set: SetProfileField;
  setGoverningAct: (value: string | undefined, act?: IncorporationAct) => void;
  canEdit: boolean;
  documents: readonly ProfileDocument[];
  /** The Articles card, shown after "Identity & formation". */
  articlesCard?: ReactNode;
  /** Opens "Record incorporation"; offered while the organization is preparing or filed. */
  onRecordIncorporation?: () => void;
};

/**
 * Legal profile: identity and formation (the one status, registry history and
 * classification), business and year, and board meetings.
 *
 * Locks follow the saved organization: before incorporation, or while a field
 * is still empty, editing has no legal consequence, so no unlock is asked for.
 */
export function LegalProfileTab({ society, form, set, setGoverningAct, canEdit, documents, articlesCard, onRecordIncorporation }: LegalProfileProps) {
  return (
    <div className="org-profile-panel" id="more-organization-details">
      <IdentityCard society={society} form={form} set={set} setGoverningAct={setGoverningAct} documents={documents} onRecordIncorporation={canEdit ? onRecordIncorporation : undefined} />
      {articlesCard}
      <div className="org-profile-grid">
        <BusinessYearCard society={society} form={form} set={set} />
        <div className="org-profile-stack">
          <NaicsSectorField
            key={form._id}
            value={form.naicsSector}
            detailedCode={form.naicsCode}
            onChange={(value) => set("naicsSector", value)}
            onCodeChange={(value) => set("naicsCode", value)}
            disabled={!canEdit}
          />
          <MeetingsCard form={form} set={set} />
        </div>
      </div>
    </div>
  );
}

function IdentityCard({ society, form, set, setGoverningAct, documents, onRecordIncorporation }: Omit<LegalProfileProps, "canEdit" | "articlesCard">) {
  const savedPreparing = isPreparingIncorporation(society);
  const lockWhenSet = (value: unknown) => !savedPreparing && hasText(value);
  const preparing = isPreparingIncorporation(form);
  const vocab = organizationVocabulary(form);
  const registryFields = (
    <div className="society-field-grid society-field-grid--mobile-pair society-field-grid--registry-dates">
      {savedPreparing ? (
        <>
          {/* Not assigned yet: these come from the certificate of incorporation. */}
          <Field label="Incorporation #" hint="From the certificate">
            <input className="input" disabled value="" placeholder="Not assigned yet" />
          </Field>
          <Field label="Incorporation date" hint="From the certificate">
            <input className="input" disabled value="" placeholder="Not incorporated yet" />
          </Field>
        </>
      ) : (
        <>
          <LockedField
            label="Incorporation #"
            requireUnlock={lockWhenSet(society.incorporationNumber)}
            reason="The incorporation or corporation number is assigned by the registry and generally stays stable for the life of the organization. Edit only to fix a data-entry error."
          >
            {(locked) => <input className="input" disabled={locked} value={form.incorporationNumber ?? ""} onChange={(e) => set("incorporationNumber", e.target.value)} />}
          </LockedField>
          <LockedField
            label="Incorporation date"
            requireUnlock={lockWhenSet(society.incorporationDate)}
            reason="The date of incorporation is a historical fact recorded by the registry. Edit only to fix a data-entry error."
          >
            {(locked) => <DatePicker disabled={locked} value={form.incorporationDate ?? ""} onChange={(v) => set("incorporationDate", v)} />}
          </LockedField>
        </>
      )}
    </div>
  );
  return (
    <section className="card" aria-labelledby="org-identity">
      <div className="card__head">
        <h2 className="card__title" id="org-identity">Identity &amp; formation</h2>
        {savedPreparing && onRecordIncorporation && (
          <button className="btn btn--sm btn--accent org-profile-card-link" type="button" onClick={onRecordIncorporation}>Record incorporation</button>
        )}
      </div>
      <div className="card__body">
        <LockedField
          label={preparing ? "Proposed name" : "Legal name"}
          requireUnlock={lockWhenSet(society.name)}
          reason="Changing the legal name can require a special resolution, name reservation, and registry filing. Review the active jurisdiction guide and governing documents first."
        >
          {(locked) => <input className="input" disabled={locked} value={form.name} onChange={(e) => set("name", e.target.value)} />}
        </LockedField>
        <div className="society-field-grid">
          <OptionSelect label="Entity type" setName="entityTypes" value={form.entityType ?? ""} onChange={(value) => { set("entityType", value); set("legalSubtype", "other"); }} emptyLabel="Needs classification" />
          <Field label="Legal jurisdiction">
            <Select value={form.jurisdictionCode ?? ""} onChange={(value) => set("jurisdictionCode", value)} options={jurisdictionChoices(JURISDICTION_OPTIONS, form.jurisdictionCode)} />
          </Field>
        </div>
        <GoverningActSelect value={form.actFormedUnder} jurisdictionCode={form.jurisdictionCode} onChange={setGoverningAct} otherActName={setupOtherActName(society.onboardingAnswersJson)} />
        <FormationFields form={form} set={set} documents={documents} registryFields={registryFields} />
        {vocab.societyLaw && <LockedField
          label="Society classification"
          requireUnlock={!savedPreparing}
          reason="Member-funded classification should be reviewed against the governing statute and filed documents."
        >
          {(locked) => (
            <div className="society-toggle-stack">
              {/* Member-funded is a BC Societies Act subtype. */}
              <Toggle checked={!!form.isMemberFunded} onChange={(v) => set("isMemberFunded", v)} disabled={locked} label="Member-funded society" />
            </div>
          )}
        </LockedField>}
        <StatusHistory form={form} set={set} />
        <Classification form={form} set={set} />
      </div>
    </section>
  );
}

function BusinessYearCard({ society, form, set }: { society: OrganizationRecord; form: ProfileForm; set: SetProfileField }) {
  const savedPreparing = isPreparingIncorporation(society);
  const lockWhenSet = (value: unknown) => !savedPreparing && hasText(value);
  const corporate = isCorporation(form);
  const vocab = organizationVocabulary(form);
  const governance = workspaceGovernanceCopy(form);
  return (
    <section className="card" id="business-year" aria-labelledby="org-business-year">
      <div className="card__head"><h2 className="card__title" id="org-business-year">Business &amp; year</h2></div>
      <div className="card__body">
        <LockedField
          label={governance.purposesLabel}
          requireUnlock={lockWhenSet(society.purposes)}
          reason={corporate
            ? "Business activities or article restrictions can require shareholder approval and a registry filing to change."
            : "Purposes can require member approval and a registry filing to change. Charities may also need CRA review."}
        >
          {(locked) => <MarkdownEditor rows={4} readOnly={locked} value={form.purposes ?? ""} onChange={(markdown) => set("purposes", markdown)} />}
        </LockedField>
        <LockedField
          label="Fiscal year end"
          requireUnlock={lockWhenSet(society.fiscalYearEnd)}
          reason={corporate
            ? `Changing the fiscal year end can require a review of the ${vocab.governingDocuments} and the CRA's rules. Affects every filing deadline downstream.`
            : "Changing the fiscal year end can require a bylaw amendment and notification to the CRA. Affects every filing deadline downstream."}
        >
          {(locked) => <MonthDayPicker ariaLabel="Fiscal year end" disabled={locked} value={form.fiscalYearEnd} onChange={(value) => set("fiscalYearEnd", value)} />}
        </LockedField>
        <AnnualDateFields form={form} set={set} />
      </div>
    </section>
  );
}

const CADENCES = ["Weekly", "Biweekly", "Monthly", "Bimonthly", "Quarterly", "Ad-hoc"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function MeetingsCard({ form, set }: { form: ProfileForm; set: SetProfileField }) {
  return (
    <section className="card" aria-labelledby="org-meetings">
      <div className="card__head"><h2 className="card__title" id="org-meetings">Meetings</h2></div>
      <div className="card__body">
        <div className="society-field-grid society-field-grid--mobile-pair">
          <Field label="Board meeting cadence">
            <Select value={form.boardCadence ?? ""} onChange={(v) => set("boardCadence", v)} clearable options={CADENCES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Day of week">
            <Select value={form.boardCadenceDayOfWeek ?? ""} onChange={(v) => set("boardCadenceDayOfWeek", v)} clearable clearLabel="—" options={WEEKDAYS.map((d) => ({ value: d, label: d }))} />
          </Field>
        </div>
        <Field label="Time (24h)">
          <input className="input" type="time" value={form.boardCadenceTime ?? ""} onChange={(e) => set("boardCadenceTime", e.target.value)} />
        </Field>
        <Field label="Notes" hint="e.g. Fourth Thursday of each month, except July & August.">
          <input className="input" value={form.boardCadenceNotes ?? ""} onChange={(e) => set("boardCadenceNotes", e.target.value)} />
        </Field>
      </div>
    </section>
  );
}

type LifecycleDateKey = "continuanceDate" | "amalgamationDate" | "archivedAtISO" | "removedAtISO";

/** Registry events after incorporation. The incorporation date itself is under Identity & formation. */
const LIFECYCLE_DATE_TYPES: { value: LifecycleDateKey; label: string }[] = [
  { value: "continuanceDate", label: "Continuance date" },
  { value: "amalgamationDate", label: "Amalgamation date" },
  { value: "archivedAtISO", label: "Archived date" },
  { value: "removedAtISO", label: "Removed date" },
];

/** After incorporation: the workspace status and registry events (continuance, amalgamation, archive, removal). */
function StatusHistory({ form, set }: { form: ProfileForm; set: SetProfileField }) {
  // While preparing, the formation status is the one status; the workspace
  // status follows it (organizationStatusForFormation in shared/entitySetup).
  const preparing = isPreparingIncorporation(form);
  return (
    <section className="entity-setup-group" id="status-history">
      <h3 className="entity-setup-group__title">Status &amp; registry history</h3>
      {!preparing && (
        <div className="society-field-grid">
          <OptionSelect label="Workspace status" setName="organizationStatuses" value={form.organizationStatus ?? ""} onChange={(value) => set("organizationStatus", value)} emptyLabel="No status" />
        </div>
      )}
      <LifecycleDates form={form} set={set} />
    </section>
  );
}

/** Classification flags and the trademark class. */
function Classification({ form, set }: { form: ProfileForm; set: SetProfileField }) {
  return (
    <section className="entity-setup-group">
      <h3 className="entity-setup-group__title">Classification</h3>
      <div className="org-details-toggle-row">
        <Toggle checked={!!form.numbered} onChange={(value) => set("numbered", value)} label="Numbered entity" />
        <Toggle checked={!!form.distributing} onChange={(value) => set("distributing", value)} label="Distributing" />
        <Toggle checked={!!form.solicitingPublicBenefit} onChange={(value) => set("solicitingPublicBenefit", value)} label="Soliciting / public benefit" />
      </div>
      <div className="society-field-grid">
        <Field label="Nice classification" hint="Trademark class, if the organization holds a mark.">
          <input className="input" value={form.niceClassification ?? ""} onChange={(e) => set("niceClassification", e.target.value)} />
        </Field>
      </div>
    </section>
  );
}

function LifecycleDates({ form, set }: { form: ProfileForm; set: SetProfileField }) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<LifecycleDateKey | "">("");
  const [value, setValue] = useState("");
  const rows = LIFECYCLE_DATE_TYPES.filter((item) => Boolean(form[item.value]));
  const missing = LIFECYCLE_DATE_TYPES.filter((item) => !form[item.value]);
  const start = () => {
    const next = missing[0]?.value ?? "";
    setType(next);
    setValue("");
    setAdding(Boolean(next));
  };
  const add = () => {
    if (!type || !value) return;
    set(type, value);
    setType("");
    setValue("");
    setAdding(false);
  };
  return (
    <div className="org-profile-history">
      <div className="org-profile-history__head">
        <span className="field__label">Registry dates</span>
        <button className="btn btn--sm" type="button" onClick={start} disabled={adding || missing.length === 0}>
          <Plus size={12} /> Add date
        </button>
      </div>
      <div className="org-details-date-list">
        {rows.length === 0 && !adding && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No continuance, amalgamation, archive or removal dates recorded.</div>}
        {rows.map((item) => (
          <div className="org-details-date-row" key={item.value}>
            <Field label={item.label}>
              <DatePicker value={form[item.value] ?? ""} onChange={(next) => set(item.value, next)} />
            </Field>
            <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label={`Clear ${item.label}`} onClick={() => set(item.value, "")}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {adding && (
          <div className="org-details-date-row org-details-date-row--draft">
            <Field label="Date type">
              <Select value={type} onChange={(next) => setType(next as LifecycleDateKey)} options={missing} />
            </Field>
            <Field label="Date">
              <DatePicker value={value} onChange={setValue} />
            </Field>
            <div className="org-details-date-row__actions">
              <button className="btn btn--sm" type="button" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn--sm btn--accent" type="button" onClick={add} disabled={!type || !value}>Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
