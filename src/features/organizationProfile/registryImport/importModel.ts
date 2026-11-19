import {
  buildRegistryImportProposal,
  parseRegistryDocument,
  type CurrentProfileSnapshot,
  type ParsedRegistryDocument,
  type RegistryDirectorsCheck,
  type RegistryDocumentEntry,
  type RegistryImportProposal,
  type RegistryImportSelection,
  type RegistryProposalField,
  type RegistryProposalSource,
  type RegistryProposalValue,
} from "../../../../shared/registryDocuments";
import type { ApplyRegistryImportResult } from "../../../../shared/functions/organizationDetails";
import { isUnofficialDocument } from "../../../../shared/entitySetup";
import { listText } from "../registryFacts";
import type { OrganizationDetail, OrganizationRecord, ProfileDocument } from "../types";
import type { RegistryFileText } from "./extractCore";

/**
 * The registry import's pure model: read files → parsed documents → the
 * proposal's current snapshot, document rows (upload defaults, restricted
 * warnings), the directors comparison and the result summary. No React, no
 * Convex; the corporation key is only ever reached through `reveal()`.
 */

/** One document to review: a chosen file, or a PDF or message attached to a chosen email. */
export type ImportFile = {
  id: string;
  /** The file to upload: the chosen file, or the attachment rebuilt from its bytes. */
  file: File;
  name: string;
  /** The email this was attached to. */
  parentId?: string;
  parsed: ParsedRegistryDocument;
  readWarnings: string[];
};

const ATTACHMENTS_NOT_READ = /^Email attachments are not read here/;

/** Parsed documents, in reading order (each email followed by its attachments). */
export function buildImportFiles(chosen: readonly { id: string; file: File }[], texts: readonly RegistryFileText[]): ImportFile[] {
  const files = new Map(chosen.map((entry) => [entry.id, entry.file]));
  const withAttachments = new Set(texts.flatMap((text) => (text.parentId ? [text.parentId] : [])));
  return texts.flatMap((text) => {
    const original = text.attachment
      ? new File([new Uint8Array(text.attachment.bytes)], text.name, { type: text.attachment.mimeType })
      : files.get(text.id);
    if (!original) return [];
    const parsed = parseRegistryDocument(text.text, original.name);
    // The attachments were read as documents of their own.
    const warnings = withAttachments.has(text.id) ? parsed.warnings.filter((warning) => !ATTACHMENTS_NOT_READ.test(warning)) : parsed.warnings;
    return [{
      id: text.id,
      file: original,
      name: original.name,
      ...(text.parentId ? { parentId: text.parentId } : {}),
      parsed: { ...parsed, warnings },
      readWarnings: text.warnings,
    }];
  });
}

export type DirectorRegisterRow = { firstName?: string; lastName?: string; status?: string; residentCanadianStatus?: string };

export function directorName(row: DirectorRegisterRow) {
  return [row.firstName, row.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
}

function currentDirectors(directors: readonly DirectorRegisterRow[] | undefined) {
  return (directors ?? []).filter((row) => !row.status || row.status === "Active");
}

/** What the organization holds today, for the proposal to compare against. */
export function currentSnapshot(society: OrganizationRecord, detail: OrganizationDetail | undefined, directors: readonly DirectorRegisterRow[] | undefined): CurrentProfileSnapshot {
  return {
    formationStatus: society.formationStatus ?? null,
    profile: {
      name: society.name,
      incorporationNumber: society.incorporationNumber ?? null,
      incorporationDate: society.incorporationDate ?? null,
      anniversaryDate: society.anniversaryDate ?? null,
      actFormedUnder: society.actFormedUnder ?? null,
      jurisdictionCode: society.jurisdictionCode ?? null,
      articlesMinDirectors: society.articlesMinDirectors ?? null,
      articlesMaxDirectors: society.articlesMaxDirectors ?? null,
      articlesShareTransferRestrictions: society.articlesShareTransferRestrictions ?? null,
      articlesBusinessRestrictions: society.articlesBusinessRestrictions ?? null,
      articlesOtherProvisions: society.articlesOtherProvisions ?? null,
      craBnStatus: society.craBnStatus ?? null,
      craRcStatus: society.craRcStatus ?? null,
      officialEmail: society.officialEmail ?? null,
    },
    registrations: (detail?.registrations ?? []).map((row) => ({
      id: row._id,
      registrationType: row.registrationType ?? null,
      jurisdiction: row.jurisdiction ?? null,
      homeJurisdiction: row.homeJurisdiction ?? null,
      registrationNumber: row.registrationNumber ?? null,
      registrationDate: row.registrationDate ?? null,
      registrationTime: row.registrationTime ?? null,
      registrationTimeZone: row.registrationTimeZone ?? null,
      homeCorporationNumber: row.homeCorporationNumber ?? null,
      nameInHomeJurisdiction: row.nameInHomeJurisdiction ?? null,
      attorneyStatus: row.attorneyStatus ?? null,
      attorneyNotRequiredReason: row.attorneyNotRequiredReason ?? null,
      reminderEmailsSubscribed: row.reminderEmailsSubscribed ?? null,
      publicRecordUrl: row.publicRecordUrl ?? null,
      portalAccess: row.portalAccess ?? null,
    })),
    addresses: (detail?.addresses ?? []).flatMap((row) => row.type && row.street && row.city ? [{
      type: row.type,
      status: row.status ?? null,
      effectiveFrom: row.effectiveFrom ?? null,
      street: row.street,
      unit: row.unit ?? null,
      city: row.city,
      provinceState: row.provinceState ?? null,
      postalCode: row.postalCode ?? null,
      country: row.country ?? null,
    }] : []),
    identifiers: (detail?.identifiers ?? []).flatMap((row) => row.kind && row.number ? [{ id: row._id, kind: row.kind, number: row.number }] : []),
    directors: currentDirectors(directors).map((row) => ({ name: directorName(row), residentCanadianStatus: row.residentCanadianStatus ?? null })).filter((row) => row.name),
    hasCorporationKey: Boolean(society.corporationKeyVaultItemId),
  };
}

export function buildProposal(files: readonly ImportFile[], snapshot: CurrentProfileSnapshot): RegistryImportProposal {
  return buildRegistryImportProposal(files.map((file) => file.parsed), snapshot);
}

export type RestrictionReason = "the corporation key" | "personal information";

function ownReasons(parsed: ParsedRegistryDocument): RestrictionReason[] {
  const kinds = parsed.sections.map((section) => section.kind);
  const enclosed = parsed.facts.enclosedDocuments?.value ?? [];
  const key = parsed.secrets.length > 0 || kinds.includes("federal_corporation_information_sheet") || enclosed.some((name) => /information sheet/i.test(name));
  const personal = kinds.includes("federal_initial_isc") || enclosed.some((name) => /significant control/i.test(name));
  return [...(key ? ["the corporation key" as const] : []), ...(personal ? ["personal information" as const] : [])];
}

/** Why a file should not be shared with every director: its own content, or what is attached to it. */
export function restrictionReasons(file: ImportFile, files: readonly ImportFile[]): RestrictionReason[] {
  const reasons = new Set<RestrictionReason>(ownReasons(file.parsed));
  for (const child of files.filter((candidate) => candidate.parentId === file.id)) {
    for (const reason of restrictionReasons(child, files)) reasons.add(reason);
  }
  if (file.parsed.restricted && !reasons.size) reasons.add("personal information");
  return (["the corporation key", "personal information"] as const).filter((reason) => reasons.has(reason));
}

export function restrictedWarning(reasons: readonly RestrictionReason[]) {
  return `Every director can open uploaded documents. This one contains ${listText(reasons)}.`;
}

export type ImportDocumentRow = {
  file: ImportFile;
  entry: RegistryDocumentEntry;
  reasons: RestrictionReason[];
  /** A document already in Documents with the same title and category. */
  existing?: ProfileDocument;
  /** "Upload to Documents" starts on for ordinary documents only. */
  defaultUpload: boolean;
};

/** One row per file, in the proposal's order (which is the files' order). */
export function importDocumentRows(proposal: RegistryImportProposal, files: readonly ImportFile[], documents: readonly ProfileDocument[] | undefined): ImportDocumentRow[] {
  return proposal.documents.map((entry, index) => {
    const file = files[index];
    const reasons = restrictionReasons(file, files);
    // Generated drafts and archived copies never stand in for a registry document (least of all a certificate).
    const existing = (documents ?? []).find((document) => !isUnofficialDocument(document)
      && document.category === entry.suggestedCategory
      && document.title?.trim() === entry.suggestedTitle);
    return { file, entry, reasons, ...(existing ? { existing } : {}), defaultUpload: entry.selectedByDefault && !entry.restricted && !reasons.length && !existing };
  });
}

/**
 * Document ids by file fingerprint for `withRegistryDocumentIds`: the
 * uploaded copy, else a matching document already on file. The first file
 * with a fingerprint wins.
 */
export function documentIdsByFingerprint(rows: readonly ImportDocumentRow[], uploaded: Readonly<Record<string, string>>): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const row of rows) {
    const id = uploaded[row.file.id] ?? row.existing?._id;
    if (id && !ids[row.entry.fingerprint]) ids[row.entry.fingerprint] = id;
  }
  return ids;
}

/** The value a field will apply: the reviewer's choice for a conflict, else the proposed one. */
export function chosenValue(field: RegistryProposalField, selection: RegistryImportSelection): RegistryProposalValue {
  const choice = selection.choices?.[field.id] ?? 0;
  return field.conflict?.options[choice]?.value ?? field.proposed;
}

function fieldText(proposal: RegistryImportProposal, id: string, selection: RegistryImportSelection): string | undefined {
  const field = proposal.groups.flatMap((group) => group.fields).find((candidate) => candidate.id === id);
  if (!field) return undefined;
  const value = chosenValue(field, selection);
  return value.kind === "text" ? value.value : undefined;
}

/** What "Record incorporation" opens with after an import that found a certificate. */
export function incorporationPrefill(proposal: RegistryImportProposal, selection: RegistryImportSelection, ids: Readonly<Record<string, string>>) {
  const certificate = proposal.documentRoles.federalCertificate;
  if (!certificate) return undefined;
  return {
    certificateDocumentId: ids[certificate],
    incorporationNumber: fieldText(proposal, "profile.incorporationNumber", selection) ?? fieldText(proposal, "registration.home.registrationNumber", selection),
    incorporationDate: fieldText(proposal, "profile.incorporationDate", selection),
    actFormedUnder: fieldText(proposal, "profile.actFormedUnder", selection),
  };
}

function nameKey(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type DirectorMismatch = { name: string; issue: "not_in_register" | "residency_differs" | "residency_unconfirmed" };

/** First directors from Form 2 against the directors register. For review only: directors are never written. */
export function directorMismatches(check: RegistryDirectorsCheck, directors: readonly DirectorRegisterRow[] | undefined): DirectorMismatch[] {
  const register = currentDirectors(directors);
  return check.directors.flatMap((director): DirectorMismatch[] => {
    const match = register.find((row) => nameKey(directorName(row)) === nameKey(director.name));
    if (!match) return [{ name: director.name, issue: "not_in_register" }];
    if (director.residentCanadian === undefined) return [];
    const status = match.residentCanadianStatus;
    if (status !== "yes" && status !== "no") return [{ name: director.name, issue: "residency_unconfirmed" }];
    return (status === "yes") === director.residentCanadian ? [] : [{ name: director.name, issue: "residency_differs" }];
  });
}

const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;

/** The toast after an import: what changed, from the mutation's counts. */
export function importSummary(result: ApplyRegistryImportResult, uploadedCount: number): string {
  const changed = (section: { created: number; updated: number }) => section.created + section.updated;
  const parts = [
    result.profile.fields.length ? plural(result.profile.fields.length, "profile field") : "",
    changed(result.registrations) ? plural(changed(result.registrations), "registration") : "",
    changed(result.addresses) ? plural(changed(result.addresses), "address", "addresses") : "",
    changed(result.identifiers) ? plural(changed(result.identifiers), "tax number") : "",
  ].filter(Boolean);
  const sentences = [parts.length ? `Updated ${listText(parts)}.` : "No profile changes."];
  if (result.profile.deferred?.length) sentences.push("The corporation number and date are recorded with Record incorporation.");
  if (result.corporationKey) sentences.push(result.corporationKey.valueStored ? "Corporation key stored in Access custody." : "Corporation key recorded as a reference.");
  if (uploadedCount) sentences.push(`${plural(uploadedCount, "document")} uploaded.`);
  return sentences.join(" ");
}

/** True when an apply touched the society record itself (its profile fields or key link). */
export function importChangedSociety(result: ApplyRegistryImportResult) {
  return result.profile.updated > 0 || Boolean(result.corporationKey && (result.corporationKey.created || result.corporationKey.updated));
}

/** "Certificate of incorporation – Name; Form 2" for a value's source documents. */
export function sourceText(sources: readonly RegistryProposalSource[]) {
  const names = [...new Set(sources.map((source) => source.title || source.fileName || "Registry document"))];
  return names.length > 2 ? `${names.slice(0, 2).join("; ")} and ${names.length - 2} more` : names.join("; ");
}
