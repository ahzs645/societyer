import assert from "node:assert/strict";

import { normalizeSearchName, matchByPrefix, type DirectoryPerson } from "../shared/peopleDirectory";
import { computeDividend, validateDividend, totalDeclaredByClass, type DividendDeclaration } from "../shared/dividends";
import { activeProvidersAsOf, validateServiceProvider, type ServiceProvider, type ServiceProviderFunction } from "../shared/serviceProviders";
import { reviewsDue, type SignificanceStep } from "../shared/significantIndividuals";

/**
 * Connection test for the Wave-A Convex CRUD wrappers (convex/peopleDirectory.ts,
 * dividends.ts, serviceProviders.ts, significantIndividualSteps.ts). The handlers
 * only map rows/args to the unit-tested shared functions and persist; this
 * exercises those exact transformations so the wiring is covered without a live
 * backend.
 */

// --- peopleDirectory.upsert/searchByPrefix ------------------------------------
// upsert computes searchName = normalizeSearchName(fullName)
assert.equal(normalizeSearchName("  Dr. Jane  A. Doe ,  "), normalizeSearchName("dr jane a doe"));
const dirRows = [
  { _id: "p1", fullName: "Jane Doe", firstName: "Jane", lastName: "Doe", dob: "1980-01-01" },
  { _id: "p2", fullName: "Janet Smith", firstName: "Janet", lastName: "Smith" },
];
const people: DirectoryPerson[] = dirRows.map((r) => ({
  id: String(r._id), fullName: r.fullName, firstName: r.firstName, lastName: r.lastName, dob: r.dob,
}));
assert.deepEqual(matchByPrefix(people, "jane d", 10).map((p) => p.fullName), ["Jane Doe"]);

// --- dividends.create -> validate + computeDividend ---------------------------
const decl: DividendDeclaration = { declaredOn: "2026-03-01", shareClass: "Common", perShareCents: 250, sharesOutstanding: 1000, currency: "CAD" };
assert.equal(validateDividend(decl).ok, true);
assert.equal(computeDividend(decl).totalCents, 250000);
assert.equal(validateDividend({ ...decl, currency: "" }).ok, false); // create() would throw
assert.deepEqual(totalDeclaredByClass([decl, { ...decl, perShareCents: 100 }]), { Common: 350000 });

// --- serviceProviders.activeAsOf -> row map + activeProvidersAsOf -------------
const spRows = [
  { _id: "s1", function: "auditor", firmName: "Audit LLP", appointedOn: "2024-01-01", removedOn: null },
  { _id: "s2", function: "lawyer", firmName: "Law Co", appointedOn: "2020-01-01", removedOn: "2023-01-01" },
];
const providers: ServiceProvider[] = spRows.map((r) => ({
  id: String(r._id), function: r.function as ServiceProviderFunction, firmName: r.firmName,
  appointedOn: r.appointedOn, removedOn: r.removedOn,
}));
assert.deepEqual(activeProvidersAsOf(providers, "2025-06-01").map((p) => p.firmName), ["Audit LLP"]);
assert.equal(validateServiceProvider({ function: "auditor", firmName: "Audit LLP" }).ok, true);
assert.equal(validateServiceProvider({ function: "not_a_function" as ServiceProviderFunction, firmName: "X" }).ok, false);

// --- significantIndividualSteps.reviewsDue -----------------------------------
const stepRows = [
  { _id: "st1", individualName: "Jordan Vale", stepsNarrative: "ID verified", stepDate: "2025-01-10", nextReviewDate: "2026-01-10" },
  { _id: "st2", individualName: "Sam Lee", stepsNarrative: "Confirmed", stepDate: "2025-06-01", nextReviewDate: "2027-06-01" },
];
const steps: SignificanceStep[] = stepRows.map((r) => ({
  individualName: r.individualName, stepsNarrative: r.stepsNarrative, stepDate: r.stepDate, nextReviewDate: r.nextReviewDate,
}));
assert.deepEqual(reviewsDue(steps, "2026-03-01").map((s) => s.individualName), ["Jordan Vale"]);

console.log("OK persistence-wrappers");
