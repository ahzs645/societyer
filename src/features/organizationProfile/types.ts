import type { Doc } from "../../../convex/_generated/dataModel";

/** The saved organization as the profile reads it. */
export type OrganizationRecord = Doc<"societies">;

/**
 * The profile form: the saved organization plus unsaved edits. Its keys are
 * the society fields; a few setup-only keys pass through untyped.
 */
export type ProfileForm = OrganizationRecord & Record<string, unknown>;
export type SetProfileField = (key: string, value: unknown) => void;

export const PROFILE_TABS = ["overview", "legal", "registrations", "offices", "tax", "documents"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export type DrawerKind = "address" | "registration" | "identifier";

/** A register row as the table reads it: the values its columns sort and filter by, plus the row. */
export type DetailRecord<T> = Record<string, unknown> & { _id: string; row: T };

export type AddressRow = {
  _id: string;
  type?: string;
  status?: string;
  unit?: string;
  street?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
};

export type RegistrationRow = {
  _id: string;
  jurisdiction?: string;
  homeJurisdiction?: string;
  registrationType?: string;
  corporationClass?: string;
  assumedName?: string;
  registrationNumber?: string;
  nuansNumber?: string;
  registrationDate?: string;
  activityCommencementDate?: string;
  deRegistrationDate?: string;
  annualReturnDueDate?: string;
  lastAnnualReturnFiledDate?: string;
  agentForServiceName?: string;
  agentForServiceAddress?: string;
  principalOfficeAddress?: string;
  companyKeyVaultItemId?: string;
  status?: string;
  representativeIds?: string[];
};

export type IdentifierRow = {
  _id: string;
  kind?: string;
  number?: string;
  accessLevel?: string;
  foreignJurisdiction?: string;
  jurisdiction?: string;
  registeredAt?: string;
  status?: string;
};

/** What `organizationDetails.overview` returns. */
export type OrganizationDetail = {
  addresses: AddressRow[];
  registrations: RegistrationRow[];
  identifiers: IdentifierRow[];
};

/** A document as the profile's pickers list it. */
export type ProfileDocument = { _id: string; title?: string; category?: string; createdAtISO?: string; fileName?: string; archivedAtISO?: string };
