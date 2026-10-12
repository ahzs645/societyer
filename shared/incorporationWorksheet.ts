import {
  incorporationPreparationForOrganization,
} from "./incorporationPreparation";
import { organizationLabel, type LegalEntityLike } from "./organizationDomain";
import { articlesAdoptionSentence } from "./operativeArticles";

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
    ...articlesWorksheetLines(guide, organization),
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

/**
 * BC company articles planning: the adopted base (Table 1 version or custom
 * articles), the custom Parts per share class, and the drafting checks the
 * articles preparation draft raises. Never assumes Table 1.
 */
function articlesWorksheetLines(guide: PreparationGuide, organization: LegalEntityLike): string[] {
  if (guide.id !== "bc_company") return [];
  const recorded = articlesAdoptionSentence(organization);
  return [
    "",
    "ARTICLES",
    recorded
      ? `Recorded articles: ${recorded}.`
      : "Articles base: [ ] Table 1 Articles, version adopted: ________, supplemented by Parts ____ for the ________ shares   [ ] Custom articles signed by the incorporators",
    "Table 1 is never assumed. If the incorporators sign no articles, Table 1 applies by operation of the Act; record the version in force.",
    "For each share class, a custom Part sets out: the special rights and restrictions preamble; dividends; redemption or retraction procedure (price, selection, notice, payment, transfers during redemption); liquidation ranking; voting; pre-emptive rights; cancellation of redeemed shares.",
    "Drafting checks: a rate and base for any \"cumulative\" dividend; the ranking between preferred classes; a fair-market-value redemption amount and price-adjustment clause for estate-freeze shares; the common shares' rights spelled out.",
    "Indemnity: record whether director indemnity is mandatory (as in Table 1) or permissive, and whether officers are covered (Business Corporations Act ss. 159-165).",
    "Alternative: a federal CBCA corporation is a separate route with its own statute, articles and registry.",
    "Generate the BC articles preparation draft for a Part skeleton per share class. Legal review is required; no tax effect is claimed.",
  ];
}
