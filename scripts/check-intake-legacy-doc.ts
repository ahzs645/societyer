/** Gate for reading Word 97–2003 (.doc) without LibreOffice (browser intake): the
 * compound file and piece table are read, field codes dropped and results kept,
 * Windows-1252 punctuation decoded, table rows ended by their row marks, list
 * paragraphs typed, and the minutes extractor finds the meeting on the result.
 * The fixture is synthetic (scripts/lib/legacy-doc-fixture.ts). */
import assert from "node:assert/strict";
import { extractBytes } from "../shared/intake/extract";
import { docTextToBlocks, extractDoc, readCompoundStreams } from "../shared/intake/extract/doc";
import { finalizeBlocks } from "../shared/intake/blocks";
import { extractMeetingMinutes } from "../shared/intake/minutes/extractMinutes";
import { buildLegacyDoc } from "./lib/legacy-doc-fixture";

const bytes = buildLegacyDoc([
  { text: "Lakeside Clean Air Society – Board of Directors Minutes" },
  { text: "Date: May 13, 2025 (5:00 PM – 6:30 PM)" },
  { text: "Location: Northport Civic Centre, Committee Room" },
  { text: "Present: Avery Quill, Robin Vale, Jordan Pike" },
  { text: "Page \x13 PAGE \\* MERGEFORMAT \x141\x15 of the minutes" },
  { text: "Call meeting to order (A. Quill)", listLevel: 0 },
  { text: "Meeting called to order by the Chair at 5:02 PM." },
  { text: "Item", mark: "\x07" }, { text: "Discussion", mark: "\x07" }, { text: "", mark: "\x07", rowEnd: true },
  { text: "Budget", mark: "\x07" }, { text: "", mark: "\x07" }, { text: "", mark: "\x07", rowEnd: true },
  { text: "MOTION: That the 2025 budget be approved. Moved by Robin Vale, seconded by Jordan Pike. CARRIED." },
  { text: "Meeting adjourned at 6:30 PM." },
]);

const streams = readCompoundStreams(bytes);
assert.ok(streams.has("WordDocument") && streams.has("1Table"), "compound file streams are read");
const extract = extractDoc(bytes);
assert.equal(extract.method, "doc-binary");
assert.ok(extract.text.includes("Lakeside Clean Air Society – Board of Directors Minutes"), "Windows-1252 en dash decoded");
assert.ok(extract.text.includes("Page 1 of the minutes"), "field result kept");
assert.ok(!extract.text.includes("MERGEFORMAT"), "field instruction dropped");
const table = extract.blocks.find((block) => block.kind === "table");
assert.ok(table, "cells become a table block");
assert.deepEqual(table!.rows!.map((row) => row.cells.map((cell) => cell.text)), [["Item", "Discussion"], ["Budget", ""]], "row marks end rows exactly, an empty cell does not");
const list = extract.blocks.find((block) => block.kind === "list_item");
assert.equal(list?.text, "Call meeting to order (A. Quill)", "list paragraphs are typed as list items");
assert.ok(extract.warnings.some((warning) => /LibreOffice/.test(warning)));

// Without paragraph properties, an empty mark straight after a cell ends the row (heuristic).
const heuristic = finalizeBlocks(docTextToBlocks("Intro\rA\x07B\x07\x07C\x07D\x07\x07After\r"));
assert.deepEqual(heuristic.blocks.find((block) => block.kind === "table")!.rows!.map((row) => row.cells.map((cell) => cell.text)), [["A", "B"], ["C", "D"]]);
assert.equal(heuristic.blocks.at(-1)!.text, "After");
// A row with fewer cells (merged header) spans to the table width so column roles line up.
const merged = finalizeBlocks(docTextToBlocks("Agenda item\x07Discussion\x07\x071.\x07Welcome\x07Opened.\x07\x07"));
const mergedRows = merged.blocks[0].rows!;
assert.equal(mergedRows[0].cells[0].colSpan, 2);
assert.equal(mergedRows[0].cells[1].cell, "R1C3");

// The dispatcher reads .doc directly when no LibreOffice converter is injected (browser) …
const dispatched = await extractBytes("2025-05-13 Board Minutes.doc", bytes);
assert.equal(dispatched.method, "doc-binary");
// … and falls back to it when the converter fails.
const fallback = await extractBytes("2025-05-13 Board Minutes.doc", bytes, { convertLegacy: async () => null });
assert.equal(fallback.method, "doc-binary");
// RTF saved under a .doc name, and a non-Word file, are handled without throwing.
const rtf = await extractBytes("letter.doc", new TextEncoder().encode("{\\rtf1\\ansi Hello {\\b world}}"));
assert.ok(rtf.text.includes("Hello"));
const garbage = await extractBytes("broken.doc", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
assert.equal(garbage.method, "unsupported");
assert.ok(/could not be read without LibreOffice/.test(garbage.warnings[0]));

// The minutes extractor works on the direct read.
const minutes: any = extractMeetingMinutes({ fileId: "local:minutes.doc", fileName: "2025-05-13 Board Minutes.doc", extract }).record;
assert.equal(minutes.date.value.iso, "2025-05-13");
assert.equal(minutes.body.value, "board");
assert.ok(minutes.motions.length >= 1 && /budget/i.test(minutes.motions[0].text.value), "the motion is found");
assert.ok(minutes.attendance.length >= 3, "attendance is found");

console.log(`PASS intake legacy .doc: compound file, piece table, fields, Windows-1252, exact table rows and list items read without LibreOffice; minutes extracted (${minutes.motions.length} motion, ${minutes.attendance.length} attendees)`);
