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
import {
  deriveComplianceDeadlines,
  type ComplianceSettings,
  type DerivedDeadline,
} from "../../shared/corporationSettings";
import { deriveAgmFacts } from "../../shared/agmEvidence";
import { formatDate } from "../lib/format";
import { todayDateOnly } from "../../shared/dateOnly";

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
  ) as Array<{ title?: string; dueDate?: string }> | undefined;
  const meetings = useQuery(
    api.meetings.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<{ type?: string; status?: string; scheduledAt?: string }> | undefined;
  const todayISO = calendarDateKey(new Date());
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
    agmMonth: agmMonth === "" ? undefined : Number(agmMonth),
    agmDay: agmDay === "" ? undefined : Number(agmDay),
    fiscalYearEnd: society.fiscalYearEnd ?? undefined,
    incorporationDate: society.incorporationDate ?? undefined,
    anniversaryDate: society.anniversaryDate ?? undefined,
    waivePrepFinancials: waive,
    jurisdictionCode: society.jurisdictionCode,
    entityType: society.entityType,
    annualMeetingDate: agmFacts.annualMeetingDate,
    heldAgmYears: agmFacts.agmYears,
  };
  const today = todayDateOnly();
  // Deadlines anchored to an old AGM can land well in the past; a list of
  // "deadlines from these settings" should not offer to add those.
  const staleCutoff = shiftDateOnly(today, -30);
  const derived: DerivedDeadline[] = deriveComplianceDeadlines(settings, today).filter((d) => !d.dueDate || d.dueDate >= staleCutoff);

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

  const deadlineKey = (d: { title?: string; dueDate?: string }) => `${d.title}::${d.dueDate}`;
  const existingKeys = new Set((existing ?? []).map(deadlineKey));
  const generate = async () => {
    if (!canGenerate || generating) return;
    setGenerating(true);
    try {
      let added = 0;
      for (const d of derived) {
        if (existingKeys.has(deadlineKey(d))) continue;
        await createDeadline({ societyId: society._id, title: d.title, dueDate: d.dueDate, category: d.deadlineCategory, description: d.basis });
        added += 1;
      }
      toast.success("Deadlines generated", `${added} new dates added.`);
    } catch (error) { toast.error("Could not generate deadlines", error instanceof Error ? error.message : String(error)); }
    finally { setGenerating(false); }
  };

  const pendingCount = derived.filter((d) => !existingKeys.has(deadlineKey(d))).length;

  return (
    <div className="page">
      <PageHeader
        title="Compliance settings"
        icon={<CalendarClock size={16} />}
        iconColor="orange"
        subtitle="Your AGM date and fiscal year end set the annual deadlines."
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
              <Field label="AGM month">
                <Select value={String(agmMonth)} onChange={(value) => setAgmMonth(value === "" ? "" : Number(value))}
                  options={[{ value: "", label: "Not set" }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
              </Field>
              <Field label="AGM day">
                <input className="input" type="number" inputMode="numeric" min={1} max={31} value={agmDay}
                  onChange={(e) => setAgmDay(e.target.value === "" ? "" : Number(e.target.value))} />
              </Field>
            </div>
            {lastAgmDay && (agmMonth === "" || agmDay === "") && (
              <p className="settings-section__hint">
                Last AGM was {formatDate(agmFacts.annualMeetingDate!)}.{" "}
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
            <Checkbox
              checked={waive}
              onChange={setWaive}
              label="Financial-statement preparation waiver"
              hint="Recorded for review. It doesn't waive registry filings."
            />
          </section>

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
            <Field label="Short name" hint={'Defined term, e.g. "the Society"'}>
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
            <p className="settings-section__hint">Set an AGM date or fiscal year end to see the deadlines they create.</p>
          ) : (
            <ul className="settings-deadlines">
              {derived.map((d) => (
                <li key={d.key} className="settings-deadlines__item">
                  <span className="settings-deadlines__date">{formatDate(d.dueDate)}</span>
                  <span className="settings-deadlines__title">
                    {d.title}
                    {existingKeys.has(deadlineKey(d)) && <span className="settings-deadlines__added"> · added</span>}
                  </span>
                  {d.basis ? <span className="settings-deadlines__basis">{d.basis}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function shiftDateOnly(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default ComplianceSettingsPage;
