// XLSX writer gate (src/lib/xlsx). Writes sample workbooks to a temp dir,
// unzips them, parses every XML part with a strict well-formedness checker and
// asserts the package structure, cell types, styles, escaping, date serials
// (including Excel's 1900 leap-year bug), currency formats, sheet-name
// sanitising and formula-injection safety. When python3 + openpyxl, xmllint or
// LibreOffice are installed, the files are also round-tripped through them
// (each is skipped, with a note, when missing).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createElement } from "react";
import { writeXlsx } from "../src/lib/xlsx/writer";
import { buildXlsxParts, columnLetter } from "../src/lib/xlsx/build";
import { excelDateSerial, excelSerialForDate, excelSerialForDateTime } from "../src/lib/xlsx/dates";
import { sanitizeSheetName, uniqueSheetNames } from "../src/lib/xlsx/sheetNames";
import { accountingFormat, currencyFormat } from "../src/lib/xlsx/numberFormats";
import { cleanCellText, escapeXml } from "../src/lib/xlsx/xml";
import { sheetFromCsv } from "../src/lib/xlsx/csvSheet";
import { nodeText, reportTableSheet } from "../src/lib/xlsx/reportSheet";
import { xlsxFileName } from "../src/lib/xlsx/index";
import type { XlsxWorkbook } from "../src/lib/xlsx/types";

let passed = 0;
function ok(message: string) {
  passed += 1;
  console.log(`✓ ${message}`);
}

// ------------------------------------------------- strict XML well-formedness --

type XmlElement = { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string };

const NAME = /^[A-Za-z_][\w.\-]*(:[A-Za-z_][\w.\-]*)?$/;
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function decodeEntities(text: string, where: string): string {
  return text.replace(/&([^;&\s]*);?/g, (match, body: string) => {
    assert.ok(match.endsWith(";"), `${where}: unterminated entity "${match}"`);
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const numeric = /^#(\d+)$|^#x([0-9a-fA-F]+)$/.exec(body);
    assert.ok(numeric, `${where}: unknown entity "&${body};"`);
    return String.fromCodePoint(numeric[1] ? Number(numeric[1]) : parseInt(numeric[2], 16));
  });
}

/** A strict parser for the XML subset OOXML uses; throws on anything malformed. */
function parseXml(xml: string, part: string): XmlElement {
  assert.ok(!ILLEGAL.test(xml), `${part}: contains a character illegal in XML`);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(xml), `${part}: unpaired surrogate`);
  let index = 0;
  if (xml.startsWith("<?xml")) {
    const end = xml.indexOf("?>");
    assert.ok(end > 0, `${part}: unterminated XML declaration`);
    assert.match(xml.slice(0, end), /^<\?xml version="1\.0" encoding="UTF-8"( standalone="yes")?$/, `${part}: XML declaration`);
    index = end + 2;
  }
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  while (index < xml.length) {
    const lt = xml.indexOf("<", index);
    const text = xml.slice(index, lt === -1 ? xml.length : lt);
    if (text) {
      assert.ok(!text.includes(">") || true, "");
      const decoded = decodeEntities(text, part);
      if (stack.length) stack[stack.length - 1].text += decoded;
      else assert.ok(!decoded.trim(), `${part}: text outside the root element`);
    }
    if (lt === -1) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      assert.ok(end > 0, `${part}: unterminated comment`);
      index = end + 3;
      continue;
    }
    assert.ok(!xml.startsWith("<!", lt) && !xml.startsWith("<?", lt), `${part}: unexpected markup at ${lt}`);
    const gt = xml.indexOf(">", lt);
    assert.ok(gt > 0, `${part}: unterminated tag at ${lt}`);
    const tag = xml.slice(lt + 1, gt);
    index = gt + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      assert.ok(open, `${part}: closing </${name}> with nothing open`);
      assert.equal(name, open.name, `${part}: </${name}> closes <${open.name}>`);
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    assert.ok(nameMatch && NAME.test(nameMatch[1]), `${part}: bad element name in <${tag}>`);
    const element: XmlElement = { name: nameMatch[1], attrs: {}, children: [], text: "" };
    let rest = body.slice(nameMatch[1].length);
    const attr = /^\s+([^\s=]+)="([^"<]*)"/;
    for (;;) {
      const match = attr.exec(rest);
      if (!match) break;
      assert.ok(NAME.test(match[1]), `${part}: bad attribute name ${match[1]}`);
      assert.ok(!(match[1] in element.attrs), `${part}: duplicate attribute ${match[1]} on <${element.name}>`);
      element.attrs[match[1]] = decodeEntities(match[2], part);
      rest = rest.slice(match[0].length);
    }
    assert.ok(!rest.trim(), `${part}: malformed attributes in <${tag}>`);
    if (stack.length) stack[stack.length - 1].children.push(element);
    else {
      assert.ok(!root, `${part}: more than one root element`);
      root = element;
    }
    if (!selfClosing) stack.push(element);
  }
  assert.equal(stack.length, 0, `${part}: unclosed <${stack[stack.length - 1]?.name}>`);
  assert.ok(root, `${part}: no root element`);
  return root;
}

function find(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    if (node.name === name) out.push(node);
    node.children.forEach(walk);
  };
  walk(element);
  return out;
}

// The checker itself must reject what Excel would.
for (const bad of ["<a><b></a></b>", "<a x='1'/>", "<a>&nbsp;</a>", '<a x="1" x="2"/>', "<a/><b/>", "<a>\u0001</a>", "<a>&amp</a>"]) {
  assert.throws(() => parseXml(bad, "self-test"), undefined, `checker rejects ${JSON.stringify(bad)}`);
}
parseXml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a b="&lt;&amp;&quot;"><c>&#x41;&#66;</c></a>', "self-test");
ok("strict XML checker rejects mismatched tags, bad quoting, unknown entities, duplicates, illegal characters");

// --------------------------------------------------------------- unit checks --

assert.equal(excelDateSerial(1900, 1, 1), 1);
assert.equal(excelDateSerial(1900, 2, 28), 59);
assert.equal(excelDateSerial(1900, 2, 29), null, "1900-02-29 never existed");
assert.equal(excelDateSerial(1900, 3, 1), 61, "1900 leap-year bug: serial 60 is skipped");
assert.equal(excelDateSerial(1970, 1, 1), 25569);
assert.equal(excelDateSerial(2000, 1, 1), 36526);
assert.equal(excelDateSerial(2024, 2, 29), 45351);
assert.equal(excelDateSerial(2026, 10, 14), 46309);
assert.equal(excelDateSerial(9999, 12, 31), 2958465);
assert.equal(excelDateSerial(1899, 12, 31), null, "dates before 1900 have no serial");
assert.equal(excelDateSerial(2026, 2, 30), null, "invalid days are rejected");
assert.equal(excelSerialForDate("2026-10-14"), 46309);
assert.equal(excelSerialForDate("2026-10-14T23:59:00Z"), 46309, "date-only columns ignore the time part");
assert.equal(excelSerialForDate("14/10/2026"), null);
assert.equal(excelSerialForDate(new Date(2026, 9, 14, 23, 30)), 46309, "a Date's local calendar day");
assert.equal(excelSerialForDateTime(new Date(2026, 0, 1, 12, 0, 0)), 46023.5);
assert.equal(excelSerialForDateTime(new Date(2026, 0, 1, 6, 0, 0).getTime()), 46023.25);
assert.equal(excelSerialForDateTime("2026-01-01"), 46023);
assert.equal(excelSerialForDateTime("not a date"), null);
ok("date serials: 1900-01-01 = 1, 1900-03-01 = 61 (leap-year bug), known anchors, local wall-clock times, invalid → null");

assert.equal(sanitizeSheetName("Q1: Budget/Actual [draft]?*\\"), "Q1 Budget Actual draft");
assert.equal(sanitizeSheetName("A very long sheet name that goes past the Excel limit").length, 31);
assert.equal(sanitizeSheetName("'quoted'"), "quoted");
assert.equal(sanitizeSheetName("   "), "Sheet");
assert.equal(sanitizeSheetName("History"), "History sheet", "History is reserved by Excel");
assert.equal(sanitizeSheetName("😀".repeat(20)).length <= 31, true);
assert.ok(!/[\uD800-\uDBFF]$/.test(sanitizeSheetName(`${"x".repeat(30)}😀`)), "truncation never leaves a lone surrogate");
const unique = uniqueSheetNames(["Members", "members", "Members", "", "x".repeat(40), "x".repeat(40)]);
assert.deepEqual(unique.slice(0, 4), ["Members", "members (2)", "Members (3)", "Sheet4"]);
assert.equal(new Set(unique.map((name) => name.toLowerCase())).size, unique.length);
assert.ok(unique.every((name) => name.length <= 31 && !/[[\]:*?/\\]/.test(name)));
assert.ok(unique[5].endsWith(" (2)") && unique[5].length === 31);
ok("sheet names: forbidden characters removed, ≤ 31 characters, no edge apostrophes, History avoided, unique case-insensitively");

assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
assert.equal(cleanCellText("a\u0000b\u0007c\u000Bd\tok\nfine￾"), "abcd\tok\nfine");
assert.equal(cleanCellText("lone \uD800 surrogate"), "lone  surrogate");
assert.equal(cleanCellText("x".repeat(40000)).length, 32767);
ok("XML escaping, illegal-character stripping and the 32,767-character cell limit");

assert.equal(currencyFormat("CAD"), '"$"#,##0.00;[Red]-"$"#,##0.00');
assert.equal(currencyFormat("USD"), '"US$"#,##0.00;[Red]-"US$"#,##0.00');
assert.equal(currencyFormat("JPY"), '"JP¥"#,##0;[Red]-"JP¥"#,##0', "zero-decimal currencies");
assert.equal(accountingFormat("CAD"), '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)', "matches Excel's built-in accounting format");
assert.equal(xlsxFileName('Members: "Active" 2026-10-14.csv'), "Members Active 2026-10-14.xlsx");
assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(columnLetter), ["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
ok("currency and accounting number formats (CAD as $, others unambiguous), file names, column letters");

// ------------------------------------------------------------ sample workbook --

const INJECTIONS = ["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "=HYPERLINK(\"http://evil\")"];
const created = new Date(Date.UTC(2026, 9, 14, 15, 30, 0));
const sample: XlsxWorkbook = {
  title: "Sample & <export>",
  created,
  sheets: [
    {
      name: "Members: active/2026",
      columns: [
        { header: "Name", type: "text" },
        { header: "Dues", type: "currency", currency: "CAD" },
        { header: "Count", type: "number" },
        { header: "Joined", type: "date" },
        { header: "Updated", type: "datetime" },
        { header: "Active", type: "boolean" },
        { header: "Share", type: "percent" },
        { header: "Balance", type: "accounting", cents: true },
      ],
      rows: [
        ["Ada <Lovelace> & \"Co\"", 125.5, 3, "2026-10-14", new Date(2026, 0, 1, 12, 0, 0), true, 0.125, -123456],
        ["Bob\u0007 Control", -40, 0, "1899-12-31", null, false, 1, 0],
        ["  padded  ", "12.50", "n/a", "not-a-date", "", "maybe", null, { value: 5000, currency: "USD" }],
        ...INJECTIONS.map((text) => [text, null, null, null, null, null, null, null]),
      ],
    },
    { name: "members", columns: [{ header: "Only" }], rows: [["dup name"]] },
    { name: "History", columns: [], rows: [] },
    {
      name: "Statement",
      title: ["Balance sheet", "As at 2026-10-14"],
      autoFilter: false,
      columns: [{ header: "Account" }, { header: "Amount", type: "accounting", cents: true }],
      rows: [
        { style: "section", cells: ["Assets"] },
        [{ value: "Chequing", indent: 1 }, 150000],
        { style: "subtotal", cells: ["Total assets", 150000] },
        { style: "total", cells: ["Net assets", -2500] },
      ],
    },
  ],
};

const dir = mkdtempSync(path.join(tmpdir(), "societyer-xlsx-"));
const samplePath = path.join(dir, "sample.xlsx");
const bytes = await writeXlsx(sample);
writeFileSync(samplePath, bytes);
assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK", "a zip file");

const zip = await JSZip.loadAsync(bytes);
const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
assert.equal(names[0], "[Content_Types].xml", "content types is the first entry");
const parts: Record<string, XmlElement> = {};
const raw: Record<string, string> = {};
for (const name of names) {
  raw[name] = await zip.file(name)!.async("string");
  parts[name] = parseXml(raw[name], name);
}
ok(`every part of the package parses strictly (${names.length} parts)`);

const expected = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "docProps/app.xml",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/sharedStrings.xml",
  "xl/worksheets/sheet1.xml",
  "xl/worksheets/sheet2.xml",
  "xl/worksheets/sheet3.xml",
  "xl/worksheets/sheet4.xml",
];
assert.deepEqual([...names].sort(), [...expected].sort());
const overrides = new Map(find(parts["[Content_Types].xml"], "Override").map((node) => [node.attrs.PartName, node.attrs.ContentType]));
for (const name of names.filter((name) => name.endsWith(".xml") && name !== "[Content_Types].xml")) {
  assert.ok(overrides.has(`/${name}`), `content type override for ${name}`);
}
assert.equal(overrides.get("/xl/workbook.xml"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
assert.ok(find(parts["[Content_Types].xml"], "Default").some((node) => node.attrs.Extension === "rels"));
const rootRels = find(parts["_rels/.rels"], "Relationship");
for (const rel of rootRels) assert.ok(names.includes(rel.attrs.Target), `root relationship target ${rel.attrs.Target} exists`);
const wbRels = find(parts["xl/_rels/workbook.xml.rels"], "Relationship");
for (const rel of wbRels) assert.ok(names.includes(`xl/${rel.attrs.Target}`), `workbook relationship target ${rel.attrs.Target} exists`);
const relIds = new Set(wbRels.map((rel) => rel.attrs.Id));
const sheets = find(parts["xl/workbook.xml"], "sheet");
assert.ok(sheets.every((sheet) => relIds.has(sheet.attrs["r:id"])), "every sheet points at a relationship");
assert.deepEqual(
  sheets.map((sheet) => sheet.attrs.name),
  ["Members active 2026", "members", "History sheet", "Statement"],
);
assert.equal(new Set(sheets.map((sheet) => sheet.attrs.sheetId)).size, sheets.length);
assert.ok(!raw["xl/workbook.xml"].includes("date1904"), "1900 date system");
ok("package structure: content types, relationships, workbook sheets and ids all consistent");

const core = parts["docProps/core.xml"];
assert.equal(find(core, "dc:title")[0].text, "Sample & <export>");
assert.equal(find(core, "dcterms:created")[0].text, "2026-10-14T15:30:00Z");
assert.equal(find(core, "dc:creator")[0].text, "Societyer");
assert.equal(find(parts["docProps/app.xml"], "vt:lpstr").length, 1 + sheets.length);
ok("core properties carry the title and creation date; app properties list the sheets");

// Styles.
const styles = parts["xl/styles.xml"];
const numFmts = new Map(find(styles, "numFmt").map((node) => [Number(node.attrs.numFmtId), node.attrs.formatCode]));
const xfs = find(find(styles, "cellXfs")[0], "xf");
assert.equal(Number(find(styles, "cellXfs")[0].attrs.count), xfs.length);
assert.equal(Number(find(styles, "numFmts")[0].attrs.count), numFmts.size);
assert.ok([...numFmts.keys()].every((id) => id >= 164), "custom number formats use ids ≥ 164");
const formatOf = (s: string | undefined) => {
  const xf = xfs[Number(s ?? 0)];
  const id = Number(xf.attrs.numFmtId);
  return numFmts.get(id) ?? `builtin:${id}`;
};
const boldOf = (s: string | undefined) => xfs[Number(s ?? 0)].attrs.fontId !== "0";
ok("styles: counts match, custom formats ≥ 164");

// Shared strings.
const sst = parts["xl/sharedStrings.xml"];
const strings = find(sst, "si").map((si) => find(si, "t").map((t) => t.text).join(""));
assert.equal(Number(sst.attrs.uniqueCount), strings.length);
assert.ok(strings.includes('Ada <Lovelace> & "Co"'), "markup characters round-trip through escaping");
assert.ok(strings.includes("Bob Control"), "control characters stripped");
assert.ok(strings.includes("  padded  "), "surrounding whitespace preserved");
assert.ok(raw["xl/sharedStrings.xml"].includes('<t xml:space="preserve">  padded  </t>'));
ok("shared strings: escaping, control characters stripped, whitespace preserved");

// Sheet 1 cells.
const sheet1 = parts["xl/worksheets/sheet1.xml"];
const cells = new Map(find(sheet1, "c").map((c) => [c.attrs.r, c]));
const valueOf = (ref: string) => find(cells.get(ref)!, "v")[0]?.text;
const textOf = (ref: string) => {
  const cell = cells.get(ref)!;
  assert.equal(cell.attrs.t, "s", `${ref} is a shared string`);
  return strings[Number(valueOf(ref))];
};
assert.equal(find(sheet1, "f").length, 0, "no formulas anywhere");
assert.ok(!raw["xl/worksheets/sheet1.xml"].includes("<f>") && !raw["xl/worksheets/sheet1.xml"].includes("<f "));
// Header.
for (const ref of ["A1", "B1", "H1"]) assert.ok(boldOf(cells.get(ref)!.attrs.s), `${ref} header is bold`);
assert.equal(textOf("B1"), "Dues");
// Row 2: typed values.
assert.equal(textOf("A2"), 'Ada <Lovelace> & "Co"');
assert.equal(cells.get("B2")!.attrs.t, undefined, "currency is a number cell");
assert.equal(valueOf("B2"), "125.5");
assert.equal(formatOf(cells.get("B2")!.attrs.s), '"$"#,##0.00;[Red]-"$"#,##0.00');
assert.equal(valueOf("C2"), "3");
assert.equal(formatOf(cells.get("C2")!.attrs.s), "builtin:0");
assert.equal(valueOf("D2"), "46309", "date as a serial");
assert.equal(formatOf(cells.get("D2")!.attrs.s), "yyyy-mm-dd");
assert.equal(valueOf("E2"), "46023.5", "date-time as a serial with a time fraction");
assert.equal(formatOf(cells.get("E2")!.attrs.s), "yyyy-mm-dd hh:mm");
assert.equal(cells.get("F2")!.attrs.t, "b");
assert.equal(valueOf("F2"), "1");
assert.equal(valueOf("G2"), "0.125");
assert.equal(formatOf(cells.get("G2")!.attrs.s), "0.0%");
assert.equal(valueOf("H2"), "-1234.56", "cents column divided by 100, sign kept");
assert.equal(formatOf(cells.get("H2")!.attrs.s), accountingFormat("CAD"));
// Row 3.
assert.equal(valueOf("B3"), "-40", "negative currency stays a signed number");
assert.equal(textOf("D3"), "1899-12-31", "pre-1900 date kept as text");
assert.ok(!cells.has("E3"), "empty cell omitted");
assert.equal(valueOf("F3"), "0");
assert.equal(valueOf("H3"), "0");
// Row 4: coercion.
assert.equal(valueOf("B4"), "12.5", "numeric strings become numbers");
assert.equal(textOf("C4"), "n/a", "non-numeric text in a number column stays text");
assert.equal(textOf("D4"), "not-a-date");
assert.equal(textOf("F4"), "maybe");
assert.equal(valueOf("H4"), "50");
assert.equal(formatOf(cells.get("H4")!.attrs.s), accountingFormat("USD"), "per-cell currency");
ok("cells: text, currency, number, date and date-time serials, booleans, percent, accounting cents, empties and coercion");

INJECTIONS.forEach((text, index) => {
  const ref = `A${5 + index}`;
  assert.equal(textOf(ref), text, `${text} kept verbatim as text`);
  const xf = xfs[Number(cells.get(ref)!.attrs.s)];
  assert.equal(xf.attrs.quotePrefix, "1", `${text} carries a quote prefix so re-editing keeps it text`);
});
ok("formula injection: =, +, -, @ text is a string cell with a quote prefix, never a formula");

// Freeze, filter, widths.
const pane = find(sheet1, "pane")[0];
assert.deepEqual(pane.attrs, { ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" });
assert.equal(find(sheet1, "autoFilter")[0].attrs.ref, `A1:H${4 + INJECTIONS.length}`);
const definedNames = find(parts["xl/workbook.xml"], "definedName");
assert.deepEqual(definedNames.map((node) => node.attrs.localSheetId), ["0", "1"], "only sheets with an autofilter get a filter database name");
assert.equal(definedNames[0].attrs.name, "_xlnm._FilterDatabase");
assert.equal(definedNames[0].text, `'Members active 2026'!$A$1:$H$${4 + INJECTIONS.length}`);
const widths = find(sheet1, "col").map((col) => Number(col.attrs.width));
assert.equal(widths.length, 8);
assert.ok(widths.every((width) => width >= 6 && width <= 60), "widths are capped");
assert.ok(widths[0] > widths[2], "the long-text column is wider than a short number column");
assert.equal(find(sheet1, "sheetView")[0].attrs.tabSelected, "1");
assert.equal(find(parts["xl/worksheets/sheet2.xml"], "sheetView")[0].attrs.tabSelected, undefined);
// Element order Excel insists on.
const order = parts["xl/worksheets/sheet1.xml"].children.map((child) => child.name);
assert.deepEqual(order, ["dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "autoFilter", "pageMargins"]);
ok("frozen header pane, autofilter + _FilterDatabase name, capped content widths, first tab selected, element order");

// Empty sheet still valid.
const sheet3 = parts["xl/worksheets/sheet3.xml"];
assert.equal(find(sheet3, "autoFilter").length, 0);
assert.equal(find(sheet3, "pane").length, 0);
ok("a sheet without columns is still a valid, empty worksheet");

// Statement sheet: title rows, bold section/subtotal/total, borders, indent.
const sheet4 = parts["xl/worksheets/sheet4.xml"];
const cells4 = new Map(find(sheet4, "c").map((c) => [c.attrs.r, c]));
const xf4 = (ref: string) => xfs[Number(cells4.get(ref)!.attrs.s ?? 0)];
assert.equal(xf4("A1").attrs.fontId, "2", "title is the large bold font");
assert.equal(find(sheet4, "pane")[0].attrs.ySplit, "4", "frozen below the header under the title");
assert.equal(find(sheet4, "autoFilter").length, 0);
assert.ok(boldOf(cells4.get("A5")!.attrs.s), "section bold");
assert.ok(!boldOf(cells4.get("A6")!.attrs.s), "account row regular");
assert.equal(find(xf4("A6"), "alignment")[0].attrs.indent, "1", "account label indented");
assert.equal(xf4("B7").attrs.borderId, "1", "subtotal rule above");
assert.equal(xf4("B8").attrs.borderId, "2", "total rule above and double rule below");
assert.equal(find(cells4.get("B8")!, "v")[0].text, "-25", "negative total is a signed number");
assert.equal(formatOf(cells4.get("B8")!.attrs.s), accountingFormat("CAD"));
ok("statement layout: title rows, bold sections/subtotals/totals with rules, indented labels, accounting negatives");

// ------------------------------------------------------- adapters (app data) --

const csv = [
  "account_code,account_name,debit_cents,credit_cents,balance_cents,entry_date,currency",
  `1000,Chequing,150000,0,150000,2026-01-31,CAD`,
  `2000,"Payables, trade",0,25050,-25050,2026-02-01,USD`,
  `3000,${String.fromCharCode(0x200c)}=SUM(A1),1,2,-1,2026-03-01,CAD`,
].join("\n");
const csvSheet = sheetFromCsv("Trial balance", csv, {
  debit_cents: { cents: true, header: "Debit" },
  credit_cents: { cents: true, header: "Credit" },
  balance_cents: { cents: true, header: "Balance" },
  entry_date: { type: "date" },
}, { currencyColumn: "currency" });
assert.deepEqual(csvSheet.columns.map((column) => column.header), ["Account code", "Account name", "Debit", "Credit", "Balance", "Entry date", "Currency"]);
const csvParts = buildXlsxParts({ sheets: [csvSheet], created });
const csvSst = find(parseXml(csvParts["xl/sharedStrings.xml"], "csv sst"), "si").map((si) => find(si, "t")[0].text);
const csvCells = new Map(find(parseXml(csvParts["xl/worksheets/sheet1.xml"], "csv sheet"), "c").map((c) => [c.attrs.r, c]));
const csvValue = (ref: string) => find(csvCells.get(ref)!, "v")[0].text;
assert.equal(csvCells.get("A2")!.attrs.t, "s", "account codes stay text");
assert.equal(csvValue("E3"), "-250.5");
assert.equal(csvValue("F2"), String(excelSerialForDate("2026-01-31")));
assert.equal(csvSst[Number(csvValue("B4"))], "=SUM(A1)", "the CSV's zero-width guard is dropped: the cell is typed text");
const csvStyles = parseXml(csvParts["xl/styles.xml"], "csv styles");
const csvFormats = find(csvStyles, "numFmt").map((node) => node.attrs.formatCode);
assert.ok(csvFormats.includes(currencyFormat("USD")) && csvFormats.includes(currencyFormat("CAD")), "per-row currency from the currency column");
ok("CSV → sheet adapter: cents to currency, dates, per-row currency, formula guard removed but cell stays text");

const report = reportTableSheet({
  name: "Income statement",
  currency: "CAD",
  columns: [
    { id: "current", label: createElement("span", null, "FY 2026"), title: "FY 2026" },
    { id: "prior", label: "FY 2025" },
  ],
  comparison: { current: "current", prior: "prior" },
  rows: [
    {
      id: "s",
      kind: "section",
      label: "Revenue",
      children: [
        { id: "r1", kind: "row", code: "4000", label: "Dues", values: { current: 120000, prior: 100000 } },
        { id: "r2", kind: "row", code: "4100", label: createElement("em", null, "Grants"), values: { current: 0, prior: 50000 } },
        { id: "n", kind: "note", label: "No other revenue." },
      ],
    },
    { id: "st", kind: "subtotal", label: "Total revenue", values: { current: 120000, prior: 150000 } },
    { id: "t", kind: "total", label: "Net income / (deficit)", values: { current: -30000, prior: 0 } },
  ],
});
assert.deepEqual(report.columns.map((column) => column.header), ["Code", "Account", "FY 2026", "FY 2025", "Change", "Change %"]);
assert.equal(report.rows.length, 6, "collapsed or not, every row is exported");
const rowCells = (index: number) => (report.rows[index] as { cells: unknown[] }).cells;
assert.deepEqual(rowCells(1).slice(0, 2), ["4000", { value: "Dues", indent: 1 }]);
assert.equal((rowCells(2)[1] as { value: string }).value, "Grants", "element labels flattened to text");
assert.equal(rowCells(1)[5], 0.2, "Δ% = change / |prior|");
assert.equal(rowCells(5)[5], null, "no Δ% without a prior base");
assert.deepEqual((report.rows[5] as { style?: string }).style, "total");
assert.equal(nodeText(createElement("span", null, "a", createElement("b", null, "b"), 3)), "ab3");
const reportParts = buildXlsxParts({ sheets: [report], created });
parseXml(reportParts["xl/worksheets/sheet1.xml"], "report sheet");
ok("ReportTable → sheet adapter: hierarchy flattened with indents, codes, comparison change and change %");

// ----------------------------------------------- external round-trips (opt) --

function available(command: string, args: string[]) {
  const probe = spawnSync(command, args, { encoding: "utf8", timeout: 20000 });
  return probe.status === 0;
}

if (available("xmllint", ["--version"])) {
  const partsDir = path.join(dir, "parts");
  for (const name of names) {
    const target = path.join(partsDir, name.replace(/[[\]]/g, "_"));
    spawnSync("mkdir", ["-p", path.dirname(target)]);
    writeFileSync(target, raw[name]);
    const lint = spawnSync("xmllint", ["--noout", target], { encoding: "utf8" });
    assert.equal(lint.status, 0, `xmllint ${name}: ${lint.stderr}`);
  }
  ok("xmllint: every part is well-formed");
} else {
  console.log("- xmllint not installed; skipped");
}

const OPENPYXL = `
import sys, datetime, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
assert wb.sheetnames == ["Members active 2026", "members", "History sheet", "Statement"], wb.sheetnames
ws = wb["Members active 2026"]
assert ws.freeze_panes == "A2", ws.freeze_panes
assert ws.auto_filter.ref.startswith("A1:H"), ws.auto_filter.ref
assert ws["A1"].font.b
assert ws["A2"].value == 'Ada <Lovelace> & "Co"'
assert ws["B2"].value == 125.5 and ws["B2"].number_format == '"$"#,##0.00;[Red]-"$"#,##0.00', (ws["B2"].value, ws["B2"].number_format)
assert ws["D2"].value == datetime.datetime(2026, 10, 14), ws["D2"].value
assert ws["E2"].value == datetime.datetime(2026, 1, 1, 12, 0), ws["E2"].value
assert ws["F2"].value is True and ws["F3"].value is False
assert ws["H2"].value == -1234.56
assert ws["D3"].value == "1899-12-31"
for row in range(5, 10):
    cell = ws.cell(row=row, column=1)
    assert cell.data_type == "s" and cell.value[0] in "=+-@", (cell.value, cell.data_type)
assert wb.properties.title == "Sample & <export>", wb.properties.title
st = wb["Statement"]
assert st["A1"].value == "Balance sheet" and st.freeze_panes == "A5"
assert st["B8"].value == -25 and st["B8"].font.b and st["B8"].border.bottom.style == "double"
print("ok")
`;
const python = spawnSync("python3", ["-I", "-c", "import openpyxl"], { encoding: "utf8" });
if (python.status === 0) {
  const run = spawnSync("python3", ["-I", "-c", OPENPYXL, samplePath], { encoding: "utf8", timeout: 60000 });
  assert.equal(run.status, 0, `openpyxl round-trip failed:\n${run.stderr}${run.stdout}`);
  ok("openpyxl reads the workbook back: names, frozen pane, filter, typed values, dates, formats, styles, properties");
} else {
  console.log("- python3 openpyxl not importable; skipped");
}

if (process.env.XLSX_SKIP_LIBREOFFICE !== "1" && available("soffice", ["--version"])) {
  const outDir = path.join(dir, "lo");
  const profile = `file://${path.join(dir, "lo-profile")}`;
  const convert = spawnSync(
    "soffice",
    [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true", "--outdir", outDir, samplePath],
    { encoding: "utf8", timeout: 120000 },
  );
  if (convert.error) {
    console.log(`- LibreOffice conversion did not finish (${convert.error.message}); skipped`);
  } else {
    assert.equal(convert.status, 0, `LibreOffice failed: ${convert.stderr}`);
    const lo = spawnSync("cat", [path.join(outDir, "sample.csv")], { encoding: "utf8" }).stdout;
    const firstLines = lo.split(/\r?\n/);
    assert.equal(firstLines[0], "Name,Dues,Count,Joined,Updated,Active,Share,Balance", `LibreOffice header: ${firstLines[0]}`);
    assert.ok(firstLines[1].includes("2026-10-14") && firstLines[1].includes("2026-01-01 12:00"), `LibreOffice dates: ${firstLines[1]}`);
    assert.ok(firstLines[1].includes("$125.50"), `LibreOffice currency: ${firstLines[1]}`);
    assert.ok(lo.includes("=SUM(A1:A9)"), "LibreOffice keeps the injection text as text");
    ok("LibreOffice opens and converts the workbook (header, dates, currency, injection text)");
  }
} else {
  console.log("- LibreOffice not installed (or XLSX_SKIP_LIBREOFFICE=1); skipped");
}

if (process.env.XLSX_KEEP !== "1") rmSync(dir, { recursive: true, force: true });
else console.log(`(kept ${dir})`);
console.log(`\nxlsx writer check passed (${passed} groups).`);
