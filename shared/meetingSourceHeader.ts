/** Helpers for the source header shown in "Edit meeting". Pure module. */

/**
 * The parsed source location sometimes runs on into the next header lines
 * ("ZoomSubject: Meeting MinutesZoom: Link"); keep only the place itself.
 */
export function cleanSourceLocation(text: unknown): string {
  const raw = String(text ?? "").replace(/\t/g, " ");
  const cut = raw.search(/(?:Subject|Date|Time|Present|Regrets|Attendees|Zoom|Teams|Link|Minutes|Chair)\s*:/i);
  const kept = cut > 0 ? raw.slice(0, cut) : raw;
  return kept.replace(/\s+/g, " ").trim().replace(/[,;·|]+$/, "").trim() || raw.replace(/\s+/g, " ").trim();
}
