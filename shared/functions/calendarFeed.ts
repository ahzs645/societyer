/** Portable database handlers for configuring the outbound calendar feed. */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";

export async function getFeedTokenPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("societies not found.");
  return society.calendarFeedToken ?? null;
}

export async function setFeedTokenPortable(
  ctx: PortableMutationCtx,
  { societyId, token }: { societyId: string; token: string | null },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("societies not found.");
  await ctx.db.patch(societyId, { calendarFeedToken: token ?? undefined });
  return token;
}
