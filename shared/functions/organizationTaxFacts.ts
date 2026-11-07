import type { PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import { CHARITY_REGISTRATION_HISTORY_LIMIT, CHARITY_REGISTRATION_TYPE, charityRegistrationAtDate, projectCharityRegistrationHistory, type CharityRegistrationRevision } from "../receipting/registration";
import { assertInvoiceOrganizationTaxFacts, type SupplierTaxOrganization } from "../tax/organizationFacts";
import type { TaxAssessment } from "../tax/types";
import { assertRegistrationEvidenceCurrent } from "./receiptRegistration";

export type StoredOrganizationTaxContext = Omit<SupplierTaxOrganization, "charityRegistrations"> & {
  charityRegistrations: CharityRegistrationRevision[];
};

/** Internal, tenant-authorized read. Full evidence stays on the server. */
export async function loadOrganizationTaxContext(ctx: PortableQueryCtx, societyId: string): Promise<StoredOrganizationTaxContext> {
  await requireSocietyMembership(ctx, societyId);
  const [organization, revisions] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    ctx.db.query("organizationTaxRegistrations").withIndex("by_society", q => q.eq("societyId", societyId)).take(CHARITY_REGISTRATION_HISTORY_LIMIT + 1),
  ]);
  if (!organization) throw new Error("Organization not found.");
  if (revisions.length > CHARITY_REGISTRATION_HISTORY_LIMIT) throw new Error("The charity-registration history exceeds the supported review limit. Review the history before issuing assessed documents.");
  return {
    isCharity: organization.isCharity,
    charityStatus: organization.charityStatus,
    charityRegistrations: revisions.filter(row => row.registrationType === CHARITY_REGISTRATION_TYPE) as unknown as CharityRegistrationRevision[],
  };
}

/** Guided publication depends on the reviewed source as well as its dated
 * registration facts. Perform these reads before any invoice or ledger write. */
export async function assertInvoiceOrganizationFactsCurrent(
  ctx: PortableQueryCtx,
  societyId: string,
  lines: readonly { item?: string; taxAssessment?: TaxAssessment }[],
  context: StoredOrganizationTaxContext,
): Promise<void> {
  assertInvoiceOrganizationTaxFacts(lines, context);
  const checked = new Set<string>();
  for (const line of lines) {
    if (!line.taxAssessment) continue;
    const assessment = charityRegistrationAtDate(context.charityRegistrations, line.taxAssessment.answers.supplyDate);
    if (!["registered", "not_registered"].includes(assessment.status) || !assessment.revision) continue;
    const revision = context.charityRegistrations.find(row => row._id === assessment.revision!._id);
    if (!revision || checked.has(revision._id)) continue;
    await assertRegistrationEvidenceCurrent(ctx, societyId, revision);
    checked.add(revision._id);
  }
}

/** Safe for invoice editors and setup summaries: no account, evidence, contact,
 * reviewer or internal note fields leave the registration read. */
export function projectOrganizationTaxContext(context: StoredOrganizationTaxContext) {
  return {
    isCharity: context.isCharity,
    charityStatus: context.charityStatus,
    charityRegistrations: projectCharityRegistrationHistory(context.charityRegistrations),
  };
}
