// Dividend-declaration math (YCN DB_GLOB_DIVIDEND idea; corporations track).
// Pure logic, framework-free. Money is represented in integer CENTS.

export interface DividendDeclaration {
  id?: string;
  declaredOn: string /* ISO */;
  shareClass: string;
  perShareCents: number;
  sharesOutstanding: number;
  currency: string;
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

/**
 * Sum of totalCents per shareClass across the given declarations.
 */
export function totalDeclaredByClass(decls: DividendDeclaration[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const d of decls) {
    const { totalCents } = computeDividend(d);
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
    const { totalCents } = computeDividend(d);
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
