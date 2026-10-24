/** CRA T4127 native calculations. Monetary inputs and outputs use integer cents. */
import { payrollRateSetFor, type PayrollRateSet } from "./payrollRates";
import { assertPayrollRuleApplicable, cleanPayrollRuleRateSet } from "./payrollRules";
export type PayrollDeductionBases = { cashCents: number; taxableCents: number; pensionableCents: number; insurableCents: number };
export type PayrollTaxMethod = "option1" | "option2";
export type PayrollDeductionYtd = {
  regularTaxableCents: number; regularPensionableCents: number; regularInsurableCents: number;
  bonusTaxableCents: number; bonusPensionableCents: number; bonusInsurableCents: number;
  cppCents: number; cpp2Cents: number; eiCents: number; employerEiCents: number;
  bonusCppCents: number; bonusEiCents: number;
  cppAdditionalRegularCents: number; cppAdditionalBonusCents: number;
  registeredPlanCents: number; unionDuesCents: number; maintenanceCents: number;
  bonusRegisteredPlanCents: number;
  regularTaxCents: number; bonusTaxCents: number; additionalTaxCents: number;
  regularFederalTaxCents?: number; regularProvincialTaxCents?: number; bonusFederalTaxCents?: number; bonusProvincialTaxCents?: number;
};
export type PayrollDeductionInput = {
  payDate: string; provinceOfEmployment: string; method: PayrollTaxMethod;
  payPeriodsPerYear: number; periodNumber: number;
  regular: PayrollDeductionBases; bonus?: PayrollDeductionBases; previousRegular?: PayrollDeductionBases;
  ytd: PayrollDeductionYtd; ytdConfirmed: boolean;
  td1: { confirmed: boolean; federalClaimCents?: number; provincialClaimCents?: number; multipleEmployers?: boolean; additionalTaxCents?: number; taxExempt?: boolean; federalMultipleEmployers?: boolean; provincialMultipleEmployers?: boolean; federalTaxExempt?: boolean; provincialTaxExempt?: boolean };
  cpp: { eligible: boolean; contributionMonths: number };
  ei: { exempt: boolean; employerMultiplier?: number; reducedRateEvidence?: string };
  deductions?: { registeredPlanCents?: number; unionDuesCents?: number; maintenanceCents?: number; bonusRegisteredPlanCents?: number; otherCashCents?: number; authorizedAnnualDeductionCents?: number; annualZoneDeductionCents?: number; annualFederalCreditCents?: number; annualProvincialCreditCents?: number };
  /** A prior-employer balance must never be applied to this legal employer. */
  ytdEmployerMatches?: boolean;
  employmentKind?: "ordinary" | "commission" | "pension" | "nonresident" | "quebec_transfer";
};
export type PayrollDeductionExplanation = { factor: string; label: string; amountCents: number; formula: string; source: string };
export type PayrollDeductionOptions = { rateSet?: PayrollRateSet; ruleEdition?: { id: string; version: number; sourceReferences: string[] } };
export type PayrollDeductionResult = {
  cashGrossCents: number; taxableGrossCents: number; pensionableCents: number; insurableCents: number;
  cppEmployeeCents: number; cppEmployerCents: number; cpp2EmployeeCents: number; cpp2EmployerCents: number;
  eiEmployeeCents: number; eiEmployerCents: number; incomeTaxCents: number;
  regularIncomeTaxCents: number; bonusIncomeTaxCents: number; additionalIncomeTaxCents: number;
  federalTaxCents: number | null; provincialTaxCents: number | null; regularFederalTaxCents: number; regularProvincialTaxCents: number; bonusFederalTaxCents: number | null; bonusProvincialTaxCents: number | null;
  totalDeductionsCents: number; netCashCents: number;
  cppAdditionalRegularCents: number; cppAdditionalBonusCents: number;
  closingYtd: PayrollDeductionYtd; explanations: PayrollDeductionExplanation[];
  ruleSet: PayrollRateSet; ruleEdition?: NonNullable<PayrollDeductionOptions["ruleEdition"]>; input: PayrollDeductionInput; warnings: string[];
};
export function emptyPayrollYtd(): PayrollDeductionYtd {
  return { regularTaxableCents: 0, regularPensionableCents: 0, regularInsurableCents: 0, bonusTaxableCents: 0, bonusPensionableCents: 0, bonusInsurableCents: 0, cppCents: 0, cpp2Cents: 0, eiCents: 0, employerEiCents: 0, bonusCppCents: 0, bonusEiCents: 0, cppAdditionalRegularCents: 0, cppAdditionalBonusCents: 0, registeredPlanCents: 0, unionDuesCents: 0, maintenanceCents: 0, bonusRegisteredPlanCents: 0, regularTaxCents: 0, bonusTaxCents: 0, additionalTaxCents: 0, regularFederalTaxCents: 0, regularProvincialTaxCents: 0, bonusFederalTaxCents: 0, bonusProvincialTaxCents: 0 };
}

type Rational = { n: bigint; d: bigint };
function fraction(n: bigint | number, d: bigint | number = 1): Rational { let a = BigInt(n), b = BigInt(d); if (!b) throw new Error("Invalid payroll divisor."); if (b < 0) { a = -a; b = -b; } const gcd = (x: bigint, y: bigint): bigint => y ? gcd(y, x % y) : x < 0 ? -x : x; const g = gcd(a, b); return { n: a / g, d: b / g }; }
function add(a: Rational, b: Rational) { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
function subtract(a: Rational, b: Rational) { return add(a, { n: -b.n, d: b.d }); }
function times(a: Rational, b: Rational) { return fraction(a.n * b.n, a.d * b.d); }
function decimal(value: string | number) { const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value)); if (!match) throw new Error("Enter a finite payroll rate without exponent notation."); return fraction(BigInt(match[1] + (match[2] ?? "")), 10n ** BigInt(match[2]?.length ?? 0)); }
function safe(value: bigint) { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error("Payroll amounts exceed the safe integer cents range."); return number; }
function round(value: Rational) { const sign = value.n < 0 ? -1n : 1n, n = value.n < 0 ? -value.n : value.n; return safe(sign * ((2n * n + value.d) / (2n * value.d))); }
function sum(...values: number[]) { return safe(values.reduce((total, value) => total + BigInt(value), 0n)); }
const moneyRate = (cents: number, rate: string | number) => round(times(fraction(cents), decimal(rate)));
const ratioMoney = (cents: number, n: number, d: number) => round(fraction(BigInt(cents) * BigInt(n), d));
const rateRatioMoney = (cents: number, numerator: string, denominator: string) => { const n = decimal(numerator), d = decimal(denominator); return round(times(fraction(cents), fraction(n.n * d.d, n.d * d.n))); };
function amount(value: unknown, label: string) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative integer cents.`); return value; }
function exactDay(value: string, label: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a valid date.`); return value; }
function bases(value: PayrollDeductionBases | undefined, label: string): PayrollDeductionBases { if (!value) return { cashCents: 0, taxableCents: 0, pensionableCents: 0, insurableCents: 0 }; return { cashCents: amount(value.cashCents, `${label} cash`), taxableCents: amount(value.taxableCents, `${label} taxable`), pensionableCents: amount(value.pensionableCents, `${label} pensionable`), insurableCents: amount(value.insurableCents, `${label} insurable`) }; }
const JAN_SOURCE = "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html";
const CPP_SOURCE = "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/starting-stopping-cpp-deductions.html";

/** CPP policy uses payment months, not work dates, and does not retain a SIN. */
export function deriveCppEligibility(input: {
  payDate: string; birthDate: string;
  elections?: Array<{ action: "stop" | "restart"; receivedDate: string; retirementPensionConfirmed: boolean; evidence: string }>;
  disabilityPeriods?: Array<{ consideredDisabledDate: string; noLongerDisabledDate?: string; evidence: string }>;
  exempt?: { confirmed: boolean; reason: string };
}) {
  const payDate = exactDay(input.payDate, "Payment date"), birth = exactDay(input.birthDate, "Birth date");
  if (birth > payDate) throw new Error("Birth date follows the payment date.");
  const year = Number(payDate.slice(0, 4)), currentMonth = Number(payDate.slice(5, 7));
  const bornYear = Number(birth.slice(0, 4)), bornMonth = Number(birth.slice(5, 7));
  const monthKey = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
  const turn18 = (bornYear + 18) * 12 + bornMonth, turn70 = (bornYear + 70) * 12 + bornMonth;
  if (input.exempt) throw new Error("A manual CPP exemption cannot override dated eligibility. Use the actual birth date, effective CPT30 election/revocation or Service Canada disability dates. Other nonpensionable employment requires a separately reviewed policy; this ordinary native engine cannot apply a blanket exemption.");
  const elections = [...(input.elections ?? [])].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate));
  let stopped = false, lastStopYear: number | undefined;
  const events: Array<{ key: number; stopped: boolean }> = [];
  const eventYears = new Set<number>();
  for (const election of elections) {
    exactDay(election.receivedDate, "CPT30 received date");
    if (election.receivedDate > payDate) throw new Error("A future CPT30 receipt cannot alter an earlier payment or its contribution-month limit.");
    if (!election.evidence.trim()) throw new Error("Retain evidence for each CPT30 election or revocation.");
    const age = Number(election.receivedDate.slice(0, 4)) - bornYear - (election.receivedDate.slice(5) < birth.slice(5) ? 1 : 0), eventYear = Number(election.receivedDate.slice(0, 4));
    if (eventYears.has(eventYear)) throw new Error("A CPT30 election or revocation may be made only once per calendar year.");
    eventYears.add(eventYear);
    if (election.action === "stop") {
      if (stopped || age < 65 || age >= 70 || !election.retirementPensionConfirmed) throw new Error("A CPP stop election requires age 65–69, a retirement pension and no existing stop election.");
      stopped = true; lastStopYear = eventYear;
    } else if (election.action === "restart") {
      if (!stopped || lastStopYear === undefined || lastStopYear >= eventYear) throw new Error("A CPT30 revocation requires a stop election from a prior calendar year.");
      stopped = false;
    } else throw new Error("Unknown CPP election action.");
    events.push({ key: monthKey(election.receivedDate) + 1, stopped });
  }
  const disability = (input.disabilityPeriods ?? []).map(period => {
    exactDay(period.consideredDisabledDate, "CPP disability date");
    if (!period.evidence.trim()) throw new Error("Retain Service Canada evidence for CPP disability dates.");
    if (period.noLongerDisabledDate) { exactDay(period.noLongerDisabledDate, "CPP disability end date"); if (period.noLongerDisabledDate < period.consideredDisabledDate) throw new Error("CPP disability end precedes its start."); }
    return { from: monthKey(period.consideredDisabledDate) + 1, to: period.noLongerDisabledDate ? monthKey(period.noLongerDisabledDate) : Infinity };
  });
  const eligibleMonths = Array.from({ length: 12 }, (_, index) => index + 1).filter(month => {
    const key = year * 12 + month;
    if (key <= turn18 || key > turn70 || disability.some(period => key >= period.from && key <= period.to)) return false;
    return !events.filter(event => event.key <= key).at(-1)?.stopped;
  });
  return { eligible: eligibleMonths.includes(currentMonth), contributionMonths: eligibleMonths.length, eligibleMonths, source: CPP_SOURCE, explanations: ["CPP starts the month after age 18 and stops after the month of age 70.", "CPT30 elections/revocations and disability changes take effect in the following payment month."] };
}

function federalBasicPersonal(incomeCents: number, rates: PayrollRateSet) {
  const federal = rates.federal;
  if (incomeCents <= federal.basicPersonalPhaseOutFromCents) return federal.basicPersonalMaximumCents;
  if (incomeCents >= federal.basicPersonalPhaseOutToCents) return federal.basicPersonalMinimumCents;
  return round(subtract(fraction(federal.basicPersonalMaximumCents), fraction(BigInt(incomeCents - federal.basicPersonalPhaseOutFromCents) * BigInt(federal.basicPersonalMaximumCents - federal.basicPersonalMinimumCents), federal.basicPersonalPhaseOutToCents - federal.basicPersonalPhaseOutFromCents)));
}
type CreditBases = { federalCpp: number; federalEi: number; provincialCpp: number; provincialEi: number };
function annualTaxes(annualIncomeCents: number, annualGrossCents: number, credits: CreditBases, input: PayrollDeductionInput, rates: PayrollRateSet) {
  const a = Math.max(0, annualIncomeCents), d = input.deductions ?? {};
  const federalBracket = rates.federal.brackets.filter(bracket => bracket.thresholdCents <= a).at(-1)!;
  const provincialBracket = rates.provincial.brackets.filter(bracket => bracket.thresholdCents <= a).at(-1)!;
  const federalRate = rates.federal.brackets[0].rate, provincialRate = rates.provincial.brackets[0].rate;
  const federalClaim = (input.td1.federalMultipleEmployers ?? input.td1.multipleEmployers) ? 0 : input.td1.federalClaimCents ?? federalBasicPersonal(sum(a, d.annualZoneDeductionCents ?? 0), rates);
  const provincialClaim = (input.td1.provincialMultipleEmployers ?? input.td1.multipleEmployers) ? 0 : input.td1.provincialClaimCents ?? rates.provincial.basicPersonalCents;
  const k1 = moneyRate(federalClaim, federalRate), k1p = moneyRate(provincialClaim, provincialRate);
  const k2 = sum(moneyRate(credits.federalCpp, federalRate), moneyRate(credits.federalEi, federalRate));
  const k2p = sum(moneyRate(credits.provincialCpp, provincialRate), moneyRate(credits.provincialEi, provincialRate));
  const k4 = moneyRate(Math.min(Math.max(0, annualGrossCents), rates.federal.employmentAmountCents), federalRate);
  const federal = Math.max(0, moneyRate(a, federalBracket.rate) - federalBracket.constantCents - k1 - k2 - (d.annualFederalCreditCents ?? 0) - k4);
  const t4 = Math.max(0, moneyRate(a, provincialBracket.rate) - provincialBracket.constantCents - k1p - k2p - (d.annualProvincialCreditCents ?? 0));
  const reduction = a > rates.provincial.reductionEndsAtCents ? 0 : Math.min(t4, Math.max(0, rates.provincial.reductionCents - moneyRate(Math.max(0, a - rates.provincial.reductionStartsAtCents), rates.provincial.reductionRate)));
  return { federal: (input.td1.federalTaxExempt ?? input.td1.taxExempt) ? 0 : federal, provincial: (input.td1.provincialTaxExempt ?? input.td1.taxExempt) ? 0 : t4 - reduction, annualIncomeCents: a, federalClaim, provincialClaim, k1, k1p, k2, k2p, k4, t4, reduction };
}

/** Original implementation of CRA T4127 chapters 1–7 for ordinary B.C. employment. */
export function calculatePayrollDeductions(raw: PayrollDeductionInput, options: PayrollDeductionOptions = {}): PayrollDeductionResult {
  if (!raw || typeof raw !== "object" || !raw.regular || !raw.ytd || !raw.cpp || !raw.ei || !raw.td1) throw new Error("Complete the payroll bases, TD1, contribution policy and same-employer YTD inputs.");
  const rates = options.rateSet ? assertPayrollRuleApplicable(cleanPayrollRuleRateSet(options.rateSet), { payDate: raw.payDate, province: raw.provinceOfEmployment, method: raw.method }) : payrollRateSetFor(raw.payDate, raw.provinceOfEmployment, raw.method);
  let ruleEdition: PayrollDeductionResult["ruleEdition"];
  if (options.ruleEdition) {
    const edition = options.ruleEdition;
    if (!options.rateSet || typeof edition.id !== "string" || !edition.id.trim() || !Number.isSafeInteger(edition.version) || edition.version < 1 || !Array.isArray(edition.sourceReferences) || !edition.sourceReferences.length || edition.sourceReferences.some(source => typeof source !== "string" || !/^https:\/\//.test(source))) throw new Error("Retain a valid selected rule edition, revision and source references with its reviewed rates.");
    ruleEdition = { id: edition.id.trim(), version: edition.version, sourceReferences: [...edition.sourceReferences] };
  }
  if (raw.employmentKind && raw.employmentKind !== "ordinary") throw new Error(`Native deductions do not support ${raw.employmentKind}. Import a verified provider calculation for this employment policy.`);
  if (!raw.ytdConfirmed || !raw.td1.confirmed) throw new Error("Confirm the TD1 assumptions and complete same-employer year-to-date balances before calculating deductions.");
  if (raw.ytdEmployerMatches === false) throw new Error("Do not apply an unrelated previous employer's CPP, EI or withholding balances. Record only this legal employer's year-to-date amounts.");
  const p = raw.payPeriodsPerYear, periodNumber = raw.periodNumber;
  if (!Number.isInteger(p) || p < 1 || p > 2000 || !Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > p) throw new Error("Enter the actual number of annual pay periods and the applicable current regular pay-period number.");
  if (typeof raw.cpp.eligible !== "boolean" || !Number.isInteger(raw.cpp.contributionMonths) || raw.cpp.contributionMonths < 0 || raw.cpp.contributionMonths > 12 || (raw.cpp.eligible && !raw.cpp.contributionMonths)) throw new Error("Enter the verified CPP eligibility and contribution months (PM, 0–12).");
  if (typeof raw.ei.exempt !== "boolean") throw new Error("Confirm whether this employment is exempt from EI.");
  const splitKeys = ["regularFederalTaxCents", "regularProvincialTaxCents", "bonusFederalTaxCents", "bonusProvincialTaxCents"] as const;
  const ytd = Object.fromEntries(Object.keys(emptyPayrollYtd()).filter(key => !splitKeys.includes(key as typeof splitKeys[number])).map(key => [key, amount(raw.ytd[key as keyof PayrollDeductionYtd], `YTD ${key}`)])) as PayrollDeductionYtd;
  for (const key of splitKeys) if (raw.ytd[key] !== undefined) ytd[key] = amount(raw.ytd[key], `YTD ${key}`);
  if (ytd.bonusCppCents > ytd.cppCents || ytd.bonusEiCents > ytd.eiCents) throw new Error("YTD bonus contributions cannot exceed the employer's total employee contributions.");
  for (const kind of ["regular", "bonus"] as const) {
    const federal = ytd[`${kind}FederalTaxCents`], provincial = ytd[`${kind}ProvincialTaxCents`];
    if ((federal !== undefined || provincial !== undefined) && (federal === undefined || provincial === undefined || sum(federal, provincial) !== ytd[`${kind}TaxCents`])) throw new Error(`YTD ${kind} federal and provincial tax must reconcile with the combined withholding amount, excluding additional tax.`);
    if (raw.method === "option2" && ytd[`${kind}TaxCents`] > 0 && (federal === undefined || provincial === undefined)) throw new Error("Option 2 requires the historical federal/provincial tax split. Complete the opening balances or use Option 1; unknown amounts cannot be treated as zero.");
  }
  const regular = bases(raw.regular, "Regular"), bonus = bases(raw.bonus, "Bonus"), previousRegular = raw.previousRegular ? bases(raw.previousRegular, "Previous regular") : undefined;
  const deductionKeys = ["registeredPlanCents", "unionDuesCents", "maintenanceCents", "bonusRegisteredPlanCents", "otherCashCents", "authorizedAnnualDeductionCents", "annualZoneDeductionCents", "annualFederalCreditCents", "annualProvincialCreditCents"] as const;
  const deductions: NonNullable<PayrollDeductionInput["deductions"]> = {};
  for (const key of deductionKeys) if (raw.deductions?.[key] !== undefined) deductions[key] = amount(raw.deductions[key], key);
  const td1: PayrollDeductionInput["td1"] = { confirmed: true };
  for (const key of ["federalClaimCents", "provincialClaimCents", "additionalTaxCents"] as const) if (raw.td1[key] !== undefined) td1[key] = amount(raw.td1[key], key);
  for (const key of ["multipleEmployers", "taxExempt", "federalMultipleEmployers", "provincialMultipleEmployers", "federalTaxExempt", "provincialTaxExempt"] as const) if (raw.td1[key] !== undefined) { if (typeof raw.td1[key] !== "boolean") throw new Error(`Confirm TD1 ${key}.`); td1[key] = raw.td1[key]; }
  const multiplier = raw.ei.employerMultiplier ?? 1.4;
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1.4) throw new Error("Enter an approved employer EI multiplier greater than zero and no more than 1.4.");
  if (multiplier !== 1.4 && !raw.ei.reducedRateEvidence?.trim()) throw new Error("Retain approval evidence for an employer EI multiplier below 1.4.");
  const input: PayrollDeductionInput = { payDate: raw.payDate, provinceOfEmployment: raw.provinceOfEmployment, method: raw.method, payPeriodsPerYear: p, periodNumber, regular, ...(raw.bonus ? { bonus } : {}), ...(previousRegular ? { previousRegular } : {}), ytd, ytdConfirmed: true, td1, cpp: { eligible: raw.cpp.eligible, contributionMonths: raw.cpp.contributionMonths }, ei: { exempt: raw.ei.exempt, employerMultiplier: multiplier, ...(raw.ei.reducedRateEvidence ? { reducedRateEvidence: raw.ei.reducedRateEvidence.trim() } : {}) }, deductions, ...(raw.ytdEmployerMatches !== undefined ? { ytdEmployerMatches: raw.ytdEmployerMatches } : {}), employmentKind: "ordinary" };
  const warnings: string[] = [], explanations: PayrollDeductionExplanation[] = [];
  const explain = (factor: string, label: string, amountCents: number, formula: string, source = JAN_SOURCE) => explanations.push({ factor, label, amountCents, formula, source });
  const pm = input.cpp.contributionMonths, basicExemptionCents = Math.floor(rates.cpp.annualExemptionCents / p);
  const cppMaximum = ratioMoney(rates.cpp.maximumCents, pm, 12), cpp2Maximum = ratioMoney(rates.cpp.secondMaximumCents, pm, 12), baseMaximum = ratioMoney(rates.cpp.baseMaximumCents, pm, 12);
  if (ytd.cppCents > cppMaximum || ytd.cpp2Cents > cpp2Maximum || ytd.eiCents > rates.ei.maximumCents) warnings.push("Entered same-employer contributions exceed a current annual/prorated limit. No automatic refund is created; review the opening balances or correction records.");
  const regularPi = input.cpp.eligible ? regular.pensionableCents : 0, bonusPi = input.cpp.eligible ? bonus.pensionableCents : 0;
  const pensionableCents = sum(regularPi, bonusPi), insurableRegular = input.ei.exempt ? 0 : regular.insurableCents, insurableBonus = input.ei.exempt ? 0 : bonus.insurableCents, insurableCents = sum(insurableRegular, insurableBonus);
  const hasRegular = regular.cashCents > 0 || regular.taxableCents > 0 || regularPi > 0;
  const cppFor = (pi: number, exemption: boolean) => Math.max(0, Math.min(cppMaximum - ytd.cppCents, moneyRate(Math.max(0, pi - (exemption ? basicExemptionCents : 0)), rates.cpp.rate)));
  const cpp = input.cpp.eligible ? cppFor(pensionableCents, hasRegular) : 0, regularCpp = input.cpp.eligible ? cppFor(regularPi, hasRegular) : 0, bonusCpp = cpp - regularCpp;
  const thresholdValue = fraction(BigInt(rates.cpp.ympeCents) * BigInt(pm), 12), threshold = round(thresholdValue), ytdPi = sum(ytd.regularPensionableCents, ytd.bonusPensionableCents);
  const thresholdOrYtd = BigInt(ytdPi) * thresholdValue.d > thresholdValue.n ? fraction(ytdPi) : thresholdValue;
  const crossing = subtract(fraction(sum(ytdPi, pensionableCents)), thresholdOrYtd);
  const cpp2 = input.cpp.eligible ? Math.max(0, Math.min(cpp2Maximum - ytd.cpp2Cents, crossing.n > 0 ? round(times(crossing, decimal(rates.cpp.secondRate))) : 0)) : 0;
  const eiFor = (earnings: number) => input.ei.exempt ? 0 : Math.max(0, Math.min(rates.ei.maximumCents - ytd.eiCents, moneyRate(earnings, rates.ei.rate)));
  const ei = eiFor(insurableCents), regularEi = eiFor(insurableRegular), bonusEi = ei - regularEi;
  const employerEi = Math.max(0, Math.min(moneyRate(rates.ei.maximumCents, multiplier) - ytd.employerEiCents, moneyRate(ei, multiplier)));
  const f5 = sum(rateRatioMoney(cpp, rates.cpp.additionalRate, rates.cpp.rate), cpp2);
  const f5a = pensionableCents ? ratioMoney(f5, regularPi, pensionableCents) : 0;
  const f5b = pensionableCents ? ratioMoney(f5, bonusPi, pensionableCents) : 0;
  explain("CPP exemption", "Truncated basic exemption for this regular period", hasRegular ? basicExemptionCents : 0, `floor(${rates.cpp.annualExemptionCents} cents / ${p}); no second exemption for a separate bonus`);
  explain("C", "Employee CPP, including first enhancement", cpp, `min(${cppMaximum} − ${ytd.cppCents}, ${rates.cpp.rate} × (${pensionableCents} − ${hasRegular ? basicExemptionCents : 0})); CPP eligibility applied`);
  explain("C2", "Employee CPP2", cpp2, `min(${cpp2Maximum} − ${ytd.cpp2Cents}, ${rates.cpp.secondRate} × max(0, ${ytdPi} + ${pensionableCents} − max(${ytdPi}, ${threshold})))`);
  explain("EI", "Employee EI", ei, `min(${rates.ei.maximumCents} − ${ytd.eiCents}, ${rates.ei.rate} × ${insurableCents})`);
  explain("Employer EI", "Employer EI premium", employerEi, `${ei} × approved multiplier ${multiplier}, capped at the employer's remaining annual maximum`);
  explain("F5A", "Additional CPP deduction allocated to regular income", f5a, `round((C × (${rates.cpp.additionalRate} / ${rates.cpp.rate}) + C2) × regular pensionable / total pensionable)`);
  explain("F5B", "Additional CPP deduction allocated to bonus income", f5b, `round((C × (${rates.cpp.additionalRate} / ${rates.cpp.rate}) + C2) × bonus pensionable / total pensionable)`);
  if (bonus.taxableCents && !regular.taxableCents && ytd.regularTaxableCents && !previousRegular) throw new Error("For a bonus-only payment, provide the most recent regular remuneration; do not guess the annual salary.");
  const annualRegular = regular.taxableCents || !bonus.taxableCents ? regular : previousRegular ?? regular;
  const creditRegularCpp = !regular.taxableCents && bonus.taxableCents && previousRegular && input.cpp.eligible ? cppFor(previousRegular.pensionableCents, true) : regularCpp;
  const creditRegularEi = !regular.taxableCents && bonus.taxableCents && previousRegular && !input.ei.exempt ? eiFor(previousRegular.insurableCents) : regularEi;
  const ytdBaseCpp = rateRatioMoney(ytd.cppCents, rates.cpp.baseRate, rates.cpp.rate);
  const periodicCredits = (includeBonus: boolean) => {
    // The CRA worked bonus example resolves each per-payment base CPP before
    // annualizing it; retaining the ratio until that point is material by cents.
    const projectedCpp = sum(rateRatioMoney(creditRegularCpp, rates.cpp.baseRate, rates.cpp.rate) * p, rateRatioMoney(ytd.bonusCppCents, rates.cpp.baseRate, rates.cpp.rate), includeBonus ? rateRatioMoney(bonusCpp, rates.cpp.baseRate, rates.cpp.rate) : 0);
    const projectedEi = sum(creditRegularEi * p, ytd.bonusEiCents, includeBonus ? bonusEi : 0);
    const cppCredit = Math.min(baseMaximum, Math.max(projectedCpp, ytdBaseCpp, ytd.cppCents + cpp >= cppMaximum && cppMaximum > 0 ? baseMaximum : 0));
    const eiCredit = Math.min(rates.ei.maximumCents, Math.max(projectedEi, ytd.eiCents, ytd.eiCents + ei >= rates.ei.maximumCents ? rates.ei.maximumCents : 0));
    return { federalCpp: cppCredit, federalEi: eiCredit, provincialCpp: cppCredit, provincialEi: eiCredit };
  };
  const annualAdjustment = sum(deductions.authorizedAnnualDeductionCents ?? 0, deductions.annualZoneDeductionCents ?? 0);
  const regularNet = annualRegular.taxableCents - (deductions.registeredPlanCents ?? 0) - (deductions.maintenanceCents ?? 0) - (deductions.unionDuesCents ?? 0) - f5a;
  const priorBonusNet = Math.max(0, ytd.bonusTaxableCents - ytd.bonusRegisteredPlanCents - ytd.cppAdditionalBonusCents);
  const bonusNet = Math.max(0, bonus.taxableCents - (deductions.bonusRegisteredPlanCents ?? 0) - f5b);
  const cumulativeRegularNet = sum(ytd.regularTaxableCents, regular.taxableCents) - sum(ytd.registeredPlanCents, deductions.registeredPlanCents ?? 0, ytd.maintenanceCents, deductions.maintenanceCents ?? 0, ytd.unionDuesCents, deductions.unionDuesCents ?? 0, ytd.cppAdditionalRegularCents, f5a);
  const annualRegularTaxable = input.method === "option1" ? Math.max(0, sum(regularNet * p, -annualAdjustment)) : Math.max(0, ratioMoney(cumulativeRegularNet, p, periodNumber) - annualAdjustment);
  const annualRegularGross = input.method === "option1" ? annualRegular.taxableCents * p : ratioMoney(sum(ytd.regularTaxableCents, regular.taxableCents), p, periodNumber);
  const creditsFor = (includeBonus: boolean): CreditBases => {
    if (input.method === "option1") return periodicCredits(includeBonus);
    const projectedPi = sum(ratioMoney(sum(ytd.regularPensionableCents, regularPi), p, periodNumber), ytd.bonusPensionableCents, includeBonus ? bonusPi : 0);
    const projectedIe = sum(ratioMoney(sum(ytd.regularInsurableCents, insurableRegular), p, periodNumber), ytd.bonusInsurableCents, includeBonus ? insurableBonus : 0);
    const federalCpp = Math.min(baseMaximum, input.cpp.eligible ? moneyRate(Math.max(0, projectedPi - rates.cpp.annualExemptionCents), rates.cpp.baseRate) : ytdBaseCpp);
    const federalEi = Math.min(rates.ei.maximumCents, input.ei.exempt ? ytd.eiCents : moneyRate(projectedIe, rates.ei.rate));
    // July's explicit Option 2 BC paragraph replaces K2P with P×C/P×EI.
    const provincial = rates.effectiveFrom >= "2026-07-01" ? periodicCredits(includeBonus) : { provincialCpp: federalCpp, provincialEi: federalEi };
    return { federalCpp, federalEi, provincialCpp: provincial.provincialCpp, provincialEi: provincial.provincialEi };
  };
  const regularAnnual = annualTaxes(sum(annualRegularTaxable, input.method === "option2" ? priorBonusNet : 0), sum(annualRegularGross, input.method === "option2" ? ytd.bonusTaxableCents : 0), creditsFor(false), input, rates);
  const withoutBonus = annualTaxes(sum(annualRegularTaxable, priorBonusNet), sum(annualRegularGross, ytd.bonusTaxableCents), creditsFor(false), input, rates);
  const withBonus = annualTaxes(sum(annualRegularTaxable, priorBonusNet, bonusNet), sum(annualRegularGross, ytd.bonusTaxableCents, bonus.taxableCents), creditsFor(true), input, rates);
  let regularFederal = 0, regularProvincial = 0, bonusFederal = 0, bonusProvincial = 0, unknownBonusSplit = false;
  const federalExempt = td1.federalTaxExempt ?? td1.taxExempt ?? false, provincialExempt = td1.provincialTaxExempt ?? td1.taxExempt ?? false;
  const allocate = (total: number, federal: number) => ({ federal: Math.min(total, Math.max(0, federal)), provincial: total - Math.min(total, Math.max(0, federal)) });
  if (!(federalExempt && provincialExempt) && regular.taxableCents > 0) {
    if (input.method === "option1") {
      const total = ratioMoney(sum(regularAnnual.federal, regularAnnual.provincial), 1, p), split = allocate(total, ratioMoney(regularAnnual.federal, 1, p));
      regularFederal = split.federal; regularProvincial = split.provincial;
    } else {
      const federalTarget = ratioMoney(regularAnnual.federal - (ytd.bonusFederalTaxCents ?? 0), periodNumber, p) - (ytd.regularFederalTaxCents ?? 0);
      const provincialTarget = ratioMoney(regularAnnual.provincial - (ytd.bonusProvincialTaxCents ?? 0), periodNumber, p) - (ytd.regularProvincialTaxCents ?? 0);
      if (federalExempt || provincialExempt) {
        // Historical withholding in an exempt jurisdiction must not reduce the
        // other jurisdiction's current cumulative withholding.
        regularFederal = federalExempt ? 0 : Math.max(0, federalTarget);
        regularProvincial = provincialExempt ? 0 : Math.max(0, provincialTarget);
      } else {
        const total = Math.max(0, ratioMoney(sum(regularAnnual.federal, regularAnnual.provincial, -ytd.bonusTaxCents), periodNumber, p) - ytd.regularTaxCents);
        const split = allocate(total, federalTarget); regularFederal = split.federal; regularProvincial = split.provincial;
        if (federalTarget < 0 || provincialTarget < 0) warnings.push("Cumulative federal/provincial offsets were applied within the non-negative combined CRA withholding; no separate cash refund was created.");
      }
    }
  }
  if (!(federalExempt && provincialExempt) && bonus.taxableCents > 0) {
    const flat = withBonus.annualIncomeCents <= 500000;
    if (flat && federalExempt !== provincialExempt) throw new Error("CRA's 15% small-income bonus rule specifies combined withholding without a federal/provincial split. A one-jurisdiction TD1 exemption requires a reviewed provider calculation for this bonus; no allocation is guessed.");
    const total = flat ? moneyRate(Math.max(0, bonus.taxableCents - (deductions.bonusRegisteredPlanCents ?? 0)), "0.15") : Math.max(0, sum(withBonus.federal, withBonus.provincial, -withoutBonus.federal, -withoutBonus.provincial));
    const split = allocate(total, flat ? total : withBonus.federal - withoutBonus.federal); bonusFederal = split.federal; bonusProvincial = split.provincial;
    if (flat && total > 0) { unknownBonusSplit = true; warnings.push("CRA specifies 15% combined bonus withholding when estimated annual taxable income including this bonus is at most $5,000. Its federal/provincial allocation is unknown; only the authoritative combined tax is reported."); }
  }
  const regularTax = sum(regularFederal, regularProvincial), bonusTax = sum(bonusFederal, bonusProvincial), extra = td1.additionalTaxCents ?? 0;
  const incomeTax = sum(regularTax, bonusTax, extra), otherCash = sum(deductions.registeredPlanCents ?? 0, deductions.unionDuesCents ?? 0, deductions.maintenanceCents ?? 0, deductions.bonusRegisteredPlanCents ?? 0, deductions.otherCashCents ?? 0);
  const cashGross = sum(regular.cashCents, bonus.cashCents), totalDeductions = sum(cpp, cpp2, ei, incomeTax, otherCash), netCash = sum(cashGross, -totalDeductions);
  if (netCash < 0) throw new Error("Cash remuneration is insufficient for the calculated deductions. Native non-cash-only recovery/advances require a reviewed provider calculation; no negative payment can be finalized.");
  const source = rates.effectiveFrom >= "2026-07-01" ? rates.formulaSources[1].url : JAN_SOURCE;
  for (const [factor, label, value] of [["A", "Annualized regular taxable income", regularAnnual.annualIncomeCents], ["TC", "Federal TD1 claim used", regularAnnual.federalClaim], ["TCP", "BC TD1 claim used", regularAnnual.provincialClaim], ["K1", "Federal personal credit", regularAnnual.k1], ["K2", "Federal CPP/EI credit", regularAnnual.k2], ["K4", "Canada employment credit", regularAnnual.k4], ["K1P", "BC personal credit", regularAnnual.k1p], ["K2P", "BC CPP/EI credit", regularAnnual.k2p], ["S", "BC tax reduction", regularAnnual.reduction], ["T1", "Annual federal withholding", regularAnnual.federal], ["T2", "Annual BC withholding", regularAnnual.provincial]] as const) explain(factor, label, value, `${input.method}, ${rates.id}; prescribed credits, pension/EI limits and rounding`, source);
  explain("A with bonus", "Annual taxable income including current bonus", withBonus.annualIncomeCents, "Annual regular taxable + previous net bonuses + current net bonus", source);
  explain("A without bonus", "Annual taxable income without current bonus", withoutBonus.annualIncomeCents, "Annual regular taxable + previous net bonuses", source);
  explain("TB", "Combined tax on current bonus", bonusTax, "Annual tax with current bonus minus annual tax without it; 15% rule only where applicable", source);
  explain("L", "Additional withholding requested on TD1", extra, "Additional withholding is separate from regular/bonus tax and cumulative tax balances", source);
  explain("T", "Total income tax withheld", incomeTax, "Regular federal + regular provincial + bonus tax + additional TD1 withholding", source);
  if (td1.federalMultipleEmployers ?? td1.multipleEmployers) warnings.push("Federal multiple-employer TD1 declaration: the federal personal claim amount was set to zero for this employment.");
  if (td1.provincialMultipleEmployers ?? td1.multipleEmployers) warnings.push("Provincial multiple-employer TD1 declaration: the provincial personal claim amount was set to zero for this employment.");
  if (federalExempt) warnings.push("Federal TD1 total-income-below-claims declaration: federal base withholding is zero; CPP, EI and additional withholding still apply.");
  if (provincialExempt) warnings.push("Provincial TD1 total-income-below-claims declaration: provincial base withholding is zero; CPP, EI and additional withholding still apply.");
  const closingYtd: PayrollDeductionYtd = { regularTaxableCents: sum(ytd.regularTaxableCents, regular.taxableCents), regularPensionableCents: sum(ytd.regularPensionableCents, regularPi), regularInsurableCents: sum(ytd.regularInsurableCents, insurableRegular), bonusTaxableCents: sum(ytd.bonusTaxableCents, bonus.taxableCents), bonusPensionableCents: sum(ytd.bonusPensionableCents, bonusPi), bonusInsurableCents: sum(ytd.bonusInsurableCents, insurableBonus), cppCents: sum(ytd.cppCents, cpp), cpp2Cents: sum(ytd.cpp2Cents, cpp2), eiCents: sum(ytd.eiCents, ei), employerEiCents: sum(ytd.employerEiCents, employerEi), bonusCppCents: sum(ytd.bonusCppCents, bonusCpp), bonusEiCents: sum(ytd.bonusEiCents, bonusEi), cppAdditionalRegularCents: sum(ytd.cppAdditionalRegularCents, f5a), cppAdditionalBonusCents: sum(ytd.cppAdditionalBonusCents, f5b), registeredPlanCents: sum(ytd.registeredPlanCents, deductions.registeredPlanCents ?? 0), unionDuesCents: sum(ytd.unionDuesCents, deductions.unionDuesCents ?? 0), maintenanceCents: sum(ytd.maintenanceCents, deductions.maintenanceCents ?? 0), bonusRegisteredPlanCents: sum(ytd.bonusRegisteredPlanCents, deductions.bonusRegisteredPlanCents ?? 0), regularTaxCents: sum(ytd.regularTaxCents, regularTax), bonusTaxCents: sum(ytd.bonusTaxCents, bonusTax), additionalTaxCents: sum(ytd.additionalTaxCents, extra) };
  if (!ytd.regularTaxCents || (ytd.regularFederalTaxCents !== undefined && ytd.regularProvincialTaxCents !== undefined)) { closingYtd.regularFederalTaxCents = sum(ytd.regularFederalTaxCents ?? 0, regularFederal); closingYtd.regularProvincialTaxCents = sum(ytd.regularProvincialTaxCents ?? 0, regularProvincial); }
  if (!unknownBonusSplit && (!ytd.bonusTaxCents || (ytd.bonusFederalTaxCents !== undefined && ytd.bonusProvincialTaxCents !== undefined))) { closingYtd.bonusFederalTaxCents = sum(ytd.bonusFederalTaxCents ?? 0, bonusFederal); closingYtd.bonusProvincialTaxCents = sum(ytd.bonusProvincialTaxCents ?? 0, bonusProvincial); }
  return { cashGrossCents: cashGross, taxableGrossCents: sum(regular.taxableCents, bonus.taxableCents), pensionableCents, insurableCents, cppEmployeeCents: cpp, cppEmployerCents: cpp, cpp2EmployeeCents: cpp2, cpp2EmployerCents: cpp2, eiEmployeeCents: ei, eiEmployerCents: employerEi, incomeTaxCents: incomeTax, regularIncomeTaxCents: regularTax, bonusIncomeTaxCents: bonusTax, additionalIncomeTaxCents: extra, federalTaxCents: unknownBonusSplit ? null : sum(regularFederal, bonusFederal), provincialTaxCents: unknownBonusSplit ? null : sum(regularProvincial, bonusProvincial), regularFederalTaxCents: regularFederal, regularProvincialTaxCents: regularProvincial, bonusFederalTaxCents: unknownBonusSplit ? null : bonusFederal, bonusProvincialTaxCents: unknownBonusSplit ? null : bonusProvincial, totalDeductionsCents: totalDeductions, netCashCents: netCash, cppAdditionalRegularCents: f5a, cppAdditionalBonusCents: f5b, closingYtd, explanations, ruleSet: rates, ...(ruleEdition ? { ruleEdition } : {}), input: JSON.parse(JSON.stringify(input)), warnings };
}
