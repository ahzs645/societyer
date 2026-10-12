/**
 * Build a document RenderContext from a society record + its role holders
 * (pure logic). Bridges the persisted shape (societies row + roleHolders rows)
 * to the grammar-aware RenderContext consumed by templates / packet rendering.
 *
 * Every group is read as at the document date (YCN start <= date < end), so a
 * backdated resolution names the directors, shareholders, legal name and Act
 * that were in force on that date.
 */

import { buildRenderContext, type RenderContext, type RenderContextOrg } from "./renderContext";
import { normalizeGender, parsePronouns, type Actor } from "./nlg";
import { resolveLocale } from "./locale";
import { activeAsOf, type IntervalRow } from "./registerHistory";
import { nameAsOf, type NameRecord } from "./nameHistory";
import type { ConstatingEvent } from "./constating";
import { deriveCurrentHoldings, type RightsholdingTransferRecord } from "./equityLedger";
import { explicitVotesPerShare } from "./shareholderElectorate";

/** Minimal society shape this needs (a Convex societies row satisfies it). */
export interface SocietyLike {
  name?: string;
  legalName?: string;
  shortName?: string;
  entityType?: string;
  actFormedUnder?: string;
  jurisdictionCode?: string;
  incorporationNumber?: string;
  sealLocation?: string;
  /** YCN DOC_PREP_LANGUAGE — drives document locale (date/execution prose). */
  docPrepLanguage?: string;
}

/** Minimal role-holder shape (a Convex roleHolders row satisfies it). */
export interface RoleHolderLike {
  _id?: unknown;
  roleType?: string;
  status?: string;
  fullName?: string;
  gender?: string;
  /** Stated pronouns (e.g. "they/them", "xe/xir") — override gender for NLG. */
  pronouns?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  nonNaturalPerson?: boolean;
}

/** Optional point-in-time registers used to resolve the context as at the date. */
export interface SocietyRenderOptions {
  /** Ledger rows; when present, voting shareholders come from voting-class holdings. */
  transfers?: readonly Record<string, any>[];
  rightsClasses?: readonly Record<string, any>[];
  /** Effective-dated legal names (societyNameHistory rows). */
  nameHistory?: readonly NameRecord[];
  /** Constating timeline (constatingEvents rows). */
  constating?: readonly ConstatingEvent[];
}

function toActor(row: RoleHolderLike): Actor {
  return {
    name: String(row.fullName ?? ""),
    gender: normalizeGender(row.gender),
    customPronouns: parsePronouns(row.pronouns),
    ...(row.nonNaturalPerson ? { isOrganization: true } : {}),
  };
}

/** The calendar day of an ISO date or timestamp. */
export function isoDay(value: string | null | undefined): string {
  return String(value ?? "").slice(0, 10);
}

/**
 * Role holders of a type in office on `asOf` (start <= day < end). Rows without
 * an end date that are marked former or proposed are not in office.
 */
export function roleHoldersInOffice<T extends RoleHolderLike>(rows: readonly T[], roleType: string, asOf: string): T[] {
  const day = isoDay(asOf);
  const typed = rows.filter((r) => r.roleType === roleType && !(!r.endDate && ["former", "proposed"].includes(String(r.status ?? ""))));
  return activeAsOf(typed as unknown as IntervalRow[], day) as unknown as T[];
}

/**
 * Role-holder ids holding a voting-class share at the end of `asOf`, or
 * undefined when no ledger is supplied. A class whose votes are not stated
 * unambiguously counts as voting (missing a required signer is worse than an
 * extra one; the electorate review resolves it).
 */
export function votingHolderIdsAsOf(
  transfers: readonly Record<string, any>[] | undefined,
  rightsClasses: readonly Record<string, any>[] | undefined,
  asOf: string,
): Set<string> | undefined {
  if (!transfers || !rightsClasses) return undefined;
  const day = isoDay(asOf);
  const dated = transfers.filter((t) => t.status === "posted" && (!t.transferDate || isoDay(t.transferDate) <= day));
  const holdings = deriveCurrentHoldings(dated as unknown as RightsholdingTransferRecord[]);
  const votesByClass = new Map(rightsClasses.map((c) => [String(c._id), explicitVotesPerShare(c)]));
  const ids = new Set<string>();
  for (const holding of holdings) {
    if (holding.quantity <= 0 || !holding.holderKey.startsWith("roleHolder:")) continue;
    const votes = votesByClass.get(holding.rightsClassId);
    if (votes === 0) continue;
    ids.add(holding.holderKey.slice("roleHolder:".length));
  }
  return ids;
}

/** The role-holder rows that make up each signing body as at `asOf`. */
export function bodyRowsAsOf<T extends RoleHolderLike>(
  roleHolders: readonly T[],
  asOf: string,
  options: Pick<SocietyRenderOptions, "transfers" | "rightsClasses"> = {},
) {
  const shareholders = roleHoldersInOffice(roleHolders, "shareholder", asOf);
  const votingIds = votingHolderIdsAsOf(options.transfers, options.rightsClasses, asOf);
  return {
    directors: roleHoldersInOffice(roleHolders, "director", asOf),
    officers: roleHoldersInOffice(roleHolders, "officer", asOf),
    members: roleHoldersInOffice(roleHolders, "member", asOf),
    shareholders,
    votingShareholders: votingIds ? shareholders.filter((row) => votingIds.has(String(row._id ?? ""))) : shareholders,
  };
}

export function buildSocietyRenderContext(
  society: SocietyLike,
  roleHolders: readonly RoleHolderLike[],
  asOfISO: string,
  options: SocietyRenderOptions = {},
): RenderContext {
  const named = options.nameHistory?.length ? nameAsOf([...options.nameHistory], isoDay(asOfISO) || asOfISO) : null;
  const org: RenderContextOrg = {
    legalName: named?.name ?? society.legalName ?? society.name,
    shortName: named?.shortName ?? society.shortName,
    entityType: society.entityType,
    actFormedUnder: society.actFormedUnder,
    jurisdictionCode: society.jurisdictionCode,
    incorporationNumber: society.incorporationNumber,
    sealLocation: society.sealLocation,
  };
  const rows = bodyRowsAsOf(roleHolders, asOfISO, options);
  return buildRenderContext({
    org,
    directors: rows.directors.map(toActor),
    members: rows.members.map(toActor),
    officers: rows.officers.map(toActor),
    shareholders: rows.shareholders.map(toActor),
    votingShareholders: rows.votingShareholders.map(toActor),
    asOf: asOfISO,
    locale: resolveLocale(society.docPrepLanguage),
    constating: options.constating,
  });
}
