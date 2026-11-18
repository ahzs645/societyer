/**
 * Time zones for a time someone types in ("2:00 p.m. Pacific"): the zones
 * offered first (Canada's), the viewer's own zone, short names ("PST",
 * "NDT"), wall-clock parts in a zone, and the absolute time with its offset
 * (`2026-11-18T14:00:00-08:00`). Intl only, so daylight time comes from the
 * runtime's own zone data.
 *
 * Pure module. A zone left out means the runtime's zone: the viewer's in a
 * browser, UTC on the server.
 */
import { zonedLocalToUtcISO } from "./meetingDateEdit";

export type TimeZoneChoice = {
  zone: string;
  /** "Pacific" */
  label: string;
  /** A city in the zone, for search and the menu hint. */
  place: string;
};

/** Offered first, west to east. */
export const CANADIAN_TIME_ZONES: readonly TimeZoneChoice[] = [
  { zone: "America/Vancouver", label: "Pacific", place: "Vancouver" },
  { zone: "America/Edmonton", label: "Mountain", place: "Edmonton" },
  { zone: "America/Winnipeg", label: "Central", place: "Winnipeg" },
  { zone: "America/Toronto", label: "Eastern", place: "Toronto" },
  { zone: "America/Halifax", label: "Atlantic", place: "Halifax" },
  { zone: "America/St_Johns", label: "Newfoundland", place: "St. John's" },
];

/** The runtime's IANA zone (the viewer's, in a browser). */
export function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** True for a zone this runtime knows ("America/Vancouver", "UTC"). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Every zone this runtime knows, for search; empty where Intl can't list them. */
export function allTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClockParts(at: number, timeZone?: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The day (`2026-11-18`) and time (`14:00`) on a clock in `timeZone` at an instant. */
export function wallClockInZone(at: number, timeZone?: string): { date: string; time: string; hour: number; minute: number } {
  const p = wallClockParts(at, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, hour: p.hour, minute: p.minute };
}

/** Minutes east of UTC in `timeZone` at an instant (-480 for PST). */
export function offsetMinutesAt(at: number, timeZone?: string): number {
  const p = wallClockParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

/** "PST", "NDT", or "GMT-7" where the zone has no common short name. */
export function timeZoneAbbreviation(timeZone: string | undefined, at: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, timeZoneName: "short" }).formatToParts(new Date(at));
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * The absolute time of a wall-clock day and time in `timeZone`, with its
 * offset: `2026-11-18T14:00:00-08:00`. A time that doesn't exist on that day
 * (the hour skipped when daylight time starts) moves to the time it becomes.
 */
export function zonedDateTimeISO(date: string, time: string, timeZone?: string): string | undefined {
  const utc = zonedLocalToUtcISO(date, time, timeZone);
  let at = utc ? Date.parse(utc) : Number.NaN;
  if (!Number.isFinite(at)) return undefined;
  // In the skipped hour the clock lands before the gap; step over it, as calendars do (2:30 → 3:30).
  const asked = Date.parse(`${date}T${time}:00Z`);
  const landed = wallClockParts(at, timeZone);
  const shortBy = asked - Date.UTC(landed.year, landed.month - 1, landed.day, landed.hour, landed.minute);
  if (shortBy > 0) at += shortBy;
  const clock = wallClockParts(at, timeZone);
  const offset = offsetMinutesAt(at, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
