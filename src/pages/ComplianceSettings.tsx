import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { CalendarClock } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Field } from "../components/ui";
import {
  deriveComplianceDeadlines,
  type ComplianceSettings,
  type DerivedDeadline,
} from "../../shared/corporationSettings";

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
  const save = useMutation(api.society.updateComplianceSettings);
  const createDeadline = useMutation(api.deadlines.create);
  const cloneSociety = useMutation(api.society.cloneSociety);
  const [cloneName, setCloneName] = useState("");
  const [cloneResult, setCloneResult] = useState<string | null>(null);
  const existing = useQuery(
    api.deadlines.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<{ title?: string; dueDate?: string }> | undefined;

  const [agmMonth, setAgmMonth] = useState<number | "">(society?.agmMonth ?? "");
  const [agmDay, setAgmDay] = useState<number | "">(society?.agmDay ?? "");
  const [waive, setWaive] = useState<boolean>(Boolean(society?.waivePrepFinancials));
  const [restrictPeople, setRestrictPeople] = useState<boolean>(Boolean(society?.restrictPeoplePicker));
  const [docIdHeader, setDocIdHeader] = useState<boolean>(Boolean(society?.includeDocumentIdHeader));
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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const settings: ComplianceSettings = {
    agmMonth: agmMonth === "" ? undefined : Number(agmMonth),
    agmDay: agmDay === "" ? undefined : Number(agmDay),
    fiscalYearEnd: society.fiscalYearEnd ?? undefined,
    incorporationDate: society.incorporationDate ?? undefined,
    anniversaryDate: society.anniversaryDate ?? undefined,
    waivePrepFinancials: waive,
  };
  const today = new Date().toISOString().slice(0, 10);
  const derived: DerivedDeadline[] = deriveComplianceDeadlines(settings, today);

  const onSave = async () => {
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
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const existingTitles = new Set((existing ?? []).map((d) => d.title));
  const generate = async () => {
    for (const d of derived) {
      if (existingTitles.has(d.title)) continue;
      await createDeadline({
        societyId: society._id,
        title: d.title,
        dueDate: d.dueDate,
        category: d.category,
      });
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Compliance settings"
        icon={<CalendarClock size={16} />}
        iconColor="orange"
        subtitle="AGM date and fiscal year-end drive your annual compliance deadlines. Set them once, then generate the deadlines."
        actions={
          <button className="btn-action btn-action--primary" onClick={onSave}>
            {saved ? "Saved ✓" : "Save settings"}
          </button>
        }
      />

      <div className="card" style={{ maxWidth: 520, marginBottom: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <Field label="AGM month">
            <select className="input" value={agmMonth} onChange={(e) => setAgmMonth(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">—</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="AGM day">
            <input className="input" type="number" min={1} max={31} value={agmDay}
              onChange={(e) => setAgmDay(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Fiscal year-end">
          <input className="input" value={society.fiscalYearEnd ?? "(not set on society)"} disabled />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
          {" "}Waive preparation of financial statements (skips the annual-report deadline)
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
      </div>

      <div className="card" style={{ maxWidth: 520, marginBottom: 16 }}>
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
            disabled={!cloneName.trim()}
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

      <div className="card" style={{ maxWidth: 520, marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Contacts &amp; records</h3>
        <Field label="Short name / defined term (e.g. &quot;the Company&quot;)">
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
          <button className="btn btn--accent" onClick={generate} disabled={derived.length === 0}>
            Generate {derived.length || ""}
          </button>
        </div>
        {derived.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>Set an AGM date and/or fiscal year-end to derive deadlines.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {derived.map((d) => (
              <li key={d.key}>
                <strong>{d.dueDate}</strong> — {d.title}{" "}
                <span style={{ color: "var(--text-tertiary)" }}>({d.category})</span>
                {existingTitles.has(d.title) ? <span style={{ color: "var(--text-tertiary)" }}> · already added</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ComplianceSettingsPage;
