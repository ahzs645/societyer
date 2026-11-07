import { charityStatusConflict } from "../entitySetup";
import {
  charityRegistrationAtDate,
  currentCharityRegistration,
  type CharityRegistrationProjection,
  type CharityRegistrationRevision,
} from "../receipting/registration";
import type { InvoiceSupplierTaxSnapshot } from "../invoiceTaxRegistrations";
import { assessTax } from "./index";
import type { TaxAnswers, TaxAssessment } from "./types";

export type SupplierTaxOrganization = {
  isCharity?: boolean | null;
  charityStatus?: string | null;
  /** Backend callers pass stored revisions; the UI receives only projections. */
  charityRegistrations?: readonly (CharityRegistrationRevision | CharityRegistrationProjection)[];
};

type TaxLine = { item?: string; taxAssessment?: TaxAssessment };

/** Legal form and an old false flag do not establish income-tax NPO status or
 * absence of charity registration. A reviewed, dated history governs its
 * recorded period; undated legacy claims are used only while that is unresolved. */
export function organizationTaxFacts(organization: SupplierTaxOrganization | undefined, onDate: string) {
  const history = organization?.charityRegistrations ?? [];
  const registration = charityRegistrationAtDate(history, onDate);
  const current = currentCharityRegistration(history);
  const legacyConflict = charityStatusConflict(organization ?? {});
  const unresolvedClaim = registration.status === "unknown" && (
    organization?.isCharity === true || organization?.charityStatus === "registered"
    // An unknown/pending revision does not reverse earlier positive claims or
    // reviewed registration proof. Such a reversal needs a separate review.
    || history.some(revision => revision.status === "registered" || revision.status === "inactive")
  );
  const conflict = registration.status === "conflict" || (registration.status === "unknown" && Boolean(legacyConflict));
  const reasons = conflict
    ? registration.status === "conflict" ? registration.reasons.map(reason => reason.message) : [legacyConflict!]
    : unresolvedClaim
      ? ["The organization profile or history claims charity registration, but the applicable status is unresolved for this date. Review Organization → Charity registration before confirming this tax assessment."]
      : [];
  // Revisions are immutable. The current revision and its date-specific result
  // identify the facts reviewed without embedding private registration evidence.
  const factsKey = JSON.stringify([
    "supplier-facts-v1", onDate, registration.status,
    current.revision?._id ?? null, current.revision?.revisionNumber ?? null,
    history.length ? null : organization?.isCharity ?? null,
    history.length ? null : organization?.charityStatus ?? null,
  ]);
  return {
    charityRegistrationStatus: registration.status,
    registrationRevisionId: registration.revision?._id,
    hasRegistrationHistory: history.length > 0,
    suggestedSellerKind: registration.status === "registered" ? "charity" as const : undefined,
    needsReview: conflict || unresolvedClaim,
    reasons,
    factsKey,
    message: registration.status === "registered"
      ? "Reviewed registration evidence identifies this supplier as a registered charity for the assessment date. Review the rules for the actual supply."
      : registration.status === "not_registered"
        ? "The assessment date is outside the recorded charity-registration period. This does not establish income-tax NPO status or a sales-tax exemption."
        : reasons[0] ?? (current.revision?.status === "applied"
          ? "A charity application is pending. Assess the supplier's present tax status; the application does not establish registration."
          : "Charity registration is not established in the reviewed profile. Confirm the supplier's actual tax status for this transaction."),
  };
}

export function prefillOrganizationTaxAnswers(answers: TaxAnswers, organization?: SupplierTaxOrganization): TaxAnswers {
  const facts = organizationTaxFacts(organization, answers.supplyDate);
  return facts.suggestedSellerKind && (!answers.sellerKind || answers.sellerKind === "unknown")
    ? { ...answers, sellerKind: facts.suggestedSellerKind }
    : answers;
}

export function organizationTaxProblems(answers: TaxAnswers, organization?: SupplierTaxOrganization, checkRecordedFacts = true): string[] {
  const facts = organizationTaxFacts(organization, answers.supplyDate);
  const problems = [...facts.reasons];
  if (facts.charityRegistrationStatus === "registered" && answers.sellerKind !== "charity") {
    problems.push("The organization's reviewed registration identifies a registered charity for this date. Reopen the tax guide and assess the supply as a registered charity.");
  }
  if (answers.sellerKind === "charity" && facts.charityRegistrationStatus !== "registered" && !facts.needsReview) {
    problems.push(facts.charityRegistrationStatus === "not_registered"
      ? "This date is outside the reviewed charity-registration period. Review the supply date and registration evidence before using the charity tax rules."
      : "Record and review the applicable charity-registration evidence in Organization → Charity registration before confirming the charity tax rules.");
  }
  if (checkRecordedFacts && (
    (answers.organizationFactsKey && answers.organizationFactsKey !== facts.factsKey)
    || (!answers.organizationFactsKey && facts.hasRegistrationHistory)
  )) {
    problems.push("The organization's supplier facts changed or have not been confirmed for this assessment. Reopen the tax guide and confirm the current facts before issuing it.");
  }
  return [...new Set(problems)];
}

/** Opening the guide prepares a fresh assessment; only explicit confirmation
 * records its current organization context. Publication rechecks stored facts. */
export function assessTaxForOrganization(answers: TaxAnswers, organization?: SupplierTaxOrganization, confirmed = false): TaxAssessment {
  const facts = organizationTaxFacts(organization, answers.supplyDate);
  const currentAnswers = { ...answers, organizationFactsKey: facts.factsKey };
  const assessment = assessTax(currentAnswers, confirmed);
  const problems = organizationTaxProblems(currentAnswers, organization);
  if (!problems.length) return assessment;
  return { ...assessment, issues: [...new Set([...assessment.issues, ...problems])], status: "review_required", confirmed: false };
}

/** Apply before any publication/ledger writes. Explicit manual rates have no
 * guided assessment and stay unassessed. */
export function assertInvoiceOrganizationTaxFacts(lines: readonly TaxLine[], organization: SupplierTaxOrganization): void {
  for (const line of lines) {
    if (!line.taxAssessment) continue;
    const problems = organizationTaxProblems(line.taxAssessment.answers, organization);
    if (problems.length) throw new Error(`${line.item || "Item"}: ${problems.join(" ")}`);
  }
}

export function snapshotSupplierTaxFacts(lines: readonly TaxLine[], organization: SupplierTaxOrganization, onDate: string): InvoiceSupplierTaxSnapshot | undefined {
  if (!lines.some(line => line.taxAssessment)) return undefined;
  const facts = organizationTaxFacts(organization, onDate);
  return {
    charityRegistrationStatus: facts.charityRegistrationStatus,
    ...(facts.registrationRevisionId ? { charityRegistrationRevisionId: facts.registrationRevisionId } : {}),
    organizationFactsKey: facts.factsKey,
  };
}
