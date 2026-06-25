import assert from "node:assert/strict";

import { buildRenderContext } from "../shared/renderContext";
import type { Actor } from "../shared/nlg";

const oneDirector: Actor[] = [{ name: "Jane Doe", gender: "F" }];
const threeDirectors: Actor[] = [
  { name: "Jane Doe", gender: "F" },
  { name: "John Roe", gender: "M" },
  { name: "Alex Poe", gender: "X" },
];

// Society org with a single director.
const society = buildRenderContext({
  org: {
    entityType: "society",
    actFormedUnder: "societies_act",
    legalName: "Acme Society",
    shortName: "Acme",
  },
  directors: oneDirector,
  asOf: "2026-06-25",
});

assert.equal(society.org.legislation, "Societies Act");
assert.equal(society.org.name, "Acme Society");
assert.equal(society.org.shortName, "Acme");
assert.equal(society.org.kind, "society");
assert.equal(society.dir.isSole, true);
assert.equal(society.dir.isEmpty, false);
assert.equal(society.dir.isMultiple, false);
assert.equal(society.dir.count, 1);
assert.equal(society.dir.verbS, "s");
assert.deepEqual(society.dir.list, oneDirector);

// date round-trip + long format.
assert.equal(society.date.iso, "2026-06-25");
assert.equal(society.date.long, "June 25, 2026");

// Empty groups default to plural / empty.
assert.equal(society.members.isEmpty, true);
assert.equal(society.members.count, 0);
assert.equal(society.officers.isEmpty, true);

// Society org with three directors.
const societyThree = buildRenderContext({
  org: {
    entityType: "society",
    actFormedUnder: "societies_act",
    legalName: "Acme Society",
    shortName: "Acme",
  },
  directors: threeDirectors,
  asOf: "2026-06-25",
});

assert.equal(societyThree.dir.isMultiple, true);
assert.equal(societyThree.dir.isSole, false);
assert.equal(societyThree.dir.count, 3);
assert.equal(societyThree.dir.verbS, "");

// Corporation formed under the CBCA.
const cbca = buildRenderContext({
  org: {
    entityType: "corporation",
    actFormedUnder: "canada_business_corporations_act",
    legalName: "Acme Holdings Inc.",
  },
  asOf: "2026-01-01",
});

assert.equal(cbca.org.kind, "corporation");
assert.ok(cbca.org.legislation.includes("Canada Business Corporations Act"));
assert.equal(cbca.org.legislation, "Canada Business Corporations Act");

// Non-CBCA corporation falls back to the generic Business Corporations Act.
const corp = buildRenderContext({
  org: {
    entityType: "corporation",
    actFormedUnder: "business_corporations_act",
    legalName: "Acme Corp.",
  },
  asOf: "2026-01-01",
});
assert.equal(corp.org.legislation, "Business Corporations Act");

// Generic organization → applicable legislation, shortName falls back to label.
const generic = buildRenderContext({
  org: { legalName: "Acme Club" },
  asOf: "2026-12-09",
});
assert.equal(generic.org.kind, "organization");
assert.equal(generic.org.legislation, "applicable legislation");
assert.equal(generic.org.shortName, "Acme Club");
assert.equal(generic.date.long, "December 9, 2026");

// jurisdiction + registrationNumber resolution.
const withReg = buildRenderContext({
  org: {
    legalName: "Acme Society",
    entityType: "society",
    jurisdictionCode: "CA-BC",
    incorporationNumber: "S-12345",
  },
  asOf: "2026-06-25",
});
assert.equal(withReg.org.jurisdiction, "CA-BC");
assert.equal(withReg.org.registrationNumber, "S-12345");

const explicitReg = buildRenderContext({
  org: { legalName: "Acme Society", entityType: "society", incorporationNumber: "S-12345" },
  registrationNumber: "OVERRIDE-1",
  asOf: "2026-06-25",
});
assert.equal(explicitReg.org.registrationNumber, "OVERRIDE-1");
assert.equal(explicitReg.org.jurisdiction, "");

console.log("OK render-context");
