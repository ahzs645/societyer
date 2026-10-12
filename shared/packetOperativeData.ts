import { officerTitleLabel } from "./orgHubOptions";
import { formatLongDate } from "./locale";
import { capitalizeFirst, itThem, joinNames, pluralize, shareClassNoun, shareQuantityLabel, type ShareClassNaming } from "./nlg";
import { deriveCurrentHoldings, type RightsholdingTransferRecord } from "./equityLedger";
import { isFederalCbca, isOntarioObca, canonicalizeJurisdictionCode, homeJurisdictionCode, type LegalEntityLike } from "./organizationDomain";
/**
 * Operative-data view builders for the document packets (YCN `Doc - *`
 * operative tables).
 *
 * The lawyer's central design: every document pulls only the rows that take
 * effect on the document (event) date, and reads every fact as at that date.
 * Each builder therefore takes a `PacketScope` — the event date and, optionally,
 * the ids of the selected transactions — and returns only the rows of the
 * transaction being approved, never the whole register.
 *
 * Each builder is pure: it takes already-fetched register rows and returns a
 * plain context fragment that the packet instrument renders. The Convex layer
 * (buildPacketDataContext) fetches the rows and merges the result into the
 * render context. Framework-free. Named exports only.
 */

/** The transaction being approved: its effective date and optional selected ids. */
export interface PacketScope {
  /** Event / effective date (YYYY-MM-DD or an ISO timestamp). */
  asOf: string;
  /** When present, exactly these register rows (by _id) are the transaction. */
  ids?: readonly string[];
}

type Row = Record<string, any>;

/** Format an integer count with thousands separators (YCN Num_Comma). */
export function formatCount(n: number | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-CA") : "";
}

export function isoDay(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

/** A row belongs to the transaction when selected by id, else when dated on the event date. */
function inScope(row: Row, scope: PacketScope, ...dates: unknown[]): boolean {
  if (scope.ids?.length) return scope.ids.includes(String(row._id ?? ""));
  const day = isoDay(scope.asOf);
  return Boolean(day) && dates.some((date) => isoDay(date) === day);
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Count-driven grammar for a list of rows ("a director has" / "directors have"). */
export function countGrammar(count: number) {
  const one = count === 1;
  return {
    count,
    isSole: one,
    isMultiple: count > 1,
    nounS: one ? "" : "s",
    verbS: one ? "s" : "",
    hasHave: one ? "has" : "have",
    isAre: one ? "is" : "are",
    itThem: itThem(count),
    aSpace: one ? "a " : "",
    anSpace: one ? "an " : "",
  };
}

const placeholder = (label: string) => `[${label}]`;

function longDate(value: unknown, fallbackLabel: string): string {
  const day = isoDay(value);
  return day ? formatLongDate(day) : placeholder(fallbackLabel);
}

/** "CAD 1,250.00" / "C$0.50" from integer cents and a stored currency. */
export function formatMoneyCents(cents: number | undefined | null, currency: string | undefined | null): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  const amount = (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const code = String(currency ?? "").trim();
  if (!code) return amount;
  if (/^[a-z]{3}$/i.test(code)) return `${code.toUpperCase()} ${amount}`;
  return `${code}${amount}`;
}

// ---------------------------------------------------------------------------
// Entity-aware law fragments (BC BCA, CBCA, OBCA). Wording is preparation
// text for lawyer review; section numbers verified against the consolidations.
// ---------------------------------------------------------------------------

export type CorporateLawProfile = "bc" | "federal" | "ontario" | "other";

export function corporateLawProfile(org: LegalEntityLike | null | undefined): CorporateLawProfile {
  if (!org) return "other";
  if (isFederalCbca(org)) return "federal";
  if (isOntarioObca(org)) return "ontario";
  return canonicalizeJurisdictionCode(homeJurisdictionCode(org)) === "CA-BC" ? "bc" : "other";
}

/** Law-dependent clause fragments for the corporate packets. */
export function corporateLawContext(org: LegalEntityLike | null | undefined, legislation: string) {
  const profile = corporateLawProfile(org);
  const act = legislation || "governing Act";
  const bc = profile === "bc", federal = profile === "federal", ontario = profile === "ontario";
  return {
    profile, isBc: bc, isFederal: federal, isOntario: ontario, isOther: profile === "other",
    removalResolutionKind: bc ? "special resolution" : federal || ontario ? "ordinary resolution" : "[resolution required by the governing Act and articles]",
    removalResolvedLine: bc ? "BE IT RESOLVED, AS A SPECIAL RESOLUTION, THAT:" : federal || ontario ? "BE IT RESOLVED, AS AN ORDINARY RESOLUTION, THAT:" : "BE IT RESOLVED THAT:",
    removalAuthority: bc
      ? `section 128(3)(a) of the ${act}`
      : federal ? `section 109(1) of the ${act}` : ontario ? `section 122(1) of the ${act}` : `the ${act}`,
    removalNote: bc
      ? `[Removal before the end of a term is by special resolution under section 128(3)(a) of the {org.legislation}, unless the memorandum or articles provide another resolution or method (section 128(3)(b)); follow that method instead where it applies. A written special resolution needs the consent of every shareholder entitled to vote. A director elected or appointed by holders of a class or series with an exclusive right to elect may be removed only by a special separate resolution of those holders, or the method the articles provide (section 128(4)).]`
      : federal
        ? `[Under section 109(1) of the {org.legislation}, the shareholders remove a director by ordinary resolution at a special meeting. A written resolution signed by every shareholder entitled to vote is valid under section 142(1) unless the director submits a written statement under section 110(2); confirm this before relying on the written route. A director elected by a class or series with an exclusive right is removed only by that class or series (section 109(2)).]`
        : ontario
          ? `[Under section 122(1) of the {org.legislation}, the shareholders remove a director by ordinary resolution at an annual or special meeting. Confirm the written-resolution route under section 104 is available, including where the director is entitled to submit a written statement under section 123(2). A director elected by a class or series with an exclusive right is removed only by that class or series (section 122(2)).]`
          : "[Confirm the removal route under the governing Act and the articles before use.]",
    resignationAuthority: bc ? `section 128(2) of the ${act}` : federal ? `section 108(2) of the ${act}` : ontario ? `section 121(2) of the ${act}` : `the ${act}`,
    directorChangeFiling: bc
      ? "a notice of change of directors with the registrar within 15 days after the change (section 127)"
      : federal
        ? "a notice of change of directors with Corporations Canada within 15 days after the change (section 113)"
        : ontario
          ? "a notice of change under the Corporations Information Act (Ontario) within the period that Act requires"
          : "any notice of change the governing Act requires",
    directorConsentCitation: bc ? "sections 122(4) and 123" : federal ? "section 106(9)" : ontario ? "section 119(9)" : "the governing Act",
    directorsAppointBasis: bc
      ? `[The directors may fill a casual vacancy (section 131), and may appoint additional directors only if the memorandum or articles so provide, up to one-third of the current directors who were not themselves appointed as additional directors (section 122(2)–(3)). Vacancies caused by a removal under section 128(3) are filled under section 131(a). Confirm the articles do not provide otherwise (section 130).]`
      : federal
        ? `[A quorum of directors may fill a vacancy, except one resulting from an increase in the number or minimum number of directors or a failure to elect the number or minimum number required by the articles (section 111(1)). Additional directors may be appointed only if the articles permit, for a term ending by the next annual meeting and not exceeding one-third of the directors elected at the previous annual meeting (section 106(8)).]`
        : ontario
          ? `[A quorum of directors may fill a vacancy, except one resulting from an increase in the number or maximum number of directors (other than under section 124(2)) or a failure to elect the required number (section 124(1)). Additional directors between meetings require the special-resolution framework in sections 124(2) and 125(3).]`
          : "[Confirm that the directors may appoint a director under the governing Act and the articles.]",
    alterationFilingTask: bc
      ? "[After the special resolution, file a Notice of Alteration with the registrar where the notice of articles changes, and deposit the resolution at the records office (sections 257, 259 and 263).]"
      : federal
        ? "[After the special resolution, file articles of amendment with the Director; the change takes effect on the certificate of amendment (sections 173 and 177–178).]"
        : ontario
          ? "[After the special resolution, file articles of amendment; the change takes effect on the certificate of amendment (sections 168 and 171–172).]"
          : "[File any notice or amendment the governing Act requires.]",
    dividendSolvencyRecital: bc
      ? "there are no reasonable grounds for believing that {org.shortName} is insolvent or that paying any dividend declared by this resolution would render {org.shortName} insolvent (section 70(2) of the {org.legislation})"
      : federal || ontario
        ? `there are no reasonable grounds for believing that {org.shortName} is, or would after paying any dividend declared by this resolution be, unable to pay its liabilities as they become due, or that the realizable value of its assets would thereby be less than the aggregate of its liabilities and stated capital of all classes (section ${federal ? "42" : "38(3)"} of the {org.legislation})`
        : "paying any dividend declared by this resolution meets the solvency test under the {org.legislation}",
    redemptionSolvencyRecital: bc
      ? "there are no reasonable grounds for believing that {org.shortName} is insolvent or that making the payment to redeem the shares would render {org.shortName} insolvent (section 79(1) of the {org.legislation})"
      : federal || ontario
        ? `there are no reasonable grounds for believing that {org.shortName} is, or would after the payment be, unable to pay its liabilities as they become due, or that the realizable value of its assets would after the payment be less than the aggregate of its liabilities and the amount required to pay holders with a right to be paid before or rateably with the redeemed shares on a liquidation (section ${federal ? "36(2)" : "32(2)"} of the {org.legislation})`
        : "the redemption meets the solvency test under the {org.legislation}",
    redemptionAuthority: bc ? "section 77(a)" : federal ? "section 36(1)" : ontario ? "section 32(1)" : "the governing Act",
    securitiesRegister: bc ? "central securities register" : "securities register",
    officeChangeTask: bc
      ? "[File a notice of change of address with the registrar; the change takes effect under section 37 once the notice is filed (section 35). A directors' resolution authorizes the change where the articles are silent on how it is authorized (section 35(2)).]"
      : federal
        ? "[Send the notice of change of registered office address to Corporations Canada within 15 days after the change (section 19(4)). A move to another province requires an amendment to the articles.]"
        : ontario
          ? "[Confirm the directors may make the change under the articles and the Act, and file the notice of change under the Corporations Information Act (Ontario).]"
          : "[File any notice of change the governing Act requires.]",
  };
}

// ---------------------------------------------------------------------------
// People: directors and officers.
// ---------------------------------------------------------------------------

export interface NamedRow {
  _id?: unknown;
  fullName?: string;
  roleType?: string;
  status?: string;
  officerTitle?: string;
  additionalOfficerTitles?: string[];
  directorTerm?: string;
  startDate?: string | null;
  endDate?: string | null;
}

function inOffice(row: NamedRow, day: string): boolean {
  if (!row.endDate && ["former", "proposed"].includes(String(row.status ?? ""))) return false;
  const start = isoDay(row.startDate);
  const end = isoDay(row.endDate);
  return (!start || start <= day) && (!end || end > day);
}

/** "President and Secretary" from a person's officer rows. */
function combinedTitles(rows: NamedRow[]): string {
  const titles: string[] = [];
  for (const row of rows) {
    for (const value of [row.officerTitle, ...(row.additionalOfficerTitles ?? [])]) {
      if (!value) continue;
      const label = officerTitleLabel(value);
      if (!titles.includes(label)) titles.push(label);
    }
  }
  return joinNames(titles.length ? titles : ["Officer"]);
}

function groupOfficers(rows: NamedRow[]) {
  const byName = new Map<string, NamedRow[]>();
  for (const row of rows) {
    const name = String(row.fullName ?? "").trim();
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }
  return [...byName.entries()].map(([name, list]) => ({ name, title: combinedTitles(list) }));
}

/**
 * Officers for the officer resolution. Default: officers appointed on the event
 * date (or the selected rows). `allInOffice`: every officer in office on that
 * date (the annual directors' resolution re-appointing the slate).
 */
export function officerAppointmentView(roleHolders: NamedRow[], scope?: PacketScope, options: { allInOffice?: boolean } = {}) {
  // Without a scope (legacy callers): the officers currently in office.
  const day = scope ? isoDay(scope.asOf) : "9999-12-31";
  const all = options.allInOffice || !scope;
  const rows = roleHolders.filter((r) => r.roleType === "officer" && (all ? inOffice(r, day) : inScope(r as Row, scope!, r.startDate)));
  const officers = groupOfficers(rows);
  return { appointment: { hasOfficers: officers.length > 0, officers, personS: pluralize(officers.length, "person", "persons"), ...countGrammar(officers.length), soleOfficer: officers.length === 1 ? "the sole officer" : "officers" } };
}

/** Directors elected or appointed on the event date (or the selected rows). */
export function directorAppointmentView(roleHolders: NamedRow[], scope: PacketScope) {
  const directors = roleHolders
    .filter((r) => r.roleType === "director" && inScope(r as Row, scope, r.startDate))
    .map((r) => ({ name: String(r.fullName ?? ""), term: String(r.directorTerm ?? "") }));
  const g = countGrammar(directors.length);
  return {
    appointment: {
      hasDirectors: directors.length > 0, directors, ...g,
      personS: pluralize(directors.length, "person", "persons"),
      asDirector: directors.length === 1 ? "a director" : "directors",
      names: joinNames(directors.map((d) => d.name)),
    },
  };
}

/** Directors whose office ends on the event date (resignation or removal). */
export function directorDepartureView(roleHolders: NamedRow[], scope: PacketScope) {
  const removals = roleHolders
    .filter((r) => r.roleType === "director" && inScope(r as Row, scope, r.endDate))
    .map((r) => {
      const name = String(r.fullName ?? "");
      const endDate = isoDay(r.endDate) || isoDay(scope.asOf);
      return { name, endDate, endDateLong: longDate(endDate, "effective date"), letterSigners: [{ name }] };
    });
  const g = countGrammar(removals.length);
  return {
    removal: {
      hasRemovals: removals.length > 0, removals, ...g,
      personS: pluralize(removals.length, "person", "persons"),
      asDirector: removals.length === 1 ? "a director" : "directors",
      resignationS: pluralize(removals.length, "resignation"),
      aWrittenResignation: removals.length === 1 ? "a written resignation" : "written resignations",
      names: joinNames(removals.map((r) => r.name)),
    },
  };
}

/** @deprecated name kept for callers: departures now scope to the event date. */
export const directorRemovalView = directorDepartureView;

// ---------------------------------------------------------------------------
// Shares: issuance, transfer, certificates, split, redemption.
// ---------------------------------------------------------------------------

export interface TransferRow {
  _id?: unknown;
  transferType?: string;
  status?: string;
  transferDate?: string;
  rightsClassId?: string;
  sourceRoleHolderId?: string;
  destinationRoleHolderId?: string;
  sourceHolderName?: string;
  destinationHolderName?: string;
  quantity?: number;
  considerationType?: string;
  considerationDescription?: string;
  priceToOrganizationCents?: number;
  priceToOrganizationCurrency?: string;
  priceToVendorCents?: number;
  priceToVendorCurrency?: string;
}

export interface CertificateRow {
  _id?: unknown;
  certificateNumber?: string;
  holderName?: string;
  shareClass?: string;
  shares?: number;
  issuedOn?: string;
  replacesCertificateNumber?: string | null;
  cancelledOn?: string | null;
}

export type ClassRow = ShareClassNaming & {
  _id?: unknown;
  className?: string;
  redemption?: { byCompany?: boolean; byHolder?: boolean; priceCents?: number; includesDeclaredUnpaid?: boolean; minNoticeDays?: number; nonProRataPermitted?: boolean } | null;
};

export interface ShareRegisters {
  transfers: TransferRow[];
  classes: ClassRow[];
  roleHolders?: NamedRow[];
  certificates?: CertificateRow[];
}

function classIndex(classes: ClassRow[]) {
  const byId = new Map(classes.map((c) => [String(c._id ?? ""), c]));
  const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+shares?$/, "");
  const byName = new Map(classes.map((c) => [norm(c.className), c]));
  return {
    byId: (id: unknown) => byId.get(String(id ?? "")),
    byName: (name: unknown): ClassRow => byName.get(norm(name)) ?? { className: String(name ?? "") },
    same: (a: unknown, b: unknown) => norm(a) === norm(b),
  };
}

const ACTIVE_TRANSFER = (t: TransferRow) => t.status !== "void";

function holderName(t: TransferRow, side: "source" | "destination", roleHolders: NamedRow[] = []): string {
  const id = side === "source" ? t.sourceRoleHolderId : t.destinationRoleHolderId;
  const role = id ? roleHolders.find((r) => String(r._id ?? "") === String(id)) : undefined;
  return String(role?.fullName ?? (side === "source" ? t.sourceHolderName : t.destinationHolderName) ?? "").trim() || placeholder(side === "source" ? "transferor" : "holder");
}

function considerationLabel(t: TransferRow): string {
  const money = formatMoneyCents(t.priceToOrganizationCents, t.priceToOrganizationCurrency);
  const type = String(t.considerationType ?? "").trim();
  const typeLabel = type ? capitalizeFirst(type.replace(/[_-]+/g, " ")) : "";
  const description = String(t.considerationDescription ?? "").trim();
  return [money, typeLabel, description && description !== type ? `(${description})` : ""].filter(Boolean).join(" ") || placeholder("consideration");
}

function matchCertificate(certs: CertificateRow[], day: string, holder: string, cls: ClassRow, shares: number, same: (a: unknown, b: unknown) => boolean, used: Set<CertificateRow>) {
  const found = certs.find((c) => !used.has(c) && isoDay(c.issuedOn) === day && String(c.holderName ?? "").trim() === holder && same(c.shareClass, cls.className) && Number(c.shares) === shares);
  if (found) used.add(found);
  return found;
}

/**
 * Share allotment and issue (YCN Doc - Share Allotment): the subscriptions on
 * the event date (or the selected issuance), each with number, class,
 * consideration and the matching certificate when one is recorded.
 */
export function shareIssuanceView(registers: ShareRegisters, scope: PacketScope) {
  const classes = classIndex(registers.classes);
  const day = isoDay(scope.asOf);
  const used = new Set<CertificateRow>();
  const rows = registers.transfers
    .filter((t) => t.transferType === "issuance" && ACTIVE_TRANSFER(t) && inScope(t as Row, scope, t.transferDate))
    .map((t) => {
      const cls = classes.byId(t.rightsClassId) ?? { className: placeholder("share class") };
      const quantity = Number(t.quantity ?? 0);
      const subscriber = holderName(t, "destination", registers.roleHolders);
      const cert = matchCertificate(registers.certificates ?? [], isoDay(t.transferDate) || day, subscriber, cls, quantity, classes.same, used);
      return {
        subscriber, quantity, number: formatCount(quantity),
        classNoun: shareClassNoun(quantity, cls), sharesLabel: shareQuantityLabel(quantity, cls),
        consideration: considerationLabel(t),
        certificateNumber: cert?.certificateNumber ? String(cert.certificateNumber) : placeholder("certificate no."),
        hasCertificate: Boolean(cert),
      };
    });
  const g = countGrammar(rows.length);
  return {
    issue: {
      hasSubscriptions: rows.length > 0, subscriptions: rows, ...g,
      subscriptionRecital: rows.length === 1 ? "a subscription has" : "subscriptions have",
      subscriberS: pluralize(rows.length, "subscriber"),
      certificateS: pluralize(rows.length, "certificate"),
      personS: pluralize(rows.length, "person", "persons"),
    },
  };
}

/**
 * Share transfer (YCN Doc - Share Transfer): approvals, new certificates
 * (including a balance certificate to a transferor for shares not
 * transferred) and the surrendered certificates to cancel.
 */
export function shareTransferView(registers: ShareRegisters, scope: PacketScope, options: { consentRequired?: boolean } = {}) {
  const classes = classIndex(registers.classes);
  const day = isoDay(scope.asOf);
  const transfers = registers.transfers.filter((t) => t.transferType === "transfer" && ACTIVE_TRANSFER(t) && inScope(t as Row, scope, t.transferDate));
  const eventDay = isoDay(transfers[0]?.transferDate) || day;
  const certs = registers.certificates ?? [];
  const used = new Set<CertificateRow>();
  const approvals = transfers.map((t) => {
    const cls = classes.byId(t.rightsClassId) ?? { className: placeholder("share class") };
    const quantity = Number(t.quantity ?? 0);
    return {
      to: holderName(t, "destination", registers.roleHolders), from: holderName(t, "source", registers.roleHolders),
      quantity, quantityLabel: formatCount(quantity), className: cls.className ?? "", sharesLabel: shareQuantityLabel(quantity, cls),
      date: isoDay(t.transferDate), cls, classId: String(t.rightsClassId ?? ""), sourceRoleHolderId: String(t.sourceRoleHolderId ?? ""),
    };
  });
  // Holdings immediately before the event date, for the transferor balance.
  const before = deriveCurrentHoldings(registers.transfers.filter((t) => t.status === "posted" && isoDay(t.transferDate) < eventDay) as unknown as RightsholdingTransferRecord[]);
  const newCertificates: Array<{ number: string; holder: string; sharesLabel: string; isBalance: boolean }> = [];
  for (const a of approvals) {
    const cert = matchCertificate(certs, eventDay, a.to, a.cls, a.quantity, classes.same, used);
    newCertificates.push({ number: cert?.certificateNumber ? String(cert.certificateNumber) : placeholder("new certificate no."), holder: a.to, sharesLabel: a.sharesLabel, isBalance: false });
  }
  const cancelled: Array<{ number: string; holder: string; sharesLabel: string }> = [];
  const transferors = new Map<string, typeof approvals>();
  for (const a of approvals) transferors.set(`${a.from}|${a.classId}`, [...(transferors.get(`${a.from}|${a.classId}`) ?? []), a]);
  let balanceUnverified = false;
  for (const list of transferors.values()) {
    const { from, cls, classId, sourceRoleHolderId } = list[0];
    const transferred = list.reduce((sum, a) => sum + a.quantity, 0);
    const surrendered = certs.filter((c) => isoDay(c.cancelledOn) === eventDay && String(c.holderName ?? "").trim() === from && classes.same(c.shareClass, cls.className));
    for (const c of surrendered) cancelled.push({ number: String(c.certificateNumber ?? placeholder("certificate no.")), holder: from, sharesLabel: shareQuantityLabel(Number(c.shares ?? 0), cls) });
    let surrenderedShares = surrendered.reduce((sum, c) => sum + Number(c.shares ?? 0), 0);
    if (!surrendered.length) {
      const held = before.find((h) => h.rightsClassId === classId && h.holderKey === `roleHolder:${sourceRoleHolderId}`)?.quantity
        ?? before.find((h) => h.rightsClassId === classId && h.holderKey === `name:${from}`)?.quantity;
      cancelled.push({ number: placeholder("surrendered certificate no."), holder: from, sharesLabel: typeof held === "number" ? shareQuantityLabel(held, cls) : placeholder(`number of ${shareClassNoun(2, cls)}`) });
      surrenderedShares = typeof held === "number" ? held : 0;
      balanceUnverified = true;
    }
    const balance = surrenderedShares - transferred;
    if (balance > 0) {
      const cert = matchCertificate(certs, eventDay, from, cls, balance, classes.same, used);
      newCertificates.push({ number: cert?.certificateNumber ? String(cert.certificateNumber) : placeholder("balance certificate no."), holder: from, sharesLabel: shareQuantityLabel(balance, cls), isBalance: true });
    }
  }
  const hasBalance = newCertificates.some((c) => c.isBalance);
  const transfereeCount = new Set(approvals.map((a) => a.to)).size;
  const transferorCount = transferors.size;
  return {
    transfer: {
      hasTransfers: approvals.length > 0,
      transfers: approvals.map(({ cls, classId, sourceRoleHolderId, ...rest }) => { void cls; void classId; void sourceRoleHolderId; return rest; }),
      newCertificates, cancelled, hasBalance, balanceUnverified,
      hasCancelled: cancelled.length > 0,
      consentRequired: Boolean(options.consentRequired),
      applicationRecital: approvals.length === 1 ? "an application has" : "applications have",
      transfereeS: pluralize(transfereeCount, "transferee"), transferorS: pluralize(transferorCount, "transferor"),
      personS: pluralize(transfereeCount, "person", "persons"),
      certificateS: pluralize(newCertificates.length, "certificate"),
      cancelledCertificateS: pluralize(cancelled.length, "certificate"),
      holderHeading: hasBalance ? "Shareholder" : pluralize(transfereeCount, "Transferee"),
      newItThem: itThem(newCertificates.length),
      shareS: approvals.reduce((sum, a) => sum + a.quantity, 0) === 1 ? "share" : "shares",
    },
  };
}

/**
 * Replacement certificates (YCN Doc - Share Certificate): certificates issued
 * on the event date that replace earlier ones, and the certificates cancelled
 * that day.
 */
export function shareCertificateView(certs: CertificateRow[], scope: PacketScope, classes: ClassRow[] = []) {
  const index = classIndex(classes);
  const issued = certs
    .filter((c) => inScope(c as Row, scope, c.issuedOn) && (c.replacesCertificateNumber || scope.ids?.length))
    .map((c) => ({ number: String(c.certificateNumber ?? ""), holder: String(c.holderName ?? ""), className: String(c.shareClass ?? ""), shares: Number(c.shares ?? 0), sharesLabel: shareQuantityLabel(Number(c.shares ?? 0), index.byName(c.shareClass)), issuedOn: isoDay(c.issuedOn), replaces: String(c.replacesCertificateNumber ?? "") }));
  const replaced = new Set(issued.map((c) => c.replaces).filter(Boolean));
  const day = isoDay(scope.asOf);
  const cancelled = certs
    .filter((c) => replaced.has(String(c.certificateNumber ?? "")) || (!scope.ids?.length && Boolean(day) && isoDay(c.cancelledOn) === day))
    .map((c) => ({ number: String(c.certificateNumber ?? ""), holder: String(c.holderName ?? ""), sharesLabel: shareQuantityLabel(Number(c.shares ?? 0), index.byName(c.shareClass)), cancelledOn: isoDay(c.cancelledOn) }));
  return {
    certificate: {
      hasCertificates: issued.length > 0, certificates: issued, cancelled, hasCancelled: cancelled.length > 0,
      ...countGrammar(issued.length),
      applicationRecital: issued.length === 1 ? "an application has" : "applications have",
      aCertificate: issued.length === 1 ? "a share certificate" : "share certificates",
      certificateS: pluralize(issued.length, "certificate"), cancelledCertificateS: pluralize(cancelled.length, "certificate"),
      shareS: pluralize(issued.length, "share"), shareholderS: pluralize(new Set(issued.map((c) => c.holder)).size, "shareholder"),
      personS: pluralize(new Set(issued.map((c) => c.holder)).size, "person", "persons"),
    },
  };
}

/** Subdivision / consolidation lines (from the staged split run). */
export function shareSplitView(runData: Record<string, unknown>, cls: ClassRow | undefined) {
  const lines = Array.isArray(runData.lines) ? (runData.lines as Array<Record<string, unknown>>) : [];
  const className = String(runData.shareClassName ?? cls?.className ?? "");
  const naming: ClassRow = cls ?? { className };
  const rows = lines.map((line) => ({ holderName: String(line.holderName ?? ""), before: Number(line.before ?? 0), after: Number(line.after ?? 0) }));
  const increases = rows.filter((r) => r.after > r.before).map((r) => ({ holderName: r.holderName, label: shareQuantityLabel(r.after - r.before, naming) }));
  const decreases = rows.filter((r) => r.after < r.before).map((r) => ({ holderName: r.holderName, label: shareQuantityLabel(r.before - r.after, naming) }));
  const kind = String(runData.kind ?? "");
  const isSubdivision = kind === "subdivision" || increases.length > 0;
  const isConsolidation = kind === "consolidation" || decreases.length > 0;
  return {
    split: {
      ratioLabel: String(runData.ratioLabel ?? ""),
      kind,
      totalBefore: Number(runData.totalBefore ?? 0),
      totalAfter: Number(runData.totalAfter ?? 0),
      sharesDropped: Number(runData.sharesDropped ?? 0),
      hasLines: rows.length > 0,
      hasDroppedShares: Number(runData.sharesDropped ?? 0) > 0,
      lines: rows,
      increases, decreases, isSubdivision, isConsolidation, isBoth: isSubdivision && isConsolidation,
      classPlural: shareClassNoun(2, naming),
      title: [isSubdivision ? "Subdivision" : "", isConsolidation ? "Consolidation" : ""].filter(Boolean).join(" and ") || "Subdivision or Consolidation",
      certificateItThem: itThem(increases.length + decreases.length),
      resolutionS: isSubdivision && isConsolidation ? "resolutions" : "resolution",
    },
  };
}

/**
 * Share redemption (articles' redemption right; BC BCA s. 77(a) and the s. 79
 * solvency bar): redemption rows on the event date with the class's
 * redemption price, and the notice fields.
 */
export function shareRedemptionView(registers: ShareRegisters, scope: PacketScope, notice: Record<string, unknown> = {}) {
  const classes = classIndex(registers.classes);
  const rows = registers.transfers
    .filter((t) => t.transferType === "redemption" && ACTIVE_TRANSFER(t) && inScope(t as Row, scope, t.transferDate))
    .map((t) => {
      const cls = classes.byId(t.rightsClassId) ?? { className: placeholder("share class") };
      const quantity = Number(t.quantity ?? 0);
      const redemption = cls.redemption ?? undefined;
      const priceCents = typeof redemption?.priceCents === "number" ? redemption.priceCents : quantity && typeof t.priceToVendorCents === "number" ? Math.round(t.priceToVendorCents / quantity) : undefined;
      const currency = t.priceToVendorCurrency ?? "CAD";
      const totalCents = typeof t.priceToVendorCents === "number" ? t.priceToVendorCents : typeof priceCents === "number" ? priceCents * quantity : undefined;
      return {
        holder: holderName(t, "source", registers.roleHolders), quantity, sharesLabel: shareQuantityLabel(quantity, cls),
        className: String(cls.className ?? ""), classPlural: shareClassNoun(2, cls),
        price: typeof priceCents === "number" ? formatMoneyCents(priceCents, currency) : placeholder("redemption price per share"),
        total: typeof totalCents === "number" ? formatMoneyCents(totalCents, currency) : placeholder("total"),
        includesDeclaredUnpaid: redemption?.includesDeclaredUnpaid === true,
        minNoticeDays: typeof redemption?.minNoticeDays === "number" ? redemption.minNoticeDays : undefined,
        nonProRataPermitted: redemption?.nonProRataPermitted,
        byCompany: redemption?.byCompany,
        classId: String(t.rightsClassId ?? ""),
      };
    });
  const classNames = [...new Set(rows.map((r) => r.classPlural))];
  const minNotice = rows.map((r) => r.minNoticeDays).filter((n): n is number => typeof n === "number");
  const waived = notice.noticeWaived === true;
  const day = isoDay(scope.asOf);
  const redemptionDate = isoDay(notice.redemptionDate) || day;
  // Holders of each redeemed class immediately before the date, to flag a non-pro-rata redemption.
  const before = deriveCurrentHoldings(registers.transfers.filter((t) => t.status === "posted" && isoDay(t.transferDate) < (redemptionDate || day)) as unknown as RightsholdingTransferRecord[]);
  const partialClass = rows.some((r) => {
    const holders = before.filter((h) => h.rightsClassId === r.classId && h.quantity > 0).length;
    const redeemedHolders = new Set(rows.filter((x) => x.classId === r.classId).map((x) => x.holder)).size;
    return holders > redeemedHolders || rows.filter((x) => x.classId === r.classId).reduce((s, x) => s + x.quantity, 0) < before.filter((h) => h.rightsClassId === r.classId).reduce((s, h) => s + h.quantity, 0);
  });
  return {
    redemption: {
      hasRedemptions: rows.length > 0, rows: rows.map(({ classId, ...rest }) => { void classId; return rest; }), ...countGrammar(rows.length),
      classList: joinNames(classNames) || placeholder("redeemable class"),
      includesDeclaredUnpaid: rows.some((r) => r.includesDeclaredUnpaid),
      priceSummary: joinNames([...new Set(rows.map((r) => r.price))]) || placeholder("redemption price per share"),
      redemptionDateLong: longDate(redemptionDate, "redemption date"),
      noticeDateLong: longDate(notice.noticeDate, "notice date"),
      place: String(notice.redemptionPlace ?? "").trim() || placeholder("place of redemption (e.g. the registered office)"),
      noticeWaived: waived,
      hasMinNotice: minNotice.length > 0,
      minNoticeDays: minNotice.length ? String(Math.max(...minNotice)) : placeholder("minimum notice days in the articles"),
      notByCompany: rows.some((r) => r.byCompany === false),
      nonProRataFlag: partialClass && rows.some((r) => r.nonProRataPermitted !== true),
      holderS: pluralize(new Set(rows.map((r) => r.holder)).size, "holder"),
      noticeRows: [{
        date: longDate(redemptionDate, "redemption date"),
        place: String(notice.redemptionPlace ?? "").trim() || placeholder("place of redemption"),
        price: joinNames([...new Set(rows.map((r) => r.price))]) || placeholder("redemption price per share"),
        notice: waived ? "Waived in writing by each holder" : `${minNotice.length ? Math.max(...minNotice) : placeholder("minimum")} days before the redemption date`,
      }],
    },
  };
}

// ---------------------------------------------------------------------------
// Offices.
// ---------------------------------------------------------------------------

export interface AddressRow {
  type?: string; // registered_office | records_office | ...
  status?: string; // current | past | proposed
  street?: string;
  unit?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

/** One-line address string from an address row. */
export function formatAddress(a: AddressRow | undefined): string {
  if (!a) return "";
  return [
    [a.street, a.unit].filter(Boolean).join(", "),
    a.city,
    [a.provinceState, a.postalCode].filter(Boolean).join(" "),
    a.country,
  ].filter((p) => p && String(p).trim()).join(", ");
}

/** The address of a type in force on `day` (start <= day < end). */
export function addressInForce(addresses: AddressRow[], type: string, day: string): AddressRow | undefined {
  return addresses
    .filter((a) => a.type === type && a.status !== "proposed" && isoDay(a.effectiveFrom) && isoDay(a.effectiveFrom) <= day && (!isoDay(a.effectiveTo) || isoDay(a.effectiveTo) > day))
    .sort((x, y) => isoDay(y.effectiveFrom).localeCompare(isoDay(x.effectiveFrom)))[0];
}

function officeClause(addresses: AddressRow[], type: string, day: string) {
  const typed = addresses.filter((a) => a.type === type);
  const dated = typed.some((a) => isoDay(a.effectiveFrom));
  if (dated) {
    const current = addressInForce(typed, type, day);
    if (!current || isoDay(current.effectiveFrom) !== day) return { changed: false, initial: false, address: formatAddress(current), prior: "", undated: false };
    const prior = addressInForce(typed, type, previousDay(day));
    const priorText = formatAddress(prior);
    const address = formatAddress(current);
    if (priorText && priorText === address) return { changed: false, initial: false, address, prior: priorText, undated: false };
    return { changed: true, initial: !priorText, address, prior: priorText, undated: false };
  }
  // Legacy rows without dates: the current row versus the latest past row.
  const pick = (status: string) => typed.filter((a) => a.status === status)[0];
  const current = pick("current");
  const prior = pick("past");
  if (!current) return { changed: false, initial: false, address: "", prior: "", undated: true };
  return { changed: true, initial: !prior, address: formatAddress(current), prior: formatAddress(prior), undated: true };
}

/**
 * Office changes on the event date (YCN Doc - Change Offices): "be initially
 * at" when no office was in force the day before, "be changed from … to" when
 * the address changed, and nothing for an office that did not change.
 */
export function officeChangeView(addresses: AddressRow[], scope: PacketScope) {
  const day = isoDay(scope.asOf);
  const registered = officeClause(addresses, "registered_office", day);
  const records = officeClause(addresses, "records_office", day);
  const count = Number(registered.changed) + Number(records.changed);
  return {
    offices: {
      registered: registered.address, records: records.address,
      priorRegistered: registered.prior, priorRecords: records.prior,
      registeredChanged: registered.changed && !registered.initial, registeredInitial: registered.changed && registered.initial,
      recordsChanged: records.changed && !records.initial, recordsInitial: records.changed && records.initial,
      hasRegistered: Boolean(registered.address), hasRecords: Boolean(records.address),
      hasPriorRegistered: Boolean(registered.prior), hasPriorRecords: Boolean(records.prior),
      hasChanges: count > 0, undated: (registered.changed && registered.undated) || (records.changed && records.undated),
      resolutionS: count > 1 ? "resolutions" : "resolution",
    },
  };
}

// ---------------------------------------------------------------------------
// Assets.
// ---------------------------------------------------------------------------

export interface AssetRow {
  _id?: unknown;
  name?: string;
  category?: string;
  status?: string; // in_service | disposed | ...
  serialNumber?: string;
  purchaseDate?: string;
  purchaseValueCents?: number;
  currency?: string;
  supplier?: string;
  acquiredFrom?: string;
  acquisitionCurrency?: string;
  disposedAt?: string;
  disposedTo?: string;
  disposalValueCents?: number;
  dispositionCurrency?: string;
  notes?: string;
}

function isRealEstate(category: string): boolean {
  return /real|land|property|building|premises/i.test(category);
}

function assetRow(a: AssetRow, side: "acquire" | "dispose") {
  const category = String(a.category ?? "").trim();
  const realEstate = isRealEstate(category);
  const identifier = String(a.serialNumber ?? "").trim();
  const value = side === "acquire"
    ? formatMoneyCents(a.purchaseValueCents, a.acquisitionCurrency ?? a.currency)
    : formatMoneyCents(a.disposalValueCents, a.dispositionCurrency ?? a.currency);
  return {
    name: String(a.name ?? ""),
    category: category || "asset",
    kindPhrase: realEstate ? "real estate property" : category ? `${category.toLowerCase()} asset` : "asset",
    identifier,
    identifierLabel: realEstate ? "PID" : "serial number",
    identifierText: identifier ? `${realEstate ? "PID" : "serial number"} ${identifier}` : "",
    counterparty: String((side === "acquire" ? a.acquiredFrom ?? a.supplier : a.disposedTo) ?? "").trim() || placeholder(side === "acquire" ? "seller" : "purchaser"),
    value: value || placeholder(side === "acquire" ? "purchase price" : "sale price"),
    from: String(a.acquiredFrom ?? a.supplier ?? ""),
    date: isoDay(side === "acquire" ? a.purchaseDate : a.disposedAt),
    notes: String(a.notes ?? ""),
  };
}

/**
 * Asset acquisitions and dispositions on the event date (YCN Doc - Asset
 * Transfer): one prose sentence for a single asset, tables otherwise.
 */
export function assetTransferView(assets: AssetRow[], scope: PacketScope) {
  const acquisitions = assets.filter((a) => inScope(a as Row, scope, a.purchaseDate) && (!scope.ids?.length || a.status !== "disposed")).map((a) => assetRow(a, "acquire"));
  const dispositions = assets.filter((a) => inScope(a as Row, scope, a.disposedAt) && (!scope.ids?.length || a.status === "disposed")).map((a) => assetRow(a, "dispose"));
  const total = acquisitions.length + dispositions.length;
  const single = total === 1;
  const verbs = [acquisitions.length ? "acquire" : "", dispositions.length ? "dispose of" : ""].filter(Boolean).join(" and ");
  const nouns = [acquisitions.length ? "acquisition" : "", dispositions.length ? "disposition" : ""].filter(Boolean).join(" and ");
  return {
    assetTransfer: {
      hasAcquisitions: acquisitions.length > 0, acquisitions,
      hasDispositions: dispositions.length > 0, dispositions,
      hasAssets: total > 0, isSingle: single,
      singleAcquisition: single && acquisitions.length === 1 ? acquisitions[0] : null,
      singleDisposition: single && dispositions.length === 1 ? dispositions[0] : null,
      useTables: total > 1,
      tableAcquisitions: total > 1 && acquisitions.length > 0,
      tableDispositions: total > 1 && dispositions.length > 0,
      verbPhrase: verbs || "acquire or dispose of",
      nounPhrase: nouns || "acquisition or disposition",
      propertyS: pluralize(total, "property", "properties"),
    },
  };
}

// ---------------------------------------------------------------------------
// Dividends.
// ---------------------------------------------------------------------------

export interface DividendRow {
  _id?: unknown;
  declaredOn?: string;
  shareClass?: string;
  rightsClassId?: string;
  perShareCents?: number;
  perShareAmount?: string;
  sharesOutstanding?: number;
  totalCents?: number;
  currency?: string;
  recordDate?: string;
  paymentDate?: string;
  solvencyConfirmedAt?: string;
  solvencyBasis?: string;
  excludedClassIds?: string[];
}

function perShareText(row: DividendRow): string {
  const currency = String(row.currency ?? "").trim();
  const decimal = String(row.perShareAmount ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(decimal)) return /^[a-z]{3}$/i.test(currency) ? `${currency.toUpperCase()} ${decimal}` : `${currency}${decimal}`;
  return formatMoneyCents(Number(row.perShareCents ?? 0), currency);
}

/**
 * The dividends declared on the event date, one entry per class, each payable
 * on its payment date to holders of record of that class on its record date.
 */
export function dividendDeclarationView(rows: DividendRow[], scope: PacketScope, classes: ClassRow[] = [], defaults: { recordDate?: string; paymentDate?: string } = {}) {
  const index = classIndex(classes);
  const selected = rows.filter((row) => inScope(row as Row, scope, row.declaredOn));
  const declarations = selected.map((row) => {
    const cls = index.byId(row.rightsClassId) ?? index.byName(row.shareClass);
    const recordDate = isoDay(row.recordDate) || isoDay(defaults.recordDate);
    const paymentDate = isoDay(row.paymentDate) || isoDay(defaults.paymentDate);
    return {
      className: String(cls.className ?? row.shareClass ?? ""),
      classPlural: shareClassNoun(2, cls),
      perShare: perShareText(row),
      total: formatMoneyCents(Number(row.totalCents ?? 0), row.currency),
      sharesOutstanding: formatCount(Number(row.sharesOutstanding ?? 0)),
      recordDateLong: longDate(recordDate, "record date"),
      paymentDateLong: longDate(paymentDate, "payment date"),
      hasDates: Boolean(recordDate && paymentDate),
    };
  });
  const confirmed = selected.find((row) => isoDay(row.solvencyConfirmedAt));
  const excluded = [...new Set(selected.flatMap((row) => row.excludedClassIds ?? []))].map((id) => shareClassNoun(2, index.byId(id) ?? { className: id }));
  const declaredDate = isoDay(selected[0]?.declaredOn) || isoDay(scope.asOf);
  return {
    dividend: {
      hasDeclarations: declarations.length > 0, declarations, ...countGrammar(declarations.length),
      hasDeclaredDate: Boolean(declaredDate), declaredDate, declaredDateLong: longDate(declaredDate, "declaration date"),
      amountS: pluralize(declarations.length, "amount"), classS: pluralize(declarations.length, "class", "classes"), dividendS: pluralize(declarations.length, "dividend"),
      solvencyConfirmed: Boolean(confirmed), solvencyConfirmedLong: confirmed ? longDate(confirmed.solvencyConfirmedAt, "") : "",
      solvencyBasis: String(confirmed?.solvencyBasis ?? "").trim(),
      hasExcluded: excluded.length > 0, excludedList: joinNames(excluded),
      missingDates: declarations.some((d) => !d.hasDates),
    },
  };
}

// ---------------------------------------------------------------------------
// Event dates offered to the UI.
// ---------------------------------------------------------------------------

/** Registers the event-date helper reads (all optional). */
export interface PacketEventData {
  roleHolders?: NamedRow[];
  transfers?: TransferRow[];
  certificates?: CertificateRow[];
  addresses?: AddressRow[];
  assets?: AssetRow[];
  dividends?: DividendRow[];
}

/** Packets whose operative rows are scoped to a transaction on the event date. */
export const TRANSACTION_SCOPED_PACKETS: readonly string[] = [
  "appoint-director", "appoint-director-by-directors", "director-removal", "director-resignation", "appoint-officer",
  "issue-shares", "share-transfer", "share-certificate", "share-split", "share-redemption",
  "change-of-offices", "asset-transfer", "dividend-declaration",
];

/**
 * The dates on which a transaction of the packet's kind exists in the
 * registers, newest first. An empty list means the packet is not
 * transaction-scoped or no such transaction is recorded.
 */
export function packetEventDates(kind: string, data: PacketEventData): string[] {
  const people = data.roleHolders ?? [];
  const transfers = (data.transfers ?? []).filter(ACTIVE_TRANSFER);
  const of = (type: string) => transfers.filter((t) => t.transferType === type).map((t) => t.transferDate);
  let dates: unknown[] = [];
  switch (kind) {
    case "appoint-director": case "appoint-director-by-directors":
      dates = people.filter((r) => r.roleType === "director").map((r) => r.startDate); break;
    case "director-removal": case "director-resignation":
      dates = people.filter((r) => r.roleType === "director").map((r) => r.endDate); break;
    case "appoint-officer":
      dates = people.filter((r) => r.roleType === "officer").map((r) => r.startDate); break;
    case "issue-shares": dates = of("issuance"); break;
    case "share-transfer": dates = of("transfer"); break;
    case "share-redemption": dates = of("redemption"); break;
    case "share-split": dates = [...of("subdivision"), ...of("consolidation")]; break;
    case "share-certificate": dates = (data.certificates ?? []).filter((c) => c.replacesCertificateNumber).map((c) => c.issuedOn); break;
    case "change-of-offices": dates = (data.addresses ?? []).filter((a) => a.type === "registered_office" || a.type === "records_office").map((a) => a.effectiveFrom); break;
    case "asset-transfer": dates = (data.assets ?? []).flatMap((a) => [a.purchaseDate, a.disposedAt]); break;
    case "dividend-declaration": dates = (data.dividends ?? []).map((d) => d.declaredOn); break;
    default: dates = [];
  }
  return [...new Set(dates.map(isoDay).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().reverse();
}

/** Event dates for every transaction-scoped packet. */
export function packetEventDatesByKind(data: PacketEventData): Record<string, string[]> {
  return Object.fromEntries(TRANSACTION_SCOPED_PACKETS.map((key) => [key, packetEventDates(key, data)]));
}
