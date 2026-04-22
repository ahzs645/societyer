import type { ToneVariant } from "../../../components/ui";

export const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "pending", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "withdrawn", label: "Withdrawn" },
];

export const SYNC_OPTIONS = [
  { value: "online", label: "Online only" },
  { value: "synced", label: "Synced copy" },
  { value: "offline", label: "Offline copy" },
  { value: "unavailable", label: "Unavailable offline" },
];

export const ACCESS_GRANT_TYPES = [
  { value: "attendee", label: "Attendee" },
  { value: "member", label: "Member" },
  { value: "director", label: "Director" },
  { value: "user", label: "Workspace user" },
  { value: "committee", label: "Committee" },
  { value: "group", label: "Named group" },
];

export const ACCESS_GRANT_LEVELS = [
  { value: "view", label: "Can view" },
  { value: "comment", label: "Can comment" },
  { value: "sign", label: "Can sign" },
  { value: "manage", label: "Can manage" },
];

export function materialEffectiveStatus(material: any): string {
  if (!material) return "available";
  if (material.availabilityStatus === "withdrawn") return "withdrawn";
  if (isMaterialExpired(material)) return "expired";
  return material.availabilityStatus ?? "available";
}

export function isMaterialExpired(material: any) {
  if (!material?.expiresAtISO) return false;
  const expires = new Date(material.expiresAtISO).getTime();
  if (!Number.isFinite(expires)) return false;
  return expires < Date.now();
}

export function getPackageReadiness(materials: any[]) {
  const total = materials.length;
  const ready = materials.filter((material) => !materialNeedsAttention(material)).length;
  const withGrants = materials.filter((material) => (material.accessGrants ?? []).length > 0).length;
  return {
    total,
    ready,
    needsAttention: total - ready,
    withGrants,
  };
}

export function materialNeedsAttention(material: any) {
  const status = materialEffectiveStatus(material);
  return status === "pending" || status === "expired" || status === "withdrawn";
}

export function availabilityLabel(status: string) {
  return AVAILABILITY_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function availabilityTone(status: string): ToneVariant {
  if (status === "available") return "success";
  if (status === "pending") return "warn";
  if (status === "expired" || status === "withdrawn") return "danger";
  return "neutral";
}

export function syncLabel(status: string) {
  return SYNC_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function syncTone(status: string): ToneVariant {
  if (status === "synced" || status === "offline") return "info";
  if (status === "unavailable") return "warn";
  return "neutral";
}

export function accessLevelLabel(value: string | undefined) {
  if (!value) return "Board";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function materialAccessSummary(material: any) {
  const grants = material.accessGrants ?? [];
  if (!grants.length) return `Access: ${accessLevelLabel(material.accessLevel)}`;
  const labels = grants.slice(0, 3).map((grant: any) => `${grant.subjectLabel} (${accessGrantLabel(grant.access)})`);
  const extra = grants.length > labels.length ? ` +${grants.length - labels.length} more` : "";
  return `Access: ${accessLevelLabel(material.accessLevel)} plus ${labels.join(", ")}${extra}`;
}

export function grantKey(grant: any) {
  return `${grant.subjectType}:${grant.subjectId || normalizeGrantName(grant.subjectLabel ?? "")}:${grant.access ?? "view"}`;
}

export function grantTypeLabel(value: string) {
  return ACCESS_GRANT_TYPES.find((option) => option.value === value)?.label ?? value;
}

export function accessGrantLabel(value: string) {
  return ACCESS_GRANT_LEVELS.find((option) => option.value === value)?.label ?? value;
}

export function buildAccessGrantCandidates(
  subjectType: string,
  data: {
    meeting: any;
    minutes: any;
    users: any[] | undefined;
    members: any[] | undefined;
    directors: any[] | undefined;
    committees: any[] | undefined;
  },
) {
  if (subjectType === "attendee") {
    const attendeeNames = [
      ...(data.minutes?.attendees ?? []),
      ...(data.meeting?.attendeeIds ?? []).map((id: string) => personLabelForId(id, data)),
    ].filter(Boolean);
    return uniqueGrantCandidates(attendeeNames.map((name: string) => ({ id: normalizeGrantName(name), label: name })));
  }
  if (subjectType === "member") {
    return (data.members ?? []).map((member: any) => ({ id: String(member._id), label: `${member.firstName} ${member.lastName}`.trim() }));
  }
  if (subjectType === "director") {
    return (data.directors ?? []).map((director: any) => ({
      id: String(director._id),
      label: `${director.firstName} ${director.lastName}${director.position ? `, ${director.position}` : ""}`,
    }));
  }
  if (subjectType === "user") {
    return (data.users ?? []).map((user: any) => ({ id: String(user._id), label: `${user.displayName} (${user.role})` }));
  }
  if (subjectType === "committee") {
    return (data.committees ?? []).map((committee: any) => ({ id: String(committee._id), label: committee.name }));
  }
  return [];
}

function personLabelForId(id: string, data: { users?: any[]; members?: any[]; directors?: any[] }) {
  const director = (data.directors ?? []).find((row: any) => String(row._id) === String(id));
  if (director) return `${director.firstName} ${director.lastName}`.trim();
  const member = (data.members ?? []).find((row: any) => String(row._id) === String(id));
  if (member) return `${member.firstName} ${member.lastName}`.trim();
  const user = (data.users ?? []).find((row: any) => String(row._id) === String(id));
  if (user) return user.displayName;
  return id;
}

function uniqueGrantCandidates(candidates: Array<{ id: string; label: string }>) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeGrantName(candidate.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeGrantName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
