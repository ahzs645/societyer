/**
 * Office Open XML (SpreadsheetML) parts for a workbook, as strings keyed by
 * their path in the package. Pure and synchronous so it can be tested without
 * zipping; `writer.ts` zips the result.
 *
 * Cells are always typed values (shared strings, numbers, booleans, date
 * serials) and never formulas.
 */

import { cleanCellText, escapeXml, XML_DECLARATION } from "./xml";
import { excelSerialForDate, excelSerialForDateTime } from "./dates";
import { quoteSheetName, uniqueSheetNames } from "./sheetNames";
import {
  BUILTIN_FORMAT_IDS,
  DATE_FORMAT,
  DATETIME_FORMAT,
  GENERAL_FORMAT,
  INTEGER_FORMAT,
  PERCENT_FORMAT,
  accountingFormat,
  currencyFormat,
  currencyInfo,
} from "./numberFormats";
import type {
  XlsxCellInput,
  XlsxCellObject,
  XlsxCellType,
  XlsxColumn,
  XlsxRowInput,
  XlsxRowStyle,
  XlsxSheet,
  XlsxWorkbook,
} from "./types";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_OFFICE_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const REL_CORE = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const REL_APP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";
const REL_WORKSHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const REL_STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
const REL_SHARED_STRINGS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";


const MIN_WIDTH = 6;
const MAX_WIDTH = 60;
const DEFAULT_CREATOR = "Societyer";

// ------------------------------------------------------------------ styles --

/** Fonts: 0 regular, 1 bold, 2 bold title. Borders: see BORDERS. */
const FONTS = [
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>',
];
const BORDER_NONE = 0;
const BORDER_TOP = 1;
const BORDER_TOTAL = 2;
const BORDER_BOTTOM = 3;
const BORDERS = [
  "<border><left/><right/><top/><bottom/><diagonal/></border>",
  '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>',
  '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>',
  '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>',
];

type CellStyle = {
  format: string;
  font: 0 | 1 | 2;
  border: number;
  indent: number;
  alignRight: boolean;
  quotePrefix: boolean;
};

class StyleRegistry {
  private formats = new Map<string, number>();
  private nextFormatId = 164;
  private xfs: CellStyle[] = [];
  private keys = new Map<string, number>();

  constructor() {
    this.id({ format: GENERAL_FORMAT, font: 0, border: BORDER_NONE, indent: 0, alignRight: false, quotePrefix: false });
  }

  formatId(code: string) {
    const builtin = BUILTIN_FORMAT_IDS[code];
    if (builtin !== undefined) return builtin;
    let id = this.formats.get(code);
    if (id === undefined) {
      id = this.nextFormatId++;
      this.formats.set(code, id);
    }
    return id;
  }

  id(style: CellStyle) {
    const key = JSON.stringify(style);
    let index = this.keys.get(key);
    if (index === undefined) {
      index = this.xfs.length;
      this.xfs.push(style);
      this.keys.set(key, index);
      this.formatId(style.format);
    }
    return index;
  }

  xml() {
    const numFmts = Array.from(this.formats.entries())
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`)
      .join("");
    const xfs = this.xfs
      .map((style) => {
        const attrs = [
          `numFmtId="${this.formatId(style.format)}"`,
          `fontId="${style.font}"`,
          'fillId="0"',
          `borderId="${style.border}"`,
          'xfId="0"',
        ];
        if (style.format !== GENERAL_FORMAT) attrs.push('applyNumberFormat="1"');
        if (style.font) attrs.push('applyFont="1"');
        if (style.border) attrs.push('applyBorder="1"');
        if (style.quotePrefix) attrs.push('quotePrefix="1"');
        const alignment = style.indent
          ? `<alignment horizontal="left" indent="${style.indent}"/>`
          : style.alignRight
            ? '<alignment horizontal="right"/>'
            : "";
        if (alignment) attrs.push('applyAlignment="1"');
        return alignment ? `<xf ${attrs.join(" ")}>${alignment}</xf>` : `<xf ${attrs.join(" ")}/>`;
      })
      .join("");
    return (
      XML_DECLARATION +
      `<styleSheet xmlns="${NS_MAIN}">` +
      (this.formats.size ? `<numFmts count="${this.formats.size}">${numFmts}</numFmts>` : "") +
      `<fonts count="${FONTS.length}">${FONTS.join("")}</fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      `<borders count="${BORDERS.length}">${BORDERS.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      "</styleSheet>"
    );
  }
}

class SharedStrings {
  private index = new Map<string, number>();
  private list: string[] = [];
  count = 0;

  id(text: string) {
    this.count += 1;
    let id = this.index.get(text);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(text);
      this.index.set(text, id);
    }
    return id;
  }

  xml() {
    const items = this.list
      .map((text) => (/^\s|\s$|\n/.test(text) ? `<si><t xml:space="preserve">${escapeXml(text)}</t></si>` : `<si><t>${escapeXml(text)}</t></si>`))
      .join("");
    return XML_DECLARATION + `<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

// ------------------------------------------------------------- cell values --

type Resolved =
  | { kind: "empty" }
  | { kind: "string"; text: string }
  | { kind: "number"; value: number; format: string; display: number }
  | { kind: "boolean"; value: boolean };

/** Text a spreadsheet would treat as a formula if retyped; stored as text with a quote prefix. */
const FORMULA_PREFIX = /^[=+\-@]/;

function isCellObject(input: XlsxCellInput): input is XlsxCellObject {
  return typeof input === "object" && input !== null && !(input instanceof Date);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value.trim().replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function displayText(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value);
}

function resolveCell(input: XlsxCellInput, column: XlsxColumn | undefined): Resolved & { currency?: string } {
  const object = isCellObject(input) ? input : null;
  const value = object ? object.value : (input as Exclude<XlsxCellInput, XlsxCellObject>);
  if (value === null || value === undefined || (typeof value === "string" && value === "")) return { kind: "empty" };
  const declared: XlsxCellType | undefined = object?.type ?? column?.type;
  const type: XlsxCellType =
    declared ?? (typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : value instanceof Date ? "datetime" : "text");
  const currency = object?.currency ?? column?.currency;
  const asText = (): Resolved => ({ kind: "string", text: cleanCellText(displayText(value)) });

  switch (type) {
    case "number":
    case "integer":
    case "percent":
    case "currency":
    case "accounting": {
      let number = toNumber(value);
      if (number === null) return asText();
      if (column?.cents) number /= 100;
      if (Object.is(number, -0)) number = 0;
      const format =
        type === "number" ? GENERAL_FORMAT
        : type === "integer" ? INTEGER_FORMAT
        : type === "percent" ? PERCENT_FORMAT
        : type === "currency" ? currencyFormat(currency)
        : accountingFormat(currency);
      return { kind: "number", value: number, format, display: number, currency };
    }
    case "date": {
      if (typeof value !== "string" && !(value instanceof Date)) return asText();
      const serial = excelSerialForDate(value);
      return serial === null ? asText() : { kind: "number", value: serial, format: DATE_FORMAT, display: 0 };
    }
    case "datetime": {
      if (typeof value === "boolean") return asText();
      const serial = excelSerialForDateTime(value);
      return serial === null ? asText() : { kind: "number", value: serial, format: DATETIME_FORMAT, display: 0 };
    }
    case "boolean": {
      if (typeof value === "boolean") return { kind: "boolean", value };
      if (value === "true" || value === "false") return { kind: "boolean", value: value === "true" };
      return asText();
    }
    default:
      return asText();
  }
}

/** Rough rendered width in characters, used to size columns. */
function renderedWidth(cell: Resolved & { currency?: string }): number {
  switch (cell.kind) {
    case "empty":
      return 0;
    case "boolean":
      return 5;
    case "string":
      return Math.max(...cell.text.split("\n").map((line) => line.length));
    case "number": {
      if (cell.format === DATE_FORMAT) return 10;
      if (cell.format === DATETIME_FORMAT) return 16;
      if (cell.format === PERCENT_FORMAT) return 8;
      if (cell.format === GENERAL_FORMAT) return Math.min(String(cell.value).length, 15);
      const whole = Math.trunc(Math.abs(cell.display)).toString();
      const grouped = whole.length + Math.floor((whole.length - 1) / 3);
      const { symbol, decimals } = currencyInfo(cell.currency);
      const extra = cell.format === INTEGER_FORMAT ? 1 : symbol.length + decimals + 3;
      return grouped + extra;
    }
  }
}

// ------------------------------------------------------------------ sheets --

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function rowObject(row: XlsxRowInput): { cells: XlsxCellInput[]; style?: XlsxRowStyle } {
  return Array.isArray(row) ? { cells: row } : row;
}

const NUMERIC_TYPES = new Set<XlsxCellType>(["number", "integer", "currency", "accounting", "percent"]);

type BuiltSheet = { xml: string; filterRef: string | null };

function buildSheet(sheet: XlsxSheet, styles: StyleRegistry, strings: SharedStrings, selected: boolean): BuiltSheet {
  const columns = sheet.columns;
  const columnCount = Math.max(columns.length, ...sheet.rows.map((row) => rowObject(row).cells.length), 0);
  const widths = columns.map((column) => column.header.length + 3);
  const rowsXml: string[] = [];
  let rowNumber = 0;

  const base: CellStyle = { format: GENERAL_FORMAT, font: 0, border: BORDER_NONE, indent: 0, alignRight: false, quotePrefix: false };

  const titleLines = (sheet.title ?? []).filter((line) => line && line.trim());
  titleLines.forEach((line, index) => {
    rowNumber += 1;
    const text = cleanCellText(line);
    const style = styles.id({ ...base, font: index === 0 ? 2 : 1 });
    rowsXml.push(`<row r="${rowNumber}"><c r="A${rowNumber}" s="${style}" t="s"><v>${strings.id(text)}</v></c></row>`);
  });
  if (titleLines.length) rowNumber += 1; // blank spacer row

  // Header.
  rowNumber += 1;
  const headerRow = rowNumber;
  const headerCells = columns
    .map((column, index) => {
      const numeric = NUMERIC_TYPES.has(column.type ?? "text");
      const style = styles.id({ ...base, font: 1, border: BORDER_BOTTOM, alignRight: numeric });
      return `<c r="${columnLetter(index)}${rowNumber}" s="${style}" t="s"><v>${strings.id(cleanCellText(column.header))}</v></c>`;
    })
    .join("");
  rowsXml.push(`<row r="${rowNumber}">${headerCells}</row>`);

  for (const input of sheet.rows) {
    const { cells, style: rowStyle } = rowObject(input);
    rowNumber += 1;
    const bold = rowStyle === "section" || rowStyle === "subtotal" || rowStyle === "total";
    const border = rowStyle === "total" ? BORDER_TOTAL : rowStyle === "subtotal" ? BORDER_TOP : BORDER_NONE;
    const out: string[] = [];
    const span = border ? Math.max(columnCount, cells.length) : cells.length;
    for (let index = 0; index < span; index += 1) {
      const input = cells[index];
      const object = isCellObject(input) ? input : null;
      const resolved = resolveCell(input, columns[index]);
      const indent = Math.max(0, Math.min(15, Math.round(object?.indent ?? 0)));
      const style: CellStyle = {
        ...base,
        font: bold || object?.bold ? 1 : 0,
        border,
        indent: resolved.kind === "string" ? indent : 0,
        quotePrefix: resolved.kind === "string" && FORMULA_PREFIX.test(resolved.text),
        format: resolved.kind === "number" ? resolved.format : GENERAL_FORMAT,
      };
      const width = renderedWidth(resolved) + indent * 2 + (style.font ? 1 : 0);
      if (index < widths.length) widths[index] = Math.max(widths[index], width);
      else widths[index] = Math.max(widths[index] ?? 0, width);
      const ref = `${columnLetter(index)}${rowNumber}`;
      const s = styles.id(style);
      const sAttr = s ? ` s="${s}"` : "";
      switch (resolved.kind) {
        case "empty":
          if (s) out.push(`<c r="${ref}"${sAttr}/>`);
          break;
        case "string":
          out.push(`<c r="${ref}"${sAttr} t="s"><v>${strings.id(resolved.text)}</v></c>`);
          break;
        case "number":
          out.push(`<c r="${ref}"${sAttr}><v>${formatNumber(resolved.value)}</v></c>`);
          break;
        case "boolean":
          out.push(`<c r="${ref}"${sAttr} t="b"><v>${resolved.value ? 1 : 0}</v></c>`);
          break;
      }
    }
    rowsXml.push(out.length ? `<row r="${rowNumber}">${out.join("")}</row>` : `<row r="${rowNumber}"/>`);
  }

  const lastColumn = columnLetter(Math.max(columnCount, 1) - 1);
  const dimension = `A1:${lastColumn}${Math.max(rowNumber, 1)}`;
  const freeze = sheet.freezeHeader !== false && columns.length > 0;
  const topLeft = `A${headerRow + 1}`;
  const view = freeze
    ? `<sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}><pane ySplit="${headerRow}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView>`
    : `<sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}/>`;
  const cols = widths.length
    ? `<cols>${widths
        .map((width, index) => {
          const explicit = columns[index]?.width;
          const value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, explicit ?? width));
          return `<col min="${index + 1}" max="${index + 1}" width="${value.toFixed(2)}" customWidth="1"/>`;
        })
        .join("")}</cols>`
    : "";
  const filter = sheet.autoFilter !== false && columns.length > 0;
  const filterRef = filter ? `A${headerRow}:${columnLetter(columns.length - 1)}${Math.max(rowNumber, headerRow)}` : null;
  const xml =
    XML_DECLARATION +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews>${view}</sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    (filterRef ? `<autoFilter ref="${filterRef}"/>` : "") +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    "</worksheet>";
  return { xml, filterRef };
}

/** Shortest round-tripping decimal form (an xsd:double, which is what <v> holds). */
function formatNumber(value: number): string {
  return String(value);
}

function isoSeconds(date: Date) {
  return `${date.toISOString().slice(0, 19)}Z`;
}

// ---------------------------------------------------------------- workbook --

export type XlsxParts = Record<string, string>;

export function buildXlsxParts(workbook: XlsxWorkbook): XlsxParts {
  const sheets = workbook.sheets.length ? workbook.sheets : [{ name: "Sheet1", columns: [], rows: [] }];
  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));
  const styles = new StyleRegistry();
  const strings = new SharedStrings();
  const built = sheets.map((sheet, index) => buildSheet(sheet, styles, strings, index === 0));
  const created = workbook.created && !Number.isNaN(workbook.created.getTime()) ? workbook.created : new Date();
  const creator = workbook.creator ?? DEFAULT_CREATOR;

  const parts: XlsxParts = {};
  parts["[Content_Types].xml"] =
    XML_DECLARATION +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>";
  parts["_rels/.rels"] =
    XML_DECLARATION +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL_OFFICE_DOC}" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_CORE}" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${REL_APP}" Target="docProps/app.xml"/>` +
    "</Relationships>";
  parts["docProps/core.xml"] =
    XML_DECLARATION +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    (workbook.title ? `<dc:title>${escapeXml(workbook.title)}</dc:title>` : "") +
    (workbook.subject ? `<dc:subject>${escapeXml(workbook.subject)}</dc:subject>` : "") +
    `<dc:creator>${escapeXml(creator)}</dc:creator>` +
    `<cp:lastModifiedBy>${escapeXml(creator)}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${isoSeconds(created)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${isoSeconds(created)}</dcterms:modified>` +
    "</cp:coreProperties>";
  parts["docProps/app.xml"] =
    XML_DECLARATION +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>${escapeXml(DEFAULT_CREATOR)}</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>` +
    `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>` +
    "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>" +
    "</Properties>";
  const definedNames = built
    .map((sheet, index) =>
      sheet.filterRef
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escapeXml(`${quoteSheetName(names[index])}!${absolute(sheet.filterRef)}`)}</definedName>`
        : "",
    )
    .join("");
  parts["xl/workbook.xml"] =
    XML_DECLARATION +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>' +
    `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>` +
    (definedNames ? `<definedNames>${definedNames}</definedNames>` : "") +
    "</workbook>";
  parts["xl/_rels/workbook.xml.rels"] =
    XML_DECLARATION +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL_WORKSHEET}" Target="worksheets/sheet${index + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${names.length + 1}" Type="${REL_STYLES}" Target="styles.xml"/>` +
    `<Relationship Id="rId${names.length + 2}" Type="${REL_SHARED_STRINGS}" Target="sharedStrings.xml"/>` +
    "</Relationships>";
  built.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = sheet.xml;
  });
  parts["xl/styles.xml"] = styles.xml();
  parts["xl/sharedStrings.xml"] = strings.xml();
  return parts;
}

/** "A1:K20" → "$A$1:$K$20". */
function absolute(ref: string) {
  return ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
}
