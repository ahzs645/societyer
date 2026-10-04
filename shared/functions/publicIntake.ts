/** Narrow public application authority, separate from protected roster access. */
import type { PortableMutationCtx } from "../portable/ctx";
import { assertMembershipStatus, requireSocietyMembership, resolvePrincipalUser } from "./access";
import { MODULES_BY_KEY, normalizeModuleSettings } from "../../src/lib/modules";

export async function authorizeApplicationIntake(
  ctx: PortableMutationCtx,
  societyId: string,
  key: "volunteers" | "grants",
): Promise<{ publicSubmission: boolean }> {
  const society = await ctx.db.get(societyId, "societies");
  if (!society) throw new Error("Intake unavailable.");
  if (!normalizeModuleSettings(society as any)[key]) throw new Error(`${MODULES_BY_KEY[key].label} is disabled for this workspace.`);
  const member = ctx.principal.kind !== "anonymous" && ctx.principal.assurance === "trusted-workspace"
    ? await requireSocietyMembership(ctx, societyId) : await resolvePrincipalUser(ctx, societyId);
  if (member) {
    assertMembershipStatus(member);
    return { publicSubmission: false };
  }
  const enabled = key === "volunteers" ? society.publicVolunteerIntakeEnabled : society.publicGrantIntakeEnabled;
  if (!society.publicSlug || !society.publicTransparencyEnabled || !enabled) throw new Error("Public intake unavailable.");
  return { publicSubmission: true };
}
