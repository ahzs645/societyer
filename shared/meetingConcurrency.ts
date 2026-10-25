/**
 * Compare the values an editor opened against the values in its transaction.
 * Convex serializes writes, but a later write can still contain an older whole
 * array from another tab. Field checks reject that stale edit while allowing
 * two people to update unrelated fields. Optional fields travel as null.
 */
export type MeetingExpectedFields = Record<string, unknown>;
export type MeetingAgendaSnapshot = {
  agenda: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
} | null;

function comparable(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("The original values for this edit must contain only plain JSON values.");
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, comparable(entry)]));
  }
  if (!["string", "number", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) {
    throw new Error("The original values for this edit must contain only plain JSON values.");
  }
  return value;
}

export function meetingFieldValuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/** Capture a detached, wire-safe baseline when an editor opens. */
export function meetingExpectedFields(record: Record<string, unknown>, fields: readonly string[]): MeetingExpectedFields {
  return Object.fromEntries(fields.map((field) => [field, comparable(record[field])]));
}

/** Agenda items can change without changing their header's updatedAtISO. */
export function meetingAgendaSnapshot(value: MeetingAgendaSnapshot | undefined): MeetingAgendaSnapshot {
  return comparable(value ?? null) as MeetingAgendaSnapshot;
}

export function assertMeetingFieldsUnchanged(
  current: Record<string, unknown>,
  expected: MeetingExpectedFields | undefined,
  label: string,
): void {
  if (expected === undefined) return; // Older clients and internal domain calls.
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error("The original values for this edit are invalid. Reload and try again.");
  }
  for (const [field, value] of Object.entries(expected)) {
    if (!meetingFieldValuesMatch(current[field], value)) {
      throw new Error(`This ${label} changed while you were editing. Your changes have not been saved. Reload the latest version and apply your changes again.`);
    }
  }
}
