/**
 * Parsed registry documents → a reviewable import proposal → the args of
 * `organizationDetails.applyRegistryImport`.
 *
 * Rules:
 * - A value equal to what the organization holds, or one the documents
 *   disagree on, is not selected by default.
 * - Copies embedded in an official package (the certificate package, the BC
 *   cover-sheet package) are preferred over standalone downloads. A standalone
 *   copy that differs from the package copy is marked superseded and its
 *   differences are reported, never silently dropped.
 * - Directors and ISC data are shown for comparison only and never applied.
 */
import { incorporationJurisdictionForCode } from "../incorporationActs";
import { formatAddress, matchKey } from "./text";
import type {
  CurrentProfileSnapshot,
  ParsedRegistryDocument,
  RegistryAddress,
  RegistryAddressType,
  RegistryApplyPlan,
  RegistryDirector,
  RegistryDirectorsCheck,
  RegistryDocumentEntry,
  RegistryDocumentRefs,
  RegistryFacts,
  RegistryFeeEntry,
  RegistryIdentifierKind,
  RegistryImportAddressArgs,
  RegistryImportApplyArgs,
  RegistryImportIdentifierArgs,
  RegistryImportProfileArgs,
  RegistryImportProposal,
  RegistryImportRegistrationArgs,
  RegistryImportSelection,
  RegistryIscSummary,
  RegistryNameVariance,
  RegistryProfileField,
  RegistryProposalField,
  RegistryProposalGroup,
  RegistryProposalGroupKey,
  RegistryProposalOption,
  RegistryProposalSecret,
  RegistryProposalSource,
  RegistryProposalTarget,
  RegistryProposalValue,
  RegistryRegistrationField,
  RegistryRegistrationKey,
  RegistryRegistrationTarget,
  RegistrySectionKind,
  Sourced,
} from "./types";

const GROUP_LABELS: Record<RegistryProposalGroupKey, string> = {
  identity: "Identity",
  articles: "Articles",
  registrations: "Registrations",
  addresses: "Addresses",
  tax: "Tax accounts",
};

const PACKAGE_KINDS: RegistrySectionKind[] = ["federal_certificate_of_incorporation", "bc_cover_sheet"];

type DocInfo = {
  parsed: ParsedRegistryDocument;
  entry: RegistryDocumentEntry;
  /** 3 package, 2 standalone filing, 1 email, 0 superseded (conflict reporting only). */
  priority: number;
};

type Candidate = { value: RegistryProposalValue; display: string; key: string; source: RegistryProposalSource; priority: number };

function sourceOf(doc: DocInfo, snippet: string): RegistryProposalSource {
  return { fingerprint: doc.parsed.fingerprint, ...(doc.parsed.fileName ? { fileName: doc.parsed.fileName } : {}), title: doc.parsed.suggestedTitle, snippet };
}

function isPackage(parsed: ParsedRegistryDocument): boolean {
  return parsed.sections.length > 1 && PACKAGE_KINDS.includes(parsed.sections[0].kind);
}

function isEmail(parsed: ParsedRegistryDocument): boolean {
  return parsed.sections.some((section) => section.kind.endsWith("_email"));
}

// ---------------------------------------------------------------------------
// Documents: duplicates, package copies, superseded versions

/** Fingerprints and signatures leave secrets out, so copies that differ only by key are compared here (in memory only). */
function sameSecrets(a: ParsedRegistryDocument, b: ParsedRegistryDocument): boolean {
  const values = (document: ParsedRegistryDocument) => document.secrets.map((secret) => secret.reveal()).join("\n");
  return values(a) === values(b);
}

function analyseDocuments(parsed: ParsedRegistryDocument[]): DocInfo[] {
  const docs: DocInfo[] = [];
  const firstByFingerprint = new Map<string, DocInfo>();
  for (const document of parsed) {
    const entry: RegistryDocumentEntry = {
      fingerprint: document.fingerprint,
      ...(document.fileName ? { fileName: document.fileName } : {}),
      kind: document.kind,
      suggestedTitle: document.suggestedTitle,
      suggestedCategory: document.suggestedCategory,
      restricted: document.restricted,
      status: "primary",
      selectedByDefault: document.kind !== "unknown",
    };
    const info: DocInfo = { parsed: document, entry, priority: isPackage(document) ? 3 : isEmail(document) ? 1 : 2 };
    const first = firstByFingerprint.get(document.fingerprint);
    if (first && !sameSecrets(first.parsed, document)) {
      entry.note = `Same text as ${first.parsed.fileName ?? first.parsed.suggestedTitle} except the ${document.secrets[0]?.label.toLowerCase() ?? "secret"}.`;
    } else if (first) {
      Object.assign(entry, { status: "duplicate", relatedFingerprint: first.parsed.fingerprint, note: `Same content as ${first.parsed.fileName ?? first.parsed.suggestedTitle}.`, selectedByDefault: false });
    } else firstByFingerprint.set(document.fingerprint, info);
    docs.push(info);
  }

  const packages = docs.filter((doc) => doc.entry.status === "primary" && isPackage(doc.parsed));
  const standalone = docs.filter((doc) => doc.entry.status === "primary" && !isPackage(doc.parsed) && doc.parsed.sections.length === 1);
  for (const doc of standalone) {
    const section = doc.parsed.sections[0];
    const container = packages.find((candidate) => candidate.parsed.sections.some((other) => other.kind === section.kind));
    if (!container) continue;
    const packaged = container.parsed.sections.find((other) => other.kind === section.kind)!;
    const label = container.parsed.fileName ?? container.parsed.suggestedTitle;
    if (packaged.signature === section.signature && sameSecrets(container.parsed, doc.parsed)) {
      Object.assign(doc.entry, { status: "contained", relatedFingerprint: container.parsed.fingerprint, note: `The same content is in ${label}.`, selectedByDefault: false });
    } else {
      Object.assign(doc.entry, { status: "superseded", relatedFingerprint: container.parsed.fingerprint, note: `Differs from the copy in ${label}, which is preferred.`, selectedByDefault: false });
      doc.priority = 0;
    }
  }
  // Standalone copies of the same section with the same content, without a package.
  const seen = new Map<string, DocInfo>();
  for (const doc of standalone.filter((candidate) => candidate.entry.status === "primary")) {
    const signature = doc.parsed.sections[0].signature;
    const first = seen.get(signature);
    if (first && sameSecrets(first.parsed, doc.parsed)) Object.assign(doc.entry, { status: "duplicate", relatedFingerprint: first.parsed.fingerprint, note: `Same content as ${first.parsed.fileName ?? first.parsed.suggestedTitle}.`, selectedByDefault: false });
    else seen.set(signature, doc);
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Values

const text = (value: string): RegistryProposalValue => ({ kind: "text", value });

function display(value: RegistryProposalValue): string {
  switch (value.kind) {
    case "text": return value.value;
    case "number": return String(value.value);
    case "boolean": return value.value ? "Yes" : "No";
    case "address": return formatAddress(value.value);
    case "time": return `${value.value.time}${value.value.timeZone === "America/Vancouver" ? " Pacific time" : ` (${value.value.timeZone})`}`;
    case "attorney": return value.value.status === "not_required" ? `Not required${value.value.reason ? `: ${value.value.reason}` : ""}` : value.value.status === "appointed" ? "Appointed" : "Required";
    case "portalAccess": return `${value.value.role ?? "Portal access"}${value.value.updatedAtISO ? ` · updated ${value.value.updatedAtISO.slice(0, 10)}` : ""}`;
  }
}

function addressKey(address: RegistryAddress): string {
  return matchKey([address.unit, address.street, address.city, address.provinceState, address.postalCode?.replace(/\s+/g, "")].filter(Boolean).join(" "));
}

function key(value: RegistryProposalValue, digitsOnly = false): string {
  switch (value.kind) {
    case "text": return digitsOnly ? value.value.replace(/\D/g, "") : matchKey(value.value);
    case "number": return String(value.value);
    case "boolean": return String(value.value);
    case "address": return addressKey(value.value);
    case "time": return `${value.value.time}|${value.value.timeZone}`;
    case "attorney": return value.value.status;
    case "portalAccess": return `${value.value.role ?? ""}|${value.value.updatedAtISO ?? ""}`;
  }
}

function formatFederalNumber(digits: string): string {
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 7)}-${digits.slice(7)}` : digits;
}

type Collect = <T>(pick: (facts: RegistryFacts) => Sourced<T> | undefined, toValue: (value: T) => RegistryProposalValue | undefined, options?: { digitsOnly?: boolean }) => Candidate[];

function collector(docs: DocInfo[]): Collect {
  const usable = docs.filter((doc) => doc.entry.status !== "duplicate");
  return (pick, toValue, options) => {
    const candidates: Candidate[] = [];
    for (const doc of usable) {
      const fact = pick(doc.parsed.facts);
      if (!fact) continue;
      const value = toValue(fact.value);
      if (!value) continue;
      candidates.push({ value, display: display(value), key: key(value, options?.digitsOnly), source: sourceOf(doc, fact.snippet), priority: doc.priority });
    }
    // A superseded copy only speaks up when it disagrees.
    const live = new Set(candidates.filter((candidate) => candidate.priority > 0).map((candidate) => candidate.key));
    return candidates.filter((candidate) => candidate.priority > 0 || (live.size > 0 && !live.has(candidate.key))).sort((a, b) => b.priority - a.priority);
  };
}

type CurrentValue = { value: RegistryProposalValue; key: string } | undefined;

function makeField(
  id: string,
  group: RegistryProposalGroupKey,
  label: string,
  target: RegistryProposalTarget,
  candidates: Candidate[],
  current: CurrentValue,
  extra: { effectiveDate?: string; currentId?: string } = {},
): RegistryProposalField | undefined {
  if (!candidates.length) return undefined;
  const options: RegistryProposalOption[] = [];
  const byKey = new Map<string, RegistryProposalOption>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key);
    if (existing) {
      existing.sources.push(candidate.source);
      continue;
    }
    const option = { value: candidate.value, display: candidate.display, sources: [candidate.source] };
    byKey.set(candidate.key, option);
    options.push(option);
  }
  const proposed = options[0];
  const equalsCurrent = Boolean(current && current.key === candidates[0].key);
  const conflict = options.length > 1 ? { note: `The documents disagree: ${options.map((option) => `“${option.display}”`).join(" or ")}. The first is from the preferred copy.`, options } : undefined;
  const info = target.scope === "info";
  return {
    id,
    group,
    label,
    target,
    proposed: proposed.value,
    display: proposed.display,
    ...(current ? { current: current.value, currentDisplay: display(current.value) } : {}),
    sources: options.flatMap((option) => option.sources),
    ...(conflict ? { conflict } : {}),
    ...(extra.effectiveDate ? { effectiveDate: extra.effectiveDate } : {}),
    ...(extra.currentId ? { currentId: extra.currentId } : {}),
    equalsCurrent,
    replacesCurrent: Boolean(current && !equalsCurrent),
    selectedByDefault: !info && !equalsCurrent && !conflict,
  };
}

function currentText(value: string | number | boolean | null | undefined, digitsOnly = false): CurrentValue {
  if (value === undefined || value === null || value === "") return undefined;
  const proposalValue: RegistryProposalValue = typeof value === "number" ? { kind: "number", value } : typeof value === "boolean" ? { kind: "boolean", value } : text(value);
  return { value: proposalValue, key: key(proposalValue, digitsOnly) };
}

// ---------------------------------------------------------------------------
// Build

/**
 * Turn parsed documents into a reviewable proposal, compared with the
 * organization's current values. Pass every parsed file, duplicates included:
 * the Documents group reports them.
 */
export function buildRegistryImportProposal(parsed: ParsedRegistryDocument[], current: CurrentProfileSnapshot = {}): RegistryImportProposal {
  const docs = analyseDocuments(parsed);
  const collect = collector(docs);
  const profile = current.profile ?? {};
  const fields: RegistryProposalField[] = [];
  const push = (field: RegistryProposalField | undefined) => {
    if (field) fields.push(field);
  };
  const profileField = (field: RegistryProfileField, group: RegistryProposalGroupKey, label: string, candidates: Candidate[], digitsOnly = false) =>
    push(makeField(`profile.${field}`, group, label, { scope: "profile", field }, candidates, currentText(profile[field], digitsOnly)));
  // Before the certificate is recorded, the number and date are shown for
  // reference only: "Record incorporation" sets them, with the certificate.
  const awaitingCertificate = current.formationStatus === "preparing" || current.formationStatus === "submitted";
  const certificateField = (field: "incorporationNumber" | "incorporationDate", label: string, candidates: Candidate[], digitsOnly = false) => {
    if (!awaitingCertificate) return profileField(field, "identity", label, candidates, digitsOnly);
    const made = makeField(`profile.${field}`, "identity", label, { scope: "info" }, candidates, currentText(profile[field], digitsOnly));
    push(made && { ...made, note: "Set by Record incorporation, with the certificate." });
  };

  // Identity
  const names = [
    ...collect((facts) => facts.legalName, text),
    ...collect((facts) => facts.nameInHomeJurisdiction, text),
  ].sort((a, b) => b.priority - a.priority);
  profileField("name", "identity", "Legal name", names);
  const corporationNumbers = [
    ...collect((facts) => facts.corporationNumber, text, { digitsOnly: true }),
    ...collect((facts) => facts.homeCorporationNumber, (value) => text(formatFederalNumber(value)), { digitsOnly: true }),
  ].sort((a, b) => b.priority - a.priority);
  const federalNumbers = corporationNumbers.filter((candidate) => candidate.value.kind === "text" && /^\d{7}-\d$/.test(candidate.value.value));
  certificateField("incorporationNumber", "Corporation number", federalNumbers, true);
  const incorporationDates = [
    ...collect((facts) => facts.incorporationDate, text),
    ...collect((facts) => facts.homeIncorporationDate, text),
  ].sort((a, b) => b.priority - a.priority);
  certificateField("incorporationDate", "Date of incorporation", incorporationDates);
  const incorporationDate = incorporationDates[0]?.value.kind === "text" ? incorporationDates[0].value.value : undefined;
  profileField("anniversaryDate", "identity", "Anniversary date", collect((facts) => facts.anniversaryMonthDay ? { ...facts.anniversaryMonthDay, value: { monthDay: facts.anniversaryMonthDay.value, firstYear: facts.annualReturnWindow?.value.firstYear } } : undefined, ({ monthDay, firstYear }) => {
    if (incorporationDate && incorporationDate.slice(5) === monthDay) return text(incorporationDate);
    if (firstYear) return text(`${firstYear - 1}-${monthDay}`);
    return incorporationDate ? text(`${incorporationDate.slice(0, 4)}-${monthDay}`) : undefined;
  }));
  push(makeField("info.annualReturnWindow", "identity", "Annual return window", { scope: "info" }, collect((facts) => facts.annualReturnWindow, (value) => text(`${value.start} to ${value.end}${value.firstYear ? `, first in ${value.firstYear}` : ""}`)), undefined));
  profileField("actFormedUnder", "identity", "Act", collect((facts) => facts.actFormedUnder, text));
  const jurisdictionCodes = collect((facts) => facts.jurisdictionCode, text);
  profileField("jurisdictionCode", "identity", "Jurisdiction", jurisdictionCodes);
  profileField("officialEmail", "identity", "Registry notification email", collect((facts) => facts.notificationEmail, text));

  // Articles
  profileField("articlesMinDirectors", "articles", "Minimum directors", collect((facts) => facts.minDirectors, (value) => ({ kind: "number", value })));
  profileField("articlesMaxDirectors", "articles", "Maximum directors", collect((facts) => facts.maxDirectors, (value) => ({ kind: "number", value })));
  profileField("articlesShareTransferRestrictions", "articles", "Share transfer restrictions", collect((facts) => facts.shareTransferRestrictions, text));
  profileField("articlesBusinessRestrictions", "articles", "Restrictions on business", collect((facts) => facts.businessRestrictions, text));
  profileField("articlesOtherProvisions", "articles", "Other provisions", collect((facts) => facts.otherProvisions, text));
  push(makeField("info.shareClasses", "articles", "Share classes", { scope: "info" }, collect((facts) => facts.shareClasses, text), undefined));
  push(makeField("info.registeredOfficeProvince", "articles", "Registered office province", { scope: "info" }, collect((facts) => facts.registeredOfficeProvince, text), undefined));
  push(makeField("info.incorporators", "articles", "Incorporators", { scope: "info" }, collect((facts) => facts.incorporators, (value) => text(value.join(", "))), undefined));

  // Registrations
  const federalCode = (jurisdictionCodes[0]?.value.kind === "text" ? jurisdictionCodes[0].value.value : undefined)
    ?? (incorporationJurisdictionForCode(String(profile.jurisdictionCode ?? ""))?.id === "CA" ? String(profile.jurisdictionCode) : undefined);
  const registrationTargets: RegistryRegistrationTarget[] = [];
  const hasFederal = docs.some((doc) => doc.parsed.sections.some((section) => section.kind.startsWith("federal_")));
  const hasBc = docs.some((doc) => doc.parsed.sections.some((section) => section.kind.startsWith("bc_")));
  if (hasFederal) {
    const code = federalCode ?? "CA-FED";
    registrationTargets.push({ key: "home", label: "Federal (home)", registrationType: "home", jurisdiction: code, homeJurisdiction: code });
  }
  if (hasBc) {
    const homeFact = collect((facts) => facts.homeJurisdictionCode, text)[0];
    const homeCode = homeFact?.value.kind === "text" ? homeFact.value.value : undefined;
    const homeJurisdiction = homeCode === "CA-FED" && federalCode ? federalCode : homeCode;
    registrationTargets.push({ key: "bc", label: "British Columbia (extra-provincial)", registrationType: "extra_provincial", jurisdiction: "CA-BC", ...(homeJurisdiction ? { homeJurisdiction } : {}) });
  }
  const currentRegistration = (target: RegistryRegistrationKey) => (current.registrations ?? []).find((registration) => target === "home"
    ? registration.registrationType === "home"
    : registration.registrationType === "extra_provincial" && incorporationJurisdictionForCode(registration.jurisdiction ?? "")?.id === "BC");
  for (const target of registrationTargets) {
    const existingId = currentRegistration(target.key)?.id;
    if (existingId) target.existingId = existingId;
  }
  const registrationField = (target: RegistryRegistrationKey, field: RegistryRegistrationField, label: string, candidates: Candidate[], currentValue: CurrentValue) => {
    const meta = registrationTargets.find((candidate) => candidate.key === target);
    push(makeField(`registration.${target}.${field}`, "registrations", `${meta?.label ?? target} · ${label}`, { scope: "registration", registration: target, field }, candidates, currentValue, meta?.existingId ? { currentId: meta.existingId } : {}));
  };
  if (hasFederal) {
    const existing = currentRegistration("home");
    registrationField("home", "registrationNumber", "Registration number", collect((facts) => facts.corporationNumber, text, { digitsOnly: true }), currentText(existing?.registrationNumber, true));
    registrationField("home", "registrationDate", "Registration date", collect((facts) => facts.incorporationDate, text), currentText(existing?.registrationDate));
    registrationField("home", "reminderEmailsSubscribed", "Annual return reminder emails", collect((facts) => facts.reminderEmailsSubscribed, (value) => ({ kind: "boolean", value })), currentText(existing?.reminderEmailsSubscribed));
    registrationField("home", "publicRecordUrl", "Public record", collect((facts) => facts.publicRecordUrl, text), currentText(existing?.publicRecordUrl));
    const access = existing?.portalAccess?.find((entry) => /online filing centre/i.test(entry.role ?? ""));
    registrationField("home", "portalAccess", "Online Filing Centre access", collect((facts) => facts.portalAccess, (value) => ({ kind: "portalAccess", value: { role: `${value.portal} access`, ...(value.updatedAtISO ? { updatedAtISO: value.updatedAtISO } : {}), ...(value.notes ? { notes: value.notes } : {}) } })),
      access ? { value: { kind: "portalAccess", value: { role: access.role, updatedAtISO: access.updatedAtISO } }, key: `${access.role ?? ""}|${access.updatedAtISO ?? ""}` } : undefined);
  }
  if (hasBc) {
    const existing = currentRegistration("bc");
    registrationField("bc", "registrationNumber", "Registration number", collect((facts) => facts.bcRegistrationNumber, text), currentText(existing?.registrationNumber));
    registrationField("bc", "registrationDate", "Registration date", collect((facts) => facts.bcRegistrationDate, text), currentText(existing?.registrationDate));
    registrationField("bc", "registrationTime", "Registration time", collect((facts) => facts.bcRegistrationTime ? { ...facts.bcRegistrationTime, value: { time: facts.bcRegistrationTime.value, timeZone: facts.bcRegistrationTimeZone?.value ?? "America/Vancouver" } } : undefined, (value) => ({ kind: "time", value })),
      existing?.registrationTime ? { value: { kind: "time", value: { time: existing.registrationTime, timeZone: existing.registrationTimeZone ?? "America/Vancouver" } }, key: `${existing.registrationTime}|${existing.registrationTimeZone ?? "America/Vancouver"}` } : undefined);
    registrationField("bc", "homeCorporationNumber", "Home corporation number", collect((facts) => facts.homeCorporationNumber, text, { digitsOnly: true }), currentText(existing?.homeCorporationNumber, true));
    registrationField("bc", "nameInHomeJurisdiction", "Name in home jurisdiction", collect((facts) => facts.nameInHomeJurisdiction, text), currentText(existing?.nameInHomeJurisdiction));
    registrationField("bc", "attorneyStatus", "Attorney", collect((facts) => facts.attorney, (value) => ({ kind: "attorney", value: { status: value.status, ...(value.reason ? { reason: value.reason } : {}) } })),
      existing?.attorneyStatus === "required" || existing?.attorneyStatus === "not_required" || existing?.attorneyStatus === "appointed"
        ? { value: { kind: "attorney", value: { status: existing.attorneyStatus, ...(existing.attorneyNotRequiredReason ? { reason: existing.attorneyNotRequiredReason } : {}) } }, key: existing.attorneyStatus }
        : undefined);
  }

  // Addresses
  const bcDate = collect((facts) => facts.bcRegistrationDate, text)[0];
  const addressField = (type: RegistryAddressType, label: string, pick: (facts: RegistryFacts) => Sourced<RegistryAddress> | undefined, effectiveDate?: string) => {
    const existing = (current.addresses ?? []).find((address) => address.type === type && (address.status ?? "current") === "current");
    const currentValue: CurrentValue = existing ? {
      value: { kind: "address", value: { street: existing.street, ...(existing.unit ? { unit: existing.unit } : {}), city: existing.city, ...(existing.provinceState ? { provinceState: existing.provinceState } : {}), ...(existing.postalCode ? { postalCode: existing.postalCode } : {}), country: existing.country ?? "Canada" } },
      key: addressKey({ street: existing.street, unit: existing.unit ?? undefined, city: existing.city, provinceState: existing.provinceState ?? undefined, postalCode: existing.postalCode ?? undefined, country: existing.country ?? "" }),
    } : undefined;
    const made = makeField(`address.${type}`, "addresses", label, { scope: "address", addressType: type }, collect(pick, (value) => ({ kind: "address", value })), currentValue, effectiveDate ? { effectiveDate } : {});
    // An older filing never replaces a newer current address by default; applied, it is kept as a past one.
    const newer = made && !made.equalsCurrent && effectiveDate && existing?.effectiveFrom && effectiveDate < existing.effectiveFrom;
    push(made && newer ? { ...made, selectedByDefault: false, note: `Older than the current address (from ${existing?.effectiveFrom}). Applied, it is kept as a past address.` } : made);
  };
  addressField("registered_office", "Registered office", (facts) => facts.registeredOfficeAddress, incorporationDate);
  const bcDateValue = bcDate?.value.kind === "text" ? bcDate.value.value : undefined;
  addressField("head_office_mailing", "Head office · mailing", (facts) => facts.headOfficeMailing, bcDateValue);
  addressField("head_office_delivery", "Head office · delivery", (facts) => facts.headOfficeDelivery, bcDateValue);

  // Tax
  const businessNumbers = collect((facts) => facts.businessNumber, text, { digitsOnly: true });
  const bnDate = collect((facts) => facts.businessNumber ? facts.emailDateISO : undefined, (value) => text(value.slice(0, 10)))[0];
  const bnRegisteredAt = bnDate?.value.kind === "text" ? bnDate.value.value : undefined;
  const identifierField = (kind: RegistryIdentifierKind, label: string, candidates: Candidate[]) => {
    const existing = (current.identifiers ?? []).find((identifier) => identifier.kind === kind);
    const currentValue: CurrentValue = existing ? { value: text(existing.number), key: existing.number.replace(/[^0-9A-Za-z]/g, "").toUpperCase() } : undefined;
    const keyed = candidates.map((candidate) => ({ ...candidate, key: candidate.display.replace(/[^0-9A-Za-z]/g, "").toUpperCase() }));
    push(makeField(`identifier.${kind}`, "tax", label, { scope: "identifier", identifierKind: kind }, keyed, currentValue, { ...(bnRegisteredAt ? { effectiveDate: bnRegisteredAt } : {}), ...(existing?.id ? { currentId: existing.id } : {}) }));
  };
  identifierField("business_number", "Business number (BN)", businessNumbers);
  const incomeTax = collect((facts) => facts.businessNumber && facts.programAccounts ? { ...facts.programAccounts, value: { bn: facts.businessNumber.value, accounts: facts.programAccounts.value } } : undefined, ({ bn, accounts }) => {
    const account = accounts.find((candidate) => /^RC\d{4}$/.test(candidate));
    return account ? text(`${bn}${account}`) : undefined;
  });
  identifierField("income_tax", "Corporation income tax account (RC)", incomeTax);
  if (businessNumbers.length) profileField("craBnStatus", "tax", "CRA business number status", businessNumbers.map((candidate) => ({ ...candidate, value: text("confirmed"), display: "confirmed", key: "confirmed" })));
  if (incomeTax.length) profileField("craRcStatus", "tax", "Corporation income tax (RC) status", incomeTax.map((candidate) => ({ ...candidate, value: text("confirmed"), display: "confirmed", key: "confirmed" })));

  const groups: RegistryProposalGroup[] = (Object.keys(GROUP_LABELS) as RegistryProposalGroupKey[])
    .map((group) => ({ key: group, label: GROUP_LABELS[group], fields: fields.filter((field) => field.group === group) }))
    .filter((group) => group.fields.length);

  const directorsCheck = buildDirectorsCheck(docs, current);
  const isc = buildIscSummary(docs);
  const fees = buildFees(docs);
  const secrets = buildSecrets(docs, current);

  const conflicts = [
    ...fields.filter((field) => field.conflict).map((field) => `${field.label}: ${field.conflict!.note}`),
    ...(directorsCheck?.nameVariances ?? []).map((variance) => {
      const fromPackage = docs.some((doc) => doc.parsed.fingerprint === variance.preferredSource.fingerprint && isPackage(doc.parsed));
      return `${variance.subject === "director" ? "Director name" : "Corporate name"} differs between versions: “${variance.preferred}” in ${variance.preferredSource.fileName ?? variance.preferredSource.title} and “${variance.other}” in ${variance.otherSource.fileName ?? variance.otherSource.title}.${fromPackage ? " The copy in the certificate package is preferred." : ""} Check which is the full legal name.`;
    }),
    ...(secrets.length > 1 ? ["Different corporation keys were found. Check which one is current before saving it."] : []),
  ];
  const warnings = [...new Set(docs.filter((doc) => doc.entry.status !== "duplicate").flatMap((doc) => doc.parsed.warnings.map((warning) => `${doc.parsed.fileName ?? doc.parsed.suggestedTitle}: ${warning}`)))];

  const role = (kind: RegistrySectionKind) => {
    const holders = docs.filter((doc) => (doc.entry.status === "primary" || doc.entry.status === "contained") && doc.parsed.sections.some((section) => section.kind === kind));
    return (holders.find((doc) => isPackage(doc.parsed)) ?? holders[0])?.parsed.fingerprint;
  };
  const federalCertificate = role("federal_certificate_of_incorporation");
  const articles = role("federal_articles_of_incorporation");
  const bcCertificate = role("bc_certificate_of_registration");

  return {
    groups,
    registrationTargets,
    documentRoles: { ...(federalCertificate ? { federalCertificate } : {}), ...(articles ? { articles } : {}), ...(bcCertificate ? { bcCertificate } : {}) },
    ...(directorsCheck ? { directorsCheck } : {}),
    ...(isc ? { isc } : {}),
    documents: docs.map((doc) => doc.entry),
    fees,
    secrets,
    conflicts,
    warnings,
  };
}

function lastToken(name: string): string {
  const tokens = matchKey(name).split(" ");
  return tokens[tokens.length - 1] ?? "";
}

function buildDirectorsCheck(docs: DocInfo[], current: CurrentProfileSnapshot): RegistryDirectorsCheck | undefined {
  const versions = docs.filter((doc) => doc.entry.status !== "duplicate" && doc.parsed.facts.directors);
  if (!versions.length) return undefined;
  const preferred = versions.find((doc) => isPackage(doc.parsed)) ?? versions.find((doc) => doc.entry.status !== "superseded") ?? versions[0];
  const directorsFact = preferred.parsed.facts.directors!;
  const directors: RegistryDirector[] = directorsFact.value;
  const residentCount = directors.filter((director) => director.residentCanadian).length;
  const total = directors.length;
  const meetsResidencyRule = total > 0 && (total < 4 ? residentCount >= 1 : residentCount * 4 >= total);
  const rule = total < 4 ? "at least one is needed when there are fewer than four directors" : "at least 25% are needed";
  const note = `${residentCount} of ${total} director${total === 1 ? " is a" : "s are"} resident Canadian${total === 1 ? "" : "s"}; ${rule}.`;

  const nameVariances: RegistryNameVariance[] = [];
  const preferredSource = sourceOf(preferred, directorsFact.snippet);
  for (const other of versions) {
    if (other === preferred) continue;
    const otherSource = sourceOf(other, other.parsed.facts.directors!.snippet);
    for (const director of other.parsed.facts.directors!.value) {
      if (directors.some((candidate) => matchKey(candidate.name) === matchKey(director.name))) continue;
      const match = directors.find((candidate) => lastToken(candidate.name) === lastToken(director.name) || matchKey(candidate.name).split(" ")[0] === matchKey(director.name).split(" ")[0]);
      if (match) nameVariances.push({ subject: "director", preferred: match.name, other: director.name, preferredSource, otherSource });
    }
    const preferredName = preferred.parsed.facts.legalName?.value;
    const otherName = other.parsed.facts.legalName?.value;
    if (preferredName && otherName && matchKey(preferredName) !== matchKey(otherName)) {
      nameVariances.push({ subject: "corporate_name", preferred: preferredName, other: otherName, preferredSource: sourceOf(preferred, preferred.parsed.facts.legalName!.snippet), otherSource: sourceOf(other, other.parsed.facts.legalName!.snippet) });
    }
  }
  const register = (current.directors ?? []).map((director) => matchKey(director.name));
  return {
    directors,
    residentCount,
    total,
    meetsResidencyRule,
    note,
    sources: [preferredSource],
    comparison: directors.map((director) => ({ name: director.name, inRegister: register.includes(matchKey(director.name)) })),
    nameVariances,
  };
}

function buildIscSummary(docs: DocInfo[]): RegistryIscSummary | undefined {
  const doc = docs.find((candidate) => candidate.entry.status !== "duplicate" && candidate.parsed.facts.iscIndividualNames);
  if (!doc) return undefined;
  const names = doc.parsed.facts.iscIndividualNames!.value;
  const received = doc.parsed.facts.iscReceivedDate;
  return {
    ...(received ? { receivedDate: received.value } : {}),
    names,
    count: names.length,
    sources: [sourceOf(doc, doc.parsed.facts.iscIndividualNames!.snippet)],
    registerPath: "/app/significant-individuals",
  };
}

function buildFees(docs: DocInfo[]): RegistryFeeEntry[] {
  const fees: RegistryFeeEntry[] = [];
  for (const doc of docs.filter((candidate) => candidate.entry.status !== "duplicate")) {
    for (const fact of [doc.parsed.facts.payment, doc.parsed.facts.filingReceipt]) {
      if (!fact) continue;
      const id = fact.value.transactionId ?? fact.value.invoiceNumber ?? fact.value.reference;
      const existing = id ? fees.find((fee) => (fee.transactionId ?? fee.invoiceNumber ?? fee.reference) === id) : undefined;
      if (existing) existing.sources.push(sourceOf(doc, fact.snippet));
      else fees.push({ ...fact.value, sources: [sourceOf(doc, fact.snippet)] });
    }
  }
  return fees;
}

function buildSecrets(docs: DocInfo[], current: CurrentProfileSnapshot): RegistryProposalSecret[] {
  const secrets: RegistryProposalSecret[] = [];
  const seen = new Map<string, RegistryProposalSecret>();
  for (const doc of docs.filter((candidate) => candidate.entry.status !== "duplicate")) {
    for (const secret of doc.parsed.secrets) {
      const value = secret.reveal();
      const source = sourceOf(doc, `${secret.label}: ${secret.masked}`);
      const existing = seen.get(value);
      if (existing) {
        existing.sources.push(source);
        continue;
      }
      const name = doc.parsed.facts.legalName?.value;
      const item: RegistryProposalSecret = {
        id: secrets.length ? `secret.${secret.kind}.${secrets.length + 1}` : `secret.${secret.kind}`,
        kind: secret.kind,
        label: name ? `${secret.label} – ${name}` : secret.label,
        masked: secret.masked,
        sources: [source],
        hasCurrent: Boolean(current.hasCorporationKey),
        selectedByDefault: !current.hasCorporationKey,
        reveal: secret.reveal,
      };
      seen.set(value, item);
      secrets.push(item);
    }
  }
  if (secrets.length > 1) for (const secret of secrets) secret.selectedByDefault = false;
  return secrets;
}

// ---------------------------------------------------------------------------
// Selection and apply

/** Every field and secret at its `selectedByDefault`. */
export function defaultRegistryImportSelection(proposal: RegistryImportProposal): RegistryImportSelection {
  const selected: Record<string, boolean> = {};
  for (const group of proposal.groups) for (const field of group.fields) if (field.target.scope !== "info") selected[field.id] = field.selectedByDefault;
  for (const secret of proposal.secrets) selected[secret.id] = secret.selectedByDefault;
  return { selected };
}

function chosen(field: RegistryProposalField, selection: RegistryImportSelection): RegistryProposalValue {
  const options = field.conflict?.options;
  if (!options) return field.proposed;
  const index = selection.choices?.[field.id] ?? 0;
  return (options[index] ?? options[0]).value;
}

function textOf(value: RegistryProposalValue): string | undefined {
  return value.kind === "text" ? value.value : undefined;
}

const NUMBER_FIELDS: ReadonlySet<RegistryProfileField> = new Set(["articlesMinDirectors", "articlesMaxDirectors"]);
const ARTICLE_FIELDS: ReadonlySet<RegistryProfileField> = new Set(["articlesMinDirectors", "articlesMaxDirectors", "articlesShareTransferRestrictions", "articlesBusinessRestrictions", "articlesOtherProvisions"]);

/**
 * The reviewed selection → `applyRegistryImport` args, plus `documentRefs`:
 * which uploaded file (by fingerprint) backs `articlesSourceDocumentId`,
 * a registration's `certificateDocumentId` and its `sourceDocumentIds`. Fill
 * them in with `withRegistryDocumentIds` once the files are uploaded.
 */
export function proposalToApplyArgs(proposal: RegistryImportProposal, selection: RegistryImportSelection): RegistryApplyPlan {
  const profileArgs: RegistryImportProfileArgs<never> = {};
  const registrations = new Map<RegistryRegistrationKey, { args: RegistryImportRegistrationArgs<never>; sources: Set<string> }>();
  const addresses: NonNullable<RegistryImportApplyArgs<never>["addresses"]> = [];
  const identifiers: NonNullable<RegistryImportApplyArgs<never>["identifiers"]> = [];
  const addressSources: string[][] = [];
  const identifierSources: string[][] = [];
  let articlesSelected = false;

  for (const group of proposal.groups) {
    for (const field of group.fields) {
      const target = field.target;
      if (target.scope === "info" || !selection.selected[field.id]) continue;
      const value = chosen(field, selection);
      if (target.scope === "profile") {
        if (NUMBER_FIELDS.has(target.field)) {
          if (value.kind === "number") Object.assign(profileArgs, { [target.field]: value.value });
        } else {
          const textValue = textOf(value);
          if (textValue !== undefined) Object.assign(profileArgs, { [target.field]: textValue });
        }
        if (ARTICLE_FIELDS.has(target.field)) articlesSelected = true;
      } else if (target.scope === "registration") {
        const meta = proposal.registrationTargets.find((candidate) => candidate.key === target.registration);
        if (!meta) continue;
        const entry = registrations.get(target.registration) ?? { args: { ...(meta.existingId ? { id: meta.existingId } : {}), registrationType: meta.registrationType, jurisdiction: meta.jurisdiction, ...(meta.homeJurisdiction ? { homeJurisdiction: meta.homeJurisdiction } : {}), status: "active" }, sources: new Set<string>() };
        const args = entry.args;
        if (value.kind === "text" && (target.field === "registrationNumber" || target.field === "registrationDate" || target.field === "homeCorporationNumber" || target.field === "nameInHomeJurisdiction" || target.field === "publicRecordUrl")) args[target.field] = value.value;
        else if (value.kind === "boolean" && target.field === "reminderEmailsSubscribed") args.reminderEmailsSubscribed = value.value;
        else if (value.kind === "time") {
          args.registrationTime = value.value.time;
          args.registrationTimeZone = value.value.timeZone;
        } else if (value.kind === "attorney") {
          args.attorneyStatus = value.value.status;
          if (value.value.reason) args.attorneyNotRequiredReason = value.value.reason;
        } else if (value.kind === "portalAccess") {
          const name = selection.portalAccessName?.trim();
          if (!name) continue;
          args.portalAccess = [{ name, ...(value.value.role ? { role: value.value.role } : {}), ...(value.value.updatedAtISO ? { updatedAtISO: value.value.updatedAtISO } : {}), ...(value.value.notes ? { notes: value.value.notes } : {}) }];
        } else continue;
        for (const source of field.sources) entry.sources.add(source.fingerprint);
        registrations.set(target.registration, entry);
      } else if (target.scope === "address" && value.kind === "address") {
        addresses.push({ type: target.addressType, status: "current", ...value.value, ...(field.effectiveDate ? { effectiveFrom: field.effectiveDate } : {}) });
        addressSources.push(field.sources.map((source) => source.fingerprint));
      } else if (target.scope === "identifier" && value.kind === "text") {
        identifiers.push({ ...(field.currentId ? { id: field.currentId } : {}), kind: target.identifierKind, number: value.value, ...(field.effectiveDate ? { registeredAt: field.effectiveDate } : {}), status: "active", accessLevel: "restricted" });
        identifierSources.push(field.sources.map((source) => source.fingerprint));
      }
    }
  }

  const documentRefs: RegistryDocumentRefs = {};
  const addRef = (fingerprint: string | undefined, ref: RegistryDocumentRefs[string][number]) => {
    if (!fingerprint) return;
    (documentRefs[fingerprint] ??= []).push(ref);
  };
  if (articlesSelected) addRef(proposal.documentRoles.articles, { target: "profile.articlesSourceDocumentId" });
  const registrationArgs: RegistryImportRegistrationArgs<never>[] = [];
  for (const [key, entry] of registrations) {
    const registrationIndex = registrationArgs.length;
    registrationArgs.push(entry.args);
    addRef(key === "home" ? proposal.documentRoles.federalCertificate : proposal.documentRoles.bcCertificate, { target: "registration.certificateDocumentId", registrationIndex });
    for (const fingerprint of entry.sources) addRef(fingerprint, { target: "registration.sourceDocumentIds", registrationIndex });
  }
  addressSources.forEach((fingerprints, addressIndex) => new Set(fingerprints).forEach((fingerprint) => addRef(fingerprint, { target: "address.sourceDocumentIds", addressIndex })));
  identifierSources.forEach((fingerprints, identifierIndex) => new Set(fingerprints).forEach((fingerprint) => addRef(fingerprint, { target: "identifier.sourceDocumentIds", identifierIndex })));

  const secret = proposal.secrets.find((candidate) => selection.selected[candidate.id]);
  const args: RegistryImportApplyArgs<never> = {
    ...(Object.keys(profileArgs).length ? { profile: profileArgs } : {}),
    ...(registrationArgs.length ? { registrations: registrationArgs } : {}),
    ...(addresses.length ? { addresses } : {}),
    ...(identifiers.length ? { identifiers } : {}),
    ...(secret ? { corporationKey: { value: secret.reveal(), label: secret.label } } : {}),
  };
  return { args, documentRefs };
}

/** Put uploaded document ids (by file fingerprint) into the apply args. Files without an id are skipped. */
export function withRegistryDocumentIds<DocId extends string>(plan: RegistryApplyPlan, idsByFingerprint: Partial<Record<string, DocId>>): RegistryImportApplyArgs<DocId> {
  const profile: RegistryImportProfileArgs<DocId> | undefined = plan.args.profile ? { ...plan.args.profile } : undefined;
  const registrations: RegistryImportRegistrationArgs<DocId>[] | undefined = plan.args.registrations?.map((registration) => ({ ...registration }));
  const addresses: RegistryImportAddressArgs<DocId>[] | undefined = plan.args.addresses?.map((address) => ({ ...address }));
  const identifiers: RegistryImportIdentifierArgs<DocId>[] | undefined = plan.args.identifiers?.map((identifier) => ({ ...identifier }));
  const addSource = (row: { sourceDocumentIds?: DocId[] } | undefined, id: DocId) => {
    if (row && !row.sourceDocumentIds?.includes(id)) row.sourceDocumentIds = [...(row.sourceDocumentIds ?? []), id];
  };
  let articlesId: DocId | undefined;
  for (const [fingerprint, refs] of Object.entries(plan.documentRefs)) {
    const id = idsByFingerprint[fingerprint];
    if (!id) continue;
    for (const ref of refs) {
      if (ref.target === "profile.articlesSourceDocumentId") articlesId = id;
      if (ref.target === "address.sourceDocumentIds") addSource(addresses?.[ref.addressIndex], id);
      if (ref.target === "identifier.sourceDocumentIds") addSource(identifiers?.[ref.identifierIndex], id);
      const registration = "registrationIndex" in ref ? registrations?.[ref.registrationIndex] : undefined;
      if (!registration) continue;
      if (ref.target === "registration.certificateDocumentId") registration.certificateDocumentId = id;
      else if (ref.target === "registration.sourceDocumentIds" && !registration.sourceDocumentIds?.includes(id)) registration.sourceDocumentIds = [...(registration.sourceDocumentIds ?? []), id];
    }
  }
  const finalProfile = articlesId ? { ...(profile ?? {}), articlesSourceDocumentId: articlesId } : profile;
  return {
    ...(finalProfile ? { profile: finalProfile } : {}),
    ...(registrations ? { registrations } : {}),
    ...(addresses ? { addresses } : {}),
    ...(identifiers ? { identifiers } : {}),
    ...(plan.args.corporationKey ? { corporationKey: plan.args.corporationKey } : {}),
  };
}
