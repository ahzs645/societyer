/** Minimal RFC-4180 CSV parser. Handles quoted fields, doubled quotes,
 * CRLF/LF row terminators. Returns rows as arrays of strings. */
const CSV_DANGEROUS_PREFIX = /^[=+\-@\t\r]/;
const CSV_INJECTION_PREFIX = "\u200c";

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // swallow, handled on \n
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return CSV_DANGEROUS_PREFIX.test(text) ? `${CSV_INJECTION_PREFIX}${text}` : text;
}

export function cleanCsvCell(value: string): string {
  return value.startsWith(CSV_INJECTION_PREFIX) ? value.slice(CSV_INJECTION_PREFIX.length) : value;
}

export function escapeCsvCell(value: unknown): string {
  const text = sanitizeCsvCell(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}
