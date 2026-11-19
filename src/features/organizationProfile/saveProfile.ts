import { entitySetupFields } from "../../../shared/entitySetup";
import { addressLine, findCurrentAddress, guidedAddressText } from "./detailRows";
import type { AddressRow, OrganizationRecord, ProfileForm } from "./types";

/**
 * The one `society.upsert` call behind "Save changes": every profile field,
 * from every tab. The plain-text office and mailing addresses follow the
 * current structured rows (in the guided-setup format for a workspace made by
 * the guided setup), or keep the legacy text when there is no row.
 */
export function profileUpsertArgs(form: ProfileForm, society: OrganizationRecord, addresses: readonly AddressRow[]) {
  const office = findCurrentAddress(addresses, "registered_office");
  const mailing = findCurrentAddress(addresses, "mailing");
  const addressText = (row: AddressRow | undefined, legacy: string | undefined) =>
    society.onboardingAnswersJson && row ? guidedAddressText(row) : row ? addressLine(row) : legacy ?? "";
  return {
    id: form._id,
    name: form.name,
    incorporationNumber: form.incorporationNumber,
    incorporationDate: form.incorporationDate,
    fiscalYearEnd: form.fiscalYearEnd,
    jurisdictionCode: form.jurisdictionCode || undefined,
    ...entitySetupFields(form),
    anniversaryDate: form.anniversaryDate || undefined,
    entityType: form.entityType,
    actFormedUnder: form.actFormedUnder,
    officialEmail: form.officialEmail,
    numbered: !!form.numbered,
    distributing: !!form.distributing,
    solicitingPublicBenefit: !!form.solicitingPublicBenefit,
    organizationStatus: form.organizationStatus,
    archivedAtISO: form.archivedAtISO,
    removedAtISO: form.removedAtISO,
    continuanceDate: form.continuanceDate,
    amalgamationDate: form.amalgamationDate,
    naicsCode: form.naicsCode,
    naicsSector: form.naicsSector,
    niceClassification: form.niceClassification,
    isCharity: form.isCharity,
    isMemberFunded: form.isMemberFunded,
    registeredOfficeAddress: addressText(office, form.registeredOfficeAddress),
    mailingAddress: addressText(mailing, form.mailingAddress),
    purposes: form.purposes,
    privacyOfficerName: form.privacyOfficerName,
    privacyOfficerEmail: form.privacyOfficerEmail,
    privacyProgramStatus: form.privacyProgramStatus,
    privacyProgramReviewedAtISO: form.privacyProgramReviewedAtISO,
    privacyProgramNotes: form.privacyProgramNotes,
    memberDataAccessStatus: form.memberDataAccessStatus,
    memberDataGapDocumented: !!form.memberDataGapDocumented,
    memberDataAccessReviewedAtISO: form.memberDataAccessReviewedAtISO,
    memberDataAccessNotes: form.memberDataAccessNotes,
    boardCadence: form.boardCadence,
    boardCadenceDayOfWeek: form.boardCadenceDayOfWeek,
    boardCadenceTime: form.boardCadenceTime,
    boardCadenceNotes: form.boardCadenceNotes,
    publicSlug: form.publicSlug,
    publicSummary: form.publicSummary,
    publicContactEmail: form.publicContactEmail,
    publicTransparencyEnabled: form.publicTransparencyEnabled,
    publicShowBoard: form.publicShowBoard,
    publicShowBylaws: form.publicShowBylaws,
    publicShowFinancials: form.publicShowFinancials,
    publicVolunteerIntakeEnabled: form.publicVolunteerIntakeEnabled,
    publicGrantIntakeEnabled: form.publicGrantIntakeEnabled,
    demoMode: form.demoMode,
  };
}
