import { useEffect, useState } from "react";
import { calendarDateKey } from "../lib/calendarDates";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { CalendarClock } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Field } from "../components/ui";
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
  const derived: DerivedDeadline[] = deriveComplianceDeadlines(settings, today);

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

  return (
    <div className="page">
      <PageHeader
        title="Compliance settings"
        icon={<CalendarClock size={16} />}
        iconColor="orange"
        subtitle="AGM date and fiscal year-end drive your annual compliance deadlines. Set them once, then generate the deadlines."
        actions={
          <button className="btn-action btn-action--primary" onClick={onSave} disabled={saving || !canSaveSettings}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
          </button>
        }
      />

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="row" style={{ gap: 12 }}>
          <Field label="AGM month">
            <Select value={String(agmMonth)} onChange={(value) => setAgmMonth(value === "" ? "" : Number(value))}
              options={[{ value: "", label: "—" }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
          </Field>
          <Field label="AGM day">
            <input className="input" type="number" min={1} max={31} value={agmDay}
              onChange={(e) => setAgmDay(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
        </div>
        {lastAgmDay && (agmMonth === "" || agmDay === "") && (
          <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: -8 }}>
            Last AGM was held {formatDate(agmFacts.annualMeetingDate!)}.{" "}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ display: "inline", padding: 0, height: "auto" }}
              onClick={() => {
                setAgmMonth(lastAgmDay.month);
                setAgmDay(lastAgmDay.day);
              }}
            >
              Use this date
            </button>
          </p>
        )}
        <Field label="Fiscal year-end">
          <input className="input" value={society.fiscalYearEnd ?? "(not set on society)"} disabled />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
          {" "}Record a financial-statement preparation waiver for review (does not waive registry filings)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={restrictPeople} onChange={(e) => setRestrictPeople(e.target.checked)} />
          {" "}Restrict people to the directory (directors, officers, and signers must
          resolve to a People Directory record — no free-text entry)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={docIdHeader} onChange={(e) => setDocIdHeader(e.target.checked)} />
          {" "}Stamp a document ID at the top of generated documents
        </label>
        <Field label="Document language">
          <Select value={docLanguage} onChange={(value) => setDocLanguage(value)}
            options={[{ value: "", label: "English (default)" }, { value: "French", label: "French — résolutions in French (execution block + dates)" }]} />
        </Field>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h3 style={{ margin: "0 0 8px" }}>Clone this entity</h3>
        <p style={{ color: "var(--text-tertiary)", marginTop: 0 }}>
          Deep-copy this entity's registers (role holders, addresses, share classes,
          name/constating history, filings, signers) into a new entity.
        </p>
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <Field label="New entity name">
            <input className="input" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
          </Field>
          <button
            className="btn btn--accent"
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
        {cloneResult && <p style={{ color: "var(--accent, green)" }}>{cloneResult}</p>}
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h3 style={{ margin: "0 0 8px" }}>Contacts &amp; records</h3>
        <Field label="Short name / defined term (e.g. &quot;the Society&quot;)">
          <input className="input" value={contacts.shortName} onChange={(e) => setC("shortName", e.target.value)} />
        </Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Primary contact name">
            <input className="input" value={contacts.primaryContactName} onChange={(e) => setC("primaryContactName", e.target.value)} />
          </Field>
          <Field label="Primary contact email">
            <input className="input" value={contacts.primaryContactEmail} onChange={(e) => setC("primaryContactEmail", e.target.value)} />
          </Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
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
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Derived deadlines</h3>
          <button className="btn btn--accent" onClick={generate} disabled={generating || !canGenerate || derived.length === 0}>
            Generate {derived.length || ""}
          </button>
        </div>
        {derived.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>Set an AGM date and/or fiscal year-end to derive deadlines.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {derived.map((d) => (
              <li key={d.key}>
                <strong>{formatDate(d.dueDate)}</strong> — {d.title}{" "}
                <span style={{ color: "var(--text-tertiary)" }}>({d.deadlineCategory})</span>
                {d.basis ? <div style={{ color: "var(--text-tertiary)", fontSize: "var(--fs-sm)" }}>{d.basis}</div> : null}
                {existingKeys.has(deadlineKey(d)) ? <span style={{ color: "var(--text-tertiary)" }}> · already added</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ComplianceSettingsPage;
