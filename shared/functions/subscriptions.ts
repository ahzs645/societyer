/**
 * PORTABLE FUNCTIONS: the subscriptions domain (pure `ctx.db` handlers only).
 *
 * Read handlers (plans / mySubscriptions / allSubscriptions / feeTimeline /
 * getPlan) and the member-facing cancelSubscription run unchanged on hosted
 * Convex, the local Dexie runtime, and the convex-test oracle. Handlers that
 * gate on `requireRole`, run as actions/internal mutations, or call the Stripe
 * `providers/billing` shim stay on Convex.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function plansPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("subscriptionPlans")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function mySubscriptionsPortable(
  ctx: PortableQueryCtx,
  { societyId, email }: { societyId: string; email: string },
) {
  const rows = await ctx.db
    .query("memberSubscriptions")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  return rows.filter((r) => r.societyId === societyId);
}

export async function allSubscriptionsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  return ctx.db
    .query("memberSubscriptions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function feeTimelinePortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const [plans, periods] = await Promise.all([
    ctx.db
      .query("subscriptionPlans")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("membershipFeePeriods")
      .withIndex("by_society_effective_from", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);
  const planById = new Map<string, any>((plans as any[]).map((plan) => [String(plan._id), plan]));
  const periodsByPlanId = new Map<string, number>();
  for (const period of periods) {
    if (period.planId) {
      periodsByPlanId.set(String(period.planId), (periodsByPlanId.get(String(period.planId)) ?? 0) + 1);
    }
  }

  const rows = periods.map((period: any) => {
    const plan = period.planId ? planById.get(String(period.planId)) : null;
    return {
      ...period,
      planName: plan?.name,
      activePlan: plan?.active,
    };
  });

  for (const plan of plans) {
    if (periodsByPlanId.has(String(plan._id))) continue;
    rows.push({
      _id: `current:${plan._id}`,
      societyId,
      planId: plan._id,
      planName: plan.name,
      activePlan: plan.active,
      membershipClass: plan.membershipClass,
      label: plan.name,
      priceCents: plan.priceCents,
      currency: plan.currency,
      interval: plan.interval,
      effectiveFrom: "current",
      status: plan.active ? "active" : "retired",
      synthetic: true,
    });
  }

  return rows.sort((a: any, b: any) => {
    const ad = a.effectiveFrom === "current" ? "9999-12-31" : a.effectiveFrom;
    const bd = b.effectiveFrom === "current" ? "9999-12-31" : b.effectiveFrom;
    return bd.localeCompare(ad) || String(a.label).localeCompare(String(b.label));
  });
}

export async function cancelSubscriptionPortable(
  ctx: PortableMutationCtx,
  { id }: { id: string; actingUserId?: string },
) {
  const sub = await ctx.db.get(id);
  if (!sub) return;
  // Member can cancel their own subscription; admin can cancel any.
  await ctx.db.patch(id, {
    status: "canceled",
    canceledAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("notifications", {
    societyId: sub.societyId,
    kind: "billing",
    severity: "warn",
    title: "Subscription canceled",
    body: `${sub.fullName} (${sub.email}) canceled ${sub.status === "active" ? "an active" : "a pending"} subscription.`,
    linkHref: "/membership",
    createdAtISO: new Date().toISOString(),
  });
}

export async function getPlanPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}
