import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Plus, CalendarCheck, Trash2 } from "lucide-react";

/**
 * Annual Filings — per-year, per-jurisdiction annual-filing ledger. Lists each
 * tracked filing grouped by jurisdiction, showing whether it has been filed and
 * the filed-on date. Clicking a row opens the drawer pre-filled to edit; the
 * header action opens an empty drawer to add a filing. A small "outstanding"
 * hint flags years between the min and max tracked year that have no filed row.
 */
type Filing = {
  _id?: string;
  jurisdiction: string;
  year: string;
  filed: boolean;
  filedOn?: string;
  regnNature?: string;
  regnLegislation?: string;
};

export function AnnualFilingsPage() {
  const society = useSociety();
  const items = useQuery(
    api.annualFilings.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<Filing> | undefined;
  const jurisdictions = useQuery(
    api.annualFilings.jurisdictions,
    society ? { societyId: society._id } : "skip",
  ) as Array<string> | undefined;
  const upsert = useMutation(api.annualFilings.upsert);
  const remove = useMutation(api.annualFilings.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      id: undefined,
      jurisdiction: "",
      year: "",
      filed: false,
      filedOn: "",
      regnNature: "",
      regnLegislation: "",
    });
    setOpen(true);
  };

  const openEdit = (r: Filing) => {
    setForm({
      id: r._id,
      jurisdiction: r.jurisdiction,
      year: r.year,
      filed: r.filed,
      filedOn: r.filedOn ?? "",
      regnNature: r.regnNature ?? "",
      regnLegislation: r.regnLegislation ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    await upsert({
      id: form.id || undefined,
      societyId: society._id,
      jurisdiction: form.jurisdiction,
      year: form.year,
      filed: !!form.filed,
      filedOn: form.filedOn || undefined,
      regnNature: form.regnNature || undefined,
      regnLegislation: form.regnLegislation || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
  };

  const rows = items;
  const juris = jurisdictions;

  // Compute outstanding years per jurisdiction: years between the min and max
  // tracked year that have no filed=true row.
  const outstandingFor = (j: string): number[] => {
    if (!rows) return [];
    const forJuris = rows.filter((r) => r.jurisdiction === j);
    const years = forJuris
      .map((r) => Number(r.year))
      .filter((y) => Number.isFinite(y));
    if (years.length === 0) return [];
    const min = Math.min(...years);
    const max = Math.max(...years);
    const filedYears = new Set(
      forJuris.filter((r) => r.filed).map((r) => Number(r.year)),
    );
    const out: number[] = [];
    for (let y = min; y <= max; y++) {
      if (!filedYears.has(y)) out.push(y);
    }
    return out;
  };

  return (
    <div className="page">
      <PageHeader
        title="Annual filings"
        icon={<CalendarCheck size={16} />}
        iconColor="green"
        subtitle="Per-year, per-jurisdiction annual-filing ledger — track which annual filings have been filed and when."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Add filing
          </button>
        }
      />

      <p className="muted">
        A simplified per-jurisdiction, per-year filing ledger. For detailed filing records with
        evidence and receipts, see <Link to="/app/filings">Filings</Link>.
      </p>

      {rows === undefined || juris === undefined ? (
        <div className="card">
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        </div>
      ) : juris.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--text-tertiary)" }}>No annual filings tracked yet.</p>
        </div>
      ) : (
        juris.map((j) => {
          const jurisRows = rows
            .filter((r) => r.jurisdiction === j)
            .slice()
            .sort((a, b) => Number(b.year) - Number(a.year));
          const outstanding = outstandingFor(j);
          return (
            <div className="card" key={j}>
              <h3 style={{ margin: "0 0 8px" }}>{j}</h3>
              {outstanding.length > 0 && (
                <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                  Outstanding: {outstanding.join(", ")}
                </p>
              )}
              {jurisRows.length === 0 ? (
                <p style={{ color: "var(--text-tertiary)" }}>No filings tracked.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Filed</th>
                      <th>Filed on</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jurisRows.map((r) => (
                      <tr
                        key={r._id ?? `${r.jurisdiction}-${r.year}`}
                        onClick={() => openEdit(r)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{r.year}</td>
                        <td>{r.filed ? "✓" : "✗"}</td>
                        <td>{r.filedOn ?? "—"}</td>
                        <td>
                          <button
                            className="btn btn--ghost btn--sm btn--icon"
                            aria-label={`Delete ${r.jurisdiction} ${r.year} filing`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (r._id) remove({ id: r._id });
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={form?.id ? "Edit filing" : "Add filing"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Jurisdiction">
              <input
                className="input"
                value={form.jurisdiction}
                onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
              />
            </Field>
            <Field label="Year">
              <input
                className="input"
                placeholder="2026"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </Field>
            <Field label="Filed">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={!!form.filed}
                  onChange={(e) => setForm({ ...form, filed: e.target.checked })}
                />
                <span>Marked as filed</span>
              </label>
            </Field>
            <Field label="Filed on">
              <DatePicker
                value={form.filedOn}
                onChange={(value) => setForm({ ...form, filedOn: value })}
              />
            </Field>
            <Field label="Registration nature">
              <input
                className="input"
                value={form.regnNature}
                onChange={(e) => setForm({ ...form, regnNature: e.target.value })}
              />
            </Field>
            <Field label="Registration legislation">
              <input
                className="input"
                value={form.regnLegislation}
                onChange={(e) => setForm({ ...form, regnLegislation: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default AnnualFilingsPage;
