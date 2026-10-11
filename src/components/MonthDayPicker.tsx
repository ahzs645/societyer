import { Select } from "./Select";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Longest each month runs (Feb 29 allowed — a leap-year fiscal end is legitimate). */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseMonthDay(value: string | null | undefined): { month: number; day: number } | null {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return { month, day };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "03-31" → "Mar 31". Unparseable values are shown as stored. */
export function formatMonthDay(value: string | null | undefined): string {
  const parsed = parseMonthDay(value);
  if (!parsed) return String(value ?? "");
  return `${MONTHS[parsed.month - 1]} ${parsed.day}`;
}

/**
 * A recurring calendar day without a year (e.g. fiscal year end), picked as
 * month + day and stored in the existing "MM-DD" form.
 */
export function MonthDayPicker({
  value,
  onChange,
  disabled,
  ariaLabel = "Date",
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const parsed = parseMonthDay(value);
  // Read-only: show the date the way it's read ("Mar 31"), like other locked fields.
  if (disabled) {
    return <input className="input" aria-label={ariaLabel} disabled value={value ? formatMonthDay(value) : ""} placeholder="Not set" />;
  }
  const month = parsed?.month ?? 0;
  const day = parsed?.day ?? 0;
  const maxDay = month ? DAYS_IN_MONTH[month - 1] : 31;
  const setMonth = (next: number) => {
    if (!next) return onChange("");
    // Keep the chosen day when it exists in the new month; otherwise use its last day
    // (fiscal years usually end on a month end).
    const nextDay = Math.min(day || DAYS_IN_MONTH[next - 1], DAYS_IN_MONTH[next - 1]);
    onChange(`${pad(next)}-${pad(nextDay)}`);
  };
  return (
    <div className="month-day-picker">
      <Select
        aria-label={`${ariaLabel} month`}
        className="month-day-picker__month"
        value={month ? String(month) : ""}
        placeholder="Month"
        clearable
        clearLabel="Not set"
        onChange={(next) => setMonth(Number(next) || 0)}
        options={MONTHS.map((label, index) => ({ value: String(index + 1), label }))}
      />
      <Select
        aria-label={`${ariaLabel} day`}
        className="month-day-picker__day"
        disabled={!month}
        value={day ? String(day) : ""}
        placeholder="Day"
        onChange={(next) => month && onChange(`${pad(month)}-${pad(Number(next))}`)}
        options={Array.from({ length: maxDay }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
      />
    </div>
  );
}
