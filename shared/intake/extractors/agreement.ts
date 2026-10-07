/** Agreements, contracts, funding letters and grant applications/awards
 * (design §4.3). Parties, type, effective/expiry dates, amounts, payment
 * schedule, deliverables, reporting due dates and signatories. Agreements
 * become native draft agreements (the agreements register, A5) whose dates
 * generate deadlines; grants become `grants` with the rich C10 fields. */
import { versionMarker } from "../cluster";
import { looksLikePersonName } from "../names";
import { findDates, findMoney } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, labelled, linesOf, loc, stripBullet, titleLine, type Line } from "./toolkit";

export const DETERMINISTIC_AGREEMENT_ENGINE = "deterministic-agreement/1";

const AGREEMENT_NUMBER = /\b(?:agreement|contract|grant|file|reference|project)\s*(?:no\.?|number|#|id)\s*:?\s*#?([A-Z0-9][A-Z0-9-]{4,}(?:\s(?:19|20)\d{2}(?:-\d{2,4})?)?)\b|\b([A-Z]{2}\d{2}[A-Z]{3}\d{4})\b/i;

const ORG = /\b(?:society|council|district|city|ministry|province|roundtable|round table|association|ltd|inc|incorporated|corporation|corp|company|co-?op(?:erative)?|group|university|college|authority|foundation|bank|credit union|limited|government|agency|board|partnership|consult\w*|planning|services|solutions|institute|trust|fund|municipality|regional|canada|health|club|chamber)\b/i;
/** Quoted aliases that name a party's role ("the “Contractor”"), not a defined term ("the “Grant”"). */
const ROLE_ALIAS = /^(?:contractor|consultant|client|licensee|licensor|city|province|regional district|district|recipient|funder|society|lessee|lessor|supplier|vendor|service provider|provider|grantee|grantor|purchaser|customer|owner|council|foundation|ministry|[A-Z][A-Z&]{1,9}(?:\s[A-Z]{2,6})?)$/i;
const NOT_PARTY_ALIAS = /^(?:grant|project|agreement|application|services?|premises|work|term|fees?|schedule|maximum amount(?: payable)?|start date|expiration date|produced material|incorporated material|material|parties|confidential information|program)$/i;
const ADDRESS = /\bP\.?\s?O\.?\s?Box\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b(?:street|st\.|avenue|ave\.?|road|rd\.|boulevard|blvd|suite|floor|unit)\b|^\s*\d|\bin the province of\b|\btelephone\b|\bfax\b|\be-?mail\b|@/i;

export type PartyCandidate = { name: string; line: Line; quote: string; confidence: number };

/** A party's name from the text around it: addresses, incorporation notes and defined-term tails removed. */
export function partyName(raw: string): string | undefined {
  let value = raw.replace(/^\s*(?:by\s+and\s+)?(?:between|and)\s*[:\t]?\s*/i, "").replace(/^\s*(?:the\s+)?(?:contractor|consultant|client|licensee|recipient(?: of the grant)?|funder|service provider|grantee|vendor|supplier)\s*[:\t]\s*/i, "");
  value = value.split(/\s*\(|\t|\s+Attn\b|,?\s+(?:with the following|as represented|at the following|having (?:an|its) (?:office|place)|hereinafter|a corporation duly|a duly incorporated|the (?:secretariat|agent|operator|administrator) (?:for|of))\b|,\s*(?:a|an)\s+(?:duly|company|society|corporation|body|municipal|regional|not-for-profit|non-profit)\b|\.\s+A\s+MUNICIPAL\b|,\s*of\s+\d|,\s*\d|\s+\(Inc\.?\s+No\b/i)[0];
  value = value.replace(/[“”"]/g, "").replace(/[\s,.;:–-]+$/g, "").replace(/^[\s,.;:–-]+/, "").replace(/\s+/g, " ").trim();
  if (value.length < 3 || value.length > 100 || ADDRESS.test(value)) return undefined;
  if (/^(?:the parties|you|we|us|our|this agreement|signature|print name|per|date|name|title)\b/i.test(value)) return undefined;
  // Sentence fragments ("… and when a copy is received by …", "Province to") are not names.
  if (/\b(?:is|are|was|were|when|received|returned|retained|will|shall|may|must|under this)\b/i.test(value) || /\s(?:to|in|of|for|and|or|the|by|with|from|at)$/i.test(value)) return undefined;
  // A wrapped name's tail ("Roundtable Society", "Foundation") is not a party on its own.
  if (value.replace(/^the\s+/i, "").split(/\s+/).every((word) => /^(?:roundtable|society|council|foundation|association|group|board|committee|inc\.?|ltd\.?|corporation|company|limited)$/i.test(word))) return undefined;
  return value;
}

const partyKey = (name: string) => name.toLowerCase().replace(/\bround table\b/g, "roundtable").replace(/^the\s+/, "").replace(/\b(?:society|inc|ltd|limited|the)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Parties of an agreement, strongest evidence first: the BETWEEN … AND block (inline, stacked or in
 * two columns), role labels ("Contractor:", "Recipient of the grant"), quoted role aliases
 * ("X (the “Consultant”)"), signature blocks ("on behalf of X", an organization over "Per:") and a
 * funder's own sentence ("X is able to provide funding"). A person is a party only as a named
 * contractor or consultant. */
export function agreementParties(lines: Line[]): Array<FieldValue<string>> {
  const found: PartyCandidate[] = [];
  const consider = (line: Line, raw: string, confidence: number, allowPerson = false): boolean => {
    const name = partyName(raw);
    if (!name) return false;
    const person = looksLikePersonName(name) && !ORG.test(name);
    if (!ORG.test(name) && !(allowPerson && person)) return false;
    if (found.some((candidate) => partyKey(candidate.name) === partyKey(name) || (partyKey(name).length > 8 && (partyKey(candidate.name).includes(partyKey(name)) || partyKey(name).includes(partyKey(candidate.name)))))) return true;
    found.push({ name, line, quote: line.text.includes(name) ? name : raw.trim().slice(0, 300), confidence });
    return true;
  };
  const roleIn = (text: string) => /\((?:the\s+|hereinafter\s+(?:referred to as|called)\s+(?:the\s+)?)?[“"']?\s*(contractor|consultant|licensee|recipient|client)\b/i.test(text);
  const head = lines.slice(0, 120);
  // 1. BETWEEN … AND.
  for (let index = 0; index < head.length; index++) {
    const text = head[index].text;
    if (!/^\s*(?:this agreement\b.*?)?(?:by and )?between\b/i.test(text) && !/^\s*this agreement\b.*\bbetween\b/i.test(text)) continue;
    const after = text.replace(/^.*?\bbetween\b\s*:?\s*/i, "");
    const columns = after.split(/\t+/);
    if (/^AND\s*:?$/i.test(columns[columns.length - 1]?.trim() ?? "") && columns.length <= 2 && !columns[0]?.replace(/^AND\s*:?$/i, "").trim()) {
      // A two-column parties block ("BETWEEN<TAB>AND"): each column's first line names a party.
      const rows = head.slice(index + 1, index + 4).map((line) => ({ line, cells: line.text.split(/\t+/) }));
      const left = rows.find((row) => row.cells[0]?.trim());
      const right = rows.find((row) => row.cells.length > 1 && row.cells[row.cells.length - 1].trim());
      // A long name wraps inside its column ("The Prince George Air Improvement" / "Roundtable Society (…)").
      if (left && !consider(left.line, left.cells[0], 0.8, roleIn(left.line.text))) {
        const below = rows[rows.indexOf(left) + 1];
        if (below?.cells[0]?.trim()) consider(below.line, `${left.cells[0].trim()} ${below.cells[0].trim()}`, 0.75, roleIn(below.line.text));
      }
      if (right) consider(right.line, right.cells[right.cells.length - 1], 0.8, roleIn(right.line.text) || roleIn(rows.map((row) => row.line.text).join(" ")));
      // A PDF that lost the column gap lists the two columns' first lines one under the other.
      else if (left) {
        const second = rows.find((row) => row !== left && row.cells.length === 1 && row.cells[0].trim());
        if (second && !/^\s*\(/.test(second.cells[0])) consider(second.line, second.cells[0], 0.75, roleIn(rows.map((row) => row.line.text).join(" ")));
      }
      continue;
    }
    const inlineAnd = after.split(/\t+\s*AND\b\s*:?\s*|\s+AND\s*:\s*/);
    if (inlineAnd.length >= 2 && inlineAnd[0].trim()) {
      consider(head[index], inlineAnd[0], 0.8, roleIn(inlineAnd[0]));
      consider(head[index], inlineAnd[1], 0.8, roleIn(inlineAnd[1]));
      continue;
    }
    // Stacked: "BETWEEN:" / name / address … "AND:" / name / address.
    const firstLine = after.trim() ? head[index] : head.slice(index + 1, index + 4).find((line) => line.text.trim() && !/^\s*and\s*:?\s*$/i.test(line.text));
    const firstText = after.trim() ? after : firstLine?.text ?? "";
    if (firstLine) consider(firstLine, firstText, 0.8, roleIn(head.slice(index, index + 10).map((line) => line.text).join(" ")));
    const andIndex = head.slice(index + 1, index + 25).findIndex((line) => /^\s*and\s*[:\t]|^\s*and\s*$/i.test(line.text));
    if (andIndex >= 0) {
      const andLine = head[index + 1 + andIndex];
      const rest = andLine.text.replace(/^\s*and\s*:?\s*/i, "");
      const target = rest.trim() ? andLine : head.slice(index + 2 + andIndex, index + 6 + andIndex).find((line) => line.text.trim());
      if (target) consider(target, rest.trim() ? rest : target.text, 0.8, roleIn(head.slice(index + 1 + andIndex, index + 12 + andIndex).map((line) => line.text).join(" ")));
    }
  }
  // 1b. "… Letter of Agreement between GoByBike Society and Prince George Cycling Club, for …".
  for (const line of head.slice(0, 60)) {
    const match = /\bbetween\s+(?:the\s+)?([A-Z][^,;:()]{2,80}?)\s+and\s+(?:the\s+)?([A-Z][^,;:()]{2,80}?)(?=[,;.(]|\s+(?:for|to|dated|regarding)\b|$)/.exec(line.text);
    if (match && !/^\s*between\b/i.test(line.text)) {
      consider(line, match[1], 0.75);
      consider(line, match[2], 0.75);
    }
  }
  // 2. Role labels ("Contractor: …", "Submitted by: …" on proposals and applications).
  for (const line of head) {
    const submitted = /^\s*submitted (?:to|by)\s*:\s*(.+)$/i.exec(line.text);
    if (submitted) consider(line, submitted[1], 0.75);
  }
  for (let index = 0; index < head.length; index++) {
    const text = head[index].text;
    const labelled = /^\s*(?:the\s+)?(contractor|consultant|funder|recipient(?: of the grant)?|grantee|licensee|service provider|vendor|supplier)\s*[:\t]\s*(.+)$/i.exec(text);
    if (labelled) consider(head[index], labelled[2], 0.8, /contractor|consultant/i.test(labelled[1]));
    else if (/^\s*(?:recipient of the grant|grant recipient|the contractor|the consultant|funder)\s*:?\s*$/i.test(text)) {
      const next = head.slice(index + 1, index + 3).find((line) => line.text.trim());
      if (next) consider(next, next.text, 0.8, /contractor|consultant/i.test(text));
    }
  }
  // 3. Quoted role aliases: "WSP Canada Inc (the “Consultant”)", "Christophe Corbel (the “Contractor”, …)".
  for (const line of head) {
    for (const match of line.text.matchAll(/([A-Z][\w&.'’ -]{2,90}?)\s*\((?:the\s+|hereinafter\s+(?:referred to as|called)\s+(?:the\s+)?)?[“"']([A-Za-z][\w &]{1,30})[”"']/g)) {
      if (NOT_PARTY_ALIAS.test(match[2].trim()) || !ROLE_ALIAS.test(match[2].trim()) || /[’']s\b/.test(match[1])) continue;
      consider(line, match[1], 0.75, /contractor|consultant/i.test(match[2]));
    }
  }
  // 4. Signature blocks.
  lines.forEach((line, index) => {
    const behalf = /\bon behalf of\s+(?:the\s+)?([A-Z][\w&.'’ -]{2,80}?)(?:\s+by\b|\s*\(|,|$)/.exec(line.text);
    if (behalf && !/^(?:PGAIR|us|we)$/i.test(behalf[1].trim())) consider(line, behalf[1], 0.65);
    const next = lines[index + 1];
    if (next && /^\s*per\s*:/i.test(next.text) && line.text.trim().length < 90 && !/^\s*per\s*:/i.test(line.text)) consider(line, line.text, 0.65);
  });
  // 5. A funder's own sentence in a grant or transfer agreement.
  for (const line of head) {
    const funding = /(?:^|,\s*|\bthe\s+)([A-Z][\w&.'’ -]{3,80}?),?\s+(?:is able to provide|agrees to (?:provide|pay|contribute)|will provide|is pleased to provide)\s+(?:funding|a grant|financial)/.exec(line.text);
    // "I am pleased to advise that the Coastal Lung Foundation, is able to provide …": the name after the last "the".
    if (funding) consider(line, funding[1].replace(/^.*\bthe\s+(?=[A-Z])/, ""), 0.6);
  }
  return found.slice(0, 4).map((candidate) => at(candidate.name, candidate.line, candidate.quote, candidate.confidence));
}

function termIn(lines: Line[]): { effective?: FieldValue<any>; expiry?: FieldValue<any> } {
  const effectiveLabel = lines.find((line) => /\b(?:effective date|start date|commencement date)\s*:/i.test(line.text));
  const endLabel = lines.find((line) => /\b(?:end date|expiry date|expiration date|termination date|completion date)\s*:/i.test(line.text));
  let effective: FieldValue<any> | undefined, expiry: FieldValue<any> | undefined;
  if (effectiveLabel) {
    const date = findDates(effectiveLabel.text.slice(effectiveLabel.text.search(/effective date|start date|commencement date/i)))[0];
    if (date) effective = at(dateValue(date), effectiveLabel, date.text, 0.85);
  }
  if (endLabel) {
    const date = findDates(endLabel.text.slice(endLabel.text.search(/end date|expiry date|expiration date|termination date|completion date/i)))[0];
    if (date) expiry = at(dateValue(date), endLabel, date.text, 0.85);
  }
  if (!effective || !expiry) {
    // "… during the Term commencing on (and including) August 01, 2011 and ending on (and including) July 31, 2014".
    for (const line of lines) {
      const match = /\bcommenc\w*\s+(?:on\s+)?(?:\(and including\)\s+)?(.{6,40}?)(?:\s*\([^)]*\))?,?\s+(?:and\s+)?(?:ending|expiring|terminating|end(?:s)?)\s+(?:on\s+)?(?:\(and including\)\s+)?(.{6,60})/i.exec(line.text);
      const start = match ? findDates(match[1]).find((date) => date.precision === "day") : undefined;
      const end = match ? findDates(match[2]).find((date) => date.precision === "day") : undefined;
      if (start && end) {
        effective ??= at(dateValue(start), line, start.text, 0.85);
        expiry ??= at(dateValue(end), line, end.text, 0.85);
        break;
      }
    }
  }
  if (!effective || !expiry) {
    const termLine = lines.find((line) => /\b(?:term of this (?:agreement|contract)|agreement (?:is|shall be) (?:in effect|effective)|from\b.*\bto\b|commenc\w+ on|runs from)\b|^\s*(?:\d{1,2}[.)]\s*)?(?:term|project period|funding period|agreement period)\s*[:.]/i.test(line.text) && findDates(line.text).filter((date) => date.precision === "day").length >= 2);
    if (termLine) {
      const dates = findDates(termLine.text).filter((date) => date.precision === "day");
      effective ??= at(dateValue(dates[0]), termLine, dates[0].text, 0.8);
      expiry ??= at(dateValue(dates[1]), termLine, dates[1].text, 0.8);
    }
  }
  if (!expiry) {
    const ranged = lines.find((line) => /\bfrom\b.{3,40}\bto\b|\brun(?:s|ning)?\s+(?:from|until)\b|\bthrough\b/i.test(line.text) && /\b(?:project|program|term|period|agreement|grant|funding)\b/i.test(line.text));
    const end = ranged ? findDates(ranged.text.slice(ranged.text.search(/\bto\b|\buntil\b|\bthrough\b/i))).find((date) => date.precision === "day") : undefined;
    if (ranged && end) expiry = at(dateValue(end), ranged, end.text, 0.75);
  }
  return { effective, expiry };
}

const TITLE_WORDS = /\b(?:agreement|contract|memorandum of understanding|mou|letter of (?:agreement|understanding)|terms and conditions|proposal|application|funding|grant|contribution|addendum|amendment|licen[cs]e)\b/i;
/** "Event #: 12756 License Agreement" → "License Agreement"; "Contract #: PGAIR-RWG-2013" → "" (a label, not a title). */
/** "… the BC Lung Association, is able to provide funding …" → the funder named in its own sentence. */
export function funderSentence(lines: Line[]): { name: string; line: Line } | undefined {
  for (const line of lines) {
    const funding = /(?:^|,\s*|\bthe\s+)([A-Z][\w&.'’ -]{3,80}?),?\s+(?:is able to provide|agrees to (?:provide|pay|contribute)|will provide|is pleased to provide)\s+(?:funding|a grant|financial)/.exec(line.text);
    const name = funding ? partyName(funding[1].replace(/^.*\bthe\s+(?=[A-Z])/, "")) : undefined;
    if (name && line.text.includes(name)) return { name, line };
  }
  return undefined;
}

export function agreementTitleText(text: string): string {
  return clean(text.replace(/^\s*(?:event|contract|agreement|account|file|project|reference|ref)\s*(?:#|no\.?|number)\s*:?\s*[A-Z0-9][\w-]*(?:\s(?:19|20)\d{2})?\s*/i, "").replace(/^\s*(?:title|re|subject)\s*:\s*/i, "").replace(/\t+/g, " "));
}
function agreementTitleLine(lines: Line[]): Line | undefined {
  return lines.slice(0, 20).find((line) => {
    const text = agreementTitleText(line.text);
    if (!text || !TITLE_WORDS.test(text) || text.length > 120 || text.split(/\s+/).length > 12) return false;
    // Sentences, label lines, parties blocks and page furniture are not titles.
    if (/[.;]$/.test(text) || /^[^:]{1,30}:\s/.test(text) || /^(?:between|this agreement|the parties|whereas|page \d)/i.test(text)) return false;
    return true;
  });
}

export function extractAgreement(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const fallbackTitle = titleLine(lines);
  const titleCandidate = agreementTitleLine(lines) ?? (fallbackTitle && fallbackTitle.text.length < 90 && !/^\s*(?:this agreement|between|whereas)\b/i.test(fallbackTitle.text) && !(findDates(fallbackTitle.text)[0] && fallbackTitle.text.replace(findDates(fallbackTitle.text)[0].text, "").replace(/[\s,.]/g, "").length < 4) ? fallbackTitle : undefined);
  const titleText = titleCandidate ? agreementTitleText(titleCandidate.text) : fileName.replace(/\.[a-z0-9]+$/i, "");
  const textHead = `${fileName} ${lines.slice(0, 40).map((line) => line.text).join(" ")}`;
  const kind = /memorandum of understanding|\bmou\b/i.test(textHead) ? "mou"
    : /\bgrant\b|funding agreement|contribution agreement|funding (?:request|support|application)|proposal|application/i.test(textHead) && input.docClass === "grant" ? (/letter/i.test(fileName) ? "funding_letter" : "grant")
      : /\bcontract\b/i.test(textHead) ? "contract" : /agreement/i.test(textHead) ? "agreement" : input.docClass === "grant" ? "grant" : "unknown";
  const grantStage = /\bapplication\b|\brequest(?:ing|s)?\b[^.]{0,40}\b(?:funding|support|contribution)\b/i.test(textHead) ? "application" : /\bproposal\b/i.test(textHead) ? "proposal" : /\breport\b/i.test(fileName) ? "report" : /pleased to (?:inform|advise|confirm)|has been approved|award(?:ed)?\b/i.test(textHead) ? "award" : /agreement|contract/i.test(textHead) ? "agreement" : "unknown";
  const parties = agreementParties(lines);
  const { effective, expiry } = termIn(lines);
  // Amount, strongest cue first: a "Maximum Amount" label or clause, a fee cap ("not to exceed",
  // "shall … exceed $X", "up to $X"), a total or a grant amount. Insurance and liability limits
  // ("CGL in an amount not less than $2,000,000") are never the agreement's value.
  let amount: FieldValue<any> | undefined;
  let amountRank = 0;
  let amountRequested: FieldValue<any> | undefined;
  const LIMIT_CONTEXT = /\b(?:insur\w*|liabilit\w*|coverage|per occurrence|bodily injury|deductible|indemnif\w*|automobile|aggregate|damages)\b/i;
  for (const line of lines) {
    if (LIMIT_CONTEXT.test(line.text)) continue;
    const requested = /\b(?:request(?:ed|ing)?|ask)\b/i.test(line.text);
    const rank = /\bmaximum amount(?: payable)?\b/i.test(line.text) ? 5
      : /\bnot (?:to )?exceed\b|\b(?:shall|will) not\b[^.]{0,40}\bexceed\b|\bexceed\s+\$|\bup to\s+\$|\bcontract (?:price|amount|value)\b|\btotal (?:contract|agreement|project) (?:value|amount|price)\b/i.test(line.text) ? 4
        : /\b(?:total|amount of|contribution of|grant of|funding of|in the amount|sum of|(?:approved|awarded|grant|funding) amount)\b/i.test(line.text) ? 3
          : /\bfees? (?:payable|of)\b|\b(?:will|shall) pay\b|^\s*(?:amount|fees?)\s*[:.]/i.test(line.text) ? 2 : 0;
    if (!rank && !requested) continue;
    // "Maximum Amount: $85,000" beside "Fees: $82,500": take the amount after the strongest cue.
    const cueAt = rank === 5 ? line.text.search(/maximum amount/i) : rank === 4 ? line.text.search(/not (?:to )?exceed|exceed|up to|contract (?:price|amount|value)|total (?:contract|agreement|project)/i) : 0;
    let money = findMoney(line.text.slice(Math.max(0, cueAt)))[0];
    // "… is 298939.87 (the “Maximum Amount Payable”)": the amount may be written without a dollar sign.
    if (!money && rank === 5) {
      const bare = /\bis\s+\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{3,}(?:\.\d{2})?)\b/.exec(line.text);
      if (bare) money = { amountCents: Math.round(Number(bare[1].replace(/,/g, "")) * 100), currency: "CAD", text: bare[1] } as any;
    }
    if (!money || money.amountCents < 10000) continue;
    const value = { amountCents: money.amountCents, currency: money.currency, text: money.text };
    if (requested && !rank) {
      amountRequested ??= at(value, line, money.text, 0.7);
      continue;
    }
    if (rank > amountRank) {
      amount = at(value, line, money.text, rank >= 4 ? 0.8 : 0.75);
      amountRank = rank;
    }
  }
  // Payment schedule: "<period> - $4500" lines.
  const paymentSchedule = lines.filter((line) => findMoney(line.text)[0] && line.text.length < 200 && ((findDates(line.text).length && /\b(?:to|payment|instal|invoice|period|due)\b/i.test(line.text)) || /^\s*(?:[•●▪◦·\-–*]\s*)?(?:first|second|third|final|initial|interim|holdback|\d+(?:st|nd|rd|th))\s+(?:payment|instal+ment)\b/i.test(line.text))).slice(0, 20).map((line) => {
    const money = findMoney(line.text)[0];
    const dates = findDates(line.text);
    const due = dates[dates.length - 1];
    return { text: at(clean(line.text).slice(0, 200), line, undefined, 0.7), amount: at({ amountCents: money.amountCents, currency: money.currency, text: money.text }, line, money.text, 0.75), ...(due ? { due: at(dateValue(due), line, due.text, 0.65) } : {}) };
  });
  // Deliverables: bullets under scope/services/deliverables/"will:" headings.
  const deliverables: Array<FieldValue<string>> = [];
  let inScope = false;
  for (const line of lines) {
    const text = line.text.trim();
    if (/\b(?:scope of (?:work|services)|deliverables|services|will\s*:|shall\s*:|responsibilities|outcomes|activities|tasks|duties|statement of work|work plan)\b\s*:?\s*$/i.test(text) || /\b(?:will|shall)\s*:\s*$/i.test(text)) {
      inScope = true;
      continue;
    }
    if (inScope && (/^[•●▪◦·\-–*]\s*\S/.test(text) || line.kind === "list_item")) {
      if (text.length > 6 && deliverables.length < 40) deliverables.push(at(clean(stripBullet(text)).slice(0, 300), line, undefined, 0.65));
      continue;
    }
    if (inScope && /^\s*\d{1,2}[.)]\s/.test(text) && text.length < 200 && deliverables.length < 40) {
      deliverables.push(at(clean(text.replace(/^\s*\d{1,2}[.)]\s*/, "")), line, undefined, 0.6));
      continue;
    }
    if (inScope && text.length > 0 && !/^[a-z]/.test(text)) inScope = /^(?:the|and|or)\b/i.test(text) ? inScope : false;
  }
  // Reporting due dates.
  const reportingRequirements: any[] = [];
  const reportingDue: Array<FieldValue<any>> = [];
  for (const line of lines) {
    if (!/\breport(?:s|ing)?\b/i.test(line.text) || !/\b(?:due|submit|by|no later than|deadline|within)\b/i.test(line.text) || line.text.length > 400) continue;
    const date = findDates(line.text).find((candidate) => candidate.precision === "day");
    const requirement = { text: at(clean(line.text).slice(0, 300), line, undefined, 0.65), ...(date ? { due: at(dateValue(date), line, date.text, 0.75) } : {}) };
    reportingRequirements.push(requirement);
    if (date) reportingDue.push(at(dateValue(date), line, date.text, 0.75));
    if (reportingRequirements.length >= 15) break;
  }
  // Signatories: "Name:" lines in a signature block, "Per:" lines.
  const signatories: Array<FieldValue<any>> = [];
  for (const line of lines) {
    const match = /^\s*(?:name|print(?:ed)? name|per|signed by|authorized signatory)\s*:\s*_*\s*([A-Z][A-Za-z.'’ -]{3,60}?)\s*_*$/i.exec(line.text);
    if (match && looksLikePersonName(clean(match[1]))) {
      const titleLineAfter = lines[lines.indexOf(line) + 1];
      const role = titleLineAfter && /^\s*title\s*:\s*(.+)$/i.exec(titleLineAfter.text)?.[1];
      signatories.push(at({ nameAsWritten: clean(match[1]), ...(role ? { role: clean(role) } : {}) }, line, match[1].trim(), 0.7));
      continue;
    }
    // "Signed for the Contractor: Drew Hollis, Principal" / "Signed: Robin Vale, Chair, <org>".
    const signedFor = /^\s*signed(?:\s+for\s+(?:the\s+)?([^:]{2,60}))?\s*:\s*([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})(?:,\s*([A-Za-z][A-Za-z &-]{1,40}))?/i.exec(line.text);
    if (signedFor && looksLikePersonName(signedFor[2]) && !signatories.some((entry) => entry.value.nameAsWritten === signedFor[2])) {
      signatories.push(at({ nameAsWritten: signedFor[2], ...(signedFor[3] ? { role: clean(signedFor[3]) } : {}), ...(signedFor[1] ? { affiliation: clean(signedFor[1]) } : {}) }, line, signedFor[2], 0.7));
    }
  }
  const signedLine = lines.find((line) => /\bsigned (?:and delivered|this|on the)\b|\bexecuted\b.*\bday of\b/i.test(line.text));
  const marker = versionMarker(fileName);
  const signedName = /\bsigned\b|countersigned|executed/i.test(fileName);
  const asOf = input.asOfISO ?? new Date().toISOString().slice(0, 10);
  const status: FieldValue<"draft" | "signed" | "expired" | "unknown"> = marker === "draft" || /\bdraft\b/i.test(fileName) ? inferred("draft", [fileLoc(fileName)], 0.7)
    : expiry?.value && expiry.value.iso < asOf && (signedName || signedLine) ? inferred("expired", expiry.locators, 0.7, `Signed; term ended ${expiry.value.iso}.`)
      : signedName ? fromFile("signed", fileName, 0.65) : signedLine ? guessAt("signed", signedLine, undefined, 0.55) : notStated("No signature evidence.");
  // Contract numbers often sit in the page header ("Contract #: ABC-2013-2015").
  const numberLine = lines.slice(0, 80).find((line) => AGREEMENT_NUMBER.test(line.text)) ?? linesOf(extract, { includeParts: true }).filter((line) => line.part === "header").find((line) => AGREEMENT_NUMBER.test(line.text));
  const numberMatch = numberLine ? AGREEMENT_NUMBER.exec(numberLine.text) : AGREEMENT_NUMBER.exec(fileName);
  const agreementNumber = numberMatch ? (numberLine ? at(numberMatch[1] ?? numberMatch[2], numberLine, numberMatch[1] ?? numberMatch[2], 0.75) : fromFile(numberMatch[1] ?? numberMatch[2], fileName, 0.6)) : undefined;
  const funderLabel = labelled(lines.slice(0, 60), /funder|funding (?:agency|organization|source)|granting agency|submitted to/i);
  const fundingFrom = lines.find((line) => /\b(?:funding|grant|contribution)s? (?:from|by)\s+(?:the\s+)?[A-Z]/.test(line.text));
  const funderFrom = fundingFrom ? /\b(?:funding|grant|contribution)s? (?:from|by)\s+(?:the\s+)?([A-Z][\w&.'’ -]{2,80}?)(?:[,.;(]|\s+for\b|\s+to\b|$)/.exec(fundingFrom.text) : undefined;
  // A funder's letterhead / first line ("Coastal Air Futures Fund") on a grant document.
  // A funding request letter is addressed to the funder: the organization under "Attn:".
  const attnIndex = input.docClass === "grant" ? lines.slice(0, 12).findIndex((line) => /^\s*(?:attn|attention)\s*:/i.test(line.text)) : -1;
  const addressee = attnIndex >= 0 ? lines.slice(attnIndex + 1, attnIndex + 3).find((line) => /\b(?:district|council|ministry|fund|foundation|trust|agency|government|city|province|society|association|authority|credit union|bank)\b/i.test(line.text) && line.text.length < 100) : undefined;
  const letterhead = input.docClass === "grant" ? lines.slice(0, 3).find((line) => /\b(?:fund|foundation|ministry|trust|agency|government of|council|program)\b/i.test(line.text) && line.text.length < 100 && !/\b(?:agreement|application|proposal|report|society)\b/i.test(line.text)) : undefined;
  // "… the BC Lung Association, is able to provide funding of $10,500": the funder says so itself.
  const fundingSentence = input.docClass === "grant" ? funderSentence(lines.slice(0, 120)) : undefined;
  // Only a request is addressed to its funder; an award letter is addressed to the recipient.
  const requestLetter = grantStage === "application" || grantStage === "proposal";
  const funder = funderLabel && funderLabel.value.length < 120 ? at(clean(funderLabel.value.split(/\t/)[0]), funderLabel.line, funderLabel.value.split(/\t/)[0], 0.65) : funderFrom ? at(clean(funderFrom[1]), fundingFrom!, funderFrom[1], 0.55) : fundingSentence ? at(fundingSentence.name, fundingSentence.line, fundingSentence.name, 0.6) : letterhead ? guessAt(clean(letterhead.text), letterhead, undefined, 0.55, "Funder named in the letterhead.") : addressee && requestLetter ? guessAt(clean(addressee.text), addressee, undefined, 0.5, "Addressee of a funding request.") : undefined;
  const program = labelled(lines.slice(0, 60), /program(?: name)?|project (?:title|name)|initiative/i);
  const purpose = labelled(lines.slice(0, 80), /purpose|objective|project description/i);
  // Agreements are native (agreements register, A5); no whole-record gap is recorded any more.
  const motionRef = lines.find((line) => /\b(?:board|directors) (?:approved|resolution|motion)\b/i.test(line.text) && findDates(line.text)[0]);
  if (motionRef) references.push({ kind: "meeting", text: clean(motionRef.text).slice(0, 300), date: findDates(motionRef.text)[0].iso, locators: [loc(motionRef)] });
  if (/funder report|report/i.test(fileName) && agreementNumber?.value) references.push({ kind: "agreement", text: `Report under agreement ${agreementNumber.value}`, locators: agreementNumber.locators });
  const record = {
    kind: inferred(kind as any, titleCandidate ? [loc(titleCandidate)] : [fileLoc(fileName)], 0.65),
    title: titleCandidate ? at(titleText, titleCandidate, undefined, 0.8) : fromFile(titleText, fileName, 0.5),
    parties,
    ...(effective ? { effective } : {}),
    ...(expiry ? { expiry } : {}),
    ...(amount ? { amount } : {}),
    deliverables,
    reportingDue,
    signatories,
    status,
    ...(agreementNumber ? { agreementNumber } : {}),
    ...(funder ? { funder } : {}),
    ...(program && program.value.length < 160 ? { program: at(clean(program.value), program.line, program.value, 0.6) } : {}),
    ...(purpose && purpose.value.length < 400 ? { purpose: at(clean(purpose.value), purpose.line, purpose.value, 0.6) } : {}),
    grantStage: inferred(grantStage as any, [fileLoc(fileName)], 0.6),
    ...(amountRequested ? { amountRequested } : {}),
    ...(paymentSchedule.length ? { paymentSchedule } : {}),
    ...(reportingRequirements.length ? { reportingRequirements } : {}),
  };
  if (!parties.length) warnings.push("No parties recognised.");
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_AGREEMENT_ENGINE, record, unsupported, references, warnings };
}
