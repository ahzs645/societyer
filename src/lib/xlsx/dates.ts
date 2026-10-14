/**
 * Excel date serials (1900 date system, the default everywhere).
 *
 * Serial 1 is 1900-01-01. Excel inherited Lotus 1-2-3's bug of treating 1900
 * as a leap year, so serial 60 is the non-existent 1900-02-29 and every date
 * from 1900-03-01 on is one higher than a plain day count. Dates before 1900
 * have no serial and are written as text instead.
 */

const MS_PER_DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 31); // serial 0 ("1900-01-00")
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Serial for a calendar day, or null when it is invalid or before 1900. */
export function excelDateSerial(year: number, month: number, day: number): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 9999) return null;
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const days = Math.round((time - EPOCH) / MS_PER_DAY);
  if (days < 1) return null;
  return days >= 60 ? days + 1 : days;
}

/** Serial for "YYYY-MM-DD" (anything after the date part is ignored) or a Date's local calendar day. */
export function excelSerialForDate(value: string | Date): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return excelDateSerial(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  return excelDateSerial(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Serial with a time fraction for a moment, written as the viewer's local
 * wall-clock time (spreadsheets have no time zones). Accepts a Date, epoch
 * milliseconds, a date-only string (midnight) or any string Date.parse reads.
 */
export function excelSerialForDateTime(value: string | number | Date): number | null {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return excelSerialForDate(text);
    date = new Date(Date.parse(text));
  }
  if (Number.isNaN(date.getTime())) return null;
  const day = excelDateSerial(date.getFullYear(), date.getMonth() + 1, date.getDate());
  if (day == null) return null;
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
  return day + seconds / 86_400;
}
