import assert from "node:assert/strict";

import { actorGrammar, looksLikeOrganization, type Actor } from "../shared/nlg";

// --- 1 male director (single male actor) ---
{
  const g = actorGrammar([{ name: "John Director", gender: "M" }]);
  assert.equal(g.count, 1);
  assert.equal(g.gender, "M");
  assert.equal(g.plural, "");
  assert.equal(g.possessive, "'s");
  assert.equal(g.pronoun, "he");
  assert.equal(g.pronPoss, "his");
  assert.equal(g.verbS, "s");
  assert.equal(g.hasHave, "has");
  assert.equal(g.allTheSole, "the sole");
  assert.equal(g.isAre, "is");
  assert.equal(g.wasWere, "was");
}

// --- 3 mixed actors ---
{
  const actors: Actor[] = [
    { name: "Alice", gender: "F" },
    { name: "Bob", gender: "M" },
    { name: "Robin", gender: "X" },
  ];
  const g = actorGrammar(actors);
  assert.equal(g.count, 3);
  assert.equal(g.gender, "B");
  assert.equal(g.plural, "s");
  assert.equal(g.possessive, "s'");
  assert.equal(g.pronoun, "they");
  assert.equal(g.pronPoss, "their");
  assert.equal(g.verbS, "");
  assert.equal(g.hasHave, "have");
  assert.equal(g.allTheSole, "all the");
  assert.equal(g.isAre, "are");
  assert.equal(g.wasWere, "were");
}

// --- all-female (multiple) ---
{
  const g = actorGrammar([
    { name: "Alice", gender: "F" },
    { name: "Beth", gender: "F" },
  ]);
  assert.equal(g.gender, "F");
  assert.equal(g.plural, "s");
  assert.equal(g.possessive, "s'");
  assert.equal(g.pronoun, "they");
  assert.equal(g.pronPoss, "their");
  assert.equal(g.isAre, "are");
}

// --- single female ---
{
  const g = actorGrammar([{ name: "Jane Doe", gender: "F" }]);
  assert.equal(g.gender, "F");
  assert.equal(g.pronoun, "she");
  assert.equal(g.pronPoss, "her");
  assert.equal(g.verbS, "s");
  assert.equal(g.isAre, "is");
}

// --- all-male (multiple) ---
{
  const g = actorGrammar([
    { name: "Bob", gender: "M" },
    { name: "Carl", gender: "M" },
  ]);
  assert.equal(g.gender, "M");
  assert.equal(g.pronoun, "they");
  assert.equal(g.pronPoss, "their");
}

// --- 0 actors -> neutral they / plural defaults ---
{
  const g = actorGrammar([]);
  assert.equal(g.count, 0);
  assert.equal(g.gender, "N");
  assert.equal(g.plural, "");
  assert.equal(g.possessive, "s'");
  assert.equal(g.pronoun, "they");
  assert.equal(g.pronPoss, "their");
  assert.equal(g.verbS, "");
  assert.equal(g.hasHave, "have");
  assert.equal(g.allTheSole, "all the");
  assert.equal(g.isAre, "are");
  assert.equal(g.wasWere, "were");
}

// --- single org-named actor (isOrganization omitted, defaulted via name) ---
{
  const g = actorGrammar([{ name: "Acme Ltd." }]);
  assert.equal(g.count, 1);
  assert.equal(g.gender, "B");
  assert.equal(g.pronoun, "they");
  assert.equal(g.pronPoss, "their");
  assert.equal(g.possessive, "'s");
  assert.equal(g.verbS, "s");
  assert.equal(g.isAre, "is");
}

// --- explicit isOrganization flag forces neutral ---
{
  const g = actorGrammar([{ name: "Plain Name", isOrganization: true }]);
  assert.equal(g.gender, "B");
  assert.equal(g.pronoun, "they");
}

// --- looksLikeOrganization: positives ---
for (const positive of [
  "Acme Inc",
  "Acme Inc.",
  "Acme Ltd.",
  "Widgets LLC",
  "Smith LLP",
  "Northwind L.P.",
  "Acme Corp",
  "Acme Corporation",
  "Acme Co",
  "Acme Company",
  "Berlin GmbH",
  "British PLC",
  "Maple Leaf SOCIETY",
  "Some ASSOCIATION",
  "The FOUNDATION",
  "Farmers CO-OP",
  "Farmers COOP",
  "Workers COOPERATIVE",
  "Family TRUST",
  "Pension FUND",
  "Big HOLDINGS",
  "Law PARTNERSHIP",
  "Dewey & Co",
]) {
  assert.equal(looksLikeOrganization(positive), true, `expected org: ${positive}`);
}

// --- looksLikeOrganization: negatives (no substring false-positives) ---
for (const negative of ["Smithson", "Incognito", "Jane Doe", "Cohen", "Trustin", "Foundationer", "Companyman"]) {
  assert.equal(looksLikeOrganization(negative), false, `expected NOT org: ${negative}`);
}

console.log("OK nlg-grammar");
