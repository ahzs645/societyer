import assert from "node:assert/strict";
import {
  nameAsOf,
  currentName,
  nameTimeline,
  nameChangeNarrative,
  type NameRecord,
} from "../shared/nameHistory.ts";

const original: NameRecord = {
  name: "YCN Software Inc.",
  shortName: "YCN",
  startISO: "2000-08-08",
  regPosn: 1,
};

const renamed: NameRecord = {
  name: "YCN Software International Inc.",
  shortName: "YCN International",
  startISO: "2008-08-08",
  regPosn: 2,
};

const twoNames: NameRecord[] = [renamed, original]; // intentionally unsorted

// nameAsOf: before any name has started → null.
assert.equal(nameAsOf(twoNames, "1999-01-01"), null);
assert.equal(nameAsOf([], "2020-01-01"), null);

// nameAsOf: present at the exact startISO boundary.
assert.equal(nameAsOf(twoNames, "2000-08-08"), original);
assert.equal(nameAsOf(twoNames, "2008-08-08"), renamed);

// nameAsOf: the day before the change still resolves to the original.
assert.equal(nameAsOf(twoNames, "2008-08-07"), original);

// nameAsOf: well after the change resolves to the renamed record.
assert.equal(nameAsOf(twoNames, "2025-01-01"), renamed);

// currentName: nameAsOf at "now".
assert.equal(currentName(twoNames, "2026-06-25"), renamed);
assert.equal(currentName(twoNames, "2005-06-25"), original);

// nameTimeline: ascending by startISO.
const timeline = nameTimeline(twoNames);
assert.deepEqual(
  timeline.map((record) => record.name),
  ["YCN Software Inc.", "YCN Software International Inc."],
);

// nameTimeline: tie-break on regPosn at identical startISO.
const sameStart: NameRecord[] = [
  { name: "Second", startISO: "2010-01-01", regPosn: 5 },
  { name: "First", startISO: "2010-01-01", regPosn: 1 },
];
assert.deepEqual(
  nameTimeline(sameStart).map((record) => record.name),
  ["First", "Second"],
);

// nameChangeNarrative: two-name history.
assert.equal(
  nameChangeNarrative(twoNames),
  "Formerly 'YCN Software Inc.' (from 2000-08-08); changed to 'YCN Software International Inc.' on 2008-08-08.",
);

// nameChangeNarrative: three-name history uses "renamed to" then "changed to".
const threeNames: NameRecord[] = [
  { name: "Alpha", startISO: "2001-01-01", regPosn: 1 },
  { name: "Beta", startISO: "2005-01-01", regPosn: 2 },
  { name: "Gamma", startISO: "2009-01-01", regPosn: 3 },
];
assert.equal(
  nameChangeNarrative(threeNames),
  "Formerly 'Alpha' (from 2001-01-01); renamed to 'Beta' on 2005-01-01; changed to 'Gamma' on 2009-01-01.",
);

// nameChangeNarrative: empty for zero or one name.
assert.equal(nameChangeNarrative([]), "");
assert.equal(nameChangeNarrative([original]), "");

console.log("OK name-history");
