/** Deterministic meeting-minutes extractor: the no-key fallback engine and the
 * baseline every LLM run is compared with. Table-aware, motion-aware and
 * attendance-aware; every value carries a locator quoting the source span,
 * a status and a confidence. It never invents a date, time or outcome. */
import { isPositionedTextMethod, type IntakeExtract } from "../blocks";
import { findDates, findDatesWithoutYear, findTimeRange, parseTime, type DateMatch } from "../parse";
import { isOrgWord, isRoleWord, looksLikeNameFragment, looksLikePersonName, referenceMatches, splitLeadingName } from "../names";
import { inferred, notStated, stated, type ExtractionEnvelope, type FieldValue, type Locator, type Reference, type UnsupportedDetail } from "../schemas/common";
import { MEETING_MINUTES_SCHEMA_VERSION, type ActionItemRecord, type AttendanceEntry, type MeetingMinutesRecord, type MotionRecord } from "../schemas/meetingMinutes";
import { linearize, stripBullet, unitLocator, type Unit } from "./units";

export const DETERMINISTIC_MINUTES_ENGINE = "deterministic-minutes/1";

export type MinutesInput = { fileId: string; fileName: string; path?: string; extract: IntakeExtract };

type Category = AttendanceEntry["category"]["value"] & string;
type PersonValue = { nameAsWritten: string; role?: string; affiliation?: string; resolvedName?: string };

// ---------------------------------------------------------------- patterns
const NAME = String.raw`[A-Z][\w'’.\-]*(?:\s+(?:of\s+|de\s+|van\s+|&\s+)?[A-Z][\w'’.\-]*){0,4}`;
const ATTENDANCE_LABEL = /^\s*(?:(?:members|directors|board members|voting members|committee members)\s+)?(present|in attendance|attendees|attendance|participants|regrets|apologies|absent with regrets|absent|not present|staff present|staff|secretariat|guests?|observers?|also present|also attending|visitors|proxies|proxy)\s*(?::|\t|$)\s*/i;
const BODY_START = /^\s*(?:(?:draft\s+|meeting\s+)?minutes|business arising(?: and current)?|agenda item(?:s)?(?:\s|\t).*|discussion)\s*:?\s*$/i;
const NUMBERED_HEADING = /^\s*(\d{1,2}|[ivx]{1,4}|[a-h])[.)]\s+(.{2,100})$/i;
const ORG_LINE = /\b(?:society|roundtable|association|incorporated|inc\.|ltd\.?|corporation|foundation|council)\b/i;
const TITLE_HINT = /\b(?:meeting|minutes|agm|annual general|summary|notes)\b/i;
const VIRTUAL = /\b(?:zoom|ms teams|microsoft teams|teams|webex|google meet|virtual|teleconference|online|video ?conference|conference call)\b/i;

const CATEGORY_OF: Array<[RegExp, Category]> = [
  [/^(?:regrets|apologies|absent with regrets)/i, "regrets"],
  [/^(?:absent|not present)/i, "absent"],
  [/^(?:staff|secretariat)/i, "staff"],
  [/^(?:guests?|observers?|visitors|also)/i, "guest"],
  [/^prox/i, "proxy"],
];
function categoryFor(label: string): Category {
  for (const [re, category] of CATEGORY_OF) if (re.test(label.trim())) return category;
  return "present";
}

// ---------------------------------------------------------------- helpers
/** Case-insensitive keywords without making the capitalised NAME pattern case-insensitive. */
function ci(pattern: string): string {
  let out = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "\\") {
      out += char + (pattern[index + 1] ?? "");
      index++;
    } else if (/[a-z]/i.test(char)) out += `[${char.toUpperCase()}${char.toLowerCase()}]`;
    else out += char;
  }
  return out;
}
const fv = <T,>(value: T, unit: Unit, quote?: string, confidence = 0.85, status: "stated" | "inferred" = "stated", note?: string): FieldValue<T> =>
  status === "stated" ? stated(value, [unitLocator(unit, quote)], confidence, note) : inferred(value, [unitLocator(unit, quote)], confidence, note);

function cleanName(value: string): string {
  return value.replace(/^[\s•●\-–*]+/, "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
}

function splitOutsideParens(value: string, separator = ","): string[] {
  const out: string[] = [];
  let depth = 0, current = "";
  for (const char of value) {
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === separator && depth === 0) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter(Boolean);
}

type EntryFlags = { chair?: boolean; recorder?: boolean; proxy?: boolean; guest?: boolean; staff?: boolean; proxyFor?: string };
type ParsedEntry = { name: string; role?: string; affiliation?: string; flags: EntryFlags; raw: string };

function classifyTail(tail: string, flags: EntryFlags): { role?: string; affiliation?: string } {
  let rest = tail.replace(/\s+/g, " ").trim().replace(/^[,–—-]\s*/, "");
  if (!rest) return {};
  if (/\bguest\b/i.test(rest)) {
    flags.guest = true;
    rest = rest.replace(/,?\s*\bguests?\b,?\s*/i, " ").trim();
  }
  if (/\bstaff\b/i.test(rest)) flags.staff = true;
  if (/\bprox(?:y|ies)\b/i.test(rest)) {
    flags.proxy = true;
    rest = rest.replace(/\s*\bproxy\b\s*/i, " ").trim();
  }
  if (/\b(?:minute (?:recorder|taker)|recording secretary|note[- ]?taker|recorder)\b/i.test(rest)) flags.recorder = true;
  // "Carrier Lumber (chair)", "Northern Health Authority, chair", "(chair & notes)": the row's person chaired.
  const chairNote = /(?:^|[(,;–—-]\s*|\s)(?:meeting\s+)?chair(?:person)?(?:\s*(?:&|and|\/)\s*(notes?|minutes?|recorder|note[- ]?taker))?\s*\)?\s*$/i.exec(rest);
  if (chairNote && !/\b(?:vice|co-?|deputy|past)[\s-]*chair|\b(?:wg|committee|working group|board)\s+chair/i.test(rest)) {
    flags.chair = true;
    if (chairNote[1]) flags.recorder = true;
    rest = rest.slice(0, chairNote.index).replace(/[\s,(–—-]+$/, "").trim();
    if (!rest) return {};
  }
  const words = rest.split(/\s+/);
  let lead = 0;
  while (lead < words.length && isRoleWord(words[lead]) && !/^(?:public|member|members|board|committee|all)$/i.test(words[lead])) lead++;
  if (lead === words.length) return { role: rest };
  if (lead > 0) return { role: words.slice(0, lead).join(" ").replace(/,$/, ""), affiliation: words.slice(lead).join(" ").replace(/^,\s*/, "") };
  const commaParts = splitOutsideParens(rest);
  if (commaParts.length === 2 && commaParts[0].split(/\s+/).every((word) => isRoleWord(word))) return { role: commaParts[0], affiliation: commaParts[1] };
  return { affiliation: rest.replace(/,\s*$/, "") };
}

/** "Quinn Harlow (proxy for Ari Stone)", "Noor Faraday, Secretariat Staff (chair)", "Casey Lark – Public Director". */
function parseEntry(raw: string, pair?: string): ParsedEntry | null {
  const flags: EntryFlags = {};
  const notes: string[] = [];
  let text = raw.replace(/\s+/g, " ").trim().replace(/^[•●\-–*\d.)\s]+(?=[A-Z])/, "");
  text = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const value = inner.trim();
    const proxyFor = /^proxy\s*(?:for|of|,)\s*(.+)$/i.exec(value);
    if (proxyFor) {
      flags.proxy = true;
      const [principal, ...rest] = splitOutsideParens(proxyFor[1]);
      flags.proxyFor = cleanName(principal);
      if (rest.length) notes.push(rest.join(", "));
    } else if (/^proxy$/i.test(value)) flags.proxy = true;
    else if (/\bchair(?:person)?\b/i.test(value) && !/vice|co-?chair|wg|committee|working/i.test(value)) {
      flags.chair = true;
      // "(chair & notes)": the chair also took the minutes.
      if (/note[- ]?taker|\bnotes\b|recorder|minutes/i.test(value)) flags.recorder = true;
      const rest = value.replace(/\bchair(?:person)?\b/i, "").replace(/^\s*(?:&|and|\/)?\s*(?:notes?|minutes?|recorder|note[- ]?taker)\s*$/i, "").trim();
      if (rest) notes.push(rest);
    } else if (/note[- ]?taker|^notes$|recorder|minute taker|minutes/i.test(value)) flags.recorder = true;
    else if (/teleconference|phone|zoom|virtual|remote/i.test(value)) notes.push(value);
    else notes.push(value);
    return " ";
  }).replace(/\s+/g, " ").trim();
  let head = text, tail = "";
  const separator = /\s*,\s*|\s+[–—-]\s+|\t+|\s{2,}/.exec(text);
  if (separator) {
    head = text.slice(0, separator.index);
    tail = text.slice(separator.index + separator[0].length);
  }
  head = cleanName(head);
  if (!looksLikePersonName(head)) {
    const split = splitLeadingName(head);
    if (!split) return null;
    tail = [split.rest, tail].filter(Boolean).join(", ");
    head = split.name;
  }
  const { role, affiliation } = classifyTail([tail, pair].filter(Boolean).join(", "), flags);
  const extra = notes.filter((note) => !/teleconference|phone|zoom|virtual|remote/i.test(note));
  const roleWords = extra.filter((note) => note.split(/[\s,]+/).some((word) => isRoleWord(word)));
  const affWords = extra.filter((note) => !roleWords.includes(note));
  return {
    name: head,
    role: [role, ...roleWords].filter(Boolean).join(", ") || undefined,
    affiliation: [affiliation, ...affWords].filter(Boolean).join(", ") || undefined,
    flags,
    raw,
  };
}

/** Inline list ("Present: A, B (proxy for C), D (MWG Chair)") including glued
 * "Name Organisation" items and role-only fragments that belong to the previous name. */
function parseInlineList(text: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  // "Quinn Harlow (proxy, …) Ari Stone (…)": a missing comma after a parenthetical still separates entries.
  const separated = text.replace(/\s+and\s+(?=[A-Z])/g, ", ").replace(/\)\s+(?=[A-Z][\w'’.-]+\s+[A-Z])/g, "), ");
  const items = splitOutsideParens(separated);
  // "Rui Bastos Harbour Rail, Hana Ortiz Northwind, …": when most items glue an organisation to the
  // name, a three-word item is read as a two-word name plus a one-word organisation.
  const glued = items.filter((item) => item.replace(/\([^)]*\)/g, "").trim().split(/\s+/).length >= 4).length >= Math.max(2, items.length / 3);
  for (const item of items) {
    const words = item.replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
    const entry = glued && words.length === 3 && looksLikePersonName(words.slice(0, 2).join(" ")) && !/[,–-]/.test(item) ? parseEntry(`${words[0]} ${words[1]}, ${words[2]}`) : parseEntry(item);
    if (entry) {
      entries.push(entry);
      continue;
    }
    const previous = entries[entries.length - 1];
    if (!previous) continue;
    const flags = previous.flags;
    const extra = classifyTail(item.replace(/[()]/g, " "), flags);
    if (extra.role) previous.role = [previous.role, extra.role].filter(Boolean).join(", ");
    if (extra.affiliation) previous.affiliation = [previous.affiliation, extra.affiliation].filter(Boolean).join(", ");
  }
  return entries;
}

// ---------------------------------------------------------------- motions
const MOTION_TRIGGERS: RegExp[] = [
  /\bmotion\b(?!s)\s*(?:#?\d+\s*)?(?:[:\-–]|to\b|that\b|by\b|made\b|was\b|carried\b|passed\b|approved\b|moved\b|for\b|re\b)/i,
  /\b(?:it was\s+|was\s+)?moved\s+(?:by\b|that\b|and seconded\b|to\s+(?:adopt|accept|approve|receive|adjourn|terminate|elect|ratify|appoint|amend|rescind|table|defer|waive|transfer|endorse|authori[sz]e|support|send|have|enter|extend|go|accept|confirm|release|allocate|fund|hire|sign|purchase|establish|create|dissolve|close|open|reaffirm|reconsider|recess)\b)/i,
  /(?:^|[,;.(]\s*)(?:[A-Z][\w'’.\-]*\s+){1,3}moves?\s+(?:that|to|for)\b/,
  /\bresolution\s+(?:was\s+)?(?:motioned|moved|passed|adopted|carried)\b/i,
  /\b(?:adopted|passed|approved)\s+(?:a\s+|the\s+)?(?:special|ordinary|extraordinary)\s+resolution\b/i,
  /\bBE IT RESOLVED\b|\bRESOLVED\s*(?:that|:)/,
  /\b(?:made|makes)\s+(?:a\s+)?motion\b/i,
  /\bmotioned\b/i,
  /\bmoved\s*\/\s*seconded\b/i,
  /\(\s*motion\s*\)/i,
];
const MOTION_EXCLUDE = /\bmoved (?:to|into|onto) (?:the )?(?:next|following|another|later|future|a later)\b|\bmoved (?:forward|on|ahead|over|away|along)\b|\b(?:has|have|had) moved\b|\bwas moved to\b(?! (?:adopt|accept|approve|receive|adjourn))/i;

export function isMotionLine(text: string): boolean {
  if (MOTION_EXCLUDE.test(text) && !/\bmotion\b/i.test(text)) return false;
  return MOTION_TRIGGERS.some((re) => re.test(text));
}

const OUTCOMES: Array<[RegExp, MotionRecord["outcome"]["value"] & string]> = [
  [/\b(?:not carried|defeated|failed|lost|did not (?:carry|pass))\b/i, "defeated"],
  [/\bwithdrawn\b/i, "withdrawn"],
  [/\btabled\b/i, "tabled"],
  [/\b(?:deferred|postponed)\b/i, "deferred"],
  [/\b(?:carried|passed|adopted|approved|accepted)\b|\ball in favou?r\b/i, "carried"],
];

function outcomeIn(text: string, allowApproved = true): { value: MotionRecord["outcome"]["value"] & string; match: string } | undefined {
  const paren = /\(\s*((?:motion\s+)?(?:carried|passed|defeated|tabled|withdrawn|deferred|failed|lost)[^)]*)\)/i.exec(text);
  const source = paren ? paren[1] : text;
  for (const [re, value] of OUTCOMES) {
    const m = re.exec(source);
    if (!m) continue;
    if (!allowApproved && value === "carried" && !/carried|passed/i.test(m[0])) continue;
    return { value, match: paren ? paren[0] : m[0] };
  }
  return undefined;
}

type ParsedMotion = {
  text: string;
  movedBy?: string;
  secondedBy?: string;
  outcome?: MotionRecord["outcome"]["value"] & string;
  outcomeQuote?: string;
  byConsensus?: boolean;
  unanimous?: boolean;
  special?: boolean;
  votes?: { for?: number; against?: number; abstain?: number };
};

function firstName(re: RegExp, text: string): string | undefined {
  const m = re.exec(text);
  return m ? cleanName(m[1]) : undefined;
}

const NOT_A_PERSON = /^(?:The|A|An|It|This|That|All|Motion|Moved|Seconded|Carried|Directors?|Members?|Board|Committee|Chair)$/;
/** Confidence of a chair marked in the attendance list ("Avery Quill (Chair)"). Calibrated on the
 * private minutes golden set and the synthetic fixture: every such mark named the chair. */
const CHAIR_FROM_ATTENDANCE = 0.88;

export function parseMotion(line: string): ParsedMotion | null {
  let text = stripBullet(line).replace(/^\(?[a-z0-9]{1,3}[.)]\s+/i, "");
  if (!isMotionLine(text)) return null;
  const result: ParsedMotion = { text: "" };
  // Mover / seconder.
  const nameOk = (name?: string) => (name && !NOT_A_PERSON.test(name) ? name : undefined);
  const slashPair = new RegExp(ci(String.raw`\bmoved\s*/\s*seconded\s*:?\s*`) + String.raw`(${NAME})\s*/\s*(${NAME})`).exec(text)
    ?? new RegExp(String.raw`(?:\bby\s+|\s)(${NAME})\s*/\s*(${NAME})\b(?=\s*(?:[-–—,]\s*)?(?:all\b|carried|approved|passed|\(|$))`).exec(text);
  const labelled = (label: string) => nameOk(firstName(new RegExp(ci(label) + String.raw`\s*[:\-–]\s*(${NAME})`), text));
  result.movedBy = nameOk(slashPair ? cleanName(slashPair[1]) : undefined)
    ?? labelled(String.raw`\b(?:mover|moved by)`)
    ?? nameOk(firstName(new RegExp(String.raw`(${NAME})\s*\(\s*[Mm]otion\s*\)`), text))
    ?? nameOk(firstName(new RegExp(ci(String.raw`^motion\s*[:\-–]\s*`) + String.raw`(${NAME})\s*(?:;|,|$)`), text))
    ?? nameOk(firstName(new RegExp(ci(String.raw`^motion\b`) + String.raw`.{3,}?:\s*(${NAME})\s*$`), text))
    ?? nameOk(firstName(new RegExp(String.raw`(?:moved|motion(?:ed)?|made|resolution was motioned|motion made)\s+by\s+(${NAME})`), text))
    ?? nameOk(firstName(new RegExp(String.raw`(?:^|[.;:]\s+|,\s+)(${NAME})\s+(?:moved|moves|(?:made|makes)\s+(?:a\s+)?motion)\b`), text))
    ?? nameOk(firstName(new RegExp(ci(String.raw`\bmotion\b`) + String.raw`[^()]*?\bby\s+(${NAME})\s*(?:\(|$|,|\.|;)`), text))
    ?? nameOk(firstName(new RegExp(String.raw`(${NAME}),\s*seconded by`), text));
  result.secondedBy = nameOk(slashPair ? cleanName(slashPair[2]) : undefined)
    ?? labelled(String.raw`\b(?:seconder|seconded by|second)`)
    ?? nameOk(firstName(new RegExp(String.raw`(${NAME})\s*\(\s*[Ss]econd(?:ed)?\s*\)`), text))
    ?? nameOk(firstName(new RegExp(ci(String.raw`seconded\s+by\s+`) + String.raw`(${NAME})`), text))
    ?? nameOk(firstName(new RegExp(String.raw`(?:,\s*|\band\s+|^)(${NAME})\s+second(?:ed|s)?\b`), text))
    ?? nameOk(firstName(new RegExp(ci(String.raw`\bsecond(?:ed|er)?\s*[:\-–]\s*`) + String.raw`(${NAME})`), text));
  // "seconded by Casey Lark. Carried." — the name ends at the sentence break before the outcome.
  const trimOutcome = (name?: string) => name?.replace(/\.\s+(?:motion\s+)?(?:carried|defeated|passed|approved|all)\b.*$/i, "").trim();
  result.movedBy = trimOutcome(result.movedBy);
  result.secondedBy = trimOutcome(result.secondedBy);
  if (result.movedBy && result.secondedBy && result.movedBy === result.secondedBy) result.secondedBy = undefined;
  if (/\bby consensus\b|\bconsensus\b/i.test(text)) result.byConsensus = true;
  if (/\bunanimous(?:ly)?\b/i.test(text)) result.unanimous = true;
  if (/\bspecial resolution\b/i.test(text)) result.special = true;
  const forVotes = /(\d+)\s+(?:for|in favou?r)\b/i.exec(text), against = /(\d+)\s+(?:against|opposed)\b/i.exec(text), abstain = /(\d+)\s+abstain/i.exec(text);
  if (forVotes || against || abstain) result.votes = { ...(forVotes ? { for: Number(forVotes[1]) } : {}), ...(against ? { against: Number(against[1]) } : {}), ...(abstain ? { abstain: Number(abstain[1]) } : {}) };

  // Motion text.
  let body: string | undefined;
  const parenMotion = /^(.*?)\s*\(\s*motion\b[^)]*?\b(?:by|made|moved)\b[^)]*\)\s*(.*)$/i.exec(text);
  const nameParen = /\(\s*motion\s*\)/i.test(text) ? text.replace(new RegExp(String.raw`${NAME}\s*\(\s*(?:[Mm]otion|[Ss]econd(?:ed)?)\s*\)`, "g"), " ").replace(/[;,]\s*(?=[;,]|$)/g, " ") : undefined;
  const resolution = /resolution\s+was\s+(?:motioned|moved)[^]*?,?\s+\bthat\s+(.+)$/i.exec(text) ?? new RegExp(ci(String.raw`\bmoved\s*/\s*seconded\s*:?\s*`) + String.raw`${NAME}\s*/\s*${NAME}\s*,?\s*(?:[Tt]hat\s+)?(.+)$`).exec(text);
  const special = /(?:adopted|passed|approved)\s+(?:a\s+|the\s+)?(?:special|ordinary|extraordinary)\s+resolution\s+(?:that\s+)?(.+)$/i.exec(text);
  const resolved = /\b(?:BE IT RESOLVED|RESOLVED)\s*(?:that|:)?\s*(.+)$/.exec(text);
  const madeMotion = new RegExp(String.raw`^(?:${NAME})\s+(?:made|makes)\s+(?:a\s+)?motion\s+(?:to\s+|that\s+)?(.+)$`).exec(text);
  const nameMoved = new RegExp(String.raw`^(?:${NAME})\s+(?:moved|moves)\s+(?:that\s+|to\s+|for\s+)?(.+)$`).exec(text);
  const moved = /^(?:it\s+was\s+)?moved\s+(?:by\s+[^,]+,\s*(?:seconded\s+by\s+[^,]+,\s*)?)?(?:that\s+|to\s+)?(.+)$/i.exec(text);
  const motion = /\bmotion\b\s*(?:#?\d+\s*)?[:\-–]?\s*(?:made\s+by\s+[^,]+,\s*(?:seconded\s+by\s+[^,]+,?\s*)?)?(?:to\s+|that\s+)?(.*)$/i.exec(text);
  if (nameParen !== undefined) body = nameParen;
  else if (parenMotion && parenMotion[1].split(/\s+/).length >= 3) body = `${parenMotion[1]} ${parenMotion[2]}`;
  else if (resolution) body = `That ${resolution[1]}`;
  else if (special) body = special[1];
  else if (resolved) body = resolved[1];
  else if (madeMotion) body = madeMotion[1];
  else if (nameMoved) body = nameMoved[1];
  else if (moved) body = moved[1];
  else if (motion) {
    const prefix = text.slice(0, motion.index).replace(/[,;:\s]+$/, "");
    const tail = motion[1];
    const tailContent = tail.replace(new RegExp(String.raw`^(?:by\s+${NAME}\s*)?(?:,\s*)?(?:seconded\s+by\s+${NAME})?`), "").replace(/\([^)]*\)/g, "").trim();
    body = prefix.split(/\s+/).length >= 3 && (!tailContent || /^by\b/i.test(tail)) ? prefix : tail;
  }
  body = (body ?? text)
    .replace(new RegExp(String.raw`\b(?:by\s+)?${NAME}\s*/\s*${NAME}\b`), " ")
    .replace(/[\s\-–—,]*\ball\s+(?:approved|in favou?r|agreed)\b\.?/i, " ")
    .replace(new RegExp(String.raw`\s*,?\s*(?:motion\s+)?(?:made\s+)?by\s+${NAME}(?:(?:\s*,\s*|\s+and\s+)(?:seconded\s+by\s+${NAME}|${NAME}\s+seconded))?\.?`, "g"), (match) => (/seconded|made by|motion/i.test(match) || /\bby\s+[A-Z]/.test(match) ? " " : match))
    .replace(new RegExp(String.raw`,\s*${NAME}\s+second(?:ed|s)\b\.?`), "")
    .replace(new RegExp(ci(String.raw`,?\s*seconded\s+by\s+`) + NAME), "")
    .replace(/\(\s*(?:motion\s+)?(?:carried|passed|defeated|tabled|withdrawn|deferred|failed|lost)[^)]*\)\.?/gi, "")
    // "… on behalf of the organization. Motion Carried Unanimously." — the outcome sentence is not wording.
    .replace(/(?:^|[.;]|\s)\s*motion\s+(?:was\s+)?(?:carried|passed|accepted|approved|adopted|defeated|failed|lost)(?:\s+(?:unanimously|by consensus|as amended))?\s*[.!]?\s*$/i, "")
    .replace(/,?\s*\b(?:carried|passed)(?:\s+unanimously)?\s*\.?\s*$/i, "")
    .replace(/,?\s*and adopted by consensus[^,]*,?/i, " ")
    .replace(/(?<!\b(?:be|is|was|were|been|being))\s+approved\.?$/i, "")
    .replace(new RegExp(String.raw`${NAME}\s*\(\s*(?:[Mm]otion|[Ss]econd(?:ed)?)\s*\)\s*[;,]?`, "g"), " ")
    .replace(new RegExp(ci(String.raw`[;,]?\s*\b(?:mover|moved by|seconder|second(?:ed)?(?: by)?)\s*[:\-–]\s*`) + NAME, "g"), " ")
    .replace(new RegExp(String.raw`:\s*(${NAME})\s*$`), (match, name: string) => (looksLikePersonName(cleanName(name)) || /^[A-Z]\.\s?[A-Z]/.test(name) ? "" : match))
    .replace(/^\s*(?:carried|passed)\s+/i, "")
    .replace(/\*\*/g, "").replace(/^[\s\-–—;,]+|[\s\-–—;,]+$/g, "")
    .replace(/\s+/g, " ").replace(/^[,;:\s]+|[,;:\s]+$/g, "").trim();
  // A movers-only line ("Moved by A, seconded by B. Carried.") leaves only a connective behind.
  if (/^(?:seconded|second|moved|by|and)$/i.test(body.replace(/[.\s]+$/, ""))) body = "";
  result.text = body;
  // Outcome: explicit outcome outside the motion wording wins over words inside it.
  const outside = text.replace(body, " ");
  const passive = /\b(?:was\s+|were\s+|is\s+)?(approved|adopted|accepted)\b/i.exec(body);
  const found = outcomeIn(outside) ?? outcomeIn(text, false)
    ?? (passive && !/\bbe\s+(?:\w+\s+)?(?:approved|adopted|accepted)\b|\bto\s+(?:approve|adopt|accept)\b/i.test(body) ? { value: "carried" as const, match: passive[0] } : undefined);
  if (found) {
    result.outcome = found.value;
    result.outcomeQuote = found.match;
  }
  if (!result.text || result.text.length < 3 || looksLikePersonName(result.text)) {
    // "Motion: Pat Hale; Second: Sam Ortiz": the wording is implied by the agenda item.
    if (!result.movedBy && !result.secondedBy) return null;
    result.text = "";
  }
  return result;
}

// ---------------------------------------------------------------- actions
const DECISION_LINE = /(?:^|\s)(?:DECISION|Decision)\s*[:\-–]\s*(.+)$/;
const ACTION_LINE = /(?:^|\s)(?:ACTION(?:\s+ITEMS?)?|Action(?:\s+Items?)?)\s*[:\-–]\s*(.*)$/;
const ASSIGNEE_LEAD = new RegExp(String.raw`^((?:${NAME}|[A-Z]{2,3})(?:\s*(?:/|,|&|\band\b)\s*(?:${NAME}|[A-Z]{2,3}))*)\s*(?:[-–—:]\s+|\s+(?:to|will|shall|should|is to|are to)\s+|\s+(?=[a-z]))(.+)$`);

function parseAction(text: string): { text: string; assignee?: string; assigneeOnly?: boolean } | undefined {
  const body = stripBullet(text);
  if (!body) return undefined;
  if (/^(?:all|everyone|board|staff|secretariat|committee)$/i.test(body) || splitOutsideParens(body).every((part) => looksLikeNameFragment(part) || looksLikePersonName(part) || /^(?:all|everyone)$/i.test(part))) {
    return { text: "", assignee: body, assigneeOnly: true };
  }
  const lead = ASSIGNEE_LEAD.exec(body);
  if (lead) {
    const who = lead[1].trim();
    const parts = who.split(/\s*(?:\/|,|&|\band\b)\s*/);
    const plausible = parts.every((part) => looksLikePersonName(part) || looksLikeNameFragment(part) || /^(?:Staff|Secretariat|Board|Committee|Chair|All|Everyone|Operations Committee|Board members|Board Members|SPC members|Members|Directors)$/.test(part) || /^[A-Z][a-z]+(?: [A-Z][a-z]+)? (?:members|Committee|Board)$/i.test(part));
    if (plausible && !/^(?:The|A|An|It|This|There|We)$/.test(parts[0]) && !/^[A-Z]{4,}$/.test(parts[0])) return { text: lead[2].trim(), assignee: who };
  }
  const leading = /^((?:Staff|Secretariat|Board(?: members)?|Operations Committee|SPC members|Members|Directors|Committee))\s+(?:to|will)\s+(.+)$/i.exec(body);
  if (leading) return { text: leading[2], assignee: leading[1] };
  return { text: body };
}

// ---------------------------------------------------------------- body kinds
type BodyKind = MeetingMinutesRecord["body"]["value"] & string;
export function bodyFromText(value: string): { body: BodyKind; label: string; type: MeetingMinutesRecord["meetingType"]["value"] & string } | undefined {
  const text = value.replace(/[_]/g, " ");
  if (/\bAGM\b.{0,6}(?:&|and)\s*board|board.{0,6}(?:&|and)\s*AGM/i.test(text)) return { body: "joint", label: "AGM and Board", type: "joint" };
  if (/annual general meeting|\bAGM\b/i.test(text)) return { body: "agm", label: "Annual General Meeting", type: "annual_general" };
  if (/special general meeting|extraordinary general|\bSGM\b/i.test(text)) return { body: "sgm", label: "Special General Meeting", type: "special_general" };
  if (/\boperations\b|\bops\b/i.test(text)) return { body: "operations", label: "Operations Committee", type: "committee" };
  // "2nd Floor Committee Meeting Room" is a place, not a body; "ORG AQMP Committee" is the AQMP Committee.
  const committee = /\b([A-Z][\w&]*(?:\s+[A-Z][\w&]*){0,3})\s+Committee\b(?!\s+(?:[Mm]eeting\s+|MEETING\s+)?(?:[Rr]oom|ROOM|[Rr]m)\b)/.exec(text);
  const committeeName = committee?.[1].replace(/^[A-Z]{3,}\s+(?=[A-Z]{2,}\b)/, "");
  if (committee && committeeName && /^[A-Z]/.test(committeeName) && !/^(?:Board|Executive|Floor|\d\w*\s+Floor)$/i.test(committeeName) && !/\bfloor$/i.test(committeeName)) return { body: "committee", label: `${committeeName} Committee`, type: "committee" };
  // Working groups named by acronym ("MWG", "RWG_Agenda") or in full are committees, not the board.
  const workingGroup = /\b([A-Z]{1,6}WG)(?:\b|_)/.exec(text) ?? /\b([A-Z][\w&]*(?:\s+[A-Z][\w&]*){0,3})\s+Working Group\b/.exec(text);
  if (workingGroup) return { body: "committee", label: workingGroup[1].endsWith("WG") ? workingGroup[1] : `${workingGroup[1]} Working Group`, type: "committee" };
  if (/\bexecutive\b/i.test(text)) return { body: "executive", label: "Executive Committee", type: "committee" };
  if (/\bboard\b|\bdirectors?['’]?s?\b/i.test(text)) return { body: "board", label: "Board of Directors", type: "regular" };
  if (/\bspecial meeting\b/i.test(text)) return { body: "board", label: "Special Meeting", type: "special" };
  return undefined;
}

function bodyKey(label: string | undefined): string {
  const found = label ? bodyFromText(label) : undefined;
  return found ? `${found.body}:${found.label}` : "unknown";
}

// ---------------------------------------------------------------- main
export function extractMeetingMinutes(input: MinutesInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const units = linearize(extract.blocks, { softWrap: isPositionedTextMethod(extract.method) });
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const nameSource = `${input.path ?? ""} ${fileName}`;
  const fileLocator: Locator = { kind: "filename", quote: fileName };

  // Zones: header → attendance → body.
  let attendanceStart = -1;
  let bodyStart = -1;
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const text = unit.text.trim();
    if (attendanceStart < 0 && ATTENDANCE_LABEL.test(text) && !/^attendance sheet/i.test(text) && index < 80) attendanceStart = index;
    const isBody = unit.role === "section" || BODY_START.test(text) || (attendanceStart >= 0 && index > attendanceStart && (
      (NUMBERED_HEADING.test(text) && !/^\s*[a-h][.)]\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s*[,–-]/.test(text) && /^\s*(?:\d|[ivx]+[.)]|[a-h][.)])/i.test(text) && !parseEntry(text.replace(/^\s*\S+\s+/, ""))?.affiliation)
      || /^\s*(?:meeting\s+)?call(?:ed)?\s+(?:the\s+)?(?:meeting\s+)?to\s+order|^\s*welcome\b|^\s*\d{1,2}\s+welcome\b/i.test(text)
    ));
    if (isBody && (attendanceStart >= 0 ? index > attendanceStart : index > 0)) {
      bodyStart = index;
      break;
    }
  }
  if (bodyStart < 0) bodyStart = attendanceStart >= 0 ? units.length : Math.min(units.length, 12);
  const headerEnd = attendanceStart >= 0 ? attendanceStart : bodyStart;
  const headerUnits = units.slice(0, headerEnd);
  const attendanceUnits = attendanceStart >= 0 ? units.slice(attendanceStart, bodyStart) : [];
  const bodyUnits = units.slice(bodyStart);

  // ---------------------------------------------------------- header
  const record: Partial<MeetingMinutesRecord> & { attendance: AttendanceEntry[]; motions: MotionRecord[]; actionItems: ActionItemRecord[]; sections: MeetingMinutesRecord["sections"] } = { attendance: [], motions: [], actionItems: [], sections: [] };
  let dateUnit: Unit | undefined;
  let dateMatch: DateMatch | undefined;
  const label = (unit: Unit, re: RegExp) => re.exec(unit.text.trim());
  const usedHeader = new Set<Unit>();
  for (const unit of headerUnits) {
    const text = unit.text.trim();
    const dateLabel = label(unit, /^(?:meeting\s+)?date(?:\s*(?:&|and)\s*time)?\s*:\s*(.*)$/i);
    if (dateLabel) {
      const found = findDates(dateLabel[1])[0];
      if (found && !dateMatch) {
        dateMatch = found;
        dateUnit = unit;
        usedHeader.add(unit);
      }
    }
  }
  if (!dateMatch) {
    for (const unit of headerUnits.length ? headerUnits : units.slice(0, 15)) {
      if (/\b(?:next|previous|last)\s+meeting|financial|fiscal|budget/i.test(unit.text)) continue;
      const found = findDates(unit.text)[0];
      if (found) {
        dateMatch = found;
        dateUnit = unit;
        usedHeader.add(unit);
        break;
      }
    }
  }
  const fileDates = findDates(nameSource.replace(/[_]/g, " "), { allowNumericShortYear: true, allowMonthPrecision: true }).filter((date, index, all) => date.precision === "day" && all.findIndex((other) => other.iso === date.iso) === index);
  if (dateMatch && dateUnit) {
    const conflicting = fileDates.length > 0 && !fileDates.some((date) => date.iso === dateMatch!.iso);
    record.date = conflicting
      ? { value: { iso: dateMatch.iso, precision: "day", text: dateMatch.text }, status: "conflicting", confidence: 0.5, locators: [unitLocator(dateUnit, dateMatch.text), { ...fileLocator }], note: `Filename date ${fileDates.map((date) => date.iso).join(", ")} disagrees with the header.` }
      : fv({ iso: dateMatch.iso, precision: "day" as const, text: dateMatch.text }, dateUnit, dateMatch.text, 0.95);
  } else if (fileDates.length === 1) {
    record.date = inferred({ iso: fileDates[0].iso, precision: "day" as const, text: fileDates[0].text }, [{ ...fileLocator, quote: fileName }], 0.55, "Date taken from the file name; no date in the document header.");
  } else {
    const monthOnly = findDates(nameSource.replace(/[_]/g, " "), { allowMonthPrecision: true }).find((date) => date.precision === "month");
    record.date = monthOnly ? inferred({ iso: monthOnly.iso, precision: "month" as const, text: monthOnly.text }, [{ ...fileLocator }], 0.4, "Only month precision is available.") : notStated("No meeting date found.");
    if (monthOnly) unsupported.push({ description: `Meeting date known only to month precision (${monthOnly.text}).`, locators: [{ ...fileLocator }], suggestedTarget: "meetings.datePrecision", category: "lossy_normalization", infoType: "meeting.date_precision" });
  }
  const meetingIso = record.date?.value?.iso;

  // Times: on the date line, a "Time:" line, or the line right after the date.
  const timeCandidates = [dateUnit, ...headerUnits.filter((unit) => /^(?:meeting\s+)?time\s*:/i.test(unit.text.trim())), ...(dateUnit ? [headerUnits[headerUnits.indexOf(dateUnit) + 1]] : [])].filter(Boolean) as Unit[];
  for (const unit of timeCandidates) {
    const range = findTimeRange(unit.text);
    if (range?.start) {
      record.startTime = fv(range.start, unit, range.text, range.inferredMeridiem ? 0.6 : 0.9, range.inferredMeridiem ? "inferred" : "stated");
      if (range.end) record.endTime = fv(range.end, unit, range.text, range.inferredMeridiem ? 0.6 : 0.9, range.inferredMeridiem ? "inferred" : "stated");
      usedHeader.add(unit);
      break;
    }
    const single = parseTime(unit.text.replace(dateMatch?.text ?? "\u0000", " "));
    if (single && /\b(?:am|pm|a\.m\.|p\.m\.)\b|time\s*:/i.test(unit.text)) {
      record.startTime = fv(single.time, unit, single.text, 0.85);
      usedHeader.add(unit);
      break;
    }
  }

  // Location, title, organisation.
  const locationParts: Array<{ unit: Unit; text: string }> = [];
  let titleUnit: Unit | undefined;
  for (let index = 0; index < headerUnits.length; index++) {
    const unit = headerUnits[index];
    const text = unit.text.trim();
    const loc = /^(?:location|place|venue|where)\s*:\s*(.*)$/i.exec(text);
    if (loc) {
      if (loc[1].trim()) locationParts.push({ unit, text: loc[1].trim() });
      for (let next = index + 1; next < headerUnits.length && next <= index + 3; next++) {
        const follow = headerUnits[next];
        if (/^\s*\t|^\s{2,}/.test(follow.text) && !/:\s*$/.test(follow.text) && !/^\s*[A-Z][\w ]{0,20}:/.test(follow.text.trim())) locationParts.push({ unit: follow, text: follow.text.trim() });
        else break;
      }
      continue;
    }
    if (/^(?:subject|re)\s*:/i.test(text) || /^zoom\s*:/i.test(text)) continue;
    if (!titleUnit && TITLE_HINT.test(text) && !findDates(text).length && !/^(?:date|time)\b/i.test(text)) {
      titleUnit = unit;
      continue;
    }
  }
  if (!titleUnit) titleUnit = headerUnits.find((unit) => TITLE_HINT.test(unit.text) && !/^(?:date|time|subject|location)\s*:/i.test(unit.text.trim()));
  if (!locationParts.length && dateUnit) {
    // Unlabelled location: lines after the date/time line, before attendance.
    const start = headerUnits.indexOf(dateUnit) + 1;
    for (let index = start; index < headerUnits.length && locationParts.length < 2; index++) {
      const unit = headerUnits[index];
      const text = unit.text.trim();
      if (usedHeader.has(unit) || /:/.test(text.slice(0, 20)) || findDates(text).length) continue;
      if (findTimeRange(text) || /^\d{1,2}:\d{2}/.test(text)) continue;
      if (TITLE_HINT.test(text) && !/\b(?:room|hall|boardroom|annex|centre|center|office|chambers)\b/i.test(text)) continue;
      locationParts.push({ unit, text });
    }
  }
  if (locationParts.length) {
    // The same location repeated in two header cells ("MS TEAMS" | "MS TEAMS") is stated once.
    const seenParts = new Set<string>();
    const text = locationParts.map((part) => part.text.replace(/^\(|\)$/g, "").trim()).filter((part) => {
      const key = part.toLowerCase().replace(/\s+/g, " ");
      if (seenParts.has(key)) return false;
      seenParts.add(key);
      return true;
    }).join(", ");
    record.location = { value: text, status: "stated", confidence: 0.8, locators: locationParts.map((part) => unitLocator(part.unit, part.text)) };
    record.electronic = VIRTUAL.test(text) ? stated(true, [unitLocator(locationParts[0].unit, locationParts[0].text)], 0.9) : inferred(false, [unitLocator(locationParts[0].unit, locationParts[0].text)], 0.6, "Physical location stated; no electronic participation found in the header.");
  } else {
    const virtual = headerUnits.find((unit) => VIRTUAL.test(unit.text));
    if (virtual) record.electronic = fv(true, virtual, virtual.text.trim(), 0.7, "inferred");
  }
  const orgUnit = headerUnits.find((unit) => ORG_LINE.test(unit.text) && !TITLE_HINT.test(unit.text.replace(/\bmeeting\b/i, "")));
  if (orgUnit) record.organizationName = fv(orgUnit.text.trim(), orgUnit, undefined, 0.7);
  if (titleUnit) record.title = fv(titleUnit.text.trim().replace(/\s+/g, " "), titleUnit, titleUnit.text.trim(), 0.8);

  // Body / meeting type: title, then header, then filename/path.
  const headerText = headerUnits.map((unit) => unit.text).join(" \n ");
  const bodyFound = (titleUnit && bodyFromText(titleUnit.text)) || bodyFromText(headerText);
  const fileBody = bodyFromText(nameSource);
  if (bodyFound) {
    const source = titleUnit && bodyFromText(titleUnit.text) ? titleUnit : headerUnits.find((unit) => bodyFromText(unit.text)) ?? headerUnits[0];
    record.body = fv(bodyFound.body, source, source.text.trim(), 0.85);
    record.bodyLabel = fv(bodyFound.label, source, source.text.trim(), 0.8);
    record.meetingType = fv(bodyFound.type, source, source.text.trim(), 0.8);
  } else if (fileBody) {
    record.body = inferred(fileBody.body, [{ ...fileLocator }], 0.6, "Body taken from the file name or folder path.");
    record.bodyLabel = inferred(fileBody.label, [{ ...fileLocator }], 0.55);
    record.meetingType = inferred(fileBody.type, [{ ...fileLocator }], 0.55);
  } else {
    // A society meeting with no named body is, by default, its governing board; keep it reviewable.
    const source = titleUnit ?? headerUnits[0];
    record.body = source ? inferred("board" as const, [unitLocator(source)], 0.35, "No governing body named; assumed to be the board.") : { value: "unknown", status: "not_stated", confidence: 0.3, locators: [], note: "No governing body named in the header or file name." };
    record.meetingType = source ? inferred("regular" as const, [unitLocator(source)], 0.35) : { value: "unknown", status: "not_stated", confidence: 0.3, locators: [] };
  }
  if (record.body?.value === "joint") unsupported.push({ description: "Joint meeting of two bodies recorded in one set of minutes.", locators: record.body.locators, suggestedTarget: "meetings.jointBodies", category: "no_field", infoType: "meeting.joint" });
  if (/\bcancel+ed\b/i.test(`${nameSource} ${headerText}`)) unsupported.push({ description: "Meeting recorded as cancelled.", locators: [{ ...fileLocator }], suggestedTarget: "meetings.status=cancelled", category: "no_field", infoType: "meeting.cancelled" });

  // Record status: draft / approved markers in the header and file name may conflict.
  const statusText = `${headerText}`;
  const draftInHeader = /\bdraft\b/i.test(statusText), approvedInHeader = /\bapproved\b/i.test(statusText);
  const draftInName = /\bdraft\b/i.test(fileName.replace(/_/g, " ")), approvedInName = /\bapproved\b/i.test(fileName.replace(/_/g, " "));
  const draft = draftInHeader || draftInName, approved = approvedInHeader || approvedInName;
  const statusUnit = headerUnits.find((unit) => /\b(?:draft|approved)\b/i.test(unit.text)) ?? units.find((unit) => /^\s*draft minutes\s*$/i.test(unit.text));
  if (draft && approved) record.recordStatus = { value: "approved", status: "conflicting", confidence: 0.4, locators: [...(statusUnit ? [unitLocator(statusUnit)] : []), { ...fileLocator }], note: "Both DRAFT and APPROVED markers appear; confirm against the adopting motion." };
  else if (draft) record.recordStatus = statusUnit && draftInHeader ? fv("draft" as const, statusUnit, undefined, 0.85) : inferred("draft" as const, [{ ...fileLocator }], 0.7);
  else if (approved) record.recordStatus = statusUnit && approvedInHeader ? fv("approved" as const, statusUnit, undefined, 0.85) : inferred("approved" as const, [{ ...fileLocator }], 0.7);
  else if (units.some((unit) => /^\s*draft minutes\s*$/i.test(unit.text))) record.recordStatus = fv("draft" as const, units.find((unit) => /^\s*draft minutes\s*$/i.test(unit.text))!, undefined, 0.8);
  else record.recordStatus = { value: "recorded", status: "inferred", confidence: 0.5, locators: [], note: "No draft or approval marker." };

  // ---------------------------------------------------------- attendance
  let category: Category = "unlabelled";
  let secondary: { from: number; category: Category } | null = null;
  // Every name the attendance list marks as chair (more than one, or one that disagrees with the text, is a conflict).
  const chairMarks: Array<{ name: string; unit: Unit }> = [];
  const chairCallers: Array<{ name: string; unit: Unit; quote: string }> = [];
  let chairFromText = false;
  const addEntry = (entry: ParsedEntry, unit: Unit, cat: Category) => {
    let resolved: Category = cat;
    if (entry.flags.proxy) resolved = "proxy";
    else if (entry.flags.guest) resolved = "guest";
    else if (entry.flags.staff && (cat === "present" || cat === "unlabelled")) resolved = "staff";
    const loc = unitLocator(unit);
    const row: AttendanceEntry = {
      nameAsWritten: stated(entry.name, [unitLocator(unit, entry.name)], 0.85),
      category: { value: resolved, status: cat === "unlabelled" && resolved === "unlabelled" ? "inferred" : "stated", confidence: cat === "unlabelled" ? 0.5 : 0.85, locators: [loc] },
      ...(entry.role ? { role: stated(entry.role, [loc], 0.75) } : {}),
      ...(entry.affiliation ? { affiliation: stated(entry.affiliation, [entry.affiliation && unit.pairText && entry.affiliation.includes(unit.pairText) ? { ...loc, cell: unit.pairCell, quote: unit.pairText } : loc], 0.75) } : {}),
      ...(entry.flags.proxyFor ? { proxyFor: stated(entry.flags.proxyFor, [loc], 0.85) } : {}),
    };
    if (record.attendance.some((existing) => existing.nameAsWritten.value === entry.name)) return;
    record.attendance.push(row);
    if (entry.flags.chair && !record.chair) record.chair = stated({ nameAsWritten: entry.name, role: "Chair" }, [loc], CHAIR_FROM_ATTENDANCE, "Marked as chair in the attendance list.");
    if (entry.flags.chair) chairMarks.push({ name: entry.name, unit });
    if (entry.flags.recorder && !record.recorder) record.recorder = stated({ nameAsWritten: entry.name, role: entry.role ?? "Recorder" }, [loc], 0.8);
    if (/\b(?:minute recorder|recorder|note-?taker|recording secretary)\b/i.test(entry.role ?? "") && !record.recorder) record.recorder = stated({ nameAsWritten: entry.name, role: entry.role }, [loc], 0.8);
  };
  for (const unit of attendanceUnits) {
    const raw = unit.text;
    const text = raw.trim();
    const labelMatch = ATTENDANCE_LABEL.exec(text);
    if (labelMatch && !/^(?:attendance sheet)/i.test(text)) {
      category = categoryFor(labelMatch[1]);
      secondary = null;
      const rest = text.slice(labelMatch[0].length).trim();
      if (rest) {
        const segments = rest.split(/\t+/).map((part) => part.trim()).filter(Boolean);
        const list = segments.join(", ");
        const entries = splitOutsideParens(list).length >= 2 ? parseInlineList(list) : [parseEntry(rest)].filter(Boolean) as ParsedEntry[];
        for (const entry of entries) addEntry(entry, unit, category);
      }
      continue;
    }
    const segments = raw.split(/\t+|\s{4,}/).map((part) => part.trim()).filter(Boolean);
    const labelAt = segments.findIndex((segment, index) => index > 0 && ATTENDANCE_LABEL.test(segment) && segment.replace(/[:\s]/g, "").length < 14);
    if (labelAt > 0) {
      const primary = segments.slice(0, labelAt);
      const entry = parseEntry(primary[0], primary.slice(1).join(", ") || undefined);
      if (entry) addEntry(entry, unit, category);
      secondary = { from: labelAt, category: categoryFor(ATTENDANCE_LABEL.exec(segments[labelAt])![1]) };
      continue;
    }
    if (secondary && segments.length > secondary.from) {
      const primary = segments.slice(0, secondary.from);
      const other = segments.slice(secondary.from);
      const first = parseEntry(primary[0], primary.slice(1).join(", ") || undefined);
      if (first) addEntry(first, unit, category);
      const second = parseEntry(other[0], other.slice(1).join(", ") || undefined);
      if (second) addEntry(second, unit, secondary.category);
      continue;
    }
    if (unit.role === "pair") {
      const entry = parseEntry(text, unit.pairText);
      if (entry) addEntry(entry, unit, category);
      continue;
    }
    if (segments.length >= 2 && !looksLikePersonName(segments[1])) {
      const entry = parseEntry(segments[0], segments.slice(1).join(", "));
      if (entry) addEntry(entry, unit, category);
      continue;
    }
    const items = splitOutsideParens(text);
    // One entry per line reads "Name, Affiliation"; three or more comma items on a line form a list.
    if (items.length >= 3) {
      for (const entry of parseInlineList(text)) addEntry(entry, unit, category);
      continue;
    }
    const entry = parseEntry(text);
    if (entry) addEntry(entry, unit, category);
  }
  const attendeeNames = record.attendance.map((entry) => entry.nameAsWritten.value!).filter(Boolean);
  const resolveName = (reference: string): string | undefined => {
    const matches = attendeeNames.filter((name) => referenceMatches(reference, name));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const personRef = (name: string, unit: Unit, quote: string, confidence = 0.85, status: "stated" | "inferred" = "stated", note?: string): FieldValue<PersonValue> => {
    const resolvedName = resolveName(name);
    const value: PersonValue = { nameAsWritten: name, ...(resolvedName && resolvedName !== name ? { resolvedName } : {}) };
    return fv(value, unit, quote, confidence, status, note);
  };

  // ---------------------------------------------------------- body
  let currentSection: { number?: string; title: string; unit: Unit } | undefined;
  let currentSub: string | undefined;
  let currentSubUnit: Unit | undefined;
  let lastNonAction: Unit | undefined;
  const sectionOf = (unit: Unit) => unit.section?.title ?? currentSection?.title;
  const quorumCandidates: Array<{ status: "met" | "not_met"; unit: Unit; quote: string; count?: number; position: number }> = [];
  const nextMeetings: Array<{ date?: DateMatch; time?: string; location?: string; body?: string; text: string; unit: Unit; quote: string }> = [];
  const decisions: FieldValue<string>[] = [];
  const attachments: FieldValue<string>[] = [];
  const sessionSegments: NonNullable<MeetingMinutesRecord["sessionSegments"]> = [];
  const seenMotionText = new Set<string>();
  const consumed = new Set<Unit>();

  const pushSection = (title: string, unit: Unit, number?: string, presenter?: string) => {
    currentSection = { number, title, unit };
    currentSub = undefined;
    record.sections.push({
      ...(number ? { number: fv(number, unit, number, 0.8) } : {}),
      title: fv(title, unit, title, 0.85),
      ...(presenter ? { presenter: personRef(presenter, unit, presenter, 0.7) } : {}),
    });
  };

  for (let index = 0; index < bodyUnits.length; index++) {
    const unit = bodyUnits[index];
    const raw = unit.text;
    const text = raw.trim();
    if (!text) continue;
    if (unit.role === "section" && unit.section) {
      pushSection(unit.section.title, unit, unit.section.number);
      if (/\bin[- ]camera\b/i.test(unit.section.title)) sessionSegments.push(fv({ type: "in_camera" as const, title: unit.section.title }, unit, undefined, 0.8));
    } else if (!unit.role || unit.role === "other") {
      const heading = NUMBERED_HEADING.exec(text);
      const presenterHeading = /^(.{3,80}?)\s*\(([A-Z]\.\s?[A-Z][\w'’-]+)\)\s*$/.exec(text);
      if (heading && /^\d/.test(heading[1]) && heading[2].split(/\s+/).length <= 14 && (!/[.]$/.test(heading[2]) || heading[2] === heading[2].toUpperCase())) {
        const titleText = heading[2].split(/\t|[●•]/)[0].trim();
        pushSection(titleText, unit, heading[1]);
      } else if (heading && /^[a-h]$/i.test(heading[1]) && heading[2].split(/\s+/).length <= 8 && !/[.]$/.test(heading[2])) {
        currentSub = heading[2].trim();
        currentSubUnit = unit;
      } else if (presenterHeading && unit.listLevel !== undefined) {
        pushSection(presenterHeading[1].trim(), unit, undefined, presenterHeading[2]);
      } else if (/^\d{1,2}\.?\s+[A-Z][^●•\t]{1,50}(?:\t|[●•])/.test(text)) {
        const pdfHeading = /^(\d{1,2})\.?\s+([A-Z][^●•\t]{1,50}?)\s*(?:\t|[●•])/.exec(text)!;
        pushSection(pdfHeading[2].trim(), unit, pdfHeading[1]);
      }
    }
    const sectionTitle = sectionOf(unit);
    const sectionLocator = (title?: string) => {
      if (!title) return undefined;
      const sectionUnit = unit.section?.titleUnit ?? currentSection?.unit ?? unit;
      const locators = [unitLocator(sectionUnit, unit.section?.title ?? currentSection?.title ?? title)];
      // A sub-item title is cited from its own line.
      if (currentSub && currentSubUnit && !unit.section && title.endsWith(currentSub)) locators.push(unitLocator(currentSubUnit, currentSub));
      return stated(title, currentSection || unit.section ? locators : [unitLocator(currentSubUnit ?? unit, currentSub ?? title)], 0.8);
    };
    if (unit.role === "section") continue;

    // In-camera.
    if (/\bin[- ]camera\b/i.test(text) && !sessionSegments.length) sessionSegments.push(fv({ type: "in_camera" as const, title: stripBullet(text).slice(0, 120) }, unit, undefined, 0.75));

    // Call to order / adjournment.
    if (!record.calledToOrderAt && /call(?:ed|s)?\s+(?:the\s+)?(?:meeting\s+)?to\s+order|\bconvened\b|\bwelcomed at\b|meeting (?:began|started|opened)|opened the meeting/i.test(text)) {
      const time = parseTime(text, { compact: true });
      if (time) record.calledToOrderAt = fv(time.time, unit, time.text, time.inferredMeridiem ? 0.7 : 0.9, time.inferredMeridiem ? "inferred" : "stated");
    }
    // A bare time in the discussion cell of an "Adjourn" item is the adjournment time.
    const adjournCell = unit.role === "discussion" && /\ba[dj]{1,2}ourn/i.test(sectionTitle ?? "") && /^\s*\d{1,2}[:.]\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\s*$/i.test(text);
    if (adjournCell || /\ba[dj]{1,2}ourn|terminat(?:e|ed)\s+the\s+meeting|meeting\s+(?:ended|closed)/i.test(text)) {
      let time = parseTime(text, { compact: true });
      let timeUnit = unit;
      if (!time && text.split(/\s+/).length <= 4) {
        for (const neighbour of [bodyUnits[index - 1], bodyUnits[index + 1]]) {
          if (neighbour && /^\s*\d{1,2}[:.]\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\s*$/i.test(neighbour.text)) {
            time = parseTime(neighbour.text);
            timeUnit = neighbour;
            break;
          }
        }
      }
      if (time) record.adjournedAt = fv(time.time, timeUnit, time.text, time.inferredMeridiem ? 0.7 : 0.9, time.inferredMeridiem ? "inferred" : "stated");
    }

    // Chair from the body text wins over the attendance annotation.
    const chairMatch = new RegExp(ci(String.raw`(?:chaired\s+by|presided\s+(?:over\s+)?by|(?:^|\b(?:meeting|acting)\s+)chair(?:person)?\s*(?:[:\-–]|\t+))\s*`) + String.raw`(${NAME})`).exec(text) ?? new RegExp(String.raw`(${NAME})\s+(?:chaired|was (?:the )?chair\b|presided)\b`).exec(text);
    if (chairMatch && looksLikePersonName(cleanName(chairMatch[1])) || (chairMatch && /^[A-Z]\.\s?[A-Z]/.test(chairMatch[1]))) {
      const name = cleanName(chairMatch![1]);
      // Chair from the body text wins over the attendance annotation (the first statement in the text wins).
      if (!chairFromText) {
        record.chair = personRef(name, unit, chairMatch![0], 0.9);
        chairFromText = true;
      }
    } else if (/call(?:ed|s)?\s+(?:the\s+)?(?:meeting\s+)?to\s+order/i.test(text) && !/\bby (?:the )?chair\b/i.test(text)) {
      // Who called the meeting to order: "… called to order at 5:30 PM by Sam Ortiz", "… at 5:32 PM (S. Ortiz)",
      // "Avery Quill called the meeting to order". Usually the chair; corroborates (or contradicts) other evidence.
      const caller = new RegExp(String.raw`to\s+order\b[^.•(]{0,40}?\bby\s+(${NAME})`).exec(text) ?? new RegExp(String.raw`to\s+order\b[^.•]{0,40}?\((${NAME})\)`).exec(text) ?? new RegExp(String.raw`(?:^|[.•]\s*)(${NAME})\s+call(?:ed|s)\s+(?:the\s+)?meeting\s+to\s+order`).exec(text);
      const name = caller ? cleanName(caller[1]) : undefined;
      if (name && (looksLikePersonName(name) || /^[A-Z]\.\s?[A-Z][\w'’-]+$/.test(name)) && !NOT_A_PERSON.test(name)) chairCallers.push({ name, unit, quote: caller![0] });
    } else if (!record.chair && /call(?:ed)? to order by (?:the )?chair/i.test(text) && currentSection) {
      const presenter = /\(([A-Z]\.\s?[A-Z][\w'’-]+)\)/.exec(currentSection.unit.text);
      if (presenter) record.chair = personRef(presenter[1], currentSection.unit, presenter[1], 0.6, "inferred", "Presenter of the call-to-order item; the minutes say the chair called the meeting to order.");
    }
    if (!record.recorder) {
      const recorder = new RegExp(ci(String.raw`(?:minutes?\s+(?:recorded|taken)\s+by|recorder\s*:|recording secretary\s*:|note[- ]?taker\s*:)\s*`) + String.raw`(${NAME})`).exec(text);
      if (recorder) record.recorder = personRef(cleanName(recorder[1]), unit, recorder[0], 0.85);
    }

    // Quorum.
    const position = index / Math.max(1, bodyUnits.length);
    if (/\b(?:no quorum|quorum (?:was |is )?not (?:reached|met|achieved|present|established)|lack(?:ed|ing)? (?:of )?(?:a )?quorum|without (?:a )?quorum|did not (?:have|reach|achieve) (?:a )?quorum|not have (?:a )?quorum)\b/i.test(text)) {
      if (!/\bif\b|will be necessary|needed for|next meeting|assuming/i.test(text.slice(0, 200)) || /no quorum for this meeting|quorum not reached/i.test(text)) quorumCandidates.push({ status: "not_met", unit, quote: text, position });
    } else if (/\bquorum\b/i.test(text) && /\b(?:achieved|reached|met|present|confirmed|established|was declared|exists?)\b|achieved quorum|confirmed (?:that )?quorum/i.test(text)) {
      const count = /(\d{1,3})\s*\)?\s*(?:directors|members|voting members|people)?\s*(?:were\s+|was\s+)?present|quorum of [a-z ]*\((\d{1,3})\)|\((\d{1,3})\s+(?:directors|members)/i.exec(text);
      quorumCandidates.push({ status: "met", unit, quote: text, position, count: count ? Number(count[1] ?? count[2] ?? count[3]) : undefined });
    }

    // Next meeting.
    if (/\bnext\b.{0,40}\bmeeting\b|\bupcoming\b.{0,30}meetings?|^\s*[•●]?\s*(?:[A-Z]{2,8}\s+)?(?:special|board|agm|annual general|operations|executive|[\w]+ committee)[\w &]{0,30}meeting[\w &]{0,20}\s*[:\-–]/i.test(text) || (/meeting\s*[:\-–]\s*$/i.test(text) && sectionTitle && /upcoming|next/i.test(sectionTitle))) {
      let window = text;
      let quoteUnit = unit;
      if (!findDates(window).length && !findDatesWithoutYear(window, meetingIso ?? "2000-01-01").length) {
        const follow = bodyUnits[index + 1];
        if (follow && !/\bmeeting\b/i.test(follow.text) && (findDates(follow.text).length || (meetingIso && findDatesWithoutYear(follow.text, meetingIso).length))) {
          window = `${text} ${follow.text.trim()}`;
          quoteUnit = follow;
        }
      }
      const dates = findDates(window);
      let date = dates[0];
      if (!date && meetingIso) {
        const noYear = findDatesWithoutYear(window, meetingIso)[0];
        if (noYear) date = noYear.iso < meetingIso ? { ...noYear, iso: `${Number(noYear.iso.slice(0, 4)) + 1}${noYear.iso.slice(4)}` } : noYear;
      }
      const time = findTimeRange(window)?.start ?? parseTime(window.replace(date?.text ?? "\u0000", " "))?.time;
      const locationMatch = /\((?:location:\s*)?([^)]*?(?:zoom|teams|room|hall|boardroom|office)[^)]*)\)/i.exec(window) ?? (bodyUnits[index + 1] && /^\s*location\s*:\s*(.+)$/i.exec(bodyUnits[index + 1].text.trim()));
      const bodyText = /^\s*[•●\-]?\s*(?:next\s+|upcoming\s+)?(.*?)\s*\bmeeting/i.exec(text)?.[1]?.replace(/^(?:the|a)\s+/i, "").trim() || undefined;
      nextMeetings.push({ date, time, location: locationMatch ? locationMatch[1].trim() : undefined, body: bodyText, text: window.trim(), unit: quoteUnit, quote: quoteUnit === unit ? text : quoteUnit.text.trim() });
    }

    // Motions.
    const motion = unit.role === "action" || consumed.has(unit) ? null : parseMotion(text);
    const standaloneOutcome = !motion && unit.role !== "action" && !consumed.has(unit) ? /^\s*[•●\-]?\s*(?:motion\s+)?(carried|defeated|passed)(?:\s+unanimously)?\s*\.?\s*$/i.exec(text) : null;
    if (motion) {
      // Units that carry the mover / seconder / outcome when they are written on following lines.
      const partUnits: { mover?: typeof unit; seconder?: typeof unit; outcome?: typeof unit } = {};
      // Mover / seconder written on the following lines ("Seconder: B. Oke").
      for (let look = index + 1; look <= Math.min(bodyUnits.length - 1, index + 3); look++) {
        const next = bodyUnits[look];
        if (next.blockIndex !== unit.blockIndex && next.blockIndex !== unit.blockIndex + 1) break;
        const mover = new RegExp(ci(String.raw`^\s*[•●\-]?\s*(?:mover|moved by)\s*[:\-–]?\s*`) + String.raw`(${NAME})`).exec(next.text);
        const seconder = new RegExp(ci(String.raw`^\s*[•●\-]?\s*(?:seconder|seconded by|seconded|second)\s*[:\-–]?\s*`) + String.raw`(${NAME})`).exec(next.text);
        const nextMotion = parseMotion(next.text);
        if (nextMotion && !nextMotion.text) {
          // "Motion by Pat/Lee - all approved" completes the motion above it.
          if (!motion.movedBy && nextMotion.movedBy) {
            motion.movedBy = nextMotion.movedBy;
            partUnits.mover = next;
          }
          if (!motion.secondedBy && nextMotion.secondedBy) {
            motion.secondedBy = nextMotion.secondedBy;
            partUnits.seconder = next;
          }
          if (!motion.outcome && nextMotion.outcome) {
            motion.outcome = nextMotion.outcome;
            motion.outcomeQuote = nextMotion.outcomeQuote;
            partUnits.outcome = next;
          }
          consumed.add(next);
          continue;
        }
        if ((!mover && !seconder) || nextMotion) break;
        if (mover && !motion.movedBy) {
          motion.movedBy = cleanName(mover[1]);
          partUnits.mover = next;
        }
        if (seconder && !motion.secondedBy) {
          motion.secondedBy = cleanName(seconder[1]);
          partUnits.seconder = next;
        }
        consumed.add(next);
      }
      // "Moved by X, seconded by Y, that" continues on the next line.
      const textLocators = [unitLocator(unit)];
      if (/^(?:that|to)$/i.test(motion.text.trim()) || /\bthat\s*:?$/i.test(motion.text)) {
        const next = bodyUnits[index + 1];
        if (next && next.role !== "section" && next.role !== "action" && (unit.cell ? next.cell === unit.cell && next.blockIndex === unit.blockIndex : !next.cell && next.blockIndex <= unit.blockIndex + 1) && !consumed.has(next) && !parseMotion(next.text)) {
          motion.text = `${motion.text} ${stripBullet(next.text)}`.trim();
          if (!motion.outcome) {
            const found = outcomeIn(next.text, false);
            if (found) {
              motion.outcome = found.value;
              motion.outcomeQuote = found.match;
            }
          }
          textLocators.push(unitLocator(next));
          consumed.add(next);
        }
      }
      let motionText = motion.text;
      let textStatus: "stated" | "inferred" = "stated";
      if (!motionText && (currentSub || sectionTitle)) {
        motionText = (currentSub ?? sectionTitle)!;
        textStatus = "inferred";
      }
      const key = (motionText || `#${index}`).toLowerCase();
      if (motionText && !seenMotionText.has(key)) {
        seenMotionText.add(key);
        let outcome = motion.outcome;
        let outcomeUnit = partUnits.outcome ?? unit;
        let outcomeQuote = motion.outcomeQuote;
        let outcomeStatus: "stated" | "inferred" = "stated";
        if (!outcome) {
          for (let look = index + 1; look < Math.min(bodyUnits.length, index + 40); look++) {
            const next = bodyUnits[look];
            if (next.role === "section" || (next.section && unit.section && next.section !== unit.section) || parseMotion(next.text)) break;
            const found = /^\s*[•●\-]?\s*(?:motion\s+)?(carried|defeated|passed|tabled|withdrawn|deferred)\b/i.exec(next.text) ?? /\b(?:discussion|motion|item)\s+(tabled|deferred|withdrawn)\b/i.exec(next.text);
            if (found) {
              outcome = OUTCOMES.find(([re]) => re.test(found[1]))![1];
              outcomeUnit = next;
              consumed.add(next);
              outcomeQuote = found[0].trim();
              outcomeStatus = look === index + 1 && /^\s*[•●\-]?\s*(?:motion\s+)?(carried|defeated|passed)/i.test(next.text) ? "stated" : "inferred";
              break;
            }
          }
        }
        const motionRecord: MotionRecord = {
          text: textStatus === "inferred" ? inferred(motionText, [unitLocator(unit)], 0.5, "Only the mover and seconder are recorded; wording taken from the agenda item.") : stated(motionText, textLocators, 0.85, motionText === stripBullet(text) ? undefined : "Wording normalised from the quoted line(s) (mover, seconder and outcome removed)."),
          outcome: outcome ? fv(outcome, outcomeUnit, outcomeQuote, outcomeStatus === "stated" ? 0.9 : 0.6, outcomeStatus) : { value: "unknown", status: "not_stated", confidence: 0.5, locators: [unitLocator(unit)] },
          ...(motion.movedBy ? { movedBy: personRef(motion.movedBy, partUnits.mover ?? unit, motion.movedBy, 0.85) } : {}),
          ...(motion.secondedBy ? { secondedBy: personRef(motion.secondedBy, partUnits.seconder ?? unit, motion.secondedBy, 0.85) } : {}),
          ...(motion.votes ? { votes: fv(motion.votes, unit, undefined, 0.8) } : {}),
          ...(motion.byConsensus ? { byConsensus: fv(true, unit, "consensus", 0.85) } : {}),
          ...(motion.special ? { resolutionType: fv("special" as const, unit, "special resolution", 0.9) } : motion.unanimous ? { resolutionType: fv("unanimous" as const, unit, undefined, 0.7) } : {}),
          ...(sectionTitle || currentSub ? { sectionRef: sectionLocator(currentSub && !unit.section ? `${sectionTitle ?? ""}${sectionTitle ? " – " : ""}${currentSub}` : sectionTitle) } : {}),
        };
        // Minutes adoption, agenda adoption and policy adoption.
        const context = `${motionText} ${sectionTitle ?? ""}`;
        if (/\b(?:adopt|approv|accept|receiv)\w*\b.{0,60}\bminutes\b|\bminutes\b.{0,60}\b(?:adopt|approv|accept)\w*/i.test(context)) {
          // Evidence for the adopted minutes' date, strongest first: a full date in the motion itself, a
          // full date in its agenda item's title, a day and month whose year follows from the meeting date.
          const inMotion = findDates(motion.text).find((date) => date.precision === "day" && (!meetingIso || date.iso < meetingIso));
          const inTitle = inMotion ? undefined : findDates(sectionTitle ?? "").find((date) => date.precision === "day" && (!meetingIso || date.iso < meetingIso));
          const noYear = inMotion || inTitle || !meetingIso ? undefined : findDatesWithoutYear(context, meetingIso).map((date) => (date.iso >= meetingIso ? { ...date, iso: `${Number(date.iso.slice(0, 4)) - 1}${date.iso.slice(4)}` } : date))[0];
          const prior = inMotion ?? inTitle ?? noYear;
          const value = { ...(prior ? { date: prior.iso, precision: "day" } : {}), body: record.bodyLabel?.value, text: prior?.text ?? "previous minutes" };
          const titleUnit = unit.section?.titleUnit ?? currentSection?.unit ?? unit;
          motionRecord.adoptsMinutesOf = inMotion ? fv(value, unit, inMotion.text, 0.92)
            : inTitle ? fv(value, titleUnit, inTitle.text, 0.88, "stated", "Date taken from the agenda item's title.")
              : noYear ? fv(value, unit, noYear.text, 0.8, "stated", "Year inferred from the meeting date.")
                : inferred(value, [unitLocator(unit)], 0.5, "Adopts the previous minutes; date not stated.");
          references.push({ kind: "prior_minutes", text: motion.text, ...(prior ? { date: prior.iso } : {}), ...(record.bodyLabel?.value ? { body: record.bodyLabel.value } : {}), locators: [unitLocator(unit)] });
        } else if (/\badopt\w*\b.{0,20}\bagenda\b|\bagenda\b.{0,40}\b(?:adopted|approved|moved)\b/i.test(context)) {
          motionRecord.adoptsAgenda = fv(true, unit, undefined, 0.85);
        }
        const policy = /\b(?:adopt|approve|accept|ratify)\w*\s+(?:the\s+)?(?:revised\s+|updated\s+|amended\s+)?(.{3,80}?\b(?:polic(?:y|ies)|terms of reference|bylaws?|constitution|procedures?|guidelines?|charter|code of conduct|strategic plan|work ?plan|budget))\b/i.exec(motion.text);
        if (policy) {
          motionRecord.adoptsPolicy = fv(policy[1].trim(), unit, policy[1].trim(), 0.8);
          references.push({ kind: "policy", text: policy[1].trim(), locators: [unitLocator(unit, policy[1].trim())] });
        }
        if (/\b(?:subject to|conditional (?:on|upon)|provided that|pending)\b/i.test(motion.text)) {
          motionRecord.conditional = fv(true, unit, undefined, 0.7);
          unsupported.push({ description: `Conditional decision: "${motion.text.slice(0, 160)}"`, locators: [unitLocator(unit)], suggestedTarget: "motions.condition", category: "no_field", infoType: "motion.conditional" });
        }
        if (motion.byConsensus) unsupported.push({ description: "Decision adopted by consensus; the import contract drops the decision method.", locators: [unitLocator(unit)], suggestedTarget: "motions.decidedBy", category: "lossy_normalization", infoType: "motion.consensus" });
        if (/\b(?:opposed|against|dissent(?:ed|ing)?|abstain(?:ed|ing)?)\b/i.test(text) && /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b.*\b(?:opposed|dissent|abstain)/.test(text)) {
          unsupported.push({ description: "Named dissent or abstention recorded on a motion.", locators: [unitLocator(unit)], suggestedTarget: "motions.dissentingReport", category: "no_field", infoType: "motion.dissent" });
        }
        record.motions.push(motionRecord);
      }
    } else if (standaloneOutcome && !(bodyUnits[index - 1] && parseMotion(bodyUnits[index - 1].text))) {
      // "CARRIED" closing a list with no motion wording: the decision is the list head and its items.
      const items: Unit[] = [];
      let head: Unit | undefined;
      for (let back = index - 1; back >= 0 && back >= index - 15; back--) {
        const prev = bodyUnits[back];
        if (prev.blockIndex !== unit.blockIndex || prev.cell !== unit.cell || consumed.has(prev) || prev.role === "section") break;
        if (/^\s*[•●\-]?\s*(?:motion\s+)?(?:carried|defeated|passed)\b/i.test(prev.text)) break;
        if (/:\s*$/.test(prev.text.trim())) {
          head = prev;
          break;
        }
        items.unshift(prev);
      }
      if (!head && items.length) head = items.shift();
      if (head) {
        const decisionText = `${stripBullet(head.text).replace(/:\s*$/, "")}${items.length ? `: ${items.map((item) => stripBullet(item.text)).join(", ")}` : ""}`.slice(0, 400);
        const outcomeValue = OUTCOMES.find(([re]) => re.test(standaloneOutcome[1]))![1];
        record.motions.push({
          text: inferred(decisionText, [unitLocator(head), ...items.slice(0, 20).map((item) => unitLocator(item))], 0.6, "Outcome recorded after a list with no motion wording; text is the list heading and items."),
          outcome: fv(outcomeValue, unit, standaloneOutcome[0].trim(), 0.85),
          ...(sectionTitle ? { sectionRef: sectionLocator(sectionTitle) } : {}),
        });
        consumed.add(unit);
      }
    } else if (unit.role !== "action" && DECISION_LINE.test(text)) {
      // "DECISION: …" (often in the same cell as discussion and "ACTION:" lines) is a stated decision.
      const decision = DECISION_LINE.exec(text)![1].split(/\s+(?=ACTION(?:\s+ITEMS?)?\s*[:\-–])/)[0].trim();
      if (decision) decisions.push(fv(decision, unit, decision, 0.85));
    } else if (unit.role !== "action" && /\b(?:approved|adopted|agreed|decided|decision (?:was )?made|accepted)\b/i.test(text) && text.length < 240 && !/\bif\b|\bwill be\b|\bto be approved\b|\bpending\b/i.test(text)) {
      decisions.push(fv(stripBullet(text), unit, undefined, 0.6, "inferred"));
      if (/\bminutes\b/i.test(text)) {
        const prior = findDates(text)[0];
        references.push({ kind: "prior_minutes", text: stripBullet(text), ...(prior ? { date: prior.iso } : {}), ...(record.bodyLabel?.value ? { body: record.bodyLabel.value } : {}), locators: [unitLocator(unit)] });
      }
    }

    // Action items: dedicated action column, or "ACTION:" lines in discussion.
    const actionMatch = unit.role === "action" ? null : ACTION_LINE.exec(text);
    if (unit.role === "action" || actionMatch) {
      const actionText = unit.role === "action" ? stripBullet(text) : actionMatch![1];
      const parsed = unit.assigneeText !== undefined ? { text: actionText, assignee: unit.assigneeText } as { text: string; assignee?: string; assigneeOnly?: boolean } : parseAction(actionText);
      if (parsed) {
        let taskText = parsed.text;
        let textUnit = unit;
        if (parsed.assigneeOnly) {
          // "Action: Pat, Lee, Sam" refers to the preceding statement.
          const previous = lastNonAction && lastNonAction.blockIndex >= unit.blockIndex - 2 ? lastNonAction : undefined;
          taskText = previous ? stripBullet(previous.text).replace(/^\(?[ivx]+\)\s*|^[a-z][.)]\s*/i, "").split(/;\s*/).slice(-1)[0] : "";
          textUnit = previous ?? unit;
        }
        if (taskText || parsed.assignee) {
          const dueSource = unit.dueText;
          let due: FieldValue<{ iso: string; precision: "day" | "month" | "year" | "unknown"; text?: string }> | undefined;
          if (dueSource) {
            const date = findDates(dueSource)[0] ?? (meetingIso ? findDatesWithoutYear(dueSource, meetingIso)[0] : undefined);
            due = date ? stated({ iso: date.iso, precision: "day" as const, text: dueSource }, [{ ...unitLocator(unit, dueSource), cell: unit.dueCell }], 0.85)
              : stated({ iso: "", precision: "unknown" as const, text: dueSource }, [{ ...unitLocator(unit, dueSource), cell: unit.dueCell }], 0.6, "Due date written as text, not a date.");
          } else {
            const byDate = /\b(?:by|before|due|no later than)\s+((?:\w+day,?\s+)?[A-Z][a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/.exec(taskText);
            const date = byDate ? (findDates(byDate[1])[0] ?? (meetingIso ? findDatesWithoutYear(byDate[1], meetingIso)[0] : undefined)) : undefined;
            if (date) due = stated({ iso: date.iso, precision: "day" as const, text: byDate![1] }, [unitLocator(unit, byDate![1])], 0.8);
          }
          record.actionItems.push({
            text: fv(taskText || actionText, textUnit, taskText || actionText, parsed.assigneeOnly ? 0.6 : 0.85, parsed.assigneeOnly ? "inferred" : "stated"),
            ...(parsed.assignee ? { assigneeAsWritten: unit.assigneeCell ? stated(parsed.assignee, [{ ...unitLocator(unit, parsed.assignee), cell: unit.assigneeCell }], 0.85) : fv(parsed.assignee, unit, parsed.assignee, 0.85) } : {}),
            ...(due ? { due } : {}),
            ...(unit.statusText ? { statusAsWritten: stated(unit.statusText, [unitLocator(unit, unit.statusText)], 0.8) } : {}),
            ...(sectionTitle ? { sectionRef: sectionLocator(sectionTitle) } : {}),
          });
        }
      }
    } else {
      lastNonAction = unit;
    }

    // Attachments and reports referenced.
    if (/\b(?:attached|attachment|appendix|schedule [A-Z0-9]\b|as circulated|enclosed|see (?:attached|below))\b/i.test(text)) {
      attachments.push(fv(stripBullet(text).slice(0, 300), unit, undefined, 0.6, "inferred"));
      references.push({ kind: "attachment", text: stripBullet(text).slice(0, 300), locators: [unitLocator(unit)] });
    } else if (/\breport\b.{0,60}\b(?:received|presented|reviewed|circulated)\b|\b(?:received|presented|reviewed)\b.{0,40}\breport\b/i.test(text)) {
      references.push({ kind: "report", text: stripBullet(text).slice(0, 300), locators: [unitLocator(unit)] });
    }
    if (/\b(?:arrived|left|departed|joined)\s+(?:the meeting\s+)?at\s+\d{1,2}[:.]\d{2}/i.test(text)) {
      unsupported.push({ description: "Attendee arrival or departure time recorded.", locators: [unitLocator(unit)], suggestedTarget: "meetingAttendance.arrivedAt/leftAt", category: "no_field", infoType: "attendance.arrival_leave" });
    }
    if (/\b(?:abstained from|recused|declared (?:a |an )?(?:conflict|interest)|conflict of interest)\b/i.test(text)) {
      unsupported.push({ description: "Conflict of interest or abstention recorded in the minutes; the import contract has no conflicts key.", locators: [unitLocator(unit)], suggestedTarget: "conflicts", category: "no_relationship", infoType: "conflict.declaration" });
    }
    if (/\bquorum\b.{0,60}\b(?:was )?(?:lost|regained|re-?established)\b/i.test(text)) {
      unsupported.push({ description: "Quorum changed during the meeting.", locators: [unitLocator(unit)], suggestedTarget: "minutes.quorumCheckpoints", category: "no_field", infoType: "quorum.checkpoints" });
    }
  }

  // Quorum: earliest statement in the meeting wins; later conditional mentions are ignored.
  const quorum = quorumCandidates.sort((a, b) => a.position - b.position)[0];
  if (quorum) {
    record.quorum = {
      stated: fv(quorum.status, quorum.unit, quorum.quote, 0.85),
      ...(quorum.count ? { count: fv(quorum.count, quorum.unit, quorum.quote, 0.8) } : {}),
      ...(quorumCandidates.length > 1 ? { checkpoints: quorumCandidates.map((candidate) => ({ text: candidate.quote.slice(0, 200), locators: [unitLocator(candidate.unit)] })) } : {}),
    };
    if (quorum.count) unsupported.push({ description: `Quorum head-count stated (${quorum.count}).`, locators: [unitLocator(quorum.unit)], suggestedTarget: "minutes.quorumPresentCount", category: "lossy_normalization", infoType: "quorum.count" });
  } else record.quorum = { stated: { value: "not_recorded", status: "not_stated", confidence: 0.7, locators: [] } };

  // Next meeting: same body first, else the earliest dated upcoming meeting.
  const ownKey = bodyKey(record.bodyLabel?.value);
  const dated = nextMeetings.filter((meeting) => meeting.date && (!meetingIso || meeting.date.iso > meetingIso));
  const sameBody = dated.find((meeting) => bodyKey(meeting.body ?? meeting.text) === ownKey) ?? dated.find((meeting) => !meeting.body && /^\s*next meeting/i.test(meeting.text));
  const chosen = sameBody ?? dated.sort((a, b) => a.date!.iso.localeCompare(b.date!.iso))[0] ?? nextMeetings[0];
  if (chosen) {
    const value = { text: chosen.text.slice(0, 300), ...(chosen.date ? { date: chosen.date.iso } : {}), ...(chosen.time ? { time: chosen.time } : {}), ...(chosen.location ? { location: chosen.location } : {}), ...(chosen.body ? { body: chosen.body } : {}) };
    record.nextMeeting = chosen.date ? fv(value, chosen.unit, chosen.quote, sameBody ? 0.85 : 0.6, sameBody ? "stated" : "inferred") : inferred(value, [unitLocator(chosen.unit, chosen.quote)], 0.4, "Next meeting mentioned without a date.");
    if (!sameBody && dated.length > 1) record.nextMeeting.note = `Several upcoming meetings listed (${dated.map((meeting) => meeting.date!.iso).join(", ")}); chose the earliest.`;
  }

  // Start/end times fall back to the call-to-order and adjournment times.
  if (!record.startTime && record.calledToOrderAt) record.startTime = { ...record.calledToOrderAt, status: "inferred", confidence: Math.min(0.5, record.calledToOrderAt.confidence), note: "No scheduled start time; using the call-to-order time." };
  if (!record.endTime && record.adjournedAt && record.startTime?.note) record.endTime = { ...record.adjournedAt, status: "inferred", confidence: 0.5, note: "No scheduled end time; using the adjournment time." };
  // A "Chair: Name" line in the header block (beside Date/Time/Location) is text evidence too.
  if (!chairFromText) {
    for (const unit of headerUnits) {
      const label = new RegExp(String.raw`^\s*(?:meeting\s+)?chair(?:person)?\s*(?::|\t)\s*(${NAME})`, "i").exec(unit.text);
      const name = label ? cleanName(label[1]) : undefined;
      if (name && (looksLikePersonName(name) || /^[A-Z]\.\s?[A-Z]/.test(name))) {
        record.chair = personRef(name, unit, label![0].trim(), 0.9);
        chairFromText = true;
        break;
      }
    }
  }
  // Chair evidence: the text ("Chair:", "chaired by"), the attendance marks and who called the
  // meeting to order. Agreement raises confidence; disagreement keeps the value below every
  // bulk-accept threshold with a note; a caller alone is an inferred chair.
  const sameChair = (a: string, b: string) => {
    const x = a.toLowerCase().replace(/[^a-z ]/g, "").trim(), y = b.toLowerCase().replace(/[^a-z ]/g, "").trim();
    return x === y || referenceMatches(a, b) || referenceMatches(b, a);
  };
  if (record.chair?.value) {
    const chosen = record.chair.value.nameAsWritten;
    const otherMarks = chairMarks.filter((mark) => !sameChair(mark.name, chosen));
    const otherCallers = chairCallers.filter((caller) => !sameChair(caller.name, chosen));
    const agreeing = chairCallers.find((caller) => sameChair(caller.name, chosen)) ?? (chairFromText ? chairMarks.find((mark) => sameChair(mark.name, chosen)) : undefined);
    if (otherMarks.length || otherCallers.length) {
      const others = [...otherMarks.map((mark) => `the attendance list marks ${mark.name} as chair`), ...otherCallers.map((caller) => `${caller.name} called the meeting to order`)];
      record.chair.confidence = Math.min(record.chair.confidence, 0.84);
      record.chair.note = `${record.chair.note ? `${record.chair.note} ` : ""}But ${[...new Set(others)].slice(0, 2).join(" and ")}: confirm who chaired.`;
    } else if (agreeing && record.chair.status === "stated") {
      record.chair.confidence = Math.max(record.chair.confidence, 0.92);
      const callerQuote = (agreeing as { quote?: string }).quote;
      record.chair.locators = [...record.chair.locators, unitLocator(agreeing.unit, callerQuote ?? agreeing.name)];
      record.chair.note = `${record.chair.note ? `${record.chair.note} ` : ""}${callerQuote ? "The same person called the meeting to order." : "The attendance list also marks them as chair."}`;
    }
  } else if (chairCallers.length && chairCallers.every((caller) => sameChair(caller.name, chairCallers[0].name))) {
    const caller = chairCallers[0];
    record.chair = personRef(caller.name, caller.unit, caller.quote, 0.7, "inferred", "Called the meeting to order (usually the chair); the minutes do not label a chair.");
  }
  if (record.chair?.value && !record.chair.value.resolvedName) {
    const resolvedName = resolveName(record.chair.value.nameAsWritten);
    if (resolvedName && resolvedName !== record.chair.value.nameAsWritten) record.chair.value.resolvedName = resolvedName;
  }
  // A decision that repeats a recorded motion ("Motion to approve the budget … carried" and
  // "Budget approved") is not a second decision: keep only decisions no motion already states.
  const decisionKey = (value: string) => value.toLowerCase().replace(/^(?:that|to)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const motionKeys = (record.motions ?? []).map((motion) => decisionKey(String(motion.text?.value ?? ""))).filter((key) => key.length >= 8);
  const motionUnits = new Set((record.motions ?? []).flatMap((motion) => (motion.text?.locators ?? []).map((locator) => `${locator.blockIndex}:${locator.quote ?? ""}`)));
  const distinctDecisions = decisions.filter((decision) => {
    const key = decisionKey(String(decision.value ?? ""));
    if (!key) return false;
    if (decision.locators.some((locator) => motionUnits.has(`${locator.blockIndex}:${locator.quote ?? ""}`))) return false;
    return !motionKeys.some((motionKey) => motionKey === key || (key.length >= 12 && (motionKey.includes(key) || key.includes(motionKey))));
  });
  if (distinctDecisions.length) record.decisions = distinctDecisions;
  if (attachments.length) record.attachmentsReferenced = attachments;
  if (sessionSegments.length) record.sessionSegments = sessionSegments;
  if (!record.attendance.length) warnings.push("No attendance list recognised.");
  if (!record.motions.length && units.some((unit) => /\bcarried\b/i.test(unit.text))) warnings.push("'Carried' appears but no motion was recognised; review manually.");
  for (const entry of record.attendance) {
    const name = entry.nameAsWritten.value ?? "";
    if (name.split(/\s+/).some((word) => isOrgWord(word))) warnings.push(`Attendance entry "${name}" may be an organisation.`);
  }
  return {
    fileId: input.fileId,
    docClass: "meetingMinutes",
    schemaVersion: MEETING_MINUTES_SCHEMA_VERSION,
    engine: "deterministic",
    model: DETERMINISTIC_MINUTES_ENGINE,
    record: record as Record<string, unknown>,
    unsupported,
    references,
    warnings,
  };
}
