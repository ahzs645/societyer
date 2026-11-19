/**
 * Types for reading Corporations Canada and BC Registries documents into a
 * reviewable import proposal. Pure data: no runtime imports.
 *
 * Privacy rules the types encode:
 * - A corporation key is a password. It lives only in `RegistrySecret.reveal()`
 *   (a closure, so it never appears in `JSON.stringify`, logs or previews) and
 *   in the `corporationKey` apply argument the UI sends straight to the vault.
 * - Initial ISC filings yield names, a count and the received date only. Dates
 *   of birth, addresses, citizenship and tax residence are never read into
 *   these objects.
 */

/** One logical part of a registry document. A single PDF can hold several. */
export type RegistrySectionKind =
  | "federal_certificate_of_incorporation"
  | "federal_articles_of_incorporation"
  | "federal_initial_office_and_directors"
  | "federal_corporation_information_sheet"
  | "federal_initial_isc"
  | "federal_incorporated_email"
  | "federal_incorporation_email"
  | "federal_payment_email"
  | "federal_access_updated_email"
  | "bc_statement_of_registration"
  | "bc_certificate_of_registration"
  | "bc_filing_receipt"
  | "bc_cover_sheet";

/** What a whole file is. Packages (certificate with articles, BC cover sheet with statement) take their lead section's kind. */
export type RegistryDocumentKind = RegistrySectionKind | "unknown";

/** Document categories, from `KNOWN_DOCUMENT_CATEGORIES` in shared/documentCategories.ts. */
export type RegistryDocumentCategory = "CertificateOfIncorporation" | "ArticlesOfIncorporation" | "Filing" | "Receipt" | "Correspondence" | "Other";

export type RegistrySection = {
  kind: RegistrySectionKind;
  /** 0–1: how many of the kind's signals the text carries. */
  confidence: number;
  /** 1-based pages the section covers (always [1] for email). */
  pages: number[];
  /** Hash of the section's key facts; equal signatures mean the same content in a different copy. */
  signature: string;
};

export type RegistryClassification = {
  kind: RegistryDocumentKind;
  confidence: number;
  sections: Array<Omit<RegistrySection, "signature">>;
};

/** A fact plus the text it was read from. Snippets never contain secrets or ISC personal data. */
export type Sourced<T> = { value: T; snippet: string; section: RegistrySectionKind };

export type RegistryAddress = {
  street: string;
  unit?: string;
  city: string;
  provinceState?: string;
  postalCode?: string;
  country: string;
};

export type RegistryDirector = {
  name: string;
  /** From Form 2's "Resident Canadian" column; undefined when the column could not be read. */
  residentCanadian?: boolean;
};

export type AttorneyStatus = "required" | "not_required" | "appointed";

export type RegistryAttorneyFact = { status: AttorneyStatus; reason?: string; names?: string[] };

/** A registry fee or payment. Card numbers, card types and authorization codes are never read. */
export type RegistryFeeFact = {
  payee: string;
  description: string;
  /** Decimal string, e.g. "200.00". */
  amount: string;
  currency: "CAD";
  date?: string;
  reference?: string;
  invoiceNumber?: string;
  transactionId?: string;
  breakdown?: Array<{ label: string; amount: string }>;
};

export type RegistryPortalAccessFact = {
  organizationName?: string;
  portal: string;
  updatedAtISO?: string;
  notes?: string;
};

export type RegistryFacts = {
  legalName?: Sourced<string>;
  /** Federal corporation number as printed, "1234567-8". */
  corporationNumber?: Sourced<string>;
  incorporationDate?: Sourced<string>;
  /** `actFormedUnder` option value, e.g. "canada_business_corporations_act". */
  actFormedUnder?: Sourced<string>;
  /** Stored jurisdiction code, e.g. "CA-FED-CBCA". */
  jurisdictionCode?: Sourced<string>;
  registeredOfficeProvince?: Sourced<string>;
  shareClasses?: Sourced<string>;
  shareTransferRestrictions?: Sourced<string>;
  minDirectors?: Sourced<number>;
  maxDirectors?: Sourced<number>;
  businessRestrictions?: Sourced<string>;
  otherProvisions?: Sourced<string>;
  incorporators?: Sourced<string[]>;
  registeredOfficeAddress?: Sourced<RegistryAddress>;
  directors?: Sourced<RegistryDirector[]>;
  /** "MM-DD". */
  anniversaryMonthDay?: Sourced<string>;
  annualReturnWindow?: Sourced<{ start: string; end: string; firstYear?: number }>;
  iscReceivedDate?: Sourced<string>;
  iscIndividualNames?: Sourced<string[]>;
  /** Nine digits. */
  businessNumber?: Sourced<string>;
  /** CRA program accounts, e.g. ["RC0001"]. */
  programAccounts?: Sourced<string[]>;
  enclosedDocuments?: Sourced<string[]>;
  reminderEmailsSubscribed?: Sourced<boolean>;
  publicRecordUrl?: Sourced<string>;
  /** The mailbox a registry email went to. */
  notificationEmail?: Sourced<string>;
  emailDateISO?: Sourced<string>;
  payment?: Sourced<RegistryFeeFact>;
  portalAccess?: Sourced<RegistryPortalAccessFact>;
  bcRegistrationNumber?: Sourced<string>;
  bcRegistrationDate?: Sourced<string>;
  /** "HH:mm", registry local time. */
  bcRegistrationTime?: Sourced<string>;
  bcRegistrationTimeZone?: Sourced<string>;
  nameInHomeJurisdiction?: Sourced<string>;
  /** Home number without punctuation, e.g. "12345678". */
  homeCorporationNumber?: Sourced<string>;
  homeIncorporationDate?: Sourced<string>;
  homeJurisdictionCode?: Sourced<string>;
  headOfficeMailing?: Sourced<RegistryAddress>;
  headOfficeDelivery?: Sourced<RegistryAddress>;
  attorney?: Sourced<RegistryAttorneyFact>;
  filingReceipt?: Sourced<RegistryFeeFact>;
  packageContents?: Sourced<string[]>;
  /** The registry stamped this copy "DUPLICATE". */
  duplicateCopy?: Sourced<boolean>;
};

export type RegistrySecretKind = "corporation_key";

/** A secret found in a document. `reveal()` is the only way to read it; it never serialises. */
export type RegistrySecret = {
  kind: RegistrySecretKind;
  label: string;
  /** Always a fixed mask; carries no characters of the secret. */
  masked: string;
  reveal: () => string;
};

export type ParsedRegistryDocument = {
  fileName?: string;
  kind: RegistryDocumentKind;
  confidence: number;
  sections: RegistrySection[];
  facts: RegistryFacts;
  secrets: RegistrySecret[];
  suggestedTitle: string;
  suggestedCategory: RegistryDocumentCategory;
  /** Holds restricted data (corporation key, ISC personal data): store with restricted access. */
  restricted: boolean;
  /** Hash of the normalized text (secrets removed first): equal fingerprints are the same document. */
  fingerprint: string;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Proposal

export type RegistryProposalGroupKey = "identity" | "articles" | "registrations" | "addresses" | "tax";

export type RegistryProfileField =
  | "name"
  | "incorporationNumber"
  | "incorporationDate"
  | "anniversaryDate"
  | "actFormedUnder"
  | "jurisdictionCode"
  | "articlesMinDirectors"
  | "articlesMaxDirectors"
  | "articlesShareTransferRestrictions"
  | "articlesBusinessRestrictions"
  | "articlesOtherProvisions"
  | "craBnStatus"
  | "craRcStatus"
  | "officialEmail";

/** "home" is the federal registration; "bc" the BC extra-provincial registration. */
export type RegistryRegistrationKey = "home" | "bc";

export type RegistryRegistrationField =
  | "registrationNumber"
  | "registrationDate"
  | "registrationTime"
  | "homeCorporationNumber"
  | "nameInHomeJurisdiction"
  | "attorneyStatus"
  | "reminderEmailsSubscribed"
  | "publicRecordUrl"
  | "portalAccess";

export type RegistryAddressType = "registered_office" | "head_office_mailing" | "head_office_delivery";
export type RegistryIdentifierKind = "business_number" | "income_tax";

export type RegistryProposalTarget =
  | { scope: "profile"; field: RegistryProfileField }
  | { scope: "registration"; registration: RegistryRegistrationKey; field: RegistryRegistrationField }
  | { scope: "address"; addressType: RegistryAddressType }
  | { scope: "identifier"; identifierKind: RegistryIdentifierKind }
  /** Shown for review only; never applied. */
  | { scope: "info" };

export type PortalAccessHint = { role?: string; updatedAtISO?: string; notes?: string };

export type RegistryProposalValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "address"; value: RegistryAddress }
  | { kind: "time"; value: { time: string; timeZone: string } }
  | { kind: "attorney"; value: { status: AttorneyStatus; reason?: string } }
  /** The person is the mailbox owner; the UI supplies the name. */
  | { kind: "portalAccess"; value: PortalAccessHint };

export type RegistryProposalSource = { fingerprint: string; fileName?: string; title: string; snippet: string };

export type RegistryProposalOption = { value: RegistryProposalValue; display: string; sources: RegistryProposalSource[] };

export type RegistryProposalField = {
  /** Stable id used as the selection key, e.g. "profile.name", "registration.bc.registrationNumber". */
  id: string;
  group: RegistryProposalGroupKey;
  label: string;
  target: RegistryProposalTarget;
  proposed: RegistryProposalValue;
  display: string;
  current?: RegistryProposalValue;
  currentDisplay?: string;
  sources: RegistryProposalSource[];
  /** Set when documents disagree. `options[0]` is the proposed value. */
  conflict?: { note: string; options: RegistryProposalOption[] };
  /** Address `effectiveFrom` or identifier `registeredAt`, when the documents date it. */
  effectiveDate?: string;
  /** The stored row `current` was read from; applying patches that row (registrations, identifiers). */
  currentId?: string;
  /** Why a value is shown but not applied, or not selected by default. */
  note?: string;
  equalsCurrent: boolean;
  /** A current value exists and differs: applying replaces it. */
  replacesCurrent: boolean;
  selectedByDefault: boolean;
};

export type RegistryProposalGroup = { key: RegistryProposalGroupKey; label: string; fields: RegistryProposalField[] };

export type RegistryNameVariance = {
  /** "director" or "corporate name". */
  subject: "director" | "corporate_name";
  preferred: string;
  other: string;
  preferredSource: RegistryProposalSource;
  otherSource: RegistryProposalSource;
};

export type RegistryDirectorsCheck = {
  directors: RegistryDirector[];
  residentCount: number;
  total: number;
  /** CBCA: at least 25% resident Canadians, and at least one when there are fewer than four directors. */
  meetsResidencyRule: boolean;
  note: string;
  sources: RegistryProposalSource[];
  /** Names on file today versus the document (comparison only; directors are never written). */
  comparison: Array<{ name: string; inRegister: boolean }>;
  nameVariances: RegistryNameVariance[];
};

export type RegistryIscSummary = {
  receivedDate?: string;
  names: string[];
  count: number;
  sources: RegistryProposalSource[];
  /** Restricted personal data stays in the ISC register. */
  registerPath: "/app/significant-individuals";
};

export type RegistryDocumentStatus = "primary" | "duplicate" | "contained" | "superseded";

export type RegistryDocumentEntry = {
  fingerprint: string;
  fileName?: string;
  kind: RegistryDocumentKind;
  suggestedTitle: string;
  suggestedCategory: RegistryDocumentCategory;
  restricted: boolean;
  status: RegistryDocumentStatus;
  /** Fingerprint of the file this one duplicates, is contained in, or is superseded by. */
  relatedFingerprint?: string;
  note?: string;
  selectedByDefault: boolean;
};

export type RegistryFeeEntry = RegistryFeeFact & { sources: RegistryProposalSource[] };

export type RegistryProposalSecret = {
  /** Selection key: "secret.corporation_key". */
  id: string;
  kind: RegistrySecretKind;
  label: string;
  masked: string;
  sources: RegistryProposalSource[];
  /** The organization already has a key in the vault. */
  hasCurrent: boolean;
  selectedByDefault: boolean;
  reveal: () => string;
};

/** The registration rows the proposal can write, with the keys `applyRegistryImport` matches on. */
export type RegistryRegistrationTarget = {
  key: RegistryRegistrationKey;
  /** The stored registration the proposal compared against; applying patches it. */
  existingId?: string;
  label: string;
  registrationType: "home" | "extra_provincial";
  jurisdiction: string;
  homeJurisdiction?: string;
};

export type RegistryImportProposal = {
  groups: RegistryProposalGroup[];
  registrationTargets: RegistryRegistrationTarget[];
  /** Fingerprints of the files that back document links (certificate, articles). */
  documentRoles: { federalCertificate?: string; articles?: string; bcCertificate?: string };
  directorsCheck?: RegistryDirectorsCheck;
  isc?: RegistryIscSummary;
  documents: RegistryDocumentEntry[];
  fees: RegistryFeeEntry[];
  secrets: RegistryProposalSecret[];
  /** Plain-language conflicts for the review header (fields and name variances). */
  conflicts: string[];
  warnings: string[];
};

/** What the organization holds today, for comparison. Every part is optional. */
export type CurrentProfileSnapshot = {
  profile?: Partial<Record<RegistryProfileField, string | number | null>>;
  /** "preparing" or "submitted": the number and date are left to Record incorporation. */
  formationStatus?: string | null;
  registrations?: Array<{
    id?: string;
    registrationType?: string | null;
    jurisdiction?: string | null;
    homeJurisdiction?: string | null;
    registrationNumber?: string | null;
    registrationDate?: string | null;
    registrationTime?: string | null;
    registrationTimeZone?: string | null;
    homeCorporationNumber?: string | null;
    nameInHomeJurisdiction?: string | null;
    attorneyStatus?: string | null;
    attorneyNotRequiredReason?: string | null;
    reminderEmailsSubscribed?: boolean | null;
    publicRecordUrl?: string | null;
    portalAccess?: Array<{ name: string; role?: string; updatedAtISO?: string; notes?: string }> | null;
  }>;
  addresses?: Array<{ type: string; status?: string | null; effectiveFrom?: string | null; street: string; unit?: string | null; city: string; provinceState?: string | null; postalCode?: string | null; country?: string | null }>;
  identifiers?: Array<{ id?: string; kind: string; number: string }>;
  directors?: Array<{ name: string; residentCanadianStatus?: string | null }>;
  hasCorporationKey?: boolean;
};

/** Which proposal items to apply. Keys are field and secret ids. */
export type RegistryImportSelection = {
  selected: Record<string, boolean>;
  /** For a conflicting field, the index into `conflict.options` the reviewer picked (default 0). */
  choices?: Record<string, number>;
  /** Name for the Online Filing Centre access hint (the mailbox owner). Without it the hint is skipped. */
  portalAccessName?: string;
};

// ---------------------------------------------------------------------------
// Apply arguments: one to one with organizationDetails.applyRegistryImport.

export type RegistryImportProfileArgs<DocId extends string = string> = {
  name?: string;
  incorporationNumber?: string;
  incorporationDate?: string;
  anniversaryDate?: string;
  actFormedUnder?: string;
  jurisdictionCode?: string;
  articlesMinDirectors?: number;
  articlesMaxDirectors?: number;
  articlesShareTransferRestrictions?: string;
  articlesBusinessRestrictions?: string;
  articlesOtherProvisions?: string;
  articlesSourceDocumentId?: DocId;
  craBnStatus?: string;
  craRcStatus?: string;
  officialEmail?: string;
};

export type RegistryImportRegistrationArgs<DocId extends string = string> = {
  /** The stored registration to patch (the one the review compared against). */
  id?: string;
  registrationType: "home" | "extra_provincial";
  jurisdiction: string;
  homeJurisdiction?: string;
  registrationNumber?: string;
  registrationDate?: string;
  registrationTime?: string;
  registrationTimeZone?: string;
  homeCorporationNumber?: string;
  nameInHomeJurisdiction?: string;
  attorneyStatus?: AttorneyStatus;
  attorneyNotRequiredReason?: string;
  reminderEmailsSubscribed?: boolean;
  publicRecordUrl?: string;
  portalAccess?: Array<{ name: string; role?: string; updatedAtISO?: string; notes?: string }>;
  certificateDocumentId?: DocId;
  sourceDocumentIds?: DocId[];
  status: string;
};

export type RegistryImportAddressArgs<DocId extends string = string> = {
  type: RegistryAddressType;
  status: string;
  street: string;
  unit?: string;
  city: string;
  provinceState?: string;
  postalCode?: string;
  country: string;
  effectiveFrom?: string;
  sourceDocumentIds?: DocId[];
};

export type RegistryImportIdentifierArgs<DocId extends string = string> = {
  /** The stored identifier to patch (the one the review compared against). */
  id?: string;
  kind: RegistryIdentifierKind;
  number: string;
  jurisdiction?: string;
  registeredAt?: string;
  status: string;
  accessLevel: string;
  sourceDocumentIds?: DocId[];
};

/** Exactly the args of `organizationDetails.applyRegistryImport` (minus `societyId`). */
export type RegistryImportApplyArgs<DocId extends string = string> = {
  profile?: RegistryImportProfileArgs<DocId>;
  registrations?: RegistryImportRegistrationArgs<DocId>[];
  addresses?: RegistryImportAddressArgs<DocId>[];
  identifiers?: RegistryImportIdentifierArgs<DocId>[];
  corporationKey?: { value: string; label: string };
};

/** Where an uploaded file's document id goes once phase 2 knows it. */
export type RegistryDocumentRefTarget =
  | { target: "profile.articlesSourceDocumentId" }
  | { target: "registration.certificateDocumentId"; registrationIndex: number }
  | { target: "registration.sourceDocumentIds"; registrationIndex: number }
  | { target: "address.sourceDocumentIds"; addressIndex: number }
  | { target: "identifier.sourceDocumentIds"; identifierIndex: number };

/** Keyed by file fingerprint. */
export type RegistryDocumentRefs = Record<string, RegistryDocumentRefTarget[]>;

export type RegistryApplyPlan = {
  /** Send these (plus `societyId`) after `withRegistryDocumentIds` fills in document ids. */
  args: RegistryImportApplyArgs<never>;
  documentRefs: RegistryDocumentRefs;
};
