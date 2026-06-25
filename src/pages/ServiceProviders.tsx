import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Briefcase, Plus } from "lucide-react";

/**
 * External service-provider register — lawyers, accountants, bankers and the
 * like. A row with no removedOn (or a removedOn in the future) is still
 * active. The "Show active only (today)" toggle filters client-side, so it
 * works without the activeAsOf query.
 */
export function ServiceProvidersPage() {
  const society = useSociety();
  const items = useQuery(
    api.serviceProviders.list,
    society ? { societyId: society._id } : "skip",
  ) as
    | Array<{
        _id: string;
        function: string;
        firmName: string;
        contactName?: string;
        firmLocation?: string;
        appointedOn?: string;
        removedOn?: string;
      }>
    | undefined;
  const catalog = useQuery(api.serviceProviders.functionsCatalog, {}) as
    | Array<{ value: string; label: string }>
    | undefined;
  const upsert = useMutation(api.serviceProviders.upsert);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const today = new Date().toISOString().slice(0, 10);

  const openNew = () => {
    setForm({
      function: catalog?.[0]?.value ?? "",
      firmName: "",
      contactName: "",
      firmLocation: "",
      appointedOn: today,
      removedOn: "",
    });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setForm({
      id: row._id,
      function: row.function ?? "",
      firmName: row.firmName ?? "",
      contactName: row.contactName ?? "",
      firmLocation: row.firmLocation ?? "",
      appointedOn: row.appointedOn ?? "",
      removedOn: row.removedOn ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    await upsert({
      id: form.id,
      societyId: society._id,
      function: form.function,
      firmName: form.firmName,
      contactName: form.contactName || undefined,
      firmLocation: form.firmLocation || undefined,
      appointedOn: form.appointedOn || undefined,
      removedOn: form.removedOn || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
  };

  const labelFor = (value: string) =>
    catalog?.find((c) => c.value === value)?.label ?? value;

  const isActive = (row: { removedOn?: string }) =>
    !row.removedOn || row.removedOn > today;

  const rows = items ?? [];
  const visible = activeOnly ? rows.filter(isActive) : rows;

  return (
    <div className="page">
      <PageHeader
        title="Service providers"
        icon={<Briefcase size={16} />}
        iconColor="purple"
        subtitle="External professionals engaged by the society — lawyers, accountants, bankers and other advisers — with their appointment and removal dates."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New provider
          </button>
        }
      />

      <label
        className="checkbox"
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}
      >
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(e) => setActiveOnly(e.target.checked)}
        />{" "}
        Show active only (today)
      </label>

      <div className="card">
        {items === undefined ? (
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>No service providers yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visible.map((row: any) => {
              const active = isActive(row);
              return (
                <li
                  key={row._id}
                  className="row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                  onClick={() => openEdit(row)}
                >
                  <span
                    title={active ? "Active" : "Removed"}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: active
                        ? "var(--accent, #16a34a)"
                        : "var(--text-tertiary)",
                    }}
                  />
                  <span style={{ minWidth: 140, color: "var(--text-secondary)" }}>
                    {labelFor(row.function)}
                  </span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{row.firmName}</span>
                  {row.contactName ? (
                    <span style={{ color: "var(--text-secondary)" }}>{row.contactName}</span>
                  ) : null}
                  <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                    {row.appointedOn ? `Appointed ${row.appointedOn}` : "—"}
                    {row.removedOn ? ` · Removed ${row.removedOn}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={form?.id ? "Edit service provider" : "New service provider"}
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
            <Field label="Function">
              <select
                className="input"
                value={form.function}
                onChange={(e) => setForm({ ...form, function: e.target.value })}
              >
                {(catalog ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Firm name">
              <input
                className="input"
                value={form.firmName}
                onChange={(e) => setForm({ ...form, firmName: e.target.value })}
              />
            </Field>
            <Field label="Contact name">
              <input
                className="input"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </Field>
            <Field label="Firm location">
              <input
                className="input"
                value={form.firmLocation}
                onChange={(e) => setForm({ ...form, firmLocation: e.target.value })}
              />
            </Field>
            <div className="row" style={{ display: "flex", gap: 12 }}>
              <Field label="Appointed on">
                <input
                  className="input"
                  type="date"
                  value={form.appointedOn}
                  onChange={(e) => setForm({ ...form, appointedOn: e.target.value })}
                />
              </Field>
              <Field label="Removed on">
                <input
                  className="input"
                  type="date"
                  value={form.removedOn}
                  onChange={(e) => setForm({ ...form, removedOn: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default ServiceProvidersPage;
