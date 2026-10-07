/** Registry filing extractor: annual report confirmations (PDF or the .msg
 * confirmation e-mail), statements of directors, change notices and receipts.
 * Directors' delivery addresses are never extracted (restricted). */
import { findDates } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, labelled, linesOf, loc, type Line } from "./toolkit";
import { parseAmount } from "./toolkit";

export const DETERMINISTIC_FILING_ENGINE = "deterministic-filing/1";

type FilingType = "annual_report" | "statement_of_directors" | "transition" | "change_of_address" | "bylaw_amendment" | "other" | "change_of_directors";
const TYPES: Array<[RegExp, FilingType]> = [
  [/\bannual report\b/i, "annual_report"],
  [/change of directors|notice of change of directors/i, "change_of_directors"],
  [/statement of directors/i, "statement_of_directors"],
  [/transition application|\btransition\b.*societies act/i, "transition"],
  [/change of (?:registered )?(?:office )?address|notice of change of address/i, "change_of_address"],
  [/alteration|bylaw amendment|amend(?:ed|ment) (?:of )?bylaws|constitution alteration/i, "bylaw_amendment"],
];

function titleCaseName(raw: string): string {
  const [last, first] = raw.split(/\s*,\s*/);
  const cap = (value: string) => value.toLowerCase().replace(/\b([a-z])/g, (char) => char.toUpperCase());
  return first ? `${cap(first)} ${cap(last)}` : cap(raw);
}

export function extractRegistryFiling(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract, { includeParts: true });
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const formFiled = labelled(lines, /form filed/i);
  const typeSource = formFiled ? { line: formFiled.line, text: formFiled.value } : (() => {
    const line = lines.slice(0, 30).find((candidate) => TYPES.some(([re]) => re.test(candidate.text)));
    return line ? { line, text: line.text } : undefined;
  })();
  const typeHit = typeSource ? TYPES.find(([re]) => re.test(typeSource.text)) : TYPES.find(([re]) => re.test(fileName));
  const filingType: FieldValue<FilingType> = typeSource && typeHit ? at(typeHit[1], typeSource.line, typeHit[0].exec(typeSource.text)?.[0], 0.85)
    : typeHit ? fromFile(typeHit[1], fileName, 0.6) : inferred("other" as FilingType, [fileLoc(fileName)], 0.4);
  const filedLabel = labelled(lines, /filed date and time|date and time of filing|filing date and time|date filed|filed on|filing date/i);
  const filedDate = filedLabel ? findDates(filedLabel.value)[0] : undefined;
  const periodLine = lines.slice(0, 40).find((line) => /\b((?:19|20)\d{2})\s+BC Society Annual Report\b|annual report for\s+((?:19|20)\d{2})/i.test(line.text));
  const periodMatch = periodLine ? /\b((?:19|20)\d{2})\s+BC Society Annual Report\b|annual report for\s+((?:19|20)\d{2})/i.exec(periodLine.text) : undefined;
  const incorporation = lines.find((line) => /incorporation number\s*:?\s*S-?\d{5,8}/i.test(line.text));
  const incorporationMatch = incorporation ? /S-?\d{5,8}/.exec(incorporation.text.slice(incorporation.text.search(/incorporation number/i))) : undefined;
  const agmLabel = labelled(lines, /annual general meeting \(agm\) date|agm date|date of (?:the )?(?:last )?(?:annual general meeting|agm)/i);
  const agmDate = agmLabel ? findDates(agmLabel.value)[0] : undefined;
  const feeLine = lines.find((line) => /^\s*(?:fee|filing fee|total(?: paid)?)\s*:\s*\$/i.test(line.text));
  const fee = feeLine ? parseAmount(/\$\s?[\d,]+(?:\.\d{2})?/.exec(feeLine.text)?.[0] ?? "") : undefined;
  const confirmation = labelled(lines, /confirmation (?:number|no\.?)|transaction id|payment invoice number|filing id|reference number/i);
  // Directors listed: "Last Name, First Name Middle Name:" followed by "CLAUS, DAVID H".
  const directors: Array<FieldValue<{ nameAsWritten: string; resolvedName?: string }>> = [];
  lines.forEach((line, index) => {
    if (!/last name,\s*first name/i.test(line.text)) return;
    const next = lines[index + 1];
    if (next && /^[A-Z'’-]+(?: [A-Z'’-]+)*,\s*[A-Z][A-Z'’ .-]+$/.test(next.text.trim())) directors.push(at({ nameAsWritten: next.text.trim(), resolvedName: titleCaseName(next.text.trim()) }, next, undefined, 0.85));
  });
  const confirmed = /confirmation of filing|\breceipt\b|certified copy|filed date and time|date and time of filing|filing date and time/i.test(extract.text.slice(0, 4000));
  const filingStatus = confirmed && filedDate ? at("filed" as const, filedLabel!.line, filedDate.text, 0.85, "Registry confirmation, receipt or certified copy with a filing date.") : filedDate ? guessAt("filed" as const, filedLabel!.line, filedDate.text, 0.6) : inferred("draft" as const, [fileLoc(fileName)], 0.4, "No filing date: a draft or unfiled form.");
  if (lines.some((line) => /delivery address/i.test(line.text))) unsupported.push({ description: "Directors' and registered office delivery addresses (restricted; kept in the original).", locators: [loc(lines.find((line) => /delivery address/i.test(line.text))!, "Delivery Address")], suggestedTarget: "organizationAddresses / directors.residentialAddress", category: "no_ui_edit", infoType: "person.address_restricted" });
  const packageLine = lines.find((line) => /this package contains/i.test(line.text));
  if (packageLine) {
    const next = lines[lines.indexOf(packageLine) + 1];
    if (next) references.push({ kind: "filing", text: clean(next.text).slice(0, 200), locators: [loc(next)] });
  }
  if (agmDate) references.push({ kind: "meeting", text: `AGM of ${agmDate.text} reported in the filing`, date: agmDate.iso, body: "agm", locators: [loc(agmLabel!.line, agmDate.text)] });
  const org = labelled(lines, /name of society|society name/i);
  const record = {
    filingType,
    ...(periodMatch && periodLine ? { period: at(periodMatch[1] ?? periodMatch[2], periodLine, periodMatch[1] ?? periodMatch[2], 0.85) } : agmDate && filingType.value === "annual_report" ? { period: inferred(agmDate.iso.slice(0, 4), [loc(agmLabel!.line, agmDate.text)], 0.6, "Year of the AGM reported.") } : {}),
    ...(filedDate && filedLabel ? { filedDate: at(dateValue(filedDate), filedLabel.line, filedDate.text, 0.9) } : {}),
    ...(confirmation && confirmation.value.length < 60 ? { confirmationNumber: at(clean(confirmation.value.split(/\s{2,}|\t/)[0]), confirmation.line, confirmation.value.split(/\s{2,}|\t/)[0], 0.75) } : {}),
    directorsListed: directors,
    ...(org ? { organizationName: at(clean(org.value.split(/\t/)[0]), org.line, org.value.split(/\t/)[0], 0.7) } : {}),
    ...(incorporationMatch && incorporation ? { incorporationNumber: at(incorporationMatch[0], incorporation, incorporationMatch[0], 0.9) } : {}),
    ...(agmDate && agmLabel ? { agmDate: at(dateValue(agmDate), agmLabel.line, agmDate.text, 0.9) } : {}),
    ...(fee && feeLine ? { feePaid: at({ amountCents: fee.cents, currency: "CAD", text: fee.text }, feeLine, fee.text, 0.85) } : {}),
    filingStatus,
  };
  if (!filedDate) warnings.push("No filing date found.");
  void notStated;
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_FILING_ENGINE, record, unsupported, references, warnings };
}
