/**
 * Repeating tasks: the rule a task repeats by and the date arithmetic for its
 * next occurrence. Pure (no database, no clock unless passed in), shared by
 * the server, the in-browser workspace and the task form.
 *
 * Dates are calendar days ("YYYY-MM-DD"), computed in UTC so the result never
 * depends on the machine's time zone.
 */

export const TASK_RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type TaskRecurrenceFrequency = (typeof TASK_RECURRENCE_FREQUENCIES)[number];

/** The most a "Custom" rule may skip: every 365 days, weeks, months or years. */
export const MAX_TASK_RECURRENCE_INTERVAL = 365;

export type TaskRecurrence = {
  frequency: TaskRecurrenceFrequency;
  /** Every N days, weeks, months or years (1 = every one). */
  interval: number;
  /** Last day an occurrence may fall on ("YYYY-MM-DD"), inclusive. */
  until?: string;
  /**
   * Monthly and yearly rules: the day of the month the series is anchored to,
   * so 31 Jan → 28/29 Feb → 31 Mar instead of drifting to the 28th. Set by the
   * server from the due date; callers never need to send it.
   */
  anchorDay?: number;
};

/** What the next occurrence is scheduled from. `startDate` moves with the due date. */
export type TaskOccurrenceDates = { dueDate: string; startDate?: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

type Ymd = { year: number; month: number; day: number };

function parseDay(value: string): Ymd | null {
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** True for a real calendar day written "YYYY-MM-DD". */
export function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && parseDay(value) !== null;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDay(year: number, month: number, day: number) {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function dayNumber(value: string) {
  const parsed = parseDay(value);
  if (!parsed) throw new Error(`"${value}" is not a calendar day.`);
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day) / DAY_MS;
}

function fromDayNumber(days: number) {
  const date = new Date(days * DAY_MS);
  return formatDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** `value` moved by `days` calendar days. */
export function addIsoDays(value: string, days: number) {
  return fromDayNumber(dayNumber(value) + days);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function isoDaysBetween(from: string, to: string) {
  return dayNumber(to) - dayNumber(from);
}

/** The k-th occurrence after `due` (k ≥ 1), with month ends clamped to the anchor day. */
function occurrence(due: Ymd, dueDate: string, rule: TaskRecurrence, k: number) {
  const step = k * rule.interval;
  switch (rule.frequency) {
    case "daily":
      return addIsoDays(dueDate, step);
    case "weekly":
      return addIsoDays(dueDate, step * 7);
    case "monthly": {
      const index = due.year * 12 + (due.month - 1) + step;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      return formatDay(year, month, Math.min(rule.anchorDay ?? due.day, daysInMonth(year, month)));
    }
    case "yearly": {
      const year = due.year + step;
      return formatDay(year, due.month, Math.min(rule.anchorDay ?? due.day, daysInMonth(year, due.month)));
    }
  }
}

/** A loop guard far beyond any real series (daily for over a century). */
const MAX_STEPS = 50_000;

/**
 * The next occurrence of a repeating task, or null when the series has ended
 * (the next date falls after `until`).
 *
 * The next due date counts from the previous due date, never from the day the
 * task was completed, and is moved forward by whole steps until it is on or
 * after `today` (when given), so a task finished late does not come back
 * already overdue. A start date keeps the same distance before the due date.
 */
export function nextTaskOccurrence(
  dates: TaskOccurrenceDates,
  rule: TaskRecurrence,
  options: { today?: string } = {},
): TaskOccurrenceDates | null {
  const due = parseDay(dates.dueDate);
  if (!due) return null;
  const interval = validInterval(rule.interval) ? rule.interval : 1;
  const effective: TaskRecurrence = { ...rule, interval };
  const today = options.today && isIsoDay(options.today) ? options.today : undefined;
  let k = 1;
  let next = occurrence(due, dates.dueDate, effective, k);
  // Daily and weekly steps are uniform: jump straight to the first one not in the past.
  if (today && next < today && (rule.frequency === "daily" || rule.frequency === "weekly")) {
    const stepDays = interval * (rule.frequency === "weekly" ? 7 : 1);
    k = Math.max(1, Math.ceil(isoDaysBetween(dates.dueDate, today) / stepDays));
    next = occurrence(due, dates.dueDate, effective, k);
  }
  while (today && next < today) {
    k += 1;
    if (k > MAX_STEPS) return null;
    next = occurrence(due, dates.dueDate, effective, k);
  }
  if (rule.until && isIsoDay(rule.until) && next > rule.until) return null;
  const result: TaskOccurrenceDates = { dueDate: next };
  if (dates.startDate && isIsoDay(dates.startDate)) {
    result.startDate = addIsoDays(next, -isoDaysBetween(dates.startDate, dates.dueDate));
  }
  return result;
}

function validInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_TASK_RECURRENCE_INTERVAL;
}

export function isTaskRecurrenceFrequency(value: unknown): value is TaskRecurrenceFrequency {
  return typeof value === "string" && (TASK_RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}

export const TASK_RECURRENCE_NEEDS_DUE_DATE = "Add a due date before making this task repeat.";

/**
 * Validate a rule from a client and fill in the server-owned anchor day.
 * Throws a message fit for a toast. The anchor follows the due date: it is
 * kept when the due date and frequency are unchanged (so 28 Feb in a 31st
 * series stays a 31st series), and taken from the new due date otherwise.
 */
export function normalizeTaskRecurrence(
  input: unknown,
  dueDate: unknown,
  previous?: { recurrence?: unknown; dueDate?: unknown },
): TaskRecurrence {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose how often the task repeats.");
  const row = input as Record<string, unknown>;
  if (!isTaskRecurrenceFrequency(row.frequency)) throw new Error("Choose daily, weekly, monthly or yearly for the repeat.");
  const interval = row.interval === undefined ? 1 : row.interval;
  if (!validInterval(interval)) throw new Error(`Repeat every must be a whole number from 1 to ${MAX_TASK_RECURRENCE_INTERVAL}.`);
  if (!isIsoDay(dueDate)) throw new Error(TASK_RECURRENCE_NEEDS_DUE_DATE);
  const rule: TaskRecurrence = { frequency: row.frequency, interval };
  if (row.until !== undefined && row.until !== null && row.until !== "") {
    if (!isIsoDay(row.until)) throw new Error("The repeat end date is not a valid date.");
    if (row.until < dueDate) throw new Error("The repeat end date can't be before the due date.");
    rule.until = row.until;
  }
  if (rule.frequency === "monthly" || rule.frequency === "yearly") {
    const prior = previous?.recurrence as Partial<TaskRecurrence> | undefined;
    const keep = prior && prior.frequency === rule.frequency && previous?.dueDate === dueDate
      && typeof prior.anchorDay === "number" && prior.anchorDay >= 1 && prior.anchorDay <= 31;
    rule.anchorDay = keep ? prior.anchorDay : parseDay(dueDate)!.day;
  }
  return rule;
}

const UNIT: Record<TaskRecurrenceFrequency, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};
const SIMPLE: Record<TaskRecurrenceFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/** "Weekly", "Every 2 months", with ", until 2027-03-31" when the series ends. */
export function describeTaskRecurrence(rule: Pick<TaskRecurrence, "frequency" | "interval" | "until">, formatDate: (day: string) => string = (day) => day) {
  const [one, many] = UNIT[rule.frequency];
  const base = rule.interval > 1 ? `Every ${rule.interval} ${many}` : rule.interval === 1 ? SIMPLE[rule.frequency] : `Every ${one}`;
  return rule.until ? `${base}, until ${formatDate(rule.until)}` : base;
}
