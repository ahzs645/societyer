import { canAccessMeetingMaterial } from "./materialAccess";
import type { AccessSubjectContext } from "./materialAccess";

export function canAccessDocument(
  document: any,
  linkedMaterials: any[],
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  if (!document) return false;
  if (context.userRole === "Owner" || context.userRole === "Admin") return true;
  if (document.archivedAtISO || document.flaggedForDeletion) return false;

  const materialLinks = linkedMaterials.filter(
    (material) => String(material.documentId) === String(document._id),
  );
  if (materialLinks.length > 0) {
    return materialLinks.some((material) =>
      canAccessMeetingMaterial(material, context, requiredAccess),
    );
  }

  if (document.tags?.includes("public") || document.librarySection === "public") return true;
  if (document.committeeId && (context.committeeIds ?? []).map(String).includes(String(document.committeeId))) return true;
  if (document.category === "Policy" || document.category === "Bylaws" || document.category === "Constitution") {
    return !!context.memberId || roleAtLeast(context.userRole, "Member");
  }
  return roleAtLeast(context.userRole, "Director");
}

export function documentAccessContextFromUser(user: any, committeeIds: string[] = []): AccessSubjectContext {
  return {
    userId: user?._id ? String(user._id) : undefined,
    userRole: user?.role,
    memberId: user?.memberId ? String(user.memberId) : undefined,
    directorId: user?.directorId ? String(user.directorId) : undefined,
    committeeIds,
  };
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
