/** Shared intake output contract (design §4.2): Locator, FieldValue and the
 * Extraction envelope. Every extracted value carries a status, a confidence
 * and at least one locator whose quote is re-verified against the source. */
import { z } from "zod";

export const INTAKE_SCHEMA_VERSION = "intake/1";

export const LOCATOR_KINDS = ["block", "page_text", "cell", "email_header", "filename", "path"] as const;
export const Locator = z.object({
  fileId: z.string().optional().describe("intakeFiles key, e.g. google-drive:<id>@<revision> or local:<sha256>"),
  kind: z.enum(LOCATOR_KINDS),
  blockIndex: z.number().int().min(0).optional(),
  page: z.number().int().min(1).optional(),
  sheet: z.string().optional(),
  cell: z.string().optional().describe("A1 reference for sheets (B12, A3:D9); R{row}C{col} for document tables"),
  charStart: z.number().int().min(0).optional(),
  charEnd: z.number().int().min(0).optional(),
  quote: z.string().max(400).optional().describe("Verbatim source span; re-verified deterministically"),
});
export type Locator = z.infer<typeof Locator>;

export const FIELD_STATUSES = ["stated", "inferred", "not_stated", "illegible", "conflicting"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/** FieldValue<T>: a value plus how we know it. */
export function fieldValue<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.optional(),
    status: z.enum(FIELD_STATUSES),
    confidence: z.number().min(0).max(1),
    locators: z.array(Locator),
    note: z.string().optional(),
    /** Set by span verification (stage 6), never by the extractor. */
    verification: z.enum(["verified_span", "verified_fuzzy", "span_mismatch", "no_quote", "invalid"]).optional(),
  });
}
export type FieldValue<T> = {
  value?: T;
  status: FieldStatus;
  confidence: number;
  locators: Locator[];
  note?: string;
  verification?: "verified_span" | "verified_fuzzy" | "span_mismatch" | "no_quote" | "invalid";
};

export const FvString = fieldValue(z.string());
export const FvNumber = fieldValue(z.number());
export const FvBoolean = fieldValue(z.boolean());
export const DatePrecision = z.enum(["day", "month", "year", "unknown"]);
export const FvDate = fieldValue(z.object({ iso: z.string().describe("YYYY, YYYY-MM or YYYY-MM-DD"), precision: DatePrecision, text: z.string().optional() }));
export const FvTime = fieldValue(z.string().regex(/^\d{2}:\d{2}$/).describe("Local wall-clock HH:MM"));
export const FvMoney = fieldValue(z.object({ amountCents: z.number().int(), currency: z.string().default("CAD"), text: z.string().optional() }));
export const FvPersonRef = fieldValue(z.object({
  nameAsWritten: z.string(),
  role: z.string().optional(),
  affiliation: z.string().optional(),
  /** Full name when a short reference ("T. Marsh", "Avery", "TB") resolves unambiguously within the document. */
  resolvedName: z.string().optional(),
  /** Resolved by entity resolution (stage 7) against the people directory. */
  personKey: z.string().optional(),
}));

export const UNSUPPORTED_CATEGORIES = ["no_field", "no_table", "no_relationship", "no_ui_edit", "lossy_normalization"] as const;
export const UnsupportedDetail = z.object({
  description: z.string(),
  locators: z.array(Locator),
  suggestedTarget: z.string().describe("e.g. motions.dissentingReport"),
  category: z.enum(UNSUPPORTED_CATEGORIES),
  infoType: z.string().optional().describe("Controlled representation-gap info type, e.g. motion.dissent"),
});
export type UnsupportedDetail = z.infer<typeof UnsupportedDetail>;

export const REFERENCE_KINDS = ["prior_minutes", "report", "attachment", "policy", "agreement", "filing", "person_role", "meeting"] as const;
export const Reference = z.object({
  kind: z.enum(REFERENCE_KINDS),
  text: z.string(),
  date: z.string().optional(),
  body: z.string().optional(),
  locators: z.array(Locator),
});
export type Reference = z.infer<typeof Reference>;

export const DOC_CLASSES = [
  "meetingMinutes", "agenda", "meetingPackage", "agmMaterial", "policy", "bylaws", "directorConsent", "proxy", "roster",
  "financialStatement", "budget", "insurance", "agreement", "grant", "registryFiling", "correspondence", "invoice",
  "report", "plan", "presentation", "outreach", "formTemplate", "image", "audioVideo", "archive", "unclassified",
] as const;
export type DocClass = (typeof DOC_CLASSES)[number];
export const DocClassSchema = z.enum(DOC_CLASSES);

export const RECORD_STATUSES = ["draft", "approved", "signed", "template", "script", "agenda", "recorded", "unknown"] as const;

export const ExtractionEnvelope = z.object({
  fileId: z.string(),
  docClass: DocClassSchema,
  schemaVersion: z.string(),
  engine: z.enum(["deterministic", "llm", "human"]),
  model: z.string().optional(),
  record: z.record(z.string(), z.any()),
  unsupported: z.array(UnsupportedDetail),
  references: z.array(Reference),
  warnings: z.array(z.string()).optional(),
});
export type ExtractionEnvelope = z.infer<typeof ExtractionEnvelope>;

/** Constructors used by deterministic extractors. */
export function stated<T>(value: T, locators: Locator[], confidence = 0.9, note?: string): FieldValue<T> {
  return { value, status: "stated", confidence, locators, ...(note ? { note } : {}) };
}
export function inferred<T>(value: T, locators: Locator[], confidence = 0.6, note?: string): FieldValue<T> {
  return { value, status: "inferred", confidence, locators, ...(note ? { note } : {}) };
}
export function notStated<T>(note?: string): FieldValue<T> {
  return { status: "not_stated", confidence: 1, locators: [], ...(note ? { note } : {}) };
}
export function isKnown<T>(field: FieldValue<T> | undefined): field is FieldValue<T> & { value: T } {
  return Boolean(field && field.value !== undefined && field.value !== null && (field.status === "stated" || field.status === "inferred"));
}
