/**
 * PORTABLE FUNCTIONS: the corporation-settings domain (complianceDeadlines).
 *
 * Derives compliance deadlines (AGM / fiscal-year-end / annual report) from a
 * society's settings — the YCN Corporation_Settings → deadlines idea. Reads the
 * society row over `ctx.db`; all date math lives in the pure, unit-tested
 * shared/corporationSettings.ts. Runs unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { deriveComplianceDeadlines, type ComplianceSettings } from "../corporationSettings";

export async function complianceDeadlinesPortable(
  ctx: PortableQueryCtx,
  { societyId, fromISO }: { societyId: string; fromISO: string },
) {
  const society = await ctx.db.get(societyId);
  if (!society) return [];
  const settings: ComplianceSettings = {
    agmMonth: (society as Record<string, unknown>).agmMonth as number | undefined,
    agmDay: (society as Record<string, unknown>).agmDay as number | undefined,
    fiscalYearEnd: society.fiscalYearEnd ?? undefined,
    incorporationDate: society.incorporationDate ?? undefined,
    anniversaryDate: society.anniversaryDate ?? undefined,
    waivePrepFinancials: (society as Record<string, unknown>).waivePrepFinancials as
      | boolean
      | undefined,
  };
  return deriveComplianceDeadlines(settings, fromISO);
}
