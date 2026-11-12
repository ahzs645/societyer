import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { organizationVocabulary } from "../lib/organizationVocabulary";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote, RecordChip } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { Plus, Users, Trash2 } from "lucide-react";
import { dollarInputToCents, formatDate, initials } from "../lib/format";
import { StructuredAddressFields } from "../components/StructuredAddressFields";
import { Money } from "../components/Money";
import { useMemo } from "react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { todayDateOnly } from "../../shared/dateOnly";
import { useToast } from "../components/Toast";
import { EMPLOYEE_PARAM } from "../features/businessRegisters/payrollLinks";

/** Text fields the employee drawer edits, as stored. */
const EMPLOYEE_TEXT_FIELDS = [
  "firstName", "lastName", "email", "phone", "birthDate", "addressLine1", "addressLine2", "city", "province",
  "postalCode", "country", "role", "startDate", "endDate", "employmentType", "worksafeBCNumber",
] as const;

type EmployeeTextField = (typeof EMPLOYEE_TEXT_FIELDS)[number];
type EmployeeFlags = { annualSalaryCents?: number; hourlyWageCents?: number; cppExempt?: boolean; eiExempt?: boolean };
type EmployeeDoc = { _id: string } & EmployeeFlags & Partial<Record<EmployeeTextField, string>>;
type EmployeePatch = EmployeeFlags & Partial<Record<EmployeeTextField, string>>;

const centsToDollarInput = (cents: number | undefined) => (typeof cents === "number" ? String(cents / 100) : "");

/** The drawer's form for an existing employee: stored fields plus dollar inputs. */
function employeeFormValues(employee: EmployeeDoc) {
  return {
    ...employee,
    cppExempt: Boolean(employee.cppExempt),
    eiExempt: Boolean(employee.eiExempt),
    annualSalaryDollars: centsToDollarInput(employee.annualSalaryCents),
    hourlyWageDollars: centsToDollarInput(employee.hourlyWageCents),
  };
}

/** Only what changed, so fields the drawer doesn't show stay as stored. */
function employeePatch(original: EmployeeDoc, form: Record<string, unknown>): EmployeePatch {
  const patch: EmployeePatch = {};
  for (const field of EMPLOYEE_TEXT_FIELDS) {
    const value = typeof form[field] === "string" ? form[field] : "";
    if (value !== (original[field] ?? "")) patch[field] = value;
  }
  for (const [dollarsField, centsField] of [["annualSalaryDollars", "annualSalaryCents"], ["hourlyWageDollars", "hourlyWageCents"]] as const) {
    const input = typeof form[dollarsField] === "string" ? form[dollarsField] : "";
    if (input === centsToDollarInput(original[centsField])) continue;
    // A cleared amount reads as none, as for an employee saved without one.
    patch[centsField] = input.trim() ? dollarInputToCents(input) : 0;
  }
  for (const flag of ["cppExempt", "eiExempt"] as const) {
    if (Boolean(form[flag]) !== Boolean(original[flag])) patch[flag] = Boolean(form[flag]);
  }
  return patch;
}

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FullTime: "Full-time",
  PartTime: "Part-time",
  Casual: "Casual",
  Contractor: "Contractor",
};

export function EmployeesPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canWrite = permissions.loaded && permissions.can("employees:write");
  const items = useQuery(api.employees.list, society ? { societyId: society._id } : "skip");
  const create = usePermissionedMutation(api.employees.create, canWrite);
  const update = usePermissionedMutation(api.employees.update, canWrite);
  const remove = usePermissionedMutation(api.employees.remove, canWrite);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const toast = useToast();
  // The open employee lives in the URL (?employee=<id>), so payroll and other
  // pages can link straight to one.
  const [searchParams, setSearchParams] = useSearchParams();
  const employeeId = searchParams.get(EMPLOYEE_PARAM);
  const employees = items as EmployeeDoc[] | undefined;
  const linkedEmployee = employeeId ? employees?.find((employee) => String(employee._id) === employeeId) ?? null : null;
  const setEmployeeParam = (id: string | null) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set(EMPLOYEE_PARAM, id);
      else next.delete(EMPLOYEE_PARAM);
      return next;
    }, { replace: !id });
  };

  useEffect(() => {
    if (!canWrite) setOpen(false);
  }, [canWrite]);

  // Load the linked employee into the drawer once per id. A missing one
  // (removed, or another workspace's) drops the parameter instead.
  const loadedEmployeeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!employeeId) {
      loadedEmployeeRef.current = null;
      return;
    }
    if (employees === undefined || loadedEmployeeRef.current === employeeId) return;
    loadedEmployeeRef.current = employeeId;
    const found = employees.find((employee) => String(employee._id) === employeeId);
    if (found) {
      setForm(employeeFormValues(found));
      return;
    }
    toast.info("That employee isn't available", "They may have been removed, or they belong to another workspace.");
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete(EMPLOYEE_PARAM);
      return next;
    }, { replace: true });
  }, [employeeId, employees, toast, setSearchParams]);

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
    // Numeric (cents) so the currency column sorts, filters and totals; hourly
    // wages render per hour below and stay out of the annual figure.
    compensation: e.annualSalaryCents ?? null,
  })), [items]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    if (employeeId) setEmployeeParam(null);
    setForm({
      firstName: "",
      lastName: "",
      role: "",
      startDate: todayDateOnly(),
      employmentType: "FullTime",
      cppExempt: false,
      eiExempt: false,
    });
    setOpen(true);
  };
  const editing = Boolean(linkedEmployee && form?._id === employeeId);
  const closeDrawer = () => {
    setOpen(false);
    if (employeeId) setEmployeeParam(null);
  };
  const save = async () => {
    if (!canWrite) return;
    if (editing && linkedEmployee) {
      const patch = employeePatch(linkedEmployee, form);
      if (Object.keys(patch).length) await update({ id: linkedEmployee._id, patch });
      closeDrawer();
      return;
    }
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
        subtitle="Staff records for payroll and remuneration disclosure."
        info={organizationVocabulary(society).societyLaw && !society.isMemberFunded
          ? <p>Societies Act s.36 requires a financial-statement note for all director remuneration and employees or contractors receiving at least $75,000. Employee/contractor names are optional and the regulation permits aggregate reporting. Payroll tax and employment-record retention are separate obligations.</p>
          : <p>The payroll source of truth for T4/T4A slips and employment-standards record retention.</p>}
        actions={<>
          {permissions.can("financials:read") && <Link className="btn btn--sm" to="/app/financials/planning">Plan semester staff costs</Link>}
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
            <Plus size={12} /> New employee
          </button>
        </>}
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="employee" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="employees"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(id) => setEmployeeParam(id)}
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
              if (field.name === "startDate") return <span className="num">{formatDate(record.startDate)}</span>;
              if (field.name === "status") {
                return record.endDate ? <span className="num">{formatDate(record.endDate)}</span> : <Badge tone="success">Active</Badge>;
              }
              if (field.name === "compensation" && (record.annualSalaryCents || record.hourlyWageCents)) {
                return record.annualSalaryCents
                  ? <Money cents={record.annualSalaryCents} trimWholeCents />
                  : <span className="num"><Money cents={record.hourlyWageCents} />/hr</span>;
              }
              if (field.name === "employmentType") {
                return <Badge>{EMPLOYMENT_TYPE_LABELS[record.employmentType] ?? record.employmentType}</Badge>;
              }
              return undefined;
            }}
            renderRowActions={(r) => (
              <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete employee ${r.name}`} disabled={!canWrite} onClick={() => remove({ id: r._id })}>
                <Trash2 size={12} />
              </button>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={editing || (open && canWrite)}
        onClose={closeDrawer}
        title={editing && linkedEmployee ? [linkedEmployee.firstName, linkedEmployee.lastName].filter(Boolean).join(" ") || "Employee" : "New employee"}
        footer={<><button className="btn" onClick={closeDrawer}>{canWrite ? "Cancel" : "Close"}</button>{canWrite && <button className="btn btn--accent" onClick={save}>Save</button>}</>}
      >
        {form && (
          // Anyone who can see the list can open an employee; only editors change it.
          <fieldset disabled={!canWrite} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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
          </fieldset>
        )}
      </Drawer>
    </div>
  );
}
