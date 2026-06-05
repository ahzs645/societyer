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
} from "../shared/organizationDomain";
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

console.log("Organization domain checks passed.");
