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
  const existing = useQuery(
    api.deadlines.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<{ title?: string; dueDate?: string }> | undefined;

  const [agmMonth, setAgmMonth] = useState<number | "">(society?.agmMonth ?? "");
  const [agmDay, setAgmDay] = useState<number | "">(society?.agmDay ?? "");
  const [waive, setWaive] = useState<boolean>(Boolean(society?.waivePrepFinancials));
  const [saved, setSaved] = useState(false);

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
