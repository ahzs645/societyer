import assert from "node:assert/strict";
import {
  parseBylawSections,
  bylawSectionKey,
  alignBylawSections,
  diffBylawSections,
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

// --- diffBylawSections: a relocated, textually-unchanged section is "moved" ---
// Re-adding a cover page / moving the mission statement must NOT read as a
// whole-document rewrite — the section that only moved carries no edits.
const movedDiff = diffBylawSections(
  ["## Abstract", "Our mission.", "## Part 1", "Members.", "## Part 2", "Meetings."].join("\n"),
  ["## Part 1", "Members.", "## Part 2", "Meetings.", "## Abstract", "Our mission."].join("\n"),
);
const abstractDiff = movedDiff.find((d) => d.key === "abstract");
assert.equal(abstractDiff?.status, "moved", "relocated unchanged section is 'moved'");
assert.equal(abstractDiff?.chunks.length, 0, "moved section has no redline chunks");
assert.equal(abstractDiff?.adds, 0, "moved section has no additions");
// The sections that stayed put are unchanged, not moved.
assert.equal(movedDiff.find((d) => d.key === "part 1")?.status, "unchanged", "stationary section unchanged");

// --- diffBylawSections: a body edit is "changed" (not "moved") with a redline ---
const changedDiff = diffBylawSections(
  ["## Quorum", "Quorum is five members."].join("\n"),
  ["## Quorum", "Quorum is seven members."].join("\n"),
);
const quorum = changedDiff.find((d) => d.key === "quorum");
assert.equal(quorum?.status, "changed", "edited section is 'changed'");
assert.ok(quorum && (quorum.adds > 0 || quorum.dels > 0), "changed section has a redline");

// --- diffBylawSections: a moved AND edited section is "changed", not "moved" ---
const movedAndEdited = diffBylawSections(
  ["## Abstract", "Old mission.", "## Part 1", "Members."].join("\n"),
  ["## Part 1", "Members.", "## Abstract", "New mission."].join("\n"),
);
assert.equal(
  movedAndEdited.find((d) => d.key === "abstract")?.status,
  "changed",
  "a relocated section whose body also changed is 'changed' (substance wins)",
);

// --- diffBylawSections: added / removed sections ---
const addedRemoved = diffBylawSections("## Gone\nremoved.", "## Kept\nkept.");
assert.equal(addedRemoved.find((d) => d.key === "kept")?.status, "added", "new section added");
assert.equal(addedRemoved.find((d) => d.key === "gone")?.status, "removed", "dropped section removed");

// --- diffBylawSections: per-section guard trips only the oversized section ---
const big = "word ".repeat(2400);
const guarded = diffBylawSections(
  ["## Big", big, "## Small", "before."].join("\n"),
  ["## Big", `${big}extra`, "## Small", "after."].join("\n"),
  { maxCells: 1000 },
);
assert.equal(guarded.find((d) => d.key === "big")?.tooLarge, true, "oversized section flagged tooLarge");
assert.equal(guarded.find((d) => d.key === "small")?.tooLarge, false, "small sibling still diffs");
assert.ok((guarded.find((d) => d.key === "small")?.chunks.length ?? 0) > 0, "small sibling has a redline");

console.log("bylaw section parser checks passed");
