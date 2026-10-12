/**
 * MINUTE-BOOK REPORTS (pure logic).
 *
 * Printable preparation outputs built from the existing registers, each "as
 * of" a date (the lawyer workbook's point-in-time model: a row counts when
 * start <= date and it has not ended on or before that date):
 *
 *  - BC transparency register (BCA Part 2.1), restricted access
 *  - director's consent to act (BC / CBCA / OBCA wording)
 *  - securities register by class and holder, with certificate numbers
 *  - register of directors, register of officers
 *  - corporate information summary
 *  - covering letter for a document package
 *  - Land Owner Transparency Act (BC) interest-holder worksheet, restricted
 *
 * Every builder returns finished blocks (shared/packetBlocks.ts) that the DOCX
 * renderer prints verbatim: register data is never passed through the template
 * engine, so a brace in a name cannot change the document.
 *
 * Wording is preparation text for lawyer review. Nothing here files, signs or
 * certifies anything, and nothing here describes tax effects.
 */

import { deriveCurrentHoldings, type RightsholdingTransferRecord } from "./equityLedger";
import { activeCertificates, type CertificateEvent } from "./shareCertificates";
import { computeVotingPower, votesPerShareOf } from "./votingPower";
import { formatLongDate } from "./locale";
import { looksLikeOrganization } from "./nlg";
import {
  canonicalizeJurisdictionCode,
  homeJurisdictionCode,
  isCorporation,
  isFederalCbca,
  isOntarioObca,
  organizationLabel,
  type LegalEntityLike,
} from "./organizationDomain";
import type { PacketBlock } from "./packetBlocks";

export type MinuteBookReportKind =
  | "bc-transparency-register"
  | "director-consent"
  | "securities-register"
  | "directors-register"
  | "officers-register"
  | "corporate-summary"
  | "cover-letter"
  | "lota-report";

/** Reports that print personal information whose access is restricted by statute. */
export const RESTRICTED_REPORT_KINDS: ReadonlySet<MinuteBookReportKind> = new Set(["bc-transparency-register", "lota-report"]);

export type ReportOrganization = LegalEntityLike & {
  _id?: string;
  name?: string;
  legalName?: string;
  shortName?: string;
  incorporationNumber?: string;
  incorporationDate?: string;
  fiscalYearEnd?: string;
  registeredOfficeAddress?: string;
  mailingAddress?: string;
  minuteBookLocation?: string;
  sealLocation?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  responsibleLawyer?: string;
};

export interface ReportRoleHolder {
  _id?: string;
  roleType?: string;
  status?: string;
  fullName?: string;
  startDate?: string | null;
  endDate?: string | null;
  officerTitle?: string;
  additionalOfficerTitles?: string[];
  street?: string; unit?: string; city?: string; provinceState?: string; postalCode?: string; country?: string;
  serviceStreet?: string; serviceUnit?: string; serviceCity?: string; serviceProvinceState?: string; servicePostalCode?: string; serviceCountry?: string;
  dateOfBirth?: string;
  citizenshipResidency?: string;
  citizenshipCountries?: string[];
  taxResidenceCountries?: string[];
  taxResidentHomeJurisdiction?: string;
  significanceReason?: string;
  natureOfControl?: string;
  nonNaturalPerson?: boolean;
  ageOver18?: boolean;
}

/** Live `directors` register rows (used when roleHolders carries no directors). */
export interface ReportDirectorRow {
  firstName?: string;
  lastName?: string;
  position?: string;
  termStart?: string;
  termEnd?: string | null;
}

export interface ReportRightsClass {
  _id: string;
  className: string;
  classType?: string;
  status?: string;
  votesPerShare?: number | null;
  votingRights?: string | null;
  singularForm?: string;
}

export type ReportTransfer = RightsholdingTransferRecord & { _id?: string; _creationTime?: number };

export interface ReportAddress {
  type?: string;
  status?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  street?: string; unit?: string; city?: string; provinceState?: string; postalCode?: string; country?: string;
}

export interface ReportNameHistory { name: string; shortName?: string; startISO: string }

export interface ReportAsset {
  name?: string;
  category?: string;
  status?: string;
  location?: string;
  assetJurisdiction?: string;
  serialNumber?: string;
  purchaseDate?: string;
  disposedAt?: string;
}

export interface ReportTransparencyStep {
  individualName?: string;
  stepsNarrative?: string;
  stepDate?: string;
  nextReviewDate?: string;
}

export interface ReportGeneratedDocument { title?: string; effectiveDate?: string; createdAtISO?: string }

export interface MinuteBookReportInput {
  kind: MinuteBookReportKind;
  organization: ReportOrganization;
  /** The "as of" date (YYYY-MM-DD; a longer ISO string is truncated). */
  asOf: string;
  roleHolders?: ReportRoleHolder[];
  directors?: ReportDirectorRow[];
  rightsClasses?: ReportRightsClass[];
  transfers?: ReportTransfer[];
  certificates?: CertificateEvent[];
  addresses?: ReportAddress[];
  nameHistory?: ReportNameHistory[];
  assets?: ReportAsset[];
  transparencySteps?: ReportTransparencyStep[];
  generatedDocuments?: ReportGeneratedDocument[];
  /**
   * True only when the person generating the report may see restricted
   * registers (a director, or a records-office administrator). When false a
   * restricted report prints its access notice and no personal information.
   */
  canViewRestricted: boolean;
  /** LOTA "significant number of shares" threshold; 10 by statute. */
  lotaThresholdPercent?: number;
}

export interface MinuteBookReport {
  kind: MinuteBookReportKind;
  title: string;
  subtitle: string;
  asOf: string;
  asOfLong: string;
  restricted: boolean;
  blocks: PacketBlock[];
  /** Data gaps worth a reviewer's attention (also printed in the document). */
  warnings: string[];
}

const BLANK = "____________________";
const FILL = "<FILL>";

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

export type ReportStatute = "bc" | "cbca" | "obca" | "other";

export function reportStatute(org: ReportOrganization): ReportStatute {
  if (!isCorporation(org)) return "other";
  if (isFederalCbca(org)) return "cbca";
  if (isOntarioObca(org)) return "obca";
  return canonicalizeJurisdictionCode(homeJurisdictionCode(org)) === "CA-BC" ? "bc" : "other";
}

export function isBcCompany(org: ReportOrganization): boolean {
  return reportStatute(org) === "bc";
}

/** The governing Act with its jurisdiction, e.g. "Business Corporations Act (British Columbia)". */
export function governingActName(org: ReportOrganization): string {
  switch (reportStatute(org)) {
    case "bc": return "Business Corporations Act (British Columbia)";
    case "cbca": return "Canada Business Corporations Act";
    case "obca": return "Business Corporations Act (Ontario)";
    default: return "the governing corporate statute";
  }
}

function entityNoun(org: ReportOrganization): string {
  return isBcCompany(org) ? "company" : "corporation";
}

function day(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function longDate(value: unknown): string {
  const d = day(value);
  return d ? formatLongDate(d, "en") : "";
}

/** start <= asOf and not ended on or before asOf (start missing counts as "always"). */
function inForce(start: unknown, end: unknown, asOf: string): boolean {
  const s = day(start);
  const e = day(end);
  return (!s || s <= asOf) && (!e || e > asOf);
}

function startedBy(start: unknown, asOf: string): boolean {
  const s = day(start);
  return !s || s <= asOf;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinAddress(parts: Array<string | undefined>): string {
  return parts.map(clean).filter(Boolean).join(", ");
}

function residentialAddress(row: ReportRoleHolder): string {
  return joinAddress([row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country]);
}

function serviceAddress(row: ReportRoleHolder): string {
  return joinAddress([row.serviceUnit, row.serviceStreet, row.serviceCity, row.serviceProvinceState, row.servicePostalCode, row.serviceCountry]);
}

function formatOfficeAddress(row: ReportAddress): string {
  return joinAddress([row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country]);
}

/** Legal name in force on the date (societyNameHistory), else the current name. */
export function nameAsOf(org: ReportOrganization, history: readonly ReportNameHistory[] | undefined, asOf: string): string {
  const candidates = (history ?? []).filter((row) => clean(row.name) && day(row.startISO) && day(row.startISO) <= asOf)
    .sort((a, b) => day(a.startISO).localeCompare(day(b.startISO)));
  return candidates.length ? clean(candidates[candidates.length - 1].name) : organizationLabel(org);
}

function percent(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)}%`;
}

function count(n: number): string {
  return n.toLocaleString("en-CA");
}

// ---------------------------------------------------------------------------
// Ledger as of a date
// ---------------------------------------------------------------------------

function transferDay(row: ReportTransfer): string {
  return day(row.transferDate) || day(row.createdAtISO);
}

function chronological(a: ReportTransfer, b: ReportTransfer): number {
  const byDate = transferDay(a).localeCompare(transferDay(b));
  return byDate !== 0 ? byDate : Number(a._creationTime ?? 0) - Number(b._creationTime ?? 0);
}

/**
 * Posted ledger rows on or before `asOf`, in ledger order. Agent SHARES owns
 * `holdingsAsOf(transfers, isoDate)` in shared/equityLedger.ts; until that
 * lands this computes the same end-of-day view from the same ledger rules
 * (deriveCurrentHoldings over the posted rows dated on or before the day).
 */
export function postedTransfersAsOf(transfers: readonly ReportTransfer[], asOf: string): ReportTransfer[] {
  return transfers.filter((row) => row.status === "posted" && transferDay(row) && transferDay(row) <= asOf).sort(chronological);
}

export function ledgerHoldingsAsOf(transfers: readonly ReportTransfer[], asOf: string) {
  return deriveCurrentHoldings(postedTransfersAsOf(transfers, asOf)).filter((holding) => holding.quantity > 0);
}

function holderNameResolver(roleHolders: readonly ReportRoleHolder[]) {
  const byId = new Map(roleHolders.filter((row) => row._id).map((row) => [String(row._id), row]));
  return (holderKey: string): { name: string; role?: ReportRoleHolder } => {
    if (holderKey.startsWith("roleHolder:")) {
      const role = byId.get(holderKey.slice("roleHolder:".length));
      return { name: clean(role?.fullName) || "[Unnamed holder]", role };
    }
    if (holderKey.startsWith("name:")) return { name: holderKey.slice("name:".length) };
    return { name: holderKey };
  };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// People as of a date
// ---------------------------------------------------------------------------

interface OfficeHolding { name: string; start: string; end: string; title?: string; row?: ReportRoleHolder }

function directorsFrom(input: MinuteBookReportInput): OfficeHolding[] {
  const roles = (input.roleHolders ?? []).filter((row) => row.roleType === "director");
  if (roles.length) {
    return roles.map((row) => ({ name: clean(row.fullName), start: day(row.startDate), end: day(row.endDate), row }));
  }
  return (input.directors ?? []).map((row) => ({
    name: `${clean(row.firstName)} ${clean(row.lastName)}`.trim(),
    start: day(row.termStart),
    end: day(row.termEnd),
    title: clean(row.position) || undefined,
  }));
}

function officersFrom(input: MinuteBookReportInput): OfficeHolding[] {
  return (input.roleHolders ?? []).filter((row) => row.roleType === "officer").map((row) => ({
    name: clean(row.fullName),
    start: day(row.startDate),
    end: day(row.endDate),
    title: [clean(row.officerTitle), ...(row.additionalOfficerTitles ?? []).map(clean)].filter(Boolean).join(" and ") || "Officer",
    row,
  }));
}

function inOffice(rows: OfficeHolding[], asOf: string) {
  return rows.filter((row) => row.name && inForce(row.start, row.end, asOf));
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildMinuteBookReport(input: MinuteBookReportInput): MinuteBookReport {
  const asOf = day(input.asOf);
  if (!asOf) throw new Error("A report needs an as-of date (YYYY-MM-DD).");
  const normalized = { ...input, asOf };
  const restricted = RESTRICTED_REPORT_KINDS.has(input.kind);
  const name = nameAsOf(input.organization, input.nameHistory, asOf);
  const base = {
    kind: input.kind,
    asOf,
    asOfLong: formatLongDate(asOf, "en"),
    restricted,
  };
  if (restricted && !input.canViewRestricted) {
    return {
      ...base,
      title: input.kind === "lota-report" ? "Land Owner Transparency Act interest-holder worksheet" : "Transparency register",
      subtitle: `${name}, as at ${base.asOfLong}`,
      blocks: [
        { kind: "note", text: restrictedNotice(input.kind) },
        { kind: "paragraph", text: "This copy contains no register information because the person who generated it does not have access to this register." },
      ],
      warnings: ["Restricted register: generated without access, so no personal information was printed."],
    };
  }
  switch (input.kind) {
    case "bc-transparency-register": return { ...base, ...transparencyRegister(normalized, name) };
    case "director-consent": return { ...base, ...directorConsent(normalized, name) };
    case "securities-register": return { ...base, ...securitiesRegister(normalized, name) };
    case "directors-register": return { ...base, ...directorsRegister(normalized, name) };
    case "officers-register": return { ...base, ...officersRegister(normalized, name) };
    case "corporate-summary": return { ...base, ...corporateSummary(normalized, name) };
    case "cover-letter": return { ...base, ...coverLetter(normalized, name) };
    case "lota-report": return { ...base, ...lotaReport(normalized, name) };
  }
}

type Body = Pick<MinuteBookReport, "title" | "subtitle" | "blocks" | "warnings">;

export function restrictedNotice(kind: MinuteBookReportKind): string {
  if (kind === "lota-report") {
    return "RESTRICTED: contains personal information collected for a Land Owner Transparency Act report. Share it only with the people preparing or certifying that report, keep it out of the general minute book, and never record social insurance or tax numbers in Societyer.";
  }
  return "RESTRICTED ACCESS: under section 119.61(2) of the Business Corporations Act (British Columbia), the transparency register may be inspected only by a director of the company or an inspecting official. Do not circulate this copy to shareholders or the public, and store it at the records office (s. 119.5).";
}

function asAt(name: string, asOfLong: string) {
  return `${name}, as at ${asOfLong}`;
}

function transparencyRegister(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const asOfLong = formatLongDate(input.asOf, "en");
  const warnings: string[] = [];
  const blocks: PacketBlock[] = [{ kind: "note", text: restrictedNotice("bc-transparency-register") }];
  if (!isBcCompany(input.organization)) {
    warnings.push("The BC transparency register applies to BC private companies only. Use the federal ISC packet for a CBCA corporation.");
    blocks.push({ kind: "paragraph", text: "This register format follows Part 2.1 of the Business Corporations Act (British Columbia) and does not apply to this corporation." });
    return { title: "Transparency register", subtitle: asAt(name, asOfLong), blocks, warnings };
  }
  const individuals = (input.roleHolders ?? []).filter((row) => row.roleType === "controller" && startedBy(row.startDate, input.asOf));
  blocks.push({
    kind: "paragraph",
    text: `Transparency register of significant individuals of ${name} (the "Company") kept under section 119.2 of the Business Corporations Act (British Columbia), showing the entries recorded in Societyer on or before ${asOfLong}.`,
  });
  if (!individuals.length) {
    warnings.push("No significant individuals are recorded as at this date.");
    blocks.push(
      { kind: "paragraph", text: `No significant individuals are recorded in Societyer as at ${asOfLong}.` },
      { kind: "note", text: "If the Company has determined that no individual is a significant individual, section 119.2(3) requires the register to say so. After review, the statement reads: \"The Company has determined that there are no individuals who are significant individuals in respect of the Company.\"" },
    );
  }
  individuals.forEach((row, index) => {
    const ceased = day(row.endDate) && day(row.endDate) <= input.asOf ? longDate(row.endDate) : "";
    const canadian = clean(row.citizenshipResidency);
    const citizenships = (row.citizenshipCountries ?? []).map(clean).filter(Boolean).join(", ");
    const taxResident = clean(row.taxResidentHomeJurisdiction).toLowerCase();
    const missing: string[] = [];
    if (!clean(row.dateOfBirth)) missing.push("date of birth");
    if (!residentialAddress(row)) missing.push("last known address");
    if (!canadian) missing.push("citizenship or permanent residence");
    if (!taxResident) missing.push("Canadian tax residence");
    if (!clean(row.significanceReason) && !clean(row.natureOfControl)) missing.push("description of significance");
    if (missing.length) warnings.push(`${clean(row.fullName) || "An individual"}: missing ${missing.join(", ")}.`);
    blocks.push({ kind: "heading", text: `${index + 1}. ${clean(row.fullName) || "[Name not recorded]"}` });
    blocks.push({
      kind: "table",
      columns: [],
      widths: [2, 3],
      rows: [
        ["Full name", clean(row.fullName) || FILL],
        ["Date of birth", longDate(row.dateOfBirth) || clean(row.dateOfBirth) || FILL],
        ["Last known address", residentialAddress(row) || FILL],
        ["Canadian citizen or permanent resident", canadian || FILL],
        ["Citizenship(s), if not a Canadian citizen or permanent resident", citizenships || (canadian ? "Not applicable" : FILL)],
        ["Resident in Canada for purposes of the Income Tax Act (Canada)", taxResident === "yes" ? "Yes" : taxResident === "no" ? "No" : FILL],
        ["Date became a significant individual", longDate(row.startDate) || FILL],
        ["Date ceased to be a significant individual", ceased || "Not applicable"],
        ["How the individual is a significant individual", clean(row.significanceReason) || clean(row.natureOfControl) || FILL],
      ],
    });
    if (missing.length) {
      blocks.push({ kind: "note", text: "Where information could not be obtained or confirmed, section 119.2(4) requires the register to record what was obtained and a description of the steps taken to obtain it." });
    }
  });
  const steps = (input.transparencySteps ?? []).filter((row) => startedBy(row.stepDate, input.asOf))
    .sort((a, b) => day(a.stepDate).localeCompare(day(b.stepDate)));
  blocks.push({ kind: "heading", text: "Steps taken to obtain or confirm information" });
  blocks.push({
    kind: "table",
    columns: ["Date", "Individual", "Steps taken", "Next review"],
    widths: [2, 3, 6, 2],
    rows: steps.map((row) => [longDate(row.stepDate), clean(row.individualName), clean(row.stepsNarrative), longDate(row.nextReviewDate)]),
    emptyText: "No steps are recorded as at this date.",
  });
  blocks.push({
    kind: "note",
    text: "Review notes: confirm the information within the annual review period (s. 119.3), record new information within 30 days of becoming aware of it (s. 119.31), notify an individual within 10 days of an entry that they became or ceased to be significant (s. 119.41), and delete a former individual's information as section 119.4 requires. Societyer lists recorded entries only; it does not determine who is a significant individual.",
  });
  return { title: "Transparency register", subtitle: asAt(name, asOfLong), blocks, warnings };
}

function directorConsent(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const org = input.organization;
  const statute = reportStatute(org);
  const asOfLong = formatLongDate(input.asOf, "en");
  const act = governingActName(org);
  const warnings: string[] = [];
  const appointees = directorsFrom(input).filter((row) => row.name && row.start === input.asOf);
  const people: Array<OfficeHolding | null> = appointees.length ? appointees : [null];
  if (!appointees.length) warnings.push(`No director appointment is recorded on ${asOfLong}; a blank consent form was prepared.`);
  const blocks: PacketBlock[] = [];
  people.forEach((person, index) => {
    if (index > 0) blocks.push({ kind: "pageBreak" });
    const personName = person?.name || "[Full name of director]";
    const address = person?.row ? serviceAddress(person.row) || residentialAddress(person.row) : "";
    blocks.push({ kind: "heading", text: `Consent to act as a director — ${personName}` });
    blocks.push({ kind: "paragraph", text: `To: ${name} (the "${statute === "bc" ? "Company" : "Corporation"}")` });
    blocks.push({ kind: "paragraph", text: `I, ${personName}, consent to act as a director of the ${statute === "bc" ? "Company" : "Corporation"}${person ? `, effective ${asOfLong}` : ""}.` });
    if (statute === "bc") {
      blocks.push(
        { kind: "paragraph", text: "I give this consent in writing under section 123(1)(a) of the Business Corporations Act (British Columbia). It remains effective until it ends under section 123(3)." },
        { kind: "paragraph", text: "To my knowledge I am qualified to act as a director under section 124 of the Act." },
        { kind: "paragraph", text: `My prescribed address for the register of directors (s. 126) and the notice of articles is: ${address || BLANK}` },
        { kind: "note", text: "Review note: a written consent is one of the ways a BC director may consent; section 123(1)(b) and section 122(4)(b) set out others. Keep a copy of each consent received at the records office (s. 42(1)(f)), and file any notice of change of directors within 15 days (s. 127). Confirm the prescribed address against the Business Corporations Regulation." },
      );
    } else if (statute === "cbca") {
      blocks.push(
        { kind: "paragraph", text: "I give this consent in writing for the purposes of section 106(9) of the Canada Business Corporations Act." },
        { kind: "paragraph", text: `My address for the register of directors is: ${address || BLANK}` },
        { kind: "note", text: "Review note: if the individual was not present at the meeting that elected or appointed them, the consent should be given before, or within ten days after, the election or appointment (s. 106(9)); acting as a director is the other statutory route." },
      );
    } else if (statute === "obca") {
      blocks.push(
        { kind: "paragraph", text: "I give this consent in writing for the purposes of section 119(9) of the Business Corporations Act (Ontario)." },
        { kind: "paragraph", text: `My address for the register of directors is: ${address || BLANK}` },
        { kind: "note", text: "Review note: an election or appointment is not effective until the person consents in writing before or within 10 days after it; a later written consent makes it valid (s. 119(10)), and an uninterrupted re-election is excepted (s. 119(11))." },
      );
    } else {
      blocks.push({ kind: "paragraph", text: `My address for the register of directors is: ${address || BLANK}` }, { kind: "note", text: `Review note: confirm the consent requirements of ${act} before relying on this form.` });
    }
    blocks.push({ kind: "signatures", dateLine: `Dated: ${person ? asOfLong : BLANK}`, signers: [{ name: personName }] });
  });
  return { title: "Consent to act as a director", subtitle: asAt(name, asOfLong), blocks, warnings };
}

function holdingsTable(input: MinuteBookReportInput & { asOf: string }) {
  const classes = input.rightsClasses ?? [];
  const holdings = ledgerHoldingsAsOf(input.transfers ?? [], input.asOf);
  const resolve = holderNameResolver(input.roleHolders ?? []);
  const certificates = activeCertificates(input.certificates ?? [], `${input.asOf}T23:59:59.999Z`);
  return { classes, holdings, resolve, certificates };
}

function securitiesRegister(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const asOfLong = formatLongDate(input.asOf, "en");
  const { classes, holdings, resolve, certificates } = holdingsTable(input);
  const warnings: string[] = [];
  const blocks: PacketBlock[] = [{
    kind: "paragraph",
    text: `Central securities register of ${name} showing the shares held by each holder at the end of ${asOfLong}, computed from the posted share ledger, with the active share certificates on that date.`,
  }];
  const classIds = Array.from(new Set([...classes.map((c) => c._id), ...holdings.map((h) => h.rightsClassId)]));
  if (!holdings.length) {
    warnings.push("No posted share issuances are recorded on or before this date.");
    blocks.push({ kind: "paragraph", text: `No shares are recorded as issued and outstanding at the end of ${asOfLong}.` });
  }
  for (const classId of classIds) {
    const cls = classes.find((c) => c._id === classId);
    const className = cls?.className ?? "[Unknown class]";
    const rows = holdings.filter((h) => h.rightsClassId === classId);
    if (!rows.length) continue;
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    blocks.push({ kind: "heading", text: `${className} (${count(total)} issued and outstanding)` });
    blocks.push({
      kind: "table",
      columns: ["Holder", "Address", "Number of shares", "Certificate number(s)"],
      widths: [3, 4, 2, 2],
      rows: rows
        .map((row) => {
          const holder = resolve(row.holderKey);
          const certs = certificates.filter((cert) => sameName(cert.holderName, holder.name) && sameName(cert.shareClass, className));
          const certShares = certs.reduce((sum, cert) => sum + (Number(cert.shares) || 0), 0);
          if (certs.length && certShares !== row.quantity) {
            warnings.push(`${holder.name}: ${className} certificates total ${count(certShares)} but the ledger shows ${count(row.quantity)}.`);
          }
          return [holder.name, holder.role ? residentialAddress(holder.role) : "", count(row.quantity), certs.map((cert) => cert.certificateNumber).join(", ") || "Uncertificated / not recorded"];
        })
        .sort((a, b) => a[0].localeCompare(b[0])),
    });
  }
  const transactions = postedTransfersAsOf(input.transfers ?? [], input.asOf);
  blocks.push({ kind: "heading", text: "Issues, transfers and other entries" });
  blocks.push({
    kind: "table",
    columns: ["Date", "Entry", "Class", "From", "To", "Number", "Consideration"],
    widths: [2, 2, 2, 3, 3, 2, 3],
    rows: transactions.map((row) => {
      const cls = classes.find((c) => c._id === row.rightsClassId);
      const from = row.sourceRoleHolderId ? resolve(`roleHolder:${row.sourceRoleHolderId}`).name : clean(row.sourceHolderName);
      const to = row.destinationRoleHolderId ? resolve(`roleHolder:${row.destinationRoleHolderId}`).name : clean(row.destinationHolderName);
      return [longDate(transferDay(row)), clean(row.transferType), cls?.className ?? "", from, to, count(Number(row.quantity) || 0), clean(row.considerationDescription) || clean(row.considerationType)];
    }),
    emptyText: "No posted entries on or before this date.",
  });
  if (isBcCompany(input.organization)) {
    blocks.push({ kind: "note", text: "Review note: a BC company's central securities register must record the particulars in section 111 of the Business Corporations Act (British Columbia). Confirm holder addresses and certificate particulars before printing for the records office." });
  }
  return { title: "Securities register", subtitle: asAt(name, asOfLong), blocks, warnings };
}

function directorsRegister(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const asOfLong = formatLongDate(input.asOf, "en");
  const bc = isBcCompany(input.organization);
  const officers = officersFrom(input);
  const rows = directorsFrom(input).filter((row) => row.name && startedBy(row.start, input.asOf))
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const warnings: string[] = [];
  if (!rows.length) warnings.push("No directors are recorded on or before this date.");
  const blocks: PacketBlock[] = [
    { kind: "paragraph", text: `Register of directors of ${name} as at ${asOfLong}.` },
    {
      kind: "table",
      columns: ["Full name", bc ? "Prescribed address" : "Address", "Became a director", "Ceased to be a director", "Offices held"],
      widths: [3, 4, 2, 2, 3],
      rows: rows.map((row) => {
        const ceased = row.end && row.end <= input.asOf ? longDate(row.end) : "";
        const offices = officers.filter((officer) => sameName(officer.name, row.name) && startedBy(officer.start, input.asOf))
          .map((officer) => `${officer.title} (${longDate(officer.start) || "date not recorded"}${officer.end && officer.end <= input.asOf ? ` to ${longDate(officer.end)}` : ""})`);
        return [row.name, row.row ? serviceAddress(row.row) || residentialAddress(row.row) : "", longDate(row.start) || "Not recorded", ceased, offices.join("; ") || row.title || ""];
      }),
      emptyText: "No directors are recorded on or before this date.",
    },
  ];
  if (bc) blocks.push({ kind: "note", text: "Review note: section 126 of the Business Corporations Act (British Columbia) requires each director's full name and prescribed address, the dates each became and ceased to be a director, and any office held with its dates." });
  return { title: "Register of directors", subtitle: asAt(name, asOfLong), blocks, warnings };
}

function officersRegister(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const asOfLong = formatLongDate(input.asOf, "en");
  const rows = officersFrom(input).filter((row) => row.name && startedBy(row.start, input.asOf))
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return {
    title: "Register of officers",
    subtitle: asAt(name, asOfLong),
    blocks: [
      { kind: "paragraph", text: `Register of officers of ${name} as at ${asOfLong}.` },
      {
        kind: "table",
        columns: ["Full name", "Office", "Appointed", "Ceased", "In office on this date"],
        widths: [3, 3, 2, 2, 2],
        rows: rows.map((row) => [row.name, row.title ?? "", longDate(row.start) || "Not recorded", row.end && row.end <= input.asOf ? longDate(row.end) : "", inForce(row.start, row.end, input.asOf) ? "Yes" : "No"]),
        emptyText: "No officers are recorded on or before this date.",
      },
    ],
    warnings: rows.length ? [] : ["No officers are recorded on or before this date."],
  };
}

function corporateSummary(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const org = input.organization;
  const asOfLong = formatLongDate(input.asOf, "en");
  const warnings: string[] = [];
  const history = (input.nameHistory ?? []).filter((row) => clean(row.name) && day(row.startISO) && day(row.startISO) <= input.asOf)
    .sort((a, b) => day(a.startISO).localeCompare(day(b.startISO)));
  const offices = (input.addresses ?? []).filter((row) => inForce(row.effectiveFrom, row.effectiveTo, input.asOf) && row.status !== "proposed");
  const office = (type: string) => offices.filter((row) => row.type === type).map(formatOfficeAddress).filter(Boolean).join("; ");
  const directors = inOffice(directorsFrom(input), input.asOf);
  const officers = inOffice(officersFrom(input), input.asOf);
  const { classes, holdings, resolve } = holdingsTable(input);
  const classInputs = classes.map((cls) => ({ rightsClassId: cls._id, votesPerShare: cls.votesPerShare, votingRights: cls.votingRights, classType: cls.classType }));
  const power = computeVotingPower(holdings.map((h) => ({ holderKey: h.holderKey, holderName: resolve(h.holderKey).name, rightsClassId: h.rightsClassId, quantity: h.quantity })), classInputs);
  const registered = office("registered_office") || clean(org.registeredOfficeAddress);
  const records = office("records_office");
  if (!registered) warnings.push("No registered office address is recorded as at this date.");
  const blocks: PacketBlock[] = [
    { kind: "heading", text: "Identity" },
    {
      kind: "table",
      columns: [],
      widths: [2, 4],
      rows: [
        ["Legal name", name],
        ["Incorporation number", clean(org.incorporationNumber) || "Not recorded"],
        ["Date of incorporation", longDate(org.incorporationDate) || "Not recorded"],
        ["Jurisdiction and governing Act", governingActName(org)],
        ["Financial year end", clean(org.fiscalYearEnd) || "Not recorded"],
        ["Registered office", registered || "Not recorded"],
        ["Records office", records || "Not recorded"],
        ["Minute book location", clean(org.minuteBookLocation) || "Not recorded"],
        ["Seal", clean(org.sealLocation) || "None recorded"],
        ["Primary contact", [clean(org.primaryContactName), clean(org.primaryContactEmail), clean(org.primaryContactPhone)].filter(Boolean).join(", ") || "Not recorded"],
        ["Responsible lawyer", clean(org.responsibleLawyer) || "Not recorded"],
      ],
    },
  ];
  if (history.length > 1) {
    blocks.push({ kind: "heading", text: "Name history" }, {
      kind: "table", columns: ["Name", "Effective from"], widths: [4, 2],
      rows: history.map((row) => [clean(row.name), longDate(row.startISO)]),
    });
  }
  blocks.push(
    { kind: "heading", text: "Directors" },
    { kind: "table", columns: ["Name", "Since"], widths: [4, 2], rows: directors.map((row) => [row.name, longDate(row.start) || "Not recorded"]), emptyText: "No directors in office on this date." },
    { kind: "heading", text: "Officers" },
    { kind: "table", columns: ["Name", "Office", "Since"], widths: [3, 3, 2], rows: officers.map((row) => [row.name, row.title ?? "", longDate(row.start) || "Not recorded"]), emptyText: "No officers in office on this date." },
    { kind: "heading", text: "Authorized share structure" },
    {
      kind: "table", columns: ["Class", "Type", "Votes per share", "Status"], widths: [3, 2, 2, 2],
      rows: classes.map((cls) => [cls.className, clean(cls.classType), String(votesPerShareOf({ rightsClassId: cls._id, votesPerShare: cls.votesPerShare, votingRights: cls.votingRights, classType: cls.classType })), clean(cls.status)]),
      emptyText: "No share classes are recorded.",
    },
    { kind: "heading", text: "Shareholdings" },
    {
      kind: "table", columns: ["Holder", "Class", "Shares"], widths: [4, 3, 2],
      rows: holdings.map((h) => [resolve(h.holderKey).name, classes.find((c) => c._id === h.rightsClassId)?.className ?? "", count(h.quantity)])
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
      emptyText: "No shares are recorded as issued and outstanding on this date.",
    },
    { kind: "heading", text: "Voting rights" },
    {
      kind: "table", columns: ["Holder", "Votes", "% of votes", "% of issued shares"], widths: [4, 2, 2, 2],
      rows: power.voting.map((h) => [h.holderName, count(h.totalVotes), percent(h.percentOfVotes), percent(h.percentOfShares)]),
      emptyText: "No voting shares are recorded as issued on this date.",
    },
    { kind: "note", text: `Prepared from the registers recorded in Societyer as at ${asOfLong}. It is a summary for review, not a certificate of the ${entityNoun(org)}'s records or a registry search.` },
  );
  return { title: "Corporate information summary", subtitle: asAt(name, asOfLong), blocks, warnings };
}

function coverLetter(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const org = input.organization;
  const asOfLong = formatLongDate(input.asOf, "en");
  const enclosures = (input.generatedDocuments ?? [])
    .filter((row) => (day(row.effectiveDate) || day(row.createdAtISO)) === input.asOf && clean(row.title))
    .map((row) => clean(row.title))
    .filter((title, index, all) => all.indexOf(title) === index && !/covering letter/i.test(title));
  const addressee = clean(org.primaryContactName) || "[Addressee]";
  const mailing = clean(org.mailingAddress) || clean(org.registeredOfficeAddress);
  const signer = clean(org.responsibleLawyer) || "[Name]";
  const warnings = enclosures.length ? [] : [`No documents generated on ${asOfLong} were found; list the enclosures by hand.`];
  return {
    title: "Covering letter",
    subtitle: asAt(name, asOfLong),
    blocks: [
      { kind: "paragraph", text: asOfLong },
      { kind: "paragraph", text: [addressee, name, mailing].filter(Boolean).join("\n") },
      { kind: "paragraph", text: `Re: ${name} — documents dated ${asOfLong}` },
      { kind: "paragraph", text: `Dear ${addressee === "[Addressee]" ? "[Addressee]" : addressee}:` },
      { kind: "paragraph", text: `Enclosed are the following documents for ${name}. Please review each one. Where a document is to be signed, sign and date it where indicated and return the signed copy so that it can be placed in the minute book.` },
      enclosures.length
        ? { kind: "table", columns: ["", "Enclosure"], widths: [1, 8], rows: enclosures.map((title, index) => [String(index + 1), title]) }
        : { kind: "paragraph", text: "1. [List each enclosed document]" },
      { kind: "paragraph", text: "Please contact us with any questions about the enclosed documents." },
      { kind: "paragraph", text: "Yours truly," },
      { kind: "signatures", signers: [{ name: signer }] },
    ],
    warnings,
  };
}

function lotaReport(input: MinuteBookReportInput & { asOf: string }, name: string): Body {
  const asOfLong = formatLongDate(input.asOf, "en");
  const threshold = typeof input.lotaThresholdPercent === "number" && input.lotaThresholdPercent > 0 ? input.lotaThresholdPercent : 10;
  const warnings: string[] = [];
  const blocks: PacketBlock[] = [{ kind: "note", text: restrictedNotice("lota-report") }];
  const { classes, holdings, resolve } = holdingsTable(input);
  const classInputs = classes.map((cls) => ({ rightsClassId: cls._id, votesPerShare: cls.votesPerShare, votingRights: cls.votingRights, classType: cls.classType }));
  const power = computeVotingPower(holdings.map((h) => ({ holderKey: h.holderKey, holderName: resolve(h.holderKey).name, rightsClassId: h.rightsClassId, quantity: h.quantity })), classInputs);
  const land = (input.assets ?? []).filter((asset) => /land|real|property|building|premises/i.test(`${clean(asset.category)} ${clean(asset.name)}`)
    && startedBy(asset.purchaseDate, input.asOf) && !(day(asset.disposedAt) && day(asset.disposedAt) <= input.asOf));
  blocks.push({
    kind: "paragraph",
    text: `Worksheet of registered shareholders of ${name} who, at the end of ${asOfLong}, hold ${threshold}% or more of the issued shares or of the votes at general meetings, for a Land Owner Transparency Act (British Columbia) report about land the ${entityNoun(input.organization)} holds.`,
  });
  blocks.push({ kind: "heading", text: "Land recorded in the asset register" });
  blocks.push({
    kind: "table", columns: ["Property", "Location", "Identifier (PID)"], widths: [3, 4, 2],
    rows: land.map((asset) => [clean(asset.name), clean(asset.location) || clean(asset.assetJurisdiction), clean(asset.serialNumber) || FILL]),
    emptyText: "No land is recorded in the asset register as at this date. Add the parcel identifier and legal description before preparing a report.",
  });
  const qualifying = power.holders.filter((h) => h.percentOfShares >= threshold || h.percentOfVotes >= threshold);
  const individuals = qualifying.filter((h) => {
    const role = resolve(h.holderKey).role;
    return role ? !role.nonNaturalPerson : !looksLikeOrganization(h.holderName);
  });
  const entities = qualifying.filter((h) => !individuals.includes(h));
  blocks.push({ kind: "heading", text: `Individuals holding ${threshold}% or more of shares or votes (direct registered holdings)` });
  if (!individuals.length) blocks.push({ kind: "paragraph", text: "No individual meets the threshold through direct registered holdings on this date." });
  individuals.forEach((holder) => {
    const role = resolve(holder.holderKey).role;
    blocks.push({ kind: "heading", text: holder.holderName });
    blocks.push({
      kind: "table", columns: [], widths: [2, 3],
      rows: [
        ["Full name", holder.holderName],
        ["Percentage of issued shares", percent(holder.percentOfShares)],
        ["Percentage of votes", percent(holder.percentOfVotes)],
        ["Date of birth", role ? longDate(role.dateOfBirth) || FILL : FILL],
        ["Last known address", role ? residentialAddress(role) || FILL : FILL],
        ["Citizenship", role ? ((role.citizenshipCountries ?? []).join(", ") || clean(role.citizenshipResidency) || FILL) : FILL],
        ["Social insurance number", FILL],
        ["Individual tax number", FILL],
      ],
    });
  });
  if (entities.length) {
    warnings.push("A corporate or other non-individual holder meets the threshold; look through it to the individuals who control it.");
    blocks.push({ kind: "heading", text: "Non-individual holders at or above the threshold" }, {
      kind: "table", columns: ["Holder", "% of shares", "% of votes"], widths: [4, 2, 2],
      rows: entities.map((h) => [h.holderName, percent(h.percentOfShares), percent(h.percentOfVotes)]),
    }, { kind: "note", text: "Look through each holder to the individuals who hold or control its interests (indirect control)." });
  }
  blocks.push({
    kind: "note",
    text: "Review notes: this worksheet counts direct registered holdings only. Beneficial, indirect and joint interests and the right to elect, appoint or remove a majority of the directors (Land Owner Transparency Act, s. 3) are not computed and must be reviewed. Social insurance and tax numbers are fill-ins on purpose: enter them only on the copy used to prepare the report and never store them in Societyer. This worksheet is not a filed report.",
  });
  return { title: "Land Owner Transparency Act interest-holder worksheet", subtitle: asAt(name, asOfLong), blocks, warnings };
}
