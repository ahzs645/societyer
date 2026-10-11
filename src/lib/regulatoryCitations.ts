import { LEGAL_SOURCES } from "../../shared/legalSources";
import { LEGAL_GOVERNANCE_PROFILES } from "../../shared/legalGovernanceProfiles";
import { PRIVACY_CITATIONS, PRIVACY_LAWS } from "../../shared/privacyRuleProfiles";
/**
 * Regulatory citation database.
 *
 * A flat lookup map keyed by stable citation id. Each entry points the user
 * at the primary legal source (statute, regulation, policy) that a
 * compliance flag is resting on — so a warning like "No PIPA privacy policy
 * on file" can show the user the exact wording of the rule that requires
 * that policy, plus a deep link out to the authoritative source.
 *
 * Usage:
 *   <Flag level="warn" citationId="PIPA-POLICY">...</Flag>
 *
 * Citations are entity-specific. Before rendering one for a workspace, pass it
 * through `citationIdForOrganization` / `citationIdsForOrganization` (or pick
 * one with `pickCitationIdForOrganization`) so a Societies Act citation never
 * reaches a corporation:
 *   <Flag citationId={citationIdForOrganization("BC-SOC-AGM", society)}>...</Flag>
 *
 * Keep ids stable — they are referenced from pages across the app. When a
 * statute changes, prefer adding a new id (with a caveat) over rewriting
 * an existing quote so older screens still resolve.
 */

import type { LegalEntityLike } from "../../shared/organizationDomain";
import { audienceAppliesToOrganization, organizationRuleScope, type RuleAudience } from "../../shared/entityRuleScope";

export type { RuleAudience };

export type RegulatoryJurisdiction =
  | "CA"
  | "CA-BC"
  | "CA-AB"
  | "CA-ON"
  | "International"
  | string;

export interface RegulatoryCitation {
  /** Stable id referenced from UI, e.g. "PIPA-POLICY". */
  id: string;
  /** One-line source label shown as the tooltip title. */
  source: string;
  /** Full academic/legal citation string. */
  fullCitation: string;
  /** Jurisdiction code (e.g. "CA-BC"). */
  jurisdiction: RegulatoryJurisdiction;
  /** Instrument (e.g. "Personal Information Protection Act", "Societies Act"). */
  instrument: string;
  /** Section label, e.g. "s.5" or "ss.20-24". */
  section?: string;
  /** Deep link to the canonical source. */
  url: string;
  /** Optional point-in-time URL for historical checks. */
  pointInTimeUrl?: string;
  /** Date actually displayed by the statutory consolidation; distinct from review. */
  sourceCurrentToISO?: string;
  /** Separates a faithful summary from quoted statutory text. */
  quoteKind?: "summary" | "quotation";
  reviewedOnISO?: string;
  sourceStatus?: "in_force" | "registry_guidance" | "proposed";
  /** Short quote (or close paraphrase) from the section. */
  quote: string;
  /** Optional caveat shown beneath the quote. */
  caveat?: string;
  /** Optional — tie this citation to one of the LegalGuideRule topics
   * (jurisdictionGuideTracks.ts) so the two can be cross-linked later. */
  relatedGuideTopic?: string;
  /**
   * Optional verbatim passage used to build a Chromium text-fragment URL
   * (`#:~:text=...`) so clicking through highlights the exact sentence on
   * the source page. If omitted, the helper falls back to `quote` — which
   * only highlights reliably when `quote` is word-for-word identical to
   * the text on the destination page. For paraphrased quotes, set this to
   * a short verbatim snippet you know appears in the source.
   */
  highlight?: string;
  /**
   * Optional override of which organizations this citation is written for.
   * When omitted it is derived from the instrument and jurisdiction — see
   * `citationAudience`. Societies Act / Societies Regulation citations are
   * BC-society-only and must never be shown to a corporation.
   */
  audience?: RuleAudience;
}

const CASL_URL =
  "https://laws-lois.justice.gc.ca/eng/acts/E-1.6/FullText.html";
const CRA_RECORDS_URL =
  "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/where-keep-your-records-long-request-permission-destroy-them-early.html";
const CRA_CHARITIES_BOOKS_URL =
  "https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/books-records.html";
const BC_OIPC_PRIVATE_ORGS_URL =
  "https://www.oipc.bc.ca/for-private-organizations/";
const BC_OIPC_PRIVACY_POLICY_GUIDE_URL =
  "https://www.oipc.bc.ca/documents/guidance-documents/2164";
const BC_OIPC_PRIVACYRIGHT_POLICY_WEBINAR_URL =
  "https://www.oipc.bc.ca/privacyright/webinars/webinar-2b/";
const OPC_PRIVACY_PLAN_TOOL_URL =
  "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-compliance-and-training-tools/";

const PRIVACY_RESOURCE_REVIEWED_ON_ISO = "2026-10-11";

export const regulatoryCitations: Record<string, RegulatoryCitation> = {
  "OIPC-PIPA-PRIVATE-ORGS": {
    id: "OIPC-PIPA-PRIVATE-ORGS",
    source: "BC OIPC — Resources for private organizations",
    fullCitation:
      "Office of the Information and Privacy Commissioner for British Columbia, For Private Organizations. Reviewed " +
      PRIVACY_RESOURCE_REVIEWED_ON_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "BC OIPC guidance",
    url: BC_OIPC_PRIVATE_ORGS_URL,
    reviewedOnISO: PRIVACY_RESOURCE_REVIEWED_ON_ISO,
    quoteKind: "summary",
    sourceStatus: "registry_guidance",
    quote:
      "BC OIPC provides practical information for private-sector organizations, including not-for-profits and charities, to learn more about PIPA and how to comply.",
    caveat:
      "This is guidance, not legal advice. Use it with the text of PIPA and organization-specific review.",
  },
  "OIPC-PIPA-PRIVACY-POLICY-GUIDE": {
    id: "OIPC-PIPA-PRIVACY-POLICY-GUIDE",
    source: "BC OIPC — Developing a privacy policy under PIPA",
    fullCitation:
      "Office of the Information and Privacy Commissioner for British Columbia, Developing a privacy policy under the Personal Information Protection Act (PIPA). Reviewed " +
      PRIVACY_RESOURCE_REVIEWED_ON_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "BC OIPC guidance",
    url: BC_OIPC_PRIVACY_POLICY_GUIDE_URL,
    reviewedOnISO: PRIVACY_RESOURCE_REVIEWED_ON_ISO,
    quoteKind: "summary",
    sourceStatus: "registry_guidance",
    quote:
      "BC OIPC guidance explains that PIPA requires organizations to develop and follow policies and practices needed for compliance, and to make information about them available on request.",
    caveat:
      "This is the best BC-specific source for shaping a privacy policy, but it is guidance rather than a fill-in-the-blanks official policy template.",
  },
  "OIPC-PRIVACYRIGHT-WRITE-POLICY": {
    id: "OIPC-PRIVACYRIGHT-WRITE-POLICY",
    source: "BC OIPC PrivacyRight — How to write a privacy policy",
    fullCitation:
      "Office of the Information and Privacy Commissioner for British Columbia, PrivacyRight Webinar 2b: How to write a privacy policy. Reviewed " +
      PRIVACY_RESOURCE_REVIEWED_ON_ISO +
      ".",
    jurisdiction: "CA-BC",
    instrument: "BC OIPC PrivacyRight",
    url: BC_OIPC_PRIVACYRIGHT_POLICY_WEBINAR_URL,
    reviewedOnISO: PRIVACY_RESOURCE_REVIEWED_ON_ISO,
    quoteKind: "summary",
    sourceStatus: "registry_guidance",
    quote:
      "BC OIPC's PrivacyRight webinar covers how to write a privacy policy for an organization.",
    caveat:
      "Use this as an educational resource for drafting and review; the organization remains responsible for its own compliance.",
  },
  "OPC-PRIVACY-PLAN-TOOL": {
    id: "OPC-PRIVACY-PLAN-TOOL",
    source: "Office of the Privacy Commissioner of Canada — Privacy tools",
    fullCitation:
      "Office of the Privacy Commissioner of Canada, PIPEDA compliance and training tools. Reviewed " +
      PRIVACY_RESOURCE_REVIEWED_ON_ISO +
      ".",
    jurisdiction: "CA",
    instrument: "Federal OPC guidance",
    url: OPC_PRIVACY_PLAN_TOOL_URL,
    reviewedOnISO: PRIVACY_RESOURCE_REVIEWED_ON_ISO,
    quoteKind: "summary",
    sourceStatus: "registry_guidance",
    quote:
      "The OPC provides PIPEDA guides, self-assessment materials, privacy management guidance and training resources.",
    caveat:
      "Select resources for the assessed law and actual activities. Completing a tool or training does not establish compliance.",
    audience: "privacy:pipeda",
  },
  "CASL-CONSENT": {
    id: "CASL-CONSENT",
    source: "CASL s.6 — Consent to send commercial electronic messages",
    fullCitation:
      "An Act to promote the efficiency and adaptability of the Canadian economy (Canada's Anti-Spam Legislation), SC 2010, c.23, s.6.",
    jurisdiction: "CA",
    instrument: "Canada's Anti-Spam Legislation",
    section: "s.6",
    url: CASL_URL,
    quote:
      "A commercial electronic message generally requires a consent basis, sender identification and unsubscribe handling. Classify the message and assess the statutory or regulatory exceptions before sending.",
    caveat:
      "Required legal notices, qualifying relationships and registered-charity fundraising have distinct rules. Shareholder status and nonprofit incorporation alone do not establish marketing consent.",
    quoteKind: "summary", reviewedOnISO: "2026-10-11", sourceCurrentToISO: "2026-09-21", sourceStatus: "in_force",
  },
  "CRA-BOOKS-RECORDS": {
    id: "CRA-BOOKS-RECORDS",
    source: "CRA — Keeping records (6-year retention)",
    fullCitation:
      "Canada Revenue Agency. Keeping records. Updated guidance on how long to keep business and non-profit books and records.",
    jurisdiction: "CA",
    instrument: "Income Tax Act & CRA guidance",
    section: "ITA s.230; CRA guidance",
    url: CRA_RECORDS_URL,
    quote:
      "The usual tax-record period is six years after the end of the relevant tax year. A late income-tax return generally restarts the six-year period at filing; longer and indefinite rules apply to specified records.",
    caveat:
      "Check capital-property and share-register history, unresolved objections or appeals, dissolution and other legal holds. CRA permission does not override another law’s retention requirement.",
    quoteKind: "summary", reviewedOnISO: "2026-10-11", sourceStatus: "registry_guidance",
  },
  "CRA-CHARITIES-BOOKS": {
    id: "CRA-CHARITIES-BOOKS",
    source: "CRA — Books and records for registered charities",
    fullCitation:
      "Canada Revenue Agency. Books and records for registered charities. Updated CRA guidance.",
    jurisdiction: "CA",
    instrument: "Income Tax Act & CRA charities guidance",
    section: "ITA s.230(4); CRA charities guidance",
    url: CRA_CHARITIES_BOOKS_URL,
    quote:
      "Registered charities keep adequate books and records. Governing documents and meeting minutes are retained while registered and for at least two years after revocation; operational and receipt records have different periods.",
    caveat: "Apply charity-specific location and electronic-readability requirements, alongside any longer corporate, society, tax or litigation retention duty.",
    quoteKind: "summary", reviewedOnISO: "2026-10-11", sourceStatus: "registry_guidance",
  }
};

/** Current primary-source summaries resolve from the shared legal registry.
 * Historical records retain their stored evidence; this registry describes current guidance. */
for (const source of LEGAL_SOURCES) {
  const profile = LEGAL_GOVERNANCE_PROFILES.find(p => [
    ...p.directors.sourceIds, ...p.directors.consentSourceIds, ...p.annualMeeting.sourceIds,
    ...p.annualReturn.sourceIds, ...p.meetings.noticeSourceIds, ...p.meetings.quorumSourceIds,
    ...p.resolutions.sourceIds, ...p.records.flatMap(r => r.sourceIds),
  ].includes(source.id));
  // A foreign entity's BC registration is a separate, fact-dependent context.
  // Keep this source available for explicit review without attaching it to the
  // domestic BC-company profile or any automatic compliance rule.
  const audience: RuleAudience = source.id === 'BC-BCA-EXTRAPROVINCIAL' ? 'general'
    : source.id.startsWith('BC-SOC-') ? 'bc_society'
    : profile ? `governance:${profile.id}`
    : source.id.startsWith('BC-BCA-') ? 'governance:bc_company'
    : source.id.startsWith('CBCA-') ? 'governance:federal_cbca'
    : source.id.startsWith('OBCA-') || source.id.startsWith('ON-CIA-') ? 'governance:ontario_obca'
    : source.id === 'ON-EXTRAPROVINCIAL-FEDERAL' ? 'governance:federal_cbca' : 'general';
  regulatoryCitations[source.id] = {
    id: source.id, source: `${source.instrument} ${source.section}`, fullCitation: source.fullCitation,
    jurisdiction: profile?.jurisdictionCode ?? (source.id.startsWith('BC-') ? 'CA-BC' : source.id.startsWith('OBCA-') || source.id.startsWith('ON-') ? 'CA-ON' : 'CA'),
    instrument: source.instrument, section: source.section, url: source.url,
    sourceCurrentToISO: source.consolidatedThrough, reviewedOnISO: source.reviewedOn,
    sourceStatus: source.status, quote: source.summary, quoteKind: 'summary', caveat: source.caveat, audience,
  };
}
for (const [id, citation] of Object.entries(PRIVACY_CITATIONS)) {
  const law = Object.values(PRIVACY_LAWS).find(l => l.rules.some(r => r.citationIds.includes(id)))
    ?? (id.startsWith('AB-PIPA-') ? PRIVACY_LAWS.ab_pipa : undefined);
  regulatoryCitations[id] = { ...citation, audience: law ? `privacy:${law.id}` : 'general', reviewedOnISO: '2026-10-11', quoteKind: 'summary', sourceStatus: 'in_force' };
}

/** Look up a citation. Returns undefined if the id is unknown. */
export function getRegulatoryCitation(
  id: string | undefined | null,
): RegulatoryCitation | undefined {
  if (!id) return undefined;
  return regulatoryCitations[id];
}

/**
 * Which organizations a citation is written for. Societies Act and Societies
 * Regulation (model bylaws) citations are BC-society-only; other BC sources
 * (PIPA, BC OIPC) depend on the recorded BC activity assessment; each other
 * law has its own governing-Act or privacy scope.
 */
export function citationAudience(citation: Pick<RegulatoryCitation, "instrument" | "jurisdiction" | "audience">): RuleAudience {
  if (citation.audience) return citation.audience;
  if (/^Societies (Act|Regulation)\b/.test(citation.instrument)) return "bc_society";
  if (/Canada Business Corporations Act/.test(citation.instrument)) return "governance:federal_cbca";
  if (/Business Corporations Act/.test(citation.instrument)) return citation.jurisdiction === "CA-BC" ? "governance:bc_company" : "governance:ontario_obca";
  if (citation.jurisdiction === "CA-BC") return "bc_organization";
  return "general";
}

type CitationRef = string | RegulatoryCitation | undefined | null;

function resolveCitation(ref: CitationRef): RegulatoryCitation | undefined {
  if (!ref) return undefined;
  return typeof ref === "string" ? getRegulatoryCitation(ref) : ref;
}

/**
 * True when the citation applies to this organization. Unknown ids return
 * false so a page never shows a citation it cannot resolve.
 */
export function citationAppliesToOrganization(
  ref: CitationRef,
  organization: LegalEntityLike | null | undefined,
): boolean {
  const citation = resolveCitation(ref);
  return Boolean(citation && audienceAppliesToOrganization(citationAudience(citation), organization));
}

/** The citation id when it applies to this organization, otherwise undefined (suppress). */
export function citationIdForOrganization(
  id: string | undefined | null,
  organization: LegalEntityLike | null | undefined,
): string | undefined {
  return id && citationAppliesToOrganization(id, organization) ? id : undefined;
}

/** Filter a list of citation ids down to those that apply to this organization. */
export function citationIdsForOrganization(
  ids: readonly (string | undefined | null)[] | undefined | null,
  organization: LegalEntityLike | null | undefined,
): string[] {
  return (ids ?? []).filter((id): id is string => citationAppliesToOrganization(id, organization));
}

/**
 * Pick the citation for this organization from per-entity candidates, e.g.
 * `pickCitationIdForOrganization({ society: "BC-SOC-AGM" }, organization)`.
 * Each candidate is still checked against the organization, so a BC Societies
 * Act citation is suppressed for a corporation or a non-BC society. Returns
 * undefined when nothing applies — render no citation rather than a wrong one.
 */
export function pickCitationIdForOrganization(
  candidates: { society?: string; corporation?: string; fallback?: string },
  organization: LegalEntityLike | null | undefined,
): string | undefined {
  const scope = organizationRuleScope(organization);
  const preferred = scope.isSociety ? candidates.society : scope.isCorporation ? candidates.corporation : undefined;
  return citationIdForOrganization(preferred, organization) ?? citationIdForOrganization(candidates.fallback, organization);
}

/** All citation ids, useful for exhaustiveness checks in tests. */
export const REGULATORY_CITATION_IDS = Object.keys(
  regulatoryCitations,
) as (keyof typeof regulatoryCitations)[];

// ---------------------------------------------------------------------------
// Text Fragment (`#:~:text=...`) URL helpers
//
// Chromium-based browsers support "Scroll to Text Fragment" — a URL hash
// of the form `#:~:text=encoded%20text` (optionally with `,textEnd`) that
// scrolls to and highlights that text on the destination page. See:
//   https://wicg.github.io/scroll-to-text-fragment/
// ---------------------------------------------------------------------------

/** Max characters to embed in a text-fragment start or end segment.
 * Longer than this and we switch to the `textStart,textEnd` shape so the
 * URL stays under typical browser limits and has a better chance of
 * matching when the source page wraps or reflows the text. */
const FRAGMENT_SEGMENT_MAX_CHARS = 220;

/** Words to grab from each end of a long passage when we fall back to the
 * `textStart,textEnd` pattern. */
const FRAGMENT_EDGE_WORDS = 8;

/** URL-encode a text-fragment segment. Encodes `,` and `-` as well because
 * they're delimiters in the text-fragment grammar. */
function encodeFragmentSegment(text: string): string {
  return encodeURIComponent(text.trim())
    .replace(/-/g, "%2D")
    .replace(/,/g, "%2C");
}

/** Collapse whitespace so multi-line quotes still match page text. */
function normaliseForFragment(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Build a deep link that highlights the cited passage on the source page
 * using a Chromium text-fragment (`#:~:text=...`). For long passages,
 * uses the `textStart,textEnd` shape so slight reflow on the destination
 * doesn't break the match.
 *
 * Falls back to the bare URL when there's no highlight-able text.
 */
export function buildHighlightUrl(
  citation: Pick<RegulatoryCitation, "url" | "quote" | "highlight" | "quoteKind">,
): string {
  if (citation.quoteKind === "summary" && !citation.highlight) return citation.url;
  const baseUrl = citation.url.split("#")[0];
  const raw = citation.highlight ?? citation.quote;
  if (!raw) return citation.url;

  const passage = normaliseForFragment(raw);
  if (!passage) return citation.url;

  // Short enough to include verbatim — highest-fidelity highlight.
  if (passage.length <= FRAGMENT_SEGMENT_MAX_CHARS) {
    return `${baseUrl}#:~:text=${encodeFragmentSegment(passage)}`;
  }

  // Otherwise use the range shape: first few words , last few words.
  const words = passage.split(" ");
  const startWords = words.slice(0, FRAGMENT_EDGE_WORDS).join(" ");
  const endWords = words.slice(-FRAGMENT_EDGE_WORDS).join(" ");
  return `${baseUrl}#:~:text=${encodeFragmentSegment(startWords)},${encodeFragmentSegment(endWords)}`;
}

/**
 * Copy a string to the clipboard. Returns true on success. Falls back to
 * a hidden textarea for environments without `navigator.clipboard` (e.g.
 * non-secure contexts, older Safari inside an iframe, etc.).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea approach
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
