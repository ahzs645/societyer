/**
 * Operative articles of a company (owned by the articles work; see the shared
 * field contracts). Until the full operative-articles record lands, this file
 * holds only the helper the share ledger needs.
 */

type OrganizationWithArticles = { operativeArticles?: { transferConsentRequired?: boolean } | null } | null | undefined;

/** True when the company's articles require the directors' consent to every share transfer. */
export function transferConsentRequired(org: OrganizationWithArticles | Record<string, any>): boolean {
  return (org as OrganizationWithArticles)?.operativeArticles?.transferConsentRequired === true;
}
