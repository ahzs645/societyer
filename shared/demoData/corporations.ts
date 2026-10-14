/**
 * Deterministic demo workspaces for the three business-corporation personas:
 * Cedar Demo Holdings Ltd. (BC company), Maple Demo Federal Inc. (CBCA) and
 * Lakeshore Demo Ontario Inc. (OBCA). Each story (corporationStories.ts) is
 * turned into rows for the same tables the app reads: role holders, share
 * classes, the securities ledger with its certificates and holdings, signed
 * written resolutions, dividends, the transparency/ISC register, filings,
 * deadlines, a minute book, documents, agreements and light finance.
 *
 * Coherence comes from building, not from hand-typed totals:
 *  - certificates are issued and cancelled by replaying the ledger;
 *  - holdings are materialized with the ledger helper (`materializeRightsHoldings`);
 *  - dividend entitlements use `dividendEntitlements` on `holdingsAsOf`;
 *  - resolution electorates come from the register on the circulation date and
 *    their thresholds from the legal profile (`writtenResolutionRule`);
 *  - annual cycles, filings and deadlines come from the profile through
 *    `deriveComplianceDeadlines` / `annualGovernanceSettings`.
 * scripts/check-corporation-demo.ts checks the result with the app's own
 * validators. Pure TypeScript and no Math.random: the same `asOf` always gives
 * the same rows. History is fixed; the yearly cycle runs up to `asOf`.
 */
import { todayDateOnly } from "../dateOnly";
import { holdingsAsOf, materializeRightsHoldings, type RightsholdingTransferRecord } from "../equityLedger";
import { dividendEntitlements } from "../dividends";
import { legalGovernanceProfile, requiredWrittenConsents, writtenResolutionRule } from "../legalGovernanceProfiles";
import { resolutionTimeZone } from "../writtenResolutionEvidence";
import {
  addCalendarMonths,
  addComplianceDays,
  addFiscalFilingMonths,
  complianceDeadlineSourceKey,
  deriveComplianceDeadlines,
} from "../corporationSettings";
import { annualGovernanceSettings } from "../annualGovernanceEvidence";
import { transparencyEventsFromSteps } from "../significantIndividuals";
import { normalizeSearchName } from "../peopleDirectory";
import { complianceFactsForOrganization, computeComplianceObligations } from "../../src/lib/compliance";
import { addDays, createRng, dayOfMonth, demoAsOfDate, monthKeys, nextBusinessDay } from "./prng";
import { CORPORATION_DEMO_IDENTITIES, type CorporationDemoKey } from "./corporationIdentities";
import { CORPORATION_STORIES, type CorporationStory, type DemoPersonSpec, type DemoResolutionSpec } from "./corporationStories";

export { CORPORATION_DEMO_KEYS, CORPORATION_DEMO_IDENTITIES, corporationDemoSocietyId, isCorporationDemoKey, type CorporationDemoKey } from "./corporationIdentities";
export { CORPORATION_STORIES } from "./corporationStories";

/** The stories are written as of this date; a later clock moves the yearly cycle forward. */
export const CORPORATION_DEMO_STORY_DATE = "2026-10-01";

export type DemoRow = Record<string, any> & { _id: string };
export type CorporationDemoTables = Record<string, DemoRow[]>;

export type CorporationDemo = {
  key: CorporationDemoKey;
  asOf: string;
  societyId: string;
  ownerUserId: string;
  society: DemoRow;
  /** Every table except `societies`. */
  tables: CorporationDemoTables;
};

export type CorporationDemoOptions = {
  /** The demo's "today" (YYYY-MM-DD). Defaults to the story date or the real date, whichever is later. */
  asOf?: string;
  /** Maps a local row key to a row id. Defaults to `<idPrefix>_<key>`. */
  idFor?: (localKey: string) => string;
};

/**
 * Tables in an order where every row only points at rows of earlier tables,
 * apart from the few back-references (the society's own pointers, a meeting's
 * minutes) that `insertCorporationDemo` patches in afterwards.
 */
export const CORPORATION_DEMO_TABLE_ORDER = [
  "users",
  "peopleDirectory",
  "documents",
  "documentVersions",
  "organizationRegistrations",
  "organizationAddresses",
  "organizationIdentifiers",
  "societyNameHistory",
  "constatingEvents",
  "serviceProviders",
  "recordsLocation",
  "directors",
  "roleHolders",
  "rightsClasses",
  "writtenResolutions",
  "rightsholdingTransfers",
  "rightsHoldings",
  "shareCertificates",
  "dividends",
  "significantIndividualSteps",
  "filings",
  "annualFilingLedger",
  "complianceRemediations",
  "auditorAppointments",
  "agreements",
  "insurancePolicies",
  "meetings",
  "meetingMaterials",
  "minutes",
  "archiveAccessions",
  "minuteBookItems",
  "deadlines",
  "tasks",
  "financials",
  "financialConnections",
  "financialAccounts",
  "financialTransactions",
  "budgets",
  "activity",
] as const;

const at = (date: string, hour = 17, minute = 0) => `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
const yearOf = (date: string) => Number(date.slice(0, 4));
const md = (year: number, monthDay: string) => `${year}-${monthDay}`;
const fullName = (person: Pick<DemoPersonSpec, "firstName" | "lastName">) => `${person.firstName} ${person.lastName}`;
const formatShares = (value: number) => value.toLocaleString("en-CA");
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Weekend dates move back to the Friday before (resolutions are signed on business days). */
function businessDayOnOrBefore(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 6 ? addDays(date, -1) : day === 0 ? addDays(date, -2) : date;
}

/** Build one corporation demo workspace. */
export function buildCorporationDemo(key: CorporationDemoKey, options: CorporationDemoOptions = {}): CorporationDemo {
  const identity = CORPORATION_DEMO_IDENTITIES[key];
  const story: CorporationStory = CORPORATION_STORIES[key];
  const asOf = options.asOf ?? demoAsOfDate(CORPORATION_DEMO_STORY_DATE, todayDateOnly());
  /** Generated activity stops two days before "today", so nothing is recorded in the future in any time zone. */
  const cutoff = addDays(asOf, -2);
  const id = options.idFor ?? ((local: string) => `${identity.idPrefix}_${local}`);
  const societyId = id("society");
  const tables: CorporationDemoTables = {};
  const add = (table: string, row: DemoRow) => {
    (tables[table] ??= []).push(row);
    return row._id;
  };
  const createdAt = (date: string) => at(date, 18);

  const people = new Map(story.people.map((person) => [person.key, person]));
  const entities = new Map(story.entities.map((entity) => [entity.key, entity]));
  const person = (personKey: string) => {
    const found = people.get(personKey);
    if (!found) throw new Error(`Unknown person ${personKey} in the ${key} story.`);
    return found;
  };
  const holderName = (holderKey: string) => (people.has(holderKey) ? fullName(person(holderKey)) : entities.get(holderKey)?.name ?? holderKey);

  // ------------------------------------------------------------- organization
  const officeAddress = `${story.registeredOffice.street}, ${story.registeredOffice.city}, ${story.registeredOffice.province} ${story.registeredOffice.postalCode}`;
  const homeRegistrationId = id("registration_home");
  const certificateDocId = id("doc_certificate");
  const organization: DemoRow = {
    _id: societyId,
    name: identity.name,
    shortName: story.shortName,
    incorporationNumber: identity.incorporationNumber,
    incorporationDate: identity.incorporationDate,
    anniversaryDate: identity.incorporationDate,
    fiscalYearEnd: identity.fiscalYearEnd,
    jurisdictionCode: identity.jurisdictionCode,
    homeJurisdictionCode: identity.jurisdictionCode,
    primaryRegistrationId: homeRegistrationId,
    entityType: "corporation__business_",
    ...(identity.legalSubtype ? { legalSubtype: identity.legalSubtype } : {}),
    actFormedUnder: identity.actFormedUnder,
    formationStatus: "incorporated",
    certificateEvidenceDocumentId: certificateDocId,
    certificateReference: `Certificate of incorporation ${identity.incorporationNumber}`,
    certificateDate: identity.incorporationDate,
    organizationStatus: "active",
    officialEmail: story.officialEmail,
    numbered: false,
    distributing: false,
    craBnStatus: "registered",
    gstHstStatus: "registered",
    payrollStatus: key === "bc_company" ? "not_required" : "registered",
    charityStatus: "not_applicable",
    isCharity: false,
    isMemberFunded: false,
    registeredOfficeAddress: officeAddress,
    mailingAddress: story.mailingAddress,
    naicsCode: story.naicsCode,
    privacyOfficerName: fullName(person(story.people.find((row) => row.user === "Owner")!.key)),
    privacyOfficerEmail: story.officialEmail,
    privacyProgramStatus: "Documented",
    privacyProgramReviewedAtISO: at(addDays(asOf, -60)),
    privacyProgramNotes: key === "bc_company" ? "Privacy policy under BC PIPA; the Secretary is the privacy officer." : "Privacy policy under PIPEDA for commercial handling in Ontario; the corporate secretary is the privacy officer.",
    privacyPolicyDocId: id("doc_privacy_policy"),
    privacyOperatingJurisdictions: [key === "bc_company" ? "CA-BC" : "CA-ON"],
    privacyCommercialActivity: "yes",
    privacyFederalWork: "no",
    privacyCrossBorderCommercial: "no",
    privacyQuebecEnterprise: "no",
    privacySectorSpecific: "none",
    privacyScopeReviewedAtISO: at(addDays(asOf, -60)),
    constitutionDocId: id(story.documents.some((doc) => doc.key === "incorporation_agreement") ? "doc_incorporation_agreement" : "doc_articles"),
    ...(story.documents.some((doc) => doc.key === "bylaw") ? { bylawsDocId: id("doc_bylaw") } : {}),
    boardCadence: "Quarterly",
    minuteBookLocation: story.recordsOfficeNote,
    primaryContactName: fullName(person(story.people.find((row) => row.user === "Owner")!.key)),
    primaryContactEmail: story.officialEmail,
    responsibleLawyer: story.serviceProviders.find((row) => row.fn === "lawyer")?.contactName,
    docPrepLanguage: "en",
    includeDocumentIdHeader: true,
    demoMode: true,
    updatedAt: Date.parse(at(cutoff)),
  };
  if (key === "bc_company") {
    organization.operativeArticles = {
      base: "bc_table_1",
      table1Version: "am_186_2007",
      table1Incorporation: "by_reference",
      adoptedOn: identity.incorporationDate,
      customParts: story.classes.filter((cls) => cls.articlesPart).map((cls) => ({ part: cls.articlesPart!, title: `Special rights and restrictions attached to the ${cls.plural}` })),
      transferConsentRequired: true,
      directorIndemnity: "permissive",
      officerIndemnity: "permissive",
      sourceDocumentId: id("doc_incorporation_agreement"),
      notes: "Table 1 as in force on February 1, 2019, adopted by reference in the incorporation agreement, with Parts 24 and 25 added for the Class B and Class C shares.",
      recordedAtISO: createdAt("2019-02-04"),
    };
  }

  // -------------------------------------------------------------------- users
  const userIds = new Map<string, string>();
  for (const row of story.people.filter((candidate) => candidate.user)) {
    const userId = id(`user_${row.key}`);
    userIds.set(row.key, userId);
    add("users", { _id: userId, societyId, email: row.email, displayName: fullName(row), role: row.user!, status: "Active", createdAtISO: createdAt(identity.incorporationDate) });
  }
  const ownerKey = story.people.find((row) => row.user === "Owner")!.key;
  const ownerUserId = userIds.get(ownerKey)!;

  // ---------------------------------------------------------------- documents
  const privacyLaw = key === "bc_company" ? "the Personal Information Protection Act (British Columbia)" : "the Personal Information Protection and Electronic Documents Act (Canada)";
  const documents = [...story.documents, {
    key: "privacy_policy", title: `Privacy policy (${key === "bc_company" ? "BC PIPA" : "PIPEDA"})`, category: "privacy", date: addDays(asOf, -60 - 365), fileName: "privacy-policy.pdf", tags: ["policy", "privacy"],
    content: `How ${identity.name} collects, uses and discloses personal information about customers, tenants, employees and shareholders under ${privacyLaw}, and how to reach its privacy officer. Reviewed annually. (Fictional demo record.)`,
  }];
  for (const doc of documents) {
    add("documents", {
      _id: id(`doc_${doc.key}`), societyId, title: doc.title, category: doc.category, fileName: doc.fileName, mimeType: "application/pdf",
      content: doc.content, createdAtISO: createdAt(doc.date), flaggedForDeletion: false, tags: [...doc.tags, "demo"],
      reviewStatus: "reviewed", retentionYears: doc.retentionYears, librarySection: "minute_book",
    });
    if (doc.uploaded) {
      add("documentVersions", {
        _id: id(`docv_${doc.key}`), societyId, documentId: id(`doc_${doc.key}`), version: 1, storageProvider: "local",
        storageKey: `demo-fixtures/${identity.idPrefix}/${doc.fileName}`, fileName: doc.fileName, mimeType: "application/pdf", fileSizeBytes: 48_213,
        uploadedAtISO: createdAt(addDays(doc.date, 3)), uploadedByName: holderName(ownerKey), changeNote: "Scanned from the minute book.", isCurrent: true,
      });
    }
  }
  const docId = (docKey?: string) => (docKey ? id(`doc_${docKey}`) : undefined);

  // ------------------------------------------------------ identity & history
  add("organizationRegistrations", {
    _id: homeRegistrationId, societyId, registrationType: "home", jurisdiction: identity.jurisdictionCode, homeJurisdiction: identity.jurisdictionCode,
    registrationNumber: identity.incorporationNumber, registrationDate: identity.incorporationDate, officialEmail: story.officialEmail,
    registryPortalKey: key === "bc_company" ? "bc_registries" : key === "federal_cbca" ? "corporations_canada" : "ontario_business_registry",
    representativeIds: [], status: "active", sourceDocumentIds: [certificateDocId], notes: `Home registration with ${story.registryLabel}.`,
    createdAtISO: createdAt(identity.incorporationDate), updatedAtISO: createdAt(identity.incorporationDate),
  });
  for (const type of key === "bc_company" ? ["registered_office", "records_office"] : ["registered_office"]) {
    add("organizationAddresses", {
      _id: id(`address_${type}`), societyId, type, status: "current", effectiveFrom: identity.incorporationDate,
      street: story.registeredOffice.street, city: story.registeredOffice.city, provinceState: story.registeredOffice.province,
      postalCode: story.registeredOffice.postalCode, country: "CA", notes: type === "records_office" ? story.recordsOfficeNote : undefined,
      createdAtISO: createdAt(identity.incorporationDate), updatedAtISO: createdAt(identity.incorporationDate),
    });
  }
  add("organizationIdentifiers", {
    _id: id("identifier_bn"), societyId, kind: "business_number", number: story.businessNumber, jurisdiction: "CA", status: "active", accessLevel: "internal",
    registeredAt: addDays(identity.incorporationDate, 14), notes: "CRA business number with the RC corporate income tax account. (Fictional.)",
    createdAtISO: createdAt(addDays(identity.incorporationDate, 14)), updatedAtISO: createdAt(addDays(identity.incorporationDate, 14)),
  });
  if (story.formerName) {
    add("societyNameHistory", { _id: id("name_former"), societyId, name: story.formerName.name, startISO: identity.incorporationDate, endISO: addDays(story.formerName.endDate, -1), sourceDocumentIds: [certificateDocId], regPosn: 1, createdAtISO: createdAt(identity.incorporationDate) });
  }
  add("societyNameHistory", { _id: id("name_current"), societyId, name: identity.name, shortName: story.shortName, startISO: story.formerName?.endDate ?? identity.incorporationDate, sourceDocumentIds: [certificateDocId], regPosn: story.formerName ? 2 : 1, createdAtISO: createdAt(story.formerName?.endDate ?? identity.incorporationDate) });
  add("constatingEvents", {
    _id: id("constating_incorporated"), societyId, action: "incorporated", jurisdiction: identity.jurisdictionCode, legislation: story.legislationLabel,
    regNumber: identity.incorporationNumber, startISO: identity.incorporationDate,
    sourceDocumentIds: [certificateDocId, ...(story.documents.some((doc) => doc.key === "incorporation_agreement") ? [id("doc_incorporation_agreement")] : []), ...(story.documents.some((doc) => doc.key === "articles") ? [id("doc_articles")] : [])],
    createdAtISO: createdAt(identity.incorporationDate),
  });
  if (story.documents.some((doc) => doc.key === "amendment")) {
    add("constatingEvents", { _id: id("constating_amended"), societyId, action: "restated", jurisdiction: identity.jurisdictionCode, legislation: story.legislationLabel, regNumber: identity.incorporationNumber, startISO: "2023-06-21", sourceDocumentIds: [id("doc_amendment")], createdAtISO: createdAt("2023-06-21") });
  }
  for (const provider of story.serviceProviders) {
    add("serviceProviders", { _id: id(`provider_${provider.key}`), societyId, function: provider.fn, firmName: provider.firmName, contactName: provider.contactName, firmLocation: provider.firmLocation, appointedOn: provider.appointedOn, createdAtISO: createdAt(provider.appointedOn), updatedAtISO: createdAt(provider.appointedOn) });
  }
  add("recordsLocation", { _id: id("records_location"), societyId, address: officeAddress, noticePostedAtOffice: false, computerProvidedForInspection: true, notes: story.recordsOfficeNote });

  // ------------------------------------------------------------------- people
  const personId = (personKey: string) => id(`person_${personKey}`);
  for (const row of story.people) {
    add("peopleDirectory", {
      _id: personId(row.key), societyId, fullName: fullName(row), searchName: normalizeSearchName(fullName(row)), firstName: row.firstName, lastName: row.lastName,
      dob: row.dateOfBirth, isIndividual: true, defaultAddress: `${row.street}, ${row.city}, ${row.province} ${row.postalCode}`, atAgeOfMajority: true,
      gender: row.gender, pronouns: row.pronouns, identityReviewStatus: "reviewed", createdAtISO: createdAt(identity.incorporationDate), updatedAtISO: createdAt(identity.incorporationDate),
    });
  }
  for (const entity of story.entities) {
    add("peopleDirectory", {
      _id: personId(entity.key), societyId, fullName: entity.name, searchName: normalizeSearchName(entity.name), isIndividual: false,
      defaultAddress: `${entity.street}, ${entity.city}, ${entity.province} ${entity.postalCode}`, corpSign: "By:", identityReviewStatus: "reviewed",
      createdAtISO: createdAt(identity.incorporationDate), updatedAtISO: createdAt(identity.incorporationDate),
    });
  }
  const residency = (row: DemoPersonSpec) => row.residentCanadian
    ? row.canadianStatus === "citizen" ? "a_canadian_citizen_ordinarily_resident_in_canada" : "a_permanent_resident_within_the_meaning_of_the_immigration_and_refugee_protection_act__canada__and_ordinarily_resides_in_canada"
    : "not_a_canadian_citizen_and_not_a_permanent_resident_in_canada__as_defined_above_";
  const roleHolderBase = (row: DemoPersonSpec) => ({
    societyId, fullName: fullName(row), firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone,
    street: row.street, city: row.city, provinceState: row.province, postalCode: row.postalCode, country: row.country,
    ageOver18: true, dateOfBirth: row.dateOfBirth, occupation: row.occupation, citizenshipResidency: residency(row),
    citizenshipCountries: row.citizenshipCountries, taxResidenceCountries: row.taxResidenceCountries, canadianStatus: row.canadianStatus,
    nonNaturalPerson: false, gender: row.gender, pronouns: row.pronouns, directoryPersonId: personId(row.key),
    relatedShareholderIds: [] as string[], controllingIndividualIds: [] as string[], sourceDocumentIds: [] as string[], sourceExternalIds: [] as string[],
  });

  const directorIds = new Map<string, string>();
  for (const term of story.directors) {
    const row = person(term.person);
    const directorId = id(`director_${term.person}`);
    directorIds.set(term.person, directorId);
    const officer = story.officers.find((office) => office.person === term.person && !office.end);
    add("directors", {
      _id: directorId, societyId, directoryPersonId: personId(row.key), firstName: row.firstName, lastName: row.lastName, email: row.email,
      position: officer ? officeLabel(officer.title) : "Director", isBCResident: row.bcResident, residentCanadianStatus: row.residentCanadian ? "yes" : "no",
      residentCanadianEvidence: row.residentCanadian ? `${row.canadianStatus === "citizen" ? "Canadian citizen" : "Permanent resident"} ordinarily resident in ${row.province}; confirmed on the director's consent.` : `Resides in ${row.city}, ${row.country}; confirmed on the director's consent.`,
      termStart: term.start, termEnd: term.end, consentOnFile: true, resignedAt: term.end, status: term.end && term.end <= asOf ? "Resigned" : "Active", notes: term.endNote,
    });
    add("roleHolders", {
      _id: id(`rh_director_${term.person}`), ...roleHolderBase(row), roleType: "director", status: term.end && term.end <= asOf ? "former" : "current",
      startDate: term.start, endDate: term.end, directorTerm: "until_the_next_annual_general_meeting", signerTag: "director", notes: term.endNote,
      createdAtISO: createdAt(term.start), updatedAtISO: createdAt(term.end ?? term.start),
    });
  }
  for (const office of story.officers) {
    const row = person(office.person);
    add("roleHolders", {
      _id: id(`rh_officer_${office.person}_${office.title}`), ...roleHolderBase(row), roleType: "officer", status: office.end && office.end <= asOf ? "former" : "current",
      officerTitle: office.title, additionalOfficerTitles: office.additionalTitles, startDate: office.start, endDate: office.end, signerTag: `officer___${office.title}`,
      createdAtISO: createdAt(office.start), updatedAtISO: createdAt(office.end ?? office.start),
    });
  }

  // ------------------------------------------------------------ share classes
  const classId = (clsKey: string) => id(`class_${clsKey}`);
  const classes = new Map(story.classes.map((cls) => [cls.key, cls]));
  // Shareholder role holders: one per holder (individual or entity).
  const holderKeys = [...new Set(story.ledger.flatMap((event) => (event.kind === "transfer" ? [event.from, event.to] : event.kind === "issuance" ? [event.to] : [event.from])))];
  const shareholderId = (holderKey: string) => id(`rh_shareholder_${holderKey}`);
  const firstHolding = (holderKey: string) => story.ledger.filter((event) => (event.kind === "transfer" ? event.to === holderKey : event.kind === "issuance" && event.to === holderKey)).map((event) => event.date).sort()[0]!;

  // ------------------------------------------------------------------ ledger
  const transfers: Array<RightsholdingTransferRecord & { _id: string }> = [];
  const certificates: DemoRow[] = [];
  const nextCertificate = new Map<string, number>();
  const issueCertificate = (clsKey: string, holderKey: string, shares: number, date: string, replaces?: string) => {
    const cls = classes.get(clsKey)!;
    const number = (nextCertificate.get(clsKey) ?? 0) + 1;
    nextCertificate.set(clsKey, number);
    const certificateNumber = `${cls.idPrefix}-${number}`;
    certificates.push({
      _id: id(`certificate_${certificateNumber.toLowerCase()}`), societyId, certificateNumber, holderName: holderName(holderKey), shareClass: cls.className,
      shares, issuedOn: date, ...(replaces ? { replacesCertificateNumber: replaces } : {}), rightsClassId: classId(clsKey), holderRoleHolderId: shareholderId(holderKey),
      createdAtISO: createdAt(date),
    });
    return certificateNumber;
  };
  /** The holder's single active certificate for a class (the story keeps one per holder and class). */
  const activeCertificate = (clsKey: string, holderKey: string) => {
    const matches = certificates.filter((row) => row.rightsClassId === classId(clsKey) && row.holderRoleHolderId === shareholderId(holderKey) && !row.cancelledOn);
    if (matches.length !== 1) throw new Error(`${key}: expected one active ${clsKey} certificate for ${holderKey}, found ${matches.length}.`);
    return matches[0];
  };
  const resolutionId = (resKey: string) => id(`resolution_${resKey}`);
  for (const event of story.ledger) {
    const base = {
      _id: id(`ledger_${event.key}`), societyId, status: "posted", transferDate: event.date, rightsClassId: classId(event.cls), quantity: event.quantity,
      sequence: event.sequence, sourceDocumentIds: [] as string[], sourceExternalIds: [] as string[], createdAtISO: createdAt(event.date), updatedAtISO: createdAt(event.date),
    };
    if (event.kind === "issuance") {
      transfers.push({ ...base, transferType: "issuance", destinationRoleHolderId: shareholderId(event.to), considerationType: event.consideration, considerationDescription: event.considerationDescription,
        priceToOrganizationCents: event.totalCents, priceToOrganizationCurrency: "cad", fullyPaidConfirmedAt: event.date, notes: `Allotted by the directors' resolution of ${story.resolutions.find((res) => res.key === event.resolution)?.date ?? event.date}.` });
      const existing = certificates.find((row) => row.rightsClassId === classId(event.cls) && row.holderRoleHolderId === shareholderId(event.to) && !row.cancelledOn);
      if (existing) {
        // One certificate per holder and class: the new shares are consolidated on a replacement certificate.
        existing.cancelledOn = event.date;
        issueCertificate(event.cls, event.to, existing.shares + event.quantity, event.date);
      } else issueCertificate(event.cls, event.to, event.quantity, event.date);
    } else if (event.kind === "transfer") {
      transfers.push({ ...base, transferType: "transfer", sourceRoleHolderId: shareholderId(event.from), destinationRoleHolderId: shareholderId(event.to), considerationType: "cash",
        priceToVendorCents: event.priceToVendorCents, priceToVendorCurrency: "cad", directorConsentResolutionId: resolutionId(event.resolution) });
      const cancelled = activeCertificate(event.cls, event.from);
      cancelled.cancelledOn = event.date;
      issueCertificate(event.cls, event.to, event.quantity, event.date, cancelled.certificateNumber);
      if (cancelled.shares > event.quantity) issueCertificate(event.cls, event.from, cancelled.shares - event.quantity, event.date, cancelled.certificateNumber);
    } else {
      transfers.push({ ...base, transferType: "redemption", sourceRoleHolderId: shareholderId(event.from), priceToVendorCents: event.totalCents, priceToVendorCurrency: "cad",
        redemptionNoticeDate: event.noticeDate, solvencyConfirmedAt: event.solvencyDate, solvencyBasis: event.solvencyBasis,
        notes: `Redeemed under the class's redemption terms; notice given on ${event.noticeDate}.` });
      const cancelled = activeCertificate(event.cls, event.from);
      cancelled.cancelledOn = event.date;
      // The redeemed shares return to unissued capital, so the balance
      // certificate is a new certificate rather than a replacement.
      if (cancelled.shares > event.quantity) issueCertificate(event.cls, event.from, cancelled.shares - event.quantity, event.date);
    }
  }
  for (const transfer of transfers) add("rightsholdingTransfers", transfer as DemoRow);
  for (const certificate of certificates) add("shareCertificates", certificate);
  const highest = new Map(nextCertificate);
  for (const cls of story.classes) {
    add("rightsClasses", {
      _id: classId(cls.key), societyId, className: cls.className, classType: "share", status: "active", singularForm: cls.singular, idPrefix: cls.idPrefix,
      highestAssignedNumber: highest.get(cls.key) ?? 0, votingRights: cls.votingRights, votesPerShare: cls.votesPerShare, startDate: cls.startDate,
      conditionsToTransfer: cls.conditionsToTransfer, otherProvisions: cls.otherProvisions, dividendEntitlement: cls.dividendEntitlement, dividendRateBps: cls.dividendRateBps,
      redemption: cls.redemption, liquidationRank: cls.liquidationRank, maxAuthorized: cls.maxAuthorized, preEmptiveRights: false, articlesPart: cls.articlesPart,
      singularDescription: cls.singular, pluralDescription: cls.plural,
      sourceDocumentIds: [docId(story.documents.find((doc) => doc.category === "articles")?.key)].filter(Boolean) as string[], sourceExternalIds: [],
      createdAtISO: createdAt(cls.startDate), updatedAtISO: createdAt(cls.startDate),
    });
  }
  const classKeyOf = (rightsClassId: string) => story.classes.find((cls) => classId(cls.key) === rightsClassId)!.key;
  const holderKeyOf = (ledgerHolderKey: string) => holderKeys.find((candidate) => `roleHolder:${shareholderId(candidate)}` === ledgerHolderKey)!;
  for (const holding of materializeRightsHoldings(transfers)) {
    add("rightsHoldings", {
      _id: id(`holding_${classKeyOf(holding.rightsClassId)}_${holderKeyOf(holding.holderKey)}`), societyId, rightsClassId: holding.rightsClassId, holderRoleHolderId: holding.holderRoleHolderId,
      holderKey: holding.holderKey, quantity: holding.quantity, status: "current", lastTransactionId: holding.lastTransactionId, sourceDocumentIds: holding.sourceDocumentIds,
      sourceExternalIds: holding.sourceExternalIds, createdAtISO: createdAt(cutoff), updatedAtISO: createdAt(cutoff),
    });
  }
  const finalHoldings = holdingsAsOf(transfers, asOf);
  for (const holderKey of holderKeys) {
    const held = finalHoldings.filter((row) => row.holderKey === `roleHolder:${shareholderId(holderKey)}`);
    const entity = entities.get(holderKey);
    const individual = people.get(holderKey);
    const lastEvent = story.ledger.filter((event) => ("from" in event && event.from === holderKey) || ("to" in event && event.to === holderKey)).map((event) => event.date).sort().at(-1)!;
    add("roleHolders", {
      _id: shareholderId(holderKey),
      ...(individual ? roleHolderBase(individual) : {
        societyId, fullName: entity!.name, email: undefined, street: entity!.street, city: entity!.city, provinceState: entity!.province, postalCode: entity!.postalCode, country: entity!.country,
        nonNaturalPerson: true, nonNaturalPersonType: entity!.nonNaturalPersonType, nonNaturalJurisdiction: entity!.jurisdiction, directoryPersonId: personId(entity!.key),
        citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], sourceDocumentIds: [], sourceExternalIds: [],
        controllingIndividualIds: entity!.controllers.map((controller) => id(`rh_controller_${controller.person}`)),
        authorizedRepresentative: false, notes: `Signs by ${entity!.signatory}.`,
      }),
      roleType: "shareholder", status: held.length ? "current" : "former", startDate: firstHolding(holderKey), ...(held.length ? {} : { endDate: lastEvent }),
      membershipClassName: held.map((row) => classes.get(story.classes.find((cls) => classId(cls.key) === row.rightsClassId)!.key)!.className).join(", ") || undefined,
      createdAtISO: createdAt(firstHolding(holderKey)), updatedAtISO: createdAt(lastEvent),
    });
  }

  // ------------------------------------------------- ownership register (ISC)
  const register = story.ownershipRegister;
  const controllerStart = new Map<string, string>();
  const controllerBases = new Map<string, string[]>();
  const controllerReasons = new Map<string, string[]>();
  const controllerShareholders = new Map<string, string[]>();
  const noteController = (personKey: string, start: string, basis: string, reason: string, shareholder?: string) => {
    const current = controllerStart.get(personKey);
    if (!current || start < current) controllerStart.set(personKey, start);
    controllerBases.set(personKey, [...new Set([...(controllerBases.get(personKey) ?? []), basis])]);
    controllerReasons.set(personKey, [...(controllerReasons.get(personKey) ?? []), reason]);
    if (shareholder) controllerShareholders.set(personKey, [...new Set([...(controllerShareholders.get(personKey) ?? []), shareholder])]);
  };
  // Candidates exactly as the register page computes them: 25% of all issued shares or of the votes.
  const totals = finalHoldings.reduce((sum, row) => {
    const votes = story.classes.find((cls) => classId(cls.key) === row.rightsClassId)!.votesPerShare * row.quantity;
    return { shares: sum.shares + row.quantity, votes: sum.votes + votes };
  }, { shares: 0, votes: 0 });
  for (const holderKey of holderKeys) {
    const held = finalHoldings.filter((row) => row.holderKey === `roleHolder:${shareholderId(holderKey)}`);
    const shares = held.reduce((sum, row) => sum + row.quantity, 0);
    const votes = held.reduce((sum, row) => sum + row.quantity * story.classes.find((cls) => classId(cls.key) === row.rightsClassId)!.votesPerShare, 0);
    const shareTest = shares * 100 >= 25 * totals.shares;
    const voteTest = totals.votes > 0 && votes * 100 >= 25 * totals.votes;
    if (!shareTest && !voteTest) continue;
    const measure = [shareTest ? `${((shares / totals.shares) * 100).toFixed(1)}% of all issued shares` : "", voteTest ? `${((votes / totals.votes) * 100).toFixed(1)}% of the votes` : ""].filter(Boolean).join(" and ");
    const entity = entities.get(holderKey);
    if (entity) {
      for (const controller of entity.controllers) {
        noteController(controller.person, firstHolding(holderKey), entity.controllers.length > 1 ? "joint_interest" : "shares_indirect_control",
          `Indirect: ${controller.natureOfControl} ${entity.name} holds ${measure}.`, shareholderId(holderKey));
      }
    } else {
      noteController(holderKey, firstHolding(holderKey), "shares_registered", `Registered holder of ${measure}.`, shareholderId(holderKey));
    }
  }
  const registerStart = register.startedOn;
  for (const [personKey, start] of controllerStart) {
    const row = person(personKey);
    add("roleHolders", {
      _id: id(`rh_controller_${personKey}`), ...roleHolderBase(row), roleType: "controller", status: "current", startDate: start, referenceDate: registerStart > start ? registerStart : start,
      significanceReason: controllerReasons.get(personKey)!.join(" "), natureOfControl: controllerReasons.get(personKey)!.join(" "),
      significanceBases: controllerBases.get(personKey), taxResidentHomeJurisdiction: row.taxResidenceCountries.includes("CA") ? "yes" : "no",
      relatedShareholderIds: controllerShareholders.get(personKey) ?? [], sourceDocumentIds: [docId(story.documents.find((doc) => ["transparency_register", "isc_register"].includes(doc.category))?.key)].filter(Boolean) as string[],
      createdAtISO: createdAt(registerStart > start ? registerStart : start), updatedAtISO: createdAt(registerStart > start ? registerStart : start),
    });
  }
  const steps: DemoRow[] = [];
  for (const [personKey, start] of controllerStart) {
    const recordedOn = registerStart > start ? registerStart : start;
    steps.push({
      _id: id(`register_step_became_${personKey}`), societyId, individualName: holderName(personKey), roleHolderId: id(`rh_controller_${personKey}`), stepKind: "became_significant",
      stepsNarrative: registerStart > start ? `${register.startNote} Entered from the securities register and the trust or corporate records behind each holder.` : `Entered when the shares were issued; identity confirmed against government photo identification.`,
      stepDate: recordedOn, awareOn: recordedOn, recordedOn, notifiedOn: addDays(recordedOn, 6), createdAtISO: createdAt(recordedOn),
    });
  }
  for (let year = register.firstReviewYear; ; year += 1) {
    const reviewDate = businessDayOnOrBefore(md(year, register.reviewMonthDay));
    if (reviewDate > cutoff) break;
    const nextReview = md(year + 1, register.reviewMonthDay);
    steps.push({
      _id: id(`register_step_review_${year}`), societyId, individualName: "All individuals on the register", stepKind: "annual_review",
      stepsNarrative: `Annual review of the ${register.label}: compared it with the securities register, wrote to each individual to confirm their particulars and checked the holders that are not individuals. No changes.`,
      stepDate: reviewDate, recordedOn: reviewDate, nextReviewDate: nextReview, createdAtISO: createdAt(reviewDate),
    });
  }
  if (register.pendingChange) {
    const awareOn = addDays(asOf, -register.pendingChange.awareDaysAgo);
    steps.push({
      _id: id("register_step_pending_change"), societyId, individualName: holderName(register.pendingChange.person), roleHolderId: id(`rh_controller_${register.pendingChange.person}`),
      stepKind: "change", stepsNarrative: register.pendingChange.narrative, stepDate: awareOn, awareOn, createdAtISO: createdAt(awareOn),
    });
  }
  for (const step of steps) add("significantIndividualSteps", step);

  // ------------------------------------------------------- written resolutions
  const rawOrganization = { ...organization };
  const timeZone = resolutionTimeZone(rawOrganization as any);
  const profile = legalGovernanceProfile(rawOrganization as any)!;
  const directorsOn = (date: string) => story.directors.filter((term) => term.start <= date && (!term.end || term.end >= date));
  const shareholdersOn = (date: string, includeNonVoting: boolean) => {
    const holdings = holdingsAsOf(transfers, date);
    return holderKeys.map((holderKey) => {
      const held = holdings.filter((row) => row.holderKey === `roleHolder:${shareholderId(holderKey)}`);
      const votes = held.reduce((sum, row) => sum + row.quantity * story.classes.find((cls) => classId(cls.key) === row.rightsClassId)!.votesPerShare, 0);
      const votingShares = held.reduce((sum, row) => sum + (story.classes.find((cls) => classId(cls.key) === row.rightsClassId)!.votesPerShare > 0 ? row.quantity : 0), 0);
      return { holderKey, held: held.reduce((sum, row) => sum + row.quantity, 0), votes, votingShares };
    }).filter((row) => row.held > 0 && (includeNonVoting || row.votes > 0));
  };
  const resolutions: DemoRow[] = [];
  const resolutionKeys = new Map<string, string>();
  const addResolution = (spec: DemoResolutionSpec & { unanimousAll?: boolean }) => {
    const date = spec.date;
    const unanimousAll = spec.body === "shareholders" && spec.electorate === "all";
    const statutory = writtenResolutionRule(rawOrganization as any, spec.kind, spec.body);
    if (!statutory) throw new Error(`${key}: no written-resolution rule for ${spec.key}.`);
    // A decision every shareholder must sign (auditor waivers, annual business
    // in writing, a unanimous agreement) is frozen as unanimous of all holders.
    const rule = unanimousAll ? { numerator: 1, denominator: 1, strict: false, unit: "people" as const, basis: "eligible" as const } : { numerator: statutory.numerator, denominator: statutory.denominator, strict: statutory.strict, unit: statutory.unit, basis: statutory.basis };
    const electorate = spec.body === "directors"
      ? directorsOn(date).map((term) => ({ key: `director:${directorIds.get(term.person)}`, name: holderName(term.person), weight: 1, directorId: directorIds.get(term.person)! }))
      : shareholdersOn(date, unanimousAll).map((holder) => ({
        key: `shareholder:${shareholderId(holder.holderKey)}`, name: holderName(holder.holderKey), roleHolderId: shareholderId(holder.holderKey),
        weight: rule.unit === "votes" ? holder.votes : rule.unit === "shares" ? holder.votingShares : 1,
      }));
    if (!electorate.length) throw new Error(`${key}: empty electorate for ${spec.key} on ${date}.`);
    const total = electorate.reduce((sum, elector) => sum + elector.weight, 0);
    const required = requiredWrittenConsents(total, rule);
    const circulatedAtISO = at(date, 16);
    const signatures = electorate.map((elector, index) => {
      const signedAtISO = at(date, 17 + index, 5 + index * 7);
      const signer = elector.roleHolderId ? story.entities.find((entity) => shareholderId(entity.key) === elector.roleHolderId) : undefined;
      return {
        signerName: elector.name, electorKey: elector.key, weight: elector.weight, ...(elector.directorId ? { directorId: elector.directorId } : {}), ...(elector.roleHolderId ? { roleHolderId: elector.roleHolderId } : {}),
        signedAtISO, recordedAtISO: at(date, 22, index), recordedByUserId: ownerUserId,
        consentEvidence: signer ? `Counterpart signed by ${signer.signatory} on ${date}; original filed in the minute book.` : `Signed counterpart received by email on ${date}; original filed in the minute book.`,
      };
    });
    const resolution: DemoRow = {
      _id: resolutionId(spec.key), societyId, title: spec.title, text: spec.text, kind: spec.kind, notes: spec.notes,
      body: spec.body, recordDateISO: date, profileId: profile.id, evidenceVersion: 2, legalRuleReviewedOnISO: profile.reviewedOn,
      citationIds: [...statutory.sourceIds], electorate, electorateTotal: total, countUnit: rule.unit, requiredCount: required, statutoryRequiredCount: required,
      approvalRule: rule, governingInstrumentEvidence: key === "bc_company" ? "Articles: Table 1 (as amended by B.C. Reg. 186/2007) adopted by reference, with Parts 24 and 25." : key === "federal_cbca" ? "Articles of Incorporation, By-law No. 1 and the unanimous shareholder agreement of March 1, 2021." : "Articles of Incorporation (as amended in 2023) and By-law No. 1.",
      electorateEvidence: spec.body === "directors" ? `Register of directors on ${date}: ${electorate.map((elector) => elector.name).join(", ")}.` : `Securities register on ${date}${unanimousAll ? ", every registered shareholder whether or not their shares carry votes" : ", every holder of voting shares"}: ${electorate.map((elector) => elector.name).join(", ")}.`,
      circulationEvidence: `Circulated by email from ${holderName(ownerKey)} to every ${spec.body === "directors" ? "director" : "shareholder"} on ${date}.`,
      authorityReviewedByUserId: ownerUserId, authorityReviewedAtISO: at(date, 16, 30), circulatedAtISO, circulationTimeZone: timeZone,
      circulationRecordedAtISO: at(date, 16, 45), circulationRecordedByUserId: ownerUserId, signatures, nonSignerNotices: [],
      nonSignerNoticeBusinessDays: !unanimousAll && rule.unit !== "people" ? statutory.noticeBusinessDays : undefined,
      status: "Carried",
    };
    // Carried at the signature that reached the threshold.
    const reached = [...signatures].sort((a, b) => a.signedAtISO.localeCompare(b.signedAtISO));
    let count = 0;
    for (const signature of reached) {
      count += signature.weight;
      if (count >= required) { resolution.completedAtISO = signature.signedAtISO; break; }
    }
    resolution.completionRecordedAtISO = at(date, 23);
    resolutions.push(resolution);
    resolutionKeys.set(resolution._id, spec.key);
    return resolution;
  };
  for (const spec of story.resolutions) addResolution(spec);

  // Yearly cycle: directors approve the statements; shareholders deal with the
  // annual business in writing and every shareholder waives the auditor.
  const fyMonthDay = identity.fiscalYearEnd;
  const completions: Array<Record<string, any>> = [];
  const statements: Array<{ fiscalYear: number; periodEnd: string; approvedOn: string }> = [];
  const incorporationYear = yearOf(identity.incorporationDate);
  for (let fy = incorporationYear; ; fy += 1) {
    const periodEnd = md(fy, fyMonthDay);
    if (periodEnd <= identity.incorporationDate) continue;
    const approvedOn = businessDayOnOrBefore(addDays(periodEnd, story.annualDirectorsDaysAfterYearEnd));
    if (approvedOn > cutoff) break;
    const directors = directorsOn(approvedOn).map((term) => holderName(term.person));
    addResolution({
      key: `annual_directors_${fy}`, title: `Annual resolutions of the directors — financial year ended ${periodEnd}`, body: "directors", kind: "Ordinary", date: approvedOn,
      text: `BE IT RESOLVED THAT:\n1. The financial statements for the financial year ended ${periodEnd}, prepared by ${story.serviceProviders.find((row) => row.fn === "accountant")!.firmName} as a compilation engagement, are approved and any director may sign them on behalf of the board.\n2. The statements are to be placed before the shareholders with the annual resolutions.\n3. The officers continue in office: ${story.officers.filter((office) => office.start <= approvedOn && (!office.end || office.end >= approvedOn)).map((office) => `${holderName(office.person)} (${officeLabel(office.title)})`).join(", ")}.`,
      notes: `Signed by ${directors.join(", ")}.`,
    });
    statements.push({ fiscalYear: fy, periodEnd, approvedOn });
  }
  const annual = story.annualShareholders;
  for (let year = annual.firstYear; ; year += 1) {
    const date = businessDayOnOrBefore(md(year, annual.monthDay));
    if (date > cutoff) break;
    const statementsPresented = [...statements].reverse().find((row) => row.approvedOn <= date);
    const directors = directorsOn(date).map((term) => holderName(term.person));
    const accountant = story.serviceProviders.find((row) => row.fn === "accountant")!.firmName;
    const meetingRoute = key === "bc_company"
      ? `the business required to be transacted at the ${year} annual meeting, in place of holding it (BCA s. 182(2)(b)); ${date} is selected as the annual reference date (s. 182(3))`
      : key === "federal_cbca" ? `every matter required to be dealt with at the ${year} annual meeting, in place of holding it (CBCA s. 142)` : `every matter required to be dealt with at the ${year} annual meeting, in place of holding it (OBCA s. 104(1))`;
    const resolution = addResolution({
      key: `annual_shareholders_${year}`, title: `Annual resolutions of the shareholders in place of the ${year} annual meeting`, body: "shareholders", electorate: "all", kind: "Ordinary", date,
      text: `BE IT RESOLVED, by every shareholder of ${identity.name}, as ${meetingRoute}, THAT:\n1. ${statementsPresented ? `The financial statements for the financial year ended ${statementsPresented.periodEnd} are received.` : "No financial year of the Company has yet ended, so no financial statements are presented."}\n2. The number of directors is fixed at ${directors.length} and ${directors.join(", ")} are elected directors to hold office until the next annual meeting.\n3. The appointment of an auditor is dispensed with for the current financial year (${annual.auditorWaiver}), every shareholder, including holders of non-voting shares, consenting. ${accountant} is to prepare the statements as a compilation engagement.`,
      notes: `Signed by every shareholder. Discharges the ${year} annual meeting requirement and records the auditor exemption.`,
    });
    completions.push({ date: resolution.completedAtISO.slice(0, 10), kind: "written_annual_business", cycleYear: year, verified: true, evidenceRef: resolution._id, ...(key === "bc_company" ? { annualReferenceDate: date } : {}) });
  }
  organization.annualMeetingCompletions = completions;
  if (key === "bc_company" && completions.length) organization.annualReferenceDate = completions.at(-1)!.annualReferenceDate;
  organization.waivePrepFinancials = false;
  for (const resolution of resolutions) add("writtenResolutions", resolution);

  // ----------------------------------------------------------------- dividends
  const dividendRows: DemoRow[] = [];
  const dividendYears = new Map<number, string[]>();
  for (const spec of story.dividends) {
    for (let year = spec.firstYear; ; year += 1) {
      const declaredOn = businessDayOnOrBefore(md(year, spec.declaredOn));
      if (declaredOn > cutoff) break;
      (dividendYears.get(year) ?? dividendYears.set(year, []).get(year)!).push(spec.key);
    }
  }
  for (const [year, keys] of dividendYears) {
    const declaredOn = businessDayOnOrBefore(md(year, story.dividends.find((spec) => spec.key === keys[0])!.declaredOn));
    const declared = keys.map((dividendKey) => {
      const spec = story.dividends.find((row) => row.key === dividendKey)!;
      return `${spec.perShare(year)} per ${classes.get(spec.cls)!.singular}`;
    });
    const resolution = addResolution({
      key: `dividend_${year}`, title: `Declaration of dividends — December ${year}`, body: "directors", kind: "Ordinary", date: declaredOn,
      text: `BE IT RESOLVED THAT, the directors having confirmed that there are no reasonable grounds for believing that the ${story.shortName.replace(/^the /, "")} is insolvent or that the payment would make it insolvent (${key === "bc_company" ? "BCA s. 70(2)" : key === "federal_cbca" ? "CBCA s. 42" : "OBCA s. 38(3)"}), dividends of $${declared.join(" and $")} are declared, payable to the shareholders of record at the close of business on ${declaredOn}.`,
    });
    add("writtenResolutions", resolution);
    for (const dividendKey of keys) {
      const spec = story.dividends.find((row) => row.key === dividendKey)!;
      const cls = classes.get(spec.cls)!;
      const recordDate = declaredOn;
      const paymentDate = nextBusinessDay(addDays(declaredOn, spec.paymentDays));
      const perShareAmount = spec.perShare(year);
      const snapshot = dividendEntitlements(holdingsAsOf(transfers, recordDate), classId(spec.cls), perShareAmount, (holderKey) => {
        const shareholder = holderKeys.find((candidate) => `roleHolder:${shareholderId(candidate)}` === holderKey);
        return shareholder ? holderName(shareholder) : undefined;
      });
      const status = paymentDate <= cutoff ? "paid" : "declared";
      dividendRows.push({
        _id: id(`dividend_${dividendKey}_${year}`), societyId, declaredOn, shareClass: cls.className, rightsClassId: classId(spec.cls), perShareAmount,
        perShareCents: Math.round(Number(perShareAmount) * 100), sharesOutstanding: snapshot.sharesOutstanding, currency: "CAD", totalCents: snapshot.totalCents,
        totalAmount: snapshot.totalAmount, recordDate, paymentDate, status, solvencyConfirmedAt: declaredOn,
        solvencyBasis: `Directors reviewed the management accounts to the end of November ${year} and a 12-month cash forecast: the ${story.shortName.replace(/^the /, "")} can pay its liabilities as they become due after this dividend, and its assets exceed its liabilities${key === "bc_company" ? "" : " and stated capital"}.`,
        declaredByResolutionId: resolution._id, sharesSource: "ledger", entitlements: snapshot.entitlements,
        notes: cls.dividendEntitlement === "fixed_rate" || cls.dividendEntitlement === "cumulative_fixed" ? `Preferential ${(cls.dividendRateBps! / 100).toFixed(0)}% dividend for ${year} under the class's rights.` : undefined,
        createdAtISO: createdAt(declaredOn), updatedAtISO: createdAt(status === "paid" ? paymentDate : declaredOn),
      });
    }
  }
  for (const row of dividendRows) add("dividends", row);

  // ------------------------------------------------------------------ filings
  const annualReturnKind = key === "bc_company" ? "BCCompanyAnnualReport" : key === "federal_cbca" ? "FederalAnnualReturn" : "OntarioAnnualReturn";
  const returnRule = profile.annualReturn;
  const filings: DemoRow[] = [];
  const firstCycle = incorporationYear + (returnRule.anchor === "anniversary" ? 1 : 0);
  for (let year = firstCycle; ; year += 1) {
    const anchor = returnRule.anchor === "anniversary" ? md(year, identity.incorporationDate.slice(5)) : md(year, fyMonthDay);
    if (returnRule.anchor === "fiscal_year_end" && anchor < identity.incorporationDate) continue;
    const due = returnRule.anchor === "fiscal_year_end"
      ? addFiscalFilingMonths(anchor, returnRule.months ?? 6)!
      : returnRule.months ? addCalendarMonths(anchor, returnRule.months)! : addComplianceDays(anchor, returnRule.days ?? 0)!;
    const filedAt = businessDayOnOrBefore(addDays(due, -20));
    if (filedAt > cutoff) break;
    const isc = key === "federal_cbca" && filedAt >= "2024-01-22";
    filings.push({
      _id: id(`filing_annual_${year}`), societyId, kind: annualReturnKind, jurisdictionCode: identity.jurisdictionCode, contextKind: "home",
      periodLabel: returnRule.anchor === "fiscal_year_end" ? `Financial year ended ${anchor}` : `${year} annual ${key === "bc_company" ? "report" : "return"}`,
      reportingYear: year, ...(returnRule.anchor === "fiscal_year_end" ? { reportingPeriodEnd: anchor } : {}),
      // Ontario returns were filed with the T2 return until the Ontario Business Registry opened on October 19, 2021.
      dueDate: due, filedAt, status: "Filed", submissionMethod: key === "bc_company" ? "BC Registries online" : key === "federal_cbca" ? "Corporations Canada Online Filing Centre" : filedAt < "2021-10-19" ? "With the T2 return (Schedule 546) through CRA" : "Ontario Business Registry",
      submittedByUserId: ownerUserId, confirmationNumber: `${identity.incorporationNumber}-AR-${year}`, feePaidCents: key === "bc_company" ? 4_300 : key === "federal_cbca" ? 1_200 : 0,
      evidenceNotes: isc ? "Filed with the information about individuals with significant control (CBCA s. 21.303)." : `Registry confirmation retained with the ${key === "bc_company" ? "annual report" : "annual return"}.`,
      attestedByUserId: ownerUserId, attestedAtISO: at(filedAt, 21), receiptDocumentId: id(`doc_filing_receipt_${year}`),
    });
    add("documents", {
      _id: id(`doc_filing_receipt_${year}`), societyId, title: `${profile.annualReturn.label} ${year} — filing confirmation`, category: "Filing", fileName: `annual-filing-confirmation-${year}.pdf`, mimeType: "application/pdf",
      content: `${story.registryLabel} confirmation for the ${year} ${key === "bc_company" ? "annual report" : "annual return"} of ${identity.name}, filed on ${filedAt}. Confirmation ${identity.incorporationNumber}-AR-${year}. (Fictional demo record.)`,
      createdAtISO: at(filedAt, 21), flaggedForDeletion: false, tags: ["13___annual_return_filings", "filing_receipt", "demo"], reviewStatus: "reviewed", librarySection: "minute_book",
    });
  }
  for (const filing of filings) add("filings", filing);
  // The next return, open in the filing register until it is filed.
  const nextCycle = (filings.at(-1)?.reportingYear ?? firstCycle - 1) + 1;
  const nextAnchor = returnRule.anchor === "anniversary" ? md(nextCycle, identity.incorporationDate.slice(5)) : md(nextCycle, fyMonthDay);
  const nextDue = returnRule.anchor === "fiscal_year_end" ? addFiscalFilingMonths(nextAnchor, returnRule.months ?? 6)! : returnRule.months ? addCalendarMonths(nextAnchor, returnRule.months)! : addComplianceDays(nextAnchor, returnRule.days ?? 0)!;
  const upcomingFilingId = id(`filing_annual_${nextCycle}`);
  add("filings", {
    _id: upcomingFilingId, societyId, kind: annualReturnKind, jurisdictionCode: identity.jurisdictionCode, contextKind: "home",
    periodLabel: returnRule.anchor === "fiscal_year_end" ? `Financial year ended ${nextAnchor}` : `${nextCycle} annual ${key === "bc_company" ? "report" : "return"}`,
    reportingYear: nextCycle, ...(returnRule.anchor === "fiscal_year_end" ? { reportingPeriodEnd: nextAnchor } : {}), dueDate: nextDue, status: "Upcoming",
    submissionMethod: key === "bc_company" ? "BC Registries online" : key === "federal_cbca" ? "Corporations Canada Online Filing Centre" : "Ontario Business Registry",
    submissionChecklist: key === "federal_cbca" ? ["Confirm the registered office and directors", "Attach the ISC information", "Pay the filing fee"] : ["Confirm the registered office and directors", key === "bc_company" ? "Pay the filing fee" : "Confirm the financial year end"],
    notes: `Open until filed. ${profile.annualReturn.label} for the ${returnRule.anchor === "fiscal_year_end" ? `financial year ended ${nextAnchor}` : `${nextCycle} anniversary`}.`,
  });
  for (const filing of filings) {
    add("annualFilingLedger", { _id: id(`filing_ledger_${filing.reportingYear}`), societyId, jurisdiction: identity.jurisdictionCode, year: String(filing.reportingYear), filed: true, filedOn: filing.filedAt, sourceFilingId: filing._id, regnNature: profile.annualReturn.label, regnLegislation: story.legislationLabel, createdAtISO: at(filing.filedAt, 21) });
  }

  // ------------------------------------------------- director change notices
  // Each change of directors is reported to the registry within 15 days.
  const changeDates = [...new Set(story.directors.flatMap((term) => [term.start > identity.incorporationDate ? term.start : "", term.end ?? ""]).filter((date) => date && date <= cutoff))].sort();
  const changeGroups: string[][] = [];
  for (const date of changeDates) {
    const last = changeGroups.at(-1);
    if (last && addDays(last[0], 3) >= date) last.push(date);
    else changeGroups.push([date]);
  }
  const changeKind = key === "bc_company" ? "ChangeOfDirectors" : key === "federal_cbca" ? "FederalDirectorChange" : "OntarioNoticeOfChange";
  for (const group of changeGroups) {
    const effective = group[0];
    const names = story.directors.filter((term) => group.includes(term.start) || (term.end && group.includes(term.end))).map((term) => `${holderName(term.person)} (${term.end && group.includes(term.end) ? "ceased" : "appointed"})`);
    add("filings", {
      _id: id(`filing_director_change_${effective}`), societyId, kind: changeKind, jurisdictionCode: identity.jurisdictionCode, contextKind: "home",
      periodLabel: `Change of directors effective ${effective}`, dueDate: addDays(effective, 15), filedAt: businessDayOnOrBefore(addDays(effective, 6)), status: "Filed",
      submissionMethod: key === "bc_company" ? "BC Registries online" : key === "federal_cbca" ? "Corporations Canada Online Filing Centre" : effective < "2021-10-19" ? "Notice of change under the Corporations Information Act" : "Ontario Business Registry",
      submittedByUserId: ownerUserId, confirmationNumber: `${identity.incorporationNumber}-DC-${effective.replace(/-/g, "")}`, evidenceNotes: `Directors changed: ${names.join(", ")}.`,
    });
  }

  // ---------------------------------------- rule-pack obligations (history)
  // The Obligations page lists every nominal date the rule packs compute since
  // incorporation. Each past one is backed by a filing, or by a recorded review
  // (with its evidence) or a reasoned dismissal, so the page shows history as
  // handled and only the open cycle ahead of today.
  const factsForRules = complianceFactsForOrganization({ ...organization }, { asOfDate: asOf, registrations: tables.organizationRegistrations as any, meetings: [] });
  const ruleObligations = factsForRules.flatMap((facts) => computeComplianceObligations(facts));
  const filingRows = () => tables.filings ?? [];
  const stepIn = (from: string, to: string) => steps.find((step) => step.stepKind === "annual_review" && step.stepDate >= from && step.stepDate <= to);
  const annualResolutionBy = (date: string) => [...resolutions].filter((row) => /^Annual resolutions of the shareholders/.test(row.title) && row.recordDateISO <= date).at(-1);
  const directorsResolutionIn = (year: number) => resolutions.find((row) => /^Annual resolutions of the directors/.test(row.title) && row.recordDateISO.startsWith(String(year)));
  for (const obligation of ruleObligations) {
    const ruleId = obligation.occurrenceKey.split(":")[1] ?? obligation.occurrenceKey;
    const kind = obligation.creates?.filingKind;
    const due = obligation.dueDate;
    if (kind && filingRows().some((row) => row.kind === kind && row.dueDate === due)) continue;
    const decision = (status: "resolved" | "dismissed", notes: string, target?: { table: string; id: string }) => add("complianceRemediations", {
      _id: id(`obligation_${ruleId.replace(/^compliance-/, "").replace(/[^a-z0-9]+/g, "_")}_${due}`), societyId, ruleId: obligation.occurrenceKey,
      flagLevel: "info", flagText: obligation.title, evidenceRequired: obligation.creates?.requiredEvidence ?? [], status, notes,
      ...(target ? { targetTable: target.table, targetId: target.id } : {}),
      ...(status === "resolved" ? { resolvedAtISO: at(due < cutoff ? addDays(due, -7) : cutoff), resolvedByUserId: ownerUserId } : { dismissedAtISO: at(due < cutoff ? addDays(due, -7) : cutoff) }),
      createdAtISO: at(due < cutoff ? addDays(due, -7) : cutoff), updatedAtISO: at(due < cutoff ? addDays(due, -7) : cutoff),
    });
    const notRequired =
      kind === "FederalIscUpdate" && due < "2024-01-22" ? "Not required: sending information about individuals with significant control to Corporations Canada began on January 22, 2024."
        : kind === "FederalAnnualReturn" && yearOf(due) === incorporationYear ? "Not required: the first annual return covers the anniversary in the year after incorporation."
          : /transparency-annual-review/.test(ruleId) && due < register.startedOn ? "Not required: Part 4.1 of the Business Corporations Act (the transparency register) came into force on October 1, 2020."
            : undefined;
    if (notRequired) { decision("dismissed", notRequired); continue; }
    if (kind === "FederalIscUpdate" || kind === "OntarioInitialReturn") {
      const filedAt = kind === "OntarioInitialReturn" ? businessDayOnOrBefore(addDays(identity.incorporationDate, 25)) : filings.find((row) => row.dueDate === due)?.filedAt ?? businessDayOnOrBefore(addDays(due, -20));
      const isFiled = filedAt <= cutoff;
      add("filings", {
        _id: id(`filing_${kind === "FederalIscUpdate" ? "isc" : "initial_return"}_${due}`), societyId, kind, jurisdictionCode: identity.jurisdictionCode, contextKind: "home",
        periodLabel: kind === "FederalIscUpdate" ? `ISC information with the ${yearOf(due)} annual return` : "Initial return", reportingYear: yearOf(due), dueDate: due, status: isFiled ? "Filed" : "Upcoming",
        ...(isFiled ? { filedAt, submittedByUserId: ownerUserId, confirmationNumber: `${identity.incorporationNumber}-${kind === "FederalIscUpdate" ? "ISC" : "IR"}-${yearOf(due)}` } : {}),
        submissionMethod: kind === "FederalIscUpdate" ? "Corporations Canada Online Filing Centre" : "Initial return under the Corporations Information Act",
        evidenceNotes: kind === "FederalIscUpdate" ? "Individuals with significant control as recorded in the ISC register (CBCA s. 21.303)." : "Initial return filed within 60 days after incorporation (Corporations Information Act s. 2).",
      });
      continue;
    }
    if (due >= asOf) continue;
    if (kind) { decision("dismissed", "Reviewed: there was no change to report for this period. Changes of directors were filed when they happened."); continue; }
    const yearEndReview = stepIn(addDays(due, -75), due);
    const target =
      /transparency-annual-review|isc-annual-review/.test(ruleId) && yearEndReview ? { table: "significantIndividualSteps", id: yearEndReview._id }
        : /agm|annual-meeting/.test(ruleId) && annualResolutionBy(due) ? { table: "writtenResolutions", id: annualResolutionBy(due)!._id }
          : /financials/.test(ruleId) && directorsResolutionIn(yearOf(due)) ? { table: "writtenResolutions", id: directorsResolutionIn(yearOf(due))!._id }
            : undefined;
    decision("resolved", target
      ? `Done: ${target.table === "writtenResolutions" ? resolutions.find((row) => row._id === target.id)!.title : `annual review of the ${register.label} on ${yearEndReview!.stepDate}`}.`
      : `Reviewed with the annual records review before ${due}; nothing outstanding.`, target);
  }

  // ---------------------------------------------------- auditor & statements
  for (const row of statements.slice(-3)) {
    const figures = story.finance.statements(row.fiscalYear);
    const statementsDocId = id(`doc_statements_${row.fiscalYear}`);
    add("documents", {
      _id: statementsDocId, societyId, title: `Financial statements — year ended ${row.periodEnd}`, category: "FinancialStatement", fileName: `financial-statements-${row.periodEnd}.pdf`, mimeType: "application/pdf",
      content: `Compiled financial statements of ${identity.name} for the year ended ${row.periodEnd}, approved by the directors on ${row.approvedOn}. No auditor: every shareholder waived the appointment (${annual.auditorWaiver}). (Fictional demo record.)`,
      createdAtISO: createdAt(row.approvedOn), flaggedForDeletion: false, tags: ["financial_statements", "demo"], reviewStatus: "reviewed", librarySection: "minute_book",
    });
    add("financials", {
      statementsDocId,
      _id: id(`financials_${row.fiscalYear}`), societyId, fiscalYear: fyMonthDay === "12-31" ? String(row.fiscalYear) : `${row.fiscalYear - 1}-${row.fiscalYear}`, periodEnd: row.periodEnd,
      revenueCents: figures.revenueCents, expensesCents: figures.expensesCents, netAssetsCents: figures.netAssetsCents,
      auditStatus: "Compilation engagement (auditor waived by every shareholder)", auditorName: story.serviceProviders.find((provider) => provider.fn === "accountant")!.firmName,
      approvedByBoardAt: row.approvedOn, remunerationDisclosures: [],
    });
    add("auditorAppointments", {
      _id: id(`engagement_${row.fiscalYear}`), societyId, firmName: story.serviceProviders.find((provider) => provider.fn === "accountant")!.firmName,
      engagementType: "CompilationEngagement", fiscalYear: fyMonthDay === "12-31" ? String(row.fiscalYear) : `${row.fiscalYear - 1}-${row.fiscalYear}`, appointedBy: "Directors",
      appointedAtISO: at(addDays(row.periodEnd, -60)), independenceAttested: true, status: "Completed",
      notes: `No auditor: every shareholder consented to dispense with an auditor (${annual.auditorWaiver}). The accountant compiled the statements.`,
    });
  }

  // ----------------------------------------------- agreements and insurance
  for (const agreement of story.agreements) {
    add("agreements", {
      _id: id(`agreement_${agreement.key}`), societyId, title: agreement.title, kind: agreement.kind, status: agreement.status, summary: agreement.summary,
      parties: agreement.parties.map((name) => {
        const party = [...story.people.map((row) => ({ key: row.key, name: fullName(row) })), ...story.entities.map((row) => ({ key: row.key, name: row.name }))].find((row) => row.name === name);
        return { name, role: name === identity.name ? "us" : "counterparty", ...(party ? { directoryPersonId: personId(party.key) } : {}) };
      }),
      ourSignatories: [{ name: holderName(story.officers.find((office) => !office.end)!.person), title: officeLabel(story.officers.find((office) => !office.end)!.title), signedAtISO: at(agreement.signedDate) }],
      signedDate: agreement.signedDate, effectiveDate: agreement.effectiveDate, endDate: agreement.endDate, renewalNoticeDays: agreement.renewalNoticeDays,
      terminationNoticeDays: agreement.terminationNoticeDays, valueCents: agreement.valueCents, currency: agreement.valueCents ? "CAD" : undefined, paymentTerms: agreement.paymentTerms,
      governingLaw: agreement.governingLaw, confidential: agreement.confidential, signedDocumentId: docId(agreement.documentKey), documentIds: agreement.documentKey ? [docId(agreement.documentKey)!] : [],
      reviewStatus: "Reviewed", notes: agreement.notes, createdAtISO: createdAt(agreement.signedDate), updatedAtISO: createdAt(agreement.signedDate),
    });
  }
  const insurance = story.insurance;
  let renewal = md(yearOf(asOf), insurance.renewalMonthDay);
  if (renewal <= asOf) renewal = md(yearOf(asOf) + 1, insurance.renewalMonthDay);
  const policyStart = md(yearOf(renewal) - 1, insurance.renewalMonthDay);
  add("insurancePolicies", {
    _id: id(`insurance_${insurance.key}`), societyId, kind: insurance.kind, insurer: insurance.insurer, broker: insurance.broker, policyNumber: insurance.policyNumber,
    startDate: policyStart, renewalDate: renewal, endDate: renewal, status: "Active", coverageCents: insurance.coverageCents, premiumCents: insurance.premiumCents,
    coverageSummary: insurance.summary, policyTermLabel: `${policyStart} to ${renewal}`, createdAtISO: createdAt(policyStart), updatedAtISO: createdAt(policyStart),
  });

  // ------------------------------------------- the next annual meeting date
  let plannedYear = annual.firstYear;
  while (businessDayOnOrBefore(md(plannedYear, annual.monthDay)) <= cutoff) plannedYear += 1;
  const plannedOn = businessDayOnOrBefore(md(plannedYear, annual.monthDay));
  add("meetings", {
    _id: id("meeting_annual_planned"), societyId, type: "AGM", title: `${plannedYear} annual meeting of shareholders`, scheduledAt: at(plannedOn, 18), location: story.recordsOfficeNote.includes("Law") ? "Registered office" : story.registeredOffice.city,
    electronic: true, status: "Scheduled", attendeeIds: [],
    notes: `Planned date. If every shareholder signs the annual resolutions in writing (${key === "bc_company" ? "BCA s. 182(2)(b)" : key === "federal_cbca" ? "CBCA s. 142" : "OBCA s. 104(1)"}), no meeting is held, as in earlier years.`,
  });

  // --------------------------------------------------------- board meetings
  const heldOn = businessDayOnOrBefore(addDays(asOf, -38));
  const nextOn = businessDayOnOrBefore(addDays(asOf, 23));
  const boardAttendees = directorsOn(heldOn);
  const heldMeetingId = id("meeting_board_recent");
  const minutesId = id("minutes_board_recent");
  add("meetings", {
    _id: heldMeetingId, societyId, type: "Board", title: "Quarterly board meeting", scheduledAt: at(heldOn, 17), location: story.boardMeeting.location, electronic: true,
    status: "Held", attendeeIds: boardAttendees.map((term) => directorIds.get(term.person)!), quorumRequired: Math.floor(boardAttendees.length / 2) + 1, minutesId,
    notes: `Agenda: ${story.boardMeeting.agenda.join("; ")}.`, hostBody: "board",
  });
  add("meetings", {
    _id: id("meeting_board_next"), societyId, type: "Board", title: "Quarterly board meeting", scheduledAt: at(nextOn, 17), location: story.boardMeeting.location, electronic: true,
    status: "Scheduled", attendeeIds: directorsOn(asOf).map((term) => directorIds.get(term.person)!), quorumRequired: Math.floor(directorsOn(asOf).length / 2) + 1,
    notes: "Agenda to follow: year-end planning and the next annual cycle.", hostBody: "board",
  });
  const chair = holderName(story.officers.find((office) => ["president", "chief_executive_officer"].includes(office.title) && !office.end)!.person);
  const secretary = holderName(story.officers.find((office) => (office.title.includes("secretary") || office.additionalTitles?.includes("secretary")) && !office.end)?.person ?? ownerKey);
  const boardPackId = id("doc_board_pack_recent");
  add("documents", {
    _id: boardPackId, societyId, title: `Board package — ${heldOn}`, category: "Minutes", fileName: `board-package-${heldOn}.pdf`, mimeType: "application/pdf",
    content: `Agenda, management report and financial summary circulated to the directors before the ${heldOn} meeting: ${story.boardMeeting.agenda.join("; ")}. (Fictional demo record.)`,
    createdAtISO: createdAt(addDays(heldOn, -5)), flaggedForDeletion: false, tags: ["5___directors_meetings_and_resolutions", "demo"], meetingId: heldMeetingId, reviewStatus: "reviewed", librarySection: "minute_book",
  });
  add("meetingMaterials", {
    _id: id("material_board_pack_recent"), societyId, meetingId: heldMeetingId, documentId: boardPackId, order: 1, requiredForMeeting: true, accessLevel: "board",
    label: "Board package", availabilityStatus: "available", createdAtISO: createdAt(addDays(heldOn, -5)),
  });
  add("archiveAccessions", {
    _id: id("archive_minute_book"), societyId, title: "Original minute book (paper binder)", containerType: "binder", location: story.recordsOfficeNote,
    custodian: story.serviceProviders.find((provider) => provider.fn === "lawyer")!.firmName, status: "In custody", dateReceived: identity.incorporationDate,
    dateRange: `${identity.incorporationDate.slice(0, 4)} to present`, accessRestrictions: "Directors and authorized officers; shareholder inspection by appointment.",
    notes: "Signed originals of resolutions, certificates and registers. Scanned copies are in the document library.", createdAtISO: createdAt(identity.incorporationDate),
  });
  add("minutes", {
    _id: minutesId, societyId, meetingId: heldMeetingId, heldAt: at(heldOn, 17), attendees: boardAttendees.map((term) => holderName(term.person)), absent: [], quorumMet: true,
    chairName: chair, secretaryName: secretary, calledToOrderAt: at(heldOn, 17), adjournedAt: at(heldOn, 18, 20),
    discussion: story.boardMeeting.agenda.map((item, index) => `${index + 1}. ${item}.`).join("\n"),
    sections: story.boardMeeting.agenda.map((title) => ({ title, type: "discussion", discussion: "", decisions: [], actionItems: [], depth: 0 })),
    decisions: story.boardMeeting.decisions, actionItems: [], motions: [], appendices: [], approvedAt: addDays(heldOn, 7),
  });

  // -------------------------------------------------------------- deadlines
  const settingsFor = annualGovernanceSettings({ ...organization } as any, [], filings, asOf);
  const derived = deriveComplianceDeadlines({ ...settingsFor, transparencyEvents: transparencyEventsFromSteps(steps) }, asOf);
  for (const deadline of derived) {
    add("deadlines", {
      _id: id(`deadline_${deadline.key.replace(/[^a-z0-9]+/gi, "_")}`), societyId, title: deadline.title, description: deadline.basis, dueDate: deadline.dueDate,
      category: deadline.deadlineCategory, status: "open", done: false, recurrence: ["agm", "annual-report", "fiscal-year-end", "transparency-review"].includes(deadline.key) ? "Annual" : "None",
      sourceKey: ["agm", "annual-report", "fiscal-year-end"].includes(deadline.key) ? complianceDeadlineSourceKey(deadline) : `compliance:${deadline.key}`,
      ...(deadline.key === "annual-report" && deadline.cycleYear === nextCycle ? { linkedFilingId: upcomingFilingId } : {}),
    });
  }
  if (key !== "bc_company") {
    // CBCA s. 21.1 and OBCA s. 140.2: review the ISC register once in each
    // financial year and enter changes within 15 days of becoming aware. The
    // compliance engine derives these clocks for BC only, so the demo records them.
    const fyEndNext = (() => { let candidate = md(yearOf(asOf), fyMonthDay); if (candidate < asOf) candidate = md(yearOf(asOf) + 1, fyMonthDay); return candidate; })();
    add("deadlines", {
      _id: id("deadline_isc_review"), societyId, title: "Annual review of the register of individuals with significant control", dueDate: fyEndNext, category: "Governance", status: "open", done: false, recurrence: "Annual",
      description: `${key === "federal_cbca" ? "CBCA s. 21.1(2)" : "OBCA s. 140.2(4)"}: update the register at least once during each financial year; this financial year ends on ${fyEndNext}.`, sourceKey: "isc:annual-review",
    });
    if (register.pendingChange) {
      const awareOn = addDays(asOf, -register.pendingChange.awareDaysAgo);
      add("deadlines", {
        _id: id("deadline_isc_change"), societyId, title: `Enter the change for ${holderName(register.pendingChange.person)} in the ISC register`, dueDate: addDays(awareOn, register.updateDays), category: "Governance", status: "open", done: false, recurrence: "None",
        description: `${key === "federal_cbca" ? "CBCA s. 21.1(3)" : "OBCA s. 140.2(3)"}: record new information within 15 days after becoming aware of it (aware on ${awareOn}).`, sourceKey: "isc:change",
      });
    }
    if (key === "federal_cbca") {
      const nextReturn = derived.find((deadline) => deadline.key === "annual-report");
      if (nextReturn) add("deadlines", {
        _id: id("deadline_isc_filing"), societyId, title: "Send ISC information to Corporations Canada with the annual return", dueDate: nextReturn.dueDate, category: "Governance", status: "open", done: false, recurrence: "Annual",
        description: "CBCA s. 21.303: send the prescribed information about individuals with significant control with the annual return.", sourceKey: `isc:filing:${nextReturn.cycleYear}`,
      });
    }
  }
  for (const agreement of story.agreements.filter((row) => row.endDate && row.renewalNoticeDays)) {
    const noticeDue = addDays(agreement.endDate!, -agreement.renewalNoticeDays!);
    if (noticeDue < asOf) continue;
    add("deadlines", {
      _id: id(`deadline_renewal_${agreement.key}`), societyId, title: `Renewal notice due — ${agreement.title}`, description: `Give notice ${agreement.renewalNoticeDays} days before the term ends on ${agreement.endDate}.`,
      dueDate: noticeDue, category: "Agreement renewal", status: "open", done: false, agreementId: id(`agreement_${agreement.key}`), sourceKey: `renewal-notice:${agreement.endDate}`,
    });
  }
  add("deadlines", {
    _id: id("deadline_insurance"), societyId, title: `Renew ${insurance.kind.toLowerCase()} insurance`, dueDate: addDays(renewal, -14), category: "Other", status: "open", done: false, recurrence: "Annual",
    description: `Policy ${insurance.policyNumber} with ${insurance.insurer} renews on ${renewal}.`,
  });

  // ------------------------------------------------------------------ tasks
  for (const task of story.tasks) {
    const due = addDays(asOf, task.dueInDays);
    add("tasks", {
      _id: id(`task_${task.key}`), societyId, title: task.title, description: task.description, status: task.status, priority: task.priority, assignee: task.assignee,
      dueDate: due, tags: task.tags, createdAtISO: createdAt(addDays(due, -21)), ...(task.status === "Done" ? { completedAt: at(addDays(due, -1)), completionNote: "Done and filed in the minute book." } : {}),
    });
  }

  // ------------------------------------------------------------ minute book
  const minuteBookItems: Array<{ key: string; title: string; recordType: string; date: string; documentIds?: string[]; writtenResolutionId?: string; filingId?: string; meetingId?: string; minutesId?: string }> = [
    ...story.documents.filter((doc) => ["certificate", "articles", "notice_of_articles", "by-laws", "unanimous_shareholder_agreement", "shareholder_agreement"].includes(doc.category))
      .map((doc) => ({ key: `doc_${doc.key}`, title: doc.title, recordType: doc.category === "by-laws" ? "constitution" : "document", date: doc.date, documentIds: [id(`doc_${doc.key}`)] })),
    // Every signed resolution is filed in the minute book.
    ...resolutions.map((row) => ({ key: `res_${resolutionKeys.get(row._id)}`, title: row.title, recordType: "written_resolution", date: row.recordDateISO, writtenResolutionId: row._id })),
    ...filings.slice(-2).map((filing) => ({ key: `filing_${filing.reportingYear}`, title: `${profile.annualReturn.label} — ${filing.reportingYear}`, recordType: "filing", date: filing.filedAt, filingId: filing._id })),
    { key: "minutes_recent", title: "Minutes — quarterly board meeting", recordType: "minutes", date: heldOn, meetingId: heldMeetingId, minutesId },
  ];
  for (const item of minuteBookItems) {
    add("minuteBookItems", {
      _id: id(`minute_book_${item.key}`), societyId, title: item.title, recordType: item.recordType, effectiveDate: item.date, status: "Current",
      documentIds: item.documentIds ?? [], signatureIds: [], sourceEvidenceIds: [], writtenResolutionId: item.writtenResolutionId, filingId: item.filingId,
      meetingId: item.meetingId, minutesId: item.minutesId, createdAtISO: createdAt(item.date), updatedAtISO: createdAt(item.date),
    });
  }

  // ---------------------------------------------------------------- finance
  buildFinance(story, { id, add, societyId, asOf, cutoff, dividends: dividendRows, identityName: identity.name, fyMonthDay });

  // --------------------------------------------------------------- activity
  const recent = [
    ...filings.slice(-1).map((filing) => ({ at: at(filing.filedAt, 21), entityType: "filing", entityId: filing._id, action: "filed", summary: `${profile.annualReturn.label} for ${filing.reportingYear} filed with ${story.registryLabel}` })),
    ...resolutions.slice(-2).map((row) => ({ at: row.completedAtISO, entityType: "writtenResolution", entityId: row._id, action: "carried", summary: `${row.title} — signed by every ${row.body === "directors" ? "director" : "shareholder"}` })),
    { at: at(heldOn, 18, 30), entityType: "meeting", entityId: heldMeetingId, action: "held", summary: "Quarterly board meeting held" },
    ...steps.filter((step) => step.stepKind === "annual_review").slice(-1).map((step) => ({ at: at(step.stepDate, 20), entityType: "significantIndividualSteps", entityId: step._id, action: "recorded", summary: `Annual review of the ${register.label} recorded` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  recent.forEach((entry, index) => add("activity", { _id: id(`activity_${index}`), societyId, actor: holderName(ownerKey), entityType: entry.entityType, entityId: entry.entityId, subjectId: entry.entityId, action: entry.action, summary: entry.summary, createdAtISO: entry.at }));

  return { key, asOf, societyId, ownerUserId, society: organization, tables };
}

function officeLabel(title: string) {
  const labels: Record<string, string> = {
    president: "President", secretary: "Secretary", treasurer: "Treasurer", chief_financial_officer: "Chief Financial Officer", chief_executive_officer: "Chief Executive Officer",
    vice_president: "Vice-President", secretary_treasurer: "Secretary-Treasurer",
  };
  return labels[title] ?? title.replace(/_/g, " ");
}

function buildFinance(
  story: CorporationStory,
  input: { id: (key: string) => string; add: (table: string, row: DemoRow) => string; societyId: string; asOf: string; cutoff: string; dividends: DemoRow[]; identityName: string; fyMonthDay: string },
) {
  const { id, add, societyId, asOf, cutoff } = input;
  const finance = story.finance;
  const connectionId = id("finance_connection");
  add("financialConnections", { _id: connectionId, societyId, provider: "demo", status: "connected", accountLabel: `${finance.bankName} (demo feed)`, syncMode: "demo", connectedAtISO: at(addDays(asOf, -400)), lastSyncAtISO: at(cutoff, 13), demo: true });
  const start = `${addDays(asOf, -365).slice(0, 7)}-01`;
  type Line = { key: string; date: string; description: string; counterparty: string; amountCents: number; category: string; method: string; status: "posted" | "pending"; memo?: string };
  const lines: Line[] = [];
  for (const month of monthKeys(start, asOf)) {
    const monthNumber = Number(month.slice(5, 7));
    for (const flow of finance.flows) {
      if (flow.months && !flow.months.includes(monthNumber)) continue;
      const date = nextBusinessDay(dayOfMonth(month, flow.day));
      if (date > asOf || date < start) continue;
      const rng = createRng(`${story.key}:${flow.key}:${month}`);
      const amount = rng.cents(flow.minDollars, flow.maxDollars);
      lines.push({ key: `${flow.key}_${month}`, date, description: flow.description, counterparty: flow.counterparty, amountCents: flow.direction === "in" ? amount : -amount, category: flow.category, method: flow.method, status: date > cutoff ? "pending" : "posted" });
    }
  }
  // Dividends paid out of the operating account, one line per shareholder.
  for (const dividend of input.dividends.filter((row) => row.status === "paid" && row.paymentDate >= start && row.paymentDate <= asOf)) {
    for (const entitlement of dividend.entitlements ?? []) {
      lines.push({ key: `dividend_${String(dividend.shareClass).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${dividend.paymentDate}_${entitlement.holderName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, date: dividend.paymentDate, description: `Dividend — ${dividend.shareClass}`, counterparty: entitlement.holderName, amountCents: -entitlement.amountCents, category: "Dividends paid", method: "EFT", status: "posted", memo: `${entitlement.shares.toLocaleString("en-CA")} shares at $${dividend.perShareAmount}` });
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const operatingId = id("account_operating");
  const savingsId = id("account_savings");
  const operatingBalance = finance.openingCents + lines.reduce((sum, line) => sum + line.amountCents, 0);
  add("financialAccounts", { _id: operatingId, societyId, connectionId, externalId: `${story.key}-operating`, code: "1000", name: `Operating account ••${finance.operatingLast4}`, currency: "CAD", accountType: "Bank", subtype: "chequing", balanceCents: operatingBalance, isRestricted: false, sourceSystem: "societyer", normalBalance: "debit" });
  add("financialAccounts", { _id: savingsId, societyId, connectionId, externalId: `${story.key}-savings`, code: "1010", name: "Business savings", currency: "CAD", accountType: "Bank", subtype: "savings", balanceCents: finance.savingsOpeningCents, isRestricted: false, sourceSystem: "societyer", normalBalance: "debit" });
  for (const line of lines) {
    add("financialTransactions", {
      _id: id(`txn_${line.key}`), societyId, connectionId, accountId: operatingId, externalId: `${story.key}:${line.key}`, date: line.date, description: line.description,
      amountCents: line.amountCents, category: line.category, counterparty: line.counterparty, counterpartyResourceType: line.amountCents > 0 ? "customer" : "vendor",
      status: line.status, method: line.method, memo: line.memo, receiptStatus: line.amountCents < 0 && line.category !== "Dividends paid" && line.category !== "Bank charges" ? "attached" : undefined,
      categorizedBy: "rule", reviewedAtISO: line.status === "posted" ? at(line.date, 21) : undefined,
    });
  }
  const fiscalYearLabel = (() => {
    const year = Number(asOf.slice(0, 4));
    const yearEnd = `${year}-${input.fyMonthDay}`;
    const endYear = yearEnd >= asOf ? year : year + 1;
    return input.fyMonthDay === "12-31" ? String(endYear) : `${endYear - 1}-${endYear}`;
  })();
  for (const line of finance.budget) {
    add("budgets", { _id: id(`budget_${line.category.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`), societyId, fiscalYear: fiscalYearLabel, category: line.category, plannedCents: line.plannedCents, currency: "CAD", notes: `Approved with the annual budget for ${input.identityName}.` });
  }
}

// ---------------------------------------------------------------------------
// Inserting through a database API (the Convex seed and the schema gate)
// ---------------------------------------------------------------------------

export type DemoInsertDb = {
  insert(table: string, doc: Record<string, any>): Promise<string>;
  patch(id: string, doc: Record<string, any>): Promise<void>;
};

/**
 * Insert a workspace built with ids that are only placeholders, swapping each
 * placeholder for the id the database returns. Fields that point at a row not
 * inserted yet (the society's own pointers, a meeting's minutes) are written
 * afterwards with a patch. Returns the real society id and the id map.
 */
export async function insertCorporationDemo(db: DemoInsertDb, demo: CorporationDemo): Promise<{ societyId: string; ids: Map<string, string> }> {
  const ids = new Map<string, string>();
  const placeholders = new Set<string>([demo.society._id, ...Object.values(demo.tables).flat().map((row) => row._id)]);
  const deferred: Array<{ placeholder: string; fields: Record<string, any> }> = [];
  // Ids also appear inside keys ("roleHolder:<id>", "director:<id>") and
  // provenance strings, so placeholders are matched within strings too.
  const pattern = new RegExp(`(${[...placeholders].sort((a, b) => b.length - a.length).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_])`, "g");
  const mentions = (text: string) => Array.from(text.matchAll(pattern), (match) => match[1]);
  const pending = (value: unknown): boolean =>
    typeof value === "string" ? mentions(value).some((placeholder) => !ids.has(placeholder))
      : Array.isArray(value) ? value.some(pending)
        : value && typeof value === "object" ? Object.values(value).some(pending) : false;
  const resolve = (value: unknown): unknown =>
    typeof value === "string" ? value.replace(pattern, (placeholder) => ids.get(placeholder) ?? placeholder)
      : Array.isArray(value) ? value.map(resolve)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([field, item]) => [field, resolve(item)])) : value;
  const write = async (table: string, row: DemoRow) => {
    const { _id, ...doc } = row;
    const now: Record<string, any> = {};
    const later: Record<string, any> = {};
    for (const [field, value] of Object.entries(doc)) {
      if (value === undefined) continue;
      if (pending(value)) {
        later[field] = value;
        // A required list (e.g. controllingIndividualIds) starts empty and is filled in afterwards.
        if (Array.isArray(value)) now[field] = [];
      } else now[field] = resolve(value);
    }
    let realId: string;
    try {
      realId = await db.insert(table, now);
    } catch (error) {
      throw new Error(`${table}.${_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    ids.set(_id, realId);
    if (Object.keys(later).length) deferred.push({ placeholder: _id, fields: later });
  };
  await write("societies", demo.society);
  const known = new Set<string>(CORPORATION_DEMO_TABLE_ORDER);
  const extra = Object.keys(demo.tables).filter((table) => !known.has(table));
  if (extra.length) throw new Error(`Add ${extra.join(", ")} to CORPORATION_DEMO_TABLE_ORDER.`);
  for (const table of CORPORATION_DEMO_TABLE_ORDER) {
    for (const row of demo.tables[table] ?? []) await write(table, row);
  }
  for (const { placeholder, fields } of deferred) {
    const unresolved = Object.entries(fields).filter(([, value]) => pending(value)).map(([field]) => field);
    if (unresolved.length) throw new Error(`Unresolved demo references on ${placeholder}: ${unresolved.join(", ")}.`);
    await db.patch(ids.get(placeholder)!, resolve(fields) as Record<string, any>);
  }
  return { societyId: ids.get(demo.society._id)!, ids };
}

/** Rows for the in-browser store: ids stay as generated; system fields added. */
export function corporationDemoLocalSeed(demo: CorporationDemo): CorporationDemoTables {
  const seed: CorporationDemoTables = { societies: [withSystemFields("societies", demo.society)] };
  for (const [table, rows] of Object.entries(demo.tables)) seed[table] = rows.map((row) => withSystemFields(table, row));
  return seed;
}

function withSystemFields(table: string, row: DemoRow): DemoRow {
  const clean: DemoRow = { _id: row._id };
  for (const [field, value] of Object.entries(row)) if (value !== undefined) clean[field] = value;
  // Lists that order by creation read in story order: a row is "created" when its event happened.
  const when = [row.createdAtISO, row.circulatedAtISO, row.uploadedAtISO, row.scheduledAt, row.heldAt, row.filedAt, row.declaredOn, row.transferDate, row.issuedOn, row.stepDate, row.startISO, row.appointedAtISO, row.termStart, row.date, row.dueDate]
    .find((value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return { ...clean, _creationTime: when ? Date.parse(when) : Date.parse("2026-01-01T00:00:00.000Z"), entityId: `${table}_${row._id}` };
}

/** Shares outstanding per class from the posted ledger (for summaries and the gate). */
export function describeShareStructure(demo: CorporationDemo): string {
  const classes = demo.tables.rightsClasses ?? [];
  const holdings = demo.tables.rightsHoldings ?? [];
  return classes.map((cls) => `${formatShares(holdings.filter((row) => row.rightsClassId === cls._id).reduce((sum, row) => sum + row.quantity, 0))} ${cls.className}`).join("; ");
}

export { dollars as formatDemoDollars };
