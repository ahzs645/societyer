/** Financial statement / budget extractor (design §4.3). Lines carry cell
 * locators (sheet + A1 for spreadsheets, R{r}C{c} for document tables, block
 * for PDF text); totals are re-added arithmetically; the statement type is
 * read from the titles and checked against the lines (a "Balance Sheet" whose
 * lines are revenue and expenses is flagged). */
import { versionMarker } from "../cluster";
import { findDates, monthIndex, validIsoDay, type DateMatch } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, linesOf, loc, parseAmount, type Line } from "./toolkit";

export const DETERMINISTIC_FINANCIAL_ENGINE = "deterministic-financial/1";

type Column = "actual" | "budget" | "prior" | "variance" | "unknown";
type StatementType = "income_statement" | "balance_sheet" | "cash_flow" | "budget" | "notes" | "combined" | "unknown";
type DraftLine = { label: string; labelLine: Line; amountLine: Line; cents: number; text: string; column: Column; section?: string; isTotal: boolean; sheet?: string; block: number };

const TOTAL = /^(?:total|net\b|sub-?total|surplus|deficit|excess of|liabilities and (?:equity|net assets)|total liabilities and)/i;
const SECTION = /^(?:revenues?|income|expenses?|expenditures?|assets?|current assets|liabilities|current liabilities|equity|net assets|program revenues|carry forward|receipts|disbursements|other)\s*:?$/i;
const NOT_LABEL = /^(?:notes?:?|generated on|page \d|\d+$|approved on behalf|director$|prepared by)/i;

/** dd/mm/yyyy ranges ("01/01/2019 to 31/12/2019") read day-first when either side proves it. */
function slashRange(text: string): { start?: DateMatch; end?: DateMatch } | undefined {
  const match = /(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\s*(?:to|-|–)\s*(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})/.exec(text);
  if (!match) return undefined;
  const dayFirst = Number(match[1]) > 12 || Number(match[4]) > 12;
  const iso = (a: string, b: string, y: string) => dayFirst ? validIsoDay(Number(y), Number(b), Number(a)) : validIsoDay(Number(y), Number(a), Number(b));
  const startIso = iso(match[1], match[2], match[3]);
  const endIso = iso(match[4], match[5], match[6]);
  const index = match.index;
  return {
    ...(startIso ? { start: { iso: startIso, precision: "day" as const, text: `${match[1]}/${match[2]}/${match[3]}`, index, length: 10 } } : {}),
    ...(endIso ? { end: { iso: endIso, precision: "day" as const, text: `${match[4]}/${match[5]}/${match[6]}`, index, length: 10 } } : {}),
  };
}
function asAt(text: string): DateMatch | undefined {
  const slash = /as (?:at|of)\s+(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})/i.exec(text);
  if (slash) {
    const iso = Number(slash[1]) > 12 ? validIsoDay(Number(slash[3]), Number(slash[2]), Number(slash[1])) : validIsoDay(Number(slash[3]), Number(slash[2]), Number(slash[1])) ?? validIsoDay(Number(slash[3]), Number(slash[1]), Number(slash[2]));
    if (iso) return { iso, precision: "day", text: `${slash[1]}/${slash[2]}/${slash[3]}`, index: slash.index, length: slash[0].length };
  }
  return undefined;
}

/** Column identity of a cell reference: "C" for C12, "C3" for R6C3. */
function colKey(cell: string | undefined): string {
  const docx = /^R\d+C(\d+)$/.exec(cell ?? "");
  return docx ? `C${docx[1]}` : (cell ?? "").replace(/\d+$/, "");
}

function columnFor(header: string, statementType: StatementType): Column {
  const text = header.toLowerCase();
  if (/variance|difference|over\/under|\bdiff\b/.test(text)) return "variance";
  if (/budget|forecast|projected|plan/.test(text)) return "budget";
  if (/actual|year to date|ytd|to date/.test(text)) return "actual";
  if (/prior|previous|last year/.test(text)) return "prior";
  return statementType === "budget" ? "budget" : "unknown";
}

function statementTypeOf(text: string): StatementType | undefined {
  const balance = /balance sheet|statement of financial position|statement of net assets/i.test(text);
  const income = /income statement|statement of operations|statement of (?:revenue|receipts) and expen|profit (?:and|&) loss|revenue and expenses|operating funds/i.test(text);
  const budget = /\bbudget\b/i.test(text);
  const cash = /cash flows?/i.test(text);
  const kinds = [balance && "balance_sheet", income && "income_statement", cash && "cash_flow"].filter(Boolean) as StatementType[];
  if (kinds.length > 1) return "combined";
  if (kinds.length === 1) return kinds[0];
  if (budget) return "budget";
  return undefined;
}

export function extractFinancial(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const headText = lines.slice(0, 40).map((line) => line.text).join("\n");
  const titleLines = lines.filter((line) => statementTypeOf(line.text) && line.text.length < 140).slice(0, 12);
  const titleType = statementTypeOf(titleLines.map((line) => line.text).join(" ") || headText.slice(0, 600));
  const nameType = statementTypeOf(fileName.replace(/_/g, " "));
  let statementType: StatementType = input.docClass === "budget" || nameType === "budget" ? (titleType && titleType !== "budget" && !/budget/i.test(fileName) ? titleType : "budget") : titleType ?? nameType ?? "unknown";
  // Column headers per table block: the row above the first amount row.
  const drafts: DraftLine[] = [];
  const headerFor = new Map<string, string>();
  for (const block of extract.blocks) {
    if (block.kind !== "table") continue;
    const rows = block.rows ?? [];
    rows.forEach((row) => row.cells.forEach((cell) => {
      const text = cell.text.trim();
      const key = `${block.index}:${colKey(cell.cell)}`;
      if (!headerFor.has(key) && /^(?:actual|budget|year to date|ytd|variance|prior|notes?|page|(?:dec|jul|jun|mar)[a-z]* (?:19|20)\d{2}|(?:19|20)\d{2}|actual .*|budget .*|q[1-4](?: actual)?)$/i.test(text)) headerFor.set(key, text);
    }));
  }
  let section: string | undefined;
  let lastSheet: string | undefined;
  for (const block of extract.blocks) {
    if (block.kind === "table") {
      const blockLines = lines.filter((line) => line.blockIndex === block.index);
      const rows = block.rows ?? [];
      // Year columns ("Dec 2020 | Dec 2019"): the latest year is actual, earlier ones prior.
      const yearHeaders = [...headerFor.entries()].filter(([key, text]) => key.startsWith(`${block.index}:`) && /\d{4}/.test(text) && !/budget|actual/i.test(text));
      const latestYear = Math.max(0, ...yearHeaders.map(([, text]) => Number(/\d{4}/.exec(text)![0])));
      rows.forEach((row, rowIndex) => {
        const cellsLines = blockLines.filter((line) => line.row === rowIndex);
        const label = cellsLines.find((line) => !parseAmount(line.text, { bare: true }) && !/^\$?\s*-\s*$/.test(line.text.trim()) && line.text.trim().length > 1);
        const amounts = cellsLines.filter((line) => line !== label && (parseAmount(line.text, { bare: true }) || /^\$?\s*-\s*$/.test(line.text.trim())));
        if (block.sheet !== lastSheet) {
          section = undefined;
          lastSheet = block.sheet;
        }
        if (label && !amounts.length && (SECTION.test(label.text.trim()) || /^[A-Z][A-Z &/-]{2,40}$/.test(label.text.trim()))) {
          section = clean(label.text);
          return;
        }
        if (!label || !amounts.length || NOT_LABEL.test(label.text.trim()) || !/[a-z]/i.test(label.text)) return;
        if (/^(?:index|contents|title page|toc)$/i.test(block.sheet ?? "") || amounts.every((amountLine) => /^page$/i.test(headerFor.get(`${block.index}:${colKey(amountLine.cell)}`) ?? ""))) return;
        // Skip numeric-looking labels and notes columns.
        for (const amountLine of amounts) {
          const header = headerFor.get(`${block.index}:${colKey(amountLine.cell)}`) ?? "";
          if (/^notes?$/i.test(header)) continue;
          const parsed = parseAmount(amountLine.text, { bare: true }) ?? { cents: 0, text: amountLine.text.trim() };
          if (Math.abs(parsed.cents) > 1e12) continue;
          let column = columnFor(header, statementType);
          if (column === "unknown" && /\d{4}/.test(header) && latestYear) column = Number(/\d{4}/.exec(header)![0]) === latestYear ? "actual" : "prior";
          if (column === "unknown" && statementType !== "budget" && amounts.length === 1) column = "actual";
          drafts.push({ label: clean(label.text), labelLine: label, amountLine, cents: parsed.cents, text: parsed.text, column, section, isTotal: TOTAL.test(clean(label.text)), sheet: block.sheet, block: block.index });
        }
      });
      continue;
    }
    // Text statements (PDF): "Label\t…$ 1,234.56".
    for (const line of lines.filter((candidate) => candidate.blockIndex === block.index)) {
      const text = line.text.trim();
      if (SECTION.test(text)) {
        section = clean(text);
        continue;
      }
      const pieces = text.split(/\t+/);
      const money = /\$\s*(\(?-?[\d,]+(?:\.\d{2})?\)?|-)\s*$/.exec(text);
      if (!money || pieces.length < 2) continue;
      const label = clean(pieces[0].replace(/\b(?:cash|term)\s*$/i, ""));
      if (!label || NOT_LABEL.test(label) || label.length > 100 || !/[a-z]{2}/i.test(label)) continue;
      const parsed = money[1] === "-" ? { cents: 0, text: money[0].trim() } : parseAmount(money[0]) ?? parseAmount(money[1], { bare: true });
      if (!parsed) continue;
      drafts.push({ label, labelLine: line, amountLine: line, cents: parsed.cents, text: money[0].trim(), column: statementType === "budget" ? "budget" : "actual", section, isTotal: TOTAL.test(label), block: block.index });
    }
  }
  // Mislabelled statements: title says balance sheet but lines are revenue/expenses (or the reverse).
  const labels = drafts.map((line) => `${line.section ?? ""} ${line.label}`).join(" ");
  const looksIncome = /revenue|expense|income/i.test(labels) && !/liabilit|equity/i.test(labels);
  const looksBalance = /asset|liabilit|equity/i.test(labels) && !/expense/i.test(labels);
  let titleConflict: FieldValue<string> | undefined;
  if ((statementType === "balance_sheet" && looksIncome) || (statementType === "income_statement" && looksBalance && !looksIncome)) {
    const where = titleLines[0];
    titleConflict = where ? at(`Titled ${statementType.replace("_", " ")} but the lines are ${looksIncome ? "revenue and expenses" : "assets and liabilities"}.`, where, undefined, 0.7) : fromFile(`File name says ${statementType.replace("_", " ")}; lines disagree.`, fileName, 0.6);
    statementType = looksIncome ? "income_statement" : "balance_sheet";
  }
  // Arithmetic: each total against the detail lines above it (same column, same block), else the previous total.
  const totals: any[] = [];
  const byColumn = new Map<string, DraftLine[]>();
  for (const line of drafts) {
    const key = `${line.block}:${line.column}:${colKey(line.amountLine.cell)}`;
    byColumn.set(key, [...(byColumn.get(key) ?? []), line]);
  }
  for (const group of byColumn.values()) {
    let run: DraftLine[] = [];
    let previousTotals: DraftLine[] = [];
    for (const line of group) {
      if (!line.isTotal) {
        run.push(line);
        continue;
      }
      let check: "ok" | "mismatch" | "not_checked" = "not_checked";
      let note: string | undefined;
      if (/^net\b|surplus|deficit|excess of|liabilities and (?:equity|net assets)/i.test(line.label)) {
        const find = (re: RegExp) => [...previousTotals].reverse().find((total) => re.test(total.label));
        const revenue = find(/^total\b.*\b(?:revenues?|income|receipts)\b/i);
        const expense = find(/^total\b.*\b(?:expenses?|expenditures?|disbursements?)\b/i);
        const assets = find(/^total\b.*\bassets?\b/i);
        const liabilities = find(/^total\b.*\bliabilit/i);
        const equity = find(/^total\b.*\b(?:equity|net assets)\b|^surplus/i);
        const candidates: Array<[string, number]> = [];
        if (revenue && expense) candidates.push([`${revenue.label} − ${expense.label}`, revenue.cents - expense.cents]);
        if (revenue && expense && assets) candidates.push([`${assets.label} + ${revenue.label} − ${expense.label}`, assets.cents + revenue.cents - expense.cents]);
        if (/net assets/i.test(line.label) && assets && liabilities) candidates.push([`${assets.label} − ${liabilities.label}`, assets.cents - liabilities.cents]);
        if (/liabilities and/i.test(line.label) && liabilities && equity) candidates.push([`${liabilities.label} + ${equity.label}`, liabilities.cents + equity.cents]);
        const hit = candidates.find(([, expected]) => Math.abs(expected - line.cents) <= 100);
        if (hit) {
          check = "ok";
          note = `${hit[0]} = ${(hit[1] / 100).toFixed(2)}`;
        } else if (candidates.length) {
          check = "mismatch";
          note = `${candidates[0][0]} = ${(candidates[0][1] / 100).toFixed(2)}`;
        }
      } else if (run.length) {
        const sum = run.reduce((total, item) => total + item.cents, 0);
        check = Math.abs(sum - line.cents) <= 100 ? "ok" : "mismatch";
        note = `Sum of ${run.length} line(s) above = ${(sum / 100).toFixed(2)}`;
      } else if (previousTotals.length) {
        const last = previousTotals[previousTotals.length - 1];
        check = Math.abs(last.cents - line.cents) <= 100 ? "ok" : "mismatch";
        note = `Repeats ${last.label} = ${(last.cents / 100).toFixed(2)}`;
      }
      totals.push({
        label: at(line.label, line.labelLine, undefined, 0.85),
        amount: at({ amountCents: line.cents, currency: "CAD", text: line.text }, line.amountLine, line.text, 0.85),
        arithmeticCheck: check === "not_checked" ? inferred(check, [loc(line.amountLine, line.text)], 0.5) : at(check, line.amountLine, line.text, check === "ok" ? 0.95 : 0.9, note),
      });
      previousTotals.push(line);
      run = [];
    }
  }
  const mismatches = totals.filter((total) => total.arithmeticCheck?.value === "mismatch").length;
  if (mismatches) warnings.push(`${mismatches} total(s) do not equal the sum of their lines.`);
  // Period.
  let periodStart: FieldValue<ReturnType<typeof dateValue>> | undefined;
  let periodEnd: FieldValue<ReturnType<typeof dateValue>> = notStated("No period end found.");
  for (const line of lines.slice(0, 60)) {
    const range = slashRange(line.text);
    if (range?.end) {
      periodEnd = at(dateValue(range.end), line, range.end.text, 0.9);
      if (range.start) periodStart = at(dateValue(range.start), line, range.start.text, 0.9);
      break;
    }
    const at_ = asAt(line.text);
    if (at_) {
      periodEnd = at(dateValue(at_), line, at_.text, 0.9);
      break;
    }
    if (/\b(?:as at|as of|year ended|year ending|period ended|to|for the year|december|july|june|march)\b/i.test(line.text) && line.text.length < 160) {
      const date = findDates(line.text, { allowMonthPrecision: true }).find((candidate) => candidate.precision !== "year");
      if (date && !/generated|printed|issued|approved/i.test(line.text)) {
        periodEnd = at(dateValue(date), line, date.text, date.precision === "day" ? 0.85 : 0.7);
        break;
      }
    }
  }
  if (!periodEnd.value) {
    const fromName = findDates(fileName.replace(/_/g, " "), { allowMonthPrecision: true }).find((date) => date.precision !== "year") ?? findDates(fileName.replace(/_/g, " "), { allowMonthPrecision: true })[0];
    if (fromName) periodEnd = fromFile(dateValue(fromName), fileName, 0.55, "Period from the file name.");
  }
  const end = periodEnd.value;
  const annual = Boolean(periodStart?.value && end && Number(end.iso.slice(0, 4)) - Number(periodStart.value.iso.slice(0, 4)) <= 1 && end.iso.slice(5) !== periodStart.value.iso.slice(5)) || /year end|year ended|annual|fiscal/i.test(`${fileName} ${headText}`);
  const fiscalYearEnd = end && end.precision === "day" && annual ? guessAt(`${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(end.iso.slice(5, 7)) - 1]} ${Number(end.iso.slice(8, 10))}`, (periodEnd.locators[0]?.kind === "filename" ? undefined : lines.find((line) => line.blockIndex === periodEnd.locators[0]?.blockIndex)) ?? lines[0], undefined, 0.6, "Month/day of an annual period end.") : undefined;
  // Version label.
  const marker = versionMarker(fileName);
  const versionText = `${fileName} ${headText}`;
  const version: FieldValue<"draft" | "revised" | "approved" | "audited" | "reviewed" | "unknown"> = /\brevised\b/i.test(fileName) ? fromFile("revised", fileName, 0.7)
    : marker === "draft" || /\bdraft\b/i.test(versionText) ? inferred("draft", [lines.find((line) => /\bdraft\b/i.test(line.text)) ? loc(lines.find((line) => /\bdraft\b/i.test(line.text))!) : fileLoc(fileName)], 0.7)
      : /\(?unaudited\)?/i.test(headText) ? at("unknown", lines.find((line) => /unaudited/i.test(line.text))!, "UNAUDITED", 0.7, "Marked unaudited (internally prepared).")
        : /independent auditor|audited/i.test(headText) ? at("audited", lines.find((line) => /audit/i.test(line.text))!, undefined, 0.7)
          : /review engagement/i.test(headText) ? at("reviewed", lines.find((line) => /review engagement/i.test(line.text))!, undefined, 0.7)
            : marker === "approved" || /approved/i.test(fileName) ? fromFile("approved", fileName, 0.55) : inferred("unknown", [fileLoc(fileName)], 0.5);
  const approvedLine = lines.find((line) => /approved (?:on behalf of|by) the board/i.test(line.text));
  if (approvedLine) unsupported.push({ description: "Board approval signature block (signatories not filled in the source).", locators: [loc(approvedLine)], suggestedTarget: "financialStatementImports.approvedBy", category: "no_field", infoType: "finance.approval_signatures" });
  const notesLine = lines.find((line) => /^notes?\s*:?$/i.test(line.text.trim()));
  if (notesLine) unsupported.push({ description: "Notes to the statement (numbered explanations) are kept as source text only.", locators: [loc(notesLine)], suggestedTarget: "financialStatementImportLines.notes", category: "lossy_normalization", infoType: "finance.notes" });
  const title = titleLines[0] ?? lines.find((line) => /financial statements?|budget|income statement|balance sheet|statement of/i.test(line.text) && line.text.length < 140);
  const org = lines.slice(0, 10).find((line) => /\b(?:society|roundtable|association|foundation)\b/i.test(line.text) && line.text.length < 120);
  const record = {
    statementType: titleLines[0] ? at(statementType, titleLines[0], undefined, titleConflict ? 0.6 : 0.85) : nameType ? fromFile(statementType, fileName, 0.6) : inferred(statementType, [fileLoc(fileName)], 0.4),
    ...(periodStart ? { periodStart } : {}),
    periodEnd,
    ...(fiscalYearEnd ? { fiscalYearEnd } : {}),
    versionLabel: version,
    currency: inferred("CAD", [fileLoc(fileName)], 0.6, "Canadian organization; no currency stated."),
    lines: drafts.filter((line) => !line.isTotal).slice(0, 600).map((line) => ({
      label: at(line.label, line.labelLine, undefined, 0.85),
      amount: at({ amountCents: line.cents, currency: "CAD", text: line.text }, line.amountLine, line.text, 0.85),
      column: line.column === "unknown" ? inferred(line.column, [loc(line.amountLine, line.text)], 0.4) : at(line.column, line.amountLine, line.text, 0.75),
      ...(line.section ? { section: line.section } : line.sheet ? { section: line.sheet } : {}),
    })),
    totals,
    ...(title ? { title: at(clean(title.text), title, undefined, 0.8) } : {}),
    ...(org ? { organizationName: at(clean(org.text), org, undefined, 0.6) } : {}),
    ...(titleConflict ? { titleConflict } : {}),
  };
  if (!drafts.length) warnings.push("No amount lines recognised (scan or narrative report?).");
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_FINANCIAL_ENGINE, record, unsupported, references, warnings };
}

/** Fiscal-year-end change across statements of one run (e.g. 31 Jul → 31 Dec): returns the change per statement. */
export function fiscalYearEndChanges(statements: Array<{ fileKey: string; periodEndIso?: string; fiscalYearEnd?: string }>): Array<{ fileKey: string; from: string; to: string; firstYear: number }> {
  const annual = statements.filter((statement) => statement.fiscalYearEnd && statement.periodEndIso).sort((a, b) => a.periodEndIso!.localeCompare(b.periodEndIso!));
  const changes: Array<{ fileKey: string; from: string; to: string; firstYear: number }> = [];
  for (let index = 1; index < annual.length; index++) {
    const previous = annual[index - 1], current = annual[index];
    if (previous.fiscalYearEnd !== current.fiscalYearEnd) changes.push({ fileKey: current.fileKey, from: previous.fiscalYearEnd!, to: current.fiscalYearEnd!, firstYear: Number(current.periodEndIso!.slice(0, 4)) });
  }
  void monthIndex;
  return changes;
}
