/** Package splitter: finds the documents embedded in a meeting package, a
 * consent agenda or an AGM package (cover, agenda, previous minutes, reports,
 * statements, forms) as block ranges, and re-classifies each part. */
import type { IntakeBlock, IntakeExtract } from "../blocks";
import { classifyPrior } from "../classify";
import { bodyFromText } from "../minutes/extractMinutes";
import { findDates } from "../parse";
import type { DocClass } from "../schemas/common";

export type PackageSegment = {
  blockStart: number;
  blockEnd: number;
  title: string;
  titleBlock: number;
  docClass: DocClass | "cover";
  confidence: number;
  itemRef?: string;
  date?: { iso: string; precision: "day" | "month" | "year"; text: string; blockIndex: number };
  bodyLabel?: string;
  reason: string;
};

const DOC_TITLE = /^(?:[\w&,.’'()/\-–— ]{0,70}?\s?)?(?:meeting\s+)?(?:agenda|minutes|draft minutes|meeting minutes|notes|report|briefing(?: note)?|financial (?:statements?|report|update)|balance sheet|income statement|statement of (?:operations|financial position)|budget|terms of reference|policy|proxy(?: form| representative form)?|representative form|nomination form|consent to act(?: as a director)?|notice(?: to (?:public|directors|members))?|press release|media release|summary|workplan|work plan|strategic plan)\b[\w ,.’'()/\-–:\t]{0,60}$/i;
const ITEM_REF = /^\s*(?:item|attachment)\s*#?\s*(\d+(?:\.\d+)?(?:\s*&\s*\d+)?)\b/i;
const NOT_TITLE = /^\s*(?:\d{1,2}[.)]|[a-h][.)]|[•●▪◦·\-–*]|review|adoption|approval|receipt|adopt|approve|welcome|call to order|next|upcoming)|^\s*agenda items?\s*:?\s*$|^\s*agenda item\b|^\s*(?:draft\s+)?minutes\s*:\s*$/i;
const ATTENDANCE_START = /^\s*(?:(?:members|directors|board members)\s+)?(?:present|participants|in attendance)\s*:?\s*$/i;
const FACT_LABEL = /^\s*(?:meeting\s+)?(?:date|subject|location|issued by|date issued|period|time)\s*:/i;

function firstLine(block: IntakeBlock): string {
  const lines = block.kind === "table" ? [] : block.text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].length <= 30 && /\b(?:agenda|minutes|package|report)\b/i.test(lines[1]) && lines[1].length <= 60) return `${lines[0]} ${lines[1]}`;
  if (block.kind === "table") {
    const cell = block.rows?.flatMap((row) => row.cells).find((candidate) => candidate.text.trim());
    return (cell?.text ?? "").split("\n").find((line) => line.trim())?.trim() ?? "";
  }
  return block.text.split("\n").find((line) => line.trim())?.trim() ?? "";
}

function isFactTable(block: IntakeBlock): boolean {
  if (block.kind !== "table") return false;
  const cells = (block.rows ?? []).flatMap((row) => row.cells.map((cell) => cell.text.trim()));
  return cells.filter((text) => /^(?:date|subject|location|period|to|from)\s*:/i.test(text) || /^(?:date|subject|location):?\s*\n/i.test(`${text}\n`)).length >= 2 || cells.some((text) => /\bdate\s*:[\s\S]*\bsubject\s*:/i.test(text));
}

function hasFactsNear(blocks: IntakeBlock[], position: number): boolean {
  for (const block of blocks.slice(position, position + 3)) {
    if (isFactTable(block)) return true;
    const lines = block.kind === "table" ? [] : block.text.split("\n");
    if (lines.slice(0, 4).some((line) => FACT_LABEL.test(line))) return true;
  }
  return false;
}

/** An agenda table: Agenda Item with Responsibility / Group Action / Time columns (not a minutes Discussion table). */
export function isAgendaTable(block: IntakeBlock): boolean {
  if (block.kind !== "table") return false;
  const header = (block.rows?.[0]?.cells ?? []).map((cell) => cell.text.trim().toLowerCase());
  return header.some((text) => /agenda item|^item$|^topic$/.test(text)) && header.some((text) => /responsib|group action|presenter|^lead$|^time$|requested action|^action$/.test(text)) && !header.some((text) => /discussion|notes|minutes/.test(text));
}

function isAgendaHead(block: IntakeBlock): boolean {
  const text = block.kind === "table" ? (block.rows ?? []).slice(0, 4).map((row) => row.cells.map((cell) => cell.text).join(" ")).join(" ") : block.text.split("\n").slice(0, 4).join(" ");
  return /\bagenda\b/i.test(text) && !/\bminutes\b/i.test(text);
}

function segmentDate(blocks: IntakeBlock[]): PackageSegment["date"] {
  for (const block of blocks.slice(0, 6)) {
    const texts = block.kind === "table" ? (block.rows ?? []).flatMap((row) => row.cells.map((cell) => cell.text)) : [block.text];
    for (const text of texts) {
      for (const line of text.split("\n")) {
        if (/\b(?:next|previous|upcoming)\b/i.test(line) && !/previous .*minutes\s+date/i.test(line)) continue;
        const date = findDates(line)[0];
        if (date?.precision === "day") return { iso: date.iso, precision: "day", text: date.text, blockIndex: block.index };
      }
    }
  }
  return undefined;
}

function classifySegment(title: string, head: string, isFirst: boolean): { docClass: PackageSegment["docClass"]; confidence: number } {
  if (isFirst && /\bpackage\b|information package|board book|\bbinder\b/i.test(title)) return { docClass: "cover", confidence: 0.8 };
  if (/\bminutes\b/i.test(title) || /subject\s*:?\s*(?:draft\s+)?(?:meeting\s+)?minutes/i.test(head.slice(0, 600))) return { docClass: "meetingMinutes", confidence: 0.85 };
  if (/\bagenda\b/i.test(title) || /subject\s*:?\s*agenda\b/i.test(head.slice(0, 400))) return { docClass: "agenda", confidence: 0.85 };
  if (/\b(?:present|participants|regrets)\s*:/i.test(head.slice(0, 1500)) && /\b(?:called to order|adjourn|motion|discussion)/i.test(head)) return { docClass: "meetingMinutes", confidence: 0.7 };
  const prior = classifyPrior({ name: title, headText: head });
  if (prior.docClass === "unclassified" && /\breport\b|\bbriefing\b|\bupdate\b/i.test(title)) return { docClass: "report", confidence: 0.6 };
  return { docClass: prior.docClass, confidence: prior.confidence };
}

/** Splits a package into parts. Returns one segment for a plain document. */
export function splitPackage(extract: IntakeExtract): PackageSegment[] {
  const body = extract.blocks.filter((block) => (!block.part || block.part === "body") && block.kind !== "page_break");
  if (!body.length) return [];
  const starts: Array<{ position: number; reason: string; itemRef?: string; title?: string }> = [{ position: 0, reason: "document start" }];
  let linesSinceStart = 0;
  let sawAgendaTable = isAgendaTable(body[0]);
  for (let position = 1; position < body.length; position++) {
    const block = body[position];
    const previous = body[position - 1];
    const line = firstLine(block);
    linesSinceStart += Math.max(1, block.text.split("\n").length);
    if (!line) continue;
    const newPage = Boolean(block.page && previous.page && block.page !== previous.page);
    const pageBreakBefore = extract.blocks.slice(previous.index + 1, block.index).some((candidate) => candidate.kind === "page_break");
    const item = ITEM_REF.exec(line);
    const laterItem = block.kind !== "table" ? block.text.split("\n").slice(1).map((candidate) => candidate.trim()).find((candidate) => ITEM_REF.test(candidate) && DOC_TITLE.test(candidate.replace(ITEM_REF, "").trim())) : undefined;
    let reason: string | undefined;
    if (/documentlabel|^title$/i.test(block.style ?? "") && line.length > 3) reason = "document label style";
    else if (item && line.length <= 120 && block.kind !== "list_item") reason = `item reference ${item[1]}`;
    else if (laterItem) reason = `item reference ${ITEM_REF.exec(laterItem)![1]} (mid-block)`;
    else if (block.kind !== "list_item" && line.length <= 110 && DOC_TITLE.test(line) && !NOT_TITLE.test(line) && (newPage || pageBreakBefore || hasFactsNear(body, position) || /DRAFT MINUTES/.test(line)) && linesSinceStart >= 4) reason = newPage || pageBreakBefore ? "title at top of page" : "title followed by date/subject";
    else if (isFactTable(block) && linesSinceStart >= 6 && !FACT_LABEL.test(firstLine(previous)) && !isFactTable(previous)) reason = "date/subject table";
    else if (block.kind !== "list_item" && /^[A-Z][\w&’' –-]{2,60}\b(?:Meeting|Committee)(?:\s*[–-]\s*\w+(?:\s+\d{4})?)?\s*$/.test(line) && !/^(?:next|upcoming|previous)\b/i.test(line) && hasFactsNear(body, position) && linesSinceStart >= 6) reason = "meeting header";
    else if (/^\s*(?:the undersigned|i,|consent to act)/i.test(line) && (pageBreakBefore || newPage)) reason = "form";
    else if (ATTENDANCE_START.test(line) && linesSinceStart >= 6 && (sawAgendaTable || isAgendaHead(body[starts[starts.length - 1].position]))) reason = "attendance list after the agenda";
    if (isAgendaTable(block)) sawAgendaTable = true;
    if (!reason) continue;
    sawAgendaTable = isAgendaTable(block);
    // A bare "Item 3.1" / "Attachment 3.1" label belongs to the next document.
    const last = starts[starts.length - 1];
    if (last.position === position - 1 && /^item|^attachment/i.test(last.reason) && (body[position - 1].text.split("\n").length <= 1)) {
      last.reason = `${last.reason}; ${reason}`;
      continue;
    }
    // "Draft Minutes:" right after the meeting header/participants is part of the same minutes.
    if (/^draft minutes\s*:?$/i.test(line)) continue;
    starts.push({ position, reason, ...(item ? { itemRef: item[1] } : laterItem ? { itemRef: ITEM_REF.exec(laterItem)![1], title: laterItem } : {}) });
    linesSinceStart = 0;
  }
  const segments: PackageSegment[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1].position - 1 : body.length - 1;
    const blocks = body.slice(start.position, end + 1);
    if (!blocks.length) continue;
    const titleBlock = blocks.find((block) => firstLine(block) && !ITEM_REF.test(firstLine(block)) || false) ?? blocks[0];
    let title = firstLine(titleBlock);
    const item = ITEM_REF.exec(firstLine(blocks[0]));
    let titleBlockIndex = titleBlock.index;
    if (item && firstLine(blocks[0]).replace(ITEM_REF, "").trim().length > 3) {
      title = firstLine(blocks[0]);
      titleBlockIndex = blocks[0].index;
    }
    if (start.title) {
      title = start.title;
      titleBlockIndex = blocks[0].index;
    }
    const head = blocks.map((block) => block.kind === "table" ? (block.rows ?? []).map((row) => row.cells.map((cell) => cell.text).join("\t")).join("\n") : block.text).join("\n").slice(0, 3000);
    const { docClass, confidence } = classifySegment(title, head, index === 0);
    const date = segmentDate(blocks);
    const bodyKind = bodyFromText(title) ?? (docClass === "agenda" || docClass === "meetingMinutes" || docClass === "cover" ? bodyFromText(head.split("\n").slice(0, 3).join(" ")) : undefined);
    segments.push({
      blockStart: blocks[0].index,
      blockEnd: blocks[blocks.length - 1].index,
      title,
      titleBlock: titleBlockIndex,
      docClass,
      confidence,
      ...(start.itemRef ? { itemRef: start.itemRef } : {}),
      ...(date ? { date } : {}),
      ...(bodyKind ? { bodyLabel: bodyKind.label } : {}),
      reason: start.reason,
    });
  }
  // A cover page directly followed by the agenda keeps its own segment only when it has content beyond letterhead.
  return segments;
}
