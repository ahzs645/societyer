/**
 * Content-based classification of registry documents. File names are never
 * used: registry downloads arrive as "ColinReport (2).pdf" and the like.
 */
import { isEmailText, normalizeRegistryText, splitPages, type RegistryPage } from "./text";
import type { RegistryClassification, RegistryDocumentKind, RegistrySectionKind } from "./types";

type Rule = { kind: RegistrySectionKind; required: RegExp[]; signals: RegExp[] };

const PAGE_RULES: Rule[] = [
  { kind: "federal_certificate_of_incorporation", required: [/Certificate of Incorporation/i, /I HEREBY CERTIFY/i], signals: [/Corporation number/i, /Date of Incorporation/i, /Corporate name/i, /incorporated under the Canada/i] },
  { kind: "federal_articles_of_incorporation", required: [/Articles of Incorporation/i], signals: [/\bForm 1\b/, /Minimum and maximum number of directors/i, /Restrictions on share transfers/i, /classes and any maximum number of shares/i] },
  { kind: "federal_initial_office_and_directors", required: [/Members of the board of directors|First Board of Directors/i], signals: [/\bForm 2\b/, /Address of registered office/i, /Resident Canadian/i, /Initial Registered Office/i] },
  { kind: "federal_corporation_information_sheet", required: [/Corporation Information Sheet/i], signals: [/Corporation key/i, /Anniversary date/i, /Annual return filing period/i, /Corporation number/i] },
  { kind: "federal_initial_isc", required: [/individuals with significant control/i, /Received date/i], signals: [/21\.21/, /TYPE OF INTEREST OR CONTROL/i, /START DATE/i, /Canada Business Corporations Act/i] },
  { kind: "bc_statement_of_registration", required: [/Statement of Registration/i], signals: [/\bForm 33\b/, /FOREIGN JURISDICTION INFORMATION/i, /HEAD OFFICE/i, /Registration Number/i] },
  { kind: "bc_certificate_of_registration", required: [/CERTIFICATE\s+OF\s+REGISTRATION/i], signals: [/registered as an extraprovincial company/i, /Registrar of Companies/i, /Number:\s*A\d{7}/, /Province of British Columbia/i] },
  { kind: "bc_filing_receipt", required: [/\bRECEIPT\b/, /confirmation of payment/i], signals: [/Payment Invoice Number/i, /Transaction ID/i, /\bFee:/i, /Registration Number/i] },
  { kind: "bc_cover_sheet", required: [/Cover Sheet/i], signals: [/This package contains/i, /Confirmation of Service/i, /Form Filed/i, /Registration Number/i] },
];

const EMAIL_RULES: Rule[] = [
  { kind: "federal_incorporated_email", required: [/You'?re incorporated|business number with the Canada Revenue Agency/i], signals: [/\b\d{9}\s*RC\d{4}\b/, /Corporations Canada/i, /Congratulations/i] },
  { kind: "federal_incorporation_email", required: [/has just incorporated with Corporations Canada|Subject:\s*Incorporation\s*\/\s*Constitution/i], signals: [/We have included the following documents/i, /fdrlCrpDtls/i, /reminder emails/i] },
  { kind: "federal_payment_email", required: [/Transaction (?:Invoice|approved|record)/i], signals: [/Transaction amount/i, /Reference number/i, /Transaction Id/i, /Merchant:\s*\t?\s*Corporations/i] },
  { kind: "federal_access_updated_email", required: [/Access type updated|within the Online Filing Centre has been updated/i], signals: [/Access Manager/i, /Online Filing Centre/i] },
];

/** A page that continues the previous section (schedules to the articles, overflow pages). */
const SCHEDULE_PAGE = /^(?:Schedule\b|Other Provisions\s*\/|Restrictions on Share Transfers\s*\/)/im;

function score(rule: Rule, text: string): number {
  const flat = text.replace(/\s+/g, " ");
  if (!rule.required.every((pattern) => pattern.test(flat))) return 0;
  const hits = rule.signals.filter((pattern) => pattern.test(flat)).length;
  return Math.round((0.4 + (0.6 * hits) / rule.signals.length) * 100) / 100;
}

function best(rules: Rule[], text: string): { kind: RegistrySectionKind; confidence: number } | undefined {
  let winner: { kind: RegistrySectionKind; confidence: number } | undefined;
  for (const rule of rules) {
    const confidence = score(rule, text);
    if (confidence > 0 && (!winner || confidence > winner.confidence)) winner = { kind: rule.kind, confidence };
  }
  return winner;
}

export type ClassifiedSection = { kind: RegistrySectionKind; confidence: number; pages: RegistryPage[] };

/** Sections of an already normalized text, in page order. */
export function classifySections(normalized: string): ClassifiedSection[] {
  if (isEmailText(normalized)) {
    const winner = best(EMAIL_RULES, normalized);
    return winner ? [{ ...winner, pages: [{ number: 1, lines: normalized.split("\n"), text: normalized }] }] : [];
  }
  const sections: ClassifiedSection[] = [];
  for (const page of splitPages(normalized)) {
    const winner = best(PAGE_RULES, page.text);
    const previous = sections[sections.length - 1];
    if (winner) {
      if (previous?.kind === winner.kind) previous.pages.push(page);
      else sections.push({ ...winner, pages: [page] });
      continue;
    }
    // Schedules and overflow pages belong to the section before them.
    if (previous) previous.pages.push(page);
    else if (SCHEDULE_PAGE.test(page.text)) sections.push({ kind: "federal_articles_of_incorporation", confidence: 0.4, pages: [page] });
  }
  return sections;
}

/** The kind a whole file is known by: a package takes its lead section's kind. */
export function documentKindOf(sections: Array<{ kind: RegistrySectionKind; confidence: number }>): { kind: RegistryDocumentKind; confidence: number } {
  if (!sections.length) return { kind: "unknown", confidence: 0 };
  const lead = sections.find((section) => section.kind === "federal_certificate_of_incorporation")
    ?? sections.find((section) => section.kind === "bc_cover_sheet")
    ?? sections[0];
  return { kind: lead.kind, confidence: lead.confidence };
}

/**
 * Classify registry text by content. `fileName` is accepted for symmetry with
 * `parseRegistryDocument` but never decides the kind.
 */
export function classifyRegistryDocument(text: string, fileName?: string): RegistryClassification {
  void fileName;
  const sections = classifySections(normalizeRegistryText(text));
  const lead = documentKindOf(sections);
  return {
    ...lead,
    sections: sections.map((section) => ({ kind: section.kind, confidence: section.confidence, pages: section.pages.map((page) => page.number) })),
  };
}
