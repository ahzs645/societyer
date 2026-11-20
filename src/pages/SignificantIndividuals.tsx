import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { InfoPopover } from "../components/InfoPopover";
import { Select } from "../components/Select";
import { formatDate } from "../lib/format";
import type { ReactNode } from "react";
import { ClipboardCheck, Info, ShieldCheck, Plus, Trash2 } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { useToast } from "../components/Toast";
import { isCorporation } from "../../shared/organizationDomain";
import { legalGovernanceProfile } from "../../shared/legalGovernanceProfiles";
import { looksLikeOrganization } from "../../shared/nlg";
import { todayDateOnly } from "../../shared/dateOnly";
import {
  CANADIAN_STATUS_OPTIONS,
  CANDIDATE_REVIEW_REMINDERS,
  SIGNIFICANCE_BASIS_OPTIONS,
  TRANSPARENCY_STEP_KINDS,
  candidateFactsFromRegister,
  candidateSignificantIndividuals,
  displayDateOfBirth,
  type CandidateHolderInput,
  type SignificanceStatus,
  type TransparencyDeadline,
} from "../../shared/significantIndividuals";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type FieldMetadata,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";

type StepRow = {
  _id: string;
  individualName: string;
  stepsNarrative: string;
  stepDate: string;
  nextReviewDate?: string;
  stepKind?: string;
  awareOn?: string;
  recordedOn?: string;
  notifiedOn?: string;
};

type StepForm = {
  individualName: string;
  roleHolderId: string;
  stepKind: string;
  stepDate: string;
  stepsNarrative: string;
  nextReviewDate: string;
  awareOn: string;
  recordedOn: string;
  notifiedOn: string;
};

/** A register entry as registerHistory:significantIndividualsAsOf returns it. */
type IndividualRow = {
  name: string;
  dateOfBirth?: string;
  becameSignificantOn: string;
  ceasedSignificantOn?: string;
  reason: string;
  status?: SignificanceStatus;
  roleHolderId?: string;
  canadianStatus?: string;
  citizenshipCountries?: string[];
  significanceBases?: string[];
};

type IndividualRecord = {
  _id: string;
  name: string;
  status: SignificanceStatus | null;
  reason: string;
  bases: string;
  becameSignificantOn: string | null;
  ceasedSignificantOn: string | null;
  canadianStatus: string | null;
  citizenship: string;
  /** Masked ("Restricted") until the reader chooses to show dates of birth, so search never reveals them. */
  dateOfBirth: string;
};

type StepRecord = {
  _id: string;
  individualName: string;
  stepKind: string | null;
  stepDate: string;
  stepsNarrative: string;
  awareOn: string | null;
  recordedOn: string | null;
  notifiedOn: string | null;
  nextReviewDate: string | null;
  step: StepRow;
};

const stepKindLabel = (kind?: string) => TRANSPARENCY_STEP_KINDS.find((option) => option.value === kind)?.label;
const canadianStatusLabel = (status: string) => CANADIAN_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
const isRegisterEntryStep = (kind?: string) => kind === "became_significant" || kind === "ceased_significant";
const SIGNIFICANCE_STATUS_LABELS: Record<SignificanceStatus, string> = { current: "Current", upcoming: "Upcoming", former: "Former" };

const INDIVIDUALS_TABLE = staticRecordTable({
  id: "significant-individuals",
  nameSingular: "significantIndividual",
  namePlural: "significantIndividuals",
  labelSingular: "Significant individual",
  labelPlural: "Significant individuals",
  labelIdentifierFieldName: "name",
  density: "comfortable",
  fields: [
    { name: "name", label: "Individual", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "current", label: SIGNIFICANCE_STATUS_LABELS.current, color: "green" },
          { value: "upcoming", label: SIGNIFICANCE_STATUS_LABELS.upcoming, color: "blue" },
          { value: "former", label: SIGNIFICANCE_STATUS_LABELS.former, color: "gray" },
        ],
      },
    },
    { name: "reason", label: "Reason", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "bases", label: "How significant", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    { name: "becameSignificantOn", label: "Became significant", fieldType: FIELD_TYPES.DATE, size: 160 },
    { name: "ceasedSignificantOn", label: "Ceased", fieldType: FIELD_TYPES.DATE, size: 130 },
    {
      name: "canadianStatus",
      label: "Canadian status",
      fieldType: FIELD_TYPES.SELECT,
      size: 200,
      config: { options: CANADIAN_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label, color: "gray" })) },
    },
    { name: "citizenship", label: "Citizenship", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "dateOfBirth", label: "Date of birth", fieldType: FIELD_TYPES.TEXT, size: 140, config: { groupable: false } },
  ],
});

const STEPS_TABLE = staticRecordTable({
  id: "significant-individual-steps",
  nameSingular: "diligenceStep",
  namePlural: "diligenceSteps",
  labelSingular: "Diligence step",
  labelPlural: "Diligence steps",
  labelIdentifierFieldName: "individualName",
  density: "comfortable",
  sorts: [{ field: "stepDate", direction: "desc" }],
  fields: [
    { name: "individualName", label: "Individual", fieldType: FIELD_TYPES.TEXT, size: 200 },
    {
      name: "stepKind",
      label: "Step",
      fieldType: FIELD_TYPES.SELECT,
      size: 220,
      config: { options: TRANSPARENCY_STEP_KINDS.map((kind) => ({ value: kind.value, label: kind.label, color: "gray" })) },
    },
    { name: "stepDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "stepsNarrative", label: "Steps taken", fieldType: FIELD_TYPES.TEXT, size: 300, config: { groupable: false } },
    { name: "awareOn", label: "Aware", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "recordedOn", label: "Recorded in register", fieldType: FIELD_TYPES.DATE, size: 170 },
    { name: "notifiedOn", label: "Individual notified", fieldType: FIELD_TYPES.DATE, size: 160 },
    { name: "nextReviewDate", label: "Next review", fieldType: FIELD_TYPES.DATE, size: 130 },
  ],
});

/**
 * BC Transparency Register of Significant Individuals (Business Corporations
 * Act Part 4.1) with a diligence-steps sub-register. The BC rules, deadlines
 * and citations show only for a BC company; other corporations see a neutral
 * register, and a society sees that the register is not required.
 */
export function SignificantIndividualsPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("deadlines:write");
  const canReadLedger = loaded && can("documents:read");
  const [asOf, setAsOf] = useState(todayDateOnly());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StepForm | null>(null);
  const [revealDob, setRevealDob] = useState(false);
  const [dateEdit, setDateEdit] = useState<{ step: StepRow; field: "recordedOn" | "notifiedOn"; value: string } | null>(null);
  const toast = useToast();
  const bcCompany = society ? legalGovernanceProfile(society)?.id === "bc_company" : false;
  const corporation = society ? isCorporation(society) : false;

  const individuals = useQuery(
    api.registerHistory.significantIndividualsAsOf,
    society ? { societyId: society._id, asOf } : "skip",
  ) as IndividualRow[] | undefined;

  const steps = useQuery(
    api.significantIndividualSteps.list,
    society ? { societyId: society._id } : "skip",
  ) as StepRow[] | undefined;

  const reviewsDue = useQuery(
    api.significantIndividualSteps.reviewsDue,
    society ? { societyId: society._id, asOf } : "skip",
  ) as Array<{ _id: string }> | undefined;

  const deadlines = useQuery(
    api.significantIndividualSteps.transparencyDeadlines,
    society && bcCompany ? { societyId: society._id, asOf } : "skip",
  ) as TransparencyDeadline[] | undefined;

  // Candidate suggestions come from the share register as of the chosen date.
  const voting = useQuery(
    api.legalOperations.votingPower,
    society && corporation && canReadLedger ? { societyId: society._id, asOf } : "skip",
  ) as { voting: CandidateHolderInput[]; nonVoting: CandidateHolderInput[] } | undefined;
  const ledger = useQuery(
    api.legalOperations.rightsLedger,
    society && corporation && canReadLedger ? { societyId: society._id, asOf } : "skip",
  ) as { roleHolders: Record<string, unknown>[] } | undefined;

  const createStep = usePermissionedMutation(api.significantIndividualSteps.create, canWrite);
  const removeStep = usePermissionedMutation(api.significantIndividualSteps.remove, canWrite);
  const updateDates = usePermissionedMutation(api.significantIndividualSteps.updateDates, canWrite);

  const individualRecords = useMemo<IndividualRecord[]>(
    () => (individuals ?? []).map((ind, index) => ({
      _id: ind.roleHolderId ?? `${ind.name}-${ind.becameSignificantOn}-${index}`,
      name: ind.name,
      status: ind.status ?? null,
      reason: ind.reason,
      bases: (ind.significanceBases ?? []).map((basis) => {
        const option = SIGNIFICANCE_BASIS_OPTIONS.find((item) => item.value === basis);
        return option ? (bcCompany ? `${option.label} (${option.section})` : option.label) : basis;
      }).join("; "),
      becameSignificantOn: ind.becameSignificantOn || null,
      ceasedSignificantOn: ind.ceasedSignificantOn ?? null,
      canadianStatus: ind.canadianStatus ?? null,
      citizenship: ind.canadianStatus === "neither" ? (ind.citizenshipCountries ?? []).join(", ") : "",
      dateOfBirth: ind.dateOfBirth ? (revealDob ? formatDate(ind.dateOfBirth) : displayDateOfBirth(ind.dateOfBirth, false)) : "",
    })),
    [individuals, bcCompany, revealDob],
  );
  const stepRecords = useMemo<StepRecord[]>(
    () => (steps ?? []).map((step) => ({
      _id: step._id,
      individualName: step.individualName,
      stepKind: step.stepKind || null,
      stepDate: step.stepDate,
      stepsNarrative: step.stepsNarrative,
      awareOn: step.awareOn ?? null,
      recordedOn: step.recordedOn ?? null,
      notifiedOn: step.notifiedOn ?? null,
      nextReviewDate: step.nextReviewDate ?? null,
      step,
    })),
    [steps],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const holders = [...(voting?.voting ?? []), ...(voting?.nonVoting ?? [])];
  const candidates = holders.length
    ? candidateSignificantIndividuals(holders, candidateFactsFromRegister(holders, ledger?.roleHolders ?? [], looksLikeOrganization))
    : [];

  const openNew = () => {
    if (!canWrite) return;
    setForm({
      individualName: "",
      roleHolderId: "",
      stepKind: "",
      stepDate: todayDateOnly(),
      stepsNarrative: "",
      nextReviewDate: "",
      awareOn: "",
      recordedOn: "",
      notifiedOn: "",
    });
    setOpen(true);
  };

  const notifiable = isRegisterEntryStep(form?.stepKind);
  const formProblems = form
    ? [
        !form.individualName.trim() ? "the individual's name" : "",
        !form.stepsNarrative.trim() ? "the steps taken" : "",
        !form.stepDate ? "the step date" : "",
      ].filter(Boolean)
    : [];
  const save = async () => {
    if (!canWrite || !form) return;
    if (formProblems.length) {
      toast.error("Step not recorded", `Enter ${formProblems.join(", ")}.`);
      return;
    }
    try {
      await createStep({
        societyId: society._id,
        individualName: form.individualName.trim(),
        ...(form.roleHolderId ? { roleHolderId: form.roleHolderId } : {}),
        stepsNarrative: form.stepsNarrative.trim(),
        stepDate: form.stepDate,
        nextReviewDate: form.nextReviewDate || undefined,
        ...(form.stepKind ? { stepKind: form.stepKind } : {}),
        ...(form.awareOn ? { awareOn: form.awareOn } : {}),
        ...(form.recordedOn ? { recordedOn: form.recordedOn } : {}),
        ...(notifiable && form.notifiedOn ? { notifiedOn: form.notifiedOn } : {}),
        nowISO: new Date().toISOString(),
      });
      setOpen(false);
      toast.success("Diligence step recorded");
    } catch (error) {
      toast.error("Step not recorded", error instanceof Error ? error.message : String(error));
    }
  };
  const saveDate = async () => {
    if (!canWrite || !dateEdit?.value) return;
    try {
      await updateDates({ id: dateEdit.step._id, [dateEdit.field]: dateEdit.value });
      setDateEdit(null);
      toast.success(dateEdit.field === "recordedOn" ? "Register entry date recorded" : "Notice date recorded");
    } catch (error) {
      toast.error("Date not recorded", error instanceof Error ? error.message : String(error));
    }
  };

  const dueCount = reviewsDue?.length ?? 0;
  const controllerOptions = (individuals ?? []).filter((ind) => ind.roleHolderId);
  const hasDatesOfBirth = individuals?.some((ind) => ind.dateOfBirth) ?? false;

  const renderIndividualCell = ({ record, field }: { record: IndividualRecord; field: FieldMetadata }) => {
    if (field.name === "name") return <strong>{record.name}</strong>;
    return undefined;
  };
  const renderIndividualCard = (record: IndividualRecord, { selecting }: RecordTableCardHelpers) => (
    <RecordTablePhoneCard
      title={record.name}
      badge={record.status ? <Badge tone={record.status === "current" ? "success" : "neutral"}>{SIGNIFICANCE_STATUS_LABELS[record.status]}</Badge> : undefined}
      meta={[
        record.becameSignificantOn ? `Became significant ${formatDate(record.becameSignificantOn)}` : "",
        record.ceasedSignificantOn ? `Ceased ${formatDate(record.ceasedSignificantOn)}` : "",
      ]}
      detail={[
        record.reason,
        record.canadianStatus ? canadianStatusLabel(record.canadianStatus) : "",
        record.dateOfBirth ? `Date of birth: ${record.dateOfBirth}` : "",
      ]}
      selecting={selecting}
    />
  );

  const renderStepCell = ({ record, field }: { record: StepRecord; field: FieldMetadata }) => {
    if (field.name === "individualName") return <strong>{record.individualName}</strong>;
    return undefined;
  };
  const renderStepActions = ({ step }: StepRecord) => (
    <>
      {step.awareOn && !step.recordedOn && (
        <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => setDateEdit({ step, field: "recordedOn", value: todayDateOnly() })}>
          Record entry
        </button>
      )}
      {isRegisterEntryStep(step.stepKind) && step.recordedOn && !step.notifiedOn && (
        <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => setDateEdit({ step, field: "notifiedOn", value: todayDateOnly() })}>
          Record notice
        </button>
      )}
      <button
        className="btn btn--ghost btn--sm btn--icon"
        aria-label={`Remove step for ${step.individualName}`}
        disabled={!canWrite}
        onClick={() => { if (canWrite) void removeStep({ id: step._id }); }}
      >
        <Trash2 size={12} />
      </button>
    </>
  );
  const renderStepCard = ({ step }: StepRecord, { selecting }: RecordTableCardHelpers) => (
    <RecordTablePhoneCard
      title={step.individualName}
      badge={stepKindLabel(step.stepKind) ? <Badge tone="neutral">{stepKindLabel(step.stepKind)}</Badge> : undefined}
      meta={[formatDate(step.stepDate), step.nextReviewDate ? `Next review ${formatDate(step.nextReviewDate)}` : ""]}
      detail={[step.stepsNarrative]}
      selecting={selecting}
    />
  );

  return (
    <div className="page">
      <PageHeader
        title="Significant individuals"
        icon={<ShieldCheck size={16} />}
        iconColor="green"
        subtitle="Significant individuals (controllers) and the steps taken to identify them."
        info={
          bcCompany
            ? <p>The transparency register as of a chosen date, with the reasonable steps taken. A BC private company keeps it under Part 4.1 of the Business Corporations Act. Only directors and authorized inspecting officials may inspect it.</p>
            : corporation
              ? <p>The register of individuals who own or control the corporation, as of a chosen date, with the steps taken. Check the register rules of the corporation's governing Act.</p>
              : <p>Records of individuals who own or control an organization. A society is not required to keep this register.</p>
        }
        actions={
          <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
            <Plus size={12} /> Record step
          </button>
        }
      />

      {!corporation && (
        <NotRequiredNote>
          {society.name} is not a company with shares, so a register of significant individuals is not required. Records kept here are optional and are not a statutory register.
        </NotRequiredNote>
      )}

      {/* The date drives every card below: the register, its deadlines and the share-register candidates. */}
      <div className="register-asof">
        <label className="register-asof__date">
          <span>As of</span>
          <DatePicker value={asOf} onChange={(value) => setAsOf(value)} />
        </label>
      </div>

      {bcCompany && deadlines && deadlines.length > 0 && (
        <section className="card" aria-labelledby="si-deadlines">
          <div className="card__head">
            <h2 className="card__title" id="si-deadlines">Transparency register deadlines</h2>
            <Badge>{deadlines.length}</Badge>
          </div>
          <div className="card__body">
            <ul className="significant-individuals__list">
              {deadlines.map((deadline) => (
                <li key={deadline.key} className="significant-individuals__item">
                  <div className="significant-individuals__item-head">
                    <strong>{deadline.title}</strong>
                    <Badge tone={deadline.status === "overdue" ? "danger" : deadline.status === "due" ? "warn" : "neutral"}>
                      {deadline.status === "overdue" ? "Overdue" : deadline.status === "due" ? "Due today" : "Upcoming"}
                    </Badge>
                    <span className="muted">{deadline.opensOn ? `${formatDate(deadline.opensOn)} to ${formatDate(deadline.dueDate)}` : `Due ${formatDate(deadline.dueDate)}`}</span>
                  </div>
                  <div className="muted">{deadline.basis}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {corporation && canReadLedger && candidates.length > 0 && (
        <section className="card" aria-labelledby="si-candidates">
          <div className="card__head">
            <h2 className="card__title" id="si-candidates">Candidates to review</h2>
            <Badge>{candidates.length}</Badge>
          </div>
          <div className="card__body">
            <ul className="significant-individuals__list">
              {candidates.map((candidate) => (
                <li key={candidate.holderKey} className="significant-individuals__item">
                  <div className="significant-individuals__item-head">
                    <strong>{candidate.holderName}</strong>
                    <Badge tone={candidate.action === "look_through" ? "warn" : candidate.recorded ? "success" : "info"}>
                      {candidate.action === "look_through" ? "Look through" : candidate.recorded ? "On the register" : "Review"}
                    </Badge>
                    <span className="muted">
                      {candidate.percentOfShares.toFixed(1)}% of issued shares · {candidate.percentOfVotes.toFixed(1)}% of votes
                    </span>
                  </div>
                  <div className="muted">{candidate.prompt}</div>
                </li>
              ))}
            </ul>
            <ul className="significant-individuals__reminders muted">
              {(bcCompany ? CANDIDATE_REVIEW_REMINDERS : CANDIDATE_REVIEW_REMINDERS.slice(0, 1)).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="si-register">
        <div className="card__head">
          <h2 className="card__title" id="si-register">Register</h2>
          {individuals && <Badge>{individuals.length}</Badge>}
          {hasDatesOfBirth && (
            <button className="btn btn--ghost btn--sm significant-individuals__head-action" onClick={() => setRevealDob(!revealDob)}>
              {revealDob ? "Hide dates of birth" : "Show dates of birth"}
            </button>
          )}
        </div>
        <RecordListTable<IndividualRecord>
          variant="card"
          table={INDIVIDUALS_TABLE}
          tableId="significant-individuals"
          label="Significant individuals"
          icon={<ShieldCheck size={14} />}
          records={individualRecords}
          loading={individuals === undefined}
          renderCell={renderIndividualCell}
          renderPhoneCard={renderIndividualCard}
          emptyState={<RecordTableEmpty title="No significant individuals as of this date" />}
        />
      </section>

      <section className="card" aria-labelledby="si-steps">
        <div className="card__head">
          <h2 className="card__title" id="si-steps">Diligence steps taken</h2>
          {steps && <Badge>{steps.length}</Badge>}
          {dueCount > 0 && <Badge tone="warn">{dueCount} review{dueCount === 1 ? "" : "s"} due</Badge>}
        </div>
        <RecordListTable<StepRecord>
          variant="card"
          table={STEPS_TABLE}
          tableId="significant-individual-steps"
          label="Diligence steps"
          icon={<ClipboardCheck size={14} />}
          records={stepRecords}
          loading={steps === undefined}
          renderCell={renderStepCell}
          renderRowActions={renderStepActions}
          renderPhoneCard={renderStepCard}
          emptyState={<RecordTableEmpty title="No diligence steps recorded" />}
        />
      </section>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Record diligence step"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWrite} onClick={save}>Save</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="What this step records">
              <Select
                value={form.stepKind}
                onChange={(value) => setForm({ ...form, stepKind: value })}
                options={[{ value: "", label: "A diligence note" }, ...TRANSPARENCY_STEP_KINDS.map((kind) => ({ value: kind.value, label: kind.label }))]}
              />
            </Field>
            {controllerOptions.length > 0 && (
              <Field label="Significant individual on the register">
                <Select
                  value={form.roleHolderId}
                  onChange={(value) => {
                    const match = controllerOptions.find((ind) => ind.roleHolderId === value);
                    setForm({ ...form, roleHolderId: value, individualName: match ? match.name : form.individualName });
                  }}
                  options={[{ value: "", label: "Not linked" }, ...controllerOptions.map((ind) => ({ value: String(ind.roleHolderId), label: ind.name }))]}
                />
              </Field>
            )}
            <Field label="Individual name">
              <input
                disabled={!canWrite}
                className="input"
                value={form.individualName}
                onChange={(e) => setForm({ ...form, individualName: e.target.value })}
              />
            </Field>
            <Field label="Step date">
              <DatePicker
                disabled={!canWrite}
                value={form.stepDate}
                onChange={(value) => setForm({ ...form, stepDate: value })}
              />
            </Field>
            <Field label="Steps narrative">
              <textarea
                disabled={!canWrite}
                className="input"
                value={form.stepsNarrative}
                onChange={(e) => setForm({ ...form, stepsNarrative: e.target.value })}
              />
            </Field>
            {form.stepKind && form.stepKind !== "annual_review" && form.stepKind !== "information_request" && form.stepKind !== "other" && (
              <>
                <Field label="Date the company became aware" hint={bcCompany ? "The change must be recorded in the register within 30 days after this date (Business Corporations Act s. 119.31 (1))." : undefined}>
                  <DatePicker disabled={!canWrite} value={form.awareOn} onChange={(value) => setForm({ ...form, awareOn: value })} />
                </Field>
                <Field label="Date recorded in the register">
                  <DatePicker disabled={!canWrite} value={form.recordedOn} onChange={(value) => setForm({ ...form, recordedOn: value })} />
                </Field>
              </>
            )}
            {notifiable && (
              <Field label="Date the individual was notified" hint={bcCompany ? "Send the notice within 10 days after the register entry (Business Corporations Act s. 119.41)." : undefined}>
                <DatePicker disabled={!canWrite} value={form.notifiedOn} onChange={(value) => setForm({ ...form, notifiedOn: value })} />
              </Field>
            )}
            <Field label="Next review date">
              <DatePicker
                disabled={!canWrite}
                value={form.nextReviewDate}
                onChange={(value) => setForm({ ...form, nextReviewDate: value })}
              />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(dateEdit)}
        onClose={() => setDateEdit(null)}
        title={dateEdit?.field === "notifiedOn" ? "Record notice to the individual" : "Record register entry"}
        footer={
          <>
            <button className="btn" onClick={() => setDateEdit(null)}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWrite || !dateEdit?.value} onClick={saveDate}>Save</button>
          </>
        }
      >
        {dateEdit && (
          <div>
            <InspectorNote tone="info" title={dateEdit.step.individualName}>
              {dateEdit.field === "notifiedOn" ? "The date the notice was sent to the individual." : "The date the information was entered in the register."}
            </InspectorNote>
            <Field label="Date">
              <DatePicker value={dateEdit.value} onChange={(value) => setDateEdit({ ...dateEdit, value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default SignificantIndividualsPage;

/**
 * One-line "not required" notice for registers that only apply to BC
 * companies; the reason sits behind an ⓘ.
 */
export function NotRequiredNote({ children }: { children: ReactNode }) {
  return (
    <div className="inspector-note inspector-note--info" style={{ alignItems: "center", marginBottom: 16 }}>
      <div className="inspector-note__icon">
        <Info size={14} />
      </div>
      <div className="inspector-note__content row" style={{ gap: 6, alignItems: "center" }}>
        <span className="inspector-note__title" style={{ margin: 0 }}>Not required for this organization</span>
        <InfoPopover label="Why this is optional">
          <p>{children}</p>
        </InfoPopover>
      </div>
    </div>
  );
}
