/** Section text written by earlier imports joins table cells with " | ". The minutes column and
 * the exports render those rows as tables (splitPipeTables); stored text never changes and still
 * round-trips through parseSourceMeetingBlocks. Synthetic text only. */
import assert from "node:assert/strict";
import { parseSourceMeetingBlocks, sourceMeetingBlockText, splitPipeTables } from "../shared/sourceMeetingRecord";

const text = "Item | Discussion | Action/WHO\n1. Budget | Draft budget reviewed; no changes | Treasurer to circulate\n2. Grants | Two applications open | ED\nThe Chair thanked the committee.";
const segments = splitPipeTables(text);
assert.equal(segments.length, 2);
assert.deepEqual(segments[0], { kind: "table", header: true, rows: [["Item", "Discussion", "Action/WHO"], ["1. Budget", "Draft budget reviewed; no changes", "Treasurer to circulate"], ["2. Grants", "Two applications open", "ED"]] });
assert.deepEqual(segments[1], { kind: "text", text: "The Chair thanked the committee." });
// One "A | B" line in prose stays prose; a lone three-cell row is a (header-less) table.
assert.deepEqual(splitPipeTables("Next Board | Exec meeting: June 11"), [{ kind: "text", text: "Next Board | Exec meeting: June 11" }]);
assert.equal((splitPipeTables("Ops | June 4 | Kim")[0] as any).header, false);
// Ragged rows are padded; prose without pipes is untouched.
assert.deepEqual((splitPipeTables("A | B | C\nD | E")[0] as any).rows[1], ["D", "E", ""]);
assert.deepEqual(splitPipeTables("No tables here.\nSecond line."), [{ kind: "text", text: "No tables here.\nSecond line." }]);
// Stored records keep round-tripping: block text still joins cells with " | ".
const blocks = parseSourceMeetingBlocks(text);
assert.equal(blocks[0].kind, "table");
assert.equal(sourceMeetingBlockText(blocks[0]).split("\n")[0], "Item | Discussion | Action/WHO");
console.log("PASS source pipe tables: pipe-joined rows render as tables (header detected, prose kept), stored text unchanged");
