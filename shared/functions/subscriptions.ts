/**
 * PORTABLE FUNCTIONS: the subscriptions domain (pure `ctx.db` handlers only).
 *
 * Read handlers (plans / mySubscriptions / allSubscriptions / feeTimeline /
 * getPlan), the member-facing cancelSubscription, and the role-gated plan /
 * fee-period CRUD (upsertPlan / upsertFeePeriod / removeFeePeriod / removePlan)
 * run unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. Handlers that run as actions/internal mutations or call the Stripe
 * `providers/billing` shim stay on Convex.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function previousDateISO(dateISO: string) {
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function syncCurrentFeePeriod(ctx: PortableMutationCtx, planId: string, plan: any) {
  const effectiveFrom = todayISO();
  const periods = await ctx.db
    .query("membershipFeePeriods")
    .withIndex("by_plan", (q) => q.eq("planId", planId))
    .collect();
  const openPeriods = periods.filter((row: any) => !row.effectiveTo);
  const openToday = openPeriods.find((row: any) => row.effectiveFrom === effectiveFrom);
  const payload = {
    societyId: plan.societyId,
    planId,
    membershipClass: plan.membershipClass,
    label: plan.name,
    priceCents: plan.priceCents,
    currency: plan.currency,
    interval: plan.interval,
    effectiveFrom,
    status: plan.active ? "active" : "retired",
    notes: "Current fee captured from the membership plan.",
    updatedAtISO: new Date().toISOString(),
  };

  if (openToday) {
    await ctx.db.patch(openToday._id, payload);
    return openToday._id;
  }

  const hasEquivalentOpenPeriod = openPeriods.some(
    (row: any) =>
      row.priceCents === plan.priceCents &&
      row.currency === plan.currency &&
      row.interval === plan.interval &&
      row.membershipClass === plan.membershipClass &&
      row.label === plan.name &&
      row.status === (plan.active ? "active" : "retired"),
  );
  if (hasEquivalentOpenPeriod) return null;

  const endDate = previousDateISO(effectiveFrom);
  for (const period of openPeriods) {
    if (period.effectiveFrom < effectiveFrom) {
      await ctx.db.patch(period._id, {
        effectiveTo: endDate,
        status: "retired",
        updatedAtISO: new Date().toISOString(),
      });
    }
  }

  return await ctx.db.insert("membershipFeePeriods", {
    ...payload,
    createdAtISO: new Date().toISOString(),
  });
}

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

export async function upsertPlanPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Admin",
  });
  const { id, actingUserId, ...rest } = args;
  void actingUserId;
  if (id) {
    const before = await ctx.db.get(id);
    await ctx.db.patch(id, rest);
    if (
      before &&
      (before.priceCents !== rest.priceCents ||
        before.currency !== rest.currency ||
        before.interval !== rest.interval ||
        before.membershipClass !== rest.membershipClass ||
        before.name !== rest.name ||
        before.active !== rest.active)
    ) {
      await syncCurrentFeePeriod(ctx, id, rest);
    }
    return id;
  }
  const planId = await ctx.db.insert("subscriptionPlans", rest);
  await syncCurrentFeePeriod(ctx, planId, rest);
  return planId;
}

export async function upsertFeePeriodPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Admin",
  });
  const { id, actingUserId, ...rest } = args;
  void actingUserId;
  if (rest.planId) {
    const plan = await ctx.db.get(rest.planId);
    if (!plan || plan.societyId !== rest.societyId) {
      throw new Error("Plan does not belong to this society.");
    }
  }
  const now = new Date().toISOString();
  if (id) {
    await ctx.db.patch(id, { ...rest, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("membershipFeePeriods", {
    ...rest,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function removeFeePeriodPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Admin" });
  await ctx.db.delete(id);
}

export async function removePlanPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id);
  if (!row) return;
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Admin" });
  const feePeriods = await ctx.db
    .query("membershipFeePeriods")
    .withIndex("by_plan", (q) => q.eq("planId", id))
    .collect();
  for (const period of feePeriods) await ctx.db.delete(period._id);
  await ctx.db.delete(id);
}
