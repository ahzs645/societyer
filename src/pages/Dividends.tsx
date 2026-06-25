import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Plus, Coins, Trash2 } from "lucide-react";

/**
 * Dividend declarations register (corporations track). Lists each declaration
 * with per-share amount, shares outstanding and computed total, plus a
 * "totals by class" summary. The New-declaration drawer captures the inputs;
 * total/currency totals are computed server-side.
 */
export function DividendsPage() {
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
    await create({
      societyId: society._id,
      declaredOn: form.declaredOn,
      shareClass: form.shareClass,
      perShareCents: Number(form.perShareCents),
      sharesOutstanding: Number(form.sharesOutstanding),
      currency: form.currency,
      notes: form.notes || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
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
          <button className="btn-action btn-action--primary" onClick={openNew}>
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
                      onClick={() => remove({ id: r._id })}
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
            <button className="btn btn--accent" onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Declared on">
              <input
                className="input"
                type="date"
                value={form.declaredOn}
                onChange={(e) => setForm({ ...form, declaredOn: e.target.value })}
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
