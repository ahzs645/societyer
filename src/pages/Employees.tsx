import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote, RecordChip } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { Plus, Users, Trash2 } from "lucide-react";
import { dollarInputToCents, formatDate, money, initials } from "../lib/format";
import { StructuredAddressFields } from "../components/StructuredAddressFields";
import { useMemo } from "react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FullTime: "Full-time",
  PartTime: "Part-time",
  Casual: "Casual",
  Contractor: "Contractor",
};

export function EmployeesPage() {
  const society = useSociety();
  const items = useQuery(api.employees.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.employees.create);
  const remove = useMutation(api.employees.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "employee",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const records = useMemo(() => (items ?? []).map((e: any) => ({
    ...e,
    name: `${e.firstName} ${e.lastName}`,
    status: e.endDate ? formatDate(e.endDate) : "Active",
    compensation: e.annualSalaryCents ? money(e.annualSalaryCents) : e.hourlyWageCents ? `${money(e.hourlyWageCents)}/hr` : "—",
  })), [items]);

  if (society === undefined) return <PageLoading />;
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

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="employee" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="employees"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Users size={14} />}
            label="All employees"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "name") {
                return <RecordChip tone="blue" avatar={initials(record.firstName, record.lastName)} label={record.name} />;
              }
              if (field.name === "startDate") return <span className="mono">{formatDate(record.startDate)}</span>;
              if (field.name === "status") {
                return record.endDate ? <span className="mono">{formatDate(record.endDate)}</span> : <Badge tone="success">Active</Badge>;
              }
              if (field.name === "employmentType") {
                return <Badge>{EMPLOYMENT_TYPE_LABELS[record.employmentType] ?? record.employmentType}</Badge>;
              }
              return undefined;
            }}
            renderRowActions={(r) => (
              <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete employee ${r.name}`} onClick={() => remove({ id: r._id })}>
                <Trash2 size={12} />
              </button>
            )}
          />
        </RecordTableScope>
      ) : null}

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
              <Field label="Birth date"><DatePicker value={form.birthDate ?? ""} onChange={(value) => setForm({ ...form, birthDate: value })} /></Field>
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
                <Select
                  value={form.employmentType}
                  onChange={(value) => setForm({ ...form, employmentType: value })}
                  options={[
                    { value: "FullTime", label: "FullTime" },
                    { value: "PartTime", label: "PartTime" },
                    { value: "Casual", label: "Casual" },
                    { value: "Contractor", label: "Contractor" },
                  ]}
                />
              </Field>
              <Field label="Start"><DatePicker value={form.startDate} onChange={(value) => setForm({ ...form, startDate: value })} /></Field>
              <Field label="End"><DatePicker value={form.endDate ?? ""} onChange={(value) => setForm({ ...form, endDate: value })} /></Field>
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
