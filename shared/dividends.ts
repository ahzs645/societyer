// Dividend-declaration math (YCN DB_GLOB_DIVIDEND idea; corporations track).
// Pure logic, framework-free. Money is represented in integer CENTS.

export interface DividendDeclaration {
  id?: string;
  declaredOn: string /* ISO */;
  shareClass: string;
  perShareCents: number;
  sharesOutstanding: number;
  currency: string;
  /** Stored total, when known; preferred over perShareCents × shares in totals. */
  totalCents?: number;
}

export interface DividendComputation extends DividendDeclaration {
  totalCents: number;
}

export interface DividendValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Compute the total payout for a declaration: perShareCents * sharesOutstanding.
 * Both operands are integers, so the product is an integer cents amount.
 */
export function computeDividend(d: DividendDeclaration): DividendComputation {
  return {
    ...d,
    totalCents: d.perShareCents * d.sharesOutstanding,
  };
}

export interface DividendReconciliation {
  /** Recomputed total (perShareCents * sharesOutstanding). */
  expectedCents: number;
  /** The total the caller entered/imported. */
  enteredCents: number;
  /** enteredCents - expectedCents (signed). */
  deltaCents: number;
  /** true when the entered total matches the computed total within tolerance. */
  reconciled: boolean;
}

/**
 * Reconcile an entered/imported dividend total against perShareCents *
 * sharesOutstanding (YCN "Record - Dividends" cross-check). Tolerance is a
 * fraction of the expected total (default 1%, matching YCN), with a 1-cent floor
 * so exact small declarations still reconcile.
 */
export function reconcileDividend(
  d: DividendDeclaration & { totalCents?: number },
  tolerance = 0.01,
): DividendReconciliation {
  const expectedCents = d.perShareCents * d.sharesOutstanding;
  return reconcileTotals(expectedCents, typeof d.totalCents === "number" ? d.totalCents : expectedCents, tolerance);
}

/**
 * The same ±tolerance (1-cent floor) cross-check against an already computed
 * total, e.g. the exact total of a rate with fractions of a cent. A warning
 * input only: a mismatch never blocks a declaration.
 */
export function reconcileTotals(expectedCents: number, enteredCents: number, tolerance = 0.01): DividendReconciliation {
  const deltaCents = enteredCents - expectedCents;
  const allowed = Math.max(1, Math.round(Math.abs(expectedCents) * tolerance));
  return {
    expectedCents,
    enteredCents,
    deltaCents,
    reconciled: Math.abs(deltaCents) <= allowed,
  };
}

/**
 * Validate a declaration. Requires declaredOn (ISO date string), shareClass,
 * currency, perShareCents >= 0, sharesOutstanding >= 0, and integer
 * cents/shares.
 */
export function validateDividend(d: DividendDeclaration): DividendValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(d.declaredOn)) {
    errors.push("declaredOn is required.");
  } else if (!isIsoDate(d.declaredOn)) {
    errors.push("declaredOn must be a valid ISO date string.");
  }

  if (!isNonEmptyString(d.shareClass)) {
    errors.push("shareClass is required.");
  }

  if (!isNonEmptyString(d.currency)) {
    errors.push("currency is required.");
  }

  if (typeof d.perShareCents !== "number" || !Number.isFinite(d.perShareCents)) {
    errors.push("perShareCents must be a number.");
  } else {
    if (!Number.isInteger(d.perShareCents)) {
      errors.push("perShareCents must be an integer (cents).");
    }
    if (d.perShareCents < 0) {
      errors.push("perShareCents must be >= 0.");
    }
  }

  if (typeof d.sharesOutstanding !== "number" || !Number.isFinite(d.sharesOutstanding)) {
    errors.push("sharesOutstanding must be a number.");
  } else {
    if (!Number.isInteger(d.sharesOutstanding)) {
      errors.push("sharesOutstanding must be an integer.");
    }
    if (d.sharesOutstanding < 0) {
      errors.push("sharesOutstanding must be >= 0.");
    }
  }

  return { ok: errors.length === 0, errors };
}

function storedOrComputedTotal(d: DividendDeclaration): number {
  return typeof d.totalCents === "number" && Number.isFinite(d.totalCents) ? d.totalCents : computeDividend(d).totalCents;
}

/**
 * Sum of totalCents per shareClass across the given declarations.
 */
export function totalDeclaredByClass(decls: DividendDeclaration[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const d of decls) {
    const totalCents = storedOrComputedTotal(d);
    totals[d.shareClass] = (totals[d.shareClass] ?? 0) + totalCents;
  }
  return totals;
}

/**
 * Sum of totalCents per currency across the given declarations.
 */
export function totalDeclaredByCurrency(decls: DividendDeclaration[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const d of decls) {
    const totalCents = storedOrComputedTotal(d);
    totals[d.currency] = (totals[d.currency] ?? 0) + totalCents;
  }
  return totals;
}

/**
 * Declarations whose declaredOn falls within [fromISO, toISO] inclusive.
 */
export function dividendsInPeriod(
  decls: DividendDeclaration[],
  fromISO: string,
  toISO: string,
): DividendDeclaration[] {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  return decls.filter((d) => {
    const at = Date.parse(d.declaredOn);
    if (Number.isNaN(at)) {
      return false;
    }
    return at >= from && at <= to;
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// Exact per-share amounts, record-date entitlements and the declaration gate.
//
// A per-share rate is kept as a decimal STRING in currency units ("0.0125")
// so a rate below one cent, or with more than two decimals, is never rounded
// before it is multiplied by a share count. All arithmetic below uses BigInt;
// rounding to whole cents happens once, on each payable amount, half up.
// ---------------------------------------------------------------------------

/** Most decimal places accepted in a per-share amount. */
export const MAX_PER_SHARE_DECIMALS = 10;

/** An exact non-negative decimal: value = units / 10^scale. */
export interface DecimalAmount {
  units: bigint;
  scale: number;
}

/**
 * Parse a non-negative decimal string ("0.0125", "1", "2.50"). Returns null
 * for blanks, signs, exponents, thousands separators or more than
 * MAX_PER_SHARE_DECIMALS decimal places.
 */
export function parseDecimalAmount(value: unknown): DecimalAmount | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > MAX_PER_SHARE_DECIMALS) return null;
  return { units: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

/** Canonical text for a decimal, keeping at least `minDecimals` decimal places. */
export function formatDecimalAmount(amount: DecimalAmount, minDecimals = 2): string {
  const scale = Math.max(amount.scale, minDecimals);
  const units = amount.units * 10n ** BigInt(scale - amount.scale);
  const digits = units.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  let fraction = digits.slice(digits.length - scale);
  while (fraction.length > minDecimals && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Normalize a per-share amount string ("0.5" → "0.50", "1" → "1.00"); null if invalid. */
export function normalizePerShareAmount(value: unknown): string | null {
  const parsed = parseDecimalAmount(value);
  return parsed ? formatDecimalAmount(parsed) : null;
}

/** Exact decimal for a legacy integer-cents rate (125 → "1.25"). */
export function perShareAmountFromCents(cents: number): string {
  const whole = Math.trunc(Math.abs(Number(cents) || 0));
  return formatDecimalAmount({ units: BigInt(whole), scale: 2 });
}

/** Exact product of a decimal amount and a whole number of shares. */
export function multiplyByShares(amount: DecimalAmount, shares: number): DecimalAmount {
  if (!Number.isSafeInteger(shares) || shares < 0) throw new Error("Shares must be a whole number of zero or more.");
  return { units: amount.units * BigInt(shares), scale: amount.scale };
}

/** Round a currency-unit decimal to whole cents, half up (amounts are never negative). */
export function decimalToCentsHalfUp(amount: DecimalAmount): number {
  const numerator = amount.units * 100n;
  const denominator = 10n ** BigInt(amount.scale);
  return Number((numerator * 2n + denominator) / (2n * denominator));
}

function isWholeCents(amount: DecimalAmount): boolean {
  if (amount.scale <= 2) return true;
  return (amount.units * 100n) % 10n ** BigInt(amount.scale) === 0n;
}

/**
 * The legacy integer `perShareCents` column for a decimal rate. Exact when the
 * rate is a whole number of cents; otherwise rounded half up and flagged, so
 * callers keep the decimal string as the authoritative rate.
 */
export function legacyPerShareCents(perShareAmount: string): { cents: number; exact: boolean } | null {
  const parsed = parseDecimalAmount(perShareAmount);
  if (!parsed) return null;
  return { cents: decimalToCentsHalfUp(parsed), exact: isWholeCents(parsed) };
}

/** The authoritative per-share rate of a stored row: the decimal string, else legacy cents. */
export function rowPerShareAmount(row: { perShareAmount?: unknown; perShareCents?: unknown }): string {
  return normalizePerShareAmount(row.perShareAmount) ?? perShareAmountFromCents(Number(row.perShareCents ?? 0));
}

/** One holder's entitlement as at the record date. */
export interface DividendEntitlement {
  holderKey: string;
  holderName: string;
  roleHolderId?: string;
  shares: number;
  /** Exact amount in currency units (decimal string). */
  amount: string;
  /** The amount payable, rounded to whole cents half up. */
  amountCents: number;
}

export interface DividendHoldingRow {
  rightsClassId: string;
  holderKey: string;
  quantity: number;
}

export interface DividendEntitlementSnapshot {
  sharesOutstanding: number;
  entitlements: DividendEntitlement[];
  /** Exact total = sharesOutstanding × rate. */
  totalAmount: string;
  /** Exact total rounded half up to whole cents. */
  totalCents: number;
  /** Sum of the rounded per-holder payments. */
  payableCents: number;
  /** payableCents - totalCents: rounding left over from paying each holder in whole cents. */
  roundingDifferenceCents: number;
}

/**
 * Per-holder entitlements for one class from holdings as at the record date.
 * Holdings for other classes and zero balances are ignored. Holder names come
 * from `nameFor` (a roleHolder's name), else the name in a `name:` key.
 */
export function dividendEntitlements(
  holdings: readonly DividendHoldingRow[],
  rightsClassId: string,
  perShareAmount: string,
  nameFor: (holderKey: string) => string | undefined = () => undefined,
): DividendEntitlementSnapshot {
  const rate = parseDecimalAmount(perShareAmount);
  if (!rate) throw new Error("Enter the per-share amount as a decimal number, such as 0.25.");
  const byHolder = new Map<string, number>();
  for (const holding of holdings) {
    if (holding.rightsClassId !== rightsClassId) continue;
    const quantity = Number(holding.quantity) || 0;
    if (quantity <= 0) continue;
    byHolder.set(holding.holderKey, (byHolder.get(holding.holderKey) ?? 0) + quantity);
  }
  const entitlements: DividendEntitlement[] = [];
  let sharesOutstanding = 0;
  for (const [holderKey, shares] of byHolder) {
    if (!Number.isSafeInteger(shares)) {
      throw new Error(`The ledger holding for ${holderKey} is not a whole number of shares. Review the share register before declaring.`);
    }
    sharesOutstanding += shares;
    const exact = multiplyByShares(rate, shares);
    const roleHolderId = holderKey.startsWith("roleHolder:") ? holderKey.slice("roleHolder:".length) : undefined;
    entitlements.push({
      holderKey,
      holderName: nameFor(holderKey) ?? (holderKey.startsWith("name:") ? holderKey.slice("name:".length) : holderKey),
      ...(roleHolderId ? { roleHolderId } : {}),
      shares,
      amount: formatDecimalAmount(exact),
      amountCents: decimalToCentsHalfUp(exact),
    });
  }
  entitlements.sort((a, b) => b.shares - a.shares || a.holderName.localeCompare(b.holderName));
  const exactTotal = multiplyByShares(rate, sharesOutstanding);
  const totalCents = decimalToCentsHalfUp(exactTotal);
  const payableCents = entitlements.reduce((sum, row) => sum + row.amountCents, 0);
  return {
    sharesOutstanding,
    entitlements,
    totalAmount: formatDecimalAmount(exactTotal),
    totalCents,
    payableCents,
    roundingDifferenceCents: payableCents - totalCents,
  };
}

/** Exact total for a share count with no ledger snapshot. */
export function dividendTotalForShares(perShareAmount: string, sharesOutstanding: number): { totalAmount: string; totalCents: number } {
  const rate = parseDecimalAmount(perShareAmount);
  if (!rate) throw new Error("Enter the per-share amount as a decimal number, such as 0.25.");
  const exact = multiplyByShares(rate, sharesOutstanding);
  return { totalAmount: formatDecimalAmount(exact), totalCents: decimalToCentsHalfUp(exact) };
}

export type DividendStatus = "draft" | "declared" | "paid" | "cancelled";
export const DIVIDEND_STATUSES: readonly DividendStatus[] = ["draft", "declared", "paid", "cancelled"];

/** Dividend rule family: BC Business Corporations Act, or another corporate statute. */
export type DividendRuleScope = "bc_company" | "other_corporation";

export interface DividendDeclarationFacts {
  status?: string;
  declaredOn?: string;
  recordDate?: string;
  paymentDate?: string;
  solvencyConfirmedAt?: string;
  solvencyBasis?: string;
  rightsClassId?: string;
  excludedClassIds?: readonly string[];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function validDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Same day-of-month two calendar months later, clamped to that month's end. */
export function addTwoCalendarMonths(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  const ordinal = y * 12 + (m - 1) + 2;
  const year = Math.floor(ordinal / 12), month = (ordinal % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Minimum evidence text for a solvency confirmation. */
export const MIN_SOLVENCY_BASIS_LENGTH = 12;

/** Whether a status needs the solvency confirmation first. */
export function dividendStatusNeedsSolvency(status: unknown): boolean {
  return status === "declared" || status === "paid";
}

/**
 * Blocking problems for a dividend declaration. A declaration can be saved as
 * a draft without solvency evidence. It cannot be marked declared (or paid)
 * until the directors' solvency confirmation is recorded with its basis. For a
 * BC company that is the Business Corporations Act s. 70 (2) test, and
 * s. 171 (2) (a) limits a record date to two months before the payment date.
 */
export function dividendDeclarationProblems(facts: DividendDeclarationFacts, scope: DividendRuleScope): string[] {
  const problems: string[] = [];
  const status = facts.status ?? "draft";
  if (!(DIVIDEND_STATUSES as readonly string[]).includes(status)) problems.push("Choose a valid dividend status.");
  if (facts.recordDate !== undefined && !validDateOnly(facts.recordDate)) problems.push("The record date must be a valid date.");
  if (facts.paymentDate !== undefined && !validDateOnly(facts.paymentDate)) problems.push("The payment date must be a valid date.");
  if (validDateOnly(facts.recordDate) && validDateOnly(facts.paymentDate)) {
    if (facts.recordDate > facts.paymentDate) problems.push("The record date cannot be after the payment date.");
    else if (scope === "bc_company" && addTwoCalendarMonths(facts.recordDate) < facts.paymentDate) {
      problems.push("For a BC company, the record date for a dividend must not be more than 2 months before the payment date (Business Corporations Act s. 171 (2) (a)).");
    }
  }
  if (validDateOnly(facts.declaredOn) && validDateOnly(facts.paymentDate) && facts.paymentDate < facts.declaredOn) {
    problems.push("The payment date cannot be before the declaration date.");
  }
  if (facts.rightsClassId && (facts.excludedClassIds ?? []).includes(facts.rightsClassId)) {
    problems.push("The declared class cannot also be listed as excluded.");
  }
  if (dividendStatusNeedsSolvency(status)) {
    const confirmed = typeof facts.solvencyConfirmedAt === "string" && facts.solvencyConfirmedAt.trim() !== "";
    const basis = typeof facts.solvencyBasis === "string" ? facts.solvencyBasis.trim() : "";
    if (!confirmed || basis.length < MIN_SOLVENCY_BASIS_LENGTH) {
      problems.push(scope === "bc_company"
        ? "Record the directors' solvency confirmation and its basis before marking the dividend declared. Under Business Corporations Act s. 70 (2), a BC company may not declare or pay a dividend in money or property if there are reasonable grounds for believing it is insolvent, or that paying it would make the company insolvent."
        : "Record the directors' solvency confirmation and its basis before marking the dividend declared. Check the solvency test in the governing corporate statute.");
    }
  }
  if (status === "paid" && !validDateOnly(facts.paymentDate)) problems.push("Enter the payment date before marking the dividend paid.");
  return problems;
}

/** Class special-rights facts used for class-by-class warnings. */
export interface DividendClassFacts {
  id: string;
  className: string;
  /** Shared contract: `rightsClasses.dividendEntitlement` (absent = not recorded). */
  dividendEntitlement?: string;
}

function describeEntitlement(entitlement?: string): string {
  return entitlement === "fixed_rate" ? "a fixed-rate dividend"
    : entitlement === "cumulative_fixed" ? "a cumulative fixed dividend"
      : entitlement === "participating" ? "a participating dividend right"
        : "dividend rights";
}

/**
 * Non-blocking review warnings for a class-by-class declaration (one or more
 * classes deliberately excluded). A class whose recorded entitlement is not
 * discretionary by class may be entitled to share in, or be paid before, this
 * dividend; a class with no recorded entitlement needs the articles checked.
 */
export function classByClassWarnings(declared: DividendClassFacts | undefined, excluded: readonly DividendClassFacts[]): string[] {
  const warnings: string[] = [];
  for (const cls of excluded) {
    if (cls.dividendEntitlement && cls.dividendEntitlement !== "discretionary_by_class") {
      warnings.push(`${cls.className} is excluded, but its recorded special rights give it ${describeEntitlement(cls.dividendEntitlement)}. Check the articles before declaring on other classes only.`);
    } else if (!cls.dividendEntitlement) {
      warnings.push(`${cls.className} is excluded, but its dividend rights are not recorded. Check that the articles let the directors declare on some classes and not others.`);
    }
  }
  if (declared && excluded.length > 0 && declared.dividendEntitlement && declared.dividendEntitlement !== "discretionary_by_class") {
    warnings.push(`${declared.className} has ${describeEntitlement(declared.dividendEntitlement)} recorded. Check the rate and any priority the articles set.`);
  }
  return warnings;
}

/**
 * Caution shown for class-by-class dividends. Societyer never assesses tax:
 * this text names the rules that may apply and points to advice. It must never
 * state or imply a tax result.
 */
export const CLASS_BY_CLASS_TAX_CAUTION =
  "Class-by-class dividends paid to family members may be caught by the federal tax on split income (TOSI), which since 2018 also reaches many adult family members, and by the income attribution rules. Societyer does not assess tax. Get tax advice before declaring.";
