import React from "react";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { renderDocument } from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DEFAULT_INVOICE_TEMPLATE,
  resolveDocumentDesign,
} from "../shared/invoiceCommerce";
import { decorateDocumentPdf } from "../src/features/invoicing/documentPdfDecoration";
import { PayrollStatementPdfDocument } from "../src/features/payrollCalculation/PayrollStatementPdfDocument";
import {
  exportT4Xml,
  exportT4AXml,
  exportRoeXml,
  validatePayrollStatement,
  payrollStatementReport,
  payrollStatementCsv,
  validatePayrollSin,
  validatePayrollBusinessNumber,
  prepareT4AnnualRecords,
  payrollOtherInformationFields,
  type PayrollStatement,
  type T4FilingInput,
  type T4AFilingInput,
  type RoeFilingInput,
} from "../shared/payrollReporting";
const output = "/workspace/scratch/payroll-reporting";
await mkdir(output, { recursive: true });
const address = {
  line1: "100 Sample Street",
  city: "Victoria",
  province: "BC",
  country: "CAN",
  postalCode: "V8V 1X4",
};
// Publicly documented synthetic identifier examples, never read from a real workspace.
const identity = {
  employeeId: "example-employee",
  givenName: "Alex",
  surname: "Sample",
  sin: "046454286",
  address,
};
const employer = {
  name: "Sample Society",
  payrollAccount: "123456782RP0001",
  address,
  contactName: "Alex Sample",
  contactAreaCode: "250",
  contactPhone: "5550101",
};
const transmitter = {
  accountNumber: "123456782",
  name: "Sample Society",
  country: "CAN",
  contactName: "Alex Sample",
  contactAreaCode: "250",
  contactPhone: "5550101",
  contactEmail: "example@example.test",
  language: "E" as const,
};
const base = {
  submissionVersion: "2026" as const,
  earningsYear: 2026,
  currency: "CAD" as const,
  submissionReference: "TEST0001",
  reportType: "O" as const,
  employer,
  transmitter,
  recordsComplete: true,
  sameEmployerConfirmed: true,
};
const t4: T4FilingInput = {
  ...base,
  employer: {
    ...employer,
    name: "Sample Society for Student Services and Community Support",
  },
  identities: [identity],
  employerContributions: {
    cppCents: 423045,
    cpp2Cents: 41600,
    eiCents: 157230,
  },
  records: [
    {
      employeeId: identity.employeeId,
      provinceOfEmployment: "BC",
      employmentIncomeCents: 8500000,
      cppEmployeeCents: 423045,
      cpp2EmployeeCents: 41600,
      eiEmployeeCents: 112307,
      incomeTaxCents: 1600000,
      pensionableEarningsCents: 8500000,
      insurableEarningsCents: 6890000,
      dentalBenefitsCode: "3",
      cppExempt: false,
      eiExempt: false,
      otherInformation: [{ code: "40", amountCents: 10000 }],
    },
  ],
};
const t4a: T4AFilingInput = {
  ...base,
  identities: [
    identity,
    {
      employeeId: "corporation",
      corporationName: "Sample Services",
      businessNumber: "123456782RC0001",
      address,
    },
  ],
  records: [
    {
      employeeId: identity.employeeId,
      classificationConfirmed: true,
      otherIncomeCents: 50000,
      annuityIncomeCents: 10000,
      incomeTaxCents: 5000,
      otherInformation: [{ code: "105", amountCents: 10000 }],
    },
    {
      employeeId: "corporation",
      classificationConfirmed: true,
      feesForServicesCents: 200000,
      incomeTaxCents: 0,
    },
  ],
};
const roe: RoeFilingInput = {
  currency: "CAD",
  validationDate: "2026-10-23",
  payrollAccount: employer.payrollAccount,
  employee: identity,
  printingLanguage: "E",
  issue: "S",
  payPeriodCode: "B",
  firstDayWorked: "2026-10-01",
  lastDayPaid: "2026-10-23",
  finalPayPeriodEnd: "2026-10-28",
  recall: { code: "U" },
  reason: "A00",
  contact: {
    givenName: "Alex",
    surname: "Sample",
    areaCode: "250",
    phone: "5550101",
  },
  recordsComplete: true,
  sameEmployerConfirmed: true,
  separationPaymentsReviewed: true,
  payPeriods: [
    {
      startDate: "2026-10-15",
      endDate: "2026-10-28",
      insurableEarningsCents: 150000,
      insurableHours: 48.2,
    },
    {
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      insurableEarningsCents: 180000,
      insurableHours: 64.2,
    },
  ],
  vacation: { code: "2", amountCents: 20000 },
  otherMonies: [{ code: "Y00", amountCents: 20000 }],
  statutoryHolidays: [{ date: "2026-11-11", amountCents: 10000 }],
  specialPayments: [
    {
      code: "PSL01",
      amountCents: 10000,
      startDate: "2026-10-22",
      endDate: "2026-10-23",
      period: "D",
    },
  ],
};
const generated = [];
for (const submissionVersion of ["2026", "2027"] as const) {
  generated.push(
    exportT4Xml({ ...t4, submissionVersion }),
    exportT4AXml({ ...t4a, submissionVersion }),
  );
}
generated.push(exportRoeXml(roe));
const paperAmendment = exportRoeXml({
  ...roe,
  amendedSerialNumber: "E00000001",
  comments: "Amending a paper ROE E00000001",
});
assert.match(paperAmendment.xml, /<B2>E00000001<\/B2>/);
assert.match(paperAmendment.xml, /Amending a paper ROE E00000001/);
generated.push(paperAmendment);
assert.throws(
  () => exportRoeXml({ ...roe, amendedSerialNumber: "E00000001" }),
  /Amending a paper ROE/,
);

for (const submissionVersion of ["2026", "2027"] as const) {
  const fields = (form: "t4" | "t4a", count: number) =>
    Object.entries(payrollOtherInformationFields(submissionVersion, form))
      .filter(
        ([, field]) =>
          /Decimal/i.test(field.type) &&
          !field.reservedForCra &&
          !field.maxTaxYear &&
          !field.onlyTaxYear,
      )
      .slice(0, count)
      .map(([code]) => ({ code, amountCents: 1000 }));
  const expandedT4 = exportT4Xml({
    ...t4,
    submissionVersion,
    records: [{ ...t4.records[0], otherInformation: fields("t4", 7) }],
  });
  const expandedT4a = exportT4AXml({
    ...t4a,
    submissionVersion,
    records: [
      {
        ...t4a.records[0],
        otherIncomeCents: undefined,
        otherInformation: fields("t4a", 13),
      },
    ],
  });
  assert.equal(expandedT4.recordCount, 2);
  assert.equal(
    (expandedT4.xml.match(/<T4_AMT>/g) ?? []).length,
    1,
    "additional information slips do not repeat financial boxes",
  );
  assert.match(expandedT4.xml, /<tot_empt_incamt>85000\.00<\/tot_empt_incamt>/);
  assert.match(expandedT4.xml, /<slp_cnt>2<\/slp_cnt>/);
  assert.equal(expandedT4a.recordCount, 2);
  assert.equal((expandedT4a.xml.match(/<T4A_AMT>/g) ?? []).length, 1);
  assert.match(
    expandedT4a.xml,
    /<rpt_tot_oth_info_amt>130\.00<\/rpt_tot_oth_info_amt>/,
  );
  assert.match(expandedT4a.xml, /<slp_cnt>2<\/slp_cnt>/);
  generated.push(
    {
      ...expandedT4,
      filename: `extra-information-T4-${submissionVersion}.xml`,
    },
    {
      ...expandedT4a,
      filename: `extra-information-T4A-${submissionVersion}.xml`,
    },
  );
}

for (const result of generated)
  await writeFile(`${output}/${result.filename}`, result.xml);
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    generated.map(({ filename, schemaFile }) => ({ filename, schemaFile })),
  ),
);
const validated = spawnSync(
  "python",
  [
    "-c",
    `from lxml import etree\nimport json,pathlib\np=pathlib.Path('${output}')\nfor record in json.loads((p/'manifest.json').read_text()):\n schema=etree.XMLSchema(etree.parse(str(pathlib.Path('shared/payrollSchemas')/record['schemaFile'])))\n schema.assertValid(etree.parse(str(p/record['filename'])))\nprint('Official CRA 2026/2027 and Service Canada XSD validation passed.')`,
  ],
  { encoding: "utf8" },
);
assert.equal(validated.status, 0, validated.stderr);
const capped = prepareT4AnnualRecords(
  [
    {
      ...t4.records[0],
      pensionableEarningsCents: 10000000,
      insurableEarningsCents: 10000000,
    },
  ],
  2026,
);
assert.equal(capped[0].pensionableEarningsCents, 8500000);
assert.equal(capped[0].insurableEarningsCents, 6890000);
assert.throws(
  () =>
    prepareT4AnnualRecords(
      [
        { ...t4.records[0], pensionableEarningsCents: 8000000 },
        {
          ...t4.records[0],
          provinceOfEmployment: "ON",
          pensionableEarningsCents: 1000000,
        },
      ],
      2026,
    ),
  /Multiple provinces/,
);
assert.throws(() => prepareT4AnnualRecords(t4.records, 2027), /reviewed/);
assert.match(
  exportT4Xml({
    ...t4,
    submissionVersion: "2027",
    records: [
      {
        ...t4.records[0],
        pensionableEarningsCents: 10000000,
        insurableEarningsCents: 10000000,
      },
    ],
  }).xml,
  /<cpp_qpp_ern_amt>85000\.00<\/cpp_qpp_ern_amt>/,
  "2027 submission uses 2026 earnings caps",
);
assert.match(generated[0].xml, /<cppe_cntrb_amt>416\.00<\/cppe_cntrb_amt>/);
assert.match(
  generated[0].xml,
  /<tot_empr_cppe_amt>416\.00<\/tot_empr_cppe_amt>/,
);
assert.match(
  generated[1].xml,
  /<rpt_tot_fee_srvc_amt>2000\.00<\/rpt_tot_fee_srvc_amt>/,
);
assert.match(
  generated[4].xml,
  /<B15A>113<\/B15A>/,
  "round total hours upward once",
);
assert.throws(() => validatePayrollSin("000000000"), /checksum/);
assert.throws(() => validatePayrollSin("046454287"), /checksum/);
assert.throws(
  () => validatePayrollBusinessNumber("123456783RP0001", true),
  /account/,
);
assert.throws(
  () => exportT4Xml({ ...t4, recordsComplete: false }),
  /all source/,
);
assert.throws(
  () =>
    exportT4Xml({
      ...t4,
      records: [{ ...t4.records[0], dentalBenefitsCode: undefined }],
    }),
  /dental/,
);
assert.throws(
  () =>
    exportT4Xml({
      ...t4,
      records: [{ ...t4.records[0], cppEmployeeCents: 0 }],
    }),
  /same slip/,
);
assert.throws(
  () =>
    exportT4Xml({
      ...t4,
      records: [{ ...t4.records[0], provinceOfEmployment: "QC" }],
    }),
  /QPP/,
);
assert.throws(
  () =>
    exportT4Xml({
      ...t4,
      records: [{ ...t4.records[0], rppClassificationRequired: true }],
    }),
  /RRSP/,
);
assert.throws(
  () =>
    exportT4AXml({
      ...t4a,
      records: [{ ...t4a.records[0], classificationConfirmed: false }],
    }),
  /honorarium/,
);
assert.throws(
  () => exportRoeXml({ ...roe, payPeriods: roe.payPeriods.slice(0, 1) }),
  /missing history/,
);
assert.throws(
  () =>
    exportRoeXml({
      ...roe,
      payPeriods: [
        { ...roe.payPeriods[0], startDate: "2026-10-16" },
        roe.payPeriods[1],
      ],
    }),
  /consecutive|frequency/,
);
assert.throws(
  () => exportRoeXml({ ...roe, separationPaymentsReviewed: false }),
  /separation/,
);
assert.throws(() => exportRoeXml({ ...roe, reason: "K00" }), /comment/);
const statement: PayrollStatement = {
  schemaVersion: 1,
  calculationId: "example-calculation",
  calculationVersion: 2,
  statementNumber: "PAY-2026-002",
  status: "finalized",
  employer: { name: employer.name, address: "100 Sample Street, Victoria BC" },
  employee: {
    employeeId: identity.employeeId,
    name: "Alex Sample",
    provinceOfEmployment: "BC",
  },
  currency: "CAD",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-14",
  payDate: "2026-10-16",
  runType: "regular",
  earnings: [
    {
      key: "regular",
      code: "REG",
      label: "Regular work",
      date: "2026-10-01",
      hours: 40,
      rateCents: 2500,
      amountCents: 100000,
      cashCents: 100000,
      taxableCents: 100000,
      pensionableCents: 100000,
      insurableCents: 100000,
      vacationableCents: 100000,
      ehtCents: 100000,
      workSafeCents: 100000,
    },
    {
      key: "benefit",
      code: "BEN",
      label: "Noncash insurance benefit",
      amountCents: 10000,
      cashCents: 0,
      taxableCents: 10000,
      pensionableCents: 10000,
      insurableCents: 0,
      vacationableCents: 0,
      ehtCents: 10000,
      workSafeCents: 0,
    },
    {
      key: "reimburse",
      code: "REIM",
      label: "Actual expense reimbursement",
      amountCents: 5000,
      cashCents: 5000,
      taxableCents: 0,
      pensionableCents: 0,
      insurableCents: 0,
      vacationableCents: 0,
      ehtCents: 0,
      workSafeCents: 0,
    },
  ],
  totals: {
    grossCents: 110000,
    taxableCents: 110000,
    cashCents: 105000,
    nonCashTaxableCents: 10000,
    nonTaxableCashCents: 5000,
    cppEmployeeCents: 5000,
    cpp2EmployeeCents: 1000,
    eiEmployeeCents: 1500,
    federalTaxCents: 10000,
    provincialTaxCents: 5000,
    additionalIncomeTaxCents: 500,
    incomeTaxCents: 15500,
    otherDeductionsCents: 1000,
    netCents: 81000,
    cppEmployerCents: 5000,
    cpp2EmployerCents: 1000,
    eiEmployerCents: 2100,
    employerCostCents: 123100,
  },
  yearToDate: {
    year: 2026,
    grossCents: 110000,
    cashCents: 105000,
    taxableCents: 110000,
    cppEmployeeCents: 5000,
    cpp2EmployeeCents: 1000,
    eiEmployeeCents: 1500,
    incomeTaxCents: 15500,
    netCents: 81000,
    pensionableCents: 110000,
    insurableCents: 100000,
  },
  otherDeductions: [{ label: "Employee pension", amountCents: 1000 }],
  employerCosts: [{ label: "Noncash insurance cost", amountCents: 10000 }],
  rules: {
    edition: "CRA July 2026",
    method: "Option 1",
    sources: [
      "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll.html",
    ],
    explanations: ["Payment-year rules selected from the actual pay date."],
  },
  finalizedAtISO: "2026-10-16T12:00:00Z",
  warnings: [],
};
assert.deepEqual(validatePayrollStatement(statement).totals, statement.totals);
assert.equal(
  validatePayrollStatement(statement).yearToDate?.insurableHours,
  undefined,
);
assert.throws(
  () => validatePayrollStatement({ ...statement, sin: identity.sin } as any),
  /Sensitive/,
);
assert.throws(
  () =>
    validatePayrollStatement({
      ...statement,
      totals: { ...statement.totals, cashCents: 1 },
    }),
  /benefit/,
);
assert.throws(
  () =>
    validatePayrollStatement({
      ...statement,
      totals: { ...statement.totals, federalTaxCents: 1 },
    }),
  /combined/,
);
assert.throws(
  () =>
    validatePayrollStatement({
      ...statement,
      employerCosts: [{ label: "Duplicate CPP", amountCents: 15000 }],
    }),
  /Employer cost/,
);
const unknown = payrollStatementReport({
  ...statement,
  totals: {
    ...statement.totals,
    federalTaxCents: null,
    provincialTaxCents: null,
  },
});
assert.ok(unknown.warnings?.some((warning) => warning.includes("no split")));
assert.ok(
  !unknown.sections
    ?.flatMap((section) => section.rows)
    .some((row) => row.cells[0] === "Federal income tax"),
);
assert.ok(
  !payrollStatementCsv(statement).includes(identity.sin),
  "statements never contain SIN",
);
const regular = new Uint8Array(
    await readFile("src/assets/invoice-branding/Inter-Regular.ttf"),
  ),
  bold = new Uint8Array(
    await readFile("src/assets/invoice-branding/Inter-SemiBold.ttf"),
  );
const fonts = [
  { family: "Invoice", src: regular },
  { family: "Invoice", src: bold, fontWeight: "bold" as const },
];
const template = {
  ...DEFAULT_INVOICE_TEMPLATE,
  design: resolveDocumentDesign(DEFAULT_INVOICE_TEMPLATE),
};
template.design.footer.pageNumbers = true;
const pdf = await decorateDocumentPdf(
  await renderDocument(
    <PayrollStatementPdfDocument
      statement={statement}
      template={template}
      fonts={fonts}
      organization={{ name: employer.name }}
    />,
  ),
  { config: template, fonts, organizationName: employer.name },
);
await writeFile(`${output}/pay-statement.pdf`, pdf);
const parsed = await getDocument({ data: pdf.slice(), disableFontFace: true })
  .promise;
let visible = "";
for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber++)
  visible += (await (await parsed.getPage(pageNumber)).getTextContent()).items
    .map((item: any) => item.str ?? "")
    .join(" ");
for (const expected of [
  "Pay statement",
  "Alex Sample",
  "PAY-2026-002",
  "Employee CPP2",
  "Unknown",
  "same-employer year-to-date",
  "Additional requested income tax",
  "Noncash insurance benefit",
  "Actual expense reimbursement",
  "$810.00",
  "version 2",
  "CRA July 2026",
  `Page 1 of ${parsed.numPages}`,
])
  assert.ok(
    visible.replace(/\s+/g, " ").includes(expected),
    `native statement contains ${expected}`,
  );
assert.ok(!visible.includes(identity.sin));
await parsed.destroy();
assert.throws(
  () =>
    exportT4AXml({
      ...t4a,
      identities: [
        identity,
        {
          employeeId: "corporation",
          corporationName: "Sample Services",
          businessNumber: "123456782",
          address,
        },
      ],
    }),
  /BN15/,
);
console.log(
  "Payroll reporting passed: native statement/classification/net/CPP2/version, truthful unknown tax split, official CRA 2026/2027 T619+T4/T4A and Service Canada ROE XSD validation, complete history and sensitive identifier safeguards.",
);
