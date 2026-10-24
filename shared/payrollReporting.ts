import type {
  BrandedReportData,
  BrandedReportSection,
} from "./brandedReportTypes";
import officialFieldMaps from "./payrollSchemas/fieldMaps.json";
import reviewedPayrollRates from "./payrollRates/reviewed-2026.json";
/** Immutable, identifier-free payroll reporting boundary. Filing identifiers are supplied transiently to export functions. */
export type PayrollStatementEarning = {
  key: string;
  label: string;
  code: string;
  date?: string;
  hours?: number;
  rateCents?: number;
  multiplier?: number;
  amountCents: number;
  cashCents: number;
  taxableCents: number;
  pensionableCents: number;
  insurableCents: number;
  vacationableCents: number;
  ehtCents: number;
  workSafeCents: number;
};
export type PayrollStatementTotals = {
  grossCents: number;
  taxableCents: number;
  cashCents: number;
  nonCashTaxableCents: number;
  nonTaxableCashCents: number;
  cppEmployeeCents: number;
  cpp2EmployeeCents: number;
  eiEmployeeCents: number;
  federalTaxCents?: number | null;
  provincialTaxCents?: number | null;
  additionalIncomeTaxCents?: number;
  incomeTaxCents: number;
  otherDeductionsCents: number;
  netCents: number;
  cppEmployerCents: number;
  cpp2EmployerCents: number;
  eiEmployerCents: number;
  employerCostCents: number;
};
export type PayrollStatementYearToDate = {
  year: number;
  grossCents: number;
  cashCents: number;
  taxableCents: number;
  cppEmployeeCents: number;
  cpp2EmployeeCents: number;
  eiEmployeeCents: number;
  incomeTaxCents: number;
  netCents: number;
  pensionableCents: number;
  insurableCents: number;
  insurableHours?: number;
};
export type PayrollStatement = {
  schemaVersion: 1;
  calculationId: string;
  calculationVersion: number;
  statementNumber: string;
  status: "draft" | "approved" | "finalized" | "reversed";
  employer: { name: string; address?: string; registrationNumber?: string };
  employee: {
    employeeId: string;
    name: string;
    employeeNumber?: string;
    provinceOfEmployment: string;
  };
  currency: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  runType: string;
  earnings: PayrollStatementEarning[];
  totals: PayrollStatementTotals;
  otherDeductions: Array<{ label: string; amountCents: number }>;
  employerCosts: Array<{ label: string; amountCents: number }>;
  yearToDate?: PayrollStatementYearToDate;
  rules: {
    edition: string;
    method: string;
    sources: string[];
    explanations: string[];
    inputFingerprint?: string;
    resultFingerprint?: string;
  };
  finalizedAtISO?: string;
  correctionOf?: string;
  warnings: string[];
};
export type PayrollStatementDto = PayrollStatement;
export type PayrollFilingAddress = {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  country: string;
  postalCode: string;
};
export type PayrollFilingPerson = {
  employeeId: string;
  surname: string;
  givenName: string;
  initial?: string;
  address: PayrollFilingAddress;
  sin: string;
};
export type PayrollFilingCorporation = {
  employeeId: string;
  corporationName: string;
  businessNumber: string;
  address: PayrollFilingAddress;
};
export type PayrollFilingEmployer = {
  name: string;
  payrollAccount: string;
  address: PayrollFilingAddress;
  contactName: string;
  contactAreaCode: string;
  contactPhone: string;
  contactExtension?: string;
};
export type CraSubmissionVersion = "2026" | "2027";
export type PayrollT4AnnualRecord = {
  employeeId: string;
  provinceOfEmployment: string;
  employmentIncomeCents: number;
  cppEmployeeCents: number;
  cpp2EmployeeCents: number;
  eiEmployeeCents: number;
  incomeTaxCents: number;
  pensionableEarningsCents: number;
  insurableEarningsCents: number;
  dentalBenefitsCode?: "1" | "2" | "3" | "4" | "5";
  cppExempt?: boolean;
  eiExempt?: boolean;
  rppContributionsCents?: number;
  unionDuesCents?: number;
  pensionAdjustmentCents?: number;
  rppRegistrationNumber?: string;
  rppClassificationRequired?: boolean;
  rppClassificationConfirmed?: boolean;
  otherInformation?: Array<{ code: string; amountCents: number }>;
};
export type PayrollT4AAnnualRecord = {
  employeeId: string;
  classificationConfirmed: boolean;
  feesForServicesCents?: number;
  pensionIncomeCents?: number;
  lumpSumCents?: number;
  selfEmployedCommissionsCents?: number;
  annuityIncomeCents?: number;
  otherIncomeCents?: number;
  incomeTaxCents: number;
  otherInformation?: Array<{ code: string; amountCents: number }>;
};
export type PayrollFilingReadiness = {
  earningsYear: number;
  availableSubmissionVersions: CraSubmissionVersion[];
  employerName: string;
  employerAddress?: string;
  payrollAccountLast4?: string;
  nativeCalculationCount: number;
  recordedRunCount: number;
  incompleteRunCount: number;
  warnings: string[];
  blockers: string[];
};

const BASE_FIELDS = [
  "cashCents",
  "taxableCents",
  "pensionableCents",
  "insurableCents",
  "vacationableCents",
  "ehtCents",
  "workSafeCents",
] as const;
const TOTAL_FIELDS = [
  "grossCents",
  "taxableCents",
  "cashCents",
  "nonCashTaxableCents",
  "nonTaxableCashCents",
  "cppEmployeeCents",
  "cpp2EmployeeCents",
  "eiEmployeeCents",
  "incomeTaxCents",
  "otherDeductionsCents",
  "netCents",
  "cppEmployerCents",
  "cpp2EmployerCents",
  "eiEmployerCents",
  "employerCostCents",
] as const;
function cents(
  value: unknown,
  label: string,
  signed = false,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (!signed && value < 0) ||
    value > max
  )
    throw new Error(
      `${label} must be supported integer cents${signed ? "" : " at or above zero"}.`,
    );
  return value;
}
function sum(values: number[]) {
  const value = Number(
    values.reduce((total, number) => total + BigInt(number), 0n),
  );
  return cents(value, "Payroll total", true);
}
function text(value: unknown, label: string, max = 200) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
  )
    throw new Error(`${label} requires 1–${max} valid characters.`);
  return value.trim();
}
function optionalText(value: unknown, label: string, max = 200) {
  return value == null || value === "" ? undefined : text(value, label, max);
}
function date(value: unknown, label: string) {
  const raw = text(value, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    !Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) ||
    new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw
  )
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return raw;
}
function finite(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a finite non-negative number.`);
  return value;
}
function noSensitiveIdentifiers(value: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [
      { value, depth: 0 },
    ],
    seen = new WeakSet<object>();
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (!item.value || typeof item.value !== "object") continue;
    if (seen.has(item.value)) continue;
    if (item.depth > 30 || ++count > 200000)
      throw new Error("Pay statement data must be bounded and acyclic.");
    seen.add(item.value);
    for (const [key, child] of Object.entries(item.value)) {
      if (
        /^(sin|socialInsuranceNumber|social_insurance_number|bankAccountNumber|bankCredentials)$/i.test(
          key,
        )
      )
        throw new Error(
          "Sensitive filing identifiers cannot be included in pay statement snapshots.",
        );
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}
function strings(value: unknown, label: string, limit = 1000) {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error(`${label} must be a bounded list.`);
  return value.map((entry) => text(entry, label, 4000));
}
function labelledAmounts(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error(`${label} must be a bounded list.`);
  return value.map((row) => ({
    label: text(row?.label, label),
    amountCents: cents(row?.amountCents, label, true),
  }));
}
/** Normalize snapshots without retaining arbitrary backend/private properties. */
export function validatePayrollStatement(
  raw: PayrollStatement,
): PayrollStatement {
  noSensitiveIdentifiers(raw);
  if (!raw || raw.schemaVersion !== 1)
    throw new Error("Unsupported pay statement version.");
  if (!["draft", "approved", "finalized", "reversed"].includes(raw.status))
    throw new Error("Choose a supported pay statement status.");
  if (!/^[A-Z]{3}$/.test(raw.currency))
    throw new Error("Choose a three-letter pay statement currency.");
  const periodStart = date(raw.periodStart, "Pay period start"),
    periodEnd = date(raw.periodEnd, "Pay period end"),
    payDate = date(raw.payDate, "Payment date");
  if (periodEnd < periodStart)
    throw new Error("Pay period end precedes its start.");
  if (!Number.isInteger(raw.calculationVersion) || raw.calculationVersion < 1)
    throw new Error("Pay statement calculation version is missing.");
  if (!Array.isArray(raw.earnings) || raw.earnings.length > 10000)
    throw new Error(
      "A pay statement supports at most 10,000 detailed earnings lines.",
    );
  const earnings = raw.earnings.map((line) => ({
    key: text(line.key, "Earning key"),
    label: text(line.label, "Earning label"),
    code: text(line.code, "Earning code"),
    ...(line.date ? { date: date(line.date, "Work date") } : {}),
    ...(line.hours == null ? {} : { hours: finite(line.hours, "Hours") }),
    ...(line.rateCents == null
      ? {}
      : { rateCents: cents(line.rateCents, "Rate") }),
    ...(line.multiplier == null
      ? {}
      : { multiplier: finite(line.multiplier, "Earning multiplier") }),
    amountCents: cents(line.amountCents, "Earning amount", true),
    ...Object.fromEntries(
      BASE_FIELDS.map((key) => [key, cents(line[key], `Earning ${key}`, true)]),
    ),
  })) as PayrollStatementEarning[];
  const totals = Object.fromEntries(
    TOTAL_FIELDS.map((key) => [key, cents(raw.totals?.[key], key, true)]),
  ) as PayrollStatementTotals;
  for (const key of [
    "federalTaxCents",
    "provincialTaxCents",
    "additionalIncomeTaxCents",
  ] as const)
    if (raw.totals[key] != null)
      totals[key] = cents(raw.totals[key], key, true);
  if (totals.grossCents !== totals.taxableCents)
    throw new Error(
      "Employment gross must retain its taxable employment-income meaning.",
    );
  if (
    sum([
      totals.taxableCents,
      -totals.nonCashTaxableCents,
      totals.nonTaxableCashCents,
    ]) !== totals.cashCents
  )
    throw new Error(
      "Cash remuneration does not reconcile to taxable remuneration and benefit/reimbursement classifications.",
    );
  if (
    totals.federalTaxCents != null &&
    totals.provincialTaxCents != null &&
    sum([
      totals.federalTaxCents,
      totals.provincialTaxCents,
      totals.additionalIncomeTaxCents ?? 0,
    ]) !== totals.incomeTaxCents
  )
    throw new Error(
      "Known federal, provincial and additional tax do not reconcile to combined income tax.",
    );
  const net = sum([
    totals.cashCents,
    -totals.cppEmployeeCents,
    -totals.cpp2EmployeeCents,
    -totals.eiEmployeeCents,
    -totals.incomeTaxCents,
    -totals.otherDeductionsCents,
  ]);
  if (net !== totals.netCents)
    throw new Error(
      "Pay statement net pay does not reconcile to cash remuneration less recorded employee deductions.",
    );
  if (
    sum(earnings.map((line) => line.cashCents)) !== totals.cashCents ||
    sum(earnings.map((line) => line.taxableCents)) !== totals.taxableCents
  )
    throw new Error(
      "Detailed earnings do not reconcile to the statement's cash and taxable totals.",
    );
  const otherDeductions = labelledAmounts(
      raw.otherDeductions,
      "Other deduction",
    ),
    employerCosts = labelledAmounts(raw.employerCosts, "Employer cost");
  if (
    sum(otherDeductions.map((row) => row.amountCents)) !==
    totals.otherDeductionsCents
  )
    throw new Error("Other deduction detail does not reconcile to its total.");
  if (
    sum([
      totals.cashCents,
      totals.cppEmployerCents,
      totals.cpp2EmployerCents,
      totals.eiEmployerCents,
      ...employerCosts.map((row) => row.amountCents),
    ]) !== totals.employerCostCents
  )
    throw new Error(
      "Employer cost does not reconcile to cash remuneration, statutory employer contributions and additional employer expenses.",
    );
  let yearToDate: PayrollStatementYearToDate | undefined;
  if (raw.yearToDate) {
    const ytd = raw.yearToDate;
    if (!Number.isInteger(ytd.year) || ytd.year !== Number(payDate.slice(0, 4)))
      throw new Error("Year-to-date totals must belong to the payment year.");
    const fields = [
      "grossCents",
      "cashCents",
      "taxableCents",
      "cppEmployeeCents",
      "cpp2EmployeeCents",
      "eiEmployeeCents",
      "incomeTaxCents",
      "netCents",
      "pensionableCents",
      "insurableCents",
    ] as const;
    yearToDate = {
      year: ytd.year,
      ...Object.fromEntries(
        fields.map((key) => [key, cents(ytd[key], `YTD ${key}`, true)]),
      ),
      ...(ytd.insurableHours == null
        ? {}
        : {
            insurableHours: finite(ytd.insurableHours, "YTD insurable hours"),
          }),
    } as PayrollStatementYearToDate;
  }
  return {
    schemaVersion: 1,
    calculationId: text(raw.calculationId, "Calculation ID", 1000),
    calculationVersion: raw.calculationVersion,
    statementNumber: text(raw.statementNumber, "Statement number"),
    status: raw.status,
    employer: {
      name: text(raw.employer?.name, "Employer name"),
      address: optionalText(raw.employer?.address, "Employer address", 2000),
      registrationNumber: optionalText(
        raw.employer?.registrationNumber,
        "Employer registration",
      ),
    },
    employee: {
      employeeId: text(raw.employee?.employeeId, "Employee ID", 1000),
      name: text(raw.employee?.name, "Employee name"),
      employeeNumber: optionalText(
        raw.employee?.employeeNumber,
        "Employee number",
      ),
      provinceOfEmployment: text(
        raw.employee?.provinceOfEmployment,
        "Province of employment",
        20,
      ),
    },
    currency: raw.currency,
    periodStart,
    periodEnd,
    payDate,
    runType: text(raw.runType, "Run type"),
    earnings,
    totals,
    otherDeductions,
    employerCosts,
    yearToDate,
    rules: {
      edition: text(raw.rules?.edition, "Rules edition"),
      method: text(raw.rules?.method, "Calculation method"),
      sources: strings(raw.rules?.sources, "Rule source"),
      explanations: strings(raw.rules?.explanations, "Calculation explanation"),
      inputFingerprint: optionalText(
        raw.rules?.inputFingerprint,
        "Input fingerprint",
      ),
      resultFingerprint: optionalText(
        raw.rules?.resultFingerprint,
        "Result fingerprint",
      ),
    },
    finalizedAtISO: optionalText(raw.finalizedAtISO, "Finalized timestamp"),
    correctionOf: optionalText(raw.correctionOf, "Corrected calculation", 1000),
    warnings: strings(raw.warnings, "Statement warning"),
  };
}
export const cleanPayrollStatement = validatePayrollStatement;
function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}
export function payrollStatementReport(
  input: PayrollStatement,
): BrandedReportData {
  const statement = validatePayrollStatement(input),
    m = (value: number) => money(value, statement.currency),
    totals = statement.totals;
  const columns = [
    { key: "label", label: "Description" },
    {
      key: "amount",
      label: `Amount (${statement.currency})`,
      align: "right" as const,
    },
  ];
  const rows = (entries: Array<[string, number]>) =>
    entries.map(([label, value], index) => ({
      key: `value-${index}`,
      cells: [label, m(value)],
    }));
  const sections: BrandedReportSection[] = [
    {
      title: "Detailed earnings",
      description:
        "Cash remuneration and taxable noncash benefits retain their separate classifications.",
      columns: [
        { key: "date", label: "Work date" },
        { key: "earning", label: "Earning / code" },
        { key: "hours", label: "Hours", align: "right" },
        { key: "rate", label: "Rate", align: "right" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "cash", label: "Cash", align: "right" },
      ],
      rows: statement.earnings.map((line) => ({
        key: line.key,
        cells: [
          line.date ?? statement.periodEnd,
          `${line.label} (${line.code})`,
          line.hours == null ? "—" : String(line.hours),
          line.rateCents == null
            ? "—"
            : `${m(line.rateCents)}${line.multiplier != null && line.multiplier !== 1 ? ` × ${line.multiplier}` : ""}`,
          m(line.amountCents),
          m(line.cashCents),
        ],
      })),
    },
    {
      title: "Pay and employee deductions",
      columns,
      rows: [
        ...rows([
          ["Taxable employment gross", totals.grossCents],
          ["Cash remuneration", totals.cashCents],
          ["Taxable noncash benefits", totals.nonCashTaxableCents],
          ["Nontaxable cash reimbursements", totals.nonTaxableCashCents],
          ["Employee CPP", totals.cppEmployeeCents],
          ["Employee CPP2", totals.cpp2EmployeeCents],
          ["Employee EI", totals.eiEmployeeCents],
          ["Income tax withheld", totals.incomeTaxCents],
          ...(totals.federalTaxCents == null
            ? []
            : [
                ["Federal income tax", totals.federalTaxCents] as [
                  string,
                  number,
                ],
              ]),
          ...(totals.provincialTaxCents == null
            ? []
            : [
                ["Provincial income tax", totals.provincialTaxCents] as [
                  string,
                  number,
                ],
              ]),
          ...(totals.additionalIncomeTaxCents == null
            ? []
            : [
                [
                  "Additional requested income tax",
                  totals.additionalIncomeTaxCents,
                ] as [string, number],
              ]),
          ...statement.otherDeductions.map((row): [string, number] => [
            row.label,
            row.amountCents,
          ]),
        ]),
        ...(totals.federalTaxCents == null
          ? [
              {
                key: "unknown-federal",
                cells: ["Federal income tax component", "Unknown"],
              },
            ]
          : []),
        ...(totals.provincialTaxCents == null
          ? [
              {
                key: "unknown-provincial",
                cells: ["Provincial income tax component", "Unknown"],
              },
            ]
          : []),
        {
          key: "net",
          kind: "total",
          cells: ["Net cash pay", m(totals.netCents)],
        },
      ],
    },
    {
      title: "Employer costs",
      description:
        "Employee withholding is deducted from cash remuneration and is not an extra employer expense.",
      columns,
      rows: [
        ...rows([
          ["Employer CPP", totals.cppEmployerCents],
          ["Employer CPP2", totals.cpp2EmployerCents],
          ["Employer EI", totals.eiEmployerCents],
          ...statement.employerCosts.map((row): [string, number] => [
            row.label,
            row.amountCents,
          ]),
        ]),
        {
          key: "employer-total",
          kind: "total",
          cells: ["Total employer cost", m(totals.employerCostCents)],
        },
      ],
    },
  ];
  sections.splice(1, 0, {
    title: "Earning classification bases",
    columns: [
      { key: "earning", label: "Earning" },
      ...BASE_FIELDS.map((key) => ({
        key,
        label: {
          cashCents: "Cash",
          taxableCents: "Taxable",
          pensionableCents: "Pensionable",
          insurableCents: "Insurable",
          vacationableCents: "Vacationable",
          ehtCents: "EHT",
          workSafeCents: "WorkSafe",
        }[key],
        align: "right" as const,
      })),
    ],
    rows: statement.earnings.map((line) => ({
      key: `base-${line.key}`,
      cells: [line.label, ...BASE_FIELDS.map((key) => m(line[key]))],
    })),
  });
  if (statement.yearToDate) {
    const y = statement.yearToDate;
    sections.push({
      title: `${y.year} same-employer year-to-date`,
      columns,
      rows: rows([
        ["Taxable gross", y.grossCents],
        ["Cash remuneration", y.cashCents],
        ["Employee CPP", y.cppEmployeeCents],
        ["Employee CPP2", y.cpp2EmployeeCents],
        ["Employee EI", y.eiEmployeeCents],
        ["Income tax withheld", y.incomeTaxCents],
        ["Net cash pay", y.netCents],
        ["Pensionable earnings", y.pensionableCents],
        ["Insurable earnings", y.insurableCents],
      ]).concat([
        {
          key: "ytd-hours",
          cells: [
            "Insurable hours",
            y.insurableHours == null ? "Unknown" : String(y.insurableHours),
          ],
        },
      ]),
    });
  }
  sections.push({
    title: "Calculation record",
    // Full-width labelled records keep long URLs, formulas and fingerprints
    // readable in the native PDF engine without shrinking a label column.
    columns: [{ key: "record", label: "Calculation detail" }],
    rows: [
      {
        key: "rules",
        cells: [
          "Rules edition / method",
          `${statement.rules.edition} / ${statement.rules.method}`,
        ],
      },
      {
        key: "version",
        cells: [
          "Immutable calculation version",
          `${statement.calculationId} · version ${statement.calculationVersion}`,
        ],
      },
      ...(statement.finalizedAtISO
        ? [{ key: "finalized", cells: ["Finalized", statement.finalizedAtISO] }]
        : []),
      ...(statement.correctionOf
        ? [
            {
              key: "correction",
              cells: ["Correction of", statement.correctionOf],
            },
          ]
        : []),
      ...statement.rules.explanations.map((explanation, index) => ({
        key: `explanation-${index}`,
        cells: ["Calculation explanation", explanation],
      })),
      ...statement.rules.sources.map((source, index) => ({
        key: `source-${index}`,
        cells: ["Official source", source],
      })),
      ...(statement.rules.inputFingerprint
        ? [
            {
              key: "input-hash",
              cells: ["Input fingerprint", statement.rules.inputFingerprint],
            },
          ]
        : []),
      ...(statement.rules.resultFingerprint
        ? [
            {
              key: "result-hash",
              cells: ["Result fingerprint", statement.rules.resultFingerprint],
            },
          ]
        : []),
    ].map((row) => ({ ...row, cells: [`${row.cells[0]}: ${row.cells[1]}`] })),
  });
  return {
    title: "Pay statement",
    subtitle: `${statement.employee.name} · ${statement.statementNumber}`,
    currency: statement.currency,
    filterSummary: [
      `Employer: ${statement.employer.name}${statement.employer.address ? ` · ${statement.employer.address}` : ""}`,
      `Employee: ${statement.employee.name}${statement.employee.employeeNumber ? ` · ${statement.employee.employeeNumber}` : ""}`,
      `Work period: ${statement.periodStart} to ${statement.periodEnd}`,
      `Payment date: ${statement.payDate} · ${statement.currency}`,
      `Province of employment: ${statement.employee.provinceOfEmployment}`,
      `Status: ${statement.status} · ${statement.runType}`,
    ],
    sections,
    warnings: [
      ...statement.warnings,
      ...(totals.federalTaxCents == null || totals.provincialTaxCents == null
        ? [
            "Federal/provincial allocation is unavailable for the combined income-tax amount; no split has been invented.",
          ]
        : []),
      ...(statement.status !== "finalized"
        ? [
            `${statement.status === "reversed" ? "Reversed" : "Draft/review"} calculation; this statement does not establish an active finalized payment.`,
          ]
        : []),
      ...(!statement.yearToDate
        ? ["Year-to-date totals are not available for this statement."]
        : []),
    ],
  };
}
function csvCell(value: unknown) {
  let raw = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(raw)) raw = `'${raw}`;
  return `"${raw.replaceAll('"', '""')}"`;
}
export function payrollStatementCsv(input: PayrollStatement): string {
  const statement = validatePayrollStatement(input),
    rows: unknown[][] = [
      ["Pay statement", statement.statementNumber],
      ["Employee", statement.employee.name],
      ["Employer", statement.employer.name],
      ["Period", statement.periodStart, statement.periodEnd],
      ["Pay date", statement.payDate],
      ["Currency", statement.currency],
      ["Status", statement.status],
      ["Calculation version", statement.calculationVersion],
      [],
      [
        "Work date",
        "Code",
        "Earning",
        "Hours",
        "Rate cents",
        "Multiplier",
        "Amount cents",
        ...BASE_FIELDS,
      ],
      ...statement.earnings.map((line) => [
        line.date ?? "",
        line.code,
        line.label,
        line.hours ?? "",
        line.rateCents ?? "",
        line.multiplier ?? "",
        line.amountCents,
        ...BASE_FIELDS.map((key) => line[key]),
      ]),
      [],
      ["Pay total", "Cents"],
      ...Object.entries(statement.totals),
      [],
      ["Same-employer YTD", "Value"],
      ...Object.entries(statement.yearToDate ?? {}),
    ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export type CraTransmitter = {
  accountNumber: string;
  name: string;
  country: string;
  contactName: string;
  contactAreaCode: string;
  contactPhone: string;
  contactEmail: string;
  contactExtension?: string;
  language: "E" | "F";
};
export type CraFilingBase = {
  submissionVersion: CraSubmissionVersion;
  earningsYear: number;
  currency: "CAD";
  submissionReference: string;
  reportType: "O" | "A";
  amendmentNote?: string;
  employer: PayrollFilingEmployer;
  transmitter: CraTransmitter;
  recordsComplete: boolean;
  sameEmployerConfirmed: boolean;
};
export type T4AnnualLimits = {
  earningsYear: number;
  pensionableMaximumCents: number;
  insurableMaximumCents: number;
  source: string;
};
export type T4FilingInput = CraFilingBase & {
  annualLimits?: T4AnnualLimits;
  records: PayrollT4AnnualRecord[];
  identities: PayrollFilingPerson[];
  employerContributions: {
    cppCents: number;
    cpp2Cents: number;
    eiCents: number;
  };
};
export type T4AFilingInput = CraFilingBase & {
  records: PayrollT4AAnnualRecord[];
  identities: Array<PayrollFilingPerson | PayrollFilingCorporation>;
};
export type PayrollXmlExport = {
  xml: string;
  filename: string;
  schemaVersion: string;
  schemaFile: string;
  recordCount: number;
  warnings: string[];
};
export const CRA_SUBMISSION_SCHEMAS = {
  "2026": {
    acceptedThrough: "2026-12-22",
    source:
      "https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-26-3.zip",
  },
  "2027": {
    acceptedFrom: "2027-01-11",
    source:
      "https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-27-1.zip",
  },
} as const;
const PROVINCES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
  "US",
  "ZZ",
];
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
function xmlText(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function tag(name: string, value: unknown) {
  return `<${name}>${xmlText(value)}</${name}>`;
}
function block(name: string, content: string) {
  return `<${name}>${content}</${name}>`;
}
function digits(value: unknown, count: number, label: string) {
  const number = text(value, label, count);
  if (!new RegExp(`^\\d{${count}}$`).test(number))
    throw new Error(`${label} requires ${count} digits.`);
  return number;
}
function luhn(value: string) {
  let sum = 0;
  for (
    let i = value.length - 1, doubled = false;
    i >= 0;
    i--, doubled = !doubled
  ) {
    let number = Number(value[i]);
    if (doubled) number *= 2;
    sum += number > 9 ? number - 9 : number;
  }
  return sum % 10 === 0;
}
export function validatePayrollSin(value: unknown): string {
  const sin = typeof value === "string" ? value.replace(/[ -]/g, "") : "";
  if (!/^\d{9}$/.test(sin) || /^0{9}$/.test(sin) || !luhn(sin))
    throw new Error(
      "Enter a valid nine-digit SIN with a valid checksum for each individual recipient.",
    );
  return sin;
}
export function validatePayrollBusinessNumber(
  value: unknown,
  payrollAccount = false,
): string {
  const normalized =
    typeof value === "string" ? value.replace(/\s/g, "").toUpperCase() : "";
  const pattern = payrollAccount
    ? /^\d{9}RP\d{4}$/
    : /^(?:\d{9}|\d{9}R[A-Z]\d{4})$/;
  if (
    !pattern.test(normalized) ||
    /^0{9}/.test(normalized) ||
    !luhn(normalized.slice(0, 9)) ||
    (normalized.length === 15 && normalized.endsWith("0000"))
  )
    throw new Error(
      payrollAccount
        ? "Enter the employer's valid BN/RP payroll account, including its four-digit account suffix."
        : "Enter a valid business number with a valid checksum.",
    );
  return normalized;
}
function recipientBusinessNumber(value: unknown) {
  const number = validatePayrollBusinessNumber(value);
  if (number.length !== 15)
    throw new Error(
      "A corporation T4A recipient requires the full BN15, including its two-letter program and four-digit account suffix.",
    );
  return number;
}
function craName(value: unknown, label: string, max: number) {
  const name = text(value, label, max).replace(/[‘’]/g, "'");
  if (!/^[A-Za-z0-9éàâçèêëîïôùüûÉÀÂÇÈÊËÎÏÔÙÜÛ'&. \-]+$/.test(name))
    throw new Error(
      `${label} contains characters outside CRA's published name character set.`,
    );
  return name;
}
function craOrganizationName(
  name: string,
  value: unknown,
  label: string,
  maxLines = 3,
) {
  let remaining = craName(value, label, 30 * maxLines);
  const lines: string[] = [];
  while (remaining.length > 30) {
    let boundary = remaining.lastIndexOf(" ", 30);
    if (boundary < 1) boundary = 30;
    lines.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > maxLines)
    throw new Error(
      `${label} requires a reviewed name fitting ${maxLines} CRA name lines.`,
    );
  return block(
    name,
    lines.map((line, index) => tag(`l${index + 1}_nm`, line)).join(""),
  );
}
function phone(value: unknown) {
  const raw = text(value, "Contact phone", 8).replace("-", "");
  if (!/^\d{7}$/.test(raw))
    throw new Error("Enter the seven-digit contact phone number.");
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}
function addressXml(name: string, raw: PayrollFilingAddress): string {
  if (!raw) throw new Error("Enter each required mailing address.");
  const country = text(raw.country, "Country code", 3).toUpperCase(),
    province = text(raw.province, "Address province/state", 2).toUpperCase();
  if (
    !/^[A-Z]{3}$/.test(country) ||
    !/^[A-Z]{2}$/.test(province) ||
    (country === "CAN" &&
      !PROVINCES.filter((p) => !["US", "ZZ"].includes(p)).includes(province)) ||
    (!["CAN", "USA"].includes(country) && province !== "ZZ")
  )
    throw new Error(
      "Enter a valid three-letter country and province/state code; use ZZ for countries other than Canada or the USA.",
    );
  const line1 = text(raw.line1, "Address line 1", 30),
    line2 = optionalText(raw.line2, "Address line 2", 30),
    city = text(raw.city, "City", 28),
    postal = text(raw.postalCode, "Postal/ZIP code", 10).toUpperCase();
  if (!/^[A-Z0-9 \-]+$/.test(postal))
    throw new Error("Enter a valid postal/ZIP code.");
  if (
    country === "CAN" &&
    !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/.test(
      postal,
    )
  )
    throw new Error("Enter a valid Canadian postal code.");
  return block(
    name,
    tag("addr_l1_txt", line1) +
      (line2 ? tag("addr_l2_txt", line2) : "") +
      tag("cty_nm", city) +
      tag("prov_cd", province) +
      tag("cntry_cd", country) +
      tag("pstl_cd", postal),
  );
}
function contactXml(
  raw: PayrollFilingEmployer | CraTransmitter,
  transmitter = false,
): string {
  const name = craName(raw.contactName, "Contact name", transmitter ? 35 : 22),
    area = digits(raw.contactAreaCode, 3, "Contact area code"),
    telephone = phone(raw.contactPhone);
  let result =
    tag("cntc_nm", name) +
    tag("cntc_area_cd", area) +
    tag("cntc_phn_nbr", telephone);
  if (raw.contactExtension) {
    const extension = text(
      raw.contactExtension,
      "Contact extension",
      transmitter ? 12 : 7,
    );
    if (!/^\d+$/.test(extension))
      throw new Error("Contact extension must be numeric.");
    result += tag("cntc_extn_nbr", extension);
  }
  if (transmitter) {
    const email = text(
      (raw as CraTransmitter).contactEmail,
      "Transmitter email",
      60,
    );
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Enter the transmitter's contact email.");
    result += tag("cntc_email_area", email);
  }
  return block("CNTC", result);
}
function t619(input: CraFilingBase): string {
  const t = input.transmitter,
    account = validatePayrollBusinessNumber(t.accountNumber);
  if (!["E", "F"].includes(t.language))
    throw new Error("Choose English or French for the T619 language code.");
  const country = text(t.country, "Transmitter country", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(country))
    throw new Error("Use a three-letter transmitter country code.");
  if (!/^[A-Za-z0-9]{1,8}$/.test(input.submissionReference))
    throw new Error(
      "Submission reference must contain 1–8 letters or digits without spaces or punctuation.",
    );
  return block(
    "T619",
    block(
      "TransmitterAccountNumber",
      tag(account.length === 9 ? "bn9" : "bn15", account),
    ) +
      tag("sbmt_ref_id", input.submissionReference) +
      tag("summ_cnt", "1") +
      tag("lang_cd", t.language) +
      block(
        "TransmitterName",
        tag("l1_nm", craName(t.name, "Transmitter name", 35)),
      ) +
      tag("TransmitterCountryCode", country) +
      contactXml(t, true),
  );
}
function validateBase(input: CraFilingBase, count: number) {
  if (!["2026", "2027"].includes(input.submissionVersion))
    throw new Error("Choose the published 2026 or 2027 submission schema.");
  if (
    !Number.isInteger(input.earningsYear) ||
    input.earningsYear < 1966 ||
    input.earningsYear > 2099
  )
    throw new Error(
      "Choose a valid earnings/taxation year separately from the submission version.",
    );
  if (input.currency !== "CAD")
    throw new Error(
      "Canadian filing exports require verified CAD amounts; foreign nominal amounts cannot be relabelled CAD.",
    );
  if (input.recordsComplete !== true || input.sameEmployerConfirmed !== true)
    throw new Error(
      "Load all source records and confirm their legal employer before generating a filing export.",
    );
  if (!Number.isInteger(count) || count < 1 || count > 5000)
    throw new Error(
      "A filing export requires 1–5,000 complete recipient records.",
    );
  if (!["O", "A"].includes(input.reportType))
    throw new Error("Choose an original or amended return.");
  validatePayrollBusinessNumber(input.employer.payrollAccount, true);
}
function decimalCents(
  value: unknown,
  label: string,
  digitsBefore: number,
  signed = false,
): string {
  const amount = cents(value, label, signed);
  if (Math.abs(amount) >= 10 ** (digitsBefore + 2))
    throw new Error(`${label} exceeds the official XML field size.`);
  const absolute = Math.abs(amount);
  return `${amount < 0 ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
function amountTag(
  name: string,
  value: unknown,
  digitsBefore: number,
  signed = false,
) {
  return tag(name, decimalCents(value, name, digitsBefore, signed));
}
function nameXml(name: string, raw: PayrollFilingPerson) {
  return block(
    name,
    tag("snm", craName(raw.surname, "Recipient surname", 20)) +
      tag("gvn_nm", craName(raw.givenName, "Recipient given name", 12)) +
      (raw.initial
        ? tag(
            "init",
            /^[A-Za-z]$/.test(raw.initial)
              ? raw.initial
              : (() => {
                  throw new Error("Recipient initial must be one letter.");
                })(),
          )
        : ""),
  );
}
type OfficialField = {
  tag: string;
  type: string;
  label: string;
  onlyTaxYear?: number;
  maxTaxYear?: number;
  reservedForCra?: boolean;
};
export function payrollOtherInformationFields(
  version: CraSubmissionVersion,
  form: "t4" | "t4a",
): Record<string, OfficialField> {
  return officialFieldMaps[version][form] as Record<string, OfficialField>;
}
function otherInformation(
  entries: Array<{ code: string; amountCents: number }> | undefined,
  input: CraFilingBase,
  form: "t4" | "t4a",
): { xml: string; values: Map<string, number> } {
  const rows = entries ?? [],
    max = form === "t4" ? 6 : 12,
    fields = payrollOtherInformationFields(input.submissionVersion, form),
    seen = new Set<string>(),
    values = new Map<string, number>();
  if (rows.length > max)
    throw new Error(
      `${form.toUpperCase()} supports ${max} other-information fields per slip; split additional fields into a separate slip.`,
    );
  let content = "";
  for (const row of rows) {
    const code = String(row.code).padStart(form === "t4" ? 2 : 3, "0"),
      field = fields[code];
    if (!field || seen.has(code))
      throw new Error(
        "Other-information codes must be supported by the selected schema and appear only once per slip.",
      );
    if (
      field.reservedForCra ||
      (field.onlyTaxYear != null && field.onlyTaxYear !== input.earningsYear) ||
      (field.maxTaxYear != null && input.earningsYear > field.maxTaxYear)
    )
      throw new Error(
        `Other-information code ${code} is not available for this filer/taxation year.`,
      );
    seen.add(code);
    const match = /(?:signed)?Decimal(\d+)Type/i.exec(field.type);
    if (!match)
      throw new Error(
        `Other-information code ${code} is not a monetary field and requires a separately supported form input.`,
      );
    const value = cents(
      row.amountCents,
      `Other-information code ${code}`,
      field.type.startsWith("signed"),
    );
    content += amountTag(
      field.tag,
      value,
      Number(match[1]) - 2,
      field.type.startsWith("signed"),
    );
    values.set(code, value);
  }
  return { xml: content ? block("OTH_INFO", content) : "", values };
}
function informationSlips(
  entries: Array<{ code: string; amountCents: number }> | undefined,
  input: CraFilingBase,
  form: "t4" | "t4a",
) {
  const rows = entries ?? [],
    perSlip = form === "t4" ? 6 : 12,
    seen = new Set<string>();
  if (rows.length > 64)
    throw new Error(
      "Use at most 64 distinct supported additional-information codes per recipient.",
    );
  for (const row of rows) {
    const code = String(row.code).padStart(form === "t4" ? 2 : 3, "0");
    if (seen.has(code))
      throw new Error(
        "Combine duplicate additional-information amounts by code before exporting.",
      );
    seen.add(code);
  }
  const output: Array<ReturnType<typeof otherInformation>> = [];
  for (let start = 0; start < rows.length; start += perSlip)
    output.push(
      otherInformation(rows.slice(start, start + perSlip), input, form),
    );
  return output.length ? output : [otherInformation([], input, form)];
}
function xmlResult(
  xml: string,
  filename: string,
  version: string,
  form: string,
  count: number,
): PayrollXmlExport {
  if (new TextEncoder().encode(xml).byteLength > 50_000_000)
    throw new Error(
      "This XML export exceeds the supported 50 MB file size. Export fewer recipients.",
    );
  return {
    xml,
    filename,
    schemaVersion: version,
    schemaFile: `${version}/T619_${form}.xsd`,
    recordCount: count,
    warnings: [
      "This file contains sensitive filing identifiers. It is generated transiently and is not a stored payroll snapshot.",
      "Review the complete return and submit it through the authorized government filing portal; exporting does not file the return.",
    ],
  };
}

/** Filing-box maxima are selected by the earnings year, never the XML submission version. */
export function reviewedT4AnnualLimits(
  earningsYear: number,
): T4AnnualLimits | undefined {
  const edition = reviewedPayrollRates.find(
    (value) => Number(value.effectiveFrom.slice(0, 4)) === earningsYear,
  );
  return edition
    ? {
        earningsYear,
        pensionableMaximumCents: edition.cpp.yampeCents,
        insurableMaximumCents: edition.ei.insurableMaximumCents,
        source:
          edition.sources.find((source) => source.file.includes("cpp2"))?.url ??
          edition.sources[0].url,
      }
    : undefined;
}
export function prepareT4AnnualRecords(
  records: PayrollT4AnnualRecord[],
  earningsYear: number,
  suppliedLimits?: T4AnnualLimits,
): PayrollT4AnnualRecord[] {
  const limits = reviewedT4AnnualLimits(earningsYear) ?? suppliedLimits;
  if (
    !limits ||
    limits.earningsYear !== earningsYear ||
    !/^https:\/\//.test(limits.source ?? "")
  )
    throw new Error(
      "This earnings year needs reviewed pensionable/insurable annual limits and their official source; submission-schema years cannot supply those rates.",
    );
  const pensionableMaximum = cents(
      limits.pensionableMaximumCents,
      "Earnings-year pensionable maximum",
    ),
    insurableMaximum = cents(
      limits.insurableMaximumCents,
      "Earnings-year insurable maximum",
    );
  if (!pensionableMaximum || !insurableMaximum)
    throw new Error("Annual filing earnings limits must be greater than zero.");
  const employees = new Map<string, PayrollT4AnnualRecord[]>();
  for (const row of records) {
    const previous = employees.get(row.employeeId) ?? [];
    previous.push(row);
    employees.set(row.employeeId, previous);
    cents(row.pensionableEarningsCents, "Annual pensionable earnings");
    cents(row.insurableEarningsCents, "Annual insurable earnings");
  }
  for (const rows of employees.values())
    if (
      new Set(rows.map((row) => row.provinceOfEmployment)).size > 1 &&
      (sum(
        rows.map((row) => (row.cppExempt ? 0 : row.pensionableEarningsCents)),
      ) > pensionableMaximum ||
        sum(
          rows.map((row) => (row.eiExempt ? 0 : row.insurableEarningsCents)),
        ) > insurableMaximum)
    )
      throw new Error(
        "Multiple provinces exceed a shared annual earnings limit. Supply a reviewed allocation of actual box 24/26 amounts between slips; automatic per-province caps would overreport.",
      );
  return records.map((row) => {
    if (
      (row.cppExempt && (row.cppEmployeeCents || row.cpp2EmployeeCents)) ||
      (row.eiExempt && row.eiEmployeeCents)
    )
      throw new Error(
        "An exempt T4 contribution code conflicts with recorded employee contributions.",
      );
    return {
      ...row,
      pensionableEarningsCents: row.cppExempt
        ? 0
        : Math.min(row.pensionableEarningsCents, pensionableMaximum),
      insurableEarningsCents: row.eiExempt
        ? 0
        : Math.min(row.insurableEarningsCents, insurableMaximum),
    };
  });
}
/** CRA T619 + T4 slip/summary, using the selected official submission schema, independent of the earnings year. */
export function exportT4Xml(input: T4FilingInput): PayrollXmlExport {
  validateBase(input, input.records.length);
  input = {
    ...input,
    records: prepareT4AnnualRecords(
      input.records,
      input.earningsYear,
      input.annualLimits,
    ),
  };
  const account = validatePayrollBusinessNumber(
      input.employer.payrollAccount,
      true,
    ),
    people = new Map(
      input.identities.map((person) => [person.employeeId, person]),
    ),
    seen = new Set<string>();
  let slipCount = 0;
  const slips = input.records
    .map((row) => {
      const person = people.get(row.employeeId);
      if (!person)
        throw new Error(
          "Enter the required transient identity for every T4 recipient.",
        );
      const key = `${row.employeeId}:${row.provinceOfEmployment}`;
      if (seen.has(key))
        throw new Error(
          "Combine each employee's records by province of employment before exporting T4 slips.",
        );
      seen.add(key);
      if (row.provinceOfEmployment === "QC")
        throw new Error(
          "Quebec QPP/QPP2 and provincial reporting require an explicitly supported Quebec calculation; CPP fields cannot be substituted.",
        );
      if (!PROVINCES.includes(row.provinceOfEmployment))
        throw new Error(
          "Choose a valid province of employment for each T4 slip.",
        );
      if (
        typeof row.cppExempt !== "boolean" ||
        typeof row.eiExempt !== "boolean"
      )
        throw new Error(
          "Confirm CPP and EI exemption status for every T4 recipient.",
        );
      if (!["1", "2", "3", "4", "5"].includes(row.dentalBenefitsCode ?? ""))
        throw new Error(
          "Confirm the employer dental-benefit reporting code (box 45) for every T4 recipient.",
        );
      if (row.cpp2EmployeeCents > 0 && row.cppEmployeeCents <= 0)
        throw new Error(
          "CPP2 box 16A must appear on the same slip as CPP box 16.",
        );
      if (
        row.rppClassificationRequired &&
        row.rppClassificationConfirmed !== true
      )
        throw new Error(
          "Review the registered-plan classification and actual RPP box 20 amount; an RRSP/RCA deduction cannot be relabelled RPP.",
        );
      const otherSlips = informationSlips(row.otherInformation, input, "t4");
      slipCount += otherSlips.length;
      if (slipCount > 5000)
        throw new Error(
          "This return exceeds the supported 5,000 physical slips. Divide the return before export.",
        );
      let amounts =
        amountTag("empt_incamt", row.employmentIncomeCents, 8) +
        amountTag("cpp_cntrb_amt", row.cppEmployeeCents, 4) +
        amountTag("cppe_cntrb_amt", row.cpp2EmployeeCents, 4) +
        amountTag("empe_eip_amt", row.eiEmployeeCents, 4) +
        amountTag("itx_ddct_amt", row.incomeTaxCents, 8) +
        amountTag("ei_insu_ern_amt", row.insurableEarningsCents, 5) +
        amountTag("cpp_qpp_ern_amt", row.pensionableEarningsCents, 7);
      for (const [field, value, max] of [
        ["rpp_cntrb_amt", row.rppContributionsCents, 5],
        ["unn_dues_amt", row.unionDuesCents, 7],
        ["padj_amt", row.pensionAdjustmentCents, 5],
      ] as const)
        if (value != null) amounts += amountTag(field, value, max);
      return otherSlips
        .map((other, index) =>
          block(
            "T4Slip",
            nameXml("EMPE_NM", person) +
              addressXml("EMPE_ADDR", person.address) +
              tag("sin", validatePayrollSin(person.sin)) +
              tag("bn", account) +
              tag("cpp_qpp_xmpt_cd", row.cppExempt ? "1" : "0") +
              tag("ei_xmpt_cd", row.eiExempt ? "1" : "0") +
              tag("rpt_tcd", input.reportType) +
              tag("empt_prov_cd", row.provinceOfEmployment) +
              tag("empr_dntl_ben_rpt_cd", row.dentalBenefitsCode) +
              (row.rppRegistrationNumber
                ? tag(
                    "rpp_dpsp_rgst_nbr",
                    digits(
                      row.rppRegistrationNumber,
                      7,
                      "RPP registration number",
                    ),
                  )
                : "") +
              (index === 0 ? block("T4_AMT", amounts) : "") +
              other.xml,
          ),
        )
        .join("");
    })
    .join("");
  const total = (key: keyof PayrollT4AnnualRecord) =>
    sum(input.records.map((row) => Number(row[key] ?? 0)));
  const totals =
    amountTag("tot_empt_incamt", total("employmentIncomeCents"), 11) +
    amountTag("tot_empe_cpp_amt", total("cppEmployeeCents"), 9) +
    amountTag("tot_empe_cppe_amt", total("cpp2EmployeeCents"), 9) +
    amountTag("tot_empe_eip_amt", total("eiEmployeeCents"), 9) +
    amountTag("tot_itx_ddct_amt", total("incomeTaxCents"), 11) +
    amountTag("tot_rpp_cntrb_amt", total("rppContributionsCents"), 9) +
    amountTag("tot_padj_amt", total("pensionAdjustmentCents"), 11) +
    amountTag("tot_empr_cpp_amt", input.employerContributions.cppCents, 9) +
    amountTag("tot_empr_cppe_amt", input.employerContributions.cpp2Cents, 9) +
    amountTag("tot_empr_eip_amt", input.employerContributions.eiCents, 9);
  const summary = block(
    "T4Summary",
    tag("bn", account) +
      craOrganizationName("EMPR_NM", input.employer.name, "Employer name") +
      addressXml("EMPR_ADDR", input.employer.address) +
      contactXml(input.employer) +
      tag("tx_yr", input.earningsYear) +
      tag("slp_cnt", slipCount) +
      tag("rpt_tcd", input.reportType) +
      (input.amendmentNote
        ? tag(
            "fileramendmentnote",
            text(input.amendmentNote, "Amendment note", 2000),
          )
        : "") +
      block("T4_TAMT", totals),
  );
  return xmlResult(
    `${XML_HEADER}<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${t619(input)}<Return><T4>${slips}${summary}</T4></Return></Submission>`,
    `T4-${input.earningsYear}-submission-${input.submissionVersion}.xml`,
    input.submissionVersion,
    "T4",
    slipCount,
  );
}
export function exportT4AXml(input: T4AFilingInput): PayrollXmlExport {
  validateBase(input, input.records.length);
  const account = validatePayrollBusinessNumber(
      input.employer.payrollAccount,
      true,
    ),
    people = new Map(
      input.identities.map((person) => [person.employeeId, person]),
    ),
    seen = new Set<string>(),
    otherTotals = new Map<string, number>();
  let slipCount = 0;
  const slips = input.records
    .map((row) => {
      if (row.classificationConfirmed !== true)
        throw new Error(
          "Confirm T4A classification from the actual relationship; an honorarium label alone cannot select T4A treatment.",
        );
      if (seen.has(row.employeeId))
        throw new Error(
          "Combine each recipient's annual T4A records before exporting.",
        );
      seen.add(row.employeeId);
      const person = people.get(row.employeeId);
      if (!person)
        throw new Error("Enter each T4A recipient's transient identity.");
      const otherEntries = [
          ...(row.otherInformation ?? []),
          ...(row.otherIncomeCents != null && row.otherIncomeCents !== 0
            ? [{ code: "028", amountCents: row.otherIncomeCents }]
            : []),
        ],
        otherSlips = informationSlips(otherEntries, input, "t4a");
      slipCount += otherSlips.length;
      if (slipCount > 5000)
        throw new Error(
          "This return exceeds the supported 5,000 physical slips. Divide the return before export.",
        );
      for (const part of otherSlips)
        for (const [key, amount] of part.values)
          otherTotals.set(key, sum([otherTotals.get(key) ?? 0, amount]));
      const corporation = "corporationName" in person;
      const identity = corporation
        ? tag("sin", "000000000") +
          tag("rcpnt_bn", recipientBusinessNumber(person.businessNumber)) +
          craOrganizationName(
            "RCPNT_CORP_NM",
            person.corporationName,
            "Recipient corporation",
            2,
          )
        : nameXml("RCPNT_NM", person) +
          tag("sin", validatePayrollSin(person.sin)) +
          tag("rcpnt_bn", "000000000RC0000");
      let amounts = amountTag("itx_ddct_amt", row.incomeTaxCents, 9);
      for (const [field, value] of [
        ["pens_spran_amt", row.pensionIncomeCents],
        ["lsp_amt", row.lumpSumCents],
        ["self_empl_cmsn_amt", row.selfEmployedCommissionsCents],
        ["fee_or_oth_srvc_amt", row.feesForServicesCents],
        ["annty_amt", row.annuityIncomeCents],
      ] as const)
        if (value != null) amounts += amountTag(field, value, 9);
      if (
        ![
          row.pensionIncomeCents,
          row.lumpSumCents,
          row.selfEmployedCommissionsCents,
          row.feesForServicesCents,
          row.annuityIncomeCents,
          ...otherSlips.flatMap((part) => [...part.values.values()]),
        ].some((value) => value != null && value !== 0)
      )
        throw new Error("A T4A slip requires a reportable income amount.");
      return otherSlips
        .map((other, index) =>
          block(
            "T4ASlip",
            identity +
              addressXml("RCPNT_ADDR", person.address) +
              tag("bn", account) +
              tag("rpt_tcd", input.reportType) +
              (index === 0 ? block("T4A_AMT", amounts) : "") +
              other.xml,
          ),
        )
        .join("");
    })
    .join("");
  const total = (key: keyof PayrollT4AAnnualRecord) =>
      sum(input.records.map((row) => Number(row[key] ?? 0))),
    extra = (key: string) => otherTotals.get(key) ?? 0;
  const totals =
    amountTag("tot_annty_incamt", total("annuityIncomeCents"), 13) +
    amountTag("tot_pens_spran_amt", total("pensionIncomeCents"), 13) +
    amountTag("tot_lsp_amt", total("lumpSumCents"), 13) +
    amountTag("tot_self_cmsn_amt", total("selfEmployedCommissionsCents"), 13) +
    amountTag("tot_itx_dedn_amt", total("incomeTaxCents"), 11) +
    amountTag("rpt_tot_fee_srvc_amt", total("feesForServicesCents"), 13) +
    amountTag("totr_incamt", extra("028"), 13) +
    amountTag("tot_ptrng_aloc_amt", extra("030"), 13) +
    amountTag("tot_past_srvc_amt", extra("032"), 13) +
    amountTag("tot_padj_amt", extra("034"), 13) +
    amountTag("tot_resp_aip_amt", extra("040"), 13) +
    amountTag("tot_resp_amt", extra("042"), 13) +
    amountTag(
      "rpt_tot_oth_info_amt",
      sum(
        [...otherTotals.entries()]
          .filter(
            ([code]) =>
              !["028", "030", "032", "034", "040", "042"].includes(code),
          )
          .map(([, amount]) => amount),
      ),
      13,
      true,
    );
  const summary = block(
    "T4ASummary",
    tag("bn", account) +
      craOrganizationName("PAYR_NM", input.employer.name, "Payer name") +
      addressXml("PAYR_ADDR", input.employer.address) +
      contactXml(input.employer) +
      tag("tx_yr", input.earningsYear) +
      tag("slp_cnt", slipCount) +
      tag("rpt_tcd", input.reportType) +
      (input.amendmentNote
        ? tag(
            "fileramendmentnote",
            text(input.amendmentNote, "Amendment note", 2000),
          )
        : "") +
      block("T4A_TAMT", totals),
  );
  return xmlResult(
    `${XML_HEADER}<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${t619(input)}<Return><T4A>${slips}${summary}</T4A></Return></Submission>`,
    `T4A-${input.earningsYear}-submission-${input.submissionVersion}.xml`,
    input.submissionVersion,
    "T4A",
    slipCount,
  );
}

export const ROE_PAY_PERIODS = {
  W: 53,
  B: 27,
  S: 25,
  E: 25,
  M: 13,
  O: 13,
  H: 14,
} as const;
export const ROE_REASONS = [
  "A00",
  "A01",
  "B00",
  "D00",
  "E00",
  "E02",
  "E03",
  "E04",
  "E05",
  "E06",
  "E09",
  "E10",
  "E11",
  "F00",
  "G00",
  "G07",
  "H00",
  "J00",
  "K00",
  "K12",
  "K13",
  "K14",
  "K15",
  "K16",
  "K17",
  "M00",
  "M08",
  "N00",
  "P00",
  "Z00",
] as const;
export const ROE_PAY_PERIOD_LABELS: Record<
  keyof typeof ROE_PAY_PERIODS,
  string
> = {
  W: "Weekly",
  B: "Biweekly",
  S: "Semimonthly",
  E: "Semimonthly nonstandard",
  M: "Monthly",
  O: "Monthly nonstandard",
  H: "13 periods per year",
};
export const ROE_REASON_LABELS: Record<(typeof ROE_REASONS)[number], string> = {
  A00: "Shortage of work / contract ended",
  A01: "Employer bankruptcy",
  B00: "Strike / lockout",
  D00: "Illness / injury",
  E00: "Quit",
  E02: "Quit — follow spouse",
  E03: "Quit — school",
  E04: "Quit — health",
  E05: "Voluntary retirement",
  E06: "Quit — new job",
  E09: "Quit — employer relocation",
  E10: "Quit — dependant care",
  E11: "Quit — self-employment",
  F00: "Maternity",
  G00: "Mandatory retirement",
  G07: "Approved workforce reduction",
  H00: "Work sharing",
  J00: "Apprentice training",
  K00: "Other — explanation required",
  K12: "Pay-frequency change",
  K13: "Ownership change",
  K14: "Employment Insurance request",
  K15: "Canadian Forces — explanation required",
  K16: "Employee request",
  K17: "Service-provider change",
  M00: "Dismissal",
  M08: "Dismissal during probation",
  N00: "Leave of absence",
  P00: "Parental",
  Z00: "Compassionate care / family caregiver",
};
export const ROE_OTHER_MONEY_LABELS: Record<string, string> = {
  B05: "Holiday bonus",
  B06: "Production / incentive bonus",
  B07: "Event bonus",
  B08: "Staying / contract-complete bonus",
  B09: "Separation / retirement bonus",
  B10: "Closure bonus",
  B11: "Other bonus",
  E00: "Severance pay",
  G00: "Gratuities",
  H00: "Honorariums",
  I00: "Sick leave credits",
  J00: "Retroactive adjustment",
  O00: "Other",
  Q00: "Profit sharing",
  R00: "Retiring allowance",
  S00: "Settlement pay",
  T00: "Banked overtime payout",
  U12: "SUB maternity / parental / care",
  U13: "SUB layoff",
  U14: "SUB illness",
  U15: "SUB training",
  Y00: "Pay in lieu of notice",
};
export type RoePayPeriod = {
  startDate: string;
  endDate: string;
  insurableEarningsCents: number;
  insurableHours: number;
};
export type RoeFilingInput = {
  currency: "CAD";
  validationDate?: string;
  payrollAccount: string;
  employee: PayrollFilingPerson;
  printingLanguage: "E" | "F";
  issue: "S" | "D";
  payrollReference?: string;
  amendedSerialNumber?: string;
  payPeriodCode: keyof typeof ROE_PAY_PERIODS;
  firstDayWorked: string;
  lastDayPaid: string;
  finalPayPeriodEnd: string;
  occupation?: string;
  recall: { code: "N" | "U" | "Y"; date?: string };
  reason: (typeof ROE_REASONS)[number];
  contact: {
    givenName: string;
    surname: string;
    areaCode: string;
    phone: string;
    extension?: string;
  };
  /** Most recent first. All consecutive periods back to firstDayWorked or the official lookback maximum, including zero periods. */
  payPeriods: RoePayPeriod[];
  recordsComplete: boolean;
  sameEmployerConfirmed: boolean;
  separationPaymentsReviewed: boolean;
  vacation?: {
    code: "1" | "2" | "3" | "4";
    startDate?: string;
    endDate?: string;
    amountCents?: number;
  };
  statutoryHolidays?: Array<{ date?: string; amountCents: number }>;
  otherMonies?: Array<{
    code: string;
    startDate?: string;
    endDate?: string;
    amountCents?: number;
  }>;
  specialPayments?: Array<{
    code: "PSL01" | "MAT01" | "WLI01" | "WLI02";
    startDate?: string;
    endDate?: string;
    amountCents?: number;
    period?: "D" | "W";
  }>;
  comments?: string;
};
export const ROE_OTHER_MONIES: Record<
  string,
  { start: boolean; end: boolean; required: boolean; insurable: boolean }
> = Object.fromEntries(
  [
    ["B05", true, false, true, true],
    ["B06", true, true, true, true],
    ["B07", true, false, true, true],
    ...["B08", "B09", "B10", "B11", "G00", "J00", "Q00", "T00", "Y00"].map(
      (code) => [code, false, false, true, true],
    ),
    ...["E00", "R00"].map((code) => [code, false, false, true, false]),
    ["H00", true, true, true, false],
    ["I00", true, false, true, true],
    ["O00", true, true, true, true],
    ["S00", true, true, true, true],
    ...["U12", "U13", "U14", "U15"].map((code) => [
      code,
      false,
      false,
      false,
      false,
    ]),
  ].map(([code, start, end, required, insurable]) => [
    code,
    { start, end, required, insurable },
  ]),
);
function dayAfter(raw: string) {
  const value = new Date(`${raw}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
function positiveRoeAmount(value: unknown, label: string) {
  const result = cents(value, label, false, 999999999);
  if (result === 0) throw new Error(`${label} must be greater than zero.`);
  return result;
}
function datedRoeMoney(
  row: { startDate?: string; endDate?: string; amountCents?: number },
  label: string,
  required = false,
) {
  const start = row.startDate
      ? date(row.startDate, `${label} start`)
      : undefined,
    end = row.endDate ? date(row.endDate, `${label} end`) : undefined;
  if (start && end && end < start)
    throw new Error(`${label} end precedes its start.`);
  const amount =
    row.amountCents == null
      ? undefined
      : positiveRoeAmount(row.amountCents, label);
  if ((required || start || end) && amount == null)
    throw new Error(`${label} requires an amount.`);
  return {
    start,
    end,
    amount,
    xml:
      (start ? tag("SDT", start) : "") +
      (end ? tag("EDT", end) : "") +
      (amount == null ? "" : amountTag("AMT", amount, 7)),
  };
}
/** Service Canada payroll extract v2.0, including business rules beyond the deliberately permissive XSD. */
export function exportRoeXml(input: RoeFilingInput): PayrollXmlExport {
  if (
    input.currency !== "CAD" ||
    input.recordsComplete !== true ||
    input.sameEmployerConfirmed !== true ||
    input.separationPaymentsReviewed !== true
  )
    throw new Error(
      "Confirm complete CAD pay-period history, the legal employer and all separation payments before exporting an ROE.",
    );
  const account = validatePayrollBusinessNumber(input.payrollAccount, true);
  if (!/^[178]/.test(account))
    throw new Error(
      "Service Canada requires the production BN/RP account root to begin with 1, 7 or 8.",
    );
  if (
    !["E", "F"].includes(input.printingLanguage) ||
    !["S", "D"].includes(input.issue)
  )
    throw new Error("Choose the ROE language and submit/draft file type.");
  const first = date(input.firstDayWorked, "First day worked"),
    last = date(input.lastDayPaid, "Last day for which paid"),
    final = date(input.finalPayPeriodEnd, "Final pay-period end");
  const validationDate = date(
      input.validationDate ?? new Date().toISOString().slice(0, 10),
      "ROE validation date",
    ),
    earliest = `${Number(validationDate.slice(0, 4)) - 50}${validationDate.slice(4)}`;
  const latestLastPaid = new Date(`${validationDate}T00:00:00Z`);
  latestLastPaid.setUTCDate(latestLastPaid.getUTCDate() + 14);
  if (first < earliest || last > latestLastPaid.toISOString().slice(0, 10))
    throw new Error(
      "ROE employment dates must fall within Service Canada's 50-year history and 14-day future-payment limits.",
    );
  if (last < first || final < last)
    throw new Error(
      "ROE employment and final pay-period dates are inconsistent.",
    );
  if (!ROE_REASONS.includes(input.reason))
    throw new Error("Choose a published Service Canada reason code.");
  const recall = input.recall;
  if (
    !["N", "U", "Y"].includes(recall.code) ||
    (recall.code !== "Y" && recall.date)
  )
    throw new Error(
      "A recall date is only available with expected recall code Y.",
    );
  const recallDate =
    recall.code === "Y" ? date(recall.date, "Expected recall date") : undefined;
  if (recallDate && (recallDate <= last || /^[EGM]/.test(input.reason)))
    throw new Error(
      "The expected recall date/reason combination is not permitted.",
    );
  const finalOffset = Math.round(
      (Date.parse(final) - Date.parse(last)) / 86400000,
    ),
    finalDate = new Date(`${final}T00:00:00Z`),
    endOfMonth = new Date(
      Date.UTC(finalDate.getUTCFullYear(), finalDate.getUTCMonth() + 1, 0),
    ).getUTCDate(),
    finalDay = finalDate.getUTCDate();
  const maxOffset = (
    { W: 6, B: 13, S: 15, E: 15, M: 30, O: 30, H: 27 } as const
  )[input.payPeriodCode];
  if (
    finalOffset > maxOffset ||
    (input.payPeriodCode === "S" &&
      finalDay !== 15 &&
      finalDay !== endOfMonth) ||
    (input.payPeriodCode === "M" && finalDay !== endOfMonth) ||
    (input.payPeriodCode === "E" &&
      (finalDay === 15 ||
        (finalDay === endOfMonth && finalDate.getUTCMonth() !== 1))) ||
    (input.payPeriodCode === "O" &&
      finalDay === endOfMonth &&
      finalDate.getUTCMonth() !== 1)
  )
    throw new Error(
      "The final ROE period end does not match the pay-frequency/date rules.",
    );
  for (const row of [
    input.vacation,
    ...(input.otherMonies ?? []),
    ...(input.specialPayments ?? []),
  ])
    if (
      row &&
      [row.startDate, row.endDate].some(
        (value) => value && date(value, "Separation payment date") < earliest,
      )
    )
      throw new Error(
        "ROE separation payment dates must fall within the official 50-year history limit.",
      );
  const maximum = ROE_PAY_PERIODS[input.payPeriodCode],
    periods = input.payPeriods;
  if (
    !maximum ||
    !Array.isArray(periods) ||
    !periods.length ||
    periods.length > maximum
  )
    throw new Error(
      "Supply the complete consecutive ROE pay-period history up to the official lookback maximum.",
    );
  let hours = 0;
  const rows = periods.map((row, index) => {
    const start = date(row.startDate, "Historical pay-period start"),
      end = date(row.endDate, "Historical pay-period end");
    if (
      end < start ||
      (index === 0 && (end !== final || last < start || last > end)) ||
      (index > 0 && dayAfter(end) !== periods[index - 1].startDate)
    )
      throw new Error(
        "ROE pay periods must be consecutive, most recent first, and end in the actual final pay period.",
      );
    const days =
        Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
      expectedDays = (
        { W: 7, B: 14, H: 28 } as Partial<
          Record<keyof typeof ROE_PAY_PERIODS, number>
        >
      )[input.payPeriodCode];
    const monthEnd = new Date(`${end}T00:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    if (
      (expectedDays && days !== expectedDays) ||
      (input.payPeriodCode === "M" &&
        (start.slice(8) !== "01" ||
          start.slice(0, 7) !== end.slice(0, 7) ||
          Number(end.slice(8)) !== monthEnd.getUTCDate())) ||
      (input.payPeriodCode === "S" &&
        (start.slice(0, 7) !== end.slice(0, 7) ||
          !(
            (start.slice(8) === "01" && end.slice(8) === "15") ||
            (start.slice(8) === "16" &&
              Number(end.slice(8)) === monthEnd.getUTCDate())
          )))
    )
      throw new Error(
        "Historical pay-period dates do not match the selected ROE pay-period frequency.",
      );
    const amount = cents(
      row.insurableEarningsCents,
      "ROE insurable earnings",
      false,
      999999999,
    );
    if (
      (index === 0 && amount < 100) ||
      (start <= first && end >= first && amount === 0)
    )
      throw new Error(
        "The final pay period must contain at least $1 and the first employment period must have insurable earnings.",
      );
    hours += finite(row.insurableHours, "Historical insurable hours");
    return `<PP nbr="${index + 1}">${amountTag("AMT", amount, 7)}</PP>`;
  });
  const oldest = periods[periods.length - 1];
  if (
    periods.length < maximum &&
    !(oldest.startDate <= first && oldest.endDate >= first)
  )
    throw new Error(
      "Historical periods stop before the first day worked; complete the missing history or official lookback.",
    );
  if (oldest.endDate < first)
    throw new Error(
      "ROE history contains periods before this period of employment.",
    );
  // Appendix D, block 15A: round the total upward once, never each individual pay period.
  const wholeHours = Math.ceil(hours),
    employmentDays =
      Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  if (wholeHours < 1 || wholeHours > 8904 || wholeHours > employmentDays * 24)
    throw new Error(
      "ROE insurable hours exceed the official range or actual employment duration.",
    );
  const person = input.employee,
    address = person.address;
  if (!address)
    throw new Error("Enter the employee's transient ROE mailing address.");
  let extra = "",
    insurableSeparation = 0;
  if (input.vacation) {
    const v = input.vacation;
    if (
      !["1", "2", "3", "4"].includes(v.code) ||
      (v.code === "1" && (v.startDate || v.endDate || v.amountCents != null)) ||
      (v.code === "2" && (v.startDate || v.endDate)) ||
      (v.code === "4" && v.endDate)
    )
      throw new Error(
        "Vacation dates/amounts do not match the selected official ROE vacation code.",
      );
    const detail = datedRoeMoney(v, "ROE vacation", v.code !== "1");
    if (
      v.code === "2" ||
      (v.code === "4" && detail.start && detail.start > last)
    )
      insurableSeparation += detail.amount ?? 0;
    extra += block(
      "B17A",
      `<VP nbr="1">${tag("CD", v.code)}${detail.xml}</VP>`,
    );
  }
  if ((input.statutoryHolidays?.length ?? 0) > 10)
    throw new Error("An ROE supports at most ten statutory-holiday entries.");
  const holidayDates = new Set<string>();
  if (input.statutoryHolidays?.length)
    extra += block(
      "B17B",
      input.statutoryHolidays
        .map((row, index) => {
          const holidayDate = row.date
            ? date(row.date, "Separation statutory holiday")
            : undefined;
          if (
            holidayDate &&
            (holidayDate <= last || holidayDates.has(holidayDate))
          )
            throw new Error(
              "ROE statutory-holiday dates must be distinct and follow the last day paid.",
            );
          if (holidayDate) holidayDates.add(holidayDate);
          const amount = positiveRoeAmount(
            row.amountCents,
            "ROE statutory holiday",
          );
          insurableSeparation += amount;
          return `<SH nbr="${index + 1}">${holidayDate ? tag("DT", holidayDate) : ""}${amountTag("AMT", amount, 7)}</SH>`;
        })
        .join(""),
    );
  if ((input.otherMonies?.length ?? 0) > 3)
    throw new Error("An ROE supports at most three other-monies entries.");
  if (input.otherMonies?.length)
    extra += block(
      "B17C",
      input.otherMonies
        .map((row, index) => {
          const rule = ROE_OTHER_MONIES[row.code];
          if (
            !rule ||
            (!rule.start && row.startDate) ||
            (!rule.end && row.endDate)
          )
            throw new Error(
              "Other monies must follow the published code/date rules.",
            );
          const detail = datedRoeMoney(row, "ROE other monies", rule.required);
          if (rule.insurable) insurableSeparation += detail.amount ?? 0;
          return `<OM nbr="${index + 1}">${tag("CD", row.code)}${detail.xml}</OM>`;
        })
        .join(""),
    );
  const comments = optionalText(input.comments, "ROE comments", 160);
  if (["K00", "K15"].includes(input.reason) && !comments)
    throw new Error(
      "The selected ROE reason requires a specific explanatory comment.",
    );
  if (comments) extra += tag("B18", comments);
  if ((input.specialPayments?.length ?? 0) > 4)
    throw new Error(
      "An ROE supports at most four distinct special-payment types.",
    );
  const specialCodes = new Set<string>();
  if (input.specialPayments?.length)
    extra += block(
      "B19",
      input.specialPayments
        .map((row) => {
          if (
            !["PSL01", "MAT01", "WLI01", "WLI02"].includes(row.code) ||
            specialCodes.has(row.code)
          )
            throw new Error(
              "Choose distinct official ROE special-payment codes.",
            );
          specialCodes.add(row.code);
          const mandatory = ["PSL01", "MAT01"].includes(row.code),
            detail = datedRoeMoney(row, "ROE special payment", mandatory);
          if (
            (mandatory &&
              ((detail.start && detail.start > last) ||
                (detail.end && detail.end !== last))) ||
            (row.code === "WLI01" && detail.start && detail.start <= last)
          )
            throw new Error(
              "Special-payment dates do not follow the official ROE rules.",
            );
          if (row.period && !["D", "W"].includes(row.period))
            throw new Error("Choose a daily or weekly special-payment period.");
          return `<SP cd="${row.code}">${detail.xml}${row.period ? tag("PRD", row.period) : ""}</SP>`;
        })
        .join(""),
    );
  if (periods[0].insurableEarningsCents <= insurableSeparation)
    throw new Error(
      "Final-period insurable earnings must include and exceed all insurable block 17 separation payments.",
    );
  const contact = input.contact,
    telephone = phone(contact.phone).replace("-", "");
  if (contact.extension && !/^\d{1,8}$/.test(contact.extension))
    throw new Error("ROE contact extension requires 1–8 digits.");
  const identity =
    tag("FN", text(person.givenName, "Employee given name", 20)) +
    (person.initial
      ? tag("MN", text(person.initial, "Employee middle name", 4))
      : "") +
    tag("LN", text(person.surname, "Employee surname", 28)) +
    tag(
      "A1",
      text(
        [address.line1, address.line2].filter(Boolean).join(" "),
        "Employee street address",
        35,
      ),
    ) +
    tag("A2", text(address.city, "Employee city", 35)) +
    tag(
      "A3",
      text(
        `${address.province} ${address.country}`,
        "Employee province/country",
        35,
      ),
    ) +
    tag("PC", text(address.postalCode, "Employee postal/ZIP code", 10));
  if (
    input.amendedSerialNumber &&
    !/^[WMSYAEKLZ]\d{8}$/.test(input.amendedSerialNumber)
  )
    throw new Error(
      "An amended ROE requires the actual original electronic or paper serial prefix and eight digits.",
    );
  if (input.amendedSerialNumber && /^[AEKLZ]/.test(input.amendedSerialNumber) && (!/amending a paper ROE/i.test(input.comments ?? "") || !(input.comments ?? "").includes(input.amendedSerialNumber))) throw new Error("An electronic amendment of a paper ROE must include 'Amending a paper ROE' and the original paper serial in Block 18 comments.");
  const content =
    (input.amendedSerialNumber ? tag("B2", input.amendedSerialNumber) : "") +
    (input.payrollReference
      ? tag("B3", text(input.payrollReference, "Payroll reference", 26))
      : "") +
    tag("B5", account) +
    tag("B6", input.payPeriodCode) +
    tag("B8", validatePayrollSin(person.sin)) +
    block("B9", identity) +
    tag("B10", first) +
    tag("B11", last) +
    tag("B12", final) +
    (input.occupation
      ? tag("B13", text(input.occupation, "Occupation", 40))
      : "") +
    block(
      "B14",
      tag("CD", recall.code) + (recallDate ? tag("DT", recallDate) : ""),
    ) +
    tag("B15A", wholeHours) +
    block("B15C", rows.join("")) +
    block(
      "B16",
      tag("CD", input.reason) +
        tag("FN", text(contact.givenName, "ROE contact given name", 20)) +
        tag("LN", text(contact.surname, "ROE contact surname", 28)) +
        tag("AC", digits(contact.areaCode, 3, "ROE contact area code")) +
        tag("TEL", telephone) +
        (contact.extension ? tag("EXT", contact.extension) : ""),
    ) +
    extra +
    tag("B20", input.printingLanguage);
  const xml = `${XML_HEADER}<ROEHEADER FileVersion="W-2.0" SoftwareVendor="Societyer" ProductName="Societyer Payroll"><ROE PrintingLanguage="${input.printingLanguage}" Issue="${input.issue}">${content}</ROE></ROEHEADER>`;
  if (new TextEncoder().encode(xml).byteLength > 1_000_000)
    throw new Error("ROE extract exceeds Service Canada's 1 MB file limit.");
  return {
    xml,
    filename: `ROE-${last}.xml`,
    schemaVersion: "W-2.0",
    schemaFile: "PayrollExtractXmlV2.xsd",
    recordCount: 1,
    warnings: [
      "Sensitive employee identifiers exist only in this generated export; no filing has been submitted.",
      "Review insurable history, interruption-of-earnings dates, separation amounts and the selected reason before submitting through ROE Web.",
    ],
  };
}
