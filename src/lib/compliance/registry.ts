import cbcaCompliancePackJson from "./rulePacks/ca-fed-cbca.json";
import bcSocietiesCompliancePackJson from "./rulePacks/ca-bc.json";
import bcExtraProvincialCompanyCompliancePackJson from "./rulePacks/ca-bc-extra-provincial-company.json";
import obcaCompliancePackJson from "./rulePacks/ca-on-obca.json";
import { complianceRulePackSchema, complianceRulePacksSchema, type ComplianceRulePack } from "./rulePackSchema";

export const COMPLIANCE_RULE_PACK_JSON = [
  bcSocietiesCompliancePackJson,
  bcExtraProvincialCompanyCompliancePackJson,
  cbcaCompliancePackJson,
  obcaCompliancePackJson,
] as const;

export function loadComplianceRulePacks(): ComplianceRulePack[] {
  return complianceRulePacksSchema.parse(
    COMPLIANCE_RULE_PACK_JSON.map((pack) => complianceRulePackSchema.parse(pack)),
  );
}

export function findComplianceRulePack(packId: string): ComplianceRulePack | undefined {
  return loadComplianceRulePacks().find((pack) => pack.packId === packId);
}
