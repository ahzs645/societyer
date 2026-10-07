/** Registry of per-class record schemas + JSON Schema export for offline agents. */
import { z } from "zod";
import { AgendaRecord, AgmMaterialRecord, AgreementRecord, ClassificationRecord, CorrespondenceRecord, FinancialStatementRecord, InsuranceRecord, InvoiceRecord, PolicyRecord, RegistryFilingRecord, RosterRecord } from "./classes";
import { ExtractionEnvelope, INTAKE_SCHEMA_VERSION, type DocClass } from "./common";
import { MeetingMinutesRecord } from "./meetingMinutes";

export * from "./common";
export * from "./meetingMinutes";
export * from "./classes";

export const RECORD_SCHEMAS: Partial<Record<DocClass, z.ZodTypeAny>> = {
  meetingMinutes: MeetingMinutesRecord,
  agenda: AgendaRecord,
  meetingPackage: AgendaRecord,
  agmMaterial: AgmMaterialRecord,
  policy: PolicyRecord,
  bylaws: PolicyRecord,
  directorConsent: RosterRecord,
  proxy: RosterRecord,
  roster: RosterRecord,
  financialStatement: FinancialStatementRecord,
  budget: FinancialStatementRecord,
  insurance: InsuranceRecord,
  agreement: AgreementRecord,
  grant: AgreementRecord,
  registryFiling: RegistryFilingRecord,
  correspondence: CorrespondenceRecord,
  invoice: InvoiceRecord,
};

export function schemaVersionFor(docClass: DocClass): string {
  return `${docClass}/1+${INTAKE_SCHEMA_VERSION}`;
}

export function recordSchemaFor(docClass: DocClass): z.ZodTypeAny | undefined {
  return RECORD_SCHEMAS[docClass];
}

/** Validates an extraction envelope and its class record; returns readable issues. */
export function validateExtraction(value: unknown): { ok: boolean; issues: string[] } {
  const envelope = ExtractionEnvelope.safeParse(value);
  if (!envelope.success) return { ok: false, issues: envelope.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  const schema = recordSchemaFor(envelope.data.docClass);
  if (!schema) return { ok: true, issues: [] };
  const record = schema.safeParse(envelope.data.record);
  return record.success ? { ok: true, issues: [] } : { ok: false, issues: record.error.issues.map((issue) => `record.${issue.path.join(".")}: ${issue.message}`) };
}

/** JSON Schema documents for offline agents (scripts/intake-run.ts --export-schemas). */
export function exportIntakeJsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    envelope: z.toJSONSchema(ExtractionEnvelope, { unrepresentable: "any" }),
    classification: z.toJSONSchema(ClassificationRecord, { unrepresentable: "any" }),
  };
  for (const [docClass, schema] of Object.entries(RECORD_SCHEMAS)) out[docClass] = z.toJSONSchema(schema!, { unrepresentable: "any" });
  return out;
}
