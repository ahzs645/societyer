import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Briefcase, Plus } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { todayDateOnly } from "../../shared/dateOnly";

/**
 * External service-provider register — lawyers, accountants, bankers and the
 * like. A row with no removedOn (or a removedOn in the future) is still
 * active. The "Show active only (today)" toggle filters client-side, so it
 * works without the activeAsOf query.
 */
export function ServiceProvidersPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("settings:write");
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
  const upsert = usePermissionedMutation(api.serviceProviders.upsert, canWrite);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const today = todayDateOnly();

  const openNew = () => {
    if (!canWrite) return;
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
    if (!canWrite || !form) return;
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
          <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
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
        title={form?.id ? (canWrite ? "Edit service provider" : "Service provider") : "New service provider"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" disabled={!canWrite} onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Function">
              <Select
                disabled={!canWrite}
                value={form.function}
                onChange={(value) => setForm({ ...form, function: value })}
                options={(catalog ?? []).map((c) => ({ value: c.value, label: c.label }))}
              />
            </Field>
            <Field label="Firm name">
              <input
                disabled={!canWrite}
                className="input"
                value={form.firmName}
                onChange={(e) => setForm({ ...form, firmName: e.target.value })}
              />
            </Field>
            <Field label="Contact name">
              <input
                disabled={!canWrite}
                className="input"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </Field>
            <Field label="Firm location">
              <input
                disabled={!canWrite}
                className="input"
                value={form.firmLocation}
                onChange={(e) => setForm({ ...form, firmLocation: e.target.value })}
              />
            </Field>
            <div className="row" style={{ display: "flex", gap: 12 }}>
              <Field label="Appointed on">
                <DatePicker
                disabled={!canWrite}
                  value={form.appointedOn}
                  onChange={(value) => setForm({ ...form, appointedOn: value })}
                />
              </Field>
              <Field label="Removed on">
                <DatePicker
                disabled={!canWrite}
                  value={form.removedOn}
                  onChange={(value) => setForm({ ...form, removedOn: value })}
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
