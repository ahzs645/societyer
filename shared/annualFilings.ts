/**
 * Per-year, per-jurisdiction annual-filing ledger.
 *
 * Models the YCN `DB_GLOB_REG_FILING` record set: for each jurisdiction the
 * organization tracks whether the annual filing for a given year was made
 * (FILE_YN), the FILE_YEAR it applies to, and the FILE_DT_TM it was filed on.
 *
 * Years are bare year strings ("2023", "2024", ...) which sort lexicographically
 * (and numerically, being fixed-width), so plain string comparison suffices for
 * ordering and range tests. All functions are pure (no convex/react imports).
 */

export interface FilingRecord {
  jurisdiction: string;
  year: string;
  filed: boolean;
  filedOn?: string | null;
}

/**
 * The filing record for a specific jurisdiction and year, or null when no such
 * record exists. When multiple records match, a `filed=true` record is preferred
 * over an un-filed one; otherwise the last matching record wins.
 */
export function filingFor(
  records: FilingRecord[],
  jurisdiction: string,
  year: string,
): FilingRecord | null {
  let match: FilingRecord | null = null;
  for (const record of records) {
    if (record.jurisdiction !== jurisdiction || record.year !== year) {
      continue;
    }
    if (record.filed) {
      return record;
    }
    match = record;
  }
  return match;
}

/** Whether the annual filing for `jurisdiction`/`year` has been made. */
export function isFiledFor(
  records: FilingRecord[],
  jurisdiction: string,
  year: string,
): boolean {
  const record = filingFor(records, jurisdiction, year);
  return record != null && record.filed;
}

/**
 * Years in the inclusive range [`fromYear`, `toYear`] for which `jurisdiction`
 * has no `filed=true` record. Returned in ascending year order. When the range
 * is inverted (`fromYear` > `toYear`), no years are produced.
 */
export function outstandingYears(
  records: FilingRecord[],
  jurisdiction: string,
  fromYear: string,
  toYear: string,
): string[] {
  const from = Number(fromYear);
  const to = Number(toYear);
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return [];
  }
  const outstanding: string[] = [];
  for (let year = from; year <= to; year += 1) {
    const yearStr = String(year);
    if (!isFiledFor(records, jurisdiction, yearStr)) {
      outstanding.push(yearStr);
    }
  }
  return outstanding;
}

/** All records for `jurisdiction`, sorted ascending by year. */
export function filingHistory(
  records: FilingRecord[],
  jurisdiction: string,
): FilingRecord[] {
  return records
    .filter((record) => record.jurisdiction === jurisdiction)
    .slice()
    .sort((left, right) => left.year.localeCompare(right.year));
}

/** Distinct jurisdictions appearing in the records, in first-seen order. */
export function jurisdictionsTracked(records: FilingRecord[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const record of records) {
    if (!seen.has(record.jurisdiction)) {
      seen.add(record.jurisdiction);
      result.push(record.jurisdiction);
    }
  }
  return result;
}

/** Annual return/report record kinds from the jurisdiction workspace catalog. */
export const ANNUAL_FILING_KINDS = ["AnnualReport", "BCSocietyAnnualReport", "BCExtraProvincialAnnualReport", "BCCompanyAnnualReport", "FederalAnnualReturn", "OntarioAnnualReturn"] as const;
export function annualFilingKind(kind: string) { return (ANNUAL_FILING_KINDS as readonly string[]).includes(kind); }

/**
 * The filing year a detailed filing's period label names (G-27): "2025" ->
 * "2025", "2025 AGM" -> "2025", "FY2025-2026" / "2025-26" -> the year the period
 * ends ("2026"). Returns null when no four-digit year is present.
 */
export function annualFilingYear(periodLabel: unknown): string | null {
  const text = String(periodLabel ?? "").trim();
  if (/^[1-9]\d{3}$/.test(text)) return text;
  const range = /([1-9]\d{3})\s*[-/–]\s*(\d{2}|[1-9]\d{3})\b/.exec(text);
  if (range) {
    const end = range[2].length === 2 ? `${range[1].slice(0, 2)}${range[2]}` : range[2];
    return Number(end) > Number(range[1]) ? end : range[1];
  }
  const single = text.match(/\b[1-9]\d{3}\b|(?<=FY)[1-9]\d{3}/g);
  return single?.length === 1 ? single[0] : null;
}
