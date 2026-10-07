/** Correspondence (.msg / .eml e-mails, letters, memos): evidence-only by
 * default. Headers (from, to, cc, date, subject), attachment names, and the
 * governance decisions or commitments stated in the body. Bodies are never
 * copied into shared views; personal contact data is flagged, not extracted. */
import { looksLikePersonName } from "../names";
import { findDates } from "../parse";
import { detectPii, redact } from "../privacy";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, labelled, linesOf, loc, type Line } from "./toolkit";

export const DETERMINISTIC_CORRESPONDENCE_ENGINE = "deterministic-correspondence/1";

/** Display names only: "Kenna Jonkman <kjonkman@…>" → "Kenna Jonkman"; Exchange paths dropped. */
export function displayName(value: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*</.exec(value);
  if (named) return clean(named[1]);
  return clean(value.replace(/<[^>]*>/g, "").replace(/\S+@\S+/g, "").trim()) || "(address withheld)";
}

const DECISION = /\b(?:(?:has|have|was|were) (?:been )?(?:approved|appointed|decided|agreed|accepted|elected|ratified|confirmed|resolved)|will be (?:replacing|stepping down|resigning|appointed|representing)|is replacing|replacing me|resign(?:s|ed|ing)?\b(?: from)?|step(?:ping|s|ped)? down|agreed to|decided to|motion (?:was )?(?:carried|passed)|resolved (?:to|that)|approve[sd]? (?:the|a|our)|we will|I will|please (?:approve|sign|confirm|file)|i accept|accepted the)\b/i;

/** A value with account / card / SIN / e-mail / phone numbers masked, and a quote that stops before
 * the first of them (quotes must stay verbatim, so the sensitive part is left out of the quote). */
function withoutPii(line: Line, value: string, quote = value): { value: string; quote: string } {
  const findings = detectPii(value);
  if (!findings.length) return { value, quote };
  const masked = redact(value).text;
  const quoteFindings = detectPii(quote);
  const cut = quoteFindings.length ? quote.slice(0, Math.min(...quoteFindings.map((finding) => finding.index))).replace(/[\s,;:–-]+$/, "") : quote;
  return { value: masked, quote: cut.length >= 4 && line.text.includes(cut) ? cut : line.text.split(":")[0] };
}

export function extractCorrespondence(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract, { includeParts: true });
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const headerLine = (name: string) => lines.find((line) => line.kind === "email_header" && line.style === name) ?? lines.find((line) => line.kind === "email_header" && new RegExp(`^${name}:`, "i").test(line.text));
  const isEmail = lines.some((line) => line.kind === "email_header") || /\.(?:msg|eml)$/i.test(fileName);
  let from: FieldValue<string> | undefined, subject: FieldValue<string> | undefined, date: FieldValue<any> | undefined;
  const to: Array<FieldValue<string>> = [], cc: Array<FieldValue<string>> = [];
  if (isEmail) {
    const fromLine = headerLine("From");
    // Quotes cite the display name only, never the address beside it.
    const nameQuote = (line: Line, name: string) => (line.text.includes(name) ? name : line.text.split(":")[0]);
    if (fromLine) {
      const name = displayName(fromLine.text.replace(/^from:\s*/i, ""));
      from = at(name, fromLine, nameQuote(fromLine, name), 0.9);
    }
    for (const [name, list] of [["To", to], ["Cc", cc]] as const) {
      const line = headerLine(name);
      if (!line) continue;
      for (const part of line.text.replace(new RegExp(`^${name}:\\s*`, "i"), "").split(/;\s*/)) {
        if (!part.trim()) continue;
        const display = displayName(part);
        list.push(at(display, line, nameQuote(line, display), 0.85));
      }
    }
    const subjectLine = headerLine("Subject");
    if (subjectLine) {
      const safe = withoutPii(subjectLine, clean(subjectLine.text.replace(/^subject:\s*/i, "")));
      subject = at(safe.value, subjectLine, safe.quote, 0.9);
    }
    const dateLine = headerLine("Date");
    if (dateLine) {
      const raw = dateLine.text.replace(/^date:\s*/i, "");
      const parsed = Date.parse(raw);
      const found = findDates(raw)[0];
      if (found) date = at(dateValue(found), dateLine, found.text, 0.9);
      else if (Number.isFinite(parsed)) date = at({ iso: new Date(parsed).toISOString().slice(0, 10), precision: "day", text: raw.trim() }, dateLine, undefined, 0.85, "Parsed from the RFC 2822 Date header (UTC).");
    }
  } else {
    // Letters / memos: date line near the top, "Re:"/"Subject:", "Dear …", the sign-off.
    const head = lines.slice(0, 15);
    const dateHit = head.map((line) => ({ line, date: findDates(line.text)[0] })).find((hit) => hit.date && hit.line.text.trim().length < 60);
    if (dateHit) date = at(dateValue(dateHit.date!), dateHit.line, dateHit.date!.text, 0.8);
    const re = labelled(head, /re|subject/i);
    if (re) {
      const safe = withoutPii(re.line, clean(re.value), re.value);
      subject = at(safe.value, re.line, safe.quote, 0.85);
    }
    const attn = labelled(head, /attn|attention|to/i);
    if (attn && looksLikePersonName(clean(attn.value))) to.push(at(clean(attn.value), attn.line, attn.value, 0.75));
    const dear = head.find((line) => /^\s*dear\s+/i.test(line.text));
    if (dear && !to.length) to.push(at(clean(dear.text.replace(/^\s*dear\s+/i, "").replace(/[,:]\s*$/, "")), dear, undefined, 0.6));
    const signoff = lines.findIndex((line) => /^\s*(?:sincerely|regards|best regards|yours (?:truly|sincerely)|thank you|thanks)\s*,?\s*$/i.test(line.text));
    const signer = signoff >= 0 ? lines.slice(signoff + 1, signoff + 4).find((line) => looksLikePersonName(clean(line.text.split(",")[0])) || /\b(?:society|roundtable|council)\b/i.test(line.text)) : undefined;
    // "Robin Vale, Chair": the name (the title stays in the source).
    const signerName = signer && looksLikePersonName(clean(signer.text.split(",")[0])) ? clean(signer.text.split(",")[0]) : signer ? clean(signer.text) : undefined;
    if (signer && signerName) from = at(signerName, signer, signer.text.includes(signerName) ? signerName : undefined, 0.7);
  }
  // Decisions and commitments in the body (sentence quotes; never the whole body).
  const decisions: Array<FieldValue<string>> = [];
  for (const line of lines) {
    if (line.kind === "email_header" || line.text.length < 15) continue;
    if (/^\s*(?:from|sent|to|subject|cc)\s*:/i.test(line.text)) continue;
    for (const sentence of line.text.split(/(?<=[.!?])\s+/)) {
      if (sentence.length < 15 || sentence.length > 400 || !DECISION.test(sentence)) continue;
      if (/unsubscribe|do not click|confidential|legal advice|survey/i.test(sentence)) continue;
      const safe = withoutPii(line, clean(sentence), sentence.trim());
      decisions.push(at(safe.value, line, safe.quote, 0.6, "Stated in correspondence: evidence for review, not a recorded decision."));
      if (decisions.length >= 12) break;
    }
  }
  const attachments = (extract.attachments ?? []).filter((attachment) => !/^image\d+\.(?:png|jpg|gif)$/i.test(attachment.name)).map((attachment) => fromFile(attachment.name, attachment.name, 0.9, "Attachment name."));
  // Attachments named in the text ("Attachment: Revised workplan.docx", "Enclosures: …").
  for (const line of lines) {
    const named = /^\s*(?:attachments?|attached|enclosures?|encl\.?)\s*:\s*(.+)$/i.exec(line.text);
    if (!named) continue;
    for (const part of named[1].split(/\s*;\s*|\s*,\s*(?=[A-Z])/)) {
      const name = part.trim();
      if (name.length >= 3 && name.length <= 160 && !attachments.some((attachment) => attachment.value === name)) attachments.push(at(name, line, name, 0.8, "Attachment named in the message."));
    }
  }
  const pii = detectPii(extract.text.slice(0, 100000));
  const personal = pii.some((finding) => ["email", "phone", "postal_code", "sin", "account", "card"].includes(finding.kind));
  if (personal) unsupported.push({ description: "Personal contact details in the message (e-mail addresses, phone numbers or addresses) are withheld; keep them in personContactPoints only after review.", locators: [fileLoc(fileName)], suggestedTarget: "personContactPoints", category: "no_ui_edit", infoType: "person.contact_restricted" });
  for (const line of lines) {
    const agreement = /\b(?:agreement|contract)\s*#?\s*([A-Z]{2}\d{2}[A-Z]{3}\d{4})\b/.exec(line.text);
    if (agreement) references.push({ kind: "agreement", text: agreement[0], locators: [loc(line, agreement[0])] });
    if (/\b(?:minutes|agm|annual general meeting|board meeting)\b/i.test(line.text) && findDates(line.text)[0] && line.text.length < 400) references.push({ kind: "meeting", text: clean(line.text).slice(0, 200), date: findDates(line.text)[0].iso, locators: [loc(line)] });
    if (references.length > 20) break;
  }
  const subjectText = subject?.value ?? "";
  const record = {
    ...(from ? { from } : {}),
    to,
    ...(date ? { date } : {}),
    ...(subject ? { subject } : {}),
    ...(subject ? { summary: inferred(`${isEmail ? "E-mail" : "Letter"}${from?.value ? ` from ${from.value}` : ""}: ${subjectText}`.slice(0, 300), subject.locators, 0.6, "Header summary only; the body stays in the restricted original.") } : {}),
    decisionsOrCommitments: decisions,
    attachments,
    kind: inferred(isEmail ? "email" as const : /\bmemo\b/i.test(`${fileName} ${lines.slice(0, 5).map((line) => line.text).join(" ")}`) ? "memo" as const : "letter" as const, [fileLoc(fileName)], 0.8),
    ...(cc.length ? { cc } : {}),
    personalDataWithheld: personal,
  };
  void notStated; void guessAt;
  if (!date) warnings.push("No date found.");
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_CORRESPONDENCE_ENGINE, record, unsupported, references, warnings };
}
