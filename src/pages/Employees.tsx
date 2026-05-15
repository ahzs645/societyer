import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote, RecordChip } from "../components/ui";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Users, Trash2, Tag } from "lucide-react";
import { dollarInputToCents, formatDate, money, initials } from "../lib/format";
import { StructuredAddressFields } from "../components/StructuredAddressFields";

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FullTime: "Full-time",
  PartTime: "Part-time",
  Casual: "Casual",
  Contractor: "Contractor",
};

const FIELDS: FilterField<any>[] = [
  { id: "type", label: "Type", icon: <Tag size={14} />, options: ["FullTime", "PartTime", "Casual", "Contractor"], match: (r, q) => r.employmentType === q },
  { id: "active", label: "Active", options: ["Yes", "No"], match: (r, q) => (r.endDate ? "No" : "Yes") === q },
];

export function EmployeesPage() {
  const society = useSociety();
  const items = useQuery(api.employees.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.employees.create);
  const remove = useMutation(api.employees.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      firstName: "",
      lastName: "",
      role: "",
      startDate: new Date().toISOString().slice(0, 10),
      employmentType: "FullTime",
      cppExempt: false,
      eiExempt: false,
    });
    setOpen(true);
  };
  const save = async () => {
    const { annualSalaryDollars, hourlyWageDollars, ...rest } = form;
    await create({
      societyId: society._id,
      ...rest,
      annualSalaryCents: dollarInputToCents(annualSalaryDollars),
      hourlyWageCents: dollarInputToCents(hourlyWageDollars),
    });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Employees"
        icon={<Users size={16} />}
        iconColor="blue"
        subtitle="Payroll source of truth for T4/T4A generation, remuneration disclosure (s.36, ≥ $75k) and ESA 4-year record retention."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New employee
          </button>
        }
      />

      <DataTable
        label="All employees"
        icon={<Users size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search name, role…"
        defaultSort={{ columnId: "lastName", dir: "asc" }}
        columns={[
          {
            id: "lastName", header: "Name", sortable: true, accessor: (r) => `${r.firstName} ${r.lastName}`,
            render: (r) => (
              <RecordChip
                tone="blue"
                avatar={initials(r.firstName, r.lastName)}
                label={`${r.firstName} ${r.lastName}`}
              />
            ),
          },
          { id: "role", header: "Role", sortable: true, accessor: (r) => r.role, render: (r) => <span className="cell-tag">{r.role}</span> },
          { id: "employmentType", header: "Type", sortable: true, accessor: (r) => r.employmentType, render: (r) => <Badge>{EMPLOYMENT_TYPE_LABELS[r.employmentType] ?? r.employmentType}</Badge> },
          { id: "startDate", header: "Start", sortable: true, accessor: (r) => r.startDate, render: (r) => <span className="mono">{formatDate(r.startDate)}</span> },
          { id: "endDate", header: "Status", sortable: true, accessor: (r) => r.endDate ?? "", render: (r) => r.endDate ? <span className="mono">{formatDate(r.endDate)}</span> : <Badge tone="success">Active</Badge> },
          { id: "annualSalaryCents", header: "Salary (annual)", sortable: true, align: "right", accessor: (r) => r.annualSalaryCents ?? 0, render: (r) => r.annualSalaryCents ? <span className="mono">{money(r.annualSalaryCents)}</span> : r.hourlyWageCents ? <span className="mono">{money(r.hourlyWageCents)}/hr</span> : <span className="muted">—</span> },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete employee ${r.name}`} onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New employee"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <InspectorNote title="Payroll recordkeeping">
              Keep remuneration, exemptions, and work status accurate here so year-end slips and
              disclosure thresholds stay consistent.
            </InspectorNote>
            <div className="row" style={{ gap: 12 }}>
              <Field label="First name"><input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
              <Field label="Last name"><input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email"><input className="input" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Phone"><input className="input" inputMode="tel" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Birth date"><input className="input" type="date" value={form.birthDate ?? ""} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></Field>
            </div>
            <StructuredAddressFields
              value={{
                street: form.addressLine1,
                unit: form.addressLine2,
                city: form.city,
                provinceState: form.province,
                postalCode: form.postalCode,
                country: form.country,
              }}
              onChange={(address) => setForm({
                ...form,
                addressLine1: address.street,
                addressLine2: address.unit,
                city: address.city,
                province: address.provinceState,
                postalCode: address.postalCode,
                country: address.country,
              })}
            />
            <Field label="Role"><input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Type">
                <select className="input" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
                  <option>FullTime</option><option>PartTime</option><option>Casual</option><option>Contractor</option>
                </select>
              </Field>
              <Field label="Start"><input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Annual salary" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.annualSalaryDollars ?? ""} onChange={(e) => setForm({ ...form, annualSalaryDollars: e.target.value })} /></Field>
              <Field label="Hourly wage" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.hourlyWageDollars ?? ""} onChange={(e) => setForm({ ...form, hourlyWageDollars: e.target.value })} /></Field>
            </div>
            <Field label="WorkSafeBC #"><input className="input" value={form.worksafeBCNumber ?? ""} onChange={(e) => setForm({ ...form, worksafeBCNumber: e.target.value })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={form.cppExempt} onChange={(e) => setForm({ ...form, cppExempt: e.target.checked })} /> CPP exempt</label>
            <label className="checkbox"><input type="checkbox" checked={form.eiExempt} onChange={(e) => setForm({ ...form, eiExempt: e.target.checked })} /> EI exempt</label>
            {form._id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                <CustomFieldsPanel
                  societyId={society._id}
                  entityType="employees"
                  entityId={form._id}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
