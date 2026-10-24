import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { calculatePayrollDeductions, deriveCppEligibility, emptyPayrollYtd, type PayrollDeductionInput } from "../shared/payrollDeductions";
import { payrollRateSetFor } from "../shared/payrollRates";

const money = (value: number) => ({ cashCents: value, taxableCents: value, pensionableCents: value, insurableCents: value });
const sample = (overrides: Partial<PayrollDeductionInput> = {}): PayrollDeductionInput => ({ payDate: "2026-06-30", provinceOfEmployment: "BC", method: "option1", payPeriodsPerYear: 26, periodNumber: 1, regular: money(200000), ytd: emptyPayrollYtd(), ytdConfirmed: true, ytdEmployerMatches: true, td1: { confirmed: true }, cpp: { eligible: true, contributionMonths: 12 }, ei: { exempt: false }, ...overrides });
const factor = (result: ReturnType<typeof calculatePayrollDeductions>, name: string) => { const value = result.explanations.find(row => row.factor === name); assert.ok(value, `explanation ${name}`); return value.amountCents; };

// Verify every bundled source byte and parse official table values independently.
const root = new URL("../shared/payrollRates/", import.meta.url);
const sources: Array<{ file: string; url: string; sha256: string; bytes: number }> = JSON.parse(await readFile(new URL("sources.json", root), "utf8"));
for (const source of sources) { const bytes = await readFile(new URL(source.file, root)); assert.equal(bytes.length, source.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256); assert.match(source.url, /^https:\/\/www\.canada\.ca\//); }
function csv(raw: string) {
  return raw.split(/\r?\n/).filter(Boolean).map(line => {
    const cells: string[] = []; let field = "", quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) { field += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(field); field = ""; }
      else field += char;
    }
    cells.push(field); return cells;
  });
}
for (const edition of ["2026-01", "2026-07"]) {
  const rows = csv((await readFile(new URL(`${edition}/rates.csv`, root))).toString("latin1"));
  for (const [area, side] of [["Federal", "federal"], ["BC", "provincial"]] as const) {
    const index = rows.findIndex(row => row[0] === area), rates = payrollRateSetFor(`${edition}-01`, "BC", "option1");
    const brackets = rows[index].slice(2).filter(Boolean).map((threshold, item) => ({ thresholdCents: Number(threshold.replaceAll(",", "")) * 100, rate: rows[index + 1][item + 2], constantCents: Number(rows[index + 2][item + 2].replaceAll(",", "")) * 100 }));
    assert.deepEqual(rates[side].brackets, brackets, `${edition} ${area} exactly matches archived official CSV`);
  }
}
const officialRow = async (file: string, starts: string) => csv((await readFile(new URL(file, root))).toString("latin1")).find(row => row[0].startsWith(starts))!;
const toCents = (value: string) => Number(value.replaceAll(",", "")) * 100;
const contributions = payrollRateSetFor("2026-01-01", "BC", "option1");
const cppSource = await officialRow("2026-01/cpp.csv", "CPP (Canada");
assert.equal(contributions.cpp.ympeCents, toCents(cppSource[1])); assert.equal(contributions.cpp.annualExemptionCents, toCents(cppSource[2])); assert.equal(contributions.cpp.rate, cppSource[4]); assert.equal(contributions.cpp.maximumCents, toCents(cppSource[5]));
const cppBase = await officialRow("2026-01/cpp-base.csv", "CPP (Canada"), cppAdditional = await officialRow("2026-01/cpp-additional.csv", "CPP (Canada"), cppSecond = await officialRow("2026-01/cpp2.csv", "CPP (Canada");
assert.equal(contributions.cpp.baseRate, cppBase[2]); assert.equal(contributions.cpp.baseMaximumCents, toCents(cppBase[3])); assert.equal(Number(contributions.cpp.additionalRate), Number(cppAdditional[2])); assert.equal(contributions.cpp.additionalMaximumCents, toCents(cppAdditional[3])); assert.equal(contributions.cpp.yampeCents, toCents(cppSecond[2])); assert.equal(contributions.cpp.secondRate, cppSecond[4]); assert.equal(contributions.cpp.secondMaximumCents, toCents(cppSecond[5]));
const eiSource = await officialRow("2026-01/ei.csv", "Canada except QC");
assert.equal(contributions.ei.insurableMaximumCents, toCents(eiSource[1])); assert.equal(contributions.ei.rate, eiSource[2]); assert.equal(contributions.ei.maximumCents, toCents(eiSource[4])); assert.equal(contributions.ei.employerMaximumCents, toCents(eiSource[5]));
const julyHtml = await readFile(new URL("2026-07/t4127.html", root), "utf8");
const bcTable = julyHtml.slice(julyHtml.indexOf('<caption class="wb-inv">British Columbia – V and KP values for Option 2:')).split("</table>")[0];
const cells = [...bcTable.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<[^>]+>/g, "").trim());
const july2 = payrollRateSetFor("2026-07-01", "BC", "option2");
assert.deepEqual(july2.provincial.brackets.map(row => row.thresholdCents), cells.slice(2, 9).map(value => Number(value.replaceAll(",", "")) * 100));
assert.deepEqual(july2.provincial.brackets.map(row => row.rate), cells.slice(10, 17));
assert.deepEqual(july2.provincial.brackets.map(row => row.constantCents), cells.slice(18, 25).map(value => Number(value.replaceAll(",", "")) * 100));
assert.equal(payrollRateSetFor("2026-06-30", "BC", "option1").provincial.brackets[0].rate, "0.0506");
assert.equal(payrollRateSetFor("2026-07-01", "BC", "option1").provincial.brackets[0].rate, "0.0614");
assert.equal(july2.provincial.brackets[0].rate, "0.0560");
assert.equal(july2.provincial.reductionCents, 69000);
assert.equal(payrollRateSetFor("2026-07-01", "BC", "option1").provincial.reductionCents, 80500);

// CRA T4127 Ch6 Table6.1 and contribution formula: 26 and 27 pays differ.
const jan = calculatePayrollDeductions(sample()), jul = calculatePayrollDeductions(sample({ payDate: "2026-07-01" }));
assert.equal(factor(jan, "CPP exemption"), 13461); assert.equal(jan.cppEmployeeCents, 11099); assert.equal(jan.eiEmployeeCents, 3260); assert.equal(jan.cppEmployerCents, 11099); assert.equal(jan.eiEmployerCents, 4564);
assert.equal(jan.cppEmployeeCents + jan.eiEmployerCents + jan.cashGrossCents, 215663, "official $2,000 worked contribution cost excludes employee withholding as an employer expense");
const pays27 = calculatePayrollDeductions(sample({ payPeriodsPerYear: 27 }));
assert.equal(factor(pays27, "CPP exemption"), 12962); assert.equal(pays27.cppEmployeeCents, 11129);
// Independent cents arithmetic: Jan annual A=51,515.10, T1=4,243.91,
// T2=1,803.56; combined/26=232.60. July T2=2,169.75 =>246.68.
assert.equal(factor(jan, "A"), 5151510); assert.equal(factor(jan, "T1"), 424391); assert.equal(factor(jan, "T2"), 180356); assert.equal(jan.incomeTaxCents, 23260);
assert.equal(factor(jul, "T2"), 216975); assert.equal(jul.incomeTaxCents, 24668);
assert.equal(jan.federalTaxCents! + jan.provincialTaxCents! + jan.additionalIncomeTaxCents, jan.incomeTaxCents);

// Exact published Jan2026 CRA regular-bonus worked example. Federal portion is
// identical in every non-Quebec province; BC portion is separately calculated.
const bonusYtd = { ...emptyPayrollYtd(), regularTaxableCents: 2900000, regularPensionableCents: 2900000, regularInsurableCents: 2900000, bonusTaxableCents: 150000, bonusPensionableCents: 150000, bonusInsurableCents: 150000, cppCents: 169875, eiCents: 49715, bonusCppCents: 8925, bonusEiCents: 2445, cppAdditionalBonusCents: 1460 };
const bonus = calculatePayrollDeductions(sample({ payDate: "2026-01-16", payPeriodsPerYear: 52, periodNumber: 30, regular: money(100000), bonus: money(250000), ytd: bonusYtd, td1: { confirmed: true, federalClaimCents: 1645200 } }));
assert.equal(bonus.cppEmployeeCents, 20425); assert.equal(factor(bonus, "F5A"), 981); assert.equal(factor(bonus, "F5B"), 2452);
assert.equal(factor(bonus, "A with bonus"), 5545076); assert.equal(factor(bonus, "A without bonus"), 5297528); assert.equal(bonus.bonusFederalTaxCents, 32354, "CRA published federal tax on bonus is $323.54");
const bonusOnly = calculatePayrollDeductions(sample({ regular: money(0), bonus: money(200000) }));
assert.equal(factor(bonusOnly, "CPP exemption"), 0); assert.equal(bonusOnly.cppEmployeeCents, 11900); assert.equal(bonusOnly.bonusIncomeTaxCents, 30000);
assert.equal(bonusOnly.bonusFederalTaxCents, null); assert.equal(bonusOnly.federalTaxCents, null, "a combined 15% rate does not establish a federal/provincial split");
assert.equal(bonusOnly.closingYtd.bonusFederalTaxCents, undefined);
assert.throws(() => calculatePayrollDeductions(sample({ method: "option2", periodNumber: 2, ytd: bonusOnly.closingYtd })), /historical federal\/provincial tax split/);

// Contribution caps/thresholds follow same-employer YTD, never another employer.
const capYtd = { ...emptyPayrollYtd(), cppCents: 423040, eiCents: 112300, employerEiCents: 157225 };
const capped = calculatePayrollDeductions(sample({ ytd: capYtd }));
assert.equal(capped.cppEmployeeCents, 5); assert.equal(capped.eiEmployeeCents, 7); assert.equal(capped.eiEmployerCents, 5);
assert.equal(capped.closingYtd.cppCents, 423045); assert.equal(capped.closingYtd.eiCents, 112307); assert.equal(capped.closingYtd.employerEiCents, 157230);
const crossing = calculatePayrollDeductions(sample({ ytd: { ...emptyPayrollYtd(), regularPensionableCents: 7440000, cppCents: 423045 } }));
assert.equal(crossing.cppEmployeeCents, 0); assert.equal(crossing.cpp2EmployeeCents, 7200); assert.equal(crossing.cpp2EmployerCents, 7200);
const upper = calculatePayrollDeductions(sample({ ytd: { ...emptyPayrollYtd(), regularPensionableCents: 8490000, cppCents: 423045, cpp2Cents: 41200 } }));
assert.equal(upper.cpp2EmployeeCents, 400); assert.equal(upper.closingYtd.cpp2Cents, 41600);
const halfYear = calculatePayrollDeductions(sample({ cpp: { eligible: true, contributionMonths: 6 }, ytd: { ...emptyPayrollYtd(), regularPensionableCents: 3700000, cppCents: 211500 } }));
assert.equal(halfYear.cppEmployeeCents, 23); assert.equal(halfYear.cpp2EmployeeCents, 6800);
assert.throws(() => calculatePayrollDeductions(sample({ ytdEmployerMatches: false })), /unrelated previous employer/);

// CRA Option2 cumulative example's 20,000+500 across21 of26 pays, using
// real Jan2026 BC constants, no CPP/EI, claim0, YTDtax3,000: annualA25,380.95,
// annualFed3,343.19+BC709.28; 4,052.47×21/26−3,000 =273.15.
const cumulative = calculatePayrollDeductions(sample({ method: "option2", periodNumber: 21, regular: { ...money(50000), pensionableCents: 0, insurableCents: 0 }, cpp: { eligible: false, contributionMonths: 0 }, ei: { exempt: true }, td1: { confirmed: true, federalClaimCents: 0, provincialClaimCents: 0 }, ytd: { ...emptyPayrollYtd(), regularTaxableCents: 2000000, regularTaxCents: 300000, regularFederalTaxCents: 250000, regularProvincialTaxCents: 50000 } }));
assert.equal(factor(cumulative, "A"), 2538095); assert.equal(factor(cumulative, "T1"), 334319); assert.equal(factor(cumulative, "T2"), 70928); assert.equal(cumulative.incomeTaxCents, 27315);
const julyOption2 = calculatePayrollDeductions(sample({ payDate: "2026-07-01", method: "option2" }));
assert.equal(factor(julyOption2, "K1P"), 74010); assert.equal(factor(jul, "K1P"), 81146);
const extraFirst = calculatePayrollDeductions(sample({ method: "option2", td1: { confirmed: true, additionalTaxCents: 2500 } }));
const extraNext = calculatePayrollDeductions(sample({ method: "option2", periodNumber: 2, td1: { confirmed: true, additionalTaxCents: 2500 }, ytd: extraFirst.closingYtd }));
const extraIgnored = calculatePayrollDeductions(sample({ method: "option2", periodNumber: 2, td1: { confirmed: true, additionalTaxCents: 2500 }, ytd: { ...extraFirst.closingYtd, additionalTaxCents: 999999 } }));
assert.equal(extraNext.regularIncomeTaxCents, extraIgnored.regularIncomeTaxCents); assert.equal(extraNext.additionalIncomeTaxCents, 2500);
const multiple = calculatePayrollDeductions(sample({ td1: { confirmed: true, multipleEmployers: true, federalClaimCents: 1645200, provincialClaimCents: 1321600 } }));
assert.equal(factor(multiple, "TC"), 0); assert.equal(factor(multiple, "TCP"), 0); assert.ok(multiple.incomeTaxCents > jan.incomeTaxCents);

// Noncash benefits are taxable/pensionable without inventing cash or EI.
const benefit = calculatePayrollDeductions(sample({ regular: { cashCents: 200000, taxableCents: 210000, pensionableCents: 210000, insurableCents: 200000 } }));
assert.equal(benefit.cashGrossCents, 200000); assert.equal(benefit.taxableGrossCents, 210000); assert.equal(benefit.eiEmployeeCents, jan.eiEmployeeCents); assert.ok(benefit.cppEmployeeCents > jan.cppEmployeeCents); assert.ok(benefit.netCashCents < jan.netCashCents);
const reimbursement = calculatePayrollDeductions(sample({ regular: { ...money(200000), cashCents: 210000 } }));
assert.equal(reimbursement.incomeTaxCents, jan.incomeTaxCents); assert.equal(reimbursement.netCashCents, jan.netCashCents + 10000);
assert.throws(() => calculatePayrollDeductions(sample({ regular: { ...money(200000), cashCents: 0 } })), /Cash remuneration is insufficient/);
assert.throws(() => calculatePayrollDeductions(sample({ ei: { exempt: false, employerMultiplier: 1.2 } })), /approval evidence/);
const reduced = calculatePayrollDeductions(sample({ ei: { exempt: false, employerMultiplier: 1.2, reducedRateEvidence: "Synthetic PRP approval reference" } }));
assert.equal(reduced.eiEmployerCents, 3912);
for (const overrides of [{ payDate: "2027-01-01" }, { provinceOfEmployment: "ON" }, { employmentKind: "commission" as const }, { ytdConfirmed: false }, { td1: { confirmed: false } }]) assert.throws(() => calculatePayrollDeductions(sample(overrides)));
const unsupportedSplit = { ...emptyPayrollYtd(), regularTaxCents: 10000 }; delete unsupportedSplit.regularFederalTaxCents; delete unsupportedSplit.regularProvincialTaxCents;
assert.throws(() => calculatePayrollDeductions(sample({ method: "option2", ytd: unsupportedSplit })), /historical federal\/provincial tax split/);
assert.doesNotThrow(() => calculatePayrollDeductions(sample({ ytd: unsupportedSplit })), "Option1 does not require an invented historical split");
const phasedBpa = calculatePayrollDeductions(sample({ payPeriodsPerYear: 1, regular: money(18182521), cpp: { eligible: false, contributionMonths: 0 }, ei: { exempt: true } }));
assert.equal(factor(phasedBpa, "TC"), 1644389, "BPAF rounds the whole positive amount half-up, including the exact half-cent phaseout case");
const cutoff = calculatePayrollDeductions(sample({ payDate: "2026-07-01", payPeriodsPerYear: 1, regular: money(4495201), cpp: { eligible: false, contributionMonths: 0 }, ei: { exempt: true } }));
assert.equal(factor(cutoff, "S"), 0, "July Option1 reduction stops at legislated annual cutoff despite its prorated amount");
const freshRate = payrollRateSetFor("2026-07-01", "BC", "option1"); freshRate.provincial.brackets[0].rate = "0"; assert.equal(payrollRateSetFor("2026-07-01", "BC", "option1").provincial.brackets[0].rate, "0.0614");
assert.ok(jan.ruleSet.sources.every(row => row.sha256.length === 64)); assert.equal(jan.ruleSet.method, "option1");

// Payment-month CPP eligibility, including witnessed elections and disability.
assert.deepEqual(deriveCppEligibility({ payDate: "2026-06-30", birthDate: "2008-06-10" }).eligibleMonths, [7,8,9,10,11,12]);
assert.equal(deriveCppEligibility({ payDate: "2026-06-30", birthDate: "2008-06-10" }).eligible, false);
assert.equal(deriveCppEligibility({ payDate: "2026-07-01", birthDate: "2008-06-10" }).eligible, true);
assert.deepEqual(deriveCppEligibility({ payDate: "2026-06-30", birthDate: "1956-06-10" }).eligibleMonths, [1,2,3,4,5,6]);
assert.equal(deriveCppEligibility({ payDate: "2026-07-01", birthDate: "1956-06-10" }).eligible, false);
const stop = { action: "stop" as const, receivedDate: "2025-10-15", retirementPensionConfirmed: true, evidence: "Synthetic CPT30 reference" };
const restart = { action: "restart" as const, receivedDate: "2026-04-20", retirementPensionConfirmed: true, evidence: "Synthetic CPT30 revocation" };
assert.deepEqual(deriveCppEligibility({ payDate: "2026-05-01", birthDate: "1959-01-01", elections: [stop,restart] }).eligibleMonths, [5,6,7,8,9,10,11,12]);
assert.throws(() => deriveCppEligibility({ payDate: "2026-12-31", birthDate: "1959-01-01", elections: [{ ...stop, receivedDate: "2026-02-01" }, restart] }), /once per calendar year|prior calendar year/);
assert.throws(() => deriveCppEligibility({ payDate: "2026-12-31", birthDate: "1965-01-01", elections: [{ ...stop, receivedDate: "2026-02-01" }] }), /65–69/);
assert.throws(() => deriveCppEligibility({ payDate: "2026-01-01", birthDate: "1959-01-01", elections: [{ ...stop, receivedDate: "2026-06-01" }] }), /future CPT30 receipt/);
assert.deepEqual(deriveCppEligibility({ payDate: "2026-05-01", birthDate: "1980-01-01", disabilityPeriods: [{ consideredDisabledDate: "2026-02-10", noLongerDisabledDate: "2026-04-15", evidence: "Synthetic Service Canada letter" }] }).eligibleMonths, [1,2,5,6,7,8,9,10,11,12]);
for (const reason of ["Under 18", "Over 70", "CPT30 election", "Disability", "Other reviewed reason"]) assert.throws(() => deriveCppEligibility({ payDate: "2026-06-30", birthDate: "1980-01-01", exempt: { confirmed: true, reason } }), /manual CPP exemption cannot override dated eligibility/);
// Each signed TD1 jurisdiction carries its own declarations. Neither checkbox
// exempts CPP/EI or a separately requested federal additional payment amount.
const fedConcurrent = calculatePayrollDeductions(sample({ td1: { confirmed: true, federalMultipleEmployers: true } }));
assert.equal(factor(fedConcurrent, "TC"), 0); assert.equal(factor(fedConcurrent, "TCP"), 1321600);
const bcConcurrent = calculatePayrollDeductions(sample({ td1: { confirmed: true, provincialMultipleEmployers: true } }));
assert.equal(factor(bcConcurrent, "TC"), 1645200); assert.equal(factor(bcConcurrent, "TCP"), 0);
const legacyOverride = calculatePayrollDeductions(sample({ td1: { confirmed: true, multipleEmployers: true, federalMultipleEmployers: false } }));
assert.equal(factor(legacyOverride, "TC"), 1645200); assert.equal(factor(legacyOverride, "TCP"), 0);
const federalBelow = calculatePayrollDeductions(sample({ td1: { confirmed: true, federalTaxExempt: true, additionalTaxCents: 2500 } }));
assert.equal(federalBelow.federalTaxCents, 0); assert.equal(federalBelow.provincialTaxCents, 6937); assert.equal(federalBelow.incomeTaxCents, 9437);
assert.equal(federalBelow.cppEmployeeCents, jan.cppEmployeeCents); assert.equal(federalBelow.eiEmployeeCents, jan.eiEmployeeCents);
const provincialBelow = calculatePayrollDeductions(sample({ td1: { confirmed: true, provincialTaxExempt: true } }));
assert.equal(provincialBelow.federalTaxCents, 16323); assert.equal(provincialBelow.provincialTaxCents, 0);
const bothBelow = calculatePayrollDeductions(sample({ td1: { confirmed: true, taxExempt: true, additionalTaxCents: 2500 } }));
assert.equal(bothBelow.regularIncomeTaxCents, 0); assert.equal(bothBelow.incomeTaxCents, 2500);
const legacyExemptOverride = calculatePayrollDeductions(sample({ td1: { confirmed: true, taxExempt: true, provincialTaxExempt: false } }));
assert.equal(legacyExemptOverride.federalTaxCents, 0); assert.equal(legacyExemptOverride.provincialTaxCents, 6937);
const cumulativeExemption = calculatePayrollDeductions(sample({ method: "option2", periodNumber: 2, ytd: jan.closingYtd, td1: { confirmed: true, federalTaxExempt: true } }));
assert.equal(cumulativeExemption.federalTaxCents, 0); assert.ok(cumulativeExemption.provincialTaxCents! > 0, "historical federal tax cannot wipe out BC's current cumulative target");
for (const flag of ["federalTaxExempt", "provincialTaxExempt"] as const) assert.throws(() => calculatePayrollDeductions(sample({ regular: money(0), bonus: money(200000), td1: { confirmed: true, [flag]: true } })), /15%.*combined withholding/);
const nonflatExemption = calculatePayrollDeductions(sample({ regular: money(200000), bonus: money(200000), td1: { confirmed: true, federalTaxExempt: true } }));
assert.equal(nonflatExemption.bonusFederalTaxCents, 0); assert.ok(nonflatExemption.bonusProvincialTaxCents! > 0);

// A hypothetical reviewed parameter edition exercises the real injection seam.
// It is a test fixture, never a claim that CRA published these altered rates.
const selectedRates = payrollRateSetFor("2026-06-30", "BC", "option1");
selectedRates.id = "TEST-ONLY-reviewed-custom-CPP";
selectedRates.cpp.rate = "0.06"; selectedRates.cpp.baseRate = "0.04"; selectedRates.cpp.additionalRate = "0.02";
selectedRates.cpp.maximumCents = 426600; selectedRates.cpp.baseMaximumCents = 284400; selectedRates.cpp.additionalMaximumCents = 142200;
const metadata = { id: "test-edition", version: 2, sourceReferences: ["https://www.canada.ca/test-fixture"] };
const selected = calculatePayrollDeductions(sample(), { rateSet: selectedRates, ruleEdition: metadata });
assert.equal(selected.cppEmployeeCents, 11192, "186539 cents of pensionable pay after truncated exemption at6%");
assert.equal(selected.cppAdditionalRegularCents, 3731, "additional CPP must use2/6 of selected contribution rather than hardcoded100/595");
assert.equal(factor(selected, "K2"), 39024, "selected base CPP credit: round(193986×14%)=27158 + round(84760×14%)=11866");
assert.equal(selected.ruleSet.id, selectedRates.id); assert.deepEqual(selected.ruleEdition, metadata);
selectedRates.cpp.rate = "0.07"; metadata.sourceReferences.push("https://www.canada.ca/mutated");
assert.equal(selected.ruleSet.cpp.rate, "0.06"); assert.equal(selected.ruleEdition!.sourceReferences.length, 1, "frozen result does not alias caller metadata");
assert.throws(() => calculatePayrollDeductions(sample(), { rateSet: selectedRates }), /positive total rate equal/);
assert.throws(() => calculatePayrollDeductions(sample({ payDate: "2026-07-01" }), { rateSet: payrollRateSetFor("2026-06-30", "BC", "option1") }), /does not cover/);
assert.throws(() => calculatePayrollDeductions(sample(), { ruleEdition: metadata }), /valid selected rule edition/);
console.log("Native payroll deduction checks passed: archived official CSV/HTML hashes, January/July Option1/2, published CRA bonus example, 26/27 pays, CPP/CPP2/EI/PM caps, cumulative tax, independent TD1 declarations, reviewed edition injection/exact CPP ratios, cash/benefit bases, evidence, unsupported cases and effective CPP eligibility. No external service called.");
