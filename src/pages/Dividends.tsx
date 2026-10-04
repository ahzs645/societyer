import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Plus, Coins, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { validateDividend } from "../../shared/dividends";

/**
 * Dividend declarations register (corporations track). Lists each declaration
 * with per-share amount, shares outstanding and computed total, plus a
 * "totals by class" summary. The New-declaration drawer captures the inputs;
 * total/currency totals are computed server-side.
 */
export function DividendsPage() {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const items = useQuery(
    api.dividends.list,
    society ? { societyId: society._id } : "skip",
  ) as
    | Array<{
        _id: string;
        declaredOn: string;
        shareClass: string;
        perShareCents: number;
        sharesOutstanding: number;
        currency: string;
        totalCents: number;
        notes?: string;
      }>
    | undefined;
  const summary = useQuery(
    api.dividends.summary,
    society ? { societyId: society._id } : "skip",
  ) as { byClass: Record<string, number>; byCurrency: Record<string, number> } | undefined;
  const create = useMutation(api.dividends.create);
  const remove = useMutation(api.dividends.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const money = (cents: number, currency = "CAD") =>
    (cents / 100).toLocaleString(undefined, { style: "currency", currency });

  const openNew = () => {
    setForm({
      declaredOn: new Date().toISOString().slice(0, 10),
      shareClass: "",
      perShareCents: "",
      sharesOutstanding: "",
      currency: "CAD",
      notes: "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (saving) return;
    const declaration = {
      declaredOn: form.declaredOn,
      shareClass: form.shareClass.trim(),
      perShareCents: Number(form.perShareCents),
      sharesOutstanding: Number(form.sharesOutstanding),
      currency: form.currency.trim().toUpperCase(),
    };
    if (!declaration.shareClass || !form.perShareCents.trim() || !form.sharesOutstanding.trim()) {
      toast.error("Enter the share class, per-share amount and shares outstanding.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(declaration.currency)) {
      toast.error("Enter a three-letter currency code, such as CAD or USD.");
      return;
    }
    const validation = validateDividend(declaration);
    if (!validation.ok) {
      toast.error("Check the dividend declaration", validation.errors.join(" "));
      return;
    }
    setSaving(true);
    try {
      await create({ societyId: society._id, ...declaration, notes: form.notes || undefined, nowISO: new Date().toISOString() });
      setOpen(false);
      toast.success("Dividend declaration saved");
    } catch (error: any) {
      toast.error("Could not save the dividend declaration", error?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const rows = items;
  const byClass = summary?.byClass ?? {};

  return (
    <div className="page">
      <PageHeader
        title="Dividend declarations"
        icon={<Coins size={16} />}
        iconColor="yellow"
        subtitle="Register of declared dividends by share class — per-share amount, shares outstanding and the total payable."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
            <Plus size={12} /> New declaration
          </button>
        }
      />

      {Object.keys(byClass).length > 0 && (
        <p style={{ color: "var(--text-secondary)" }}>
          Totals by class:{" "}
          {Object.entries(byClass)
            .map(([cls, cents]) => `${cls} ${money(cents)}`)
            .join(" · ")}
        </p>
      )}

      <div className="card">
        {rows === undefined ? (
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>No dividend declarations yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Declared on</th>
                <th>Share class</th>
                <th>Per share</th>
                <th>Shares</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r._id}>
                  <td>{r.declaredOn}</td>
                  <td>{r.shareClass}</td>
                  <td>{money(r.perShareCents, r.currency)}</td>
                  <td>{r.sharesOutstanding.toLocaleString()}</td>
                  <td>{money(r.totalCents, r.currency)}</td>
                  <td>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Delete dividend declared ${r.declaredOn}`}
                      onClick={() => remove({ id: r._id })} disabled={!canWrite}
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

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New dividend declaration"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save} disabled={!canWrite || (saving)}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Declared on">
              <DatePicker
                value={form.declaredOn}
                onChange={(value) => setForm({ ...form, declaredOn: value })}
              />
            </Field>
            <Field label="Share class">
              <input
                className="input"
                value={form.shareClass}
                onChange={(e) => setForm({ ...form, shareClass: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Per-share amount (cents)">
                <input
                  className="input"
                  type="number"
                  value={form.perShareCents}
                  onChange={(e) => setForm({ ...form, perShareCents: e.target.value })}
                />
              </Field>
              <Field label="Shares outstanding">
                <input
                  className="input"
                  type="number"
                  value={form.sharesOutstanding}
                  onChange={(e) => setForm({ ...form, sharesOutstanding: e.target.value })}
                />
              </Field>
              <Field label="Currency">
                <input
                  className="input"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Notes">
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default DividendsPage;
