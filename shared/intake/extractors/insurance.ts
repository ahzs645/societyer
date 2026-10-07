/** Insurance extractor (declarations pages, renewals, certificates of insurance).
 * Insurer, broker, policy number, term, coverages with limits/deductibles,
 * premium and fees. The proposed native status is explicit and reviewed:
 * Lapsed when the term has ended, otherwise NeedsReview — never Active. */
import { findDates, validIsoDay } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, inlineLabelled, labelled, linesOf, loc, type Line } from "./toolkit";

export const DETERMINISTIC_INSURANCE_ENGINE = "deterministic-insurance/1";

type DateVal = { iso: string; precision: "day" | "month" | "year"; text: string };

/** "$5 000 000", "$2,000,000", "$600.00", "55.00" → cents. */
function moneyText(text: string): { cents: number; text: string } | undefined {
  const match = /\$\s?(\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.(\d{2}))?/.exec(text);
  if (!match) return undefined;
  const whole = Number(match[1].replace(/[, ]/g, ""));
  return { cents: Math.round(whole * 100) + (match[2] ? Number(match[2]) : 0), text: match[0].trim() };
}

/** Policy period: "6 5 2016 6 5 2017" (DAY MONTH YEAR), "2022/05/06 2023/05/06", "from May 6, 2022 to May 6, 2023". */
function termIn(lines: Line[]): { start?: DateVal; end?: DateVal; line?: Line; startText?: string; endText?: string } {
  for (const line of lines) {
    const dmy = /\b(\d{1,2})\s+(\d{1,2})\s+((?:19|20)\d{2})\s+(\d{1,2})\s+(\d{1,2})\s+((?:19|20)\d{2})\b/.exec(line.text);
    if (dmy && /period|day\s+month\s+year|12:01/i.test(lines.slice(Math.max(0, lines.indexOf(line) - 1), lines.indexOf(line) + 1).map((candidate) => candidate.text).join(" "))) {
      const start = validIsoDay(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
      const end = validIsoDay(Number(dmy[6]), Number(dmy[5]), Number(dmy[4]));
      if (start && end) return { start: { iso: start, precision: "day", text: `${dmy[1]} ${dmy[2]} ${dmy[3]}` }, end: { iso: end, precision: "day", text: `${dmy[4]} ${dmy[5]} ${dmy[6]}` }, line, startText: `${dmy[1]} ${dmy[2]} ${dmy[3]}`, endText: `${dmy[4]} ${dmy[5]} ${dmy[6]}` };
    }
    // Certificate tables: "2024/08/27  2024/08/29" (OCR reads the column rule between them as "|").
    const ymd = /\b((?:19|20)\d{2})\/(\d{2})\/(\d{2})[\s|]+((?:19|20)\d{2})\/(\d{2})\/(\d{2})\b/.exec(line.text);
    if (ymd) {
      const start = validIsoDay(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
      const end = validIsoDay(Number(ymd[4]), Number(ymd[5]), Number(ymd[6]));
      if (start && end) return { start: { iso: start, precision: "day", text: `${ymd[1]}/${ymd[2]}/${ymd[3]}` }, end: { iso: end, precision: "day", text: `${ymd[4]}/${ymd[5]}/${ymd[6]}` }, line, startText: `${ymd[1]}/${ymd[2]}/${ymd[3]}`, endText: `${ymd[4]}/${ymd[5]}/${ymd[6]}` };
    }
    if (/\b(?:policy period|period of insurance|term|effective)\b/i.test(line.text)) {
      const dates = findDates(line.text).filter((date) => date.precision === "day");
      if (dates.length >= 2) return { start: dateValue(dates[0]), end: dateValue(dates[1]), line, startText: dates[0].text, endText: dates[1].text };
    }
  }
  return {};
}

const KIND_RULES: Array<[RegExp, "directors_officers" | "general_liability" | "errors_omissions" | "property" | "cyber"]> = [
  [/\bD\s*&\s*O\b|directors (?:and|&) officers/i, "directors_officers"],
  [/errors (?:and|&) omissions|\bE\s*&\s*O\b|miscellaneous professionals|professional liability/i, "errors_omissions"],
  [/commercial general liability|\bCGL\b|general liability/i, "general_liability"],
  [/\bproperty\b|contents|building/i, "property"],
  [/\bcyber\b/i, "cyber"],
];

const COVERAGE_LINE = /^(?:[•●▪-]\s*)?(?:[A-H]\.\s*)?(?:Coverage [A-H]\s*-\s*)?([A-Z][A-Za-z&/ ,()'’-]{3,70}?)\s*\t?\s*(\$\s?\d[\d, ]*(?:\.\d{2})?|Included|Excluded)(?:\s+(\$\s?\d[\d,]*(?:\.\d{2})?|nil)\b)?/i;

export function extractInsurance(input: ClassExtractorInput & { asOfISO?: string }): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const head = lines.slice(0, 120);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const text = head.map((line) => line.text).join("\n");
  const isCertificate = /certificate of insurance/i.test(`${fileName}\n${text.slice(0, 400)}`);
  const documentType: "policy" | "renewal" | "certificate" | "endorsement" | "invoice" | "questionnaire" | "unknown" = isCertificate ? "certificate"
    : /questionnaire|application/i.test(fileName) ? "questionnaire"
      : /\binvoice\b/i.test(fileName) ? "invoice"
        : /\bendorsement\b/i.test(`${fileName} ${text.slice(0, 300)}`) && !/declarations page/i.test(text) ? "endorsement"
          : /renewal/i.test(`${fileName} ${text.slice(0, 1200)}`) ? "renewal" : /declarations? page|policy/i.test(text) ? "policy" : "unknown";
  // Policy number.
  const policyLine = head.find((line) => /policy (?:number|no\.?|#)\s*:?\s*#?[A-Z0-9-]{4,}/i.test(line.text)) ?? head.find((line) => /document no\.?\s*[A-Z]{1,4}\d{3,}[A-Z0-9-]*/i.test(line.text));
  const policyMatch = policyLine ? /policy (?:number|no\.?|#)\s*:?\s*#?([A-Z]{0,4}-?\d[A-Z0-9-]{3,})|document no\.?\s*([A-Z]{1,4}\d{3,}[A-Z0-9-]*)/i.exec(policyLine.text) : undefined;
  const policyNumber = policyMatch && policyLine ? at(policyMatch[1] ?? policyMatch[2], policyLine, policyMatch[1] ?? policyMatch[2], 0.85) : undefined;
  // Parties.
  const brokerHeader = head.findIndex((line) => /agent or broker/i.test(line.text));
  let broker: FieldValue<string> | undefined;
  const brokerLabel = labelled(head, /broker|agent or broker/i) ?? inlineLabelled(head, /broker|agent or broker/i);
  const brokerName = head.find((line) => /\b(?:insurance (?:brokers?|group|services|agencies)|brokers? ltd)\b/i.test(line.text));
  if (brokerName) {
    const parts = brokerName.text.split("\t").map((part) => part.trim());
    const name = parts.find((part) => /insurance (?:brokers?|group|services|agencies)|brokers? ltd/i.test(part)) ?? brokerName.text;
    const brokerText = clean(/((?:[A-Z&][\w&.'’-]*\s+){0,6}(?:INSURANCE\s+(?:BROKERS?|GROUP|SERVICES|AGENCIES)|BROKERS?)(?:\s+(?:LTD|LIMITED|INC)\.?)?)/i.exec(name)?.[1] ?? name);
    // A bare "Broker" / "Agent or Broker" heading cell is a label, not a broker.
    if (!/^(?:agent\s+or\s+)?(?:insurance\s+)?brokers?$/i.test(brokerText)) broker = at(brokerText, brokerName, undefined, 0.75);
  } else if (brokerLabel && brokerLabel.value.length < 80) broker = at(clean(brokerLabel.value), brokerLabel.line, brokerLabel.value, 0.7);
  void brokerHeader;
  const subscribing = head.findIndex((line) => /subscribing compan|the insurers/i.test(line.text));
  const insurerLine = (subscribing >= 0 ? lines.slice(lines.indexOf(head[subscribing]) + 1, lines.indexOf(head[subscribing]) + 6).find((line) => /\b(?:insurance|assurance|indemnity|mutual)\b/i.test(line.text) && !/insured|coverage/i.test(line.text) && line.text.trim().length > 8) : undefined)
    ?? head.find((line) => /^\s*(?:insurer|insurance company|underwriter)\s*:/i.test(line.text))
    ?? head.find((line) => /insurance manager\s*:/i.test(line.text));
  const insurerFromLine = insurerLine ? clean(insurerLine.text.replace(/^\s*(?:insurer|insurance company|underwriter|insurance manager)\s*:\s*/i, "").split(/,\s*\d|\t|\s+(?:broker|agent(?: or broker)?|named insured|policy (?:number|no\.?))\s*:/i)[0]) : undefined;
  const insurerNext = insurerLine && !/\b(?:company|co\.|ltd|limited|inc)\s*$/i.test(insurerLine.text) && /(?:insurance|assurance)\s*$/i.test(insurerLine.text) && /^\s*(?:company|co\.|corporation|limited|ltd)\b/i.test(lines[lines.indexOf(insurerLine) + 1]?.text ?? "") ? lines[lines.indexOf(insurerLine) + 1] : undefined;
  const coiInsurer = isCertificate ? head.map((line) => ({ line, match: /((?:[A-Z][\w&.']*\s?){1,3}),\s*Policy\s*#/.exec(line.text) })).find((hit) => hit.match) : undefined;
  const insurer: FieldValue<string> = insurerLine && insurerFromLine
    ? at(insurerNext ? `${insurerFromLine} ${clean(insurerNext.text)}` : insurerFromLine, insurerLine, undefined, /insurance manager/i.test(insurerLine.text) ? 0.6 : 0.8, /insurance manager/i.test(insurerLine.text) ? "Managing general agent named; the subscribing insurer is listed separately." : undefined)
    : coiInsurer ? at(clean(coiInsurer.match![1].replace(/^(?:(?:Commercial|General|Liability|Errors|Omissions|&|Coverage|Directors|Officers|Automobile|Property|Cyber)\s+)+/, "")), coiInsurer.line, coiInsurer.match![1], 0.7) : notStated("No insurer named.");
  const insuredLabel = head.find((line) => /named insured/i.test(line.text));
  const insuredNext = insuredLabel ? lines.slice(lines.indexOf(insuredLabel) + 1, lines.indexOf(insuredLabel) + 3).find((line) => /\b(?:society|roundtable|association|inc|ltd|foundation)\b/i.test(line.text)) : head.find((line) => /\bcontractor name\b/i.test(line.text)) ? lines[lines.indexOf(head.find((line) => /\bcontractor name\b/i.test(line.text))!) + 1] : undefined;
  const insured = insuredNext ? at(clean(insuredNext.text.split("\t")[0]), insuredNext, insuredNext.text.split("\t")[0].trim(), 0.75) : undefined;
  // Term.
  const term = termIn(head);
  const termStart = term.start && term.line ? at(term.start, term.line, term.startText, 0.85) : undefined;
  const termEnd = term.end && term.line ? at(term.end, term.line, term.endText, 0.85) : undefined;
  // Premium, fees, total.
  const premiumLine = head.find((line) => /premium total|total premium/i.test(line.text) && moneyText(line.text)) ?? head.find((line) => /\bpremium\b/i.test(line.text) && moneyText(line.text.slice(line.text.search(/premium/i))));
  const premiumMoney = premiumLine ? moneyText(premiumLine.text.slice(premiumLine.text.search(/premium/i))) : undefined;
  const feeLine = head.find((line) => /policy fee\s*:?\s*\$?\s*\d/i.test(line.text));
  const feeMatch = feeLine ? /policy fee\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(feeLine.text) : undefined;
  const totalLine = head.find((line) => /total due\s*:?\s*\$/i.test(line.text));
  const totalMoney = totalLine ? moneyText(totalLine.text.slice(totalLine.text.search(/total due/i))) : undefined;
  // Coverages.
  const coverages: any[] = [];
  const kinds = new Set<string>();
  for (const line of head) {
    for (const [re, kind] of KIND_RULES) if (re.test(line.text)) kinds.add(kind);
    const aggregate = /(?:maximum aggregate|aggregate limit of|each claim limit|limit of liability)[^$]*?(\$\s?\d[\d, ]*)/i.exec(line.text);
    if (aggregate) {
      const money = moneyText(aggregate[1]);
      const label = clean(aggregate[0].replace(aggregate[1], "")).replace(/\(item \d+\)/i, "").trim();
      if (money) coverages.push({ type: at(label, line, aggregate[0].replace(aggregate[1], "").trim(), 0.8), limit: at({ amountCents: money.cents, currency: "CAD", text: money.text }, line, money.text, 0.85) });
      continue;
    }
    if (isCertificate) {
      const row = /^(Commercial General|Errors & Omissions|Directors (?:&|and) Officers|Automobile|Property|Cyber)[^$]*?(\$\s?\d[\d ,]*\d)/i.exec(line.text);
      if (row) {
        const money = moneyText(row[2]);
        if (money) coverages.push({ type: at(row[1], line, row[1], 0.8), limit: at({ amountCents: money.cents, currency: "CAD", text: money.text }, line, money.text, 0.8) });
      }
      continue;
    }
    const match = COVERAGE_LINE.exec(line.text.trim());
    if (!match || /premium|total|fee|due|tax|deductible$/i.test(match[1]) || /^(?:limit|basic coverage|coverage|additional coverage)$/i.test(match[1].trim()) || match[1].trim().split(/\s+/).length > 8 || /\b(?:we|we’ve|we've|this|you|your|our)\b/i.test(match[1])) continue;
    const limit = /^\$/.test(match[2]) ? moneyText(match[2]) : undefined;
    const deductible = match[3] && /^\$/.test(match[3]) ? moneyText(match[3]) : undefined;
    if (!limit && !/included/i.test(match[2])) continue;
    coverages.push({
      type: at(clean(match[1]), line, match[1].trim(), 0.75),
      ...(limit ? { limit: at({ amountCents: limit.cents, currency: "CAD", text: limit.text }, line, limit.text, 0.8) } : {}),
      ...(deductible ? { deductible: at({ amountCents: deductible.cents, currency: "CAD", text: deductible.text }, line, deductible.text, 0.75) } : match[3] && /nil/i.test(match[3]) ? { deductible: at({ amountCents: 0, currency: "CAD", text: match[3] }, line, match[3], 0.7) } : {}),
    });
    if (coverages.length > 40) break;
  }
  const kind = kinds.has("directors_officers") ? "directors_officers" : kinds.has("errors_omissions") ? "errors_omissions" : kinds.has("general_liability") ? "general_liability" : kinds.has("property") ? "property" : kinds.has("cyber") ? "cyber" : "other";
  const kindLine = head.find((line) => KIND_RULES.some(([re]) => re.test(line.text)));
  // Explicit reviewed status: never Active by default.
  const asOf = input.asOfISO ?? new Date().toISOString().slice(0, 10);
  const lapsed = term.end ? term.end.iso < asOf : false;
  const proposedStatus = termEnd && lapsed ? at("Lapsed" as const, term.line!, term.endText, 0.8, `Term ended ${term.end!.iso}; recorded as Lapsed history, not Active.`) : inferred("NeedsReview" as const, termEnd ? termEnd.locators : [fileLoc(fileName)], 0.7, "Current or unknown term: a reviewer confirms before it becomes Active.");
  // Additional insureds: the named party only ("… extended to cover <party> as an additional insured",
  // "Additional Insured: <party>"); headings and boilerplate about additional insureds are not parties.
  const additional = head.flatMap((line) => {
    const text = clean(line.text);
    const named = /(?:cover|include|includes|add|added|name|named)\s+(.{3,120}?)\s+as\s+(?:an?\s+)?additional\s+insured/i.exec(text) ?? /^\s*additional\s+insureds?\s*(?:\(s\))?\s*[:\-–]\s*(.{3,120})$/i.exec(text);
    const party = named?.[1]?.replace(/^(?:the\s+)?/i, "").trim();
    if (!party || /\b(?:policy|insured\(s\)|hereby|limits?|contract|agreement)\b/i.test(party)) return [];
    return [at(party, line, party, 0.75)];
  });
  if (isCertificate) {
    const agreement = /AGREEMENT IDENTIFICATION NO\.?[\s\S]{0,120}?\b([A-Z]{2}\d{2}[A-Z]{3}\d{4})\b/.exec(text);
    if (agreement) {
      const line = head.find((candidate) => candidate.text.includes(agreement[1]))!;
      references.push({ kind: "agreement", text: `Certificate issued for agreement ${agreement[1]}`, locators: [loc(line, agreement[1])] });
    }
  }
  const claimsMade = head.find((line) => /claims made basis/i.test(line.text));
  if (claimsMade) unsupported.push({ description: "Claims-made basis stated on the declarations page.", locators: [loc(claimsMade, /claims made basis[^)]*/i.exec(claimsMade.text)![0])], suggestedTarget: "insurancePolicies.claimsMadeTerms", category: "lossy_normalization", infoType: "insurance.claims_made" });
  const retro = head.find((line) => /prior and pending litigation date|retroactive date/i.test(line.text) && findDates(line.text)[0]);
  if (retro) unsupported.push({ description: `Prior/pending litigation (continuity) date ${findDates(retro.text)[0].iso}.`, locators: [loc(retro)], suggestedTarget: "insurancePolicies.claimsMadeTerms.continuityDate", category: "lossy_normalization", infoType: "insurance.continuity_date" });
  if (!termEnd) warnings.push("No policy period found.");
  const record = {
    insurer,
    ...(broker ? { broker } : {}),
    ...(policyNumber ? { policyNumber } : {}),
    ...(termStart ? { termStart } : {}),
    ...(termEnd ? { termEnd } : {}),
    coverages,
    ...(premiumMoney && premiumLine ? { premium: at({ amountCents: premiumMoney.cents, currency: "CAD", text: premiumMoney.text }, premiumLine, premiumMoney.text, 0.85) } : {}),
    ...(feeMatch && feeLine ? { fees: at({ amountCents: Math.round(Number(feeMatch[1].replace(/,/g, "")) * 100), currency: "CAD", text: feeMatch[1] }, feeLine, feeMatch[1], 0.8) } : {}),
    kind: kindLine ? at(kind, kindLine, undefined, 0.8) : inferred(kind, [fileLoc(fileName)], 0.4),
    documentType: inferred(documentType, [fileLoc(fileName)], 0.7),
    ...(insured ? { insured } : {}),
    ...(additional.length ? { additionalInsureds: additional } : {}),
    ...(totalMoney && totalLine ? { totalCost: at({ amountCents: totalMoney.cents, currency: "CAD", text: totalMoney.text }, totalLine, totalMoney.text, 0.85) } : {}),
    proposedStatus,
  };
  void guessAt; void fromFile;
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_INSURANCE_ENGINE, record, unsupported, references, warnings };
}
