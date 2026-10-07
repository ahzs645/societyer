/** Bylaws / constitution / policy / terms-of-reference extractor (design §4.3).
 * Version label and dates, clause outline, and a typed rule extraction for
 * bylawRuleSets: quorum per body, notice periods, AGM cadence, proxies,
 * director count and term, electronic meetings, special-resolution threshold,
 * and signing-authority tiers (tables or sentences). */
import { versionMarker } from "../cluster";
import { bodyFromText } from "../minutes/extractMinutes";
import { findDates, findMoney } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, labelled, linesOf, loc, stripBullet, titleLine, type Line } from "./toolkit";

export const DETERMINISTIC_POLICY_ENGINE = "deterministic-policy/1";

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
/** "fourteen (14)", "(14)", "14", "sixty (60%) per cent", "two-thirds" → number. */
function numberIn(text: string): { value: number; text: string } | undefined {
  const paren = /\b([a-z-]+)\s*\((\d{1,3})%?\)/i.exec(text);
  if (paren) return { value: Number(paren[2]), text: paren[0] };
  const digits = /\b(\d{1,3})\s*%?/.exec(text);
  if (digits) return { value: Number(digits[1]), text: digits[0].trim() };
  const word = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "i").exec(text);
  if (word) return { value: WORD_NUMBERS[word[1].toLowerCase()], text: word[0] };
  return undefined;
}

type Sentence = { text: string; line: Line };
/** Sentences (one per paragraph line; long lines split on ". "). */
function sentencesOf(lines: Line[]): Sentence[] {
  const out: Sentence[] = [];
  for (const line of lines) {
    for (const piece of line.text.split(/(?<=[.;])\s+(?=[A-Z(])/)) if (piece.trim().length > 3) out.push({ text: piece.trim(), line });
  }
  return out;
}

export type ExtractedRules = NonNullable<ReturnType<typeof extractRules>>;

export function extractRules(lines: Line[], context: { governsBody?: string } = {}) {
  const sentences = sentencesOf(lines);
  const rules: Record<string, any> = {};
  const bodyQuorumRules: any[] = [];
  const pick = (re: RegExp, filter?: (sentence: Sentence) => boolean) => sentences.find((sentence) => re.test(sentence.text) && (!filter || filter(sentence)));
  // Quorum.
  for (const sentence of sentences.filter((candidate) => /\bquorum\b/i.test(candidate.text) && /\bquorum (?:is|shall be|for|of|necessary)|constitutes? a quorum|\bquorum\b.*\b(?:per ?cent|%|majority|members|directors)\b/i.test(candidate.text))) {
    if (/\bnot present|ceases to be|adjourned|within (?:fifteen|thirty|\d+)/i.test(sentence.text) && !/\bquorum (?:is|shall be)\b/i.test(sentence.text)) continue;
    const body: "general" | "board" | "committee" = /\bdirectors\b|\bboard\b/i.test(sentence.text) && !/general meeting/i.test(sentence.text) ? "board" : /\bcommittee\b/i.test(sentence.text) || context.governsBody ? "committee" : "general";
    if (bodyQuorumRules.some((rule) => rule.body.value === body)) continue;
    const percent = /(\d{1,3})\s*%|\((\d{1,3})%?\)\s*per\s*cent|(\d{1,3})\s*per\s*cent/i.exec(sentence.text);
    const majority = /\bmajority\b/i.test(sentence.text);
    const fixed = /\b(?:is|of|be)\s+([a-z]+\s*\(\d+\)|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?:voting\s+)?(?:members|directors|representatives|persons)/i.exec(sentence.text);
    const quorumType: "fixed" | "percentage" | "majority" | "all_members" = percent ? "percentage" : majority ? "majority" : /\ball (?:of the )?(?:members|directors)\b/i.test(sentence.text) ? "all_members" : "fixed";
    const value = percent ? Number(percent[1] ?? percent[2] ?? percent[3]) : fixed ? numberIn(fixed[1])?.value : undefined;
    const minimum = percent && fixed ? numberIn(fixed[1])?.value : undefined;
    if (quorumType === "fixed" && value === undefined) continue;
    bodyQuorumRules.push({
      body: at(body, sentence.line, undefined, 0.8),
      ...(body === "committee" && context.governsBody ? { committeeName: context.governsBody } : {}),
      quorumType: at(quorumType, sentence.line, percent?.[0] ?? (majority ? "majority" : fixed?.[0]), 0.8),
      ...(value !== undefined ? { quorumValue: at(value, sentence.line, percent?.[0] ?? fixed?.[0], 0.8) } : {}),
      ...(minimum !== undefined ? { quorumMinimumCount: at(minimum, sentence.line, fixed?.[0], 0.7) } : {}),
    });
    if (!rules.quorum) rules.quorum = at(sentence.text.slice(0, 300), sentence.line, undefined, 0.8);
  }
  // Notice of general meetings: "at least 14 days' notice", "not less than 14 days and not more than 60 days".
  const notice = pick(/\bnotice\b/i, (sentence) => /\b(?:days?)\b/i.test(sentence.text) && /\b(?:at least|not less than|not fewer than|minimum of|no less than)\b/i.test(sentence.text) && !/adjourn/i.test(sentence.text));
  if (notice) {
    const min = /\b(?:at least|not less than|not fewer than|minimum of|no less than)\s+([a-z-]+\s*\(\d+\)|\d+)\s*(?:clear\s+)?days?/i.exec(notice.text);
    const max = /\b(?:not more than|no more than|maximum of)\s+([a-z-]+\s*\(\d+\)|\d+)\s*days?/i.exec(notice.text);
    if (min) rules.noticeDays = at(numberIn(min[1])!.value, notice.line, min[0], 0.8);
    if (max) rules.noticeMaxDays = at(numberIn(max[1])!.value, notice.line, max[0], 0.8);
  }
  // AGM cadence.
  // The AGM-holding rule ("… shall be held at least once in every calendar year"), not
  // "membership shall be determined annually at the AGM".
  const agm = pick(/annual general meeting|general meeting must be held annually|held annually/i, (sentence) => /\b(?:held|hold|holds)\b/i.test(sentence.text) && /calendar year|every year|annually|months? after|days? of the fiscal year/i.test(sentence.text));
  if (agm) {
    const calendar = /at least once in every calendar year|once (?:in )?every calendar year|each calendar year/i.exec(agm.text);
    const annually = calendar ? undefined : /held annually|every year|once a year/i.exec(agm.text);
    if (calendar || annually) rules.agmFrequency = at(calendar ? "calendar_year" : "annual", agm.line, (calendar ?? annually)![0], 0.85);
    const months = /not more than\s+([a-z]+\s*\(\d+\)|\d+)\s+months after the holding of the last/i.exec(agm.text);
    if (months) rules.agmMaxMonthsBetween = at(numberIn(months[1])!.value, agm.line, months[0], 0.8);
  }
  // Proxies.
  const proxyNo = pick(/\b(?:proxy voting is not permitted|voting by proxy is not permitted|no proxy|proxies are not permitted|may not vote by proxy)\b/i);
  const proxyYes = proxyNo ? undefined : pick(/\b(?:voting by proxy is permitted|proxy voting is permitted|may,? by proxy,? appoint|may appoint a proxy|appoint (?:one )?proxy holder)\b/i);
  if (proxyNo || proxyYes) rules.proxiesAllowed = at(Boolean(proxyYes), (proxyNo ?? proxyYes)!.line, /proxy[^.;,]*/i.exec((proxyNo ?? proxyYes)!.text)?.[0], 0.85);
  const holder = pick(/\bproxy holder\b.*\bunless\b.*\b(?:member|director)\b|\bproxy holder must be a member\b/i);
  if (holder) rules.proxyHolderMustBeMember = at(true, holder.line, undefined, 0.7, /authori[sz]ed by the organization/i.test(holder.text) ? "A non-member may hold a proxy when authorized by the appointing organization." : undefined);
  const limit = pick(/\bnot hold more than\s+(?:[a-z]+\s*\(\d+\)|\d+)\s+prox/i);
  if (limit) {
    const match = /\bnot hold more than\s+([a-z]+\s*\(\d+\)|\d+)/i.exec(limit.text)!;
    rules.proxyLimitPerHolder = at(numberIn(match[1])!.value, limit.line, match[0], 0.8);
  }
  // Director count and term.
  const count = pick(/\b(?:number of directors|board (?:shall|must) consist of|consist of not (?:less|fewer) than|directors? shall be not (?:less|fewer) than|no (?:less|fewer) than\s+\S+\s+(?:and )?no more than)\b/i, (sentence) => /\bdirectors?\b/i.test(sentence.text) && !/committee/i.test(sentence.text));
  if (count) {
    const min = /\b(?:not (?:less|fewer) than|no (?:less|fewer) than|at least|minimum of)\s+([a-z]+\s*\(\d+\)|\d+)/i.exec(count.text);
    const max = /\b(?:not more than|no more than|nor more than|maximum of)\s+([a-z]+\s*\(\d+\)|\d+)/i.exec(count.text);
    if (min) rules.directorCountMin = at(numberIn(min[1])!.value, count.line, min[0], 0.75);
    if (max) rules.directorCountMax = at(numberIn(max[1])!.value, count.line, max[0], 0.75);
  }
  const term = pick(/\bterm (?:for|of) (?:office of )?directors?\b|\bdirectors? (?:shall|will) (?:hold office|serve) for\b|\bdirectors? (?:are|is|shall be|will be) (?:elected|appointed) for a term\b|\bdirector\b.*\buntil the next (?:agm|annual general meeting)\b/i);
  if (term) {
    rules.directorTerm = at(term.text.slice(0, 240), term.line, undefined, 0.75);
    const years = /\b([a-z]+\s*\(\d+\)|\d+|one|two|three|four|five)[\s-]+years?\b/i.exec(term.text);
    if (years && numberIn(years[1])) rules.directorTermYears = at(numberIn(years[1])!.value, term.line, years[0], 0.75);
  }
  const electronic = pick(/\belectronic means\b|\bby (?:telephone|video|electronic)\b.*\bmeeting|meetings? .*\b(?:telephone|electronic|video)/i, (sentence) => /\bmay\b|permitted|deemed to be present/i.test(sentence.text));
  if (electronic) rules.electronicMeetings = at(true, electronic.line, undefined, 0.65);
  const special = pick(/\bspecial resolution\b.*\b(?:two-thirds|2\/3|75%|three-quarters|66)/i);
  if (special) {
    const threshold = /two-thirds|2\/3|66\.?\d*%/i.test(special.text) ? 66.67 : /three-quarters|75%/i.test(special.text) ? 75 : undefined;
    if (threshold) rules.specialResolutionThresholdPct = at(threshold, special.line, /two-thirds|2\/3|66\.?\d*%|three-quarters|75%/i.exec(special.text)![0], 0.7);
  }
  const fiscal = pick(/\b(?:fiscal|financial) year\b.*\b(?:end(?:s|ing)?|is)\b.*\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i);
  if (fiscal) {
    const date = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?/i.exec(fiscal.text)!;
    rules.fiscalYearEnd = at(date[0], fiscal.line, date[0], 0.7);
  }
  if (bodyQuorumRules.length) rules.bodyQuorumRules = bodyQuorumRules;
  return Object.keys(rules).length ? rules : undefined;
}

/** Signing tiers from a table (Expenditure Range | … | # Signatures) or sentences ("over $10,000 … two signatures"). */
export function signingTiers(extract: ClassExtractorInput["extract"], lines: Line[]) {
  const tiers: any[] = [];
  for (const block of extract.blocks) {
    if (block.kind !== "table") continue;
    const header = (block.rows?.[0]?.cells ?? []).map((cell) => cell.text.trim().toLowerCase());
    const rangeCol = header.findIndex((text) => /range|amount|limit|expenditure|threshold/.test(text));
    const sigCol = header.findIndex((text) => /signature|# sign|number of sign/.test(text));
    const roleCol = header.findIndex((text) => /authority to sign|signing authority|signator|who (?:may|can) sign|authority to approve/.test(text));
    if (rangeCol < 0 || (sigCol < 0 && roleCol < 0)) continue;
    (block.rows ?? []).slice(1).forEach((row, offset) => {
      const rangeText = row.cells[rangeCol]?.text.trim() ?? "";
      const line = lines.find((candidate) => candidate.blockIndex === block.index && candidate.row === offset + 1 && candidate.col === rangeCol);
      if (!line || !rangeText) return;
      const amounts = findMoney(rangeText);
      let minCents: number | undefined, maxCents: number | undefined;
      if (/up to|under|less than|below/i.test(rangeText) && amounts[0]) maxCents = amounts[0].amountCents;
      else if (/and over|or more|above|over|\+/i.test(rangeText) && amounts[0]) minCents = amounts[0].amountCents;
      else if (amounts.length >= 2) {
        minCents = amounts[0].amountCents;
        maxCents = amounts[1].amountCents;
      }
      const sigText = sigCol >= 0 ? row.cells[sigCol]?.text.trim() ?? "" : "";
      const signatures = numberIn(sigText)?.value ?? 1;
      const roles = roleCol >= 0 ? (row.cells[roleCol]?.text ?? "").split("\n").map((part) => stripBullet(part).replace(/;?\s*or$/i, "").replace(/[;,]$/, "").trim()).filter(Boolean) : [];
      tiers.push({ text: at(rangeText, line, undefined, 0.8), ...(minCents !== undefined ? { minCents } : {}), ...(maxCents !== undefined ? { maxCents } : {}), signaturesRequired: Math.max(1, Math.min(10, signatures)), ...(roles.length ? { roles } : {}) });
    });
  }
  if (!tiers.length) {
    for (const line of lines) {
      const match = /(?:cheques?|payments?|expenditures?|contracts?)[^.]*?(over|above|exceeding|under|up to|less than)\s+(\$[\d,]+(?:\.\d{2})?)[^.]*?\b(one|two|three|\d)\s+(?:\(\d\)\s+)?(?:signatures|signing officers|signatories)/i.exec(line.text);
      if (!match) continue;
      const cents = findMoney(match[2])[0]?.amountCents;
      const above = /over|above|exceeding/i.test(match[1]);
      tiers.push({ text: at(match[0], line, match[0], 0.65), ...(cents !== undefined ? (above ? { minCents: cents } : { maxCents: cents }) : {}), signaturesRequired: numberIn(match[3])?.value ?? 2 });
    }
  }
  return tiers;
}

function kindFor(fileName: string, title: string): "bylaws" | "constitution" | "policy" | "terms_of_reference" | "procedure" | "unknown" {
  const text = `${title} ${fileName.replace(/[_.]/g, " ")}`;
  if (/terms of reference|\btor\b/i.test(text)) return "terms_of_reference";
  if (/\b[Bb]y-?[Ll]aws?(?![a-z])|\bBYLAWS?\b/.test(text)) return "bylaws";
  if (/\bconstitution\b/i.test(text)) return "constitution";
  if (/\bprocedures?\b|\bprotocol\b|\bguidelines?\b/i.test(text)) return "procedure";
  if (/\bpolic(?:y|ies)\b|\bcode of conduct\b|\bcharter\b|\bdelegation\b/i.test(text)) return "policy";
  return "unknown";
}

const CLAUSE_HEADING = /^\s*((?:PART|ARTICLE|SECTION|SCHEDULE)\s+[\dIVXLC]+[A-Z]?)\s*[-–—.:]?\s*(.{0,120})$/i;
const NUMBERED_CLAUSE = /^\s*(\d{1,3}(?:\.\d{1,3}){0,2})[.)]?\s+(?=\S)(.{3,})$/;

export function extractPolicy(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const namedTitle = lines.slice(0, 12).find((line) => /\b(?:constitution|by-?laws?|terms of reference|policy|procedures?|protocol|charter|code of conduct)\b/i.test(line.text) && line.text.trim().length < 140 && !/^\s*(?:the|in|a|an)\s/i.test(line.text) && !/[.;]\s*$/.test(line.text.trim()));
  const headingLine = namedTitle ?? lines.slice(0, 12).find((line) => line.kind === "heading" && line.text.trim().length > 3 && !/^\s*(?:form\s+\d|\d{1,2}[.)]\s)/i.test(line.text)) ?? titleLine(lines);
  // A bare running header ("Policy", "LCAS Policy" with an upper-case acronym): the title is the next line.
  const genericFirst = headingLine && /^\s*(?:[A-Z][A-Z&.]{1,6}(?:\s[A-Z]{2,6})?\s+)?(?:[Pp]olicy|POLICY)\s*$|^\s*(?:[Bb]ylaws?|BYLAWS?|[Cc]onstitution|CONSTITUTION)\s*$/.test(headingLine.text) ? lines[lines.indexOf(headingLine) + 1] : undefined;
  const titleSource = genericFirst && genericFirst.text.trim().length > 3 && genericFirst.text.trim().length < 140 && !/^\s*(?:last updated|date|effective|\d{1,2}[.)]\s|[a-z]\.\s)/i.test(genericFirst.text) ? genericFirst : headingLine;
  const titleText = titleSource ? clean(titleSource.text.replace(/^\s*(?:subject|title|re)\s*:\s*/i, "")) : fileName.replace(/\.[a-z0-9]+$/i, "");
  const kind = kindFor(fileName, titleText);
  const external = /\bbylaw no\.?\s*\d|\bcity of [a-z ]+ bylaw\b|\bcouncil of the city\b|^bl\d{3,}|\bmodel bylaw\b|\bmunicipal\b[^\n]{0,40}\bbylaw\b/i.test(`${fileName}\n${lines.slice(0, 15).map((line) => line.text).join("\n")}`) && !/\bsociety\b.{0,80}\bbylaws? of\b|bylaws of the [a-z ]+society/i.test(lines.slice(0, 10).map((line) => line.text).join(" "));
  // Version label and dates.
  const versionLine = lines.slice(0, 20).find((line) => (/^\s*\(?(?:last (?:updated|revised|amended)|revised|amended|version|v\d+(?:\.\d+)?|effective|approved|adopted|accepted|draft|final)\b/i.test(line.text) || /\((?:last (?:updated|revised|amended))[^)]*\)/i.test(line.text)) && line.text.length < 200);
  const marker = versionMarker(fileName);
  const nameVersion = /\b(Amended [\d-]+|Final Draft Approved[^)]*|Final|Accepted|Approved|DRAFT|v\d+(?:\.\d+)?|Revised)\b/i.exec(fileName);
  const versionLabel = versionLine ? at(clean(versionLine.text).slice(0, 160), versionLine, undefined, 0.75) : nameVersion ? fromFile(nameVersion[0], fileName, 0.55) : undefined;
  const effectiveLine = lines.slice(0, 40).find((line) => /\beffective\b/i.test(line.text) && findDates(line.text)[0]);
  const updatedLine = lines.slice(0, 20).find((line) => /\b(?:last updated|last revised|amended|updated)\b/i.test(line.text) && findDates(line.text, { allowMonthPrecision: true })[0]);
  // "October 2018 (last updated February 15, 2022)": the date after the keyword is the current version's.
  const updatedDate = updatedLine ? (findDates(updatedLine.text.slice(updatedLine.text.search(/\b(?:last updated|last revised|amended|updated)\b/i)), { allowMonthPrecision: true })[0] ?? findDates(updatedLine.text, { allowMonthPrecision: true })[0]) : undefined;
  const adoptedLine = lines.find((line) => /\b(?:approved|adopted|accepted|ratified|passed)\b/i.test(line.text) && findDates(line.text)[0] && line.text.length < 300);
  const nameDate = findDates(fileName.replace(/_/g, " "), { allowNumericShortYear: false }).find((date) => date.precision === "day");
  const effectiveDate = effectiveLine ? at(dateValue(findDates(effectiveLine.text)[0]), effectiveLine, findDates(effectiveLine.text)[0].text, 0.8)
    : updatedLine && updatedDate ? guessAt(dateValue(updatedDate), updatedLine, updatedDate.text, 0.6, "Last-updated / amended date; effective date assumed.")
      : undefined;
  // A labelled "Adopted: <date>" / "Approved by the board: <date>" line states the date directly (bulk-acceptable);
  // a date elsewhere in a sentence that mentions approval stays a lower-confidence reading.
  const adoptedLabelled = adoptedLine ? /^\s*(?:date\s+)?(?:approved|adopted|accepted|ratified|passed)\b[^:]{0,40}:\s*\S/i.test(adoptedLine.text) : false;
  const adoptedDate = adoptedLine ? at(dateValue(findDates(adoptedLine.text)[0]), adoptedLine, findDates(adoptedLine.text)[0].text, adoptedLabelled ? 0.85 : 0.7)
    : nameDate && /approved|accepted|adopted|amended/i.test(fileName) ? fromFile(dateValue(nameDate), fileName, 0.55, "Approval/amendment date from the file name.") : undefined;
  const status: FieldValue<"draft" | "adopted" | "filed" | "superseded" | "unknown"> = marker === "draft" || /\bdraft\b/i.test(fileName) && !/approved/i.test(fileName)
    ? inferred("draft", [fileLoc(fileName)], 0.7, "DRAFT marker in the file name.")
    : /\bfiled with the registrar|registrar of companies.*filed|certified (?:true )?copy/i.test(extract.text.slice(0, 4000)) ? inferred("filed", [loc(lines.find((line) => /filed|certified/i.test(line.text))!)], 0.6)
      : adoptedDate || /\b(?:approved|accepted|adopted|final)\b/i.test(fileName) ? inferred("adopted", adoptedDate?.locators ?? [fileLoc(fileName)], 0.55, "Approved/accepted/final marker; confirm against the adopting motion.")
        : notStated("No adoption evidence in the document.");
  // Clause outline.
  const clauses: any[] = [];
  let part: string | undefined;
  for (const line of lines) {
    if (line.kind === "table") continue;
    const heading = CLAUSE_HEADING.exec(line.text);
    if (heading) {
      part = heading[1].replace(/\s+/g, " ");
      clauses.push({ number: at(part, line, heading[1], 0.85), ...(heading[2].trim() ? { heading: at(clean(heading[2]), line, heading[2].trim(), 0.85) } : {}), text: [loc(line)] });
      continue;
    }
    if (line.kind === "heading" || (/^[A-Z][A-Z &/,'’()-]{3,80}:?$/.test(line.text.trim()) && kind !== "bylaws")) {
      clauses.push({ heading: at(clean(line.text), line, undefined, 0.75), text: [loc(line)] });
      continue;
    }
    const numbered = NUMBERED_CLAUSE.exec(line.text);
    if (numbered && (kind === "bylaws" || kind === "constitution") && line.text.length > 25 && clauses.length < 400) {
      clauses.push({ number: at(part ? `${part.replace(/^part\s+/i, "")}.${numbered[1]}` : numbered[1], line, numbered[1], 0.7), text: [loc(line)] });
    }
  }
  const governs = kind === "terms_of_reference" ? bodyFromText(titleText) : undefined;
  const rules = external ? undefined : extractRules(lines, { governsBody: governs?.label });
  const tiers = signingTiers(extract, lines);
  if (rules || tiers.length) {
    if (tiers.length) {
      (rules ?? {}).signingTiersDetail = tiers;
    }
  }
  const allRules = rules ?? (tiers.length ? { signingTiersDetail: tiers } : undefined);
  if (allRules && tiers.length) allRules.signingTiersDetail = tiers;
  if (allRules?.signingTiersDetail) allRules.signingTiers = allRules.signingTiersDetail.map((tier: any) => tier.text);
  // Gaps the rule set cannot hold.
  for (const line of lines) {
    if (/\bconsensus\b.*\b(?:defined|decided|reach)/i.test(line.text) && !unsupported.some((item) => item.infoType === "governance.consensus_rule")) unsupported.push({ description: "Decision rule by consensus (with dissent reports) — bylawRuleSets has no consensus/dissent rule.", locators: [loc(line)], suggestedTarget: "bylawRuleSets.decisionRule", category: "no_field", infoType: "governance.consensus_rule" });
    if (/within (?:ninety|\w+)\s*\(?\d*\)?\s*days of the fiscal year end/i.test(line.text) && !unsupported.some((item) => item.infoType === "agm.deadline_after_year_end")) unsupported.push({ description: "AGM deadline relative to the fiscal year end.", locators: [loc(line)], suggestedTarget: "bylawRuleSets.agmWithinDaysOfYearEnd", category: "no_field", infoType: "agm.deadline_after_year_end" });
    if (/\bmay appoint, in accordance with these bylaws, one .*representative|\bseats? at (?:the )?table\b/i.test(line.text) && !unsupported.some((item) => item.infoType === "membership.organization_seats")) unsupported.push({ description: "Organization-seat membership: member organizations appoint representatives who act as directors.", locators: [loc(line)], suggestedTarget: "organizationSeats.rule", category: "no_field", infoType: "membership.organization_seats" });
  }
  // References: the meeting/resolution that adopted this version.
  if (adoptedDate?.value) references.push({ kind: "meeting", text: `Adoption of ${titleText} (${adoptedDate.value.text ?? adoptedDate.value.iso})`, date: adoptedDate.value.iso, locators: adoptedDate.locators });
  const adoptedAtLine = lines.find((line) => /\b(?:these|this|the) (?:bylaws?|constitution|policy|terms of reference)\b.*\b(?:were|was|is|are)\s+(?:passed|adopted|approved|accepted|ratified)\b|\b(?:passed|adopted|approved|accepted)\b.*\b(?:by|as a) special resolution\b.*\b(?:on|dated)\b/i.test(line.text) && line.text.length < 300);
  if (!titleSource) warnings.push("No title line found; using the file name.");
  const policyNumberHit = labelled(lines.slice(0, 20), /policy\s*(?:no\.?|number|#)|policy\s+id/i);
  const policyNumberValue = policyNumberHit ? /^[A-Z]{0,6}[-\s]?\d{1,4}(?:[.-]\d{1,3})?[A-Z]?\b/i.exec(policyNumberHit.value)?.[0] : undefined;
  const reviewHit = labelled(lines.slice(0, 30), /(?:next\s+)?review(?:\s+date)?|to be reviewed(?: by)?|review by/i);
  const reviewFound = reviewHit ? findDates(reviewHit.value, { allowMonthPrecision: true })[0] : undefined;
  const organization = lines.slice(0, 6).find((line) => /\bsociety\b|\broundtable\b|\bassociation\b/i.test(line.text) && line.text.length < 160);
  const record = {
    title: titleSource ? at(titleText, titleSource, undefined, 0.8) : fromFile(titleText, fileName, 0.5),
    kind: inferred(kind, titleSource ? [loc(titleSource)] : [fileLoc(fileName)], 0.75),
    ...(versionLabel ? { versionLabel } : {}),
    ...(effectiveDate ? { effectiveDate } : {}),
    ...(adoptedAtLine ? { adoptedAt: at(clean(adoptedAtLine.text).slice(0, 200), adoptedAtLine, undefined, 0.6) } : {}),
    status,
    clauses: clauses.slice(0, 400),
    ...(allRules ? { rules: allRules } : {}),
    ...(organization ? { organizationName: at(clean(organization.text).slice(0, 160), organization, undefined, 0.6) } : {}),
    ...(adoptedDate ? { adoptedDate } : {}),
    ...(policyNumberHit && policyNumberValue ? { policyNumber: at(policyNumberValue, policyNumberHit.line, policyNumberValue, 0.8) } : {}),
    ...(reviewHit && reviewFound ? { reviewDate: at(dateValue(reviewFound), reviewHit.line, reviewFound.text, 0.75) } : {}),
    ...(governs ? { governsBody: at(governs.label, titleSource!, undefined, 0.75) } : {}),
    ...(external ? { external: inferred(true, [titleSource ? loc(titleSource) : fileLoc(fileName)], 0.7, "A third party's bylaw kept as reference, not the organization's own rules.") } : {}),
  };
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_POLICY_ENGINE, record, unsupported, references, warnings };
}
