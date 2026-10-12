import { instrumentPacketBlocks, type InstrumentBlockSpec, type InstrumentSpec } from "./packetInstrument";
import { packetBodyItemText, type PacketBodyItem } from "./packetBlocks";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isFederalCbca, type LegalEntityLike } from "./organizationDomain";

export type CorporationDocumentPacket = {
  key: string;
  preparationOnly?: boolean;
  sourceUrls?: string[];
  /** Legal-source IDs (shared/legalSources.ts) the packet's wording relies on. */
  sourceIds?: string[];
  templateName: string;
  packageName: string;
  summary: string;
  documentTag: string;
  partType: "document" | "filing" | "registration";
  filingType?: string;
  signatureRequired: boolean;
  requiredSigners: string[];
  requiredDataFields: string[];
  optionalDataFields: string[];
  reviewDataFields: string[];
  jurisdictions: string[];
  timeline: string;
  deliverable: string;
  terms: string;
  requiresAmendmentRecord?: boolean;
  requiresAnnualMaintenanceRecord?: boolean;
  templateFilingNames?: string[];
  templateRegistrationNames?: string[];
  /** Body items: prose strings or structured blocks (shared/packetBlocks.ts). */
  sections: Array<{ heading: string; body: PacketBodyItem[] }>;
  /**
   * The signable instrument (shared/packetInstrument.ts): title, recitals,
   * "BE IT RESOLVED THAT:", numbered clauses with tables. Rendered against the
   * packet context into typed blocks at generation time; `sections` then holds
   * the catalog view of the same wording.
   */
  instrument?: InstrumentSpec;
  /**
   * True when the packet's operative rows are the transaction effective on the
   * event date (or the selected transaction ids), never the whole register.
   */
  transactionScoped?: boolean;
};

const COMMON_ENTITY_TYPES = ["corporation__business_"];
const COMMON_JURISDICTIONS = ["federal__canada_", "CA-FED-CBCA", "CA-BC", "british_columbia", "CA-ON-OBCA"];
const COMMON_REVIEW_FIELDS = ["CorporationName", "Jurisdiction", "Articles", "Bylaws", "MinuteBook", "Directors", "Officers", "Shareholders", "ISCRegister"];

// --- Instrument building blocks (YCN Doc - * sheets) -------------------------
const DIRECTORS_TITLE: InstrumentBlockSpec = { kind: "title", text: "CONSENT DIRECTOR{dir.possessive} RESOLUTION" };
const VOTING_TITLE: InstrumentBlockSpec = { kind: "title", text: "CONSENT SHAREHOLDER{votingShareholders.possessive} RESOLUTION" };
const RESOLVED: InstrumentBlockSpec = { kind: "resolved", text: "BE IT RESOLVED THAT:" };
const SEAL = "{#if org.hasSeal}, affix the seal of {org.shortName} thereto{/if}";
const NO_VOTING_SHAREHOLDERS: InstrumentBlockSpec = { kind: "note", when: "votingShareholders.isEmpty", text: "[No voting shareholders are recorded on {date.long}. Complete the securities register before this resolution is signed.]" };
const NO_DIRECTORS: InstrumentBlockSpec = { kind: "note", when: "dir.isEmpty", text: "[No directors are recorded in office on {date.long}. Complete the directors register before this resolution is signed.]" };
const noTransaction = (when: string, what: string): InstrumentBlockSpec => ({ kind: "note", unless: when, text: `[No ${what} is recorded on {date.long}. Record it in the register, or prepare this document for the date on which it took effect.]` });

/** Sections (catalog view) derived from an instrument, so the wording has one source. */
function instrumentSections(heading: string, instrument: InstrumentSpec, extra: Array<{ heading: string; body: PacketBodyItem[] }> = []) {
  return [{ heading, body: instrumentPacketBlocks(instrument) as PacketBodyItem[] }, ...extra];
}


// --- Directors: election, appointment, resignation, removal ------------------

/** Voting shareholders elect directors (YCN Doc - Appt Directors, signed by VS). */
const APPOINT_DIRECTOR: InstrumentSpec = {
  blocks: [
    VOTING_TITLE,
    { kind: "subtitle", text: "Election of Director{appointment.nounS}" },
    RESOLVED,
    { kind: "clause", when: "appointment.hasDirectors", text: "The following {appointment.personS} be elected as {appointment.asDirector} of {org.shortName}, to hold office until ceasing to hold office under the {org.legislation} or the articles of {org.shortName}:", list: { items: "appointment.directors", item: "{.name}" } },
    { kind: "clause", unless: "appointment.hasDirectors", text: "[Name of person] be elected as a director of {org.shortName}." },
    noTransaction("appointment.hasDirectors", "director appointment"),
    { kind: "note", text: "[Each person elected must consent to act as a director ({law.directorConsentCitation} of the {org.legislation}); keep each written consent with this resolution. Then file {law.directorChangeFiling}.]" },
    NO_VOTING_SHAREHOLDERS,
  ],
};

/** Directors fill a casual vacancy or appoint additional directors only within the statutory and articles' limits. */
const APPOINT_DIRECTOR_BY_DIRECTORS: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Appointment of Director{appointment.nounS} by the Directors" },
    RESOLVED,
    { kind: "clause", when: "appointment.hasDirectors", text: "The following {appointment.personS} be appointed as {appointment.asDirector} of {org.shortName}{#if appointment.isAdditional} as additional director{appointment.nounS}, within the number the articles and the {org.legislation} permit{#else} to fill a casual vacancy among the directors{/if}:", list: { items: "appointment.directors", item: "{.name}" } },
    { kind: "clause", unless: "appointment.hasDirectors", text: "[Name of person] be appointed as a director of {org.shortName} to fill a casual vacancy among the directors." },
    noTransaction("appointment.hasDirectors", "director appointment"),
    { kind: "note", text: "{law.directorsAppointBasis}" },
    { kind: "note", text: "[Each person appointed must consent to act as a director ({law.directorConsentCitation} of the {org.legislation}); keep each written consent with this resolution. Then file {law.directorChangeFiling}.]" },
    NO_DIRECTORS,
  ],
};

/** A director's written resignation, recorded by the remaining directors. */
const DIRECTOR_RESIGNATION: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Resignation of Director{removal.nounS}" },
    { kind: "recital", when: "removal.hasRemovals", text: "WHEREAS {removal.names} {removal.hasHave} delivered {removal.aWrittenResignation} as {removal.asDirector} of {org.definedTermIntro};" },
    RESOLVED,
    { kind: "clause", when: "removal.hasRemovals", text: "The {removal.resignationS} of the following {removal.personS} as {removal.asDirector} of {org.shortName} {removal.isAre} recorded as effective on the later of delivery of the written resignation and the time stated in it ({law.resignationAuthority}):", table: { rows: "removal.removals", columns: [{ header: "Director", cell: "{.name}" }, { header: "Effective date", cell: "{.endDateLong}" }] } },
    { kind: "clause", unless: "removal.hasRemovals", text: "The resignation of [name of director] as a director of {org.shortName} is recorded as effective on [date]." },
    { kind: "clause", text: "The register of directors of {org.shortName} be updated, and {org.shortName} file {law.directorChangeFiling}." },
    noTransaction("removal.hasRemovals", "director resignation"),
    { kind: "note", text: "[A resignation takes effect without acceptance; this resolution records it. Confirm that {org.shortName} still has the minimum number of directors and a quorum, and fill any vacancy under the articles. A removal by the shareholders uses the separate director removal packet.]" },
    NO_DIRECTORS,
  ],
  annex: [
    { kind: "repeat", items: "removal.removals", blocks: [
      { kind: "heading", text: "Resignation" },
      { kind: "paragraph", text: "To: {org.name} and its directors" },
      { kind: "paragraph", text: "I, {item.name}, resign as a director of {org.name}, effective {item.endDateLong}." },
      { kind: "paragraph", text: "Dated: ____________________" },
      { kind: "signatures", signers: "item.letterSigners" },
    ] },
  ],
};

/** Removal by the shareholders (BC BCA s. 128(3); CBCA s. 109; OBCA s. 122). */
const DIRECTOR_REMOVAL: InstrumentSpec = {
  blocks: [
    VOTING_TITLE,
    { kind: "subtitle", text: "{#if law.isBc}Special Resolution — {/if}Removal of Director{removal.nounS}" },
    { kind: "resolved", text: "{law.removalResolvedLine}" },
    { kind: "clause", when: "removal.hasRemovals", text: "The following {removal.personS} be removed as {removal.asDirector} of {org.shortName} before the expiration of {#if removal.isSole}the director's{#else}their{/if} term of office, effective {date.long}:", list: { items: "removal.removals", item: "{.name}" } },
    { kind: "clause", unless: "removal.hasRemovals", text: "[Name of director] be removed as a director of {org.shortName}, effective {date.long}." },
    { kind: "clause", text: "The register of directors of {org.shortName} be updated, and {org.shortName} file {law.directorChangeFiling}." },
    noTransaction("removal.hasRemovals", "director removal"),
    { kind: "note", text: "{law.removalNote}" },
    NO_VOTING_SHAREHOLDERS,
  ],
};

const APPOINT_OFFICER: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Appointment of Officer{appointment.nounS}" },
    RESOLVED,
    { kind: "clause", when: "appointment.hasOfficers", text: "The following {appointment.personS} be appointed to the office set out opposite {#if appointment.isSole}that person's name{#else}each name{/if}, to hold office at the pleasure of the directors:", table: { rows: "appointment.officers", columns: [{ header: "Name", cell: "{.name}" }, { header: "Office", cell: "{.title}" }] } },
    { kind: "clause", unless: "appointment.hasOfficers", text: "[Name of person] be appointed as [office] of {org.shortName}, to hold office at the pleasure of the directors." },
    { kind: "clause", text: "The register of directors and officers and the signing-authority schedule of {org.shortName} be updated accordingly." },
    noTransaction("appointment.hasOfficers", "officer appointment"),
    NO_DIRECTORS,
  ],
};

// --- Shares ------------------------------------------------------------------

const ISSUE_SHARES: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Share Allotment and Issue" },
    { kind: "recital", text: "WHEREAS {issue.subscriptionRecital} been received for the issuance of shares in the capital of {org.definedTermIntro};" },
    { kind: "recital", text: "AND WHEREAS {org.shortName} has received the full consideration for the shares, in money, or in property or past services that the directors determine to have a value not less than the issue price, so that the shares are issued as fully paid;" },
    RESOLVED,
    { kind: "clause", when: "issue.hasSubscriptions", text: "The allotment and issue of shares in the capital of {org.shortName} to the following {issue.subscriberS}, for the consideration set out opposite each name, is approved, and the shares are issued as fully paid:", table: { rows: "issue.subscriptions", columns: [{ header: "Subscriber", cell: "{.subscriber}" }, { header: "Number", cell: "{.number}" }, { header: "Share Class", cell: "{.classNoun}" }, { header: "Consideration", cell: "{.consideration}" }] } },
    { kind: "clause", unless: "issue.hasSubscriptions", text: "The allotment and issue of [number] [class of shares] to [subscriber] for [consideration] is approved, and the shares are issued as fully paid." },
    { kind: "clause", when: "issue.hasSubscriptions", text: "{org.ShortName} issue the following share {issue.certificateS} representing the shares allotted and issued:", table: { rows: "issue.subscriptions", columns: [{ header: "Certificate No.", cell: "{.certificateNumber}" }, { header: "Subscriber", cell: "{.subscriber}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }] } },
    { kind: "clause", text: "{signing.OfficerPhrase} of {org.shortName} be authorized to sign the share {issue.certificateS} on behalf of {org.shortName}" + SEAL + " and to deliver {issue.itThem} to the {issue.personS} entitled to {issue.itThem}." },
    { kind: "clause", text: "The {law.securitiesRegister} of {org.shortName} be updated to record the issue." },
    noTransaction("issue.hasSubscriptions", "share issuance"),
    { kind: "note", text: "[Before signing, confirm that each class is authorized and any maximum number is not exceeded, that pre-emptive rights and any shareholder agreement are satisfied, that a securities-law prospectus exemption applies, and that each certificate number is unique.]" },
    NO_DIRECTORS,
  ],
};

const SHARE_TRANSFER: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Transfer of Shares" },
    { kind: "recital", text: "WHEREAS {transfer.applicationRecital} been received to transfer shares in the capital of {org.definedTermIntro}, with the surrendered share {transfer.cancelledCertificateS} and a duly signed instrument of transfer;" },
    { kind: "recital", when: "transfer.consentRequired", text: "AND WHEREAS the articles of {org.shortName} provide that no share may be transferred without the consent of the directors;" },
    RESOLVED,
    { kind: "clause", id: "approve", when: "transfer.hasTransfers", text: "The directors {#if transfer.consentRequired}consent to and {/if}approve the transfer of shares in the capital of {org.shortName} to the following {transfer.personS}:", table: { rows: "transfer.transfers", columns: [{ header: "Transferor", cell: "{.from}" }, { header: "Transferee", cell: "{.to}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }] } },
    { kind: "clause", unless: "transfer.hasTransfers", text: "The directors approve the transfer of [number and class of shares] from [transferor] to [transferee]." },
    { kind: "clause", when: "transfer.hasTransfers", text: "{org.ShortName} issue the following share {transfer.certificateS} representing the {transfer.shareS} transferred to the {transfer.transfereeS}{#if transfer.hasBalance} and the shares of the {transfer.transferorS} remaining untransferred{/if}:", table: { rows: "transfer.newCertificates", columns: [{ header: "Certificate No.", cell: "{.number}" }, { header: "{transfer.holderHeading}", cell: "{.holder}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }] } },
    { kind: "clause", text: "{signing.OfficerPhrase} of {org.shortName} be authorized to sign the share {transfer.certificateS} on behalf of {org.shortName}" + SEAL + " and to deliver {transfer.newItThem} to the persons entitled to {transfer.newItThem}." },
    { kind: "clause", id: "cancel", when: "transfer.hasCancelled", text: "The following share {transfer.cancelledCertificateS} surrendered by the {transfer.transferorS} be cancelled:", table: { rows: "transfer.cancelled", columns: [{ header: "Certificate No.", cell: "{.number}" }, { header: "Transferor", cell: "{.holder}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }] } },
    { kind: "clause", text: "The {law.securitiesRegister} of {org.shortName} be updated to record the transfer effective {date.long}." },
    noTransaction("transfer.hasTransfers", "share transfer"),
    { kind: "note", when: "transfer.balanceUnverified", text: "[No surrendered certificate is recorded for this date, so the certificate to cancel and any balance certificate are taken from the register holdings before the transfer. Confirm them against the surrendered certificate.]" },
    { kind: "note", text: "[Before signing, confirm the transfer restrictions in the articles and any shareholder agreement, that the transferor holds the shares, and that the instrument of transfer and the surrendered certificate are on file.]" },
    NO_DIRECTORS,
  ],
};

/** Replacement certificates for shares already issued (YCN Doc - Share Certificate). */
const SHARE_CERTIFICATE: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Issuance of Share Certificates" },
    { kind: "recital", text: "WHEREAS {certificate.applicationRecital} been received to issue {certificate.aCertificate} in respect of previously issued shares in the capital of {org.definedTermIntro};" },
    RESOLVED,
    { kind: "clause", id: "issue", when: "certificate.hasCertificates", text: "{org.ShortName} issue the following share {certificate.certificateS} representing the shares previously issued to the {certificate.shareholderS}{#if certificate.hasCancelled}, as evidenced by the share certificates cancelled by resolution {clause.cancel}{/if}:", table: { rows: "certificate.certificates", columns: [{ header: "Certificate No.", cell: "{.number}" }, { header: "Shareholder", cell: "{.holder}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }] } },
    { kind: "clause", unless: "certificate.hasCertificates", text: "{org.ShortName} issue share certificate No. [number] to [shareholder] for [number and class of shares] previously issued." },
    { kind: "clause", id: "cancel", when: "certificate.hasCancelled", text: "{org.ShortName} cancel the following share {certificate.cancelledCertificateS}, which {#if certificate.isSole}is{#else}are{/if} replaced by the share {certificate.certificateS} issued by resolution {clause.issue}:", table: { rows: "certificate.cancelled", columns: [{ header: "Certificate No.", cell: "{.number}" }, { header: "Shareholder", cell: "{.holder}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }] } },
    { kind: "clause", text: "{signing.OfficerPhrase} of {org.shortName} be authorized to sign the share {certificate.certificateS} on behalf of {org.shortName}" + SEAL + " and to deliver {certificate.itThem} to the {certificate.personS} entitled to {certificate.itThem}." },
    noTransaction("certificate.hasCertificates", "replacement certificate"),
    { kind: "note", text: "[For a lost, stolen or destroyed certificate, obtain the holder's statutory declaration and an indemnity, and any bond the directors require, before the replacement is issued.]" },
    NO_DIRECTORS,
  ],
};

/** Directors implement a subdivision or consolidation the shareholders approved by special resolution. */
const SHARE_SPLIT: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Share {split.title}" },
    { kind: "recital", text: "WHEREAS {#if shareholders.isSole}the sole shareholder of {org.definedTermIntro} has{#else}the shareholders of {org.definedTermIntro} have{/if} by special resolution resolved to {#if split.isSubdivision}subdivide{/if}{#if split.isBoth} and {/if}{#if split.isConsolidation}consolidate{/if} the issued {split.classPlural}{#if split.ratioLabel} on the basis of a {split.ratioLabel}{/if}, with the resulting change in the number of shares allotted and issued to each shareholder set out in the following {split.resolutionS};" },
    RESOLVED,
    { kind: "clause", when: "split.isSubdivision", text: "Share Subdivision — {org.ShortName} allot and issue the following additional {split.classPlural}, based on the ratio set out in the special resolution and the shares held by each shareholder at its effective date:", table: { rows: "split.increases", columns: [{ header: "Shareholder", cell: "{.holderName}" }, { header: "Increase in Number of Allotted and Issued Shares", cell: "{.label}" }] } },
    { kind: "clause", when: "split.isConsolidation", text: "Share Consolidation — {org.ShortName} cancel the following {split.classPlural}, based on the ratio set out in the special resolution and the shares held by each shareholder at its effective date:", table: { rows: "split.decreases", columns: [{ header: "Shareholder", cell: "{.holderName}" }, { header: "Reduction in Number of Allotted and Issued Shares", cell: "{.label}" }] } },
    { kind: "clause", text: "{signing.OfficerPhrase} of {org.shortName} be authorized to cancel and issue the share certificates needed to evidence the foregoing {split.resolutionS} on behalf of {org.shortName}" + SEAL + ", and to deliver them to the persons entitled to them." },
    { kind: "clause", text: "The {law.securitiesRegister} of {org.shortName} be adjusted to reflect the resulting holdings effective {date.long}." },
    { kind: "note", when: "split.hasDroppedShares", text: "[{split.sharesDropped} fractional share entitlements are dropped by per-holder rounding; confirm how the articles and the special resolution treat fractions.]" },
    { kind: "note", text: "[Confirm the articles permit the alteration and that the special resolution, and any separate class vote, was passed before the directors act.]" },
    { kind: "note", text: "{law.alterationFilingTask}" },
    NO_DIRECTORS,
  ],
};

/** Redemption at the company's option (BC BCA ss. 77(a), 79; CBCA s. 36; OBCA s. 32). */
const SHARE_REDEMPTION: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Redemption of Shares" },
    { kind: "recital", text: "WHEREAS the articles of {org.definedTermIntro} provide that the {redemption.classList} may be redeemed by {org.shortName} at a redemption price of {redemption.priceSummary} per share{#if redemption.includesDeclaredUnpaid}, together with all dividends declared on them and unpaid{/if} ({law.redemptionAuthority} of the {org.legislation});" },
    { kind: "recital", text: "AND WHEREAS the directors have determined that {law.redemptionSolvencyRecital};" },
    RESOLVED,
    { kind: "clause", when: "redemption.hasRedemptions", text: "{org.ShortName} redeem the following shares on {redemption.redemptionDateLong}, at the redemption price set out opposite each holding:", table: { rows: "redemption.rows", columns: [{ header: "Holder", cell: "{.holder}" }, { header: "Number and Class of Shares", cell: "{.sharesLabel}" }, { header: "Redemption Price per Share", cell: "{.price}{#if .includesDeclaredUnpaid} plus declared and unpaid dividends{/if}" }, { header: "Total", cell: "{.total}" }] } },
    { kind: "clause", unless: "redemption.hasRedemptions", text: "{org.ShortName} redeem [number and class of shares] held by [holder] on [redemption date] at [redemption price] per share." },
    { kind: "clause", unless: "redemption.noticeWaived", text: "{org.ShortName} give each registered holder of shares to be redeemed written notice of redemption at least {redemption.minNoticeDays} days before the redemption date, stating the following:", table: { rows: "redemption.noticeRows", columns: [{ header: "Redemption Date", cell: "{.date}" }, { header: "Place of Redemption", cell: "{.place}" }, { header: "Redemption Price per Share", cell: "{.price}" }, { header: "Notice", cell: "{.notice}" }] } },
    { kind: "clause", when: "redemption.noticeWaived", text: "Each holder of shares to be redeemed having waived notice of redemption in writing, the redemption take effect on {redemption.redemptionDateLong} at {redemption.place}." },
    { kind: "clause", text: "On surrender of the share certificates (if any) at {redemption.place}, {org.shortName} pay the redemption price to each holder, and the redeemed shares be cancelled." },
    { kind: "clause", text: "The {law.securitiesRegister} of {org.shortName} be updated to record the redemption and the cancellation of the surrendered certificates." },
    noTransaction("redemption.hasRedemptions", "share redemption"),
    { kind: "note", when: "redemption.nonProRataFlag", text: "[This redemption does not cover every share of the class pro rata. Confirm the articles permit redeeming from fewer than all holders, or in other than equal proportions.]" },
    { kind: "note", when: "redemption.notByCompany", text: "[The recorded redemption terms do not give {org.shortName} a right to redeem this class; confirm the articles before proceeding.]" },
    { kind: "note", text: "[Re-confirm the solvency test when payment is made, and keep the notice of redemption, or each holder's written waiver, with this resolution.]" },
    NO_DIRECTORS,
  ],
};

const DIVIDEND_DECLARATION: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Declaration of {#if dividend.isMultiple}Dividends{#else}Dividend{/if}" },
    { kind: "recital", text: "WHEREAS the directors have determined that {law.dividendSolvencyRecital}{#if dividend.solvencyConfirmed}, as confirmed on {dividend.solvencyConfirmedLong}{#if dividend.solvencyBasis} on the basis of {dividend.solvencyBasis}{/if}{/if};" },
    RESOLVED,
    { kind: "clause", when: "dividend.isSole", text: "{org.ShortName} declare a dividend of {dividend.declarations.0.perShare} per share on the issued and outstanding {dividend.declarations.0.classPlural}, for a total of {dividend.declarations.0.total}, payable on {dividend.declarations.0.paymentDateLong} to holders of record of {dividend.declarations.0.classPlural} on {dividend.declarations.0.recordDateLong}." },
    { kind: "clause", when: "dividend.isMultiple", text: "{org.ShortName} declare the following dividends on its issued and outstanding shares of the classes indicated, each payable on its payment date to the holders of record of that class on its record date:", list: { items: "dividend.declarations", item: "{.perShare} per share on the {.classPlural}, for a total of {.total}, payable on {.paymentDateLong} to holders of record of {.classPlural} on {.recordDateLong}" } },
    { kind: "clause", unless: "dividend.hasDeclarations", text: "{org.ShortName} declare a dividend of [amount] per share on the issued and outstanding [class of shares], payable on [payment date] to holders of record of [class of shares] on [record date]." },
    { kind: "clause", when: "dividend.hasExcluded", text: "No dividend is declared on the {dividend.excludedList}." },
    { kind: "clause", text: "The directors and officers of {org.shortName} be authorized to do all things necessary to pay the {dividend.dividendS} on the payment {#if dividend.isMultiple}dates{#else}date{/if}." },
    noTransaction("dividend.hasDeclarations", "dividend declaration"),
    { kind: "note", when: "dividend.missingDates", text: "[Record the record date and payment date for each class before this resolution is signed.]" },
    { kind: "note", text: "[Confirm each class's dividend rights in the articles, including any class excluded, and re-confirm the solvency test at the payment date.]" },
    NO_DIRECTORS,
  ],
};

// --- Offices, assets ---------------------------------------------------------

const CHANGE_OF_OFFICES: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "Registered and Records Offices" },
    RESOLVED,
    { kind: "clause", when: "offices.registeredInitial", text: "The registered office of {org.shortName} be initially at the following address: {offices.registered}." },
    { kind: "clause", when: "offices.registeredChanged", text: "The registered office of {org.shortName} be changed from: {offices.priorRegistered} to: {offices.registered}." },
    { kind: "clause", when: "offices.recordsInitial", text: "The records office of {org.shortName} be initially at the following address: {offices.records}." },
    { kind: "clause", when: "offices.recordsChanged", text: "The records office of {org.shortName} be changed from: {offices.priorRecords} to: {offices.records}." },
    { kind: "clause", unless: "offices.hasChanges", text: "The [registered/records] office of {org.shortName} be changed from: [current address] to: [new address]." },
    noTransaction("offices.hasChanges", "registered or records office change"),
    { kind: "note", when: "offices.undated", text: "[These office addresses have no effective dates. Confirm the date on which the change takes effect.]" },
    { kind: "note", text: "{law.officeChangeTask}" },
    NO_DIRECTORS,
  ],
};

const ASSET_TRANSFER: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "subtitle", text: "{#if assetTransfer.hasAcquisitions}Acquisition{/if}{#if assetTransfer.hasAcquisitions}{#if assetTransfer.hasDispositions} and {/if}{/if}{#if assetTransfer.hasDispositions}Disposition{/if}{#if assetTransfer.hasAssets}{#else}Acquisition or Disposition{/if} of Assets" },
    { kind: "recital", text: "WHEREAS the directors have determined that it is in the best interests of {org.definedTermIntro} to {assetTransfer.verbPhrase} the assets set out in these resolutions;" },
    RESOLVED,
    { kind: "clause", when: "assetTransfer.singleAcquisition", text: "{org.ShortName} acquire the {assetTransfer.singleAcquisition.kindPhrase} identified as {assetTransfer.singleAcquisition.name}{#if assetTransfer.singleAcquisition.identifier} ({assetTransfer.singleAcquisition.identifierText}){/if} from {assetTransfer.singleAcquisition.counterparty} for the purchase price of {assetTransfer.singleAcquisition.value}." },
    { kind: "clause", when: "assetTransfer.singleDisposition", text: "{org.ShortName} dispose of the {assetTransfer.singleDisposition.kindPhrase} identified as {assetTransfer.singleDisposition.name}{#if assetTransfer.singleDisposition.identifier} ({assetTransfer.singleDisposition.identifierText}){/if} to {assetTransfer.singleDisposition.counterparty} for the sale price of {assetTransfer.singleDisposition.value}." },
    { kind: "clause", when: "assetTransfer.tableAcquisitions", text: "{org.ShortName} acquire the following assets:", table: { rows: "assetTransfer.acquisitions", columns: [{ header: "Asset", cell: "{.name}" }, { header: "Category", cell: "{.category}" }, { header: "Identifier", cell: "{.identifierText}" }, { header: "Seller", cell: "{.counterparty}" }, { header: "Purchase Price", cell: "{.value}" }] } },
    { kind: "clause", when: "assetTransfer.tableDispositions", text: "{org.ShortName} dispose of the following assets:", table: { rows: "assetTransfer.dispositions", columns: [{ header: "Asset", cell: "{.name}" }, { header: "Category", cell: "{.category}" }, { header: "Identifier", cell: "{.identifierText}" }, { header: "Purchaser", cell: "{.counterparty}" }, { header: "Sale Price", cell: "{.value}" }] } },
    { kind: "clause", unless: "assetTransfer.hasAssets", text: "{org.ShortName} [acquire/dispose of] the [asset] identified as [description and identifier] [from/to] [counterparty] for [price]." },
    { kind: "clause", text: "Deliver Documents — {signing.OfficerPhrase} of {org.shortName} be authorized to sign and deliver, on behalf of {org.shortName}, all agreements, transfers and other documents required to complete and register the {assetTransfer.nounPhrase} of the {assetTransfer.propertyS}." },
    { kind: "clause", text: "Further Actions — {signing.OfficerPhrase} of {org.shortName} be authorized to make such incidental expenditures and take such further actions as are necessary or desirable to complete the {assetTransfer.nounPhrase}." },
    noTransaction("assetTransfer.hasAssets", "asset acquisition or disposition"),
    { kind: "note", text: "[Confirm the directors' authority limits, any shareholder approval needed for a sale, lease or other disposition of all or substantially all of the undertaking, and any lender or shareholder-agreement consents.]" },
    NO_DIRECTORS,
  ],
};

// --- Annual package ------------------------------------------------------------

/** Shareholders' annual consent resolutions (preparation draft; YCN Doc - Annual part 1). */
const ANNUAL_SHAREHOLDERS: InstrumentSpec = {
  blocks: [
    { kind: "title", text: "{annual.year} SHAREHOLDER{shareholders.possessive} ANNUAL CONSENT RESOLUTIONS" },
    { kind: "subtitle", text: "Preparation draft — {annual.profileName}" },
    RESOLVED,
    { kind: "clause", text: "{annual.financialClause}" },
    { kind: "clause", text: "{annual.fiscalCalendarClause}" },
    { kind: "clause", text: "{annual.auditorClause}" },
    { kind: "clause", when: "annual.hasRatification", text: "{annual.ratificationClause}" },
    { kind: "clause", text: "{annual.directorClause}", list: { items: "annual.directorSlateList", item: "{.name}" } },
    { kind: "clause", when: "annual.hasDeemedMeeting", text: "{annual.deemedMeetingClause}" },
    { kind: "paragraph", text: "{annual.annualBusinessClause}" },
    { kind: "note", text: "{annual.filingClause}" },
  ],
};

/** Directors' companion annual resolution (YCN Doc - Annual part 2). */
const ANNUAL_DIRECTORS: InstrumentSpec = {
  blocks: [
    { kind: "title", text: "{annualDirectors.year} DIRECTOR{dir.possessive} ANNUAL CONSENT RESOLUTION" },
    RESOLVED,
    { kind: "clause", when: "annualDirectors.hasFinancialPeriod", text: "The financial statements of {org.shortName} for the financial year ended {annualDirectors.financialPeriodLong} be approved, and any director be authorized to sign them on behalf of the directors." },
    { kind: "clause", when: "appointment.hasOfficers", text: "The following {appointment.personS} be appointed as {#if appointment.isSole}the sole officer{#else}officers{/if} of {org.shortName}, to hold the office set out opposite {#if appointment.isSole}that person's name{#else}each name{/if} at the pleasure of the directors:", table: { rows: "appointment.officers", columns: [{ header: "Name", cell: "{.name}" }, { header: "Office", cell: "{.title}" }] } },
    { kind: "clause", unless: "appointment.hasOfficers", text: "[Name of person] be appointed as [office] of {org.shortName}, to hold office at the pleasure of the directors." },
    { kind: "clause", when: "annualDirectors.hasRegistered", text: "The registered office of {org.shortName} is confirmed at {annualDirectors.registered}." },
    { kind: "clause", when: "annualDirectors.hasRecords", text: "The records office of {org.shortName} is confirmed at {annualDirectors.records}, where the records required by the {org.legislation} are kept." },
    { kind: "note", text: "[Sign this resolution after the shareholders' annual resolutions, so the directors named there are the directors who sign. The financial statements must be approved by the directors before they are presented to the shareholders.]" },
    NO_DIRECTORS,
  ],
};

// --- Blank shells ----------------------------------------------------------------

const ALL_DIRECTORS_SHELL: InstrumentSpec = {
  blocks: [
    DIRECTORS_TITLE,
    { kind: "paragraph", text: "The undersigned, being {dir.allTheSole} director{dir.nounS} of {org.shortName}, hereby sign{dir.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}." },
    RESOLVED,
    { kind: "clause", text: "[Insert the resolution.]" },
    NO_DIRECTORS,
  ],
};

const ALL_SHAREHOLDERS_SHELL: InstrumentSpec = {
  blocks: [
    { kind: "title", text: "CONSENT SHAREHOLDER{shareholders.possessive} RESOLUTION" },
    { kind: "paragraph", text: "The undersigned, being {shareholders.allTheSole} shareholder{shareholders.nounS} of {org.shortName}, hereby sign{shareholders.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}." },
    RESOLVED,
    { kind: "clause", text: "[Insert the resolution.]" },
    { kind: "note", when: "shareholders.isEmpty", text: "[No shareholders are recorded on {date.long}. Complete the securities register before this resolution is signed.]" },
  ],
};

const ALL_VOTING_SHAREHOLDERS_SHELL: InstrumentSpec = {
  blocks: [
    VOTING_TITLE,
    { kind: "paragraph", text: "The undersigned, being {votingShareholders.allTheSole} voting shareholder{votingShareholders.nounS} of {org.shortName}, hereby sign{votingShareholders.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}." },
    RESOLVED,
    { kind: "clause", text: "[Insert the resolution.]" },
    NO_VOTING_SHAREHOLDERS,
  ],
};

export const CORPORATION_DOCUMENT_PACKETS: CorporationDocumentPacket[] = [
  {
    key: "bc-incorporation-agreement", templateName: "BC incorporation agreement — preparation draft",
    packageName: "BC incorporation agreement preparation", preparationOnly: true,
    summary: "An original working draft for the incorporators' agreement; review every subscription and execution detail before signing.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "Incorporators", "ShareClasses", "ShareSubscriptions", "ArticlesAdopted"],
    optionalDataFields: ["AgreementDate", "NumberedCompany", "Table1Version", "CustomArticlesParts"], reviewDataFields: ["ShareRights", "IncorporatorEligibility", "ExecutionAuthority", "Articles", "NameApproval"],
    jurisdictions: ["CA-BC", "british_columbia"],
    sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00", "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/65_2004", "https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/permits-licences/businesses-incorporated-companies/incorporated-companies"],
    timeline: "Complete and sign a reviewed incorporation agreement before submitting the application.",
    deliverable: "Editable original agreement draft with review prompts; no execution or registry acceptance is asserted.",
    terms: "Ordinary private BC company only. Tailored legal review is required. Each incorporator must agree to take at least one share; a company, society or other authorized entity may be an incorporator. Verify signing authority. This draft does not reproduce a government form. A federal CBCA corporation is an alternative route with its own statute, articles and registry; prepare it with the federal CBCA articles preparation draft instead.",
    sections: [
      { heading: "Draft incorporation agreement", body: ["Proposed company: {org.name}.", "The incorporators listed below agree to form the company under the Business Corporations Act and agree to take the shares recorded opposite their names, subject to completion and review of this draft.", "[Insert each incorporator's full legal name, address, individual or entity status, and authority of any entity signatory.]", "[For each incorporator, state at least one subscribed share: class and series, number of shares, consideration and payment arrangements. Reconcile this schedule with the reviewed articles.]", "{#if articles.hasRecord}The company has as its articles {articles.adoptionSentence}.{#else}[State the articles adopted, for example: \"The company has as its articles the Table 1 Articles prescribed under the Business Corporations Regulation ([state the Table 1 version]), supplemented by Parts [n] to [n] setting out the special rights and restrictions attached to the [classes of shares].\" Otherwise attach the custom articles signed by the incorporators. Table 1 is never assumed; if the incorporators sign no articles, Table 1 applies by operation of the Act (s. 16).]{/if}", "{#if articles.hasClassParts}{#if articles.hasRecord}{#else}Parts to attach for the share classes now recorded: {articles.partsSentence}.{/if}{/if}", "[Insert the agreed incorporation application particulars and the execution date. Obtain each incorporator's signature only after all review prompts are resolved.]" ] },
      { heading: "Review and evidence", body: ["{#if articles.hasWarnings}Drafting checks for review:{#each articles.warnings}\n- {this}{/each}{#else}Confirm that the articles adopted, the custom Parts and the share subscriptions agree with each other.{/if}", "Retain the executed agreement with the articles at the records office. Preserve the incorporation application, certified notice of articles and certificate separately.", "Official statutory source: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00 (ss. 10–12, 16). Table 1: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/65_2004 (s. 42 and Table 1)." ] },
    ],
  },
  {
    key: "bc-articles-preparation", templateName: "BC articles — preparation draft", packageName: "BC ordinary private company articles preparation",
    preparationOnly: true, summary: "Original articles drafting worksheet for an ordinary private BC company, including a share-rights schedule, a Part skeleton for each share class and governance choices.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "ShareClasses", "RegisteredOffice", "RecordsOffice", "Directors", "ArticlesBase"],
    optionalDataFields: ["TransferRestrictions", "BusinessRestrictions", "AnnualReferenceDate", "Table1Version", "CustomArticlesParts"], reviewDataFields: ["Articles", "ShareRights", "SecuritiesExemptions", "Quorum", "DirectorAuthority", "SpecialCompanySubtype", "Indemnity"],
    jurisdictions: ["CA-BC", "british_columbia"], sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00", "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/65_2004"],
    timeline: "Review articles before incorporation and retain the executed version in the records office.",
    deliverable: "Editable articles worksheet with a generated Part skeleton per share class and drafting checks; unresolved drafting choices must be completed before execution or filing.",
    terms: "Requires tailored legal review, clause by clause. ULC, community contribution and benefit company provisions are outside this ordinary private route. The articles, notice of articles and incorporation agreement must agree. This is original application-authored guidance, not the prescribed Table 1 articles; use the official Table 1 text where it is adopted. A federal CBCA corporation is an alternative route with its own statute and articles; use the federal CBCA articles preparation draft for it.",
    sections: [
      { heading: "Proposed articles of {org.name}", body: ["[Record the proposed legal or numbered name and the date/version of these articles.]", "Articles base: {#if articles.hasRecord}{articles.adoptionSentence}.{#else}[Choose either the Table 1 Articles (state the Table 1 version) supplemented by custom Parts for the share classes, or fully custom articles. Table 1 is never assumed.]{/if}", "Share structure: [state each class/series, authorized maximum or unlimited number, par value if applicable, and the complete special rights and restrictions].", "Transfer and issuance: [state approved transfer restrictions, pre-emptive rights, subscription/payment terms and the treatment of share certificates]." ] },
      { heading: "Special rights and restrictions by class", body: ["{#if articles.hasClassParts}{#each articles.classParts}{.text}\n\n{/each}{#else}[Record each share class and its structured rights (par value, dividends, redemption, liquidation rank, voting, pre-emptive rights) in the share register; this section then sets out a Part skeleton for each class.]{/if}", "Each Part must state all the special rights or restrictions of its class (Business Corporations Act s. 12(2)(b)). Redemption is subject to ss. 77 and 79; redeemed shares are cancelled or retained under s. 82." ] },
      { heading: "Drafting checks", body: ["{#if articles.hasWarnings}{#each articles.warnings}- {this}\n{/each}{#else}No drafting checks were raised from the recorded share classes. Review every clause regardless.{/if}" ] },
      { heading: "Governance clauses for review", body: ["[Draft shareholder and director meeting procedures, notice, quorum, voting, written resolutions, chair, proxies and adjournments consistent with the Act.]", "[Draft director number and qualification provisions, election/removal terms, officer appointment and delegated signing authority.]", "[Draft borrowing, dividends, records inspection, indemnity and amendment provisions within statutory limits. Indemnity is limited by Business Corporations Act ss. 159–165: no indemnity or expense payment where the party did not act honestly and in good faith in the company's best interests, or in proceedings brought by or for the company, except by court order.]", "[Record the BC registered and records offices in the notice of articles; confirm director consent and reconcile the notice with these articles.]" ] },
      { heading: "Completion and official originals", body: ["Remove unresolved prompts only after a clause-by-clause legal review. Retain execution evidence independently from registry evidence.", "Official Act and prescribed provisions: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00 and https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/65_2004. Use official originals for prescribed model wording." ] },
    ],
  },
  {
    key: "bc-officer-indemnity-agreement", templateName: "BC officer indemnity agreement — preparation draft",
    packageName: "BC officer indemnity agreement preparation", preparationOnly: true,
    summary: "Optional original draft of an indemnity agreement between a BC company and an officer, within the limits of the Business Corporations Act.",
    documentTag: "7___officers_register_and_consents", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "OfficerName", "OfficerTitle", "EffectiveDate"],
    optionalDataFields: ["ArticlesIndemnityProvision", "InsurancePolicy"], reviewDataFields: ["Articles", "Indemnity", "DirectorAuthority", "Conflicts"],
    jurisdictions: ["CA-BC", "british_columbia"], sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00_multi#section159"],
    timeline: "Prepare before or when the officer is appointed; approve it by directors' resolution with any interested director's disclosure.",
    deliverable: "Editable indemnity agreement draft with statutory limits stated; no execution is asserted.",
    terms: "Optional and preparation only; requires legal review. Table 1 articles make director indemnity mandatory but do not mention officers, so an officer's indemnity depends on the articles and any agreement. A director who is a party has a disclosable interest in approving it. This draft makes no tax or insurance claim.",
    sections: [
      { heading: "Indemnity agreement between {org.name} and [officer name], [title]", body: ["{#if articles.hasRecord}The company's articles record: {articles.adoptionSentence}. [Confirm what the articles say about officer indemnity; this agreement must not conflict with them.]{#else}[Confirm the company's articles do not prohibit this indemnity; an indemnity is barred where the articles prohibited it when the agreement was made (s. 163(1)(a)).]{/if}", "1. Indemnity. Subject to the Business Corporations Act, the company indemnifies the officer, and the officer's heirs and legal representatives, against all eligible penalties to which the officer is or may be liable in an eligible proceeding because the officer is or was an officer of the company (s. 160(a)).", "2. Expenses after final disposition. The company pays the expenses the officer actually and reasonably incurs in an eligible proceeding after its final disposition (s. 160(b)), and must do so where the officer is wholly successful, or substantially successful on the merits, and has not been reimbursed (s. 161).", "3. Advances. The company may pay expenses as incurred before final disposition only after receiving the officer's written undertaking to repay them if payment is later found to be prohibited by s. 163 (s. 162).", "4. Limits. The company will not indemnify or pay expenses where s. 163 prohibits it, including where the officer did not act honestly and in good faith with a view to the best interests of the company or associated corporation, or, in a proceeding other than a civil proceeding, did not have reasonable grounds to believe the conduct was lawful. In a proceeding brought by or on behalf of the company or an associated corporation, the company will not indemnify or pay expenses; only the court may order relief (ss. 163(2), 164).", "5. Insurance. [State whether the company maintains insurance for the officer under s. 165, or delete.]", "6. Term. [State the effective date, survival after the officer leaves office, notice of claims, conduct of the defence, and governing law (British Columbia).]" ] },
      { heading: "Approval and review", body: ["[Approve by directors' resolution. Record any director's disclosable interest and abstention under the conflicts provisions.]", "Statutory source: Business Corporations Act ss. 159–165, https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00_multi#section159. Legal review is required before signing." ] },
    ],
  },
  {
    key: "federal-articles-preparation", templateName: "Federal CBCA articles — preparation draft", packageName: "Federal CBCA incorporation articles preparation",
    preparationOnly: true, summary: "Original worksheet to prepare the facts and schedules for the official federal business incorporation application.",
    documentTag: "incorporation_preparation", partType: "document", signatureRequired: false, requiredSigners: [],
    requiredDataFields: ["CorporationName", "RegisteredOfficeProvince", "ShareClasses", "Directors", "Incorporators"],
    optionalDataFields: ["ShareTransferRestrictions", "BusinessRestrictions", "OtherProvisions"], reviewDataFields: ["CBCAArticles", "DirectorEligibility", "ShareRights", "NameApproval", "ISCInformation", "SecuritiesExemptions"],
    jurisdictions: ["CA-FED-CBCA", "federal__canada_"], sourceUrls: ["https://laws-lois.justice.gc.ca/eng/acts/C-44/", "https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/how-incorporate-business"],
    timeline: "Review and complete before submitting the official incorporation application.",
    deliverable: "Editable incorporation facts and schedules worksheet; official filing and certificate evidence remain separate.",
    terms: "Federal CBCA business corporation only; requires tailored legal review. Use the official application for submission. This original worksheet does not reproduce an ISED form layout or model articles.",
    sections: [
      { heading: "Articles preparation for {org.name}", body: ["Proposed corporate name: {org.name}. [Confirm a numbered or approved name and any required name-search evidence.]", "Registered office province/territory: [insert the jurisdiction to be stated in the articles]. Record the full office address separately for the official address notice.", "Share classes: [state authorized classes/series, maximum or unlimited quantities and each class's rights, privileges, restrictions and conditions].", "Transfer restrictions: [insert reviewed restrictions or expressly state none].", "Directors: [state a fixed number or the minimum and maximum number; verify eligibility, consents and applicable residency rules].", "Business restrictions and other provisions: [state reviewed restrictions, or expressly state none, and any additional lawful provisions]." ] },
      { heading: "Application facts and registry evidence", body: ["[Record every incorporator and signing authority, first directors, registered office address and required ISC information in the official application.]", "After acceptance, retain the certificate, articles and official notices. A signed worksheet is not a certificate of incorporation.", "Official incorporation workflow: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/how-incorporate-business. Statutory source: https://laws-lois.justice.gc.ca/eng/acts/C-44/." ] },
    ],
  },
  {
    key: "organize-corporation",
    templateName: "Organize corporation / initial resolutions",
    packageName: "Organize corporation minute book packet",
    summary: "Initial director and shareholder resolutions to organize a corporation after incorporation.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "IncorporationDate", "InitialDirectors", "InitialOfficers", "RegisteredOffice", "ShareClasses"],
    optionalDataFields: ["BankingAuthorities", "FiscalYearEnd", "MinuteBookLocation", "AuditorAppointment"],
    reviewDataFields: COMMON_REVIEW_FIELDS,
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare immediately after incorporation and before first operating decisions are made.",
    deliverable: "Initial director resolutions, officer appointments, banking authority, share class confirmation, and minute book index.",
    terms: "Review articles, bylaws, share structure, director consents, and local law before relying on the packet.",
    sections: [
      {
        heading: "Organization Resolutions",
        body: [
          "The directors confirm the corporation's organization records, registered office, records office, officers, fiscal year end, and banking authority.",
          "The secretary is authorized to place the signed resolutions and supporting records in the minute book.",
        ],
      },
      {
        heading: "Initial Registers",
        body: [
          "Create or confirm the directors register, officers register, securities register, transfer register, and individuals with significant control register.",
        ],
      },
    ],
  },
  {
    key: "appoint-director",
    templateName: "Appoint director",
    packageName: "Director appointment packet",
    summary: "Voting shareholders' resolution electing the directors appointed on the document date, with consent and register prompts.",
    documentTag: "6___directors_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_voting_shareholders", "directors___entering"],
    requiredDataFields: ["CorporationName", "DirectorName", "AppointmentDate", "DirectorAddress", "AgeOver18"],
    optionalDataFields: ["DirectorTerm", "Occupation", "Residency", "ConsentDocument"],
    reviewDataFields: ["Articles", "Bylaws", "DirectorRegister", "RegistryProfile", "ShareholdersRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare for the date the director is elected and file the notice of change within the statutory period.",
    deliverable: "Voting shareholders' election resolution for the directors appointed on that date, consent prompt, register update and notice-of-change prompt.",
    terms: "Shareholders elect directors under the governing Act and the articles. The directors may act only to fill a casual vacancy or appoint additional directors within the limits the Act and articles allow; use the separate directors' appointment packet for that. Confirm eligibility and consent.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - directors"],
    transactionScoped: true,
    instrument: APPOINT_DIRECTOR,
    sections: instrumentSections("Election of Directors", APPOINT_DIRECTOR),
  },
  {
    key: "appoint-director-by-directors",
    templateName: "Appoint director by the directors",
    packageName: "Directors' appointment of a director packet",
    summary: "Directors' resolution filling a casual vacancy, or appointing an additional director where the articles allow it.",
    documentTag: "6___directors_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "directors___entering"],
    requiredDataFields: ["CorporationName", "DirectorName", "AppointmentDate", "VacancyOrAdditional"],
    optionalDataFields: ["DirectorTerm", "ConsentDocument"],
    reviewDataFields: ["Articles", "DirectorRegister", "RegistryProfile"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare for the date of the appointment and file the notice of change within the statutory period.",
    deliverable: "Directors' appointment resolution with the statutory basis to confirm, a consent prompt and a notice-of-change prompt.",
    terms: "Only for a casual vacancy, or for additional directors where the articles permit and within the one-third limit. Confirm the vacancy is one the directors may fill (not a failure to elect, or an increase in the number of directors) and that the articles do not provide otherwise.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - directors"],
    transactionScoped: true,
    instrument: APPOINT_DIRECTOR_BY_DIRECTORS,
    sections: instrumentSections("Appointment by the Directors", APPOINT_DIRECTOR_BY_DIRECTORS),
  },
  {
    key: "appoint-officer",
    templateName: "Appoint officer",
    packageName: "Officer appointment packet",
    summary: "Directors' resolution appointing the officers whose appointment takes effect on the document date.",
    documentTag: "7___officers_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "officer___entering"],
    requiredDataFields: ["CorporationName", "OfficerName", "OfficerTitle", "AppointmentDate"],
    optionalDataFields: ["SigningAuthority", "BankingAuthority", "Email", "Phone"],
    reviewDataFields: ["Bylaws", "OfficerRegister", "SigningAuthorities"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare when the board appoints or changes an officer.",
    deliverable: "Officer appointment resolution, officer register update and signing-authority update prompt.",
    terms: "Confirm the appointing body and title authority under the articles, by-laws or a prior delegation.",
    transactionScoped: true,
    instrument: APPOINT_OFFICER,
    sections: instrumentSections("Officer Appointment", APPOINT_OFFICER),
  },
  {
    key: "issue-shares",
    templateName: "Issue shares",
    packageName: "Share issuance packet",
    summary: "Directors' allotment and issue resolution for the subscriptions on the document date: subscriber table, certificates and signing authority.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "shareholder___entering", "transfer_participants"],
    requiredDataFields: ["CorporationName", "ShareClass", "SubscriberName", "Quantity", "Consideration", "IssueDate"],
    optionalDataFields: ["CertificateNumber", "ExemptionLegend", "SubscriptionAgreement", "BoardApprovalDate"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "TransferRegister", "ConsiderationEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before issuing securities and post the ledger event after approval and receipt of the consideration.",
    deliverable: "Allotment and issue resolution, certificate table, a Subscription for Shares per subscriber, and register update.",
    terms: "Confirm authorized share classes, full consideration, securities-law exemptions, pre-emptive rights, and unanimous shareholder agreement restrictions.",
    transactionScoped: true,
    instrument: ISSUE_SHARES,
    sections: instrumentSections("Share Allotment and Issue", ISSUE_SHARES),
  },
  {
    key: "annual-resolutions",
    templateName: "Annual resolutions — preparation draft",
    packageName: "Annual business and return preparation",
    preparationOnly: true,
    sourceUrls: ["https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00_multi", "https://laws-lois.justice.gc.ca/eng/acts/C-44/FullText.html", "https://www.ontario.ca/laws/statute/90b16"],
    summary: "Act-specific annual business preparation, with separate financial statements, auditor decision, shareholder electorate and registry evidence.",
    documentTag: "13___annual_return_filings",
    partType: "filing",
    filingType: "annual_return",
    signatureRequired: false,
    requiredSigners: [],
    requiredDataFields: ["CorporationName", "GoverningAct", "FinancialPeriodEnd", "AnnualBusinessYear", "DirectorSlate", "FinancialStatements"],
    optionalDataFields: ["AuditorName", "WaiveAuditor", "AnnualReferenceDate", "ShareholderResolutionDate", "AnnualReturnConfirmation", "IncludeRatification"],
    reviewDataFields: ["FinancialStatements", "BoardFinancialApproval", "AuditorDecision", "AnnualReturn", "DirectorConsents", "ShareholderElectorateIncludingNonVoting", "ArticlesAndClassRights", "ExecutionEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare with the annual meeting/approval cycle and retain with the annual return confirmation.",
    deliverable: "Editable annual-business draft with Act-specific clauses and completion prompts. Prepare a separate execution copy after the period, authority, electorate and signature checks.",
    terms: "Preparation only. Financial-statement and auditor waivers are separate decisions with different statutory scopes. A generated draft, director roster or generic signer list does not establish shareholder consent, a held/deemed meeting, or a filed annual return.",
    requiresAnnualMaintenanceRecord: true,
    templateFilingNames: ["Annual return", "Annual resolutions"],
    instrument: ANNUAL_SHAREHOLDERS,
    sections: [
      {
        heading: "Annual business preparation for {org.shortName}",
        body: [
          "Reviewed legal profile: {annual.profileName}. This document is a preparation draft.",
          "1. Financial statements. {annual.financialClause}",
          "2. Fiscal calendar. {annual.fiscalCalendarClause}",
          "3. Auditor. {annual.auditorClause}",
          "4. Directors. {annual.directorClause}{#if annual.hasDirectors} Proposed slate:{#each annual.directorSlateList} {.name};{/each}{/if}",
          "5. Annual-business route. {annual.annualBusinessClause}",
          "6. Registry filing. {annual.filingClause}",
          "{#if annual.hasRatification}Optional ratification. {annual.ratificationClause}{/if}",
          "{#if annual.hasDeemedMeeting}Annual general meeting. {annual.deemedMeetingClause}{/if}",
        ],
      },
      { heading: "Completion and evidence", body: ["{#each annual.reviewNotes}{.message}\n{/each}", "Statutory authorities: {annual.sourceText}", "Retain the final reviewed document, correct shareholder execution evidence and registry receipts as distinct records. No automatic meeting, consent, appointment or filing completion is recorded by generating this draft. Prepare the companion directors' annual resolution to approve the financial statements and re-appoint the officers."] },
    ],
  },
  {
    key: "annual-directors-resolution",
    templateName: "Annual directors' resolution",
    packageName: "Directors' annual resolution packet",
    summary: "Directors' companion annual resolution: approve the financial statements, re-appoint the officers and confirm the registered and records offices.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "Officers", "AnnualBusinessYear"],
    optionalDataFields: ["FinancialPeriodEnd", "RegisteredOffice", "RecordsOffice"],
    reviewDataFields: ["FinancialStatements", "OfficerRegister", "DirectorRegister", "RegisteredOffice", "RecordsOffice"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare with the annual package; sign after the shareholders' annual resolutions.",
    deliverable: "Directors' annual consent resolution re-appointing the officers in office on the document date.",
    terms: "Kept separate from the shareholders' annual business. The financial-statement and auditor waivers remain shareholder decisions in the annual preparation packet.",
    instrument: ANNUAL_DIRECTORS,
    sections: instrumentSections("Directors' Annual Resolution", ANNUAL_DIRECTORS),
  },
  {
    key: "isc-register-update",
    templateName: "ISC register update",
    packageName: "Individuals with significant control register packet",
    summary: "Transparency register update workflow tied to shareholders, controllers, notices, and annual review.",
    documentTag: "12___shareholder_agreements",
    partType: "document",
    signatureRequired: false,
    requiredSigners: [],
    requiredDataFields: ["CorporationName", "ControlPersonName", "NatureOfControl", "EffectiveDate"],
    optionalDataFields: ["ResidentialAddress", "ServiceAddress", "DateOfBirth", "TaxResidence", "ControlThresholdEvidence"],
    reviewDataFields: ["ShareholdersRegister", "ControlLedger", "NoticesSent", "AnnualISCReview"],
    jurisdictions: ["federal__canada_", "CA-FED-CBCA"],
    timeline: "Update when control changes and during the annual transparency-register review.",
    deliverable: "ISC register entry/update checklist, notice evidence, controller link, and review notes.",
    terms: "Confirm whether the corporation is subject to ISC register requirements and whether public filing obligations apply.",
    templateFilingNames: ["Transparency register change"],
    sections: [
      {
        heading: "Control Register Update",
        body: [
          "The corporation records the individual, nature of control, effective date, and evidence source for the control determination.",
          "Notices, confirmations, and review notes are retained with the transparency register.",
        ],
      },
    ],
  },
  {
    key: "extra-provincial-registration-evidence",
    templateName: "Extra-provincial registration evidence packet",
    packageName: "Extra-provincial registration evidence packet",
    summary: "Evidence packet for registration, renewal, agent/attorney for service, identifier, and province-specific filing prompts.",
    documentTag: "extra_provincial_registrations",
    partType: "registration",
    filingType: "extra_provincial_registration",
    signatureRequired: true,
    requiredSigners: ["officer___president", "authorized_filer"],
    requiredDataFields: ["CorporationName", "HomeJurisdiction", "TargetJurisdiction", "RegistrationNumber", "AttorneyForService"],
    optionalDataFields: ["CertificateOfStatus", "BusinessNumber", "RegisteredOffice", "RenewalDate", "ProfileReport"],
    reviewDataFields: ["HomeRegistryProfile", "ForeignRegistration", "AttorneyForServiceConsent", "FilingEvidence"],
    jurisdictions: ["CA-ON-OBCA"],
    timeline: "Prepare before filing in the target jurisdiction and refresh when registration details change.",
    deliverable: "Registration evidence checklist, attorney/agent evidence, identifier capture, and ongoing filing prompt.",
    terms: "Confirm the extra-provincial trigger, exact local filing, agent/attorney requirements, and renewal or annual return obligations.",
    templateRegistrationNames: ["Ontario extra-provincial registration"],
    sections: [
      {
        heading: "Registration Evidence",
        body: [
          "The corporation records the target jurisdiction, registration status, registration number, local representative, and evidence source.",
          "The registration packet is linked to local annual return or notice-of-change obligations where applicable.",
        ],
      },
    ],
  },
  {
    key: "dividend-declaration",
    templateName: "Dividend declaration resolution",
    packageName: "Dividend declaration packet",
    summary: "Directors' resolution declaring the dividends of the document date, per class, payable on the payment date to holders of record on the record date.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareClass", "DividendPerShare", "RecordDate", "PaymentDate"],
    optionalDataFields: ["DividendType", "TotalDividendAmount", "SolvencyConfirmation", "ResolutionDate"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "SolvencyEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before the record date and confirm solvency at the declaration and payment dates.",
    deliverable: "Dividend declaration resolution with the solvency recital, per-class payment and record dates.",
    terms: "Confirm authorized share classes, dividend entitlements, and the solvency test under the governing legislation before declaring a dividend.",
    transactionScoped: true,
    instrument: DIVIDEND_DECLARATION,
    sections: instrumentSections("Dividend Declaration", DIVIDEND_DECLARATION),
  },
  {
    key: "share-transfer",
    templateName: "Share transfer resolution",
    packageName: "Share transfer packet",
    summary: "Directors' resolution approving the transfers of the document date, issuing new and balance certificates and cancelling the surrendered certificates.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "transfer_participants"],
    requiredDataFields: ["CorporationName", "TransferorName", "TransfereeName", "ShareClass", "Quantity", "TransferDate"],
    optionalDataFields: ["OldCertificateNumber", "NewCertificateNumber", "Consideration", "TransferRestrictionWaiver"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "TransferRegister", "TransferRestrictions"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before recording the transfer and update the registers after the certificate exchange.",
    deliverable: "Share transfer resolution with transfer, new-certificate and cancellation tables, and register update.",
    terms: "Confirm transfer restrictions, board consent requirements, and any pre-emptive or unanimous shareholder agreement constraints before approving the transfer.",
    transactionScoped: true,
    instrument: SHARE_TRANSFER,
    sections: instrumentSections("Transfer of Shares", SHARE_TRANSFER),
  },
  {
    key: "share-certificate",
    templateName: "Replacement share certificate resolution",
    packageName: "Share certificate packet",
    summary: "Directors' resolution issuing replacement certificates for shares already issued and cancelling the certificates they replace.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareholderName", "ShareClass", "Quantity", "CertificateNumber"],
    optionalDataFields: ["IssueDate", "OriginalIssuanceDate", "CertificateLegend", "ReplacedCertificateNumber"],
    reviewDataFields: ["ShareClasses", "SecuritiesRegister", "TransferRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare when a certificate is replaced for shares already entered in the securities register.",
    deliverable: "Replacement certificate resolution with issue and cancellation tables.",
    terms: "Confirm the shares are already recorded in the securities register, and obtain a statutory declaration and indemnity for a lost certificate.",
    transactionScoped: true,
    instrument: SHARE_CERTIFICATE,
    sections: instrumentSections("Issuance of Share Certificates", SHARE_CERTIFICATE),
  },
  {
    key: "share-split",
    templateName: "Share subdivision/consolidation resolution",
    packageName: "Share split or consolidation packet",
    summary: "Directors' resolution implementing a subdivision or consolidation that the shareholders approved by special resolution.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareClass", "SplitRatio", "EffectiveDate", "ShareholderSpecialResolution"],
    optionalDataFields: ["PreSplitCount", "PostSplitCount", "ConsolidationFlag", "FractionalShareTreatment"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "TransferRegister", "NoticeOfAlteration"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare after the shareholders' special resolution and before the effective date; then file the alteration.",
    deliverable: "Directors' implementing resolution reciting the special resolution, per-holder tables, and the alteration filing task.",
    terms: "A subdivision or consolidation alters the share structure: it needs the shareholders' special resolution (and any class vote) and the registry filing the governing Act requires. The directors only implement it.",
    transactionScoped: true,
    instrument: SHARE_SPLIT,
    sections: instrumentSections("Subdivision or Consolidation", SHARE_SPLIT),
  },
  {
    key: "share-redemption",
    templateName: "Share redemption resolution",
    packageName: "Share redemption packet",
    summary: "Directors' resolution redeeming redeemable shares at the articles' price, with the solvency recital, notice of redemption and cancellation.",
    documentTag: "9___transfer_register",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ShareClass", "HolderName", "Quantity", "RedemptionPrice", "RedemptionDate"],
    optionalDataFields: ["NoticeDate", "RedemptionPlace", "NoticeWaiver", "DeclaredUnpaidDividends"],
    reviewDataFields: ["Articles", "ShareClasses", "SecuritiesRegister", "SolvencyEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    sourceIds: ["BC-BCA-REDEMPTION"],
    timeline: "Prepare before the notice of redemption; confirm solvency again when the redemption price is paid.",
    deliverable: "Redemption resolution, notice-of-redemption particulars (or the holders' waiver), and the cancellation and register update.",
    terms: "Redeem only on the terms in the articles. The solvency bar applies to the payment. Confirm whether a redemption from fewer than all holders, or not pro rata, is permitted.",
    transactionScoped: true,
    instrument: SHARE_REDEMPTION,
    sections: instrumentSections("Redemption of Shares", SHARE_REDEMPTION),
  },
  {
    key: "change-of-offices",
    templateName: "Change of registered/records office resolution",
    packageName: "Change of office packet",
    summary: "Directors' resolution setting the registered or records office initially, or changing it, on the document date.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "RegisteredOfficeAddress", "RecordsOfficeAddress", "EffectiveDate"],
    optionalDataFields: ["PreviousRegisteredOffice", "PreviousRecordsOffice", "FilingPrompt"],
    reviewDataFields: ["RegistryProfile", "RegisteredOffice", "RecordsOffice", "FilingEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before the move and file the resulting notice of change promptly where required.",
    deliverable: "Change of office resolution and notice-of-change filing prompt.",
    terms: "Confirm the new addresses, jurisdiction-specific notice requirements, and any records-office service obligations before relying on the resolution.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - registered office"],
    transactionScoped: true,
    instrument: CHANGE_OF_OFFICES,
    sections: instrumentSections("Change of Office", CHANGE_OF_OFFICES),
  },
  {
    key: "director-resignation",
    templateName: "Director resignation",
    packageName: "Director resignation packet",
    summary: "The director's written resignation and the directors' resolution recording it and updating the register.",
    documentTag: "6___directors_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors", "directors___leaving"],
    requiredDataFields: ["CorporationName", "DirectorName", "EffectiveDate", "ResignationLetter"],
    optionalDataFields: ["RemainingDirectors", "FilingPrompt"],
    reviewDataFields: ["Articles", "DirectorRegister", "RegistryProfile"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare when the resignation is delivered and file the notice of change within the statutory period.",
    deliverable: "Resignation letter, directors' resolution recording the resignation, register update and notice-of-change prompt.",
    terms: "A resignation takes effect on delivery or at the later time it states. Confirm the remaining directors meet the minimum number and quorum.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - directors"],
    transactionScoped: true,
    instrument: DIRECTOR_RESIGNATION,
    sections: instrumentSections("Resignation of Director", DIRECTOR_RESIGNATION),
  },
  {
    key: "director-removal",
    templateName: "Director removal resolution",
    packageName: "Director removal packet",
    summary: "Shareholders' resolution removing a director before the end of the term (BC: special resolution, or the method the articles provide).",
    documentTag: "6___directors_register_and_consents",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_voting_shareholders"],
    requiredDataFields: ["CorporationName", "DirectorName", "EffectiveDate"],
    optionalDataFields: ["ArticlesRemovalMethod", "ClassDirector", "FilingPrompt"],
    reviewDataFields: ["Articles", "DirectorRegister", "RegistryProfile", "ShareholdersRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    sourceIds: ["BC-BCA-DIRECTOR-REMOVAL", "BC-BCA-DIRECTOR-CHANGES"],
    timeline: "Prepare for the date of the removal and file the notice of change within the statutory period.",
    deliverable: "Shareholders' removal resolution, register update and notice-of-change prompt.",
    terms: "The directors cannot remove a director. A BC company removes a director by special resolution unless the memorandum or articles provide another resolution or method; class directors are removed by their class. Federal and Ontario corporations use an ordinary resolution of the shareholders. Record a resignation with the director resignation packet instead.",
    requiresAmendmentRecord: true,
    templateFilingNames: ["Notice of change - directors"],
    transactionScoped: true,
    instrument: DIRECTOR_REMOVAL,
    sections: instrumentSections("Removal of Director", DIRECTOR_REMOVAL),
  },
  {
    key: "asset-transfer",
    templateName: "Asset acquisition/disposition resolution",
    packageName: "Asset acquisition or disposition packet",
    summary: "Directors' resolution approving the acquisitions or dispositions of the document date, with document-delivery and further-actions authority.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "AssetDescription", "AcquireOrDispose", "Counterparty", "Consideration"],
    optionalDataFields: ["AssetIdentifier", "ClosingDate", "SigningAuthority", "ValuationEvidence", "ResolutionDate"],
    reviewDataFields: ["Articles", "Bylaws", "SigningAuthorities", "BoardApprovalEvidence"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare before signing the acquisition or disposition agreement and retain the approval with the transaction file.",
    deliverable: "Asset acquisition/disposition resolution and signing authority confirmation.",
    terms: "Confirm whether the transaction requires shareholder approval, board authority limits, and any sale-of-substantially-all-assets thresholds before relying on the resolution.",
    transactionScoped: true,
    instrument: ASSET_TRANSFER,
    sections: instrumentSections("Asset Authorization", ASSET_TRANSFER),
  },
  {
    key: "all-directors-resolution",
    templateName: "Resolution of all the directors",
    packageName: "Resolution of all the directors packet",
    summary: "Generic blank shell for a resolution signed by all the directors, with grammar-aware signatory plurality.",
    documentTag: "5___directors_meetings_and_resolutions",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_directors"],
    requiredDataFields: ["CorporationName", "ResolutionSubject", "EffectiveDate"],
    optionalDataFields: ["ResolutionBody", "WhereasRecitals", "ResolvedClauses"],
    reviewDataFields: ["Articles", "Bylaws", "DirectorsRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare whenever the directors act by written resolution in place of a meeting.",
    deliverable: "Blank directors' resolution shell with signatory block.",
    terms: "Confirm that a written resolution signed by all the directors is permitted under the articles, bylaws, and governing legislation before relying on it.",
    instrument: ALL_DIRECTORS_SHELL,
    sections: [
      {
        heading: "Resolution",
        body: [
          "The undersigned, being {dir.allTheSole} director{dir.nounS} of {org.shortName}, hereby sign{dir.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}.",
          "This resolution is effective {date.long} and is as valid as if passed at a duly called and constituted meeting of the directors of {org.shortName}.",
        ],
      },
    ],
  },
  {
    key: "all-shareholders-resolution",
    templateName: "Resolution of all the shareholders",
    packageName: "Resolution of all the shareholders packet",
    summary: "Generic blank shell for a resolution signed by all the shareholders, with grammar-aware signatory plurality.",
    documentTag: "12___shareholder_agreements",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_shareholders"],
    requiredDataFields: ["CorporationName", "ResolutionSubject", "EffectiveDate"],
    optionalDataFields: ["ResolutionBody", "WhereasRecitals", "ResolvedClauses"],
    reviewDataFields: ["Articles", "Bylaws", "ShareholdersRegister"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare whenever the shareholders act by written resolution in place of a meeting.",
    deliverable: "Blank shareholders' resolution shell with signatory block.",
    terms: "Confirm that a written resolution signed by all the shareholders is permitted under the articles, bylaws, and governing legislation before relying on it.",
    instrument: ALL_SHAREHOLDERS_SHELL,
    sections: [
      {
        heading: "Resolution",
        body: [
          "The undersigned, being {shareholders.allTheSole} shareholder{shareholders.nounS} of {org.shortName}, hereby sign{shareholders.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}.",
          "This resolution is effective {date.long} and is as valid as if passed at a duly called and constituted meeting of the shareholders of {org.shortName}.",
        ],
      },
    ],
  },
  {
    key: "all-voting-shareholders-resolution",
    templateName: "Resolution of all the voting shareholders",
    packageName: "Resolution of all the voting shareholders packet",
    summary: "Generic blank shell for a resolution signed by all the voting shareholders, with grammar-aware signatory plurality.",
    documentTag: "12___shareholder_agreements",
    partType: "document",
    signatureRequired: true,
    requiredSigners: ["all_voting_shareholders"],
    requiredDataFields: ["CorporationName", "ResolutionSubject", "VotingShareClass", "EffectiveDate"],
    optionalDataFields: ["ResolutionBody", "WhereasRecitals", "ResolvedClauses"],
    reviewDataFields: ["Articles", "Bylaws", "ShareholdersRegister", "ShareClasses"],
    jurisdictions: COMMON_JURISDICTIONS,
    timeline: "Prepare whenever the voting shareholders act by written resolution in place of a meeting.",
    deliverable: "Blank voting shareholders' resolution shell with signatory block.",
    terms: "Confirm which classes carry the vote and that a written resolution signed by all the voting shareholders is permitted under the articles, bylaws, and governing legislation before relying on it.",
    instrument: ALL_VOTING_SHAREHOLDERS_SHELL,
    sections: [
      {
        heading: "Resolution",
        body: [
          "The undersigned, being {votingShareholders.allTheSole} voting shareholder{votingShareholders.nounS} of {org.shortName}, hereby sign{votingShareholders.verbS} the following resolution in writing in place of a meeting, as permitted under the {org.legislation}.",
          "This resolution is effective {date.long} and is as valid as if passed at a duly called and constituted meeting of the voting shareholders of {org.shortName}.",
        ],
      },
    ],
  },
  ...CORPORATION_REPORT_PACKETS]; import { CORPORATION_REPORT_PACKETS } from "./corporationReportPackets"; // report-style outputs (Agent REPORTS)

export function corporationPacketTemplateMarker(packet: CorporationDocumentPacket) {
  return `societyer:corporation-packet-template:${packet.key}`;
}

export function corporationPacketPrecedentMarker(packet: CorporationDocumentPacket) {
  return `societyer:corporation-packet-precedent:${packet.key}`;
}

export function corporationPacketTemplateHtml(packet: CorporationDocumentPacket) {
  const sections = packet.sections
    .map((section) => [
      `<h2>${escapeHtml(section.heading)}</h2>`,
      ...section.body.map((item) => packetBodyItemText(item)).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ].join("\n"))
    .join("\n");
  return [
    `<h1>${escapeHtml(packet.templateName)}</h1>`,
    `<p>${escapeHtml(packet.summary)}</p>`,
    sections,
    "<h2>Data Fields</h2>",
    `<p>Required: ${escapeHtml(packet.requiredDataFields.join(", "))}</p>`,
    `<p>Review: ${escapeHtml(packet.reviewDataFields.join(", "))}</p>`,
  ].join("\n");
}

export function corporationPacketEntityTypes() {
  return COMMON_ENTITY_TYPES;
}

export function corporationPacketForComplianceObligation(input: {
  filingKind?: string;
  obligationKey?: string;
  ruleId?: string;
  /** The corporation the obligation belongs to (selects the BC transparency packet). */
  organization?: LegalEntityLike | null;
}): CorporationDocumentPacket | undefined {
  const key = corporationPacketKeyForComplianceObligation(input);
  return key ? CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === key) : undefined;
}

/** The BC transparency-register report packet (shared/corporationReportPackets.ts). */
export const BC_TRANSPARENCY_PACKET_KEY = "bc-transparency-register";

export function corporationPacketKeyForComplianceObligation(input: {
  filingKind?: string;
  obligationKey?: string;
  ruleId?: string;
  organization?: LegalEntityLike | null;
}): string | undefined {
  const filingKind = input.filingKind ?? "";
  const obligationKey = input.obligationKey ?? "";
  const ruleId = input.ruleId ?? "";

  if (filingKind === "FederalAnnualReturn" || filingKind === "OntarioAnnualReturn") {
    return "annual-resolutions";
  }
  if (filingKind === "FederalIscUpdate" || /isc|significant_control|transparency/i.test(obligationKey) || /isc|significant-control|transparency/i.test(ruleId)) {
    // A BC company keeps a BC transparency register (BC BCA Part 2.1 / s. 119.1 ff.),
    // never the federal ISC register. Only offered once that packet is in the catalog.
    const bcCompany = filingKind !== "FederalIscUpdate" && (
      (input.organization && canonicalizeJurisdictionCode(homeJurisdictionCode(input.organization)) === "CA-BC" && !isFederalCbca(input.organization))
      || (!input.organization && /^bc[-_]|[-_]bc[-_]/i.test(ruleId))
    );
    if (bcCompany) {
      return CORPORATION_DOCUMENT_PACKETS.some((packet) => packet.key === BC_TRANSPARENCY_PACKET_KEY) ? BC_TRANSPARENCY_PACKET_KEY : undefined;
    }
    return "isc-register-update";
  }
  if (
    filingKind === "OntarioInitialReturn" ||
    filingKind === "OntarioNoticeOfChange" ||
    filingKind === "BCExtraProvincialAnnualReport" ||
    /extra_provincial|initial_return|notice_of_change|profile_evidence/i.test(obligationKey)
  ) {
    return "extra-provincial-registration-evidence";
  }
  if (/annual_financials|agm\.annual_meeting/i.test(obligationKey)) {
    return "annual-resolutions";
  }
  if (/agm\.first_meeting/i.test(obligationKey)) {
    return "organize-corporation";
  }
  return undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
