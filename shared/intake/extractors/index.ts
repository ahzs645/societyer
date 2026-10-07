/** Deterministic extractor dispatch for every document class (WP-L). Minutes
 * keep WP-D's engine; the other governance classes get their own extractor.
 * Report/plan/outreach/image classes are catalogued, not extracted. */
import { extractMeetingMinutes } from "../minutes/extractMinutes";
import type { DocClass, ExtractionEnvelope } from "../schemas/common";
import { extractAgenda, type ClassExtractorInput } from "./agenda";
import { extractAgmMaterial } from "./agm";
import { extractPolicy } from "./policy";
import { extractRoster } from "./roster";
import { extractFinancial } from "./financial";
import { extractInsurance } from "./insurance";
import { extractAgreement } from "./agreement";
import { extractRegistryFiling } from "./filing";
import { extractCorrespondence } from "./correspondence";
import { extractInvoice } from "./invoice";

export type { ClassExtractorInput };
export type ExtractorFn = (input: ClassExtractorInput) => ExtractionEnvelope;

const EXTRACTORS: Partial<Record<DocClass, ExtractorFn>> = {
  meetingMinutes: (input) => extractMeetingMinutes({ fileId: input.fileId, fileName: input.fileName, path: input.path, extract: input.extract }),
  agenda: extractAgenda,
  meetingPackage: extractAgenda,
  agmMaterial: extractAgmMaterial,
  bylaws: extractPolicy,
  policy: extractPolicy,
  directorConsent: extractRoster,
  proxy: extractRoster,
  roster: extractRoster,
  financialStatement: extractFinancial,
  budget: extractFinancial,
  insurance: extractInsurance,
  agreement: extractAgreement,
  grant: extractAgreement,
  registryFiling: extractRegistryFiling,
  correspondence: extractCorrespondence,
  invoice: extractInvoice,
};

/** Classes with a deterministic extractor. */
export const DETERMINISTIC_CLASSES: ReadonlySet<DocClass> = new Set(Object.keys(EXTRACTORS) as DocClass[]);

export function extractForClass(docClass: DocClass, input: Omit<ClassExtractorInput, "docClass">): ExtractionEnvelope | undefined {
  const extractor = EXTRACTORS[docClass];
  return extractor ? extractor({ ...input, docClass }) : undefined;
}
