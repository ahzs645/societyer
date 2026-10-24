import { useState } from "react";
import type {
  EarningCodeFields,
  EmployeeProfileFields,
  EmployerSettingsFields,
  OpeningBalanceFields,
  WorkDayFields,
} from "../../../shared/payrollCalculation";
import { Money } from "../../components/Money";
import { usePermissions } from "../../hooks/usePermissions";
import { formatDate } from "../../lib/format";
import { PayrollProfileForm } from "./PayrollProfileForm";
import { PayrollEhtAnnualPanel } from "./PayrollEhtAnnualPanel";
import {
  PayrollEmployerForm,
  PayrollEarningCodeForm,
  PayrollOpeningForm,
  PayrollWorkForm,
  pickerName,
  type PayrollPickerRow,
} from "./PayrollSourceForms";
import { payrollFields, usePayrollPages, type PayrollRow } from "./payrollUi";

export type PayrollSourceTab =
  | "employer"
  | "profiles"
  | "work"
  | "openings"
  | "codes";
type Fields =
  | EarningCodeFields
  | EmployeeProfileFields
  | EmployerSettingsFields
  | OpeningBalanceFields
  | WorkDayFields;
const SOURCE_LABELS: Record<PayrollSourceTab, string> = {
  employer: "Employer setup",
  profiles: "Employee profiles",
  work: "Work & leave",
  openings: "Opening balances",
  codes: "Earning codes",
};
const NEW_LABELS: Record<PayrollSourceTab, string> = {
  employer: "Configure employer year",
  profiles: "New employee profile",
  work: "Add work day",
  openings: "Add opening balance",
  codes: "New earning code",
};
export function PayrollSourcesPanel({
  societyId,
  year,
  today,
  employees,
  tab,
  canWrite,
}: {
  societyId: string;
  year: number;
  today: string;
  employees: PayrollPickerRow[];
  tab: PayrollSourceTab;
  canWrite: boolean;
}) {
  const permissions = usePermissions();
  const records = usePayrollPages<PayrollRow<Fields>>(
    {
      societyId,
      collection: tab,
      ...(tab === "employer" || tab === "openings" || tab === "work"
        ? { year }
        : {}),
    },
    SOURCE_LABELS[tab],
  );
  const accounts = usePayrollPages<PayrollPickerRow>(
    tab === "employer" ? { societyId, collection: "accounts" } : undefined,
    "Ledger accounts",
  );
  const runs = usePayrollPages<PayrollPickerRow>(
    tab === "employer" || tab === "openings"
      ? { societyId, collection: "recorded_runs", year }
      : undefined,
    "Recorded payment-year runs",
  );
  const funds = usePayrollPages<PayrollPickerRow>(
    tab === "profiles" ? { societyId, collection: "funds" } : undefined,
    "Funding restrictions",
  );
  const grants = usePayrollPages<PayrollPickerRow>(
    tab === "profiles" && permissions.can("grants:read")
      ? { societyId, collection: "grants" }
      : undefined,
    "Payroll allocation grants",
  );
  const employerDefinitions = usePayrollPages<
    PayrollRow<EmployerSettingsFields>
  >(
    tab === "profiles"
      ? { societyId, collection: "employer", year }
      : undefined,
    "Reviewed employer location definitions",
  );
  const employerDefinition = payrollFields(employerDefinitions.rows[0]);
  const [editing, setEditing] = useState<PayrollRow<Fields> | null | undefined>(
      undefined,
    ),
    [formVersion, setFormVersion] = useState(0);
  const cancel = () => setEditing(undefined),
    saved = () => {
      setEditing(undefined);
      setFormVersion((old) => old + 1);
    };
  const ready =
    records.ready &&
    accounts.ready &&
    runs.ready &&
    funds.ready &&
    grants.ready &&
    employerDefinitions.ready;
  const name = (row: PayrollRow<Fields>) =>
    employees.find((employee) => employee._id === row.employeeId)?.name ??
    row.employeeName ??
    row.employeeId ??
    "Employer";
  return (
    <section aria-label={SOURCE_LABELS[tab]}>
      {records.loader}
      {accounts.loader}
      {runs.loader}
      {funds.loader}
      {grants.loader}
      {employerDefinitions.loader}
      <div className="payroll-calculator__heading">
        <h2>{SOURCE_LABELS[tab]}</h2>
        <button
          type="button"
          className="btn btn--accent"
          disabled={!canWrite || !ready}
          onClick={() => {
            setEditing(null);
            setFormVersion((old) => old + 1);
          }}
        >
          {NEW_LABELS[tab]}
        </button>
      </div>
      {!ready &&
        !records.error &&
        !accounts.error &&
        !runs.error &&
        !funds.error &&
        !grants.error &&
        !employerDefinitions.error && (
          <p role="status">Loading complete payroll source records…</p>
        )}
      {tab === "profiles" && !permissions.can("grants:read") && (
        <p className="muted">
          Grant choices require grants read permission. Existing allocation
          references remain retained.
        </p>
      )}
      {editing !== undefined && ready && canWrite && (
        <div key={`${editing?._id ?? "new"}:${formVersion}`}>
          {tab === "employer" && (
            <PayrollEmployerForm
              societyId={societyId}
              year={year}
              value={
                (editing as PayrollRow<EmployerSettingsFields>) ?? undefined
              }
              accounts={accounts.rows}
              runs={runs.rows}
              onSaved={saved}
              onCancel={cancel}
            />
          )}
          {tab === "profiles" && (
            <PayrollProfileForm
              societyId={societyId}
              today={today}
              employees={employees}
              funds={funds.rows}
              grants={grants.rows}
              employerYear={year}
              ehtLocations={
                employerDefinition?.ehtLocations ??
                (employerDefinition?.ehtLocation
                  ? [employerDefinition.ehtLocation]
                  : [])
              }
              value={
                (editing as PayrollRow<EmployeeProfileFields>) ?? undefined
              }
              onSaved={saved}
              onCancel={cancel}
            />
          )}
          {tab === "work" && (
            <PayrollWorkForm
              societyId={societyId}
              today={today}
              employees={employees}
              value={(editing as PayrollRow<WorkDayFields>) ?? undefined}
              onSaved={saved}
              onCancel={cancel}
            />
          )}
          {tab === "openings" && (
            <PayrollOpeningForm
              societyId={societyId}
              year={year}
              employees={employees}
              runs={runs.rows}
              value={(editing as PayrollRow<OpeningBalanceFields>) ?? undefined}
              onSaved={saved}
              onCancel={cancel}
            />
          )}
          {tab === "codes" && (
            <PayrollEarningCodeForm
              societyId={societyId}
              value={(editing as PayrollRow<EarningCodeFields>) ?? undefined}
              onSaved={saved}
              onCancel={cancel}
            />
          )}
        </div>
      )}
      {ready && !records.rows.length && (
        <p>
          No saved {SOURCE_LABELS[tab].toLowerCase()} for this selection. Add
          the reviewed source assumptions before calculating.
        </p>
      )}
      {ready &&
        records.rows.map((row) => {
          const fields = payrollFields(row)!;
          return (
            <article className="payroll-calculator__record" key={row._id}>
              <div>
                {tab === "employer" && (
                  <>
                    <strong>
                      Employer payment year{" "}
                      {(fields as EmployerSettingsFields).year}
                    </strong>
                    <p>
                      {(fields as EmployerSettingsFields).payFrequency} ·{" "}
                      {(fields as EmployerSettingsFields).payDates.length}{" "}
                      actual pay dates · WorkSafe{" "}
                      {
                        (fields as EmployerSettingsFields)
                          .workSafeClassificationCode
                      }
                    </p>
                  </>
                )}
                {tab === "profiles" && (
                  <>
                    <strong>{name(row)}</strong>
                    <p>
                      {(fields as EmployeeProfileFields).provinceOfEmployment}{" "}
                      employment ·{" "}
                      {(fields as EmployeeProfileFields).compensation}{" "}
                      <Money
                        cents={(fields as EmployeeProfileFields).rateCents}
                        currency="CAD"
                      />{" "}
                      ·{" "}
                      {formatDate(
                        (fields as EmployeeProfileFields).effectiveFrom,
                      )}
                      {(fields as EmployeeProfileFields).effectiveTo
                        ? `–${formatDate((fields as EmployeeProfileFields).effectiveTo!)}`
                        : " onward"}
                    </p>
                  </>
                )}
                {tab === "work" && (
                  <>
                    <strong>
                      {name(row)} · {formatDate((fields as WorkDayFields).date)}
                    </strong>
                    <p>
                      {(fields as WorkDayFields).minutes / 60} hours ·{" "}
                      {(fields as WorkDayFields).sickLeave
                        ? `${(fields as WorkDayFields).sickLeave} sick day`
                        : (fields as WorkDayFields).holiday
                          ? "Statutory holiday"
                          : "Ordinary work"}
                    </p>
                  </>
                )}
                {tab === "openings" && (
                  <>
                    <strong>
                      {name(row)} · {(fields as OpeningBalanceFields).year}
                    </strong>
                    <p>
                      Through{" "}
                      {formatDate(
                        (fields as OpeningBalanceFields).coveredThroughDate,
                      )}{" "}
                      · {(fields as OpeningBalanceFields).sourceReference} ·{" "}
                      {(fields as OpeningBalanceFields).sameEmployerConfirmed
                        ? "Confirmed legal employer"
                        : "Confirmation required"}
                    </p>
                  </>
                )}
                {tab === "codes" && (
                  <>
                    <strong>
                      {(fields as EarningCodeFields).code} ·{" "}
                      {pickerName(
                        fields as EarningCodeFields & PayrollPickerRow,
                      )}
                    </strong>
                    <p>
                      {(fields as EarningCodeFields).paymentKind} ·{" "}
                      {(fields as EarningCodeFields).active
                        ? "Active"
                        : "Inactive"}{" "}
                      ·{" "}
                      {Object.entries(
                        (fields as EarningCodeFields).classifications,
                      )
                        .filter(([, enabled]) => enabled)
                        .map(([key]) => key)
                        .join(", ") || "No classified bases"}
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!canWrite}
                onClick={() => {
                  setEditing(row);
                  setFormVersion((old) => old + 1);
                }}
              >
                Edit{" "}
                {tab === "employer"
                  ? "employer setup"
                  : tab === "profiles"
                    ? "profile"
                    : tab === "work"
                      ? "work day"
                      : tab === "openings"
                        ? "opening balance"
                        : "earning code"}
              </button>
            </article>
          );
        })}
      {tab === "employer" && records.ready && records.rows[0] && (
        <PayrollEhtAnnualPanel
          employer={
            payrollFields(
              records.rows[0] as PayrollRow<EmployerSettingsFields>,
            )!
          }
          runs={runs.rows}
          complete={runs.ready}
        />
      )}
    </section>
  );
}
