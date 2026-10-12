import { useState } from "react";
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
import { Info, ShieldCheck, Plus, Trash2 } from "lucide-react";
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
  type TransparencyDeadline,
} from "../../shared/significantIndividuals";

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

const stepKindLabel = (kind?: string) => TRANSPARENCY_STEP_KINDS.find((option) => option.value === kind)?.label;

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
  const [form, setForm] = useState<any>(null);
  const [revealDob, setRevealDob] = useState(false);
  const [dateEdit, setDateEdit] = useState<{ step: StepRow; field: "recordedOn" | "notifiedOn"; value: string } | null>(null);
  const toast = useToast();
  const bcCompany = society ? legalGovernanceProfile(society)?.id === "bc_company" : false;
  const corporation = society ? isCorporation(society) : false;

  const individuals = useQuery(
    api.registerHistory.significantIndividualsAsOf,
    society ? { societyId: society._id, asOf } : "skip",
  ) as
    | Array<{
        name: string;
        dateOfBirth?: string;
        becameSignificantOn: string;
        ceasedSignificantOn?: string;
        reason: string;
        status?: string;
        roleHolderId?: string;
        canadianStatus?: string;
        citizenshipCountries?: string[];
        significanceBases?: string[];
      }>
    | undefined;

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
  ) as { voting: any[]; nonVoting: any[] } | undefined;
  const ledger = useQuery(
    api.legalOperations.rightsLedger,
    society && corporation && canReadLedger ? { societyId: society._id, asOf } : "skip",
  ) as { roleHolders: any[] } | undefined;

  const createStep = usePermissionedMutation(api.significantIndividualSteps.create, canWrite);
  const removeStep = usePermissionedMutation(api.significantIndividualSteps.remove, canWrite);
  const updateDates = usePermissionedMutation(api.significantIndividualSteps.updateDates, canWrite);

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

  const notifiable = form?.stepKind === "became_significant" || form?.stepKind === "ceased_significant";
  const formProblems = form
    ? [
        !String(form.individualName ?? "").trim() ? "the individual's name" : "",
        !String(form.stepsNarrative ?? "").trim() ? "the steps taken" : "",
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

      {bcCompany && deadlines && deadlines.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 className="page__section-title">Transparency register deadlines</h2>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {deadlines.map((deadline) => (
              <div key={deadline.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong>{deadline.title}</strong>
                  <Badge tone={deadline.status === "overdue" ? "danger" : deadline.status === "due" ? "warn" : "neutral"}>
                    {deadline.status === "overdue" ? "Overdue" : deadline.status === "due" ? "Due today" : "Upcoming"}
                  </Badge>
                  <span className="muted">{deadline.opensOn ? `${formatDate(deadline.opensOn)} to ${formatDate(deadline.dueDate)}` : `Due ${formatDate(deadline.dueDate)}`}</span>
                </div>
                <div className="muted">{deadline.basis}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {corporation && canReadLedger && candidates.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 className="page__section-title">Candidates to review</h2>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {candidates.map((candidate) => (
              <div key={candidate.holderKey} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong>{candidate.holderName}</strong>
                  <Badge tone={candidate.action === "look_through" ? "warn" : candidate.recorded ? "success" : "info"}>
                    {candidate.action === "look_through" ? "Look through" : candidate.recorded ? "On the register" : "Review"}
                  </Badge>
                  <span className="muted">
                    {candidate.percentOfShares.toFixed(1)}% of issued shares · {candidate.percentOfVotes.toFixed(1)}% of votes
                  </span>
                </div>
                <div className="muted">{candidate.prompt}</div>
              </div>
            ))}
            <div className="muted" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(bcCompany ? CANDIDATE_REVIEW_REMINDERS : CANDIDATE_REVIEW_REMINDERS.slice(0, 1)).map((line) => <span key={line}>{line}</span>)}
            </div>
          </div>
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <div className="register-asof">
          <label className="register-asof__date">
            <span>As of</span>
            <DatePicker value={asOf} onChange={(value) => setAsOf(value)} />
          </label>
          {!!individuals?.length && (
            <span className="register-asof__totals">
              {individuals.length} significant individual{individuals.length === 1 ? "" : "s"}
            </span>
          )}
          {individuals?.some((ind) => ind.dateOfBirth) && (
            <button className="btn btn--ghost btn--sm" onClick={() => setRevealDob(!revealDob)}>
              {revealDob ? "Hide dates of birth" : "Show dates of birth"}
            </button>
          )}
        </div>
        {individuals === undefined ? (
          <div className="card">Loading…</div>
        ) : individuals.length === 0 ? (
          <div className="card">No significant individuals as of this date.</div>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {individuals.map((ind, i) => (
              <div
                key={ind.roleHolderId ?? i}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <strong>{ind.name}</strong>
                  {ind.status && <span className="muted">{ind.status}</span>}
                </div>
                <div className="muted">{ind.reason}</div>
                {!!ind.significanceBases?.length && (
                  <div className="muted">
                    {ind.significanceBases.map((basis) => {
                      const option = SIGNIFICANCE_BASIS_OPTIONS.find((item) => item.value === basis);
                      return option ? (bcCompany ? `${option.label} (${option.section})` : option.label) : basis;
                    }).join("; ")}
                  </div>
                )}
                <div className="muted" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>Became significant: {formatDate(ind.becameSignificantOn)}</span>
                  {ind.ceasedSignificantOn && (
                    <span>Ceased: {formatDate(ind.ceasedSignificantOn)}</span>
                  )}
                  {ind.canadianStatus && <span>{CANADIAN_STATUS_OPTIONS.find((option) => option.value === ind.canadianStatus)?.label ?? ind.canadianStatus}</span>}
                  {ind.canadianStatus === "neither" && !!ind.citizenshipCountries?.length && <span>Citizenship: {ind.citizenshipCountries.join(", ")}</span>}
                  {ind.dateOfBirth && <span>Date of birth: {revealDob ? formatDate(ind.dateOfBirth) : displayDateOfBirth(ind.dateOfBirth, false)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="page__section-title">Diligence steps taken</h2>
        {dueCount > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            {dueCount} review{dueCount === 1 ? "" : "s"} due
          </div>
        )}
        {steps === undefined ? (
          <div className="card">Loading…</div>
        ) : steps.length === 0 ? (
          <div className="card">No diligence steps recorded.</div>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {steps.map((s) => {
              const entry = s.stepKind === "became_significant" || s.stepKind === "ceased_significant";
              return (
                <div
                  key={s._id}
                  style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <strong>{s.individualName}</strong>
                      <span className="muted">{formatDate(s.stepDate)}</span>
                      {stepKindLabel(s.stepKind) && <Badge tone="neutral">{stepKindLabel(s.stepKind)}</Badge>}
                    </div>
                    <div className="muted">{s.stepsNarrative}</div>
                    <div className="muted" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {s.awareOn && <span>Aware: {formatDate(s.awareOn)}</span>}
                      {s.recordedOn && <span>Recorded in register: {formatDate(s.recordedOn)}</span>}
                      {s.notifiedOn && <span>Individual notified: {formatDate(s.notifiedOn)}</span>}
                      {s.nextReviewDate && <span>Next review: {formatDate(s.nextReviewDate)}</span>}
                    </div>
                  </div>
                  {s.awareOn && !s.recordedOn && (
                    <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => setDateEdit({ step: s, field: "recordedOn", value: todayDateOnly() })}>
                      Record entry
                    </button>
                  )}
                  {entry && s.recordedOn && !s.notifiedOn && (
                    <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => setDateEdit({ step: s, field: "notifiedOn", value: todayDateOnly() })}>
                      Record notice
                    </button>
                  )}
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Remove step for ${s.individualName}`}
                    disabled={!canWrite}
                    onClick={() => { if (canWrite) void removeStep({ id: s._id }); }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
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
