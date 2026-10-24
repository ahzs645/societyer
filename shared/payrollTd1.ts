/** Sanitized TD1 review DTOs. File bytes, names, addresses, DOB, SIN, signature
 * images and raw extracted/OCR text never belong in these ordinary records. */
export type PayrollTd1Form = "federal" | "BC";
export type PayrollTd1Method = "acroform" | "pdf_text" | "local_ocr" | "mixed";
export type PayrollTd1Confidence = "high" | "medium" | "low" | "unknown";
export type PayrollTd1Evidence = { method: PayrollTd1Method; page?: number; sourceField?: string; description: string };
export type PayrollTd1Field<T extends number | boolean> = { value: T | null; confidence: PayrollTd1Confidence; evidence: PayrollTd1Evidence[]; needsReview: boolean };
export type PayrollTd1Fields = {
  totalClaimCents: PayrollTd1Field<number>;
  multipleEmployers: PayrollTd1Field<boolean>;
  totalIncomeLessThanClaims: PayrollTd1Field<boolean>;
  additionalTaxCents: PayrollTd1Field<number>;
  annualZoneDeductionCents: PayrollTd1Field<number>;
  nonResident90Percent: PayrollTd1Field<boolean>;
};
export type PayrollTd1ClaimLine = { line: number; label: string; amountCents: PayrollTd1Field<number> };
export type PayrollTd1ParseResult = {
  schemaVersion: 1; expectedForm: PayrollTd1Form; expectedYear: number;
  form: PayrollTd1Form | null; year: number | null;
  source: { sha256: string; mediaType: "application/pdf" | "image/png" | "image/jpeg"; pageCount: number; method: PayrollTd1Method; originalStored: false };
  fields: PayrollTd1Fields; claimLines: PayrollTd1ClaimLine[];
  status: "review_required" | "blocked"; requiresManualReview: true; signatureVerified: false;
  requiredReviewFields: string[]; blockers: string[]; warnings: string[];
  sources: Array<{ title: string; url: string; reviewedOn: string }>;
};
export const PAYROLL_TD1_SOURCES = {
  federal: [{ title: "2026 federal TD1 fillable form", url: "https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1/td1-fill-26e.pdf", reviewedOn: "2026-10-23" }],
  BC: [{ title: "2026 British Columbia TD1BC fillable form", url: "https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1bc/td1bc-fill-26e.pdf", reviewedOn: "2026-10-23" }],
} as const;

/** Transient extraction boundary, never a persistence DTO. */
export type PayrollTd1InputField = { name: string; type: string; value: unknown; page?: number; rect?: number[]; exportValues?: unknown };
export type PayrollTd1TextItem = { text: string; page: number; x?: number; y?: number; width?: number; height?: number; confidence?: number };
export type PayrollTd1EvidenceInput = { expectedForm: PayrollTd1Form; expectedYear: number; sha256: string; mediaType: PayrollTd1ParseResult["source"]["mediaType"]; pageCount: number; method: PayrollTd1Method; fields?: PayrollTd1InputField[]; textItems: PayrollTd1TextItem[] };

const LABELS = {
  federal: ["Basic personal amount", "Caregiver amount for infirm children under 18", "Age amount", "Pension income amount", "Tuition", "Disability amount", "Spouse or common-law partner amount", "Eligible dependant amount", "Caregiver amount for eligible dependant or partner", "Caregiver amount for adult dependants", "Amounts transferred from partner", "Amounts transferred from dependant", "Total claim amount"],
  BC: ["Basic personal amount", "Age amount", "Pension income amount", "Tuition", "Disability amount", "Spouse or common-law partner amount", "Eligible dependant amount", "British Columbia caregiver amount", "Amounts transferred from partner", "Amounts transferred from dependant", "Total claim amount"],
};
const LINE_Y = { federal: [612, 573, 543, 513, 483, 462, 387, 300, 270, 204, 174, 144, 123], BC: [618, 588, 558, 528, 507, 441, 354, 282, 252, 222, 201] };
const METHODS: PayrollTd1Method[] = ["acroform", "pdf_text", "local_ocr", "mixed"];
const unknown = <T extends number | boolean>(applicable = true): PayrollTd1Field<T> => ({ value: null, confidence: "unknown", evidence: [], needsReview: applicable });
function amount(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw).trim().replace(/^(?:CAD|C\$|\$)\s*/i, "").replace(/[\u00a0 ]/g, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  // A nine-digit identity value is never accepted as a claim. No original
  // numeric string is retained, including invalid values supplied in a box.
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1_000_000_000 ? cents : null;
}
function bool(raw: unknown): boolean | null {
  if (raw === true || /^(?:yes|on|true|1)$/i.test(String(raw))) return true;
  if (raw === false || /^(?:off|false|0)$/i.test(String(raw))) return false;
  return null;
}
function field<T extends number | boolean>(value: T, input: PayrollTd1EvidenceInput, key: string, method: PayrollTd1Method, page: number): PayrollTd1Field<T> {
  return { value, confidence: method === "acroform" ? "high" : method === "local_ocr" ? "low" : "medium", needsReview: true, evidence: [{ method, page, sourceField: key, description: `${method === "acroform" ? "Recognized official form field" : method === "local_ocr" ? "Local OCR candidate in the labelled form area" : "Positioned value in the labelled form area"}; verify against the original declaration.` }] };
}
function textLines(items: PayrollTd1TextItem[]): string[] {
  const rows: Array<{ page: number; y: number; items: PayrollTd1TextItem[] }> = [];
  for (const item of items) {
    if (item.y === undefined) { rows.push({ page: item.page, y: -rows.length, items: [item] }); continue; }
    const row = rows.find(row => row.page === item.page && Math.abs(row.y - item.y!) < 3);
    if (row) row.items.push(item); else rows.push({ page: item.page, y: item.y, items: [item] });
  }
  return rows.sort((a, b) => a.page - b.page || b.y - a.y).map(row => row.items.sort((a, b) => (a.x ?? 0) - (b.x ?? 0)).map(item => item.text).join(" "));
}
function positioned(items: PayrollTd1TextItem[], page: number, x0: number, x1: number, y0: number, y1: number) {
  return items.filter(item => item.page === page && item.x !== undefined && item.y !== undefined && item.x >= x0 && item.x <= x1 && item.y >= y0 && item.y <= y1).sort((a, b) => (a.x ?? 0) - (b.x ?? 0)).map(item => item.text).join("").trim();
}
function checkboxText(raw: string): boolean | null {
  if (/^(?:\[\s*[xX✓✔]\s*\]|☑|☒|✓|✔|[xX])$/.test(raw.trim())) return true;
  if (/^(?:\[\s*\]|☐)$/.test(raw.trim())) return false;
  return null;
}

/** Only labelled official claim boxes and known AcroForm names are candidates.
 * Printed dollar examples, identity numbers and instructions are never claims. */
export function parsePayrollTd1Evidence(input: PayrollTd1EvidenceInput): PayrollTd1ParseResult {
  if (!/^[a-f0-9]{64}$/i.test(input.sha256) || !Number.isInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > 2 || !METHODS.includes(input.method)) throw new Error("TD1 extraction requires a SHA-256 source and one complete form of at most two pages.");
  const blockers: string[] = [], warnings = ["Every extracted value and declaration requires review against the original completed form. A parsed field is not a verified signature.", "A T1213 request is not CRA approval. Reduced withholding outside this form needs separately reviewed authority/evidence and is never enabled by this import."];
  const firstPage = input.textItems.filter(item => item.page === 1), maxY = Math.max(...firstPage.map(item => item.y ?? 0), 0);
  const header = textLines(firstPage.some(item => item.y !== undefined) ? firstPage.filter(item => item.y !== undefined && item.y > maxY - 140) : firstPage).join(" ").slice(0, 1800);
  const allLines = textLines(input.textItems), allText = allLines.join("\n");
  const provincial = /\bTD1(BC|AB|ON|MB|NB|NL|NS|NT|NU|PE|QC|SK|YT)\b/i.exec(header)?.[1]?.toUpperCase();
  const form: PayrollTd1Form | null = provincial === "BC" || /British\s+Columbia/i.test(header) ? "BC" : provincial ? null : /\bTD1\b/.test(header) && /Personal\s+Tax\s+Credits\s+Return/i.test(header) ? "federal" : null;
  const years = [...header.matchAll(/\b(20\d{2})\s+(?:(?:British\s+Columbia|Federal)\s+)?(?:Personal\s+Tax\s+Credits\s+Return|TD1(?:BC)?\b)/gi)].map(match => Number(match[1]));
  const year = new Set(years).size === 1 ? years[0] : null;
  if (!form) blockers.push(provincial ? "This is another province/territory's TD1; upload the requested federal or British Columbia form." : "The form identity could not be confirmed. Upload one clearly identified official TD1/TD1BC form.");
  if (form && form !== input.expectedForm) blockers.push("The detected federal/provincial form does not match this import slot.");
  const secondPage = input.textItems.filter(item => item.page === 2), secondTop = Math.max(...secondPage.map(item => item.y ?? 0), 0);
  const secondHeader = textLines(secondPage.some(item => item.y !== undefined) ? secondPage.filter(item => item.y !== undefined && item.y > secondTop - 140) : secondPage).join(" ").slice(0, 1600);
  const secondCode = /Filling\s+out\s+Form\s+(TD1(?:BC|AB|ON|MB|NB|NL|NS|NT|NU|PE|QC|SK|YT)?)\b/i.exec(secondHeader)?.[1]?.toUpperCase();
  if (form && secondCode && secondCode !== (form === "BC" ? "TD1BC" : "TD1")) blockers.push("The pages belong to different federal/provincial forms. Upload each complete declaration separately.");
  if (year === null) blockers.push("The declaration year is missing or ambiguous; no form year is inferred from other dates.");
  else if (year !== input.expectedYear || year !== 2026) blockers.push("This declaration is for a different or unreviewed form year. Only the official 2026 TD1 and TD1BC mappings are supported.");
  const shape = form ?? input.expectedForm, formCode = shape === "BC" ? "TD1BC" : "TD1", labels = LABELS[shape];
  const fields: PayrollTd1Fields = { totalClaimCents: unknown(), multipleEmployers: unknown(), totalIncomeLessThanClaims: unknown(), additionalTaxCents: unknown(shape === "federal"), annualZoneDeductionCents: unknown(shape === "federal"), nonResident90Percent: unknown(false) };
  const claimLines: PayrollTd1ClaimLine[] = labels.map((label, index) => ({ line: index + 1, label, amountCents: unknown() }));
  const readMethod = input.method === "local_ocr" || input.method === "mixed" ? "local_ocr" : "pdf_text";
  const takeNumber = (canonical: string, matches: PayrollTd1InputField[], fallback: string, page: number) => {
    const values = matches.map(item => amount(item.value)).filter((value): value is number => value !== null);
    if (new Set(values).size > 1) { blockers.push(`Conflicting values were found for ${canonical}; resolve the original form before applying this import.`); return unknown<number>(); }
    if (values.length) {
      const visible = amount(fallback);
      if (visible !== null && visible !== values[0]) { blockers.push(`The stored field and visible/OCR value disagree for ${canonical}; review the original form before applying it.`); return unknown<number>(); }
      return field(values[0], input, canonical, "acroform", page);
    }
    if (matches.some(item => String(item.value ?? "").trim())) warnings.push(`The entered ${canonical} amount was unreadable or invalid; review it manually. Its original contents were discarded.`);
    const value = amount(fallback); return value === null ? unknown<number>() : field(value, input, canonical, readMethod, page);
  };
  for (const line of claimLines) {
    const pattern = shape === "federal" ? new RegExp(`\\.Page1\\[0\\]\\.Subform1\\[0\\]\\.number${line.line}_subform\\[0\\]\\.Amount_fld\\[0\\]$`) : new RegExp(`\\.Page1\\[0\\]\\.Main_SF\\[0\\]\\.number${line.line}_subform\\[0\\]\\.Amount_${line.line}\\[0\\]$`);
    const y = LINE_Y[shape][line.line - 1], matches = (input.fields ?? []).filter(item => item.type === "text" && pattern.test(item.name));
    let candidate = positioned(input.textItems, 1, 507, 592, y - 12, y + 10);
    // Explicit labelled transcription is supported, but instructional prose
    // such as “Add lines 1 to 12” can never supply a numeric claim.
    if (!candidate && line.line === labels.length) {
      const explicit = allLines.map(text => /^\s*(?:\d+\.\s*)?TOTAL CLAIM AMOUNT\s*[:=]\s*((?:CAD\s*|C\$|\$)?[\d,]+(?:\.\d{1,2})?)\s*$/i.exec(text)?.[1]).filter((value): value is string => Boolean(value));
      if (new Set(explicit.map(amount)).size > 1) blockers.push("Conflicting labelled total claims require review of the original form.");
      else if (explicit.length) candidate = explicit[0];
    }
    line.amountCents = takeNumber(`${formCode}.line${line.line}`, matches, candidate, 1);
  }
  fields.totalClaimCents = claimLines.at(-1)!.amountCents;
  const readBox = (key: "multipleEmployers" | "totalIncomeLessThanClaims", suffix: RegExp, y0: number, heading: RegExp) => {
    const known = (input.fields ?? []).filter(item => item.type === "checkbox" && suffix.test(item.name)), values = known.map(item => bool(item.value)).filter((value): value is boolean => value !== null);
    if (new Set(values).size > 1) { blockers.push(`Conflicting ${formCode}.${key} declarations require review of the original form.`); return; }
    const marker = checkboxText(positioned(input.textItems, 2, 23, 41, y0, y0 + 15));
    if (values.length) { if (marker !== null && marker !== values[0]) { blockers.push(`The stored and visible/OCR ${formCode}.${key} declarations disagree; review the original.`); return; } fields[key] = field(values[0], input, `${formCode}.${key}`, "acroform", 2); return; }
    if (marker !== null) { fields[key] = field(marker, input, `${formCode}.${key}`, readMethod, 2); return; }
    const explicit = allLines.filter(line => heading.test(line)).map(line => /^(\[[xX ]*\]|☑|☒|☐|✓|✔)\s*/.exec(line)?.[1]).filter((value): value is string => Boolean(value));
    if (explicit.length === 1) { const value = checkboxText(explicit[0]); if (value !== null) fields[key] = field(value, input, `${formCode}.${key}`, readMethod, 2); }
  };
  readBox("multipleEmployers", shape === "federal" ? /\.Page2\[0\]\.Subform2\[0\]\.MoreThan_chk\[0\]$/ : /\.Page2\[0\]\.Subform2\[0\]\.More_than\[0\]$/, shape === "federal" ? 640 : 625, /More than one employer or payer at the same time/i);
  readBox("totalIncomeLessThanClaims", /\.Page2\[0\]\.Subform2\[0\]\.TotalIncome_chk\[0\]$/, shape === "federal" ? 595 : 577, /Total income is less than the total claim amount/i);
  if (shape === "federal") {
    fields.annualZoneDeductionCents = takeNumber("TD1.annualZoneDeductionCents", (input.fields ?? []).filter(item => /\.Page2\[0\]\.Subform2\[0\]\.Amount1\[0\]$/.test(item.name)), positioned(input.textItems, 2, 505, 592, 365, 384), 2);
    fields.additionalTaxCents = takeNumber("TD1.additionalTaxCents", (input.fields ?? []).filter(item => /\.Page2\[0\]\.Subform2\[0\]\.Amount2\[0\]$/.test(item.name)), positioned(input.textItems, 2, 505, 592, 293, 312), 2);
    const nonresident = (input.fields ?? []).filter(item => item.type === "radiobutton" && /\.NonRes_sf\[0\]\.RadioButtonGroup\[0\]$/.test(item.name)).map(item => String(item.value)).filter(value => value !== "Off" && value !== "");
    if (new Set(nonresident).size > 1) blockers.push("The non-resident declaration is ambiguous; review the original form.");
    else if (nonresident[0] === "0" || nonresident[0] === "1") { fields.nonResident90Percent = field(nonresident[0] === "0", input, "TD1.nonResident90Percent", "acroform", 2); warnings.push("A non-resident declaration was selected. This does not establish residency or automatically authorize the native ordinary-B.C. employment policy."); }
  }
  if (fields.multipleEmployers.value === true) {
    warnings.push(`${formCode} concurrent-employer declaration requires a zero total claim when credits were claimed elsewhere; it does not remove CPP/EI deductions.`);
    if (fields.totalClaimCents.value !== null && fields.totalClaimCents.value !== 0) blockers.push("The concurrent-employer box is selected but the entered total claim is not zero. Resolve this contradictory declaration before applying it.");
  }
  if (fields.totalIncomeLessThanClaims.value === true) warnings.push(`${shape === "federal" ? "Federal" : "British Columbia provincial"} income-below-claims declaration is selected; review that component independently. This declaration does not exempt CPP/EI.`);
  if (fields.nonResident90Percent.value === false && fields.totalClaimCents.value !== null && fields.totalClaimCents.value !== 0) blockers.push("The non-resident 'No' declaration requires zero total claim; the extracted form is contradictory.");
  if (fields.annualZoneDeductionCents.value) warnings.push("The prescribed-zone deduction is a separate annual policy requiring employer review; it is not part of the total personal tax credit claim.");
  if (input.method === "local_ocr" || input.method === "mixed") warnings.push("Local OCR candidates can misread digits and check marks. Verify every candidate manually; unchecked or unreadable boxes remain unknown.");
  if (input.pageCount < 2) warnings.push("Only one page was provided. Review the missing declarations and certification from the complete signed form before application.");
  if (!allText.trim()) blockers.push("No readable form text was found. Supply a clearer local scan or manually enter reviewed declarations.");
  const required = ["totalClaimCents", "multipleEmployers", "totalIncomeLessThanClaims", ...(shape === "federal" ? ["additionalTaxCents", "annualZoneDeductionCents"] : [])];
  return { schemaVersion: 1, expectedForm: input.expectedForm, expectedYear: input.expectedYear, form, year, source: { sha256: input.sha256.toLowerCase(), mediaType: input.mediaType, pageCount: input.pageCount, method: input.method, originalStored: false }, fields, claimLines, status: blockers.length ? "blocked" : "review_required", requiresManualReview: true, signatureVerified: false, requiredReviewFields: [...required, "signedOriginalReviewed"], blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], sources: [...PAYROLL_TD1_SOURCES[shape]] };
}
