/**
 * PORTABLE FUNCTIONS: the proxies domain (list / forMeeting / create / update / revoke / remove).
 *
 * Straight CRUD over `ctx.db`, plus a bylaw-gated `create`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 *
 * `create` enforces the active bylaw rule set (proxy voting enabled, proxy
 * holder linkage, per-grantor proxy limit) using the rule set in force on the
 * meeting's local day, selected by `shared/bylawRuleSelection.ts` like the
 * meeting page.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { bylawRuleSelectionDay, selectBylawRuleSetForDay } from "../bylawRuleSelection";
import type { MeetingDateLike } from "../meetingDates";
import { organizationTimeZone } from "../organizationDomain";

interface ResolvedBylawRules {
  status?: string;
  version: number;
  effectiveFromISO?: string;
  allowProxyVoting: boolean;
  proxyHolderMustBeMember: boolean;
  proxyLimitPerGrantorPerMeeting: number;
  isFallback?: boolean;
  _id?: string;
}

const DEFAULT_BYLAW_RULES = {
  version: 1,
  status: "Active",
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
};

/** The rule set in force on `at`'s local day (default today); see `shared/bylawRuleSelection.ts`. */
async function getActiveBylawRuleSet(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
  at: MeetingDateLike | string = new Date().toISOString(),
): Promise<ResolvedBylawRules> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const timeZone = organizationTimeZone(await ctx.db.get(societyId));
  const selected = selectBylawRuleSetForDay(rows, bylawRuleSelectionDay(at, timeZone), timeZone);
  if (selected) return selected as ResolvedBylawRules;
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
    isFallback: true,
  } as ResolvedBylawRules;
}

export interface ProxyCreateArgs {
  societyId: string;
  meetingId: string;
  grantorName: string;
  grantorMemberId?: string;
  proxyHolderName: string;
  proxyHolderMemberId?: string;
  instructions?: string;
  signedAtISO: string;
}

export interface ProxyPatch {
  grantorName?: string;
  proxyHolderName?: string;
  instructions?: string;
  signedAtISO?: string;
}

export async function proxiesList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("proxies")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function proxiesForMeeting(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  await requireOwnedRow(ctx, "meetings", meetingId);
  return ctx.db
    .query("proxies")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

export async function proxyCreate(ctx: PortableMutationCtx, args: ProxyCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  const meeting = await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  if (args.grantorMemberId) {
    await getOwned(ctx, "members", args.grantorMemberId, args.societyId);
  }
  if (args.proxyHolderMemberId) {
    await getOwned(ctx, "members", args.proxyHolderMemberId, args.societyId);
  }
  // The rules that govern the meeting the proxy is for, as the meeting page shows them.
  const rules = await getActiveBylawRuleSet(ctx, args.societyId, meeting as MeetingDateLike);
  if (!rules.allowProxyVoting) {
    throw new Error(
      "Proxy voting is disabled by the active bylaw rule set.",
    );
  }
  if (rules.proxyHolderMustBeMember && !args.proxyHolderMemberId) {
    throw new Error(
      "The proxy holder must be linked to a member under the active bylaw rule set.",
    );
  }

  const existing = await ctx.db
    .query("proxies")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  const activeForGrantor = existing.filter((proxy) => {
    if (proxy.revokedAtISO) return false;
    if (args.grantorMemberId && proxy.grantorMemberId) {
      return proxy.grantorMemberId === args.grantorMemberId;
    }
    return proxy.grantorName.trim().toLowerCase() === args.grantorName.trim().toLowerCase();
  });
  if (activeForGrantor.length >= rules.proxyLimitPerGrantorPerMeeting) {
    throw new Error(
      `A grantor may only appoint ${rules.proxyLimitPerGrantorPerMeeting} proxy holder(s) for a meeting under the active bylaw rule set.`,
    );
  }

  return ctx.db.insert("proxies", args);
}

export async function proxyUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: ProxyPatch }): Promise<void> {
  await requireOwnedRow(ctx, "proxies", id);
  await ctx.db.patch(id, patch);
}

export async function proxyRevoke(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await requireOwnedRow(ctx, "proxies", id);
  await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
}

export async function proxyRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await requireOwnedRow(ctx, "proxies", id);
  await ctx.db.delete(id);
}
