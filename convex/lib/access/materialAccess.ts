const ACCESS_RANK: Record<string, number> = {
  view: 10,
  comment: 20,
  sign: 30,
  manage: 40,
};

export type AccessSubjectContext = {
  userId?: string | null;
  userRole?: string | null;
  memberId?: string | null;
  directorId?: string | null;
  committeeIds?: string[];
  attendeeNames?: string[];
  groups?: string[];
};

export function normalizeAccessGrants(grants: any[] | undefined) {
  if (!Array.isArray(grants)) return [];
  return grants
    .map((grant) => ({
      subjectType: String(grant.subjectType ?? "").trim(),
      subjectId: grant.subjectId ? String(grant.subjectId).trim() : undefined,
      subjectLabel: String(grant.subjectLabel ?? "").trim(),
      access: String(grant.access ?? "view").trim() || "view",
      note: grant.note ? String(grant.note).trim() : undefined,
    }))
    .filter((grant) => grant.subjectType && grant.subjectLabel);
}

export function materialEffectiveStatus(material: any, nowMs = Date.now()): string {
  if (!material) return "available";
  if (material.availabilityStatus === "withdrawn") return "withdrawn";
  if (isMaterialExpired(material, nowMs)) return "expired";
  return material.availabilityStatus ?? "available";
}

export function isMaterialExpired(material: any, nowMs = Date.now()) {
  if (!material?.expiresAtISO) return false;
  const expires = new Date(material.expiresAtISO).getTime();
  return Number.isFinite(expires) && expires < nowMs;
}

export function materialNeedsAttention(material: any, nowMs = Date.now()) {
  const status = materialEffectiveStatus(material, nowMs);
  return status === "pending" || status === "expired" || status === "withdrawn";
}

export function summarizeMeetingMaterials(materials: any[], nowMs = Date.now()) {
  const total = materials.length;
  const ready = materials.filter((material) => !materialNeedsAttention(material, nowMs)).length;
  return {
    total,
    ready,
    needsAttention: total - ready,
    expired: materials.filter((material) => materialEffectiveStatus(material, nowMs) === "expired").length,
    restricted: materials.filter((material) => material.accessLevel === "restricted").length,
    withExplicitGrants: materials.filter((material) => (material.accessGrants ?? []).length > 0).length,
  };
}

export function canAccessMeetingMaterial(
  material: any,
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  if (!material || materialEffectiveStatus(material) === "withdrawn") return false;
  if (roleCanBypass(context.userRole)) return true;
  if (hasExplicitGrant(material, context, requiredAccess)) return true;
  return broadAccessAllows(material.accessLevel, context);
}

export function hasExplicitGrant(
  material: any,
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  const requiredRank = ACCESS_RANK[requiredAccess] ?? ACCESS_RANK.view;
  return normalizeAccessGrants(material?.accessGrants).some((grant) => {
    const grantRank = ACCESS_RANK[grant.access] ?? ACCESS_RANK.view;
    return grantRank >= requiredRank && grantMatchesContext(grant, context);
  });
}

function grantMatchesContext(grant: any, context: AccessSubjectContext) {
  const subjectId = grant.subjectId ? String(grant.subjectId) : "";
  const subjectLabel = normalizeLabel(grant.subjectLabel);
  if (grant.subjectType === "user") return !!subjectId && subjectId === String(context.userId ?? "");
  if (grant.subjectType === "member") return !!subjectId && subjectId === String(context.memberId ?? "");
  if (grant.subjectType === "director") return !!subjectId && subjectId === String(context.directorId ?? "");
  if (grant.subjectType === "committee") return !!subjectId && (context.committeeIds ?? []).map(String).includes(subjectId);
  if (grant.subjectType === "attendee") {
    return (context.attendeeNames ?? []).some((name) => normalizeLabel(name) === subjectLabel);
  }
  if (grant.subjectType === "group") {
    return (context.groups ?? []).some((name) => normalizeLabel(name) === subjectLabel);
  }
  return false;
}

function broadAccessAllows(accessLevel: string | undefined, context: AccessSubjectContext) {
  if (accessLevel === "public") return true;
  if (accessLevel === "members") return !!context.memberId || roleAtLeast(context.userRole, "Member");
  if (accessLevel === "committee") return (context.committeeIds ?? []).length > 0 || roleAtLeast(context.userRole, "Director");
  if (accessLevel === "board") return !!context.directorId || roleAtLeast(context.userRole, "Director");
  if (accessLevel === "restricted") return false;
  return roleAtLeast(context.userRole, "Director");
}

function roleCanBypass(role: string | null | undefined) {
  return role === "Owner" || role === "Admin";
}

function roleAtLeast(role: string | null | undefined, required: "Viewer" | "Member" | "Director" | "Admin" | "Owner") {
  const ranks: Record<string, number> = {
    Viewer: 20,
    Member: 40,
    Director: 60,
    Admin: 80,
    Owner: 100,
  };
  return (ranks[role ?? ""] ?? 0) >= ranks[required];
}

function normalizeLabel(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
