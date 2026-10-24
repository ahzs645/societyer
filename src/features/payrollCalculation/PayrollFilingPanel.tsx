import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { triggerBlobDownload } from "../../lib/zip";
import { parseMoneyInput } from "../../lib/money";
import { useFinancePermissions } from "../../hooks/useFinancePermissions";
import {
  exportT4Xml,
  exportT4AXml,
  exportRoeXml,
  CRA_SUBMISSION_SCHEMAS,
  ROE_PAY_PERIODS,
  ROE_REASONS,
  ROE_REASON_LABELS,
  ROE_PAY_PERIOD_LABELS,
  ROE_OTHER_MONIES,
  ROE_OTHER_MONEY_LABELS,
  type PayrollFilingAddress,
  type PayrollFilingPerson,
  type PayrollT4AnnualRecord,
  type CraSubmissionVersion,
  type RoeFilingInput,
  payrollOtherInformationFields,
  reviewedT4AnnualLimits,
  type PayrollXmlExport,
} from "../../../shared/payrollReporting";
import {
  amountInput,
  payrollFailure,
  payrollMoney,
  PayrollQueryBoundary,
  usePayrollPages,
} from "./payrollUi";

import type { RoeWorkflowView } from "../../../shared/payrollRoeWorkflow";

export type RoeCaseExportProps = {
  roeCase?: RoeWorkflowView;
  onRoeGenerated?: (result: PayrollXmlExport) => Promise<void>;
};

type Annual = PayrollT4AnnualRecord & {
  sourceCount: number;
  complete: boolean;
};
type RoeSource = {
  employeeId: string;
  employeeName: string;
  payFrequency: string;
  periods: Array<{
    periodStart: string;
    periodEnd: string;
    payDate: string;
    insurableEarningsCents: number;
    insurableHours: number;
  }>;
  complete: boolean;
};
type FilingContext = {
  earningsYear: number;
  employerName: string;
  employerAddress?: string;
  payrollAccountLast4?: string;
  sourceCount: number;
  complete: boolean;
  warnings: string[];
  blockers: string[];
  annualRecords: Annual[];
  employerContributions: {
    cppCents: number;
    cpp2Cents: number;
    eiCents: number;
  };
  roeSources: RoeSource[];
  isDone?: boolean;
  continueCursor?: string;
};
function ContextPage({
  societyId,
  year,
  cursor,
  seen,
  report,
}: {
  societyId: string;
  year: number;
  cursor: string | null;
  seen: string[];
  report: (cursor: string | null, result: FilingContext | undefined) => void;
}) {
  const result = useQuery(api.payrollCalculation.exportContext, {
    societyId,
    year,
    ...(cursor ? { cursor } : {}),
  } as any) as FilingContext | undefined;
  useEffect(() => {
    report(cursor, result);
  }, [cursor, report, result]);
  if (!result || result.isDone !== false) return null;
  if (!result.continueCursor || seen.includes(result.continueCursor))
    throw new Error("Payroll filing pagination did not advance.");
  return (
    <ContextPage
      societyId={societyId}
      year={year}
      cursor={result.continueCursor}
      seen={[...seen, result.continueCursor]}
      report={report}
    />
  );
}
function mergeContexts(pages: FilingContext[]): FilingContext {
  const first = pages[0],
    annual = new Map<string, Annual>(),
    roe = new Map<string, RoeSource>();
  const money = [
    "employmentIncomeCents",
    "cppEmployeeCents",
    "cpp2EmployeeCents",
    "eiEmployeeCents",
    "incomeTaxCents",
    "pensionableEarningsCents",
    "insurableEarningsCents",
    "rppContributionsCents",
    "unionDuesCents",
    "pensionAdjustmentCents",
  ] as const;
  for (const page of pages) {
    for (const record of page.annualRecords ?? []) {
      const key = `${record.employeeId}:${record.provinceOfEmployment}`,
        previous = annual.get(key);
      annual.set(
        key,
        previous
          ? {
              ...previous,
              ...Object.fromEntries(
                money.map((field) => [
                  field,
                  (previous[field] ?? 0) + (record[field] ?? 0),
                ]),
              ),
              rppClassificationRequired:
                previous.rppClassificationRequired ||
                record.rppClassificationRequired,
              complete: previous.complete && record.complete,
              sourceCount: previous.sourceCount + record.sourceCount,
            }
          : { ...record },
      );
    }
    for (const record of page.roeSources ?? []) {
      const previous = roe.get(record.employeeId);
      roe.set(
        record.employeeId,
        previous
          ? {
              ...previous,
              periods: [...previous.periods, ...record.periods],
              complete: previous.complete && record.complete,
            }
          : { ...record, periods: [...record.periods] },
      );
    }
  }
  for (const record of roe.values()) {
    const byPeriod = new Map<string, (typeof record.periods)[number]>();
    for (const period of record.periods) {
      const key = `${period.periodStart}:${period.periodEnd}`,
        previous = byPeriod.get(key);
      byPeriod.set(
        key,
        previous
          ? {
              ...previous,
              insurableEarningsCents:
                previous.insurableEarningsCents + period.insurableEarningsCents,
              insurableHours: previous.insurableHours + period.insurableHours,
            }
          : { ...period },
      );
    }
    record.periods = [...byPeriod.values()].sort((a, b) =>
      b.periodEnd.localeCompare(a.periodEnd),
    );
  }
  return {
    ...first,
    sourceCount: pages.reduce(
      (total, page) => total + (page.sourceCount ?? 0),
      0,
    ),
    complete: pages.every((page) => page.complete),
    annualRecords: [...annual.values()],
    roeSources: [...roe.values()],
    employerContributions: {
      cppCents: pages.reduce(
        (total, page) => total + (page.employerContributions?.cppCents ?? 0),
        0,
      ),
      cpp2Cents: pages.reduce(
        (total, page) => total + (page.employerContributions?.cpp2Cents ?? 0),
        0,
      ),
      eiCents: pages.reduce(
        (total, page) => total + (page.employerContributions?.eiCents ?? 0),
        0,
      ),
    },
    warnings: [...new Set(pages.flatMap((page) => page.warnings ?? []))],
    blockers: [...new Set(pages.flatMap((page) => page.blockers ?? []))],
  };
}
const blankAddress = (): PayrollFilingAddress => ({
  line1: "",
  line2: "",
  city: "",
  province: "BC",
  country: "CAN",
  postalCode: "",
});
const emptyIdentity = (employeeId: string): PayrollFilingPerson => ({
  employeeId,
  givenName: "",
  surname: "",
  initial: "",
  sin: "",
  address: blankAddress(),
});
function TextField({
  label,
  value,
  set,
  type = "text",
  hint,
  disabled,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  type?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type={type}
        disabled={disabled}
        value={value}
        onChange={(event) => set(event.target.value)}
        autoComplete="off"
      />
    </Field>
  );
}
function AddressFields({
  value,
  set,
  prefix,
}: {
  value: PayrollFilingAddress;
  set: (value: PayrollFilingAddress) => void;
  prefix: string;
}) {
  return (
    <div className="form-grid">
      {(
        [
          ["line1", "Street address"],
          ["line2", "Address line 2"],
          ["city", "City"],
          ["province", "Province/state code"],
          ["country", "Country code"],
          ["postalCode", "Postal/ZIP code"],
        ] as const
      ).map(([key, label]) => (
        <TextField
          key={key}
          label={`${prefix} ${label}`}
          value={value[key] ?? ""}
          set={(next) => set({ ...value, [key]: next })}
        />
      ))}
    </div>
  );
}
function IdentityFields({
  value,
  set,
  prefix,
}: {
  value: PayrollFilingPerson;
  set: (value: PayrollFilingPerson) => void;
  prefix: string;
}) {
  return (
    <>
      <div className="form-grid">
        <TextField
          label={`${prefix} Given name`}
          value={value.givenName}
          set={(givenName) => set({ ...value, givenName })}
        />
        <TextField
          label={`${prefix} Surname`}
          value={value.surname}
          set={(surname) => set({ ...value, surname })}
        />
        <TextField
          label={`${prefix} Initial`}
          value={value.initial ?? ""}
          set={(initial) => set({ ...value, initial })}
        />
        <TextField
          label={`${prefix} SIN`}
          value={value.sin}
          set={(sin) => set({ ...value, sin })}
          type="password"
          hint="Transient only. Cleared when this panel closes or year/workspace changes."
        />
      </div>
      <AddressFields
        prefix={prefix}
        value={value.address}
        set={(address) => set({ ...value, address })}
      />
    </>
  );
}
type ExtraInfo = { code: string; amount: string };
function OtherInformationEditor({
  version,
  form,
  value,
  set,
}: {
  version: CraSubmissionVersion;
  form: "t4" | "t4a";
  value: ExtraInfo[];
  set: (value: ExtraInfo[]) => void;
}) {
  const fields = payrollOtherInformationFields(version, form);
  return (
    <details>
      <summary>Additional {form.toUpperCase()} information codes</summary>
      <p>
        Choose the actual reporting box and amount. Amounts already included in
        employment income must remain included there. Beyond six T4 or twelve
        T4A information boxes, additional slips are generated without repeating
        financial totals.
      </p>
      {value.map((row, index) => (
        <div className="form-grid" key={index}>
          <Field label={`Other information ${index + 1} code`}>
            <select
              className="input"
              value={row.code}
              onChange={(event) =>
                set(
                  value.map((item, i) =>
                    i === index ? { ...item, code: event.target.value } : item,
                  ),
                )
              }
            >
              <option value="">Choose code</option>
              {Object.entries(fields)
                .filter(
                  ([, field]) =>
                    /Decimal/i.test(field.type) && !field.reservedForCra,
                )
                .map(([code, field]) => (
                  <option key={code} value={code}>
                    {code} — {field.label}
                  </option>
                ))}
            </select>
          </Field>
          <TextField
            label={`Other information ${index + 1} amount`}
            value={row.amount}
            set={(amount) =>
              set(
                value.map((item, i) =>
                  i === index ? { ...item, amount } : item,
                ),
              )
            }
          />
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => set(value.filter((_, i) => i !== index))}
          >
            Remove information {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--sm"
        disabled={value.length >= Object.keys(fields).length}
        onClick={() => set([...value, { code: "", amount: "" }])}
      >
        Add information code
      </button>
    </details>
  );
}
const money = (value: string, label: string) =>
  payrollMoney(value, label, false)!;
function informationMoney(
  value: string,
  code: string,
  form: "t4" | "t4a",
  version: CraSubmissionVersion,
) {
  const field = payrollOtherInformationFields(version, form)[
    String(code).padStart(form === "t4" ? 2 : 3, "0")
  ];
  if (!field?.type.startsWith("signed"))
    return money(value, "Additional reporting code");
  const amount = parseMoneyInput(value);
  if (amount === undefined || !Number.isSafeInteger(amount))
    throw new Error(
      "Enter a valid signed amount for the selected reporting code.",
    );
  return amount;
}
function FilingEditor({
  societyId,
  year,
  context,
  names,
  roeCase,
  onRoeGenerated,
}: {
  societyId: string;
  year: number;
  context: FilingContext;
  names: Map<string, string>;
} & RoeCaseExportProps) {
  const { canExport } = useFinancePermissions();
  const [form, setForm] = useState<"T4" | "T4A" | "ROE">(
      roeCase ? "ROE" : "T4",
    ),
    [submissionVersion, setSubmissionVersion] =
      useState<CraSubmissionVersion>("2026"),
    [reportType, setReportType] = useState<"O" | "A">("O"),
    [amendmentNote, setAmendmentNote] = useState("");
  const [employerName, setEmployerName] = useState(context.employerName),
    [employerAddress, setEmployerAddress] = useState(blankAddress),
    [payrollAccount, setPayrollAccount] = useState("");
  const [contactName, setContactName] = useState(""),
    [area, setArea] = useState(""),
    [telephone, setTelephone] = useState(""),
    [extension, setExtension] = useState("");
  const [transmitterName, setTransmitterName] = useState(context.employerName),
    [transmitterAccount, setTransmitterAccount] = useState(""),
    [email, setEmail] = useState(""),
    [reference, setReference] = useState(""),
    [language, setLanguage] = useState<"E" | "F">("E");
  const [complete, setComplete] = useState(false),
    [sameEmployer, setSameEmployer] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<PayrollXmlExport | null>(null);
  const [identities, setIdentities] = useState<
      Record<string, PayrollFilingPerson>
    >({}),
    [dental, setDental] = useState<Record<string, string>>({}),
    [cpp, setCpp] = useState<Record<string, string>>({}),
    [ei, setEi] = useState<Record<string, string>>({});
  const [earningsLimits, setEarningsLimits] = useState({
      pensionable: "",
      insurable: "",
      source: "",
    }),
    [boxEarnings, setBoxEarnings] = useState<
      Record<string, { pensionable: string; insurable: string }>
    >({});
  const [rpp, setRpp] = useState<
    Record<
      string,
      {
        amount: string;
        registration: string;
        union: string;
        pension: string;
        confirmed: boolean;
      }
    >
  >({});
  const [t4Extras, setT4Extras] = useState<Record<string, ExtraInfo[]>>({});
  const [t4aRows, setT4aRows] = useState<
    Array<{
      employeeId: string;
      fees: string;
      other: string;
      tax: string;
      pension: string;
      lump: string;
      commission: string;
      annuity: string;
      confirmed: boolean;
      corporation: boolean;
      corporationName: string;
      businessNumber: string;
      extra: ExtraInfo[];
    }>
  >([]);
  const [roePayrollReference, setRoePayrollReference] = useState(""),
    [roeEmployee, setRoeEmployee] = useState(roeCase?.employeeId ?? ""),
    [first, setFirst] = useState(roeCase?.facts.firstDayWorked ?? ""),
    [last, setLast] = useState(roeCase?.facts.lastDayPaid ?? ""),
    [final, setFinal] = useState(roeCase?.facts.periodEnd ?? ""),
    [reason, setReason] = useState<(typeof ROE_REASONS)[number]>(
      roeCase?.facts.reasonCode ?? "A00",
    ),
    [recall, setRecall] = useState<"N" | "U" | "Y">("U"),
    [recallDate, setRecallDate] = useState(""),
    [roeContactGiven, setRoeContactGiven] = useState(""),
    [roeContactSurname, setRoeContactSurname] = useState(""),
    [occupation, setOccupation] = useState(""),
    [comments, setComments] = useState(
      roeCase?.amendmentOriginalSerial &&
        /^[AEKLZ]/.test(roeCase.amendmentOriginalSerial)
        ? `Amending a paper ROE ${roeCase.amendmentOriginalSerial}`
        : "",
    ),
    [amendedSerial, setAmendedSerial] = useState(
      roeCase?.amendmentOriginalSerial ?? "",
    ),
    [payCode, setPayCode] = useState<keyof typeof ROE_PAY_PERIODS>(
      roeCase?.facts.payPeriodCode ?? "B",
    ),
    [separationReviewed, setSeparationReviewed] = useState(false),
    [vacationCode, setVacationCode] = useState(""),
    [vacationAmount, setVacationAmount] = useState(""),
    [vacationStart, setVacationStart] = useState(""),
    [vacationEnd, setVacationEnd] = useState("");
  const [holidays, setHolidays] = useState<
      Array<{ date: string; amount: string }>
    >([]),
    [otherMonies, setOtherMonies] = useState<
      Array<{ code: string; start: string; end: string; amount: string }>
    >([]),
    [specialPayments, setSpecialPayments] = useState<
      Array<{
        code: string;
        start: string;
        end: string;
        amount: string;
        period: string;
      }>
    >([]);
  const [periods, setPeriods] = useState<
    Array<{ start: string; end: string; earnings: string; hours: string }>
  >(() =>
    roeCase
      ? (
          context.roeSources.find(
            (row) => row.employeeId === roeCase.employeeId,
          )?.periods ?? []
        ).map((row) => ({
          start: row.periodStart,
          end: row.periodEnd,
          earnings: amountInput(row.insurableEarningsCents),
          hours: String(row.insurableHours),
        }))
      : [],
  );
  const [generating, setGenerating] = useState(false);
  const identity = (id: string) => identities[id] ?? emptyIdentity(id),
    saveIdentity = (value: PayrollFilingPerson) =>
      setIdentities((old) => ({ ...old, [value.employeeId]: value }));
  const safeDownload = async (next: PayrollXmlExport) => {
    if (roeCase && form === "ROE") await onRoeGenerated?.(next);
    setResult(next);
    triggerBlobDownload(
      new Blob([next.xml], { type: "application/xml;charset=utf-8" }),
      next.filename,
    );
  };
  useEffect(() => {
    setComplete(false);
    setSameEmployer(false);
    setResult(null);
  }, [context]);
  const sourceBlocked = !context.complete || context.blockers.length > 0;
  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError("");
    setResult(null);
    try {
      if (!canExport) throw new Error("Payroll export permission is required.");
      const employer = {
        name: employerName,
        payrollAccount,
        address: employerAddress,
        contactName,
        contactAreaCode: area,
        contactPhone: telephone,
        contactExtension: extension || undefined,
      };
      const base = {
        submissionVersion,
        earningsYear: year,
        currency: "CAD" as const,
        submissionReference: reference,
        reportType,
        amendmentNote: amendmentNote || undefined,
        employer,
        transmitter: {
          accountNumber: transmitterAccount,
          name: transmitterName,
          country: employerAddress.country,
          contactName,
          contactAreaCode: area,
          contactPhone: telephone,
          contactExtension: extension || undefined,
          contactEmail: email,
          language,
        },
        recordsComplete: complete,
        sameEmployerConfirmed: sameEmployer,
      };
      if (form === "T4") {
        if (sourceBlocked)
          throw new Error(
            "Resolve the recorded source-data blockers before exporting T4 slips.",
          );
        await safeDownload(
          exportT4Xml({
            ...base,
            annualLimits: reviewedT4AnnualLimits(year) ?? {
              earningsYear: year,
              pensionableMaximumCents: money(
                earningsLimits.pensionable,
                "Reviewed annual pensionable maximum",
              ),
              insurableMaximumCents: money(
                earningsLimits.insurable,
                "Reviewed annual insurable maximum",
              ),
              source: earningsLimits.source,
            },
            records: context.annualRecords.map((row) => ({
              ...row,
              pensionableEarningsCents: boxEarnings[
                `${row.employeeId}:${row.provinceOfEmployment}`
              ]?.pensionable
                ? money(
                    boxEarnings[`${row.employeeId}:${row.provinceOfEmployment}`]
                      .pensionable,
                    "Reviewed box 26",
                  )
                : row.pensionableEarningsCents,
              insurableEarningsCents: boxEarnings[
                `${row.employeeId}:${row.provinceOfEmployment}`
              ]?.insurable
                ? money(
                    boxEarnings[`${row.employeeId}:${row.provinceOfEmployment}`]
                      .insurable,
                    "Reviewed box 24",
                  )
                : row.insurableEarningsCents,
              dentalBenefitsCode: dental[row.employeeId] as any,
              cppExempt:
                cpp[row.employeeId] === "" || !cpp[row.employeeId]
                  ? undefined
                  : cpp[row.employeeId] === "yes",
              eiExempt:
                ei[row.employeeId] === "" || !ei[row.employeeId]
                  ? undefined
                  : ei[row.employeeId] === "yes",
              rppClassificationConfirmed:
                rpp[row.employeeId]?.confirmed ?? false,
              rppContributionsCents: rpp[row.employeeId]?.amount
                ? money(rpp[row.employeeId].amount, "Reviewed RPP box 20")
                : row.rppContributionsCents,
              rppRegistrationNumber:
                rpp[row.employeeId]?.registration || row.rppRegistrationNumber,
              unionDuesCents: rpp[row.employeeId]?.union
                ? money(rpp[row.employeeId].union, "Reviewed union dues")
                : row.unionDuesCents,
              pensionAdjustmentCents: rpp[row.employeeId]?.pension
                ? money(
                    rpp[row.employeeId].pension,
                    "Reviewed pension adjustment",
                  )
                : row.pensionAdjustmentCents,
              otherInformation: [
                ...(row.otherInformation ?? []).filter(
                  (info) =>
                    !(t4Extras[row.employeeId] ?? []).some(
                      (extra) => extra.code === info.code,
                    ),
                ),
                ...(t4Extras[row.employeeId] ?? []).map((extra) => ({
                  code: extra.code,
                  amountCents: informationMoney(
                    extra.amount,
                    extra.code,
                    "t4",
                    submissionVersion,
                  ),
                })),
              ],
            })),
            identities: Object.values(identities),
            employerContributions: context.employerContributions,
          }),
        );
      } else if (form === "T4A")
        await safeDownload(
          exportT4AXml({
            ...base,
            records: t4aRows.map((row) => ({
              employeeId: row.employeeId,
              classificationConfirmed: row.confirmed,
              feesForServicesCents: money(row.fees, "Fees for services"),
              otherIncomeCents: money(row.other, "Other income"),
              incomeTaxCents: money(row.tax, "T4A income tax"),
              pensionIncomeCents: row.pension
                ? money(row.pension, "Pension income")
                : undefined,
              lumpSumCents: row.lump
                ? money(row.lump, "Lump-sum payments")
                : undefined,
              selfEmployedCommissionsCents: row.commission
                ? money(row.commission, "Self-employed commissions")
                : undefined,
              annuityIncomeCents: row.annuity
                ? money(row.annuity, "Annuity income")
                : undefined,
              otherInformation: row.extra.map((extra) => ({
                code: extra.code,
                amountCents: informationMoney(
                  extra.amount,
                  extra.code,
                  "t4a",
                  submissionVersion,
                ),
              })),
            })),
            identities: t4aRows.map((row) =>
              row.corporation
                ? {
                    employeeId: row.employeeId,
                    corporationName: row.corporationName,
                    businessNumber: row.businessNumber,
                    address: identity(row.employeeId).address,
                  }
                : identity(row.employeeId),
            ),
          }),
        );
      else
        await safeDownload(
          exportRoeXml({
            currency: "CAD",
            payrollAccount,
            employee: identity(roeCase?.employeeId ?? roeEmployee),
            printingLanguage: language,
            issue: "S",
            amendedSerialNumber:
              roeCase?.amendmentOriginalSerial ?? (amendedSerial || undefined),
            payrollReference: roePayrollReference || undefined,
            payPeriodCode: roeCase?.facts.payPeriodCode ?? payCode,
            firstDayWorked: roeCase?.facts.firstDayWorked ?? first,
            lastDayPaid: roeCase?.facts.lastDayPaid ?? last,
            finalPayPeriodEnd: roeCase?.facts.periodEnd ?? final,
            occupation: occupation || undefined,
            recall: {
              code: recall,
              date: recall === "Y" ? recallDate : undefined,
            },
            reason: roeCase?.facts.reasonCode ?? reason,
            contact: {
              givenName: roeContactGiven,
              surname: roeContactSurname,
              areaCode: area,
              phone: telephone,
              extension: extension || undefined,
            },
            payPeriods: periods.map((row) => ({
              startDate: row.start,
              endDate: row.end,
              insurableEarningsCents: money(
                row.earnings,
                "Historical insurable earnings",
              ),
              insurableHours: Number(row.hours),
            })),
            recordsComplete: complete,
            sameEmployerConfirmed: sameEmployer,
            separationPaymentsReviewed: separationReviewed,
            statutoryHolidays: holidays.map((row) => ({
              date: row.date || undefined,
              amountCents: money(row.amount, "Separation statutory holiday"),
            })),
            otherMonies: otherMonies.map((row) => ({
              code: row.code,
              startDate: row.start || undefined,
              endDate: row.end || undefined,
              amountCents: row.amount
                ? money(row.amount, "Other separation monies")
                : undefined,
            })),
            specialPayments: specialPayments.map((row) => ({
              code: row.code as any,
              startDate: row.start || undefined,
              endDate: row.end || undefined,
              amountCents: row.amount
                ? money(row.amount, "Special payments")
                : undefined,
              period: (row.period || undefined) as any,
            })),
            comments: comments || undefined,
            vacation: vacationCode
              ? {
                  code: vacationCode as any,
                  startDate: vacationStart || undefined,
                  endDate: vacationEnd || undefined,
                  amountCents: vacationAmount
                    ? money(vacationAmount, "Vacation pay")
                    : undefined,
                }
              : undefined,
          }),
        );
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setGenerating(false);
    }
  };
  const clear = () => {
    setIdentities({});
    setPayrollAccount("");
    setTransmitterAccount("");
    setT4aRows((old) => old.map((row) => ({ ...row, businessNumber: "" })));
    setResult(null);
  };
  const loadRoe = (id: string) => {
    setRoeEmployee(id);
    const source = context.roeSources.find((row) => row.employeeId === id);
    setPeriods(
      source?.periods.map((row) => ({
        start: row.periodStart,
        end: row.periodEnd,
        earnings: amountInput(row.insurableEarningsCents),
        hours: String(row.insurableHours),
      })) ?? [],
    );
    setPayCode(
      ({ weekly: "W", biweekly: "B", semimonthly: "S", monthly: "M" } as const)[
        source?.payFrequency as "weekly"
      ] ?? "B",
    );
    setFinal(source?.periods[0]?.periodEnd ?? "");
    setLast("");
    setFirst("");
    setComplete(false);
  };
  const reconciliation = () => {
    const rows = [
      ["Earnings year", String(year)],
      ["Source records", String(context.sourceCount)],
      ["Source completeness", String(context.complete)],
      ...context.blockers.map((message) => ["Blocker", message]),
      ...context.warnings.map((message) => ["Warning", message]),
      [
        "Employee",
        "Province",
        "Employment income cents",
        "CPP cents",
        "CPP2 cents",
        "EI cents",
        "Income tax cents",
        "Pensionable cents",
        "Insurable cents",
        "Complete",
      ],
      ...context.annualRecords.map((row) => [
        names.get(row.employeeId) ?? row.employeeId,
        row.provinceOfEmployment,
        String(row.employmentIncomeCents),
        String(row.cppEmployeeCents),
        String(row.cpp2EmployeeCents),
        String(row.eiEmployeeCents),
        String(row.incomeTaxCents),
        String(row.pensionableEarningsCents),
        String(row.insurableEarningsCents),
        String(row.complete),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(/^[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    triggerBlobDownload(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
      `Payroll reconciliation ${year}.csv`,
    );
  };
  return (
    <div className="form-stack">
      <p>
        XML files are generated locally from reviewed data. Sensitive filing
        identifiers remain in this panel’s memory and the downloaded file.
        Exporting does not submit a return.
      </p>
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn btn--sm"
          disabled={!canExport}
          onClick={reconciliation}
        >
          Export source reconciliation CSV
        </button>
        <button type="button" className="btn btn--sm" onClick={clear}>
          Clear transient filing identifiers
        </button>
      </div>
      <p>
        {context.sourceCount} recorded payroll sources ·{" "}
        {context.annualRecords.length} employee/province totals.{" "}
        {context.employerAddress &&
          `Recorded employer address: ${context.employerAddress}.`}{" "}
        {context.payrollAccountLast4 &&
          `RP account ending ${context.payrollAccountLast4}.`}
      </p>
      {context.blockers.map((message, index) => (
        <p className="payroll-calculator__blockers" key={index}>
          {message}
        </p>
      ))}
      {context.warnings.map((message, index) => (
        <p className="muted" key={index}>
          {message}
        </p>
      ))}
      <div className="form-grid">
        <Field label="Filing format">
          <select
            className="input"
            value={form}
            disabled={Boolean(roeCase)}
            onChange={(e) => {
              setForm(e.target.value as any);
              setResult(null);
            }}
          >
            <option>T4</option>
            <option>T4A</option>
            <option value="ROE">Record of employment (ROE)</option>
          </select>
        </Field>
        {form !== "ROE" && (
          <>
            <Field label="Submission schema version">
              <select
                className="input"
                value={submissionVersion}
                onChange={(e) =>
                  setSubmissionVersion(e.target.value as CraSubmissionVersion)
                }
              >
                <option value="2026">
                  2026 — accepted through December 22, 2026
                </option>
                <option value="2027">
                  2027 — accepted from January 11, 2027
                </option>
              </select>
            </Field>
            <Field label="Return type">
              <select
                className="input"
                value={reportType}
                onChange={(e) => setReportType(e.target.value as any)}
              >
                <option value="O">Original</option>
                <option value="A">Amended</option>
              </select>
            </Field>
            <TextField
              label="Submission reference (1–8 letters/digits)"
              value={reference}
              set={setReference}
            />
            {reportType === "A" && (
              <TextField
                label="Amendment explanation"
                value={amendmentNote}
                set={setAmendmentNote}
              />
            )}
          </>
        )}
        <Field label="Filing language">
          <select
            className="input"
            value={language}
            onChange={(e) => setLanguage(e.target.value as any)}
          >
            <option value="E">English</option>
            <option value="F">French</option>
          </select>
        </Field>
      </div>
      <fieldset>
        <legend>Legal employer and contact</legend>
        <div className="form-grid">
          <TextField
            label="Legal employer name"
            value={employerName}
            set={setEmployerName}
          />
          <TextField
            label="BN/RP payroll account"
            value={payrollAccount}
            set={setPayrollAccount}
          />
          <TextField
            label="Filing contact name"
            value={contactName}
            set={setContactName}
          />
          <TextField label="Contact area code" value={area} set={setArea} />
          <TextField
            label="Contact seven-digit phone"
            value={telephone}
            set={setTelephone}
          />
          <TextField
            label="Contact extension"
            value={extension}
            set={setExtension}
          />
        </div>
        <AddressFields
          prefix="Employer"
          value={employerAddress}
          set={setEmployerAddress}
        />
      </fieldset>
      {form !== "ROE" && (
        <fieldset>
          <legend>T619 transmitter</legend>
          <div className="form-grid">
            <TextField
              label="Transmitter name"
              value={transmitterName}
              set={setTransmitterName}
            />
            <TextField
              label="Transmitter BN9 or BN15"
              value={transmitterAccount}
              set={setTransmitterAccount}
            />
            <TextField
              label="Transmitter contact email"
              value={email}
              set={setEmail}
            />
          </div>
          <p>
            <a
              href={CRA_SUBMISSION_SCHEMAS[submissionVersion].source}
              target="_blank"
              rel="noreferrer"
            >
              Official CRA {submissionVersion} XML schemas
            </a>
            . The earnings year is {year}; schema selection changes the
            submission format independently.
          </p>
        </fieldset>
      )}
      {form === "T4" && (
        <section aria-label="T4 recipients">
          <h3>T4 recipients and reviewed reporting codes</h3>
          {reviewedT4AnnualLimits(year) ? (
            <p>
              Reviewed {year} annual filing maxima: pensionable earnings $
              {(
                reviewedT4AnnualLimits(year)!.pensionableMaximumCents / 100
              ).toFixed(2)}
              ; insurable earnings $
              {(
                reviewedT4AnnualLimits(year)!.insurableMaximumCents / 100
              ).toFixed(2)}
              . A single province is capped after all source pages are combined.
              Multiple provinces require reviewed allocation when their combined
              amounts exceed these limits.
            </p>
          ) : (
            <div className="form-grid">
              <TextField
                label="Reviewed earnings-year pensionable maximum"
                value={earningsLimits.pensionable}
                set={(pensionable) =>
                  setEarningsLimits((old) => ({ ...old, pensionable }))
                }
              />
              <TextField
                label="Reviewed earnings-year insurable maximum"
                value={earningsLimits.insurable}
                set={(insurable) =>
                  setEarningsLimits((old) => ({ ...old, insurable }))
                }
              />
              <TextField
                label="Official earnings-year limit source URL"
                value={earningsLimits.source}
                set={(source) =>
                  setEarningsLimits((old) => ({ ...old, source }))
                }
              />
            </div>
          )}
          {!context.annualRecords.length && (
            <p>No complete employee payroll totals for this earnings year.</p>
          )}
          {context.annualRecords.map((row) => (
            <fieldset key={`${row.employeeId}:${row.provinceOfEmployment}`}>
              <legend>
                {names.get(row.employeeId) ?? row.employeeId} ·{" "}
                {row.provinceOfEmployment}
              </legend>
              <p>
                Taxable employment income $
                {(row.employmentIncomeCents / 100).toFixed(2)} · CPP2 $
                {(row.cpp2EmployeeCents / 100).toFixed(2)} · {row.sourceCount}{" "}
                source lines ·{" "}
                {row.complete
                  ? "Complete classifications"
                  : "Source data incomplete"}
              </p>
              <IdentityFields
                prefix={names.get(row.employeeId) ?? "Recipient"}
                value={identity(row.employeeId)}
                set={saveIdentity}
              />
              <div className="form-grid">
                <Field label="Employer dental benefit code (box 45)">
                  <select
                    className="input"
                    value={dental[row.employeeId] ?? ""}
                    onChange={(e) =>
                      setDental((old) => ({
                        ...old,
                        [row.employeeId]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Choose reviewed access code</option>
                    <option value="1">1 — No access</option>
                    <option value="2">2 — Employee only</option>
                    <option value="3">
                      3 — Employee, spouse and dependent children
                    </option>
                    <option value="4">4 — Employee and spouse</option>
                    <option value="5">
                      5 — Employee and dependent children
                    </option>
                  </select>
                </Field>
                {(
                  [
                    ["CPP exempt", cpp, setCpp],
                    ["EI exempt", ei, setEi],
                  ] as const
                ).map(([label, values, set]) => (
                  <Field key={label} label={label}>
                    <select
                      className="input"
                      value={values[row.employeeId] ?? ""}
                      onChange={(e) =>
                        set((old) => ({
                          ...old,
                          [row.employeeId]: e.target.value,
                        }))
                      }
                    >
                      <option value="">Confirm status</option>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </Field>
                ))}
              </div>
              <details>
                <summary>
                  Reviewed pensionable / insurable annual earnings allocation
                </summary>
                <p>
                  Actual uncapped source bases: pensionable $
                  {(row.pensionableEarningsCents / 100).toFixed(2)}, insurable $
                  {(row.insurableEarningsCents / 100).toFixed(2)}. Leave blank
                  for the single-province annual cap. Enter actual reviewed box
                  amounts for multi-province allocations or eligibility changes.
                </p>
                <div className="form-grid">
                  {(
                    [
                      ["pensionable", "Reviewed pensionable earnings (box 26)"],
                      ["insurable", "Reviewed insurable earnings (box 24)"],
                    ] as const
                  ).map(([key, label]) => (
                    <TextField
                      key={key}
                      label={label}
                      value={
                        boxEarnings[
                          `${row.employeeId}:${row.provinceOfEmployment}`
                        ]?.[key] ?? ""
                      }
                      set={(value) =>
                        setBoxEarnings((old) => ({
                          ...old,
                          [`${row.employeeId}:${row.provinceOfEmployment}`]: {
                            ...(old[
                              `${row.employeeId}:${row.provinceOfEmployment}`
                            ] ?? { pensionable: "", insurable: "" }),
                            [key]: value,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              </details>
              <details>
                <summary>
                  Reviewed pension, union and registered-plan reporting
                </summary>
                <p>
                  Registered-plan deductions may be RRSP, RPP or RCA. Only an
                  explicitly reviewed RPP contribution belongs in box 20. Blank
                  fields retain any explicitly classified source value; enter
                  0.00 only when reviewed as zero. Generic registered-plan
                  deductions do not supply an RPP amount.
                </p>
                {row.rppClassificationRequired && (
                  <p className="payroll-calculator__notice">
                    A recorded registered-plan deduction needs classification
                    before this T4 can be exported.
                  </p>
                )}
                <div className="form-grid">
                  {(
                    [
                      ["amount", "Reviewed RPP contribution (box 20)"],
                      [
                        "registration",
                        "RPP/DPSP registration number (7 digits)",
                      ],
                      ["union", "Reviewed union dues (box 44)"],
                      ["pension", "Reviewed pension adjustment (box 52)"],
                    ] as const
                  ).map(([key, label]) => (
                    <TextField
                      key={key}
                      label={label}
                      value={rpp[row.employeeId]?.[key] ?? ""}
                      set={(value) =>
                        setRpp((old) => ({
                          ...old,
                          [row.employeeId]: {
                            ...(old[row.employeeId] ?? {
                              amount: "",
                              registration: "",
                              union: "",
                              pension: "",
                              confirmed: false,
                            }),
                            [key]: value,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={rpp[row.employeeId]?.confirmed ?? false}
                    onChange={(e) =>
                      setRpp((old) => ({
                        ...old,
                        [row.employeeId]: {
                          ...(old[row.employeeId] ?? {
                            amount: "",
                            registration: "",
                            union: "",
                            pension: "",
                            confirmed: false,
                          }),
                          confirmed: e.target.checked,
                        },
                      }))
                    }
                  />{" "}
                  I reviewed the actual registered-plan classification and the
                  RPP amount entered above.
                </label>
              </details>
              <OtherInformationEditor
                version={submissionVersion}
                form="t4"
                value={t4Extras[row.employeeId] ?? []}
                set={(value) =>
                  setT4Extras((old) => ({ ...old, [row.employeeId]: value }))
                }
              />
            </fieldset>
          ))}
        </section>
      )}
      {form === "T4A" && (
        <section>
          <h3>T4A recipients</h3>
          <p>
            Enter reviewed non-employment payment amounts. An honorarium
            description alone does not establish T4A classification. Ordinary
            employee pay remains on T4; do not duplicate the same income.
          </p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setT4aRows((old) => [
                ...old,
                {
                  employeeId: `recipient-${old.length + 1}`,
                  fees: "0.00",
                  other: "0.00",
                  tax: "0.00",
                  pension: "",
                  lump: "",
                  commission: "",
                  annuity: "",
                  confirmed: false,
                  corporation: false,
                  corporationName: "",
                  businessNumber: "",
                  extra: [],
                },
              ])
            }
          >
            Add T4A recipient
          </button>
          {t4aRows.map((row, index) => {
            const change = (fields: Partial<typeof row>) =>
              setT4aRows((old) =>
                old.map((item, i) =>
                  i === index ? { ...item, ...fields } : item,
                ),
              );
            return (
              <fieldset key={row.employeeId}>
                <legend>T4A recipient {index + 1}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={row.corporation}
                    onChange={(e) => change({ corporation: e.target.checked })}
                  />{" "}
                  Recipient is a corporation
                </label>
                {row.corporation ? (
                  <>
                    <TextField
                      label="Recipient corporation name"
                      value={row.corporationName}
                      set={(corporationName) => change({ corporationName })}
                    />
                    <TextField
                      label="Recipient BN15 (9 digits, program and 4-digit account)"
                      value={row.businessNumber}
                      set={(businessNumber) => change({ businessNumber })}
                    />
                    <AddressFields
                      prefix={`T4A corporation ${index + 1}`}
                      value={identity(row.employeeId).address}
                      set={(address) =>
                        saveIdentity({ ...identity(row.employeeId), address })
                      }
                    />
                  </>
                ) : (
                  <IdentityFields
                    prefix={`T4A recipient ${index + 1}`}
                    value={identity(row.employeeId)}
                    set={saveIdentity}
                  />
                )}
                <div className="form-grid">
                  <TextField
                    label="Fees for services (box 48)"
                    value={row.fees}
                    set={(fees) => change({ fees })}
                  />
                  <TextField
                    label="Other income (box 28)"
                    value={row.other}
                    set={(other) => change({ other })}
                  />
                  <TextField
                    label="Income tax deducted (box 22)"
                    value={row.tax}
                    set={(tax) => change({ tax })}
                  />
                  <TextField
                    label="Pension/superannuation (box 16)"
                    value={row.pension}
                    set={(pension) => change({ pension })}
                  />
                  <TextField
                    label="Lump-sum payments (box 18)"
                    value={row.lump}
                    set={(lump) => change({ lump })}
                  />
                  <TextField
                    label="Self-employed commissions (box 20)"
                    value={row.commission}
                    set={(commission) => change({ commission })}
                  />
                  <TextField
                    label="Annuities (box 24)"
                    value={row.annuity}
                    set={(annuity) => change({ annuity })}
                  />
                </div>
                <OtherInformationEditor
                  version={submissionVersion}
                  form="t4a"
                  value={row.extra}
                  set={(extra) => change({ extra })}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={row.confirmed}
                    onChange={(e) => change({ confirmed: e.target.checked })}
                  />{" "}
                  I reviewed this recipient’s relationship and the correct T4A
                  reporting category.
                </label>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    setT4aRows((old) => old.filter((_, i) => i !== index))
                  }
                >
                  Remove recipient {index + 1}
                </button>
              </fieldset>
            );
          })}
        </section>
      )}
      {form === "ROE" && (
        <section>
          <h3>Record of employment</h3>
          <Field label="ROE employee">
            <select
              className="input"
              value={roeEmployee}
              disabled={Boolean(roeCase)}
              onChange={(e) => loadRoe(e.target.value)}
            >
              <option value="">Select employee</option>
              {[...names].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          {roeEmployee &&
            context.roeSources.find((row) => row.employeeId === roeEmployee)
              ?.complete === false && (
              <p role="status" className="payroll-calculator__notice">
                Recorded ROE history is incomplete. Add and review the missing
                historical pay periods and insurable hours before confirming
                completeness.
              </p>
            )}
          {roeEmployee && (
            <IdentityFields
              prefix="ROE employee"
              value={identity(roeEmployee)}
              set={saveIdentity}
            />
          )}
          <div className="form-grid">
            <TextField
              label="First day worked since previous ROE"
              value={first}
              set={setFirst}
              disabled={Boolean(roeCase)}
              type="date"
            />
            <TextField
              label="Last day for which paid"
              value={last}
              set={setLast}
              disabled={Boolean(roeCase)}
              type="date"
            />
            <TextField
              label="Final pay period ending"
              value={final}
              set={setFinal}
              disabled={Boolean(roeCase)}
              type="date"
            />
            <TextField
              label="Employer payroll reference (optional)"
              value={roePayrollReference}
              set={setRoePayrollReference}
            />
            <TextField
              label="Occupation"
              value={occupation}
              set={setOccupation}
            />
            <TextField
              label="Original ROE serial if amending"
              value={amendedSerial}
              set={setAmendedSerial}
              disabled={Boolean(roeCase)}
            />
            <Field label="ROE pay-period frequency">
              <select
                className="input"
                value={payCode}
                disabled={Boolean(roeCase)}
                onChange={(e) => setPayCode(e.target.value as any)}
              >
                {Object.keys(ROE_PAY_PERIODS).map((code) => (
                  <option key={code} value={code}>
                    {code} —{" "}
                    {
                      ROE_PAY_PERIOD_LABELS[
                        code as keyof typeof ROE_PAY_PERIODS
                      ]
                    }
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason for issuing ROE">
              <select
                className="input"
                value={reason}
                disabled={Boolean(roeCase)}
                onChange={(e) => setReason(e.target.value as any)}
              >
                {ROE_REASONS.map((code) => (
                  <option key={code} value={code}>
                    {code} — {ROE_REASON_LABELS[code]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expected recall">
              <select
                className="input"
                value={recall}
                onChange={(e) => setRecall(e.target.value as any)}
              >
                <option value="U">Unknown</option>
                <option value="N">Not returning</option>
                <option value="Y">Expected date</option>
              </select>
            </Field>
            {recall === "Y" && (
              <TextField
                label="Expected recall date"
                value={recallDate}
                set={setRecallDate}
                type="date"
              />
            )}
            <TextField
              label="ROE contact given name"
              value={roeContactGiven}
              set={setRoeContactGiven}
            />
            <TextField
              label="ROE contact surname"
              value={roeContactSurname}
              set={setRoeContactSurname}
            />
            <TextField
              label="ROE comments"
              value={comments}
              set={setComments}
            />
          </div>
          <h4>Insurable earnings and hours — most recent period first</h4>
          <p>
            Every consecutive period, including zero-earnings periods, must be
            present back to the first day worked or the official lookback (
            {ROE_PAY_PERIODS[payCode]} periods). The total hours are rounded
            upward once.
          </p>
          {periods.map((row, index) => (
            <div className="form-grid" key={index}>
              {(
                [
                  ["start", "Period start", "date"],
                  ["end", "Period end", "date"],
                  ["earnings", "Insurable earnings", "text"],
                  ["hours", "Insurable hours", "text"],
                ] as const
              ).map(([key, label, type]) => (
                <TextField
                  key={key}
                  label={`PP${index + 1} ${label}`}
                  type={type}
                  value={row[key]}
                  set={(next) =>
                    setPeriods((old) =>
                      old.map((item, i) =>
                        i === index ? { ...item, [key]: next } : item,
                      ),
                    )
                  }
                />
              ))}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() =>
                  setPeriods((old) => old.filter((_, i) => i !== index))
                }
              >
                Remove PP{index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setPeriods((old) => [
                ...old,
                { start: "", end: "", earnings: "0.00", hours: "0" },
              ])
            }
          >
            Add earlier pay period
          </button>
          <div className="form-grid">
            <Field label="Vacation pay reporting">
              <select
                className="input"
                value={vacationCode}
                onChange={(e) => setVacationCode(e.target.value)}
              >
                <option value="">No vacation entry</option>
                <option value="1">Included with each pay</option>
                <option value="2">Paid because no longer working</option>
                <option value="3">Vacation leave period</option>
                <option value="4">Anniversary payment</option>
              </select>
            </Field>
            {vacationCode && vacationCode !== "1" && (
              <TextField
                label="ROE vacation amount"
                value={vacationAmount}
                set={setVacationAmount}
              />
            )}{" "}
            {["3", "4"].includes(vacationCode) && (
              <TextField
                label="Vacation start date"
                value={vacationStart}
                set={setVacationStart}
                type="date"
              />
            )}
            {vacationCode === "3" && (
              <TextField
                label="Vacation end date"
                value={vacationEnd}
                set={setVacationEnd}
                type="date"
              />
            )}
          </div>
          <details>
            <summary>
              Additional separation amounts (blocks 17B, 17C and 19)
            </summary>
            <h4>Statutory holidays after the last day paid</h4>
            {holidays.map((row, index) => (
              <div className="form-grid" key={index}>
                <TextField
                  label={`Holiday ${index + 1} date`}
                  type="date"
                  value={row.date}
                  set={(date) =>
                    setHolidays((old) =>
                      old.map((item, i) =>
                        i === index ? { ...item, date } : item,
                      ),
                    )
                  }
                />
                <TextField
                  label={`Holiday ${index + 1} amount`}
                  value={row.amount}
                  set={(amount) =>
                    setHolidays((old) =>
                      old.map((item, i) =>
                        i === index ? { ...item, amount } : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    setHolidays((old) => old.filter((_, i) => i !== index))
                  }
                >
                  Remove holiday {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--sm"
              disabled={holidays.length >= 10}
              onClick={() =>
                setHolidays((old) => [...old, { date: "", amount: "" }])
              }
            >
              Add statutory holiday
            </button>
            <h4>Other separation monies</h4>
            {otherMonies.map((row, index) => {
              const rule = ROE_OTHER_MONIES[row.code],
                change = (fields: Partial<typeof row>) =>
                  setOtherMonies((old) =>
                    old.map((item, i) =>
                      i === index ? { ...item, ...fields } : item,
                    ),
                  );
              return (
                <div className="form-grid" key={index}>
                  <Field label={`Other monies ${index + 1} code`}>
                    <select
                      className="input"
                      value={row.code}
                      onChange={(e) =>
                        change({ code: e.target.value, start: "", end: "" })
                      }
                    >
                      {Object.keys(ROE_OTHER_MONIES).map((code) => (
                        <option key={code} value={code}>
                          {code} — {ROE_OTHER_MONEY_LABELS[code]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {rule?.start && (
                    <TextField
                      label={`Other monies ${index + 1} start`}
                      type="date"
                      value={row.start}
                      set={(start) => change({ start })}
                    />
                  )}{" "}
                  {rule?.end && (
                    <TextField
                      label={`Other monies ${index + 1} end`}
                      type="date"
                      value={row.end}
                      set={(end) => change({ end })}
                    />
                  )}
                  <TextField
                    label={`Other monies ${index + 1} amount`}
                    value={row.amount}
                    set={(amount) => change({ amount })}
                  />
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() =>
                      setOtherMonies((old) => old.filter((_, i) => i !== index))
                    }
                  >
                    Remove other monies {index + 1}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn--sm"
              disabled={otherMonies.length >= 3}
              onClick={() =>
                setOtherMonies((old) => [
                  ...old,
                  { code: "Y00", start: "", end: "", amount: "" },
                ])
              }
            >
              Add other monies
            </button>
            <h4>Special payments</h4>
            {specialPayments.map((row, index) => {
              const change = (fields: Partial<typeof row>) =>
                setSpecialPayments((old) =>
                  old.map((item, i) =>
                    i === index ? { ...item, ...fields } : item,
                  ),
                );
              return (
                <div className="form-grid" key={index}>
                  <Field label={`Special payment ${index + 1} code`}>
                    <select
                      className="input"
                      value={row.code}
                      onChange={(e) => change({ code: e.target.value })}
                    >
                      <option value="PSL01">Paid sick leave (insurable)</option>
                      <option value="MAT01">
                        Paid maternity / parental / care leave
                      </option>
                      <option value="WLI01">
                        Wage loss indemnity (not insurable)
                      </option>
                      <option value="WLI02">
                        Wage loss indemnity (insurable)
                      </option>
                    </select>
                  </Field>
                  <TextField
                    label={`Special payment ${index + 1} start`}
                    value={row.start}
                    type="date"
                    set={(start) => change({ start })}
                  />
                  <TextField
                    label={`Special payment ${index + 1} end`}
                    value={row.end}
                    type="date"
                    set={(end) => change({ end })}
                  />
                  <TextField
                    label={`Special payment ${index + 1} amount`}
                    value={row.amount}
                    set={(amount) => change({ amount })}
                  />
                  <Field label={`Special payment ${index + 1} frequency`}>
                    <select
                      className="input"
                      value={row.period}
                      onChange={(e) => change({ period: e.target.value })}
                    >
                      <option value="">Unspecified</option>
                      <option value="D">Per day</option>
                      <option value="W">Per week</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() =>
                      setSpecialPayments((old) =>
                        old.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove special payment {index + 1}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn--sm"
              disabled={specialPayments.length >= 4}
              onClick={() =>
                setSpecialPayments((old) => [
                  ...old,
                  { code: "PSL01", start: "", end: "", amount: "", period: "" },
                ])
              }
            >
              Add special payment
            </button>
          </details>
          <label>
            <input
              type="checkbox"
              checked={separationReviewed}
              onChange={(e) => setSeparationReviewed(e.target.checked)}
            />{" "}
            I reviewed all separation payments. Final-period earnings include
            all insurable amounts reported in the separation blocks, and all
            required entries are included above.
          </label>
        </section>
      )}
      <div className="form-stack">
        <label>
          <input
            type="checkbox"
            checked={complete}
            onChange={(e) => setComplete(e.target.checked)}
          />{" "}
          I reviewed all source records and required historical amounts for this
          export.
        </label>
        <label>
          <input
            type="checkbox"
            checked={sameEmployer}
            onChange={(e) => setSameEmployer(e.target.checked)}
          />{" "}
          These records belong to this legal employer and the entered payroll
          account.
        </label>
      </div>
      {error && (
        <p role="alert" className="payroll-calculator__blockers">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn--accent"
        onClick={generate}
        disabled={generating || !canExport || (form === "T4" && sourceBlocked)}
      >
        Download {form} XML
      </button>
      {result && (
        <p role="status">
          Generated {result.recordCount} {form} record(s), schema{" "}
          {result.schemaVersion}. Identifiers are not saved to payroll records.
          Review the downloaded file before authorized submission.
        </p>
      )}
    </div>
  );
}
export function PayrollFilingPanel({
  societyId,
  roeCase,
  onRoeGenerated,
}: { societyId: string } & RoeCaseExportProps) {
  const [year, setYear] = useState(
      roeCase
        ? Number(roeCase.facts.lastDayPaid.slice(0, 4))
        : new Date().getUTCFullYear(),
    ),
    [attempt, setAttempt] = useState(0),
    [state, setState] = useState<{
      key: string;
      pages: Map<string, FilingContext>;
    }>({ key: "", pages: new Map() });
  const key = `${societyId}:${year}:${attempt}`;
  const report = useCallback(
    (cursor: string | null, result: FilingContext | undefined) =>
      setState((old) => {
        const pages =
          old.key === key
            ? new Map(old.pages)
            : new Map<string, FilingContext>();
        if (result) pages.set(cursor ?? "", result);
        else pages.delete(cursor ?? "");
        return { key, pages };
      }),
    [key],
  );
  const employeePages = usePayrollPages<{ _id: string; name: string }>(
    { societyId, collection: "employees" },
    "Filing employee names",
  );
  const context = useMemo(() => {
    if (state.key !== key) return null;
    const ordered: FilingContext[] = [];
    const seen = new Set<string>();
    let next = "";
    while (state.pages.has(next) && !seen.has(next)) {
      seen.add(next);
      const page = state.pages.get(next)!;
      ordered.push(page);
      if (page.isDone !== false) return mergeContexts(ordered);
      next = page.continueCursor ?? "";
    }
    return null;
  }, [key, state]);
  const names = useMemo(
    () => new Map(employeePages.rows.map((row) => [row._id, row.name])),
    [employeePages.rows],
  );
  return (
    <section aria-label="Payroll filings">
      <h2>Payroll statements and government filing exports</h2>
      <Field label="Earnings year">
        <input
          className="input"
          type="number"
          min="1966"
          max="2099"
          value={year}
          disabled={Boolean(roeCase)}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isInteger(next) && next >= 1966 && next <= 2099)
              setYear(next);
          }}
        />
      </Field>
      <PayrollQueryBoundary
        key={`filing-sources:${key}`}
        label="Payroll filing sources"
        onRetry={() => setAttempt((old) => old + 1)}
      >
        <ContextPage
          societyId={societyId}
          year={year}
          cursor={null}
          seen={[]}
          report={report}
        />
      </PayrollQueryBoundary>
      {employeePages.loader}
      {context ? (
        <FilingEditor
          key={`filing-editor:${key}`}
          societyId={societyId}
          year={year}
          context={context}
          names={names}
          roeCase={roeCase}
          onRoeGenerated={onRoeGenerated}
        />
      ) : (
        <p role="status">Loading complete filing source pages…</p>
      )}
    </section>
  );
}
