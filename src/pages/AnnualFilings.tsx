import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Plus, CalendarCheck, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { annualFilingKind } from "../../shared/annualFilings";

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
  sourceFilingId?: string;
  sourceMissing?: boolean;
};

export function AnnualFilingsPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("filings:write");
  const items = useQuery(
    api.annualFilings.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<Filing> | undefined;
  const jurisdictions = useQuery(
    api.annualFilings.jurisdictions,
    society ? { societyId: society._id } : "skip",
  ) as Array<string> | undefined;
  const detailed = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.annualFilings.upsert);
  const remove = useMutation(api.annualFilings.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canEdit) return;
    setForm({
      id: undefined,
      jurisdiction: "",
      year: "",
      filed: false,
      filedOn: "",
      regnNature: "",
      regnLegislation: "",
      sourceFilingId: "",
    });
    setOpen(true);
  };

  const openEdit = (r: Filing) => {
    if (!canEdit) return;
    setForm({
      id: r._id,
      jurisdiction: r.jurisdiction,
      year: r.year,
      filed: r.filed,
      filedOn: r.filedOn ?? "",
      regnNature: r.regnNature ?? "",
      regnLegislation: r.regnLegislation ?? "",
      sourceFilingId: r.sourceFilingId ?? "",
      sourceMissing: r.sourceMissing,
    });
    setOpen(true);
  };

  const save = async () => {
    if (saving || !canEdit) return;
    if (!form.jurisdiction.trim() || !/^[1-9]\d{3}$/.test(form.year.trim())) {
      toast.error("Enter a jurisdiction and a four-digit filing year.");
      return;
    }
    if (form.filed && !form.filedOn) {
      toast.error("Add the filed-on date before marking this filing as filed.");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        id: form.id || undefined,
        societyId: society._id,
        jurisdiction: form.jurisdiction.trim(),
        year: form.year.trim(),
        filed: !!form.filed,
        filedOn: form.filedOn || undefined,
        regnNature: form.regnNature || undefined,
        regnLegislation: form.regnLegislation || undefined,
        sourceFilingId: form.sourceFilingId || undefined,
        nowISO: new Date().toISOString(),
      });
      setOpen(false);
      toast.success("Annual filing saved");
    } catch (error: any) {
      toast.error("Could not save annual filing", error?.message ?? String(error));
    } finally { setSaving(false); }
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
      .filter((y) => Number.isInteger(y) && y >= 1000 && y <= 9999);
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
          <button className="btn-action btn-action--primary" disabled={!canEdit} onClick={openNew}>
            <Plus size={12} /> Add filing
          </button>
        }
      />

      <p className="muted">
        A simplified per-jurisdiction, per-year filing ledger. For detailed filing records with
        evidence and receipts, see <Link to="/app/filings">Filings</Link>. Link a detailed annual record
        to use its current status here. Manual entries and linked records are self-reported; neither verifies government acceptance.
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
                <div className="table-scroll" role="region" aria-label={`${j} annual filing records`} tabIndex={0}>
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
                        style={{ cursor: canEdit ? "pointer" : "default" }}
                      >
                        <td>{r.year}</td>
                        <td>{r.filed ? "✓" : "✗"}{r.sourceFilingId && <div className="muted">{r.sourceMissing ? "Linked record unavailable" : "Linked record"}</div>}</td>
                        <td>{r.filedOn ?? "—"}</td>
                        <td>
                          <button
                            className="btn btn--ghost btn--sm btn--icon"
                            aria-label={`Delete ${r.jurisdiction} ${r.year} filing`}
                            disabled={!canEdit}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canEdit && r._id) remove({ id: r._id }).catch((error: any) => toast.error("Could not delete annual filing", error?.message ?? String(error)));
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
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
            <button className="btn btn--accent" onClick={save} disabled={saving || !canEdit}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form && (
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <Field label="Detailed annual filing" hint="Select an annual record whose period is a four-digit year. Its status and date remain controlled in Filings.">
              <select className="input" value={form.sourceFilingId ?? ""} onChange={e => {
                const source = detailed?.find(row => row._id === e.target.value);
                setForm({ ...form, sourceFilingId: e.target.value,
                  ...(source ? { jurisdiction: source.jurisdictionCode ?? society.jurisdictionCode ?? "", year: source.periodLabel ?? "",
                    filed: source.status === "Filed", filedOn: source.status === "Filed" ? source.filedAt ?? "" : "" } : {}) });
              }}>
                <option value="">Manual ledger entry</option>
                {form.sourceMissing && <option value={form.sourceFilingId}>Linked record unavailable</option>}
                {(detailed ?? []).filter(row => annualFilingKind(row.kind) && /^[1-9]\d{3}$/.test(row.periodLabel ?? "") && row.jurisdictionCode).map(row =>
                  <option key={row._id} value={row._id}>{row.kind} · {row.jurisdictionCode} · {row.periodLabel} · {row.status}</option>)}
              </select>
            </Field>
            <Field label="Jurisdiction">
              <input
                className="input"
                disabled={!!form.sourceFilingId}
                value={form.jurisdiction}
                onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
              />
            </Field>
            <Field label="Year">
              <input
                className="input"
                disabled={!!form.sourceFilingId}
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
                  disabled={!!form.sourceFilingId}
                  checked={!!form.filed}
                  onChange={(e) => setForm({ ...form, filed: e.target.checked })}
                />
                <span>Marked as filed</span>
              </label>
            </Field>
            <Field label="Filed on">
              <DatePicker
                disabled={!!form.sourceFilingId}
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
          </fieldset>
        )}
      </Drawer>
    </div>
  );
}

export default AnnualFilingsPage;
