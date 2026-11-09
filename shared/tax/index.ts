import { lineTaxes, type InvoiceLineTaxes } from "../invoiceMoney";
import { canadaBcTaxPack, canadaBcPendingPstTaxPack } from "./canadaBc";
import type { TaxAnswers, TaxAssessment, TaxQuestion, TaxRulePack } from "./types";
export type * from "./types";

/** Add reviewed, effective-dated packs here. Never select a pack from a currency or incorporation address. */
export const TAX_RULE_PACKS: readonly TaxRulePack[] = [canadaBcTaxPack, canadaBcPendingPstTaxPack];
export const taxQuestionVisible = (question: TaxQuestion, answers: TaxAnswers) => (question.when ?? []).every((condition) => condition.oneOf.includes(answers[condition.answer]));
const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function defaultTaxAnswers(scope: "catalog" | "transaction", date: string): TaxAnswers {
  return { scope, supplyDate: date, jurisdictionCode: "unknown", itemCategory: "unknown", sellerKind: "unknown", scopeConfirmed: "unknown", federalException: "unknown", gstRegistration: "unknown", provincialException: "unknown", pstRegistration: "unknown", customerRelief: scope === "catalog" ? "none" : "unknown" };
}

export function resolveTaxPack(jurisdictionCode: string, date: string, packs = TAX_RULE_PACKS): TaxRulePack | undefined {
  if (!calendarDate(date)) return undefined;
  return [...packs].filter((pack) => pack.jurisdictionCode === jurisdictionCode && pack.effectiveFrom <= date && (!pack.effectiveTo || date <= pack.effectiveTo)).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version.localeCompare(a.version))[0];
}

export function updateTaxAnswer(answers: TaxAnswers, key: string, value: string): TaxAnswers {
  if (answers[key] === value) return answers;
  const next = { ...answers, [key]: value };
  const pack = resolveTaxPack(answers.jurisdictionCode, answers.supplyDate) ?? resolveTaxPack(next.jurisdictionCode, next.supplyDate);
  return pack?.updateAnswer?.(answers, key, value) ?? next;
}

function validateAnswers(raw: unknown, packs: readonly TaxRulePack[] = TAX_RULE_PACKS): TaxAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Tax assessment answers must be an object.");
  const entries = Object.entries(raw);
  if (entries.length > 40) throw new Error("Too many tax assessment answers.");
  const answers: TaxAnswers = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || key.length > 60 || typeof value !== "string" || value.length > 2000) throw new Error("Tax answers must use short named fields and text of at most 2,000 characters.");
    answers[key] = value.trim();
  }
  if (!["catalog", "transaction"].includes(answers.scope)) throw new Error("Choose a catalog or transaction tax assessment.");
  if (!calendarDate(answers.supplyDate)) throw new Error("Choose a valid tax assessment date.");
  if (!answers.jurisdictionCode || answers.jurisdictionCode.length > 40) throw new Error("Choose the supply jurisdiction.");
  const knownQuestions = (resolveTaxPack(answers.jurisdictionCode, answers.supplyDate, packs) ?? packs.find((pack) => pack.jurisdictionCode === answers.jurisdictionCode))?.questions ?? [];
  for (const question of knownQuestions) {
    if (answers[question.id] && question.options && !question.options.some((option) => option.value === answers[question.id])) throw new Error(`Choose a supported answer for ${question.label}`);
  }
  return answers;
}

export function assessTax(raw: TaxAnswers, confirmed = false): TaxAssessment {
  return assessTaxWithPacks(raw, confirmed, TAX_RULE_PACKS);
}

function assessTaxWithPacks(raw: TaxAnswers, confirmed: boolean, packs: readonly TaxRulePack[]): TaxAssessment {
  const answers = validateAnswers(raw, packs);
  const pack = resolveTaxPack(answers.jurisdictionCode, answers.supplyDate, packs);
  const result = pack?.evaluate(answers) ?? { components: [], issues: ["No reviewed tax rule pack covers this jurisdiction and date. Obtain a local tax review; no rate or exemption has been inferred."] };
  return {
    schemaVersion: 1, rulePackId: pack?.id ?? "unsupported", rulePackVersion: pack?.version ?? "none", rulesReviewedOn: pack?.reviewedOn ?? "",
    answers, components: result.components, issues: result.issues,
    status: result.issues.length ? "review_required" : "ready", confirmed: Boolean(confirmed && !result.issues.length),
  };
}

/** The server recomputes decisions; client-supplied rates, sources and success flags are never authoritative. */
export function cleanTaxAssessment(value: unknown): TaxAssessment | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tax assessment.");
  const input = value as TaxAssessment;
  if (input.schemaVersion !== 1 || typeof input.confirmed !== "boolean") throw new Error("Unsupported tax assessment format.");
  const recordedPacks = TAX_RULE_PACKS.filter(pack => pack.id === input.rulePackId && pack.version === input.rulePackVersion);
  const result = assessTaxWithPacks(input.answers, input.confirmed, recordedPacks);
  if (input.rulePackId !== result.rulePackId || input.rulePackVersion !== result.rulePackVersion) throw new Error("The tax guidance version changed. Reopen the tax assessment and review it again.");
  return result;
}

export function taxAssessmentRates(value: TaxAssessment): InvoiceLineTaxes {
  if (value.status !== "ready" || !value.confirmed) throw new Error("Complete and confirm the tax assessment before applying rates.");
  const taxes = value.components.filter((component) => component.collection === "collect" && (component.ratePercent ?? 0) > 0).map((component) => ({ label: component.label, ratePercent: component.ratePercent! }));
  const [first, ...additional] = taxes;
  return { taxLabel: first?.label, taxRatePercent: first?.ratePercent, additionalTaxes: additional.length ? additional : undefined };
}

/** Catalog decisions are reusable evidence, but a new sale must confirm its own date and customer relief. */
export function taxAssessmentForTransaction(value: TaxAssessment | undefined, date?: string): TaxAssessment | undefined {
  if (!value) return undefined;
  return assessTax({ ...value.answers, scope: "transaction", supplyDate: date ?? value.answers.supplyDate, scopeConfirmed: "unknown", customerRelief: "unknown", customerEvidence: "", purchaserPstNumber: "", pstReliefDocumentation: "unknown", pstReliefConditions: "unknown", pstCertificateType: "", gstRegistrationEvidence: "", pstRegistrationEvidence: "" }, false);
}

const transactionContextFields = ["partyKind", "memberId", "counterpartyId", "billToName", "billToAddress", "shipToName", "shipToAddress", "issueDate", "currency"] as const;
type TransactionContext = Partial<Record<typeof transactionContextFields[number], unknown>> | Record<string, unknown>;
export function taxTransactionContextKey(context: TransactionContext): string {
  return JSON.stringify(transactionContextFields.map((field) => context[field] ?? ""));
}
export function taxTransactionContextChanged(previous: TransactionContext, next: TransactionContext): boolean {
  return transactionContextFields.some((field) => (previous[field] ?? "") !== (next[field] ?? ""));
}
export function reassessTaxLines<T extends { taxAssessment?: TaxAssessment }>(lines: T[], date: string): T[] {
  return lines.map((line) => line.taxAssessment ? { ...line, taxAssessment: taxAssessmentForTransaction(line.taxAssessment, date) } : line);
}

/** Required public disclosure stays visible when a template hides its optional tax column. */
export function invoiceTaxDisclosureLines(lines: Array<{ item?: string; taxAssessment?: TaxAssessment }>): string[] {
  return lines.flatMap((line) => line.taxAssessment && line.taxAssessment.confirmed && line.taxAssessment.components.some((component) => component.collection === "do_not_collect") ? [`${line.item || "Item"}: ${taxAssessmentPrintSummary(line.taxAssessment)}`] : []);
}

export function taxAssessmentProblem(line: InvoiceLineTaxes & { taxAssessment?: TaxAssessment }, date?: string): string | null {
  if (!line.taxAssessment) return null; // Legacy/manual tax rates remain explicit and unassessed.
  let assessment: TaxAssessment;
  try { assessment = cleanTaxAssessment(line.taxAssessment)!; } catch (error) { return error instanceof Error ? error.message : "Review the tax assessment."; }
  if (assessment.answers.scope !== "transaction") return "Confirm this catalog assessment for the actual transaction.";
  if (date && assessment.answers.supplyDate !== date) return "The invoice date changed. Review the tax assessment for this date.";
  if (assessment.status !== "ready" || !assessment.confirmed) return "Complete and confirm the tax assessment before issuing this document.";
  if (JSON.stringify(lineTaxes(line)) !== JSON.stringify(lineTaxes(taxAssessmentRates(assessment)))) return "The selected rates differ from the recorded tax decision. Review the assessment or explicitly use manual rates.";
  return null;
}

export function assertInvoiceTaxAssessments(lines: Array<InvoiceLineTaxes & { item?: string; taxAssessment?: TaxAssessment }>, date: string): void {
  for (const line of lines) {
    const problem = taxAssessmentProblem(line, date);
    if (problem) throw new Error(`${line.item || "Item"}: ${problem}`);
  }
}

const treatmentLabels = { standard: "Taxable", zero_rated: "Zero-rated", exempt: "Exempt", out_of_scope: "Out of scope", not_subject: "Not subject", relieved: "Customer relief", review_required: "Review required" };
export function taxAssessmentSummary(value: TaxAssessment | undefined): string {
  if (!value) return "Manual rates · no guided assessment";
  if (value.status !== "ready" || !value.confirmed) return "Tax assessment needs review";
  return value.components.map((component) => `${component.label}: ${treatmentLabels[component.treatment]}${component.collection === "collect" ? ` ${component.ratePercent}%` : component.treatment === "standard" ? " · not collected (supplier status)" : ""}`).join("; ");
}

/** Public wording excludes internal notes, customer evidence and registration reasoning. */
export function taxAssessmentPrintSummary(value: TaxAssessment): string {
  if (value.status !== "ready" || !value.confirmed) return "Tax review pending";
  return value.components.map((component) => `${component.label} ${component.collection === "collect" ? `${component.ratePercent}%` : component.treatment === "standard" ? "not collected" : treatmentLabels[component.treatment].toLowerCase()}${component.taxId === "CA-BC-PST" && component.treatment === "relieved" && value.answers.pstReliefDocumentation === "pst_number" ? ` (purchaser ${value.answers.purchaserPstNumber})` : ""}`).join("; ");
}
