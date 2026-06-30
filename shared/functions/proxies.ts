/**
 * PORTABLE FUNCTIONS: the proxies domain (list / forMeeting / create / update / revoke / remove).
 *
 * Straight CRUD over `ctx.db`, plus a bylaw-gated `create`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 *
 * `create` enforces the active bylaw rule set (proxy voting enabled, proxy
 * holder linkage, per-grantor proxy limit). The rule-resolution helper is a
 * portable copy of `convex/lib/bylawRules.ts`'s `getActiveBylawRuleSet`: it only
 * reads `bylawRuleSets` via the `by_society` index, so it lives here on the
 * portable contract rather than reaching into the Convex-typed lib module.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

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

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function effectiveTimestamp(row: any) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function compareRuleSetsDesc(a: any, b: any) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

async function getActiveBylawRuleSet(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
): Promise<ResolvedBylawRules> {
  const dateISO = new Date().toISOString();
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
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
  return ctx.db
    .query("proxies")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function proxiesForMeeting(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  return ctx.db
    .query("proxies")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

export async function proxyCreate(ctx: PortableMutationCtx, args: ProxyCreateArgs): Promise<string> {
  const rules = await getActiveBylawRuleSet(ctx, args.societyId);
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
  await ctx.db.patch(id, patch);
}

export async function proxyRevoke(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
}

export async function proxyRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
