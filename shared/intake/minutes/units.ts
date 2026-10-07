/** Linearises intake blocks into addressable "units" (lines or cell lines) for
 * the deterministic minutes extractor. Tables are interpreted by their header:
 * minutes tables (Agenda Item | Discussion | Action/WHO | FOR), label/value
 * fact tables, and name/affiliation attendance tables. */
import type { IntakeBlock, IntakeCell } from "../blocks";
import type { Locator } from "../schemas/common";

export type ColumnRole = "number" | "title" | "discussion" | "action" | "due" | "other";
export type Unit = {
  text: string;
  blockIndex: number;
  page?: number;
  cell?: string;
  part?: string;
  role?: ColumnRole | "section" | "pair" | "fact";
  /** For minutes-table rows: the row's section number/title. */
  section?: { number?: string; title: string; titleUnit?: Unit };
  /** Paired affiliation for name/affiliation tables. */
  pairText?: string;
  pairCell?: string;
  /** Due text aligned with an action line in the same row. */
  dueText?: string;
  dueCell?: string;
  /** Action-register rows: the assignee and status columns. */
  assigneeText?: string;
  assigneeCell?: string;
  statusText?: string;
  listLevel?: number;
  rowKey?: string;
};

export function unitLocator(unit: Unit, quote?: string): Locator {
  const text = (quote ?? unit.text).trim();
  return {
    kind: unit.cell ? "cell" : "block",
    blockIndex: unit.blockIndex,
    ...(unit.page ? { page: unit.page } : {}),
    ...(unit.cell ? { cell: unit.cell } : {}),
    quote: text.length > 400 ? text.slice(0, 400) : text,
  };
}

const BULLET = /^[\s•●▪◦·\-–*]+/;
export const stripBullet = (value: string) => value.replace(BULLET, "").trim();

function cellLines(cell: IntakeCell | undefined): string[] {
  if (!cell) return [];
  return cell.text.split("\n").map((line) => line.replace(/\s+$/g, "")).filter((line) => line.trim());
}

/** Column roles from a header row. "Agenda Item" spanning two grid columns covers number + title. */
function headerRoles(block: IntakeBlock): Map<number, ColumnRole> | null {
  const header = block.rows?.[0];
  if (!header) return null;
  const texts = header.cells.map((cell) => cell.text.trim().toLowerCase());
  const hasItem = texts.some((text) => /^(?:agenda\s*item|item|topic|#|no\.?|agenda)$|agenda item/.test(text));
  const contentColumns = texts.filter((text) => /discussion|notes|summary|details|group action|update|responsibilit|minutes|decision/.test(text)).length;
  if (!hasItem || (!contentColumns && texts.filter(Boolean).length < 2)) return null;
  const roles = new Map<number, ColumnRole>();
  const nonEmpty = header.cells.filter((cell) => cell.text.trim());
  header.cells.forEach((cell) => {
    const text = cell.text.trim().toLowerCase();
    const col = Number(/C(\d+)$/.exec(cell.cell)?.[1] ?? 0);
    const span = cell.colSpan ?? 1;
    if (!text) return;
    if (/agenda\s*item|^item$|^topic$|^agenda$/.test(text)) {
      if (span >= 2) {
        roles.set(col, "number");
        roles.set(col + 1, "title");
      } else roles.set(col, "title");
    } else if (/^(?:#|no\.?)$/.test(text)) roles.set(col, "number");
    else if (nonEmpty.length <= 2) roles.set(col, "discussion");
    else if (/discussion|notes|summary|details|minutes|update/.test(text)) roles.set(col, "discussion");
    else if (/group action|responsibilit/.test(text) && ![...roles.values()].includes("discussion")) roles.set(col, "discussion");
    else if (/action|who|responsib|assigned|lead|owner/.test(text)) roles.set(col, "action");
    else if (/\bfor\b|due|date|when|deadline|timeline|by when/.test(text)) roles.set(col, "due");
    else roles.set(col, "other");
  });
  return [...roles.values()].includes("discussion") ? roles : null;
}

/** Action registers: Item | Description | Date Added | Assigned to | Date Due | Status | Notes. */
type RegisterRole = "number" | "description" | "assignee" | "due" | "status" | "other";
function registerRoles(block: IntakeBlock): Map<number, RegisterRole> | null {
  const header = block.rows?.[0];
  if (!header) return null;
  const texts = header.cells.map((cell) => cell.text.trim().toLowerCase());
  if (!texts.some((text) => /^(?:description|action(?: item)?s?|task|item description)$/.test(text)) || !texts.some((text) => /assigned|responsib|^who$|owner|lead/.test(text))) return null;
  const roles = new Map<number, RegisterRole>();
  header.cells.forEach((cell) => {
    const text = cell.text.trim().toLowerCase();
    const col = Number(/C(\d+)$/.exec(cell.cell)?.[1] ?? 0);
    if (!text) return;
    if (/^(?:item\s*#?|#|no\.?)$/.test(text)) roles.set(col, "number");
    else if (/description|action|task/.test(text)) roles.set(col, "description");
    else if (/assigned|responsib|who|owner|lead/.test(text)) roles.set(col, "assignee");
    else if (/due|deadline|by when|target/.test(text)) roles.set(col, "due");
    else if (/status/.test(text)) roles.set(col, "status");
    else roles.set(col, "other");
  });
  return roles;
}

const CATEGORY_LINE = /^(?:members\s+|directors\s+|board\s+members\s+)?(?:present|in attendance|attendees|attendance|participants|regrets|apologies|absent|staff|guests?|observers|also present|proxies)\s*:?\s*$/i;

function isFactTable(block: IntakeBlock): boolean {
  const rows = block.rows ?? [];
  if (!rows.length || rows.length > 8) return false;
  const labelled = rows.filter((row) => row.cells.some((cell) => /^(?:date|time|subject|location|chair|recorder|place|venue)\s*:?$/i.test(cell.text.trim())));
  return labelled.length >= 2;
}

function isPairTable(block: IntakeBlock): boolean {
  const rows = block.rows ?? [];
  const width = Math.max(0, ...rows.map((row) => row.cells.filter((cell) => cell.text.trim()).length));
  if (width === 0 || width > 2 || rows.length === 0) return false;
  // Name lists: the first column of most rows starts with a capitalised name.
  const firstColumn = rows.map((row) => row.cells[0]?.text.trim() ?? "").filter(Boolean);
  return firstColumn.length > 0 && firstColumn.filter((text) => /^[A-Z][a-z'’-]+\s+[A-Z]/.test(text) || CATEGORY_LINE.test(text.split("\n")[0])).length >= Math.ceil(firstColumn.length * 0.6);
}

/** Soft-wrapped PDF lines are joined unless the next line starts a new item. */
function mergeSoftWraps(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const starts = /^\s*(?:[•●▪◦*\-–]\s|ACTION|Action\s*:|[A-Z][\w ]{0,40}:\s|\d{1,2}[.)]?\s|[a-z][.)]\s|Q:|A:|Next |Present|Regrets|Staff|Guests|Absent|Page \d)/.test(line);
    if (out.length && !starts && !/[:]$/.test(out[out.length - 1])) out[out.length - 1] = `${out[out.length - 1].replace(/-$/, "")}${/-$/.test(out[out.length - 1]) ? "" : " "}${line.trim()}`;
    else out.push(line);
  }
  return out;
}

export function linearize(blocks: IntakeBlock[], options: { softWrap?: boolean } = {}): Unit[] {
  const units: Unit[] = [];
  // A minutes table split by a page break continues in a header-less table with the same grid.
  let lastMinutes: { roles: Map<number, ColumnRole>; width: number; blockIndex: number } | null = null;
  for (const block of blocks) {
    if (block.kind === "page_break" || block.kind === "image") continue;
    if (block.kind === "table") {
      const rows = block.rows ?? [];
      const register = registerRoles(block);
      if (register) {
        rows.slice(1).forEach((row) => {
          const pick = (role: RegisterRole) => row.cells.filter((cell) => register.get(Number(/C(\d+)$/.exec(cell.cell)?.[1] ?? 0)) === role && cell.text.trim())[0];
          const description = pick("description");
          if (!description) return;
          const assignee = pick("assignee"), due = pick("due"), status = pick("status");
          units.push({
            text: description.text.replace(/\s*\n\s*/g, " ").trim(), blockIndex: block.index, page: block.page, cell: description.cell, role: "action",
            ...(assignee ? { assigneeText: assignee.text.replace(/\s*\n\s*/g, " ").trim(), assigneeCell: assignee.cell } : {}),
            ...(due ? { dueText: due.text.replace(/\s*\n\s*/g, " ").trim(), dueCell: due.cell } : {}),
            ...(status ? { statusText: status.text.replace(/\s*\n\s*/g, " ").trim() } : {}),
          });
        });
        continue;
      }
      const width = Math.max(0, ...rows.map((row) => row.cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0)));
      const ownRoles = headerRoles(block);
      const continued = !ownRoles && lastMinutes && lastMinutes.width === width && blocks.slice(lastMinutes.blockIndex + 1, block.index).every((between) => between.kind === "page_break" || !between.text.trim() || between.kind === "table");
      const roles = ownRoles ?? (continued ? lastMinutes!.roles : null);
      if (roles) {
        lastMinutes = { roles, width, blockIndex: block.index };
        (ownRoles ? rows.slice(1) : rows).forEach((row, rowIndex) => {
          const byRole = (role: ColumnRole) => row.cells.filter((cell) => roles.get(Number(/C(\d+)$/.exec(cell.cell)?.[1] ?? 0)) === role);
          const numberCell = byRole("number")[0];
          const titleCell = byRole("title")[0];
          let number = numberCell?.text.trim().replace(/[.)]$/, "") || undefined;
          const titleLines = cellLines(titleCell).map(stripBullet);
          const numbered = !number && titleLines.length ? /^(\d{1,2}(?:\.\d{1,2})?)[.)]?\s+(\S.*)$/.exec(titleLines[0]) : null;
          if (numbered) {
            number = numbered[1];
            titleLines[0] = numbered[2];
          }
          const rowKey = `${block.index}:${rowIndex + (ownRoles ? 2 : 1)}`;
          let section: Unit["section"];
          if (titleLines.length) {
            const titleUnit: Unit = { text: titleLines[0], blockIndex: block.index, page: block.page, cell: titleCell!.cell, role: "title", rowKey };
            section = { number, title: titleLines[0], titleUnit };
            units.push({ ...titleUnit, role: "section", section });
            for (const extra of titleLines.slice(1)) units.push({ text: extra, blockIndex: block.index, page: block.page, cell: titleCell!.cell, role: "title", section, rowKey });
          }
          for (const cell of byRole("discussion")) for (const line of cellLines(cell)) units.push({ text: line.trim(), blockIndex: block.index, page: block.page, cell: cell.cell, role: "discussion", section, rowKey });
          const dueCells = byRole("due");
          const dueLines = dueCells.flatMap((cell) => cellLines(cell).map((text) => ({ text: stripBullet(text), cell: cell.cell })));
          const actionLines = byRole("action").flatMap((cell) => cellLines(cell).map((text) => ({ text, cell: cell.cell })));
          actionLines.forEach((line, index) => {
            const due = dueLines.length === actionLines.length ? dueLines[index] : dueLines.length === 1 ? dueLines[0] : undefined;
            units.push({ text: line.text.trim(), blockIndex: block.index, page: block.page, cell: line.cell, role: "action", section, rowKey, ...(due ? { dueText: due.text, dueCell: due.cell } : {}) });
          });
          for (const cell of byRole("other")) for (const line of cellLines(cell)) units.push({ text: line.trim(), blockIndex: block.index, page: block.page, cell: cell.cell, role: "other", section, rowKey });
        });
        continue;
      }
      if (isFactTable(block)) {
        for (const row of rows) {
          const cells = row.cells.filter((cell) => cell.text.trim());
          if (!cells.length) continue;
          units.push({ text: cells.map((cell) => cell.text.trim().replace(/\n/g, " ")).join(" ").replace(/:\s*/, ": "), blockIndex: block.index, page: block.page, cell: cells[cells.length - 1].cell, role: "fact" });
        }
        continue;
      }
      if (isPairTable(block)) {
        for (const row of rows) {
          const [left, right] = row.cells.filter((cell) => cell.text.trim()).concat([undefined as any, undefined as any]);
          const leftLines = cellLines(left);
          const rightLines = cellLines(right);
          const nameLines = leftLines.filter((line) => !CATEGORY_LINE.test(line.trim()));
          const aligned = nameLines.length === rightLines.length;
          let pairIndex = 0;
          for (const line of leftLines) {
            if (CATEGORY_LINE.test(line.trim())) {
              units.push({ text: line.trim(), blockIndex: block.index, page: block.page, cell: left!.cell });
              continue;
            }
            const pair = aligned ? rightLines[pairIndex] : nameLines.length === 1 ? rightLines.join(", ") : undefined;
            pairIndex += 1;
            units.push({ text: line.trim(), blockIndex: block.index, page: block.page, cell: left!.cell, role: "pair", ...(pair ? { pairText: pair.trim(), pairCell: right!.cell } : {}) });
          }
        }
        continue;
      }
      for (const row of rows) for (const cell of row.cells) for (const line of cellLines(cell)) units.push({ text: line.trim(), blockIndex: block.index, page: block.page, cell: cell.cell, role: "other" });
      continue;
    }
    const raw = block.text.split("\n").filter((line) => line.trim());
    // PDF soft wraps are joined by the PDF extractor (right-edge test); this only
    // re-joins wrapped lines when a caller asks for it on other text sources.
    const lines = options.softWrap && block.part === "soft-wrapped" ? mergeSoftWraps(raw) : raw;
    for (const line of lines) units.push({ text: line.replace(/\s+$/, ""), blockIndex: block.index, page: block.page, part: block.part, ...(block.kind === "list_item" ? { listLevel: block.level ?? 0 } : {}) });
  }
  return units;
}
