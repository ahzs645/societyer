// Pure logic for share subdivision / consolidation (YCN Doc - Share Split).
// A SplitRatio expresses how each existing share is transformed:
//   { numerator: 2, denominator: 1 } => 2-for-1 subdivision (each share becomes 2).
//   { numerator: 1, denominator: 3 } => 1-for-3 consolidation (3 shares become 1).
// Framework-free: no convex / react imports. Named exports only.

export interface SplitRatio {
  numerator: number;
  denominator: number;
}

export interface RatioValidation {
  ok: boolean;
  errors: string[];
}

export interface HoldingShare {
  holderName: string;
  shares: number;
}

/**
 * Apply a split ratio to a single share count.
 * Uses Math.floor so consolidations never create fractional shares.
 */
export function applyRatio(shares: number, ratio: SplitRatio): number {
  return Math.floor((shares * ratio.numerator) / ratio.denominator);
}

/**
 * Apply a split ratio across a list of holdings, returning new share counts.
 * Holder names are preserved; only the share counts change.
 */
export function applyRatioToHoldings(
  holdings: Array<HoldingShare>,
  ratio: SplitRatio,
): Array<HoldingShare> {
  return holdings.map((holding) => ({
    holderName: holding.holderName,
    shares: applyRatio(holding.shares, ratio),
  }));
}

/**
 * Human-readable description of the ratio.
 *   numerator > denominator => "<num>-for-<den> subdivision"
 *   numerator < denominator => "<num>-for-<den> consolidation"
 *   numerator === denominator => "no change"
 */
export function describeRatio(ratio: SplitRatio): string {
  if (ratio.numerator === ratio.denominator) {
    return "no change";
  }
  const kind = ratio.numerator > ratio.denominator ? "subdivision" : "consolidation";
  return `${ratio.numerator}-for-${ratio.denominator} ${kind}`;
}

/**
 * Validate a split ratio. Both parts must be positive integers.
 * A 1/1 (no-op) ratio is rejected unless allowOneToOne is set.
 */
export function validateRatio(
  ratio: SplitRatio,
  options: { allowOneToOne?: boolean } = {},
): RatioValidation {
  const errors: string[] = [];

  if (!isPositiveInteger(ratio.numerator)) {
    errors.push("numerator must be a positive integer.");
  }
  if (!isPositiveInteger(ratio.denominator)) {
    errors.push("denominator must be a positive integer.");
  }

  if (
    errors.length === 0 &&
    !options.allowOneToOne &&
    ratio.numerator === ratio.denominator
  ) {
    errors.push("ratio of 1-for-1 has no effect.");
  }

  return { ok: errors.length === 0, errors };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
