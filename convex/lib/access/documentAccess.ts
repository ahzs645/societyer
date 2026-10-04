import { toPortableQueryCtx } from "../portable";
import { requireSocietyMembership } from "../../../shared/functions/access";
import type { AccessSubjectContext } from "./materialAccess";
export { canAccessDocument } from "../../../shared/functions/documents";
import { committeeAppointmentIsActive } from "../../../shared/functions/documents";

export function documentAccessContextFromUser(user: any, committeeIds: string[] = []): AccessSubjectContext {
  return {
    userId: user?._id ? String(user._id) : undefined,
    userRole: user?.role,
    memberId: user?.memberId ? String(user.memberId) : undefined,
    directorId: user?.directorId ? String(user.directorId) : undefined,
    committeeIds,
  };
}

export async function documentAccessContextForActor(
  ctx: any,
  societyId: any,
  actingUserId?: any,
): Promise<AccessSubjectContext | null> {
  const user = await requireSocietyMembership(await toPortableQueryCtx(ctx), String(societyId));
  if (actingUserId && String(actingUserId) !== String(user._id)) throw new Error("Authenticated actor does not match the current principal.");

  const committeeRows = await ctx.db
    .query("committeeMembers")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  const committeeIds = committeeRows
    .filter((row: any) =>
      committeeAppointmentIsActive(row) && (
        (user.memberId && String(row.memberId ?? "") === String(user.memberId)) ||
        (user.directorId && String(row.directorId ?? "") === String(user.directorId))
      ),
    )
    .map((row: any) => String(row.committeeId));

  return documentAccessContextFromUser(user, Array.from(new Set(committeeIds)));
}
