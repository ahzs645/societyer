import { STATIC_DEMO_SOCIETY_ID } from "./staticIds";

/**
 * Pick the organization a restore should open. A device backup also carries
 * the bundled demo organization, and backup table order puts it first, so the
 * first row is the wrong default: it reopened "Riverside Community Society"
 * instead of the restored organization (O-1).
 */
export function preferredRestoredSocietyId(snapshot: any): string | null {
  const ids = ((snapshot?.tables?.societies ?? []) as Array<Record<string, any>>)
    .map((row) => (typeof row?._id === "string" ? row._id : null))
    .filter((id): id is string => Boolean(id));
  const active = typeof snapshot?.activeSocietyId === "string" ? snapshot.activeSocietyId : null;
  if (active && ids.includes(active)) return active;
  return ids.find((id) => id !== STATIC_DEMO_SOCIETY_ID) ?? ids[0] ?? null;
}
