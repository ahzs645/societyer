export type RightsClassStatus = "active" | "proposed" | "inactive" | "needs_review" | string;
export type RightsClassType = "membership" | "voting" | "non_voting" | "unit" | "share" | "other" | string;

export type DividendEntitlement = "discretionary_by_class" | "fixed_rate" | "cumulative_fixed" | "participating";

export const DIVIDEND_ENTITLEMENTS: readonly DividendEntitlement[] = ["discretionary_by_class", "fixed_rate", "cumulative_fixed", "participating"];

/** Redemption terms summarized from the articles. Both flags false records an express "not redeemable". */
export type RedemptionTerms = {
  byCompany: boolean;
  byHolder: boolean;
  /** Redemption price per share in cents. */
  priceCents?: number;
  /** The price also includes dividends declared but unpaid at the redemption date. */
  includesDeclaredUnpaid?: boolean;
  minNoticeDays?: number;
  /** The articles permit redeeming disproportionately or excluding some holders. */
  nonProRataPermitted?: boolean;
};

/**
 * Structured summary of a share class's special rights and restrictions. The
 * articles' own text (votingRights, conditions, otherProvisions) stays
 * authoritative; these fields only let the ledger and checks use the summary.
 */
export type StructuredShareRights = {
  /** Absent = shares without par value. */
  parValueCents?: number;
  /** Absent = no maximum (unlimited). */
  maxAuthorized?: number;
  dividendEntitlement?: DividendEntitlement;
  dividendRateBps?: number;
  redemption?: RedemptionTerms;
  /** 1 = paid first on liquidation; equal numbers rank equally. */
  liquidationRank?: number;
  preEmptiveRights?: boolean;
  articlesPart?: string;
  singularDescription?: string;
  pluralDescription?: string;
};

export type RightsClassRecord = StructuredShareRights & {
  societyId: string;
  className: string;
  classType: RightsClassType;
  status: RightsClassStatus;
  idPrefix?: string;
  highestAssignedNumber?: number;
  votingRights?: string;
  votesPerShare?: number;
  startDate?: string;
  endDate?: string;
  conditionsToHold?: string;
  conditionsToTransfer?: string;
  conditionsForRemoval?: string;
  otherProvisions?: string;
  sourceDocumentIds: string[];
  sourceExternalIds: string[];
  notes?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

export type RightsholdingTransferType =
  | "issuance"
  | "transfer"
  | "redemption"
  | "cancellation"
  | "conversion"
  | "subdivision"
  | "consolidation"
  | "adjustment"
  | "other"
  | string;

export type RightsholdingTransferStatus = "draft" | "posted" | "void" | "needs_review" | string;

export type RightsholdingTransferRecord = {
  societyId: string;
  transferType: RightsholdingTransferType;
  status: RightsholdingTransferStatus;
  transferDate?: string;
  eventId?: string;
  precedentRunId?: string;
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
  /** Optional same-day order: rows on one date sort by sequence before creation time. */
  sequence?: number;
  /** Date the directors confirmed the shares were fully paid (issuance). */
  fullyPaidConfirmedAt?: string;
  /** Directors' consent to a transfer, as a document or a written resolution. */
  directorConsentDocumentId?: string;
  directorConsentResolutionId?: string;
  /** Redemption notice date and, if notice was waived, the waiver date. */
  redemptionNoticeDate?: string;
  redemptionNoticeWaivedOn?: string;
  /** Date and basis of the directors' solvency confirmation (redemption). */
  solvencyConfirmedAt?: string;
  solvencyBasis?: string;
  sourceDocumentIds: string[];
  sourceExternalIds: string[];
  notes?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

export type RightsClassSummary = {
  className: string;
  classType: RightsClassType;
  status: RightsClassStatus;
  isShareClass: boolean;
  isActive: boolean;
};

export type HoldingKey = {
  rightsClassId: string;
  holderKey: string;
};

export type CurrentHolding = HoldingKey & {
  quantity: number;
};

export type MaterializedRightsHolding = CurrentHolding & {
  societyId: string;
  status: "current";
  holderRoleHolderId?: string;
  lastTransactionId?: string;
  sourceDocumentIds: string[];
  sourceExternalIds: string[];
};

export type EquityLedgerOptions = {
  includeStatuses?: RightsholdingTransferStatus[];
};

const DEFAULT_LEDGER_STATUSES = new Set<RightsholdingTransferStatus>(["posted"]);

export function summarizeRightsClass(rightsClass: RightsClassRecord): RightsClassSummary {
  return {
    className: rightsClass.className,
    classType: rightsClass.classType,
    status: rightsClass.status,
    isShareClass: rightsClass.classType === "share",
    isActive: rightsClass.status === "active",
  };
}

export function activeRightsClasses(rightsClasses: RightsClassRecord[]): RightsClassRecord[] {
  return rightsClasses.filter((rightsClass) => rightsClass.status === "active");
}

export function isTransferPosted(transfer: RightsholdingTransferRecord): boolean {
  return transfer.status === "posted";
}

export function deriveCurrentHoldings(
  transfers: RightsholdingTransferRecord[],
  options: EquityLedgerOptions = {},
): CurrentHolding[] {
  const includedStatuses = options.includeStatuses
    ? new Set<RightsholdingTransferStatus>(options.includeStatuses)
    : DEFAULT_LEDGER_STATUSES;
  const balances = new Map<string, CurrentHolding>();

  for (const transfer of transfers) {
    if (!includedStatuses.has(transfer.status)) {
      continue;
    }

    for (const movement of transferMovements(transfer)) {
      const balanceKey = serializeHoldingKey(movement);
      const existing = balances.get(balanceKey) ?? {
        rightsClassId: movement.rightsClassId,
        holderKey: movement.holderKey,
        quantity: 0,
      };
      existing.quantity += movement.quantityDelta;
      balances.set(balanceKey, existing);
    }
  }

  return Array.from(balances.values())
    .filter((holding) => holding.quantity !== 0)
    .sort((left, right) => {
      const classSort = left.rightsClassId.localeCompare(right.rightsClassId);
      return classSort === 0 ? left.holderKey.localeCompare(right.holderKey) : classSort;
    });
}

export function materializeRightsHoldings(transfers: (RightsholdingTransferRecord & { _id?: string })[]): MaterializedRightsHolding[] {
  const postedTransfers = transfers.filter(isTransferPosted);
  const currentHoldings = deriveCurrentHoldings(postedTransfers);
  return currentHoldings.map((holding) => {
    const relatedTransfers = postedTransfers.filter((transfer) =>
      transferMovements(transfer).some(
        (movement) => movement.rightsClassId === holding.rightsClassId && movement.holderKey === holding.holderKey,
      ),
    );
    const lastTransfer = relatedTransfers[relatedTransfers.length - 1];
    return {
      ...holding,
      societyId: String(lastTransfer?.societyId ?? ""),
      status: "current",
      holderRoleHolderId: holding.holderKey.startsWith("roleHolder:")
        ? holding.holderKey.slice("roleHolder:".length)
        : undefined,
      lastTransactionId: lastTransfer?._id,
      sourceDocumentIds: uniqueStrings(relatedTransfers.flatMap((transfer) => transfer.sourceDocumentIds ?? [])),
      sourceExternalIds: uniqueStrings([
        ...relatedTransfers.flatMap((transfer) => transfer.sourceExternalIds ?? []),
        ...relatedTransfers.map((transfer) => transfer._id ? `societyer:rightsholding-transfer:${transfer._id}` : undefined),
      ]),
    };
  });
}

export function validateNoNegativeHoldings(transfers: RightsholdingTransferRecord[]): void {
  const runningBalances = new Map<string, number>();

  for (const transfer of transfers) {
    if (!isTransferPosted(transfer)) {
      continue;
    }

    for (const movement of transferMovements(transfer)) {
      const balanceKey = serializeHoldingKey(movement);
      const nextBalance = (runningBalances.get(balanceKey) ?? 0) + movement.quantityDelta;
      if (nextBalance < 0) {
        throw new Error(
          `Transfer would create negative holding for ${movement.holderKey} in rights class ${movement.rightsClassId}.`,
        );
      }
      runningBalances.set(balanceKey, nextBalance);
    }
  }
}

export function validateTransferQuantityAvailable(
  priorTransfers: RightsholdingTransferRecord[],
  transfer: RightsholdingTransferRecord,
): void {
  if (!isTransferPosted(transfer) || !["transfer", "redemption", "cancellation"].includes(String(transfer.transferType))) {
    return;
  }

  const rightsClassId = requireRightsClassId(transfer);
  const sourceHolderKey = requireHolderKey(transfer, "source");
  const quantity = requirePositiveQuantity(transfer);
  const sourceBalance = holdingQuantity(priorTransfers, rightsClassId, sourceHolderKey);

  if (quantity > sourceBalance) {
    const label = transfer.transferType === "transfer" ? "Transfer" : transfer.transferType === "redemption" ? "Redemption" : "Cancellation";
    throw new Error(
      `${label} quantity ${quantity} exceeds source balance ${sourceBalance} for ${sourceHolderKey} in rights class ${rightsClassId}.`,
    );
  }
}

/** A class as the ledger checks see it: an id plus the optional authorized maximum. */
export type LedgerClassLimit = { _id?: string; id?: string; className?: string; maxAuthorized?: number };

export type ValidateLedgerOptions = {
  /** When given, issued shares per class must never exceed the class's maxAuthorized. */
  classes?: LedgerClassLimit[];
};

/**
 * Validate a chronologically sorted ledger: every transfer is covered by the
 * source balance, no holding goes negative and, when classes are supplied, no
 * class ever has more issued shares than its authorized maximum.
 */
export function validateLedger(transfers: RightsholdingTransferRecord[], options: ValidateLedgerOptions = {}): void {
  const acceptedTransfers: RightsholdingTransferRecord[] = [];

  for (const transfer of transfers) {
    validateTransferQuantityAvailable(acceptedTransfers, transfer);
    if (isTransferPosted(transfer)) {
      transferMovements(transfer);
      acceptedTransfers.push(transfer);
    }
  }

  validateNoNegativeHoldings(transfers);
  if (options.classes?.length) validateAuthorizedMaximums(transfers, options.classes);
}

/** Issued shares per class must stay at or below maxAuthorized (absent = unlimited). */
export function validateAuthorizedMaximums(transfers: RightsholdingTransferRecord[], classes: LedgerClassLimit[]): void {
  const limits = new Map<string, LedgerClassLimit>();
  for (const cls of classes) {
    const id = String(cls._id ?? cls.id ?? "");
    if (id && typeof cls.maxAuthorized === "number" && Number.isFinite(cls.maxAuthorized)) limits.set(id, cls);
  }
  if (!limits.size) return;
  const issued = new Map<string, number>();
  for (const transfer of transfers) {
    if (!isTransferPosted(transfer)) continue;
    for (const movement of transferMovements(transfer)) {
      const total = (issued.get(movement.rightsClassId) ?? 0) + movement.quantityDelta;
      issued.set(movement.rightsClassId, total);
      const limit = limits.get(movement.rightsClassId);
      if (limit && total > Number(limit.maxAuthorized)) {
        throw new Error(
          `This ${transfer.transferType}${transfer.transferDate ? ` on ${transfer.transferDate}` : ""} would bring ${limit.className ?? movement.rightsClassId} to ${total} issued shares, above its authorized maximum of ${limit.maxAuthorized}. Raise the maximum (an alteration of the notice of articles) first, or reduce the quantity.`,
        );
      }
    }
  }
}

/** Issued (outstanding) shares per class from posted rows. */
export function issuedSharesByClass(transfers: RightsholdingTransferRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const holding of deriveCurrentHoldings(transfers)) {
    totals.set(holding.rightsClassId, (totals.get(holding.rightsClassId) ?? 0) + holding.quantity);
  }
  return totals;
}

/** The ledger's effective date for a row: its transfer date, else its creation date. */
export function ledgerEntryDate(transfer: Record<string, any>): string {
  return String(transfer.transferDate ?? transfer.createdAtISO ?? "").slice(0, 10);
}

function finiteSequence(row: Record<string, any>): number | undefined {
  return typeof row.sequence === "number" && Number.isFinite(row.sequence) ? row.sequence : undefined;
}

/**
 * Chronological ledger order: effective date, then the optional same-day
 * `sequence` (rows with a sequence come first, in ascending order), then
 * creation time. A user can therefore record that a same-day issuance comes
 * before the transfer that depends on it.
 */
export function compareLedgerEntries(left: Record<string, any>, right: Record<string, any>): number {
  const leftDate = String(left.transferDate ?? left.createdAtISO ?? left._creationTime ?? "");
  const rightDate = String(right.transferDate ?? right.createdAtISO ?? right._creationTime ?? "");
  const dateSort = leftDate.localeCompare(rightDate);
  if (dateSort !== 0) return dateSort;
  const leftSequence = finiteSequence(left);
  const rightSequence = finiteSequence(right);
  if (leftSequence !== undefined || rightSequence !== undefined) {
    if (leftSequence === undefined) return 1;
    if (rightSequence === undefined) return -1;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  }
  return Number(left._creationTime ?? 0) - Number(right._creationTime ?? 0);
}

/**
 * Holdings per holder per class as at the END of `isoDate` (YYYY-MM-DD):
 * posted rows whose effective date is on or before that day, in ledger order.
 * Rows without a transfer date use their creation date.
 */
export function holdingsAsOf(transfers: RightsholdingTransferRecord[], isoDate: string): CurrentHolding[] {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) {
    throw new Error("holdingsAsOf needs an ISO date (YYYY-MM-DD).");
  }
  const day = isoDate.slice(0, 10);
  const included = transfers
    .filter((transfer) => isTransferPosted(transfer) && ledgerEntryDate(transfer) !== "" && ledgerEntryDate(transfer) <= day)
    .sort(compareLedgerEntries);
  return deriveCurrentHoldings(included);
}

/**
 * Validate the ledger that would remain after deleting or voiding a posted row.
 * Throws an explanation when later entries depend on it (negative holdings, or
 * transfers and redemptions of shares that would no longer exist).
 */
export function validateLedgerWithout(
  remaining: RightsholdingTransferRecord[],
  removed: RightsholdingTransferRecord,
  action: "delete" | "void",
  options: ValidateLedgerOptions = {},
): void {
  try {
    validateLedger(remaining.slice().sort(compareLedgerEntries), options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const verb = action === "delete" ? "Deleting" : "Voiding";
    throw new Error(
      `${verb} this ${removed.transferType}${removed.transferDate ? ` dated ${removed.transferDate}` : ""} would leave the ledger inconsistent: ${reason} Void or correct the later entries that depend on it first.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Structured share-class rights
// ---------------------------------------------------------------------------

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Validate the structured summary of a class's rights. Returns problems; empty = valid. */
export function shareClassRightsIssues(rights: StructuredShareRights): string[] {
  const issues: string[] = [];
  if (rights.parValueCents !== undefined && !(typeof rights.parValueCents === "number" && Number.isFinite(rights.parValueCents) && rights.parValueCents > 0)) {
    issues.push("Par value must be a positive amount; leave it blank for shares without par value.");
  }
  if (rights.maxAuthorized !== undefined && !(isNonNegativeInteger(rights.maxAuthorized) && rights.maxAuthorized > 0)) {
    issues.push("The authorized maximum must be a whole number of shares; leave it blank when there is no maximum.");
  }
  if (rights.dividendEntitlement !== undefined && !DIVIDEND_ENTITLEMENTS.includes(rights.dividendEntitlement)) {
    issues.push(`Unknown dividend entitlement "${rights.dividendEntitlement}".`);
  }
  const fixed = rights.dividendEntitlement === "fixed_rate" || rights.dividendEntitlement === "cumulative_fixed";
  if (rights.dividendRateBps !== undefined && !(isNonNegativeInteger(rights.dividendRateBps) && rights.dividendRateBps > 0)) {
    issues.push("The dividend rate must be a positive whole number of basis points (for example 500 = 5%).");
  }
  if (fixed && rights.dividendRateBps === undefined) {
    issues.push("A fixed or cumulative dividend entitlement needs the rate stated in the articles. If the articles state no rate, record the dividends as discretionary by class.");
  }
  if (rights.dividendRateBps !== undefined && (rights.dividendEntitlement === undefined || rights.dividendEntitlement === "discretionary_by_class")) {
    issues.push("A dividend rate applies only to a fixed, cumulative or participating entitlement.");
  }
  const redemption = rights.redemption;
  if (redemption) {
    if (typeof redemption.byCompany !== "boolean" || typeof redemption.byHolder !== "boolean") {
      issues.push("Redemption terms must say whether the company and the holder can require redemption.");
    }
    const redeemable = redemption.byCompany === true || redemption.byHolder === true;
    if (redemption.priceCents !== undefined && !(typeof redemption.priceCents === "number" && Number.isFinite(redemption.priceCents) && redemption.priceCents >= 0)) {
      issues.push("The redemption price cannot be negative.");
    }
    if (redemption.minNoticeDays !== undefined && !isNonNegativeInteger(redemption.minNoticeDays)) {
      issues.push("The redemption notice period must be a whole number of days.");
    }
    if (!redeemable && (redemption.priceCents !== undefined || redemption.minNoticeDays !== undefined || redemption.includesDeclaredUnpaid || redemption.nonProRataPermitted)) {
      issues.push("Redemption price, notice and procedure apply only to a class redeemable by the company or the holder.");
    }
  }
  if (rights.liquidationRank !== undefined && !(isNonNegativeInteger(rights.liquidationRank) && rights.liquidationRank >= 1)) {
    issues.push("Liquidation rank must be a whole number starting at 1 (1 = paid first).");
  }
  return issues;
}

export function isRedeemableClass(rights: StructuredShareRights | null | undefined): boolean {
  return rights?.redemption?.byCompany === true || rights?.redemption?.byHolder === true;
}

// ---------------------------------------------------------------------------
// Posting gates for corporations
// ---------------------------------------------------------------------------

export type LedgerPostingContext = {
  /** Gates apply only to corporations; society membership ledgers are unaffected. */
  isCorporation: boolean;
  /** Adds British Columbia Business Corporations Act citations to the messages. */
  isBcCompany?: boolean;
  /** The articles require the directors' consent to every share transfer. */
  transferConsentRequired?: boolean;
  rightsClass?: (StructuredShareRights & { className?: string }) | null;
  /** Every other ledger row of the organization (the row being written excluded). */
  otherTransfers: RightsholdingTransferRecord[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

/** Consideration the Act deems fully paid: shares issued as a dividend, or on a conversion or exchange. */
export function deemedFullyPaidConsideration(considerationType?: string): boolean {
  const type = String(considerationType ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["stock_dividend", "share_dividend", "dividend", "conversion", "exchange", "conversion_or_exchange"].includes(type);
}

/**
 * Shares of a holder in a class under a redemption notice still outstanding on
 * `onDate`: notice given on or before that day, and the redemption not yet
 * completed (not posted, or posted for a later date).
 */
export function sharesUnderRedemptionNotice(
  transfers: RightsholdingTransferRecord[],
  rightsClassId: string,
  sourceHolderKey: string,
  onDate: string,
): { quantity: number; noticeDates: string[] } {
  let quantity = 0;
  const noticeDates: string[] = [];
  for (const row of transfers) {
    if (row.transferType !== "redemption" || row.status === "void") continue;
    if (row.rightsClassId !== rightsClassId || holderKey(row, "source") !== sourceHolderKey) continue;
    if (!validIsoDate(row.redemptionNoticeDate) || row.redemptionNoticeDate > onDate) continue;
    const completed = row.status === "posted" && validIsoDate(row.transferDate) && row.transferDate <= onDate;
    if (completed) continue;
    quantity += typeof row.quantity === "number" && row.quantity > 0 ? row.quantity : 0;
    noticeDates.push(row.redemptionNoticeDate);
  }
  return { quantity, noticeDates: noticeDates.sort() };
}

/**
 * Corporate-law gates for posting one ledger row. Returns the problems that
 * block posting; an empty list means the row may be posted. Only posted rows
 * of corporations are gated, so drafts and society ledgers are unaffected.
 */
export function ledgerPostingIssues(transfer: RightsholdingTransferRecord, context: LedgerPostingContext): string[] {
  if (!context.isCorporation || transfer.status !== "posted") return [];
  const issues: string[] = [];
  const cite = (section: string) => (context.isBcCompany ? ` (Business Corporations Act, ${section})` : "");
  const rightsClass = context.rightsClass ?? undefined;
  if (transfer.priceToOrganizationCents !== undefined && !(Number.isFinite(transfer.priceToOrganizationCents) && transfer.priceToOrganizationCents >= 0)) {
    issues.push("Consideration paid to the company cannot be negative.");
  }
  if (transfer.priceToVendorCents !== undefined && !(Number.isFinite(transfer.priceToVendorCents) && transfer.priceToVendorCents >= 0)) {
    issues.push("The amount paid to the holder cannot be negative.");
  }

  if (transfer.transferType === "issuance" && !deemedFullyPaidConsideration(transfer.considerationType)) {
    if (!String(transfer.considerationType ?? "").trim() && !String(transfer.considerationDescription ?? "").trim()) {
      issues.push(`Record the consideration for the shares (money, property or past services) before posting the issuance${cite("s. 64(3)")}.`);
    }
    if (!validIsoDate(transfer.fullyPaidConfirmedAt)) {
      issues.push(`Record the date the directors confirmed the shares are fully paid. A share must not be issued until it is fully paid${cite("s. 64(2)")}.`);
    } else if (validIsoDate(transfer.transferDate) && transfer.fullyPaidConfirmedAt > transfer.transferDate) {
      issues.push(`The shares were confirmed fully paid on ${transfer.fullyPaidConfirmedAt}, after the issue date ${transfer.transferDate}. A share must not be issued until it is fully paid${cite("s. 64(2)")}.`);
    }
    const parValue = rightsClass?.parValueCents;
    const quantity = transfer.quantity;
    if (typeof parValue === "number" && parValue > 0 && typeof transfer.priceToOrganizationCents === "number" && typeof quantity === "number" && quantity > 0 && transfer.priceToOrganizationCents < parValue * quantity) {
      issues.push(`The consideration is less than the par value of ${quantity} ${rightsClass?.className ?? "shares"}. The issue price of a par value share must be at least its par value${cite("s. 63(2)")}.`);
    }
  }

  if (transfer.transferType === "transfer") {
    if (context.transferConsentRequired && !transfer.directorConsentDocumentId && !transfer.directorConsentResolutionId) {
      issues.push("The articles require the directors' consent to every share transfer. Link the directors' consent resolution or document before posting the transfer.");
    }
    const source = holderKey(transfer, "source");
    if (source && transfer.rightsClassId && validIsoDate(transfer.transferDate)) {
      const notice = sharesUnderRedemptionNotice(context.otherTransfers, transfer.rightsClassId, source, transfer.transferDate);
      if (notice.quantity > 0) {
        const held = holdingsAsOf(context.otherTransfers, transfer.transferDate)
          .find((row) => row.rightsClassId === transfer.rightsClassId && row.holderKey === source)?.quantity ?? 0;
        const free = held - notice.quantity;
        if ((transfer.quantity ?? 0) > free) {
          issues.push(`${notice.quantity} of these shares are under a redemption notice dated ${notice.noticeDates[0]} that is still outstanding, so at most ${Math.max(0, free)} can be transferred. Complete or withdraw the redemption first.`);
        }
      }
    }
  }

  if (transfer.transferType === "redemption") {
    if (!isRedeemableClass(rightsClass)) {
      issues.push(`${rightsClass?.className ?? "This class"} is not recorded as redeemable. Record the class's redemption terms from the articles before posting a redemption: a company may redeem only shares that have a right of redemption attached${cite("s. 77(a)")}. Record a purchase or other acquisition as a cancellation.`);
    }
    if (!validIsoDate(transfer.transferDate)) issues.push("Record the redemption date.");
    const minNotice = rightsClass?.redemption?.minNoticeDays;
    if (typeof minNotice === "number" && minNotice > 0 && !validIsoDate(transfer.redemptionNoticeWaivedOn)) {
      if (!validIsoDate(transfer.redemptionNoticeDate)) {
        issues.push(`The articles require ${minNotice} days' notice of redemption. Record the notice date, or the date the holder waived notice.`);
      } else if (validIsoDate(transfer.transferDate) && daysBetween(transfer.redemptionNoticeDate, transfer.transferDate) < minNotice) {
        issues.push(`Notice was given on ${transfer.redemptionNoticeDate}, ${daysBetween(transfer.redemptionNoticeDate, transfer.transferDate)} days before the redemption date ${transfer.transferDate}; the articles require ${minNotice}. Record a waiver of notice or move the redemption date.`);
      }
    }
    if (!validIsoDate(transfer.solvencyConfirmedAt)) {
      issues.push(`Record the date the directors confirmed there are no reasonable grounds for believing the company is insolvent or that the redemption payment would make it insolvent${cite("s. 79")}.`);
    } else if (validIsoDate(transfer.transferDate) && transfer.solvencyConfirmedAt > transfer.transferDate) {
      issues.push(`The solvency confirmation (${transfer.solvencyConfirmedAt}) is after the redemption date ${transfer.transferDate}. Confirm solvency on or before the payment${cite("s. 79")}.`);
    }
  }
  return issues;
}

export function holdingQuantity(
  transfers: RightsholdingTransferRecord[],
  rightsClassId: string,
  holderKey: string,
): number {
  return deriveCurrentHoldings(transfers).find(
    (holding) => holding.rightsClassId === rightsClassId && holding.holderKey === holderKey,
  )?.quantity ?? 0;
}

type HoldingMovement = HoldingKey & {
  quantityDelta: number;
};

function transferMovements(transfer: RightsholdingTransferRecord): HoldingMovement[] {
  switch (transfer.transferType) {
    case "issuance":
      return [{
        rightsClassId: requireRightsClassId(transfer),
        holderKey: requireHolderKey(transfer, "destination"),
        quantityDelta: requirePositiveQuantity(transfer),
      }];
    case "transfer": {
      const rightsClassId = requireRightsClassId(transfer);
      const quantity = requirePositiveQuantity(transfer);
      return [
        {
          rightsClassId,
          holderKey: requireHolderKey(transfer, "source"),
          quantityDelta: -quantity,
        },
        {
          rightsClassId,
          holderKey: requireHolderKey(transfer, "destination"),
          quantityDelta: quantity,
        },
      ];
    }
    case "cancellation":
    case "redemption":
      return [{
        rightsClassId: requireRightsClassId(transfer),
        holderKey: requireHolderKey(transfer, "source"),
        quantityDelta: -requirePositiveQuantity(transfer),
      }];
    case "conversion":
    case "adjustment":
    // A subdivision/consolidation is staged as one signed per-holder adjustment row
    // (the new share count minus the old), so it reconciles like an adjustment.
    case "subdivision":
    case "consolidation":
      return adjustmentMovements(transfer);
    default:
      return [];
  }
}

function adjustmentMovements(transfer: RightsholdingTransferRecord): HoldingMovement[] {
  const rightsClassId = requireRightsClassId(transfer);
  const quantity = requirePositiveQuantity(transfer);
  const sourceHolderKey = holderKey(transfer, "source");
  const destinationHolderKey = holderKey(transfer, "destination");

  if (sourceHolderKey && destinationHolderKey) {
    return [
      { rightsClassId, holderKey: sourceHolderKey, quantityDelta: -quantity },
      { rightsClassId, holderKey: destinationHolderKey, quantityDelta: quantity },
    ];
  }

  if (sourceHolderKey) {
    return [{ rightsClassId, holderKey: sourceHolderKey, quantityDelta: -quantity }];
  }

  if (destinationHolderKey) {
    return [{ rightsClassId, holderKey: destinationHolderKey, quantityDelta: quantity }];
  }

  throw new Error("Adjustment requires a source or destination holder.");
}

function requireRightsClassId(transfer: RightsholdingTransferRecord): string {
  if (!transfer.rightsClassId) {
    throw new Error(`${transfer.transferType} requires rightsClassId.`);
  }
  return transfer.rightsClassId;
}

function requirePositiveQuantity(transfer: RightsholdingTransferRecord): number {
  if (typeof transfer.quantity !== "number" || !Number.isFinite(transfer.quantity) || transfer.quantity <= 0) {
    throw new Error(`${transfer.transferType} requires a positive quantity.`);
  }
  return transfer.quantity;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function requireHolderKey(transfer: RightsholdingTransferRecord, side: "source" | "destination"): string {
  const key = holderKey(transfer, side);
  if (!key) {
    throw new Error(`${transfer.transferType} requires a ${side} holder.`);
  }
  return key;
}

function holderKey(transfer: RightsholdingTransferRecord, side: "source" | "destination"): string | undefined {
  const roleHolderId = side === "source" ? transfer.sourceRoleHolderId : transfer.destinationRoleHolderId;
  const holderName = side === "source" ? transfer.sourceHolderName : transfer.destinationHolderName;
  return roleHolderId ? `roleHolder:${roleHolderId}` : holderName ? `name:${holderName}` : undefined;
}

function serializeHoldingKey(holding: HoldingKey): string {
  return `${holding.rightsClassId}\u0000${holding.holderKey}`;
}
