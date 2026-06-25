/**
 * ANNUAL CONSENT RESOLUTION CONTEXT (pure logic).
 *
 * Derives the data the annual consent's operative clauses need (YCN
 * "Doc - Annual"): whether financial-statement preparation is waived, the next
 * fiscal year-end, and the director slate. The packet body (corporation
 * `annual-resolutions`) renders the six real resolutions off these tokens via
 * the template engine. Framework-free.
 */

import type { Actor } from "./nlg";

export interface AnnualResolutionInput {
  /** YCN Corporation_Settings WAIVE_PREP_FINANCIALS: waive FS prep + auditor. */
  waivePrepFinancials?: boolean | null;
  /** The next fiscal year-end to fix (display string). */
  fiscalYearEnd?: string | null;
  /** Current directors to appoint "until successors are elected or appointed". */
  directors?: Actor[];
}

export interface AnnualResolutionContext {
  waivePrepFinancials: boolean;
  hasFiscalYearEnd: boolean;
  fiscalYearEnd: string;
  hasDirectors: boolean;
  /** Director names joined for the appointment clause. */
  directorSlate: string;
}

export function buildAnnualResolutionContext(input: AnnualResolutionInput): AnnualResolutionContext {
  const names = (input.directors ?? [])
    .map((d) => String(d.name ?? "").trim())
    .filter((n) => n.length > 0);
  const fiscalYearEnd = typeof input.fiscalYearEnd === "string" ? input.fiscalYearEnd.trim() : "";
  return {
    waivePrepFinancials: Boolean(input.waivePrepFinancials),
    hasFiscalYearEnd: fiscalYearEnd.length > 0,
    fiscalYearEnd,
    hasDirectors: names.length > 0,
    directorSlate: names.join("; "),
  };
}
