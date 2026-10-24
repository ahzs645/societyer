import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { type PayrollDeductionYtd } from "../../../shared/payrollDeductions";
import type {
  EmployerSettingsFields,
  EarningCodeFields,
  WorkDayFields,
  OpeningBalanceFields,
} from "../../../shared/payrollCalculation";
import {
  amountInput,
  payrollFailure,
  payrollFields,
  payrollMoney,
  payrollNumber,
  PayrollFormActions,
  type PayrollRow,
} from "./payrollUi";
import { PayrollEhtLocationsFields, readPayrollEhtLocations } from "./PayrollEhtLocationsFields";

export type PayrollPickerRow = {
  _id: string;
  name?: string;
  employeeName?: string;
  code?: string;
  number?: string;
  accountType?: string;
  status?: string;
  date?: string;
  payDate?: string;
  providerName?: string;
  providerRunId?: string;
  runType?: string;
  lines?: Array<{ employeeId?: string; employeeName?: string }>;
};
export const pickerName = (row: PayrollPickerRow) =>
  row.name ??
  row.employeeName ??
  row.number ??
  row.code ??
  (row.lines
    ?.map((line) => line.employeeName)
    .filter(Boolean)
    .join(", ") ||
    undefined) ??
  row.providerRunId ??
  row._id;
export function TextInput({
  label,
  name,
  value,
  type = "text",
  hint,
  required = false,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        step={
          type === "number"
            ? "any"
            : type === "datetime-local"
              ? "0.001"
              : undefined
        }
      />
    </Field>
  );
}
export function CheckInput({
  label,
  name,
  checked = false,
  value,
}: {
  label: string;
  name: string;
  checked?: boolean;
  value?: string;
}) {
  return (
    <label className="checkbox-label">
      <input
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={checked}
      />{" "}
      {label}
    </label>
  );
}
export function SelectInput({
  label,
  name,
  value,
  choices,
  optional = false,
}: {
  label: string;
  name: string;
  value?: string;
  choices: readonly (string | { value: string; label: string })[];
  optional?: boolean;
}) {
  return (
    <Field label={label}>
      <select className="input" name={name} defaultValue={value ?? ""}>
        {optional && <option value="">None</option>}
        {choices.map((choice) => {
          const option =
            typeof choice === "string"
              ? { value: choice, label: choice.replaceAll("_", " ") }
              : choice;
          return (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
    </Field>
  );
}
export function MoneyInput({
  label,
  name,
  value,
  hint,
}: {
  label: string;
  name: string;
  value?: number;
  hint?: string;
}) {
  return (
    <TextInput
      label={label}
      name={name}
      value={amountInput(value)}
      hint={hint}
    />
  );
}
export const formText = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
export const formOptional = (data: FormData, name: string) =>
  formText(data, name) || undefined;
export const formCheck = (data: FormData, name: string) => data.has(name);
export const formMoney = (data: FormData, name: string, optional = false) =>
  payrollMoney(
    formText(data, name),
    name.replaceAll(/([A-Z])/g, " $1"),
    optional,
  );
export const formNumber = (data: FormData, name: string, optional = false) =>
  payrollNumber(
    formText(data, name),
    name.replaceAll(/([A-Z])/g, " $1"),
    optional,
  );
export function SourceForm({
  title,
  children,
  onSave,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onSave: (data: FormData) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSave(data);
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="card payroll-calculator__panel"
      aria-label={title}
      onSubmit={submit}
    >
      <h2>{title}</h2>
      {error && (
        <p role="alert" className="payroll-calculator__blockers">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="payroll-calculator__fieldset">
        {children}
      </fieldset>
      <PayrollFormActions
        busy={busy}
        onCancel={onCancel}
        label={`Save ${title.toLowerCase()}`}
      />
    </form>
  );
}
export function EmployeeInput({
  employees,
  employeeId,
}: {
  employees: PayrollPickerRow[];
  employeeId?: string;
}) {
  return (
    <SelectInput
      label="Employee"
      name="employeeId"
      value={employeeId}
      choices={employees.map((row) => ({
        value: row._id,
        label: pickerName(row),
      }))}
    />
  );
}

export function PayrollEmployerForm({
  societyId,
  year,
  value,
  accounts,
  runs,
  onSaved,
  onCancel,
}: {
  societyId: string;
  year: number;
  value?: PayrollRow<EmployerSettingsFields>;
  accounts: PayrollPickerRow[];
  runs: PayrollPickerRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollCalculation.saveEmployerSettings),
    current = payrollFields(value);
  async function onSave(data: FormData) {
    const fields: EmployerSettingsFields = {
      year: formNumber(data, "year")!,
      payFrequency: formText(
        data,
        "payFrequency",
      ) as EmployerSettingsFields["payFrequency"],
      payDates: formText(data, "payDates")
        .split(/[\s,;]+/)
        .filter(Boolean),
      eiEmployerMultiplier: formNumber(data, "eiEmployerMultiplier")!,
      reducedEiRateEvidence: formOptional(data, "reducedEiRateEvidence"),
      uniformEmployerAssumptionsConfirmed: formCheck(data, "uniformEmployerAssumptionsConfirmed"),
      ehtEmployerClass: formText(
        data,
        "ehtEmployerClass",
      ) as EmployerSettingsFields["ehtEmployerClass"],
      ehtQualificationEvidence: formOptional(data, "ehtQualificationEvidence"),
      ehtOpeningRemunerationCents: formMoney(
        data,
        "ehtOpeningRemunerationCents",
      )!,
      ehtOpeningThroughDate: formText(data, "ehtOpeningThroughDate"),
      ehtOpeningConfirmed: formCheck(data, "ehtOpeningConfirmed"),
      ehtOpeningSourceReference: formText(data, "ehtOpeningSourceReference"),
      ehtOpeningRepresentedPayRunIds: data
        .getAll("ehtOpeningRepresentedPayRunIds")
        .map(String),
      ehtAssociated: formCheck(data, "ehtAssociated"),
      associatedGroupPermanentEstablishmentDays: formNumber(
        data,
        "associatedGroupPermanentEstablishmentDays",
        true,
      ),
      ehtAssociatedGroupRemunerationCents: formMoney(
        data,
        "ehtAssociatedGroupRemunerationCents",
        true,
      ),
      ehtExemptionAllocationCents: formMoney(
        data,
        "ehtExemptionAllocationCents",
        true,
      ),
      ehtAllocationEvidence: formOptional(data, "ehtAllocationEvidence"),
      ehtPermanentEstablishmentDays: formNumber(
        data,
        "ehtPermanentEstablishmentDays",
      )!,
      ehtLocation: formText(data, "locationId")
        ? {
            id: formText(data, "locationId"),
            evidence: formText(data, "locationEvidence"),
            qualifying: formCheck(data, "locationQualifying"),
          }
        : undefined,
      ehtLocations: readPayrollEhtLocations(data),
      workSafeRatePer100Dollars: formNumber(data, "workSafeRatePer100Dollars")!,
      workSafeAssessableLimitCents: formMoney(
        data,
        "workSafeAssessableLimitCents",
      )!,
      workSafeClassificationCode: formText(data, "workSafeClassificationCode"),
      workSafeRateEvidence: formText(data, "workSafeRateEvidence"),
      employerBenefitsCentsPerPay: formMoney(
        data,
        "employerBenefitsCentsPerPay",
      )!,
      employerPensionPercent: formNumber(data, "employerPensionPercent")!,
      employerPensionBonusEligible: formOptional(data, "employerPensionBonusEligible") === undefined ? undefined : formText(data, "employerPensionBonusEligible") === "true",
      benefitsAlreadyInEarningsCentsPerPay: formMoney(
        data,
        "benefitsAlreadyInEarningsCentsPerPay",
        true,
      ),
      pensionAlreadyInEarningsCentsPerPay: formMoney(
        data,
        "pensionAlreadyInEarningsCentsPerPay",
        true,
      ),
      ledger: Object.fromEntries(
        [
          "wagesExpenseAccountId",
          "employerExpenseAccountId",
          "netPayLiabilityAccountId",
          "deductionsLiabilityAccountId",
          "benefitsLiabilityAccountId",
        ].map((key) => [key, formOptional(data, key)]),
      ),
    };
    await save({ societyId, fields });
    onSaved();
  }
  return (
    <SourceForm title="Employer setup" onSave={onSave} onCancel={onCancel}>
      <p>
        Enter the actual payment calendar and documented employer rates for this
        year. Registered payroll account and provider settings remain in{" "}
        <a href="/app/payroll?setup=1">Payroll settings</a>.
      </p>
      <div className="payroll-calculator__form-grid">
        <TextInput
          label="Payment year"
          name="year"
          type="number"
          value={current?.year ?? year}
          required
        />
        <SelectInput
          label="Pay frequency"
          name="payFrequency"
          value={current?.payFrequency ?? "biweekly"}
          choices={["weekly", "biweekly", "semimonthly", "monthly"]}
        />
        <Field
          label="Actual pay dates"
          hint="Enter every approved pay date, separated by commas or new lines. This determines the actual number of pays."
        >
          <textarea
            className="input"
            name="payDates"
            rows={5}
            defaultValue={current?.payDates.join("\n")}
            required
          />
        </Field>
        <TextInput
          label="EI employer multiplier"
          name="eiEmployerMultiplier"
          type="number"
          value={current?.eiEmployerMultiplier}
          required
        />
        <TextInput
          label="Reduced EI rate evidence"
          name="reducedEiRateEvidence"
          value={current?.reducedEiRateEvidence}
        />
        <SelectInput
          label="EHT employer class"
          name="ehtEmployerClass"
          value={current?.ehtEmployerClass ?? "ordinary"}
          choices={["ordinary", "charitable_nonprofit"]}
        />
        <TextInput
          label="EHT qualification evidence"
          name="ehtQualificationEvidence"
          value={current?.ehtQualificationEvidence}
        />
        <TextInput
          label="Permanent establishment days in year"
          name="ehtPermanentEstablishmentDays"
          type="number"
          value={current?.ehtPermanentEstablishmentDays}
          required
        />
        <MoneyInput
          label="EHT opening remuneration"
          name="ehtOpeningRemunerationCents"
          value={current?.ehtOpeningRemunerationCents ?? 0}
        />
        <TextInput
          label="EHT opening covered through"
          name="ehtOpeningThroughDate"
          type="date"
          value={current?.ehtOpeningThroughDate}
          required
        />
        <TextInput
          label="EHT opening source reference"
          name="ehtOpeningSourceReference"
          value={current?.ehtOpeningSourceReference}
        />
        <CheckInput
          label="EHT opening remuneration is complete and confirmed"
          name="ehtOpeningConfirmed"
          checked={current?.ehtOpeningConfirmed}
        />
        <CheckInput
          label="Associated employer group"
          name="ehtAssociated"
          checked={current?.ehtAssociated}
        />
        <TextInput
          label="Associated group permanent establishment days"
          name="associatedGroupPermanentEstablishmentDays"
          type="number"
          value={current?.associatedGroupPermanentEstablishmentDays}
          hint="Union of days when any associated employer had a B.C. establishment; required for a part-year group."
        />
        <MoneyInput
          label="Associated group remuneration"
          name="ehtAssociatedGroupRemunerationCents"
          value={current?.ehtAssociatedGroupRemunerationCents}
        />
        <MoneyInput
          label="Allocated EHT exemption"
          name="ehtExemptionAllocationCents"
          value={current?.ehtExemptionAllocationCents}
        />
        <TextInput
          label="EHT allocation evidence"
          name="ehtAllocationEvidence"
          value={current?.ehtAllocationEvidence}
        />
        <TextInput
          label="Qualifying location identifier"
          name="locationId"
          value={current?.ehtLocation?.id}
        />
        <TextInput
          label="Location qualification evidence"
          name="locationEvidence"
          value={current?.ehtLocation?.evidence}
        />
        <CheckInput
          label="Location qualifies for separate exemption"
          name="locationQualifying"
          checked={current?.ehtLocation?.qualifying}
        />
        <TextInput
          label="WorkSafe rate per $100"
          name="workSafeRatePer100Dollars"
          type="number"
          value={current?.workSafeRatePer100Dollars}
          required
        />
        <MoneyInput
          label="Annual WorkSafe assessable earnings limit"
          name="workSafeAssessableLimitCents"
          value={current?.workSafeAssessableLimitCents}
        />
        <TextInput
          label="WorkSafe classification code"
          name="workSafeClassificationCode"
          value={current?.workSafeClassificationCode}
          required
        />
        <TextInput
          label="WorkSafe rate evidence"
          name="workSafeRateEvidence"
          value={current?.workSafeRateEvidence}
          required
        />
        <MoneyInput
          label="Employer benefits per pay"
          name="employerBenefitsCentsPerPay"
          value={current?.employerBenefitsCentsPerPay ?? 0}
        />
        <TextInput
          label="Employer pension percent"
          name="employerPensionPercent"
          type="number"
          value={current?.employerPensionPercent ?? 0}
        />
        <SelectInput label="Employer pension plan treatment of actual bonuses" name="employerPensionBonusEligible" value={current?.employerPensionBonusEligible === undefined ? undefined : String(current.employerPensionBonusEligible)} optional choices={[{value:"true",label:"Reviewed plan includes actual bonus earnings"},{value:"false",label:"Reviewed plan excludes actual bonus earnings"}]} />
        <MoneyInput
          label="Benefits already included in earnings per pay"
          name="benefitsAlreadyInEarningsCentsPerPay"
          value={current?.benefitsAlreadyInEarningsCentsPerPay}
        />
        <MoneyInput
          label="Pension already included in earnings per pay"
          name="pensionAlreadyInEarningsCentsPerPay"
          value={current?.pensionAlreadyInEarningsCentsPerPay}
        />
      </div>
      <CheckInput label="Default employer EI, benefits and pension assumptions reviewed for employees without overrides" name="uniformEmployerAssumptionsConfirmed" checked={current?.uniformEmployerAssumptionsConfirmed} />
      <PayrollEhtLocationsFields value={current?.ehtLocations} />
      <details>
        <summary>Recorded runs already represented by EHT opening</summary>
        <p>
          Select only records included in the stated opening; other runs are
          added separately.
        </p>
        {runs.map((run) => (
          <CheckInput
            key={run._id}
            label={`${run.payDate ?? ""} ${pickerName(run)}`}
            name="ehtOpeningRepresentedPayRunIds"
            value={run._id}
            checked={current?.ehtOpeningRepresentedPayRunIds.includes(run._id)}
          />
        ))}
      </details>
      <h3>Optional accrual ledger mappings</h3>
      <div className="payroll-calculator__form-grid">
        {(
          [
            ["wagesExpenseAccountId", "Wages expense account"],
            ["employerExpenseAccountId", "Employer cost expense account"],
            ["netPayLiabilityAccountId", "Net pay liability account"],
            ["deductionsLiabilityAccountId", "Deductions liability account"],
            ["benefitsLiabilityAccountId", "Benefits liability account"],
          ] as const
        ).map(([key, label]) => (
          <SelectInput
            key={key}
            label={label}
            name={key}
            value={current?.ledger?.[key]}
            optional
            choices={accounts.map((row) => ({
              value: row._id,
              label: `${row.code ?? ""} ${pickerName(row)}`,
            }))}
          />
        ))}
      </div>
    </SourceForm>
  );
}

export function PayrollWorkForm({
  societyId,
  today,
  employees,
  value,
  onSaved,
  onCancel,
}: {
  societyId: string;
  today: string;
  employees: PayrollPickerRow[];
  value?: PayrollRow<WorkDayFields>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollCalculation.saveWorkDay),
    current = payrollFields(value);
  return (
    <SourceForm
      title="Work day"
      onCancel={onCancel}
      onSave={async (data) => {
        const minutes = formNumber(data, "hours")! * 60,
          rest = formNumber(data, "restHours", true),
          paidLeaveHours = formNumber(data, "paidLeaveHours", true),
          paidVacationHours = formNumber(data, "paidVacationHours", true);
        if (
          !Number.isInteger(minutes) ||
          (rest !== undefined && !Number.isInteger(rest * 60)) ||
          (paidLeaveHours !== undefined &&
            !Number.isInteger(paidLeaveHours * 60)) || (paidVacationHours !== undefined && !Number.isInteger(paidVacationHours * 60))
        )
          throw new Error("Hours must resolve to whole minutes.");
        const fields: WorkDayFields = {
          date: formText(data, "date"),
          minutes,
          holiday: formCheck(data, "holiday"),
          sickLeave: formOptional(
            data,
            "sickLeave",
          ) as WorkDayFields["sickLeave"],
          restPremiumMinutes: rest === undefined ? undefined : rest * 60,
          paidVacationMinutes: paidVacationHours === undefined ? undefined : paidVacationHours * 60,
          salaryVacationSourceReference: formOptional(data, "salaryVacationSourceReference"),
          vacationRequestId: current?.vacationRequestId,
          salaryIncludedHolidayCents: formMoney(
            data,
            "salaryIncludedHolidayCents",
            true,
          ),
          salaryIncludedSickCents: formMoney(
            data,
            "salaryIncludedSickCents",
            true,
          ),
          insurablePaidLeaveMinutes:
            paidLeaveHours === undefined ? undefined : paidLeaveHours * 60,
          historicalNonOvertimeWagesCents: formMoney(
            data,
            "historicalNonOvertimeWagesCents",
            true,
          ),
          workedOrEarned: minutes > 0 || formCheck(data, "workedOrEarned"),
          notes: formOptional(data, "notes"),
        };
        await save({
          societyId,
          id: value?._id,
          employeeId: formText(data, "employeeId"),
          fields,
        });
        onSaved();
      }}
    >
      <p>
        Record full Sunday–Saturday weeks and the required preceding history,
        including days with zero work. Hours worked automatically count as a
        worked day. For zero-hour history, confirm whether wages were earned.
        The engine determines overtime and leave eligibility.
      </p>
      <div className="payroll-calculator__form-grid">
        <EmployeeInput employees={employees} employeeId={value?.employeeId} />
        <TextInput
          label="Work date"
          name="date"
          type="date"
          value={current?.date ?? today}
          required
        />
        <TextInput
          label="Hours worked"
          name="hours"
          type="number"
          value={(current?.minutes ?? 0) / 60}
          required
        />
        <TextInput label="Paid annual vacation hours included in salary" name="paidVacationHours" type="number" value={current?.paidVacationMinutes === undefined ? undefined : current.paidVacationMinutes / 60} hint="Approved annual leave already paid inside fixed salary. These are not worked overtime hours and do not add a second cash payment." />
        <TextInput label="Paid annual vacation source reference" name="salaryVacationSourceReference" value={current?.salaryVacationSourceReference} hint="Reference the approved leave or reviewed source. Use the vacation tracker to create an owned approval link; hourly vacation cash uses the explicit accrued-vacation payout." />
        {current?.vacationRequestId && <p>Linked to an approved vacation request. Payroll records its pay without deducting leave time again.</p>}
        <CheckInput
          label="Statutory holiday"
          name="holiday"
          checked={current?.holiday}
        />
        <SelectInput
          label="Sick leave"
          name="sickLeave"
          value={current?.sickLeave}
          optional
          choices={[
            { value: "paid", label: "Paid sick day" },
            { value: "unpaid", label: "Unpaid sick day" },
          ]}
        />
        <TextInput
          label="Rest period premium hours"
          name="restHours"
          type="number"
          hint="Ordinary minutes during weekly rest requiring 1.5×, excluding time already paid at overtime or holiday premium."
          value={
            current?.restPremiumMinutes === undefined
              ? undefined
              : current.restPremiumMinutes / 60
          }
        />
        <MoneyInput
          label="Holiday pay already included in salary"
          name="salaryIncludedHolidayCents"
          value={current?.salaryIncludedHolidayCents}
          hint="Required for a salaried statutory holiday, including an explicit zero, to avoid duplicate pay."
        />
        <MoneyInput
          label="Sick pay already included in salary"
          name="salaryIncludedSickCents"
          value={current?.salaryIncludedSickCents}
          hint="Required for salaried paid sick leave, including an explicit zero."
        />
        <TextInput
          label="Insurable paid leave hours"
          name="paidLeaveHours"
          type="number"
          value={
            current?.insurablePaidLeaveMinutes === undefined
              ? undefined
              : current.insurablePaidLeaveMinutes / 60
          }
          hint="Document actual insurable paid leave hours separately from hours worked."
        />
        <MoneyInput
          label="Historical non-overtime wages"
          name="historicalNonOvertimeWagesCents"
          value={current?.historicalNonOvertimeWagesCents}
          hint="For historical work/leave context only; this is not a new payment."
        />
        <CheckInput
          label="Earned wages on a zero-work day"
          name="workedOrEarned"
          checked={current?.minutes === 0 && current.workedOrEarned}
        />
        <TextInput label="Work notes" name="notes" value={current?.notes} />
      </div>
    </SourceForm>
  );
}

export const YTD_LABELS: Record<keyof PayrollDeductionYtd, string> = {
  regularTaxableCents: "Regular taxable earnings",
  regularPensionableCents: "Regular pensionable earnings",
  regularInsurableCents: "Regular insurable earnings",
  bonusTaxableCents: "Bonus taxable earnings",
  bonusPensionableCents: "Bonus pensionable earnings",
  bonusInsurableCents: "Bonus insurable earnings",
  cppCents: "Employee CPP",
  cpp2Cents: "Employee CPP2",
  eiCents: "Employee EI",
  employerEiCents: "Employer EI",
  bonusCppCents: "CPP on bonuses",
  bonusEiCents: "EI on bonuses",
  cppAdditionalRegularCents: "Additional CPP on regular earnings",
  cppAdditionalBonusCents: "Additional CPP on bonuses",
  registeredPlanCents: "Registered plan deductions",
  unionDuesCents: "Union dues",
  maintenanceCents: "Maintenance deductions",
  bonusRegisteredPlanCents: "Registered plan on bonuses",
  regularTaxCents: "Regular income tax",
  bonusTaxCents: "Bonus income tax",
  additionalTaxCents: "Additional income tax",
  regularFederalTaxCents: "Regular federal tax component",
  regularProvincialTaxCents: "Regular provincial tax component",
  bonusFederalTaxCents: "Bonus federal tax component",
  bonusProvincialTaxCents: "Bonus provincial tax component",
};
export function PayrollOpeningForm({
  societyId,
  year,
  employees,
  runs,
  value,
  onSaved,
  onCancel,
}: {
  societyId: string;
  year: number;
  employees: PayrollPickerRow[];
  runs: PayrollPickerRow[];
  value?: PayrollRow<OpeningBalanceFields>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollCalculation.saveOpeningBalance),
    current = payrollFields(value);
  return (
    <SourceForm
      title="Opening balance"
      onCancel={onCancel}
      onSave={async (data) => {
        const ytd = Object.fromEntries(
          Object.keys(YTD_LABELS).map((key) => [
            key,
            formMoney(
              data,
              key,
              key.includes("Federal") || key.includes("Provincial"),
            ),
          ]),
        ) as PayrollDeductionYtd;
        const fields: OpeningBalanceFields = {
          provinceOfEmployment: formOptional(
            data,
            "openingProvinceOfEmployment",
          ),
          employerCppCents: formMoney(data, "employerCppCents", true),
          employerCpp2Cents: formMoney(data, "employerCpp2Cents", true),
          year: formNumber(data, "year")!,
          coveredThroughDate: formText(data, "coveredThroughDate"),
          sameEmployerConfirmed: formCheck(data, "sameEmployerConfirmed"),
          ytd,
          insurableHours: formNumber(data, "insurableHours")!,
          cashPaidCents: formMoney(data, "cashPaidCents")!,
          netPaidCents: formMoney(data, "netPaidCents")!,
          vacationBalanceCents: formMoney(data, "vacationBalanceCents")!,
          workSafeAssessableCents: formMoney(data, "workSafeAssessableCents")!,
          sickPaidDaysUsed: formNumber(data, "sickPaidDaysUsed")!,
          sickUnpaidDaysUsed: formNumber(data, "sickUnpaidDaysUsed")!,
          sourceProvider: formOptional(data, "sourceProvider"),
          sourceReference: formText(data, "sourceReference"),
          representedPayRunIds: data.getAll("representedPayRunIds").map(String),
        };
        await save({
          societyId,
          id: value?._id,
          employeeId: formText(data, "employeeId"),
          fields,
        });
        onSaved();
      }}
    >
      <p>
        These balances belong to this legal employer and payment year. A
        confirmed zero opening is appropriate only when there is no earlier
        payroll for this employer. Unknown federal/provincial splits may be left
        blank; combined tax remains authoritative.
      </p>
      <div className="payroll-calculator__form-grid">
        <EmployeeInput employees={employees} employeeId={value?.employeeId} />
        <TextInput
          label="Opening payment year"
          name="year"
          type="number"
          value={current?.year ?? year}
          required
        />
        <TextInput
          label="Opening covered through"
          name="coveredThroughDate"
          type="date"
          value={current?.coveredThroughDate}
          required
        />
        <TextInput
          label="Opening source provider"
          name="sourceProvider"
          value={current?.sourceProvider}
        />
        <TextInput
          label="Opening source reference"
          name="sourceReference"
          value={current?.sourceReference}
          required
        />
        <CheckInput
          label="Opening is complete for this legal employer and year"
          name="sameEmployerConfirmed"
          checked={current?.sameEmployerConfirmed}
        />
        {Object.entries(YTD_LABELS).map(([key, label]) => (
          <MoneyInput
            key={key}
            label={label}
            name={key}
            value={
              current?.ytd[key as keyof PayrollDeductionYtd] ??
              (key.includes("Federal") || key.includes("Provincial")
                ? undefined
                : 0)
            }
          />
        ))}
        <SelectInput
          label="Opening province of employment"
          name="openingProvinceOfEmployment"
          value={current?.provinceOfEmployment}
          optional
          choices={[
            "BC",
            "AB",
            "SK",
            "MB",
            "ON",
            "QC",
            "NB",
            "NS",
            "PE",
            "NL",
            "YT",
            "NT",
            "NU",
          ]}
        />
        <MoneyInput
          label="Opening employer CPP"
          name="employerCppCents"
          value={current?.employerCppCents}
        />
        <MoneyInput
          label="Opening employer CPP2"
          name="employerCpp2Cents"
          value={current?.employerCpp2Cents}
        />
        <TextInput
          label="Opening insurable hours"
          name="insurableHours"
          type="number"
          value={current?.insurableHours ?? 0}
        />
        <MoneyInput
          label="Opening cash paid"
          name="cashPaidCents"
          value={current?.cashPaidCents ?? 0}
        />
        <MoneyInput
          label="Opening net paid"
          name="netPaidCents"
          value={current?.netPaidCents ?? 0}
        />
        <MoneyInput
          label="Opening vacation balance"
          name="vacationBalanceCents"
          value={current?.vacationBalanceCents ?? 0}
        />
        <MoneyInput
          label="Opening WorkSafe assessable earnings"
          name="workSafeAssessableCents"
          value={current?.workSafeAssessableCents ?? 0}
        />
        <TextInput
          label="Paid sick days already used"
          name="sickPaidDaysUsed"
          type="number"
          value={current?.sickPaidDaysUsed ?? 0}
        />
        <TextInput
          label="Unpaid sick days already used"
          name="sickUnpaidDaysUsed"
          type="number"
          value={current?.sickUnpaidDaysUsed ?? 0}
        />
      </div>
      <h3>Recorded runs already represented by this opening</h3>
      <p>
        Only select existing runs already included above. Unselected runs are
        added separately.
      </p>
      {runs.map((run) => (
        <label key={run._id}>
          <input
            type="checkbox"
            name="representedPayRunIds"
            value={run._id}
            defaultChecked={current?.representedPayRunIds.includes(run._id)}
          />{" "}
          {run.payDate} {pickerName(run)}
        </label>
      ))}
    </SourceForm>
  );
}

export function PayrollEarningCodeForm({
  societyId,
  value,
  onSaved,
  onCancel,
}: {
  societyId: string;
  value?: PayrollRow<EarningCodeFields>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation(api.payrollCalculation.saveEarningCode),
    current = payrollFields(value);
  return (
    <SourceForm
      title="Earning code"
      onCancel={onCancel}
      onSave={async (data) => {
        const classifications = Object.fromEntries(
          [
            "cash",
            "taxable",
            "pensionable",
            "insurable",
            "vacationable",
            "eht",
            "workSafe",
          ].map((key) => [key, formCheck(data, key)]),
        ) as EarningCodeFields["classifications"];
        await save({
          societyId,
          id: value?._id,
          fields: {
            code: formText(data, "code"),
            name: formText(data, "name"),
            paymentKind: formText(
              data,
              "paymentKind",
            ) as EarningCodeFields["paymentKind"],
            classifications,
            classificationEvidence: formText(data, "classificationEvidence"),
            active: formCheck(data, "active"),
          },
        });
        onSaved();
      }}
    >
      <div className="payroll-calculator__form-grid">
        <TextInput
          label="Earning code"
          name="code"
          value={current?.code}
          required
        />
        <TextInput
          label="Earning name"
          name="name"
          value={current?.name}
          required
        />
        <SelectInput
          label="Payment classification"
          name="paymentKind"
          value={current?.paymentKind ?? "regular"}
          choices={[
            "regular",
            "bonus",
            "benefit",
            "reimbursement",
            "vacation",
            "other",
          ]}
        />
        <TextInput
          label="Classification evidence"
          name="classificationEvidence"
          value={current?.classificationEvidence}
          required
        />
        {(
          [
            "cash",
            "taxable",
            "pensionable",
            "insurable",
            "vacationable",
            "eht",
            "workSafe",
          ] as const
        ).map((key) => (
          <CheckInput
            key={key}
            label={
              key === "workSafe"
                ? "WorkSafe assessable"
                : key === "eht"
                  ? "EHT remuneration"
                  : key
            }
            name={key}
            checked={current?.classifications[key]}
          />
        ))}
        <CheckInput
          label="Earning code active"
          name="active"
          checked={current?.active ?? true}
        />
      </div>
      <p>
        A payment label alone does not determine its tax or reporting
        classification. Record the evidence behind these bases.
      </p>
    </SourceForm>
  );
}
