import assert from "node:assert/strict";

import { complianceFactsForOrganization, computeComplianceObligations, filterApplicableCompliancePacks } from "../src/lib/compliance";
import { loadComplianceRulePacks } from "../src/lib/compliance/registry";
import { filingKindDefinition, jurisdictionModuleContract } from "../shared/jurisdictionWorkspace";

const packs = loadComplianceRulePacks();

const cbcaFacts = {
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  asOfDate: "2026-06-04",
  incorporationDate: "2025-01-15",
  anniversaryDate: "2020-03-15",
  fiscalYearEnd: "2025-12-31",
};

const cbcaPacks = filterApplicableCompliancePacks(cbcaFacts, packs);
assert.deepEqual(
  cbcaPacks.map((pack) => pack.packId),
  ["compliance-ca-fed-cbca"],
  "CBCA facts should load only the CBCA compliance pack",
);

const cbcaModule = jurisdictionModuleContract("CA-FED-CBCA");
assert.deepEqual(
  cbcaModule.compliancePackIds,
  ["compliance-ca-fed-cbca"],
  "Federal module should point at the CBCA compliance pack",
);
assert.equal(
  filingKindDefinition("FederalAnnualReturn", "CA-FED-CBCA").registryUrl.includes("ised-isde.canada.ca"),
  true,
  "Federal annual return should point at Corporations Canada",
);

const cbcaObligations = computeComplianceObligations(cbcaFacts, packs);
const cbcaByRule = new Map(cbcaObligations.map((obligation) => [obligation.ruleId, obligation]));

assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-annual-return-window")?.windowStartDate,
  "2027-03-15",
  "Past CBCA annual return window should roll forward to the next anniversary date",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-annual-return-window")?.dueDate,
  "2027-05-14",
  "Past annual window should roll forward to the next annual due date",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-annual-return-window")?.creates?.filingKind,
  "FederalAnnualReturn",
  "CBCA annual return should create a federal annual return filing",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-financials-to-shareholders")?.dueDate,
  "2026-06-30",
  "Annual fiscal-year obligation should use the as-of year's anchor date",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-first-agm")?.dueDate,
  "2026-07-15",
  "Offset obligation should add the configured offset to the incorporation date",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-isc-annual-review")?.creates?.filingKind,
  "FederalIscUpdate",
  "CBCA ISC annual review should create an ISC update/review workflow",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-director-change-review")?.creates?.filingKind,
  "FederalDirectorChange",
  "CBCA director change review should create a federal director-change filing workflow",
);
assert.equal(
  cbcaByRule.get("compliance-ca-fed-cbca-registered-office-change-review")?.creates?.filingKind,
  "FederalRegisteredOfficeChange",
  "CBCA registered-office review should create a registered-office filing workflow",
);
assert.ok(
  cbcaByRule.get("compliance-ca-fed-cbca-corporation-key-custody")?.creates?.requiredEvidence.includes("keyCustodyRecord"),
  "CBCA corporation key custody review should require key custody evidence",
);

const cbcaEventObligations = computeComplianceObligations({
  ...cbcaFacts,
  asOfDate: "2026-06-04",
  eventDates: {
    iscChangeDate: "2026-06-01",
    directorChangeDate: "2026-06-02",
    registeredOfficeChangeDate: "2026-06-03",
  },
}, packs);
const cbcaEventByRule = new Map(cbcaEventObligations.map((obligation) => [obligation.ruleId, obligation]));
assert.equal(
  cbcaEventByRule.get("compliance-ca-fed-cbca-isc-change-filing")?.dueDate,
  "2026-06-16",
  "CBCA ISC change filing should compute 15 days from the ISC change date",
);
assert.equal(
  cbcaEventByRule.get("compliance-ca-fed-cbca-director-change-filing")?.dueDate,
  "2026-06-17",
  "CBCA director change filing should compute 15 days from the director change date",
);
assert.equal(
  cbcaEventByRule.get("compliance-ca-fed-cbca-registered-office-change-filing")?.dueDate,
  "2026-06-18",
  "CBCA registered-office change filing should compute 15 days from the registered office change date",
);

const obcaFacts = {
  jurisdictionCode: "CA-ON-OBCA",
  entityType: "corporation__business_",
  asOfDate: "2026-02-01",
  incorporationDate: "2026-01-10",
  fiscalYearEnd: "2025-12-31",
};

const obcaObligations = computeComplianceObligations(obcaFacts, packs);
const obcaByRule = new Map(obcaObligations.map((obligation) => [obligation.ruleId, obligation]));

assert.equal(
  obcaByRule.get("compliance-ca-on-obca-initial-return")?.dueDate,
  "2026-03-11",
  "OBCA initial return should compute from incorporation date",
);
assert.equal(
  obcaByRule.get("compliance-ca-on-obca-initial-return")?.creates?.filingKind,
  "OntarioInitialReturn",
  "OBCA initial return should create an Ontario initial return filing",
);
assert.equal(
  obcaByRule.get("compliance-ca-on-obca-annual-return-window")?.windowStartDate,
  "2026-01-01",
  "OBCA annual return window should open after fiscal year end",
);
assert.equal(
  obcaByRule.get("compliance-ca-on-obca-annual-return-window")?.dueDate,
  "2026-06-30",
  "OBCA annual return window should close six months after fiscal year end",
);
assert.equal(
  filingKindDefinition("OntarioInitialReturn", "CA-ON-OBCA").registryUrl.includes("ontario.ca"),
  true,
  "Ontario initial return should point at the Ontario Business Registry",
);

const bcSocietyFacts = {
  jurisdictionCode: "CA-BC",
  entityType: "society",
  asOfDate: "2026-06-04",
  incorporationDate: "2020-01-01",
  fiscalYearEnd: "2026-03-31",
  annualMeetingDate: "2026-05-15",
};

const bcSocietyPacks = filterApplicableCompliancePacks(bcSocietyFacts, packs);
assert.deepEqual(
  bcSocietyPacks.map((pack) => pack.packId),
  ["compliance-ca-bc-societies"],
  "BC society facts should load only the BC societies compliance pack",
);
const bcModule = jurisdictionModuleContract("CA-BC");
assert.deepEqual(
  bcModule.compliancePackIds,
  [
    "compliance-ca-bc-societies",
    "compliance-ca-bc-company",
    "compliance-ca-bc-extra-provincial-company",
  ],
  "BC module should point at society, company, and extra-provincial compliance packs",
);
assert.equal(
  filingKindDefinition("BCSocietyAnnualReport", "CA-BC").registryUrl.includes("bcregistry.gov.bc.ca"),
  true,
  "BC society annual report should point at BC Registry",
);
const bcSocietyObligations = computeComplianceObligations(bcSocietyFacts, packs);
const bcSocietyByRule = new Map(bcSocietyObligations.map((obligation) => [obligation.ruleId, obligation]));
assert.equal(
  bcSocietyByRule.get("compliance-ca-bc-societies-annual-report")?.dueDate,
  "2026-06-14",
  "BC annual report should compute from annual meeting date",
);
assert.equal(
  bcSocietyByRule.get("compliance-ca-bc-societies-annual-report")?.creates?.filingKind,
  "BCSocietyAnnualReport",
  "BC annual report should create a BC society annual report filing",
);
assert.equal(
  bcSocietyByRule.has("compliance-ca-bc-company-annual-report"),
  false,
  "BC society facts should not receive BC company obligations",
);

const bcNoAgmObligations = computeComplianceObligations({
  ...bcSocietyFacts,
  annualMeetingDate: undefined,
  eventDates: {
    noAgmCalendarYearEnd: "2026-12-31",
  },
}, packs);
const bcNoAgmByRule = new Map(bcNoAgmObligations.map((obligation) => [obligation.ruleId, obligation]));
assert.equal(
  bcNoAgmByRule.get("compliance-ca-bc-societies-no-agm-annual-report")?.dueDate,
  "2027-01-31",
  "BC society no-AGM fallback annual report should compute to January 31 of the following year",
);

const bcCompanyFacts = {
  jurisdictionCode: "CA-BC",
  entityType: "corporation__business_",
  homeJurisdictionCode: "CA-BC",
  contextKind: "home" as const,
  asOfDate: "2026-06-04",
  incorporationDate: "2024-03-01",
  anniversaryDate: "2024-03-01",
  fiscalYearEnd: "2025-12-31",
};
const bcCompanyObligations = computeComplianceObligations(bcCompanyFacts, packs);
const bcCompanyByRule = new Map(bcCompanyObligations.map((obligation) => [obligation.ruleId, obligation]));
assert.equal(
  bcCompanyByRule.get("compliance-ca-bc-company-annual-report")?.dueDate,
  "2027-05-01",
  "BC company annual report should compute within two months after the next anniversary",
);
assert.equal(
  bcCompanyByRule.get("compliance-ca-bc-company-annual-report")?.creates?.filingKind,
  "BCCompanyAnnualReport",
  "BC company annual report should create a BC company filing",
);
assert.equal(
  bcCompanyByRule.has("compliance-ca-bc-societies-annual-report"),
  false,
  "BC company facts should not receive BC society obligations",
);

const federalWithOntarioRegistration = {
  _id: "corp-fed-on",
  name: "Federal With Ontario Inc.",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  incorporationDate: "2025-02-10",
  fiscalYearEnd: "12-31",
};
const federalPlusOntarioFacts = complianceFactsForOrganization(federalWithOntarioRegistration, {
  asOfDate: "2026-02-01",
  registrations: [
    {
      _id: "reg-on",
      registrationType: "extra_provincial",
      jurisdiction: "CA-ON-OBCA",
      registrationDate: "2026-01-05",
      annualReturnDueDate: "2026-06-30",
      status: "active",
      registrationNumber: "ON-123",
    },
  ],
});
assert.equal(federalPlusOntarioFacts.length, 2, "Home plus Ontario registration should produce two fact contexts");
const federalPlusOntarioObligations = federalPlusOntarioFacts.flatMap((facts) => computeComplianceObligations(facts, packs));
const ontarioRegistrationInitial = federalPlusOntarioObligations.find(
  (obligation) =>
    obligation.ruleId === "compliance-ca-on-obca-initial-return" &&
    obligation.sourceRegistrationId === "reg-on",
);
assert.equal(
  ontarioRegistrationInitial?.dueDate,
  "2026-03-06",
  "Ontario extra-provincial initial return should compute from registration date",
);
assert.equal(
  ontarioRegistrationInitial?.contextKey,
  "registration:reg-on:compliance-ca-on-obca-initial-return",
  "Registration-backed obligations should have registration-specific decision keys",
);
assert.equal(
  federalPlusOntarioObligations.some((obligation) =>
    obligation.ruleId === "compliance-ca-on-obca-annual-return-window" &&
    obligation.sourceRegistrationId === "reg-on"
  ),
  false,
  "Ontario annual return should not be applied to federal extra-provincial registration facts",
);

const federalWithBcRegistration = {
  _id: "corp-fed-bc",
  name: "Federal With BC Inc.",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  incorporationDate: "2025-02-10",
  fiscalYearEnd: "12-31",
};
const federalPlusBcFacts = complianceFactsForOrganization(federalWithBcRegistration, {
  asOfDate: "2026-02-01",
  registrations: [
    {
      _id: "reg-bc",
      registrationType: "extra_provincial",
      jurisdiction: "CA-BC",
      registrationDate: "2025-04-01",
      annualReturnDueDate: "2026-04-30",
      status: "active",
      registrationNumber: "A123456",
    },
  ],
});
assert.equal(federalPlusBcFacts.length, 2, "Home plus BC registration should produce two fact contexts");
const federalPlusBcObligations = federalPlusBcFacts.flatMap((facts) => computeComplianceObligations(facts, packs));
const bcRegistrationAnnual = federalPlusBcObligations.find(
  (obligation) =>
    obligation.ruleId === "compliance-ca-bc-extra-provincial-annual-report" &&
    obligation.sourceRegistrationId === "reg-bc",
);
assert.equal(
  bcRegistrationAnnual?.dueDate,
  "2026-04-30",
  "BC extra-provincial annual report should compute from registration annualReturnDueDate",
);
assert.equal(
  bcRegistrationAnnual?.creates?.filingKind,
  "BCExtraProvincialAnnualReport",
  "BC extra-provincial obligation should create a BC extra-provincial annual report filing",
);
assert.equal(
  federalPlusBcObligations.some((obligation) =>
    obligation.ruleId === "compliance-ca-bc-company-annual-report" &&
    obligation.sourceRegistrationId === "reg-bc"
  ),
  false,
  "BC company home annual report should not be emitted for BC extra-provincial registration facts",
);

console.log(`Checked ${cbcaObligations.length + cbcaEventObligations.length + obcaObligations.length + bcSocietyObligations.length + bcNoAgmObligations.length + bcCompanyObligations.length + federalPlusOntarioObligations.length + federalPlusBcObligations.length} computed compliance obligation fixtures.`);
