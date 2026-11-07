import { incorporationActForValue, incorporationJurisdictionForCode, type IncorporationEntityKind } from "../incorporationActs";
import type { LegalForm, OrganizationSource, WorkflowReason } from "./types";

const LEGAL_FORMS: Record<string, LegalForm> = {
  corporation__business_: "business_corporation", business_corporation: "business_corporation", corporation: "business_corporation",
  society: "society", society__bc_: "society",
  corporation__nfp_: "nonprofit_corporation", nonprofit_corporation: "nonprofit_corporation",
  not_for_profit_corporation: "nonprofit_corporation", non_profit_corporation: "nonprofit_corporation",
  cooperative: "cooperative", co_operative: "cooperative",
  sole_proprietorship: "sole_proprietorship", partnership: "partnership",
  unincorporated_association: "unincorporated_association", other: "other",
};
export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  business_corporation: "Business corporation", society: "Society (nonprofit)", nonprofit_corporation: "Nonprofit corporation",
  cooperative: "Cooperative", sole_proprietorship: "Sole proprietorship", partnership: "Partnership",
  unincorporated_association: "Unincorporated association", other: "Other legal form", unknown: "Legal form not established",
};
const ACT_ENTITY_KINDS: Partial<Record<LegalForm, IncorporationEntityKind>> = {
  business_corporation: "business_corporation", society: "society", nonprofit_corporation: "not_for_profit_corporation", cooperative: "cooperative",
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const formFor = (value: unknown): LegalForm => LEGAL_FORMS[text(value).toLowerCase().replace(/[ -]+/g, "_")] ?? "unknown";

/** Formation jurisdiction is independent of an Act-specific legacy code. */
export function normalizeFormationJurisdiction(value: unknown): string {
  const raw = text(value);
  return incorporationJurisdictionForCode(raw)?.code ?? (raw && raw.toLowerCase() !== "unknown" ? raw : "unknown");
}

/** No BC or business-Act default is applied to missing legacy identity fields. */
export function normalizeOrganizationIdentity(organization: OrganizationSource | null | undefined) {
  const source = organization ?? {};
  const issues: WorkflowReason[] = [];
  const entityValues = [source.entityType, source.kind, source.organizationKind].map(text).filter(Boolean);
  const legalForm = formFor(entityValues[0]);
  const declaredForms = [...new Set(entityValues.map(formFor).filter(value => value !== "unknown"))];
  const jurisdictionValues = [source.jurisdictionCode, source.homeJurisdictionCode, source.homeJurisdiction, source.jurisdiction].map(text).filter(Boolean);
  const jurisdictionCode = normalizeFormationJurisdiction(jurisdictionValues[0]);
  const declaredJurisdictions = [...new Set(jurisdictionValues.map(normalizeFormationJurisdiction))];
  const actValue = text(source.actFormedUnder) || undefined;
  const act = incorporationActForValue(actValue, jurisdictionCode);
  const place = incorporationJurisdictionForCode(jurisdictionCode);
  const conflict = (code: string, message: string, field: string) => issues.push({ code, message, field, nextAction: "/app/society" });

  if (declaredForms.length > 1) conflict("LEGAL_FORM_CONFLICT", "Recorded legal-form fields disagree. Review the formation documents before using form-specific actions.", "entityType");
  if (declaredJurisdictions.length > 1) conflict("JURISDICTION_CONFLICT", "Recorded home jurisdictions disagree. Keep operating locations in separate registrations.", "jurisdictionCode");
  if (act && jurisdictionCode !== "unknown" && (!place || place.id !== act.jurisdiction)) {
    conflict("ACT_JURISDICTION_CONFLICT", "The governing Act and formation jurisdiction describe different legal setups.", "actFormedUnder");
  }
  if (act && legalForm !== "unknown" && legalForm !== "other" && (!ACT_ENTITY_KINDS[legalForm] || !act.entityKinds.includes(ACT_ENTITY_KINDS[legalForm]!))) {
    conflict("ACT_LEGAL_FORM_CONFLICT", "The governing Act does not match the recorded legal form.", "actFormedUnder");
  }
  const hasConflict = issues.length > 0;
  if (legalForm === "unknown") issues.push({ code: "LEGAL_FORM_REQUIRED", message: "Confirm the legal form from the organization's records.", field: "entityType", nextAction: "/app/society" });
  if (jurisdictionCode === "unknown") issues.push({ code: "JURISDICTION_REQUIRED", message: "Record the formation jurisdiction before applying statutory guidance.", field: "jurisdictionCode", nextAction: "/app/society" });
  if (!actValue && ACT_ENTITY_KINDS[legalForm]) issues.push({ code: "GOVERNING_ACT_REQUIRED", message: "Record the governing Act before applying statutory guidance.", field: "actFormedUnder", nextAction: "/app/society" });

  return {
    status: hasConflict ? "conflict" as const : issues.length ? "incomplete" as const : "recorded" as const,
    legalForm,
    legalFormLabel: LEGAL_FORM_LABELS[legalForm],
    countryCode: /^([A-Z]{2})(?:-|$)/.exec(jurisdictionCode)?.[1],
    jurisdictionCode,
    jurisdictionLabel: place?.name ?? (jurisdictionCode === "unknown" ? "Not recorded" : jurisdictionCode),
    actValue,
    actLabel: act?.officialName ?? actValue ?? "Not recorded",
    issues,
  };
}
