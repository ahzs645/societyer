/** Agreements, contracts, funding letters and grant applications/awards
 * (design §4.3). Parties, type, effective/expiry dates, amounts, payment
 * schedule, deliverables, reporting due dates and signatories. There is no
 * native agreements table: agreements become representation gaps plus
 * deadlines; grants become `grants` with the rich C10 fields. */
import { versionMarker } from "../cluster";
import { looksLikePersonName } from "../names";
import { findDates, findMoney } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, labelled, linesOf, loc, stripBullet, titleLine, type Line } from "./toolkit";

export const DETERMINISTIC_AGREEMENT_ENGINE = "deterministic-agreement/1";

const AGREEMENT_NUMBER = /\b(?:agreement|contract|grant|file|reference|project)\s*(?:no\.?|number|#|id)\s*:?\s*#?([A-Z0-9][A-Z0-9-]{4,})\b|\b([A-Z]{2}\d{2}[A-Z]{3}\d{4})\b/i;

function partiesIn(lines: Line[]): Array<FieldValue<string>> {
  const out: Array<FieldValue<string>> = [];
  const between = lines.findIndex((line) => /^\s*between\s*:?\s*$|^\s*between\b/i.test(line.text));
  const ORG = /\b(?:society|council|district|city|ministry|province|roundtable|association|ltd|inc|corporation|company|group|university|authority|foundation|bank|credit union|limited|government|agency|board)\b/i;
  const push = (line: Line, name: string) => {
    const value = clean(name.replace(/\s*\(.*$/, "").replace(/,\s*(?:a|an)\s+(?:duly|company|society|corporation|body).*$/i, "").replace(/\s+the secretariat for\b.*$/i, ""));
    if (!ORG.test(value) || /^(?:you|we|the parties)\b/i.test(value)) return;
    if (value.length >= 3 && value.length <= 120 && !out.some((party) => party.value!.toLowerCase() === value.toLowerCase())) out.push(at(value, line, name.trim().slice(0, 300), 0.75));
  };
  if (between >= 0) {
    for (const line of lines.slice(between, between + 14)) {
      // The parties block ends at the first clause, recital or signature line.
      if (line !== lines[between] && /^\s*(?:\d{1,2}[.)]\s|whereas\b|now therefore\b|recitals?\b|signed\b|in witness\b|this agreement\b)/i.test(line.text)) break;
      const text = line.text.replace(/^\s*(?:between|and)\s*:?\s*/i, "").trim();
      if (!text || /^(?:of the (?:first|second) part|between|and)\s*:?$/i.test(text) || /^\(herein/i.test(text)) continue;
      if (/^[A-Z][A-Za-z&.,'’ -]{3,}/.test(text) && /\b(?:society|council|district|city|ministry|province|roundtable|association|ltd|inc|corporation|company|group|university|authority|foundation|bank|credit union|limited)\b/i.test(text)) push(line, text.split(/\t/)[0]);
      if (out.length >= 3) break;
    }
  }
  if (out.length < 2) {
    for (const line of lines.slice(0, 40)) {
      for (const match of line.text.matchAll(/([A-Z][\w&.'’ -]{3,80}?)\s*\((?:the\s+)?[“"]([A-Z][\w ]{1,30})[”"]/g)) push(line, match[1]);
      const submitted = /^\s*submitted (?:to|by)\s*:\s*(.+)$/i.exec(line.text);
      if (submitted) push(line, submitted[1]);
    }
  }
  return out.slice(0, 4);
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
    const termLine = lines.find((line) => /\b(?:term of this (?:agreement|contract)|agreement (?:is|shall be) (?:in effect|effective)|from\b.*\bto\b|commenc\w+ on|runs from)\b|^\s*(?:\d{1,2}[.)]\s*)?(?:term|project period|funding period|agreement period)\s*[:.]/i.test(line.text) && findDates(line.text).filter((date) => date.precision === "day").length >= 2);
    if (termLine) {
      const dates = findDates(termLine.text).filter((date) => date.precision === "day");
      effective ??= at(dateValue(dates[0]), termLine, dates[0].text, 0.8);
      expiry ??= at(dateValue(dates[1]), termLine, dates[1].text, 0.8);
    }
  }
  return { effective, expiry };
}

export function extractAgreement(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const titleCandidate = lines.slice(0, 15).find((line) => /\b(?:agreement|contract|memorandum of understanding|\bmou\b|letter of (?:agreement|understanding)|terms and conditions|proposal|application|funding|grant|contribution|service agreement)\b/i.test(line.text) && line.text.length < 160) ?? titleLine(lines);
  const titleText = titleCandidate ? clean(titleCandidate.text) : fileName.replace(/\.[a-z0-9]+$/i, "");
  const textHead = `${fileName} ${lines.slice(0, 40).map((line) => line.text).join(" ")}`;
  const kind = /memorandum of understanding|\bmou\b/i.test(textHead) ? "mou"
    : /\bgrant\b|funding agreement|contribution agreement|funding (?:request|support|application)|proposal|application/i.test(textHead) && input.docClass === "grant" ? (/letter/i.test(fileName) ? "funding_letter" : "grant")
      : /\bcontract\b/i.test(textHead) ? "contract" : /agreement/i.test(textHead) ? "agreement" : input.docClass === "grant" ? "grant" : "unknown";
  const grantStage = /\bapplication\b|\brequest(?:ing|s)?\b[^.]{0,40}\b(?:funding|support|contribution)\b/i.test(textHead) ? "application" : /\bproposal\b/i.test(textHead) ? "proposal" : /\breport\b/i.test(fileName) ? "report" : /pleased to (?:inform|advise|confirm)|has been approved|award(?:ed)?\b/i.test(textHead) ? "award" : /agreement|contract/i.test(textHead) ? "agreement" : "unknown";
  const parties = partiesIn(lines);
  const { effective, expiry } = termIn(lines);
  // Amount: the largest money value next to a "maximum / total / amount / not exceed / contribution / grant" cue.
  let amount: FieldValue<any> | undefined;
  let amountRequested: FieldValue<any> | undefined;
  for (const line of lines) {
    const cue = /\b(?:maximum|total|not (?:to )?exceed|amount of|contract (?:price|amount|value)|contribution of|grant of|funding of|in the amount|sum of|fees? (?:payable|of)|(?:will|shall) pay|(?:approved|awarded|grant|funding|contract) amount)\b|^\s*(?:amount|fees?)\s*[:.]/i.test(line.text);
    const requested = /\b(?:request(?:ed|ing)?|ask)\b/i.test(line.text);
    if (!cue && !requested) continue;
    const money = findMoney(line.text).sort((a, b) => b.amountCents - a.amountCents)[0];
    if (!money || money.amountCents < 10000) continue;
    const value = { amountCents: money.amountCents, currency: money.currency, text: money.text };
    if (requested && !amountRequested) amountRequested = at(value, line, money.text, 0.7);
    else if (cue && !amount) amount = at(value, line, money.text, 0.75);
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
    if (/\b(?:scope of (?:work|services)|deliverables|services|will\s*:|responsibilities|outcomes|activities)\b\s*:?\s*$/i.test(text)) {
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
  // Contract numbers often sit in the page header ("Contract #: FBC-2013-2015").
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
  const funder = funderLabel && funderLabel.value.length < 120 ? at(clean(funderLabel.value.split(/\t/)[0]), funderLabel.line, funderLabel.value.split(/\t/)[0], 0.65) : funderFrom ? at(clean(funderFrom[1]), fundingFrom!, funderFrom[1], 0.55) : letterhead ? guessAt(clean(letterhead.text), letterhead, undefined, 0.55, "Funder named in the letterhead.") : addressee ? guessAt(clean(addressee.text), addressee, undefined, 0.5, "Addressee of a funding request.") : undefined;
  const program = labelled(lines.slice(0, 60), /program(?: name)?|project (?:title|name)|initiative/i);
  const purpose = labelled(lines.slice(0, 80), /purpose|objective|project description/i);
  // An agreement has no native target: record a representation gap (grants are native).
  if (input.docClass === "agreement" && kind !== "grant") {
    unsupported.push({ description: `${titleText}${parties.length ? ` between ${parties.map((party) => party.value).join(" and ")}` : ""}${effective?.value ? `, ${effective.value.iso}` : ""}${expiry?.value ? ` to ${expiry.value.iso}` : ""}${amount?.value ? `, ${amount.value.text}` : ""}.`, locators: titleCandidate ? [loc(titleCandidate)] : [fileLoc(fileName)], suggestedTarget: "agreements.record", category: "no_table", infoType: "agreement.contract" });
  }
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
