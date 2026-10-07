/** Gate for the desktop intake bridge (electron/intake.ts) and the browser-side
 * helpers it feeds: folder listing skips symlinks and keeps relative paths,
 * reads never leave the chosen folder, the TextDecoder iconv shim decodes the
 * code pages Outlook .msg files use, and highlight matching tolerates bullets,
 * split PDF items and repeated quotes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listIntakeFolder, readFileInFolder, resolveIntakePath } from "../electron/intakeFiles";
import { decode, encode, encodingExists } from "../src/lib/iconvLiteBrowser";
import { findQuote, normalizeWithMap, quoteNeedles } from "../src/features/intake/highlight";
import { selectionFromFileList, summarizeSelection } from "../src/features/intake/collectFiles";

// Folder listing and scoped reads.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-desktop-"));
fs.mkdirSync(path.join(root, "2021", "Board"), { recursive: true });
fs.writeFileSync(path.join(root, "2021", "Board", "minutes.docx"), "x");
fs.writeFileSync(path.join(root, ".DS_Store"), "");
fs.symlinkSync("/etc", path.join(root, "outside"));
const listed = await listIntakeFolder(root);
assert.deepEqual(listed.map((entry) => entry.relativePath).sort(), [".DS_Store", "2021/Board/minutes.docx"], "symlinks are skipped; paths are relative with forward slashes");
assert.equal(resolveIntakePath(root, "2021/Board/minutes.docx"), path.join(root, "2021", "Board", "minutes.docx"));
assert.throws(() => resolveIntakePath(root, "../secrets.txt"), /outside the chosen intake folder/);
assert.throws(() => resolveIntakePath(root, "/etc/passwd"), /outside the chosen intake folder/);
assert.throws(() => resolveIntakePath(root, ""), /outside the chosen intake folder/);
assert.equal((await listIntakeFolder(root, 1)).length, 1, "listing is bounded");
assert.equal(new TextDecoder().decode(await readFileInFolder(root, "2021/Board/minutes.docx")), "x");
await assert.rejects(() => readFileInFolder(root, "outside/hosts"), /outside the chosen intake folder/, "a symlinked directory cannot lead outside the folder");
await assert.rejects(() => readFileInFolder(root, "../../etc/hosts"), /outside the chosen intake folder/);
fs.rmSync(root, { recursive: true, force: true });

// iconv-lite stand-in for the browser .msg reader.
assert.equal(decode(new Uint8Array([0x48, 0x00, 0x69, 0x00]), "utf16le"), "Hi");
// Browsers map 0x93/0x94 to curly quotes (WHATWG windows-1252); small-ICU Node builds decode them as Latin-1.
assert.ok(["“Q”", "\x93Q\x94"].includes(decode(new Uint8Array([0x93, 0x51, 0x94]), "cp1252")));
assert.equal(decode(new Uint8Array([0xe9]), "windows1252"), "é");
assert.deepEqual([...encode("Hi", "utf16le")], [0x48, 0, 0x69, 0]);
assert.equal(encodingExists("cp1252"), true);

// Highlight matching.
assert.equal(normalizeWithMap("•  Motion\tCarried").text, "motion carried", "bullets dropped, whitespace collapsed");
assert.ok(quoteNeedles("• MOTION: To adopt the agenda (Carried)").includes("motion: to adopt the agenda (carried)"));
const page = "Present: Avery Quill, Jordan Pike. Motion to receive the statements made by Avery Quill, seconded by Jordan Pike (Carried)";
const [start] = findQuote(page, "Avery Quill", "Motion to receive the statements made by Avery Quill, seconded by Jordan Pike (Carried)")!;
assert.ok(start > page.indexOf("Motion"), "the locator's cell text picks the right occurrence of a repeated name");
assert.equal(findQuote(page, "Avery Quill")![0], page.indexOf("Avery Quill"));
assert.equal(findQuote("Oct 12th 2021 (12:00", "Oct 12th 2021")?.[0], 0);
assert.equal(findQuote("nothing here", "missing quote"), null);

// File selection summary (junk filter preview).
const fakeFile = (name: string, size = 10) => ({ name, size, type: "", lastModified: 0, webkitRelativePath: `Folder/${name}` }) as unknown as File;
const selection = selectionFromFileList([fakeFile("minutes.docx"), fakeFile("._minutes.docx", 1), fakeFile(".DS_Store", 0), fakeFile("photo.jpg"), fakeFile("budget.xlsx")], "local_folder");
assert.equal(selection.root, "Folder");
const summary = summarizeSelection(selection);
assert.equal(summary.files, 5);
assert.equal(summary.extract, 2);
assert.equal(summary.junk, 2);
assert.equal(summary.catalogue, 1);

console.log("PASS intake desktop/browser helpers: scoped folder reads, iconv shim, quote highlighting and the junk-filter preview");
