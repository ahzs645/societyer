import { ENTITY_DATE_FIELDS } from "../../../shared/entitySetup";
import type { ProfileTab } from "./types";

/**
 * The saved profile fields each tab edits. The one "Save changes" button
 * saves them all; a tab whose fields differ from the saved organization shows
 * an unsaved-changes dot. Register rows (addresses, registrations,
 * identifiers) save through their own drawers and are not listed.
 */
export const PROFILE_TAB_FIELDS: Readonly<Record<ProfileTab, readonly string[]>> = {
  overview: [],
  legal: [
    // Identity & formation
    "name", "entityType", "jurisdictionCode", "actFormedUnder", "legalSubtype", "isMemberFunded",
    "formationStatus", "incorporationNumber", "incorporationDate",
    "certificateEvidenceDocumentId", "certificateReference", "certificateDate",
    // Identity & formation → status & registry history, classification
    "organizationStatus", "continuanceDate", "amalgamationDate", "archivedAtISO", "removedAtISO",
    "numbered", "distributing", "solicitingPublicBenefit", "niceClassification",
    // Articles
    "articlesMinDirectors", "articlesMaxDirectors", "articlesShareTransferRestrictions",
    "articlesBusinessRestrictions", "articlesOtherProvisions", "articlesSourceDocumentId",
    // Business & year
    "purposes", "naicsSector", "naicsCode", "fiscalYearEnd",
    ...ENTITY_DATE_FIELDS.map((field) => field.value), "annualMeetingYear", "agmExtensionEvidence",
    // Meetings
    "boardCadence", "boardCadenceDayOfWeek", "boardCadenceTime", "boardCadenceNotes",
  ],
  registrations: [],
  offices: ["officialEmail", "privacyOfficerName", "privacyOfficerEmail"],
  tax: ["craBnStatus", "craRcStatus", "gstHstStatus", "payrollStatus", "charityStatus", "isCharity", "taxStatusEvidence"],
  documents: [],
};

/** Empty, unset and false read the same: saving writes `!!flag` and drops blanks. */
function comparable(value: unknown): unknown {
  if (value === undefined || value === null || value === "" || value === false) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/** The tabs with edits that "Save changes" has not written yet. */
export function unsavedProfileTabs(form: Record<string, unknown> | null | undefined, saved: Record<string, unknown> | null | undefined): Set<ProfileTab> {
  const dirty = new Set<ProfileTab>();
  if (!form || !saved) return dirty;
  for (const [tab, fields] of Object.entries(PROFILE_TAB_FIELDS) as [ProfileTab, readonly string[]][]) {
    if (fields.some((field) => comparable(form[field]) !== comparable(saved[field]))) dirty.add(tab);
  }
  return dirty;
}

/** Section anchors from before the profile had tabs, and the tab each one now lives on. */
export const PROFILE_ANCHOR_TABS: Readonly<Record<string, ProfileTab>> = {
  "registered-office": "offices",
  "tax-identifiers": "tax",
  "more-organization-details": "legal",
  articles: "legal",
  "business-year": "legal",
  "rarely-needed": "legal",
  "status-history": "legal",
  "governing-documents": "documents",
};
