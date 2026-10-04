import {
  incorporationPreparationForOrganization,
} from "./incorporationPreparation";
import { organizationLabel, type LegalEntityLike } from "./organizationDomain";

type PreparationGuide = NonNullable<ReturnType<typeof incorporationPreparationForOrganization>>;

/** An editable planning worksheet, never a registry application or legal instrument. */
export function incorporationWorksheetText(
  guide: PreparationGuide,
  organization: LegalEntityLike,
): string {
  return [
    "INCORPORATION PREPARATION WORKSHEET",
    guide.title,
    "",
    "Use this worksheet to collect information before completing the official registry process.",
    "This worksheet does not incorporate an entity, replace government forms, or supply articles, bylaws, or an incorporation agreement.",
    "Draft guidance uses existing repository sources. Verify current registry channels, fees, forms, and mail availability before filing.",
    "",
    `Workspace / proposed legal name: ${organizationLabel(organization)}`,
    `Home jurisdiction: ${guide.jurisdictionCode}`,
    `Legislation: ${guide.statute}`,
    "Prepared by: ____________________",
    "Prepared on: ____________________",
    "Registry-assigned number (complete after incorporation): ____________________",
    "",
    "PREPARE BEFORE FILING",
    ...guide.requirements.flatMap((requirement, index) => [
      "",
      `${index + 1}. ${requirement.title}`,
      requirement.detail,
      `Reference: ${requirement.sourceUrl}`,
      "Information / attached document: ____________________",
      "Outstanding decision: ____________________",
    ]),
    "",
    "OFFICIAL FILING",
    guide.filingChannel.summary,
    `Official online service: ${guide.filingChannel.onlineUrl}`,
    guide.filingChannel.mailSummary,
    "Filing date / confirmation: ____________________",
    "",
    "DOCUMENTS TO RETAIN",
    ...guide.retainedDocuments.map((document) => `- ${document}: ____________________`),
    "",
    "SOURCES",
    ...guide.sources.map((source) => `${source.label}: ${source.url}${source.evidenceDate ? ` (repository evidence dated ${source.evidenceDate})` : " (verify current instructions)"}`),
    "",
  ].join("\n");
}

export function incorporationWorksheetFileName(guide: PreparationGuide, organization: LegalEntityLike): string {
  const name = organizationLabel(organization).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "organization";
  return `${name}-${guide.id}-incorporation-preparation.txt`;
}
