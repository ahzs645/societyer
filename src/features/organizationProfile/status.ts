import type { ToneVariant } from "../../components/ui";
import { optionLabel } from "../../lib/orgHubOptions";
import { incorporationActForValue } from "../../../shared/incorporationActs";
import type { OrganizationRecord } from "./types";

/** The one status the profile shows, from the formation status and the workspace status. */
export function profileStatus(org: Pick<OrganizationRecord, "formationStatus" | "organizationStatus">): { label: string; tone: ToneVariant } {
  if (org.organizationStatus === "archived") return { label: "Archived", tone: "neutral" };
  if (org.organizationStatus === "removed") return { label: "Removed", tone: "danger" };
  switch (org.formationStatus) {
    case "preparing": return { label: "Preparing incorporation", tone: "info" };
    case "submitted": return { label: "Filed, waiting for the certificate", tone: "info" };
    case "incorporated": return { label: "Incorporated", tone: "success" };
    case "unverified_existing": return { label: "Incorporated, certificate not verified", tone: "warn" };
    default: return org.organizationStatus === "active"
      ? { label: "Active", tone: "success" }
      : { label: "Status not verified", tone: "neutral" };
  }
}

/** The governing Act's short name ("CBCA"), or its full title. */
export function actShortName(org: Pick<OrganizationRecord, "actFormedUnder" | "jurisdictionCode">) {
  const act = incorporationActForValue(org.actFormedUnder, org.jurisdictionCode);
  return act ? act.abbreviation ?? act.officialName : org.actFormedUnder ? optionLabel("actsFormedUnder", org.actFormedUnder) : "";
}
