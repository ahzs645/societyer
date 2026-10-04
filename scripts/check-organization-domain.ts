import assert from "node:assert/strict";

import {
  homeJurisdictionCode,
  isBcSociety,
  isCorporation,
  isFederalCbca,
  isOntarioObca,
  isSociety,
  organizationEntityType,
  organizationKind,
  organizationLabel,
  validateWorkspaceLegalIdentity,
  validateWorkspaceLegalIdentityUpdate,
} from "../shared/organizationDomain";
import { filingKindDefinition, filingKindDefinitions, jurisdictionDisplayCopy, jurisdictionModuleContract, WORKSPACE_SETUP_TRACKS } from "../shared/jurisdictionWorkspace";
import { getLegalGuideRules, resolveJurisdictionCode } from "../src/lib/jurisdictionGuideTracks";
import { complianceFactsForOrganization } from "../src/lib/compliance/facts";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { directorComplianceProfile } from "../shared/directorCompliance";

const bcSociety = {
  _id: "society_1",
  name: "Riverside Community Society",
  jurisdictionCode: "CA-BC",
  entityType: "society",
  actFormedUnder: "societies_act",
};

assert.equal(organizationLabel(bcSociety), "Riverside Community Society");
assert.equal(organizationEntityType(bcSociety), "society");
assert.equal(homeJurisdictionCode(bcSociety), "CA-BC");
assert.equal(organizationKind(bcSociety), "society");
assert.equal(isSociety(bcSociety), true);
assert.equal(isCorporation(bcSociety), false);
assert.equal(isBcSociety(bcSociety), true);
const bcDirectorProfile = directorComplianceProfile(bcSociety);
assert.equal(bcDirectorProfile.minimumActiveDirectors, 3);
assert.equal(bcDirectorProfile.requiresBcResidentDirector, true);
assert.equal(bcDirectorProfile.showBcResidentField, true);

const federalCorporation = {
  name: "Northwind Ltd.",
  homeJurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
};

assert.equal(homeJurisdictionCode(federalCorporation), "CA-FED-CBCA");
assert.equal(organizationKind(federalCorporation), "corporation");
assert.equal(isFederalCbca(federalCorporation), true);
assert.equal(isCorporation(federalCorporation), true);
const federalDirectorProfile = directorComplianceProfile(federalCorporation);
assert.equal(federalDirectorProfile.minimumActiveDirectors, undefined);
assert.equal(federalDirectorProfile.requiresBcResidentDirector, false);
assert.equal(federalDirectorProfile.showBcResidentField, false);
assert.match(federalDirectorProfile.subtitle, /corporation workspace/i);

const ontarioCorporation = {
  legalName: "Contoso Inc.",
  jurisdiction: "ontario",
  actFormedUnder: "business_corporations_act__ontario_",
};

assert.equal(organizationLabel(ontarioCorporation), "Contoso Inc.");
assert.equal(homeJurisdictionCode(ontarioCorporation), "ontario");
assert.equal(isOntarioObca(ontarioCorporation), true);

assert.equal(organizationLabel(null), "Organization");
assert.equal(homeJurisdictionCode(null), "unknown");
assert.equal(directorComplianceProfile(null).requiresBcResidentDirector, false);

const bcCompany = { name: "Example Provincial Inc.", ...WORKSPACE_SETUP_TRACKS.find((track) => track.id === "bc_company")! };
assert.equal(organizationKind(bcCompany), "corporation");
assert.equal(jurisdictionDisplayCopy(bcCompany).entityLabel, "corporation");
assert.equal(jurisdictionDisplayCopy(bcCompany).directorResidencySubtext.includes("BC resident required"), false);
assert.equal(jurisdictionModuleContract(bcCompany).registryImportSupported, false);
assert.equal(jurisdictionModuleContract(bcSociety).registryImportSupported, true);
assert.equal(filingKindDefinitions(bcCompany).some((definition) => definition.kind === "BCSocietyAnnualReport"), false);
assert.equal(filingKindDefinition("BCCompanyAnnualReport", "CA-BC").registryUrl, "https://www.corporateonline.gov.bc.ca/");
const bcCompanyGuide = resolveJurisdictionCode(bcCompany);
const companyGuideRules = getLegalGuideRules({ jurisdictionCode: bcCompanyGuide });
assert.ok(companyGuideRules.length > 0);
assert.equal(companyGuideRules.some((rule) => rule.citationLabel.includes("Societies Act")), false);
assert.equal(resolveJurisdictionCode(bcSociety), "CA-BC");
assert.throws(() => validateWorkspaceLegalIdentity({ ...bcCompany, actFormedUnder: "societies_act" }), /same legal setup/);
assert.throws(() => validateWorkspaceLegalIdentity({ ...bcCompany, jurisdictionCode: "CA-FED-CBCA" }), /home legal jurisdiction/);
assert.throws(() => validateWorkspaceLegalIdentity({ ...bcCompany, isMemberFunded: true }), /Member-funded/);
validateWorkspaceLegalIdentity({ name: "Historical organization" });
assert.throws(() => validateWorkspaceLegalIdentity({ ...bcCompany, homeJurisdictionCode: "CA-FED-CBCA" }), /home jurisdiction must match/);
assert.throws(() => validateWorkspaceLegalIdentityUpdate(bcSociety, { entityType: "corporation__business_" }), /same legal setup/);
assert.throws(() => validateWorkspaceLegalIdentityUpdate({ ...bcCompany, incorporationNumber: "1234567" }, { organizationStatus: "pre_incorporation" }), /preparing incorporation/);
validateWorkspaceLegalIdentityUpdate({ ...bcCompany, actFormedUnder: "societies_act" }, { name: "Updated legacy display name" });
const pending = { ...bcCompany, organizationStatus: "pre_incorporation" };
assert.deepEqual(complianceFactsForOrganization(pending), []);
assert.throws(() => validateWorkspaceLegalIdentity({ ...pending, incorporationNumber: "1234567" }), /preparing incorporation/);
const client = new StaticConvexClient({ databaseName: `corporation-mode-${Date.now()}`, seed: { societies: [] } });
const { id, label, hint, ...legalIdentity } = bcCompany;
const created = await client.mutation("society:createWorkspace", { ...legalIdentity, organizationStatus: "pre_incorporation" });
const saved = await client.query("society:getById", { id: created.societyId });
assert.equal(saved.organizationStatus, "pre_incorporation");
assert.equal(saved.entityType, "corporation__business_");
assert.equal(saved.jurisdictionCode, "CA-BC");
await assert.rejects(async () => client.mutation("society:createWorkspace", {
  name: "Invalid default jurisdiction", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act",
}), /home legal jurisdiction/);
await assert.rejects(async () => client.mutation("society:upsert", { id: created.societyId, actFormedUnder: "societies_act" }), /same legal setup/);
const registration = await client.query("organizationDetails:overview", { societyId: created.societyId });
assert.equal(registration.registrations[0].status, "pending");
assert.equal(registration.registrations[0].registrationNumber, undefined);
assert.equal(registration.registrations[0].registrationDate, undefined);
const tasks = await client.query("tasks:list", { societyId: created.societyId });
assert.ok(tasks.some((task: any) => task.tags?.includes("formation")));
assert.equal(tasks.some((task: any) => /constitution|member register|Societies Online/.test(task.description ?? "")), false);
const beforeReset = await client.query("bylawRules:getActive", { societyId: created.societyId });
assert.equal(beforeReset.isFallback, true);
await assert.rejects(() => client.mutation("bylawRules:resetToDefault", { societyId: created.societyId }), /BC society baseline cannot be adopted/);
assert.deepEqual(await client.query("bylawRules:list", { societyId: created.societyId }), []);
const societyWorkspace = await client.mutation("society:createWorkspace", { name: "Example Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act" });
await client.mutation("bylawRules:resetToDefault", { societyId: societyWorkspace.societyId });
const societyRules = await client.query("bylawRules:getActive", { societyId: societyWorkspace.societyId });
assert.equal(societyRules.isFallback, true, "reset is an auditable draft baseline, not evidence of adopted operative bylaws");
assert.equal(societyRules.generalNoticeMinDays, 14);
console.log("Organization domain checks passed.");
