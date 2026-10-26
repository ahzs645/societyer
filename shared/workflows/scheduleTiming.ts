/**
 * The hosted workflow scanner checks due work every fifteen minutes. These
 * helpers select the next configured UTC occurrence; the scanner coalesces
 * missed occurrences instead of replaying an unbounded backlog.
 *
 * Calendar/monthly and date-offset triggers need their own reviewed execution
 * semantics. Reject them rather than replacing them with an arbitrary delay.
 */
type Trigger = { kind?: unknown; cron?: unknown } | null | undefined;
type CronSchedule = { minutes: number[]; hours: number[]; weekdays: Set<number> };

const UNSUPPORTED_CALENDAR = "Automatic schedules currently support daily or weekly UTC cron expressions with * in the day-of-month and month fields. Monthly and date-offset schedules require a separate reviewed executor.";

function parseField(text: string, min: number, max: number, label: string): number[] {
  const values = new Set<number>();
  const pieces = text.split(",");
  if (pieces.length > 64) throw new Error(`The ${label} field has too many entries.`);
  for (const piece of pieces) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(piece);
    if (!match) throw new Error(`Use numbers, *, lists, ranges or steps in the ${label} field.`);
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isSafeInteger(step) || step < 1 || step > max - min + 1) {
      throw new Error(`The ${label} step is outside the supported range.`);
    }
    let start: number;
    let end: number;
    if (match[1] === "*") {
      start = min;
      end = max;
    } else {
      const bounds = match[1].split("-").map(Number);
      start = bounds[0];
      // A stepped single number means that number through the end of the field.
      end = bounds[1] ?? (match[2] === undefined ? start : max);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max || start > end) {
      throw new Error(`The ${label} field must be between ${min} and ${max}, with ascending ranges.`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error(`The ${label} field is empty.`);
  return [...values].sort((a, b) => a - b);
}

function parseSchedule(trigger: Trigger): CronSchedule {
  if (trigger?.kind !== "cron") {
    throw new Error(trigger?.kind === "manual"
      ? "This workflow uses a manual trigger. Set a daily or weekly UTC schedule before authorizing automatic runs."
      : UNSUPPORTED_CALENDAR);
  }
  if (typeof trigger.cron !== "string" || trigger.cron.length > 256) {
    throw new Error("Enter a five-field UTC cron expression.");
  }
  const fields = trigger.cron.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some(field => field.length === 0)) {
    throw new Error("Enter a five-field UTC cron expression.");
  }
  if (fields[2] !== "*" || fields[3] !== "*") throw new Error(UNSUPPORTED_CALENDAR);
  const minutes = parseField(fields[0], 0, 59, "minute");
  const hours = parseField(fields[1], 0, 23, "hour");
  const weekdays = new Set(parseField(fields[4], 0, 7, "weekday").map(day => day === 7 ? 0 : day));
  return { minutes, hours, weekdays };
}

export function scheduledTriggerSupport(trigger: Trigger): { supported: boolean; reason?: string } {
  try {
    parseSchedule(trigger);
    return { supported: true };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : "This schedule is not supported." };
  }
}

/** Strictly after fromMs, independent of the browser or server timezone. */
export function nextScheduledRunAt(trigger: Trigger, fromMs: number): string {
  if (!Number.isFinite(fromMs)) throw new Error("A valid schedule reference time is required.");
  const reference = new Date(fromMs);
  if (!Number.isFinite(reference.getTime())) throw new Error("A valid schedule reference time is required.");
  const schedule = parseSchedule(trigger);
  const day = new Date(reference);
  day.setUTCHours(0, 0, 0, 0);
  // Daily/weekly support guarantees a next occurrence within eight UTC days.
  for (let offset = 0; offset < 8; offset += 1) {
    if (schedule.weekdays.has(day.getUTCDay())) {
      for (const hour of schedule.hours) {
        for (const minute of schedule.minutes) {
          const candidate = new Date(day);
          candidate.setUTCHours(hour, minute, 0, 0);
          if (candidate.getTime() > fromMs) return candidate.toISOString();
        }
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  throw new Error("No future occurrence was found for this schedule.");
}
