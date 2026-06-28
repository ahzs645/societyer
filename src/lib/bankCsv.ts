// Pure parser for bank / credit-card statement CSV exports. Kept dependency-free
// and side-effect-free so it can be unit-tested in plain Node (test:bank-csv).

export type ParsedCsvRow = { date: string; description: string; amountCents: number };

/** Split a single CSV line into fields, honoring double-quoted fields that may
 *  contain commas and escaped quotes (""). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse a money string to integer cents. Handles currency symbols, thousands
 *  separators, parenthesised negatives, and leading-minus negatives. Returns
 *  null when the value isn't a number. */
export function toCents(raw: string): number | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) negative = true;
  s = s.replace(/[^0-9.]/g, "");
  if (s === "" || s === ".") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  const cents = Math.round(n * 100);
  return negative ? -Math.abs(cents) : cents;
}

/** Normalize a date string to YYYY-MM-DD when parseable; otherwise pass through. */
export function normalizeDate(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toISOString().slice(0, 10);
}

/** Parse a bank/credit-card CSV export. Auto-detects date, description, and
 *  amount columns by header name; supports a single signed amount column or
 *  separate debit/credit columns. Throws if no date column is present. */
export function parseBankCsv(text: string): ParsedCsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (...needles: string[]) =>
    header.findIndex((h) => needles.some((n) => h.includes(n)));
  const dateIdx = find("date");
  const descIdx = find("description", "memo", "payee", "name", "details", "narrative");
  const amountIdx = find("amount", "value");
  const debitIdx = find("debit", "withdrawal", "money out");
  const creditIdx = find("credit", "deposit", "money in");
  if (dateIdx < 0) throw new Error("CSV needs a date column.");

  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const date = normalizeDate(cols[dateIdx] ?? "");
    const description = (descIdx >= 0 ? cols[descIdx] : "") || "Imported transaction";
    let amountCents: number | null = null;
    if (amountIdx >= 0) {
      amountCents = toCents(cols[amountIdx] ?? "");
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      const credit = creditIdx >= 0 ? toCents(cols[creditIdx] ?? "") ?? 0 : 0;
      const debit = debitIdx >= 0 ? toCents(cols[debitIdx] ?? "") ?? 0 : 0;
      amountCents = Math.abs(credit) - Math.abs(debit);
    }
    if (!date || amountCents == null) continue;
    rows.push({ date, description, amountCents });
  }
  return rows;
}
