import { useEffect, useState } from "react";
import { calendarDateKey } from "../lib/calendarDates";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { CalendarClock } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Field } from "../components/ui";
import { Checkbox } from "../components/Controls";
import { formatMonthDay } from "../components/MonthDayPicker";
import { Link } from "react-router-dom";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { organizationVocabulary } from "../lib/organizationVocabulary";
import {
  assessAnnualMeetingDeadline,
  assessAnnualReturnDeadline,
  complianceDeadlineAlreadyTracked,
  complianceDeadlineSourceKey,
  deriveComplianceDeadlines,
  deriveComplianceHistoryNotices,
  type ComplianceSettings,
  type DeadlineAssessment,
  type DerivedDeadline,
} from "../../shared/corporationSettings";
import { DatePicker } from "../components/DatePicker";
import { deriveAgmFacts } from "../../shared/agmEvidence";
import { formatDate } from "../lib/format";
import { todayDateOnly } from "../../shared/dateOnly";
import { annualGovernanceSettings } from "../../shared/annualGovernanceEvidence";
import { legalGovernanceProfile } from "../../shared/legalGovernanceProfiles";
import { CitationBadge } from "../components/CitationTooltip";

/**
 * Compliance settings → deadlines. Surfaces the YCN Corporation_Settings idea:
 * AGM month/day + fiscal year-end drive the AGM / fiscal / annual-report
 * deadlines (logic: shared/corporationSettings.ts). Saving uses the focused
 * society:updateComplianceSettings mutation; "Generate" inserts the derived
 * deadlines via the existing deadlines.create (skipping ones already present).
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ComplianceSettingsPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canSaveSettings = permissions.loaded && permissions.can("settings:write");
  const canGenerate = permissions.loaded && permissions.can("deadlines:write");
  const canClone = permissions.loaded && permissions.can("society:write");
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const save = useMutation(api.society.updateComplianceSettings);
  const createDeadline = useMutation(api.deadlines.create);
  const cloneSociety = useMutation(api.society.cloneSociety);
  const [cloneName, setCloneName] = useState("");
  const [cloneResult, setCloneResult] = useState<string | null>(null);
  const existing = useQuery(
    api.deadlines.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<{ title?: string; dueDate?: string; category?: string; sourceKey?: string }> | undefined;
  const meetings = useQuery(
    api.meetings.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<{ type?: string; status?: string; scheduledAt?: string }> | undefined;
  const todayISO = calendarDateKey(new Date());
  const canReadFilings = permissions.loaded && permissions.can("filings:read");
  const filings = useQuery(api.filings.list, society && canReadFilings ? { societyId: society._id } : "skip");
  // Only held AGMs are evidence (a scheduled or draft AGM is not).
  const agmFacts = deriveAgmFacts(society ?? null, meetings ?? [], todayISO);
  const lastAgmDay = agmFacts.annualMeetingDate
    ? { month: Number(agmFacts.annualMeetingDate.slice(5, 7)), day: Number(agmFacts.annualMeetingDate.slice(8, 10)) }
    : null;

  const [agmMonth, setAgmMonth] = useState<number | "">(society?.agmMonth ?? "");
  const [agmDay, setAgmDay] = useState<number | "">(society?.agmDay ?? "");
  const [waive, setWaive] = useState<boolean>(Boolean(society?.waivePrepFinancials));
  const [restrictPeople, setRestrictPeople] = useState<boolean>(Boolean(society?.restrictPeoplePicker));
  const [docIdHeader, setDocIdHeader] = useState<boolean>(Boolean(society?.includeDocumentIdHeader));
  const [docLanguage, setDocLanguage] = useState<string>(society?.docPrepLanguage ?? "");
  const [contacts, setContacts] = useState({
    shortName: society?.shortName ?? "",
    primaryContactName: society?.primaryContactName ?? "",
    primaryContactEmail: society?.primaryContactEmail ?? "",
    minuteBookLocation: society?.minuteBookLocation ?? "",
    sealLocation: society?.sealLocation ?? "",
    responsibleLawyer: society?.responsibleLawyer ?? "",
  });
  const [saved, setSaved] = useState(false);
  const setC = (k: string, v: string) => setContacts((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    if (!society) return;
    setAgmMonth(society.agmMonth ?? "");
    setAgmDay(society.agmDay ?? "");
    setWaive(Boolean(society.waivePrepFinancials));
    setRestrictPeople(Boolean(society.restrictPeoplePicker));
    setDocIdHeader(Boolean(society.includeDocumentIdHeader));
    setDocLanguage(society.docPrepLanguage ?? "");
    setContacts({ shortName: society.shortName ?? "", primaryContactName: society.primaryContactName ?? "",
      primaryContactEmail: society.primaryContactEmail ?? "", minuteBookLocation: society.minuteBookLocation ?? "",
      sealLocation: society.sealLocation ?? "", responsibleLawyer: society.responsibleLawyer ?? "" });
    setSaved(false);
    setCloneResult(null);
  }, [society?._id]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const settings: ComplianceSettings = {
    ...annualGovernanceSettings(society, meetings ?? [], filings ?? [], todayISO),
    agmMonth: agmMonth === "" ? undefined : Number(agmMonth),
    agmDay: agmDay === "" ? undefined : Number(agmDay),
    fiscalYearEnd: society.fiscalYearEnd ?? undefined,
    incorporationDate: society.incorporationDate ?? undefined,
    anniversaryDate: society.anniversaryDate ?? undefined,
    waivePrepFinancials: waive,
    jurisdictionCode: society.jurisdictionCode,
    entityType: society.entityType,
    actFormedUnder: society.actFormedUnder,

  };
  const today = todayDateOnly();
  const derived: DerivedDeadline[] = deriveComplianceDeadlines(settings, today).map(deadline =>
    deadline.key === "annual-report" && (!canReadFilings || filings === undefined)
      ? { ...deadline, status: "review_required", basis: `${deadline.basis} Filing evidence is not available in this view; completion and overdue status require someone with filing access to review the register.` }
      : deadline);
  const generatable = derived.filter(deadline => deadline.status !== "review_required");
  // Earlier cycles without evidence: informational, never an open deadline.
  const historyNotices = canReadFilings && filings !== undefined
    ? deriveComplianceHistoryNotices(settings, today)
    : deriveComplianceHistoryNotices(settings, today).filter((notice) => notice.key !== "annual-report-history");

  const onSave = async () => {
    if (!canSaveSettings || saving) return;
    setSaving(true);
    try {
    await save({
      societyId: society._id,
      agmMonth: settings.agmMonth,
      agmDay: settings.agmDay,
      waivePrepFinancials: waive,
      shortName: contacts.shortName || undefined,
      primaryContactName: contacts.primaryContactName || undefined,
      primaryContactEmail: contacts.primaryContactEmail || undefined,
      minuteBookLocation: contacts.minuteBookLocation || undefined,
      sealLocation: contacts.sealLocation || undefined,
      responsibleLawyer: contacts.responsibleLawyer || undefined,
      restrictPeoplePicker: restrictPeople,
      includeDocumentIdHeader: docIdHeader,
      docPrepLanguage: docLanguage || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    } catch (error) { toast.error("Could not save settings", error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  // De-duplicate on the obligation and its cycle, not on title and due date:
  // titles and calculated dates change, and legacy rows ("Annual General
  // Meeting", "Annual Report") must still count as already tracked.
  const alreadyTracked = (d: DerivedDeadline) => complianceDeadlineAlreadyTracked(d, existing ?? [], settings);
  const generate = async () => {
    if (!canGenerate || generating) return;
    setGenerating(true);
    try {
      let added = 0;
      for (const d of generatable) {
        if (alreadyTracked(d)) continue;
        await createDeadline({ societyId: society._id, title: d.title, dueDate: d.dueDate, category: d.deadlineCategory, description: d.basis, sourceKey: complianceDeadlineSourceKey(d) });
        added += 1;
      }
      toast.success("Deadlines generated", `${added} new dates added.`);
    } catch (error) { toast.error("Could not generate deadlines", error instanceof Error ? error.message : String(error)); }
    finally { setGenerating(false); }
  };

  const pendingCount = generatable.filter((d) => !alreadyTracked(d)).length;
  const entity = organizationVocabulary(society);
  const meetingLabel = entity.annualMeetingTitle;

  return (
    <div className="page">
      <PageHeader
        title="Compliance settings"
        icon={<CalendarClock size={16} />}
        iconColor="orange"
        subtitle={`Plan the ${entity.annualMeeting} and review deadlines calculated from the governing Act and recorded evidence.`}
        actions={
          <button className="btn-action btn-action--primary" onClick={onSave} disabled={saving || !canSaveSettings}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        }
      />

      <div className="settings-split">
        <div className="settings-split__main">
          <section className="card settings-section">
            <h2 className="settings-section__title">Annual cycle</h2>
            <div className="settings-section__row settings-section__row--pair">
              <Field label={`${meetingLabel} month`}>
                <Select value={String(agmMonth)} onChange={(value) => setAgmMonth(value === "" ? "" : Number(value))}
                  options={[{ value: "", label: "Not set" }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
              </Field>
              <Field label={`${meetingLabel} day`}>
                <input className="input" type="number" inputMode="numeric" min={1} max={31} value={agmDay}
                  onChange={(e) => setAgmDay(e.target.value === "" ? "" : Number(e.target.value))} />
              </Field>
            </div>
            {lastAgmDay && (agmMonth === "" || agmDay === "") && (
              <p className="settings-section__hint">
                Last {entity.annualMeeting} was {formatDate(agmFacts.annualMeetingDate!)}.{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAgmMonth(lastAgmDay.month);
                    setAgmDay(lastAgmDay.day);
                  }}
                >
                  Use this date
                </button>
              </p>
            )}
            <div className="settings-section__fact">
              <span className="settings-section__fact-label">Fiscal year end</span>
              <span>{society.fiscalYearEnd ? formatMonthDay(society.fiscalYearEnd) : "Not set"}</span>
              <Link to="/app/society" className="settings-section__fact-link">Change in profile</Link>
            </div>
            {(legalGovernanceProfile(society)?.id === "bc_company" || waive) && <Checkbox
              checked={waive}
              onChange={setWaive}
              label="Financial-statement preparation waiver proposed"
              hint="Requires a separate review of the Act, eligibility and unanimous annual consent. This setting alone completes no annual business."
            />}
          </section>

          <AnnualDeadlineEvidence
            societyId={society._id}
            society={society}
            settings={settings}
            today={today}
            canWrite={canSaveSettings}
            canReadResolutions={permissions.loaded && permissions.can("motions:read")}
            filingsAvailable={canReadFilings && filings !== undefined}
          />

          <section className="card settings-section">
            <h2 className="settings-section__title">Documents</h2>
            <Checkbox
              checked={restrictPeople}
              onChange={setRestrictPeople}
              label="Pick people from the directory only"
              hint="Directors, officers and signers must match a People directory record."
            />
            <Checkbox
              checked={docIdHeader}
              onChange={setDocIdHeader}
              label="Stamp a document ID on generated documents"
            />
            <Field label="Document language">
              <Select value={docLanguage} onChange={(value) => setDocLanguage(value)}
                options={[{ value: "", label: "English (default)" }, { value: "French", label: "French (resolutions, execution block and dates)" }]} />
            </Field>
          </section>

          <section className="card settings-section">
            <h2 className="settings-section__title">Contacts &amp; records</h2>
            <Field label="Short name" hint={`Defined term, e.g. "the ${entity.organizationTitle}"`}>
              <input className="input" value={contacts.shortName} onChange={(e) => setC("shortName", e.target.value)} />
            </Field>
            <div className="settings-section__row">
              <Field label="Primary contact">
                <input className="input" value={contacts.primaryContactName} onChange={(e) => setC("primaryContactName", e.target.value)} />
              </Field>
              <Field label="Contact email">
                <input className="input" type="email" value={contacts.primaryContactEmail} onChange={(e) => setC("primaryContactEmail", e.target.value)} />
              </Field>
            </div>
            <div className="settings-section__row">
              <Field label="Minute book location">
                <input className="input" value={contacts.minuteBookLocation} onChange={(e) => setC("minuteBookLocation", e.target.value)} />
              </Field>
              <Field label="Seal / records location">
                <input className="input" value={contacts.sealLocation} onChange={(e) => setC("sealLocation", e.target.value)} />
              </Field>
            </div>
            <Field label="Responsible lawyer / file owner">
              <input className="input" value={contacts.responsibleLawyer} onChange={(e) => setC("responsibleLawyer", e.target.value)} />
            </Field>
          </section>

          <details className="card settings-section settings-section--collapsible">
            <summary className="settings-section__title">Clone this entity</summary>
            <p className="settings-section__hint">
              Copies role holders, addresses, share classes, name and constating history, filings and signers into a new entity.
            </p>
            <div className="settings-section__row settings-section__row--action">
              <Field label="New entity name">
                <input className="input" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
              </Field>
              <button
                className="btn"
                disabled={!cloneName.trim() || !canClone}
                onClick={async () => {
                  const r = (await cloneSociety({
                    sourceSocietyId: society._id,
                    newName: cloneName.trim(),
                    nowISO: new Date().toISOString(),
                  })) as { copiedRows?: number } | undefined;
                  setCloneResult(`Cloned (${r?.copiedRows ?? 0} records copied).`);
                  setCloneName("");
                  setTimeout(() => setCloneResult(null), 4000);
                }}
              >
                Clone
              </button>
            </div>
            {cloneResult && <p style={{ color: "var(--success)", margin: 0 }}>{cloneResult}</p>}
          </details>
        </div>

        <aside className="card settings-section settings-split__aside" aria-label="Deadlines from these settings">
          <div className="settings-section__head">
            <h2 className="settings-section__title">Deadlines from these settings</h2>
            <button className="btn btn--accent btn--sm" onClick={generate} disabled={generating || !canGenerate || pendingCount === 0}>
              {generating ? "Adding…" : pendingCount ? `Add ${pendingCount} ${pendingCount === 1 ? "deadline" : "deadlines"}` : "All added"}
            </button>
          </div>
          {derived.length === 0 ? (
            <p className="settings-section__hint">Set an {entity.annualMeeting} date or fiscal year end to see the deadlines they create.</p>
          ) : (
            <ul className="settings-deadlines">
              {derived.map((d) => (
                <li key={d.key} className="settings-deadlines__item">
                  <span className="settings-deadlines__date">{formatDate(d.dueDate)}</span>
                  <span className="settings-deadlines__title">
                    {d.title}
                    {d.status === "overdue" && <span className="settings-deadlines__added"> · overdue cycle</span>}
                    {d.status === "review_required" && <span className="settings-deadlines__added"> · evidence review needed</span>}
                    {alreadyTracked(d) && <span className="settings-deadlines__added"> · added</span>}
                  </span>
                  {d.basis ? <span className="settings-deadlines__basis">{d.basis}</span> : null}
                  {d.sourceIds?.map((id) => <CitationBadge key={id} citationId={id} />)}
                </li>
              ))}
            </ul>
          )}
          {historyNotices.length > 0 && <ul className="settings-deadlines" aria-label="Earlier cycles without evidence">
            {historyNotices.map((notice) => <li key={notice.key} className="settings-deadlines__item">
              <span className="settings-deadlines__date">Information</span><span className="settings-deadlines__title">{notice.title}</span>
              <span className="settings-deadlines__basis">{notice.basis}</span>{notice.sourceIds.map((id) => <CitationBadge key={id} citationId={id} />)}
            </li>)}
          </ul>}
        </aside>
      </div>
    </div>
  );
}

type Obligation = "annual_meeting" | "annual_return";
type CalendarDraft = { obligation: Obligation; cycleYear: number; nominalDueDate: string; reviewedDueDate: string; calendarBasis: string; evidenceRef: string; channel: string };
type WrittenDraft = { writtenResolutionId: string; kind: "written_annual_business" | "written_waiver"; completedOn: string; annualReferenceDate: string; financialYearEnd: string; annualBusinessEvidence: string; annualBusinessReviewed: boolean };

/**
 * Reviewed annual-deadline evidence: a holiday/office calendar review for one
 * calculated boundary, a written resolution that disposed of the annual
 * meeting's business, and the actual periods the Act-specific deadlines need.
 * Each entry is recorded by an authorized user with an activity-log entry.
 */
function AnnualDeadlineEvidence({ societyId, society, settings, today, canWrite, canReadResolutions, filingsAvailable }: {
  societyId: any;
  society: Record<string, any>;
  settings: ComplianceSettings;
  today: string;
  canWrite: boolean;
  canReadResolutions: boolean;
  filingsAvailable: boolean;
}) {
  const toast = useToast();
  const recordCalendar = useMutation(api.corporationSettings.recordAnnualDeadlineCalendarReview);
  const recordWritten = useMutation(api.corporationSettings.recordWrittenAnnualBusinessCompletion);
  const resolutions = useQuery(api.writtenResolutions.list, canReadResolutions ? { societyId } : "skip") as
    Array<{ _id: string; title: string; status: string; body?: string; completedAtISO?: string }> | undefined;
  const profile = legalGovernanceProfile(society);
  const entity = organizationVocabulary(society);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [writtenDraft, setWrittenDraft] = useState<WrittenDraft | null>(null);
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  const boundaries: Array<{ obligation: Obligation; label: string; assessment: DeadlineAssessment }> = [
    { obligation: "annual_meeting" as const, label: entity.annualMeetingTitle, assessment: assessAnnualMeetingDeadline(settings, today) },
    ...(filingsAvailable ? [{ obligation: "annual_return" as const, label: profile.annualReturn.label, assessment: assessAnnualReturnDeadline(settings, today) }] : []),
  ].filter(({ assessment }) => assessment.dueDate && assessment.cycleYear && assessment.calendarReviewStatus === "unreviewed" && assessment.status !== "satisfied" && assessment.status !== "not_applicable");
  const eligibleResolutions = (resolutions ?? []).filter((row) => row.status === "Carried" && row.body !== "directors" && row.completedAtISO);
  const recordedCompletions = (Array.isArray(society.annualMeetingCompletions) ? society.annualMeetingCompletions : []) as Array<{ date: string; kind: string; writtenResolutionId?: string }>;
  const recordedReviews = (Array.isArray(society.annualDeadlineCalendarReviews) ? society.annualDeadlineCalendarReviews : []) as Array<{ obligation: string; cycleYear: number; nominalDueDate: string; reviewedDueDate: string }>;
  const run = async (label: string, action: () => Promise<unknown>, done: () => void) => {
    if (!canWrite || busy) return;
    setBusy(true);
    try { await action(); toast.success(label); done(); }
    catch (error) { toast.error(`Could not save: ${label.toLowerCase()}`, error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card settings-section">
      <h2 className="settings-section__title">Annual deadline evidence</h2>
      <p className="settings-section__hint">
        A calendar review applies to one calculated boundary. Holiday and office-closure adjustments move an annual boundary by a few days at most; a boundary more than 7 days past without a review is reported as overdue.
      </p>
      {boundaries.map(({ obligation, label, assessment }) => (
        <div key={obligation} className="settings-section__fact">
          <span className="settings-section__fact-label">{label} {assessment.cycleYear}</span>
          <span>Nominal {formatDate(assessment.nominalDueDate ?? assessment.dueDate!)} · calendar not reviewed</span>
          <button type="button" className="link-button settings-section__fact-link" disabled={!canWrite}
            onClick={() => setCalendarDraft({ obligation, cycleYear: assessment.cycleYear!, nominalDueDate: assessment.nominalDueDate ?? assessment.dueDate!, reviewedDueDate: assessment.nominalDueDate ?? assessment.dueDate!, calendarBasis: "", evidenceRef: "", channel: "" })}>
            Record calendar review
          </button>
        </div>
      ))}
      {calendarDraft && (
        <div>
          <Field label="Reviewed deadline" hint={`Nominal boundary ${formatDate(calendarDraft.nominalDueDate)}. The reviewed date cannot be earlier.`}>
            <DatePicker value={calendarDraft.reviewedDueDate} onChange={(value) => setCalendarDraft({ ...calendarDraft, reviewedDueDate: value })} />
          </Field>
          <Field label="Calendar basis" hint="Interpretation statute, holiday calendar, locality and filing office reviewed.">
            <input className="input" value={calendarDraft.calendarBasis} onChange={(e) => setCalendarDraft({ ...calendarDraft, calendarBasis: e.target.value })} />
          </Field>
          <div className="settings-section__row">
            <Field label="Evidence reference"><input className="input" value={calendarDraft.evidenceRef} onChange={(e) => setCalendarDraft({ ...calendarDraft, evidenceRef: e.target.value })} /></Field>
            <Field label="Filing office or channel"><input className="input" value={calendarDraft.channel} onChange={(e) => setCalendarDraft({ ...calendarDraft, channel: e.target.value })} /></Field>
          </div>
          <div className="settings-section__row settings-section__row--action">
            <button type="button" className="btn" onClick={() => setCalendarDraft(null)}>Cancel</button>
            <button type="button" className="btn btn--accent" disabled={!canWrite || busy}
              onClick={() => run("Calendar review recorded", () => recordCalendar({ societyId, obligation: calendarDraft.obligation, cycleYear: calendarDraft.cycleYear, nominalDueDate: calendarDraft.nominalDueDate, reviewedDueDate: calendarDraft.reviewedDueDate, calendarBasis: calendarDraft.calendarBasis, evidenceRef: calendarDraft.evidenceRef, channel: calendarDraft.channel || undefined }), () => setCalendarDraft(null))}>
              Save review
            </button>
          </div>
        </div>
      )}
      {recordedReviews.length > 0 && (
        <p className="settings-section__hint">
          Reviewed boundaries: {recordedReviews.map((item) => `${item.cycleYear} ${item.obligation === "annual_meeting" ? entity.annualMeeting : "annual return"} ${item.nominalDueDate} → ${item.reviewedDueDate}`).join("; ")}.
        </p>
      )}

      <h3 className="settings-section__title">Annual business completed in writing</h3>
      <p className="settings-section__hint">{profile.annualMeeting.writtenAlternative} Link the carried resolution; a reviewer confirms it disposed of all required annual business.</p>
      {!canReadResolutions ? (
        <p className="settings-section__hint">Written resolutions are not available with your permissions.</p>
      ) : !writtenDraft ? (
        <button type="button" className="btn btn--sm" disabled={!canWrite || eligibleResolutions.length === 0}
          onClick={() => setWrittenDraft({ writtenResolutionId: eligibleResolutions[0]?._id ?? "", kind: "written_annual_business", completedOn: String(eligibleResolutions[0]?.completedAtISO ?? "").slice(0, 10), annualReferenceDate: "", financialYearEnd: "", annualBusinessEvidence: "", annualBusinessReviewed: false })}>
          {eligibleResolutions.length ? "Record written annual business" : `No carried ${entity.isCorporation ? "shareholder" : entity.isSociety ? "member" : "member or shareholder"} resolution`}
        </button>
      ) : (
        <div>
          <Field label="Written resolution">
            <Select value={writtenDraft.writtenResolutionId}
              onChange={(value) => setWrittenDraft({ ...writtenDraft, writtenResolutionId: value, completedOn: String(eligibleResolutions.find((row) => row._id === value)?.completedAtISO ?? "").slice(0, 10) })}
              options={eligibleResolutions.map((row) => ({ value: row._id, label: `${row.title} (${String(row.completedAtISO).slice(0, 10)})` }))} />
          </Field>
          {profile.id === "bc_company" && (
            <Field label="Kind">
              <Select value={writtenDraft.kind} onChange={(value) => setWrittenDraft({ ...writtenDraft, kind: value as WrittenDraft["kind"] })}
                options={[{ value: "written_annual_business", label: "Consent to all annual business" }, { value: "written_waiver", label: "Unanimous waiver of the meeting" }]} />
            </Field>
          )}
          <div className="settings-section__row settings-section__row--pair">
            <Field label="Effective date"><DatePicker value={writtenDraft.completedOn} onChange={(value) => setWrittenDraft({ ...writtenDraft, completedOn: value })} /></Field>
            {profile.id === "bc_company" ? (
              <Field label="Annual reference date (required)"><DatePicker value={writtenDraft.annualReferenceDate} onChange={(value) => setWrittenDraft({ ...writtenDraft, annualReferenceDate: value })} /></Field>
            ) : profile.annualMeeting.afterFiscalYearEndMonths ? (
              <Field label="Financial year-end dealt with"><DatePicker value={writtenDraft.financialYearEnd} onChange={(value) => setWrittenDraft({ ...writtenDraft, financialYearEnd: value })} /></Field>
            ) : null}
          </div>
          <Field label="Annual business evidence" hint="How the resolution dealt with financial statements, director elections, auditor matters and any required written statements.">
            <input className="input" value={writtenDraft.annualBusinessEvidence} onChange={(e) => setWrittenDraft({ ...writtenDraft, annualBusinessEvidence: e.target.value })} />
          </Field>
          <Checkbox checked={writtenDraft.annualBusinessReviewed} onChange={(checked) => setWrittenDraft({ ...writtenDraft, annualBusinessReviewed: checked })}
            label="I reviewed that this resolution disposed of all required annual business under the governing Act" />
          <div className="settings-section__row settings-section__row--action">
            <button type="button" className="btn" onClick={() => setWrittenDraft(null)}>Cancel</button>
            <button type="button" className="btn btn--accent" disabled={!canWrite || busy || !writtenDraft.writtenResolutionId}
              onClick={() => run("Annual business completion recorded", () => recordWritten({ societyId, writtenResolutionId: writtenDraft.writtenResolutionId as any, kind: writtenDraft.kind, completedOn: writtenDraft.completedOn, annualReferenceDate: writtenDraft.annualReferenceDate || undefined, financialYearEnd: writtenDraft.financialYearEnd || undefined, annualBusinessEvidence: writtenDraft.annualBusinessEvidence, annualBusinessReviewed: writtenDraft.annualBusinessReviewed }), () => setWrittenDraft(null))}>
              Save completion
            </button>
          </div>
        </div>
      )}
      {recordedCompletions.some((item) => item.kind !== "held") && <p className="settings-section__hint">
        Recorded written completions: {recordedCompletions.filter((item) => item.kind !== "held").map((item) => formatDate(item.date)).join(", ")}.</p>}

      <AnnualPeriods society={society} canWrite={canWrite} />
    </section>
  );
}

/** Actual periods for the CBCA six-month meeting limit and the Ontario return. */
function AnnualPeriods({ society, canWrite }: { society: Record<string, any>; canWrite: boolean }) {
  const toast = useToast();
  const updatePeriods = useMutation(api.corporationSettings.updateAnnualEvidenceSettings);
  const profile = legalGovernanceProfile(society);
  const [periods, setPeriods] = useState({ annualMeetingFinancialYearEnd: society.annualMeetingFinancialYearEnd ?? "", annualReturnPeriodEnd: society.annualReturnPeriodEnd ?? "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPeriods({ annualMeetingFinancialYearEnd: society.annualMeetingFinancialYearEnd ?? "", annualReturnPeriodEnd: society.annualReturnPeriodEnd ?? "" });
  }, [society._id, society.annualMeetingFinancialYearEnd, society.annualReturnPeriodEnd]);
  const meetingPeriod = Boolean(profile?.annualMeeting.afterFiscalYearEndMonths), returnPeriod = profile?.annualReturn.anchor === "fiscal_year_end";
  if (!meetingPeriod && !returnPeriod) return null;
  const save = async () => {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      await updatePeriods({ societyId: society._id,
        ...(meetingPeriod ? { annualMeetingFinancialYearEnd: periods.annualMeetingFinancialYearEnd || null } : {}),
        ...(returnPeriod ? { annualReturnPeriodEnd: periods.annualReturnPeriodEnd || null } : {}) });
      toast.success("Annual periods saved");
    } catch (error) { toast.error("Could not save annual periods", error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <h3 className="settings-section__title">Actual periods</h3>
      <div className="settings-section__row settings-section__row--pair">
        {meetingPeriod && (
          <Field label="Financial year-end for the next annual meeting" hint="The actual period the next meeting must deal with, when the fiscal calendar changed.">
            <DatePicker value={periods.annualMeetingFinancialYearEnd} onChange={(value) => setPeriods({ ...periods, annualMeetingFinancialYearEnd: value })} />
          </Field>
        )}
        {returnPeriod && (
          <Field label="Taxation-year end to assess" hint="Pins the annual-return assessment to this actual period. Clear it to follow the fiscal calendar.">
            <DatePicker value={periods.annualReturnPeriodEnd} onChange={(value) => setPeriods({ ...periods, annualReturnPeriodEnd: value })} />
          </Field>
        )}
      </div>
      <button type="button" className="btn btn--sm" disabled={!canWrite || busy} onClick={save}>Save periods</button>
    </>
  );
}
