import assert from "node:assert/strict";
import {
  parseBylawSections,
  bylawSectionKey,
  alignBylawSections,
} from "../src/lib/bylawSections";

// --- bylawSectionKey ---
assert.equal(bylawSectionKey("## Part 1: Membership"), "membership", "strips md + part prefix");
assert.equal(bylawSectionKey("Section 4. Quorum"), "quorum", "strips section number");
assert.equal(bylawSectionKey("4.2 Voting Rights"), "voting rights", "strips numeric prefix");
assert.equal(bylawSectionKey(""), "preamble", "empty -> preamble");

// --- parseBylawSections ---
const doc = [
  "Society Mission Statement",
  "We advance community wellbeing.",
  "",
  "## Part 1: Membership",
  "Membership is open to all.",
  "",
  "## Part 2: Meetings",
  "The AGM is held annually.",
].join("\n");
const sections = parseBylawSections(doc);
assert.equal(sections.length, 3, "preamble + 2 parts");
assert.equal(sections[0].level, 0, "preamble is level 0");
assert.equal(sections[0].body, "Society Mission Statement\nWe advance community wellbeing.", "preamble body");
assert.equal(sections[1].key, "membership", "part 1 key");
assert.equal(sections[2].key, "meetings", "part 2 key");
assert.equal(sections[1].body, "Membership is open to all.", "part 1 body excludes heading");

// Empty / whitespace text yields no sections.
assert.deepEqual(parseBylawSections("   \n  "), [], "blank -> no sections");

// --- alignBylawSections: re-ordering a section must NOT read as a full rewrite ---
const v1 = parseBylawSections(["## Abstract", "Old abstract.", "## Part 1", "Body one."].join("\n"));
const v2 = parseBylawSections(["## Part 1", "Body one.", "## Abstract", "New abstract."].join("\n"));
const aligned = alignBylawSections(v1, v2);
const part1 = aligned.find((p) => p.key === "part 1");
assert.ok(part1?.base && part1?.next, "Part 1 aligns across reorder");
assert.equal(part1!.base!.body, part1!.next!.body, "Part 1 body unchanged despite reorder");
const abstract = aligned.find((p) => p.key === "abstract");
assert.ok(abstract?.base && abstract?.next, "Abstract aligns across reorder");
assert.notEqual(abstract!.base!.body, abstract!.next!.body, "Abstract body genuinely changed");

// --- alignBylawSections: added/removed sections ---
const removedPair = alignBylawSections(
  parseBylawSections("## Gone\nremoved."),
  parseBylawSections("## Kept\nkept."),
);
assert.ok(removedPair.find((p) => p.key === "kept" && p.next && !p.base), "added section");
assert.ok(removedPair.find((p) => p.key === "gone" && p.base && !p.next), "removed section");

console.log("bylaw section parser checks passed");
