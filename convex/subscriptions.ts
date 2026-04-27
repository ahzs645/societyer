import { v } from "convex/values";
import { query, internalMutation, mutation, action } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import { createCheckoutSession, simulateWebhookFromCheckout } from "./providers/billing";

function frontendAppUrl(path: string) {
  const base = (globalThis as any)?.process?.env?.APP_BASE_URL ?? "http://localhost:5173";
  return `${base.replace(/\/$/, "")}/#${path.startsWith("/") ? path : `/${path}`}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function previousDateISO(dateISO: string) {
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function syncCurrentFeePeriod(ctx: any, planId: Id<"subscriptionPlans">, plan: any) {
  const effectiveFrom = todayISO();
  const periods = await ctx.db
    .query("membershipFeePeriods")
    .withIndex("by_plan", (q: any) => q.eq("planId", planId))
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

export const plans = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("subscriptionPlans")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const mySubscriptions = query({
  args: { societyId: v.id("societies"), email: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, email }) => {
    const rows = await ctx.db
      .query("memberSubscriptions")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return rows.filter((r) => r.societyId === societyId);
  },
});

export const allSubscriptions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("memberSubscriptions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const upsertPlan = mutation({
  args: {
    id: v.optional(v.id("subscriptionPlans")),
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(),
    benefits: v.array(v.string()),
    membershipClass: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    active: v.boolean(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const { id, actingUserId, ...rest } = args;
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
  },
});

export const feeTimeline = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
  },
});

export const upsertFeePeriod = mutation({
  args: {
    id: v.optional(v.id("membershipFeePeriods")),
    societyId: v.id("societies"),
    planId: v.optional(v.id("subscriptionPlans")),
    membershipClass: v.optional(v.string()),
    label: v.string(),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const { id, actingUserId, ...rest } = args;
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
  },
});

export const removeFeePeriod = mutation({
  args: { id: v.id("membershipFeePeriods"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Admin" });
    await ctx.db.delete(id);
  },
});

export const removePlan = mutation({
  args: { id: v.id("subscriptionPlans"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Admin" });
    const feePeriods = await ctx.db
      .query("membershipFeePeriods")
      .withIndex("by_plan", (q) => q.eq("planId", id))
      .collect();
    for (const period of feePeriods) await ctx.db.delete(period._id);
    await ctx.db.delete(id);
  },
});

export const cancelSubscription = mutation({
  args: { id: v.id("memberSubscriptions"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
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
  },
});

// Begin checkout. Live mode returns a hosted Stripe Checkout URL. Demo mode
// short-circuits: we create a pending subscription immediately and return a
// demo-scheme URL the UI can interpret as "click to pay".
export const beginCheckout = action({
  args: {
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    email: v.string(),
    fullName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const plan = await ctx.runQuery(api.subscriptions.getPlan, { id: args.planId });
    if (!plan) throw new Error("Plan not found.");

    const session = await createCheckoutSession({
      priceCents: plan.priceCents,
      currency: plan.currency,
      interval: plan.interval as any,
      successUrl:
        (globalThis as any)?.process?.env?.STRIPE_SUCCESS_URL ??
        frontendAppUrl("/app/membership?checkout=success"),
      cancelUrl:
        (globalThis as any)?.process?.env?.STRIPE_CANCEL_URL ??
        frontendAppUrl("/app/membership?checkout=cancel"),
      email: args.email,
      priceId: plan.stripePriceId,
      metadata: {
        societyId: String(args.societyId),
        planId: String(args.planId),
        fullName: args.fullName,
      },
    });

    // Create a pending subscription now so the society can see the attempt.
    await ctx.runMutation(internal.subscriptions._createPending, {
      societyId: args.societyId,
      planId: args.planId,
      email: args.email,
      fullName: args.fullName,
      demo: session.provider === "demo",
    });

    return { url: session.url, demo: session.provider === "demo" };
  },
});

export const getPlan = query({
  args: { id: v.id("subscriptionPlans") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const _createPending = internalMutation({
  args: {
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    email: v.string(),
    fullName: v.string(),
    demo: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.insert("memberSubscriptions", {
      societyId: args.societyId,
      planId: args.planId,
      email: args.email,
      fullName: args.fullName,
      status: "pending",
      startedAtISO: new Date().toISOString(),
      demo: args.demo,
    });
  },
});

// Simulate the Stripe webhook the success URL would receive in production.
// Called by the /membership/success demo page.
export const simulateActivation = mutation({
  args: {
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    email: v.string(),
    fullName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found.");

    const event = simulateWebhookFromCheckout({
      email: args.email,
      priceCents: plan.priceCents,
      interval: plan.interval as any,
    });
    if (event.type !== "subscription.activated") return;

    const pending = await ctx.db
      .query("memberSubscriptions")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    const match = pending.find(
      (p) => p.planId === args.planId && p.status === "pending",
    );

    const periodEnd = new Date();
    if (plan.interval === "month") periodEnd.setMonth(periodEnd.getMonth() + 1);
    else if (plan.interval === "year") periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    const payload = {
      status: "active",
      stripeSubscriptionId: event.subscriptionId,
      lastPaymentAtISO: new Date().toISOString(),
      lastPaymentCents: plan.priceCents,
      currentPeriodEndISO: plan.interval === "one_time" ? undefined : periodEnd.toISOString(),
    };

    if (match) {
      await ctx.db.patch(match._id, payload);
    } else {
      await ctx.db.insert("memberSubscriptions", {
        societyId: args.societyId,
        planId: args.planId,
        email: args.email,
        fullName: args.fullName,
        startedAtISO: new Date().toISOString(),
        demo: true,
        ...payload,
      });
    }

    await ctx.db.insert("notifications", {
      societyId: args.societyId,
      kind: "billing",
      severity: "success",
      title: `New member subscription: ${plan.name}`,
      body: `${args.fullName} (${args.email}) activated a ${plan.interval} subscription.`,
      linkHref: "/membership",
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const handleStripeEvent = internalMutation({
  args: {
    type: v.string(),
    payload: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { type, payload }) => {
    const object = JSON.parse(payload);

    if (type === "checkout.session.completed") {
      const metadata = object?.metadata ?? {};
      const societyId = metadata.societyId as Id<"societies"> | undefined;
      const planId = metadata.planId as Id<"subscriptionPlans"> | undefined;
      const email = object?.customer_email ?? object?.customer_details?.email;
      if (!societyId || !planId || !email) return null;
      const plan = await ctx.db.get(planId);
      if (!plan) return null;

      const pending = await ctx.db
        .query("memberSubscriptions")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      const match = pending.find(
        (row) => row.societyId === societyId && row.planId === planId && row.status === "pending",
      );
      const members = await ctx.db
        .query("members")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
      const member = members.find(
        (row) => row.email?.toLowerCase() === String(email).toLowerCase(),
      );

      const payloadPatch = {
        memberId: member?._id,
        status: "active",
        stripeCustomerId: object?.customer ?? undefined,
        stripeSubscriptionId: object?.subscription ?? undefined,
        lastPaymentAtISO: new Date().toISOString(),
        lastPaymentCents: typeof object?.amount_total === "number" ? object.amount_total : plan.priceCents,
        currentPeriodEndISO:
          plan.interval === "one_time"
            ? undefined
            : new Date(
                Date.now() + (plan.interval === "year" ? 365 : 31) * 24 * 60 * 60 * 1000,
              ).toISOString(),
      };

      if (match) {
        await ctx.db.patch(match._id, payloadPatch);
      } else {
        await ctx.db.insert("memberSubscriptions", {
          societyId,
          planId,
          email,
          fullName:
            metadata.fullName ??
            object?.customer_details?.name ??
            object?.customer_email,
          startedAtISO: new Date().toISOString(),
          demo: false,
          ...payloadPatch,
        });
      }

      await ctx.db.insert("notifications", {
        societyId,
        kind: "billing",
        severity: "success",
        title: `Stripe checkout completed: ${plan.name}`,
        body: `${email} activated a ${plan.interval} subscription.`,
        linkHref: "/membership",
        createdAtISO: new Date().toISOString(),
      });
      return null;
    }

    if (type === "invoice.paid" || type === "invoice.payment_failed") {
      const subscriptionId = object?.subscription;
      if (!subscriptionId) return null;
      const subscriptions = await ctx.db.query("memberSubscriptions").collect();
      const match = subscriptions.find(
        (row) => row.stripeSubscriptionId === subscriptionId,
      );
      if (!match) return null;
      const patch: Record<string, unknown> = {
        lastPaymentAtISO: new Date().toISOString(),
      };
      if (typeof object?.amount_paid === "number") {
        patch.lastPaymentCents = object.amount_paid;
      }
      if (type === "invoice.payment_failed") {
        patch.status = "past_due";
      } else if (match.status !== "canceled") {
        patch.status = "active";
      }
      const linePeriodEnd = object?.lines?.data?.[0]?.period?.end;
      if (typeof linePeriodEnd === "number") {
        patch.currentPeriodEndISO = new Date(linePeriodEnd * 1000).toISOString();
      }
      await ctx.db.patch(match._id, patch);
      await ctx.db.insert("notifications", {
        societyId: match.societyId,
        kind: "billing",
        severity: type === "invoice.payment_failed" ? "warn" : "success",
        title:
          type === "invoice.payment_failed"
            ? `Subscription payment failed`
            : `Subscription payment received`,
        body:
          type === "invoice.payment_failed"
            ? `${match.fullName} is now past due.`
            : `${match.fullName} payment recorded.`,
        linkHref: "/membership",
        createdAtISO: new Date().toISOString(),
      });
      return null;
    }

    if (
      type === "customer.subscription.deleted" ||
      type === "customer.subscription.updated"
    ) {
      const subscriptionId = object?.id;
      if (!subscriptionId) return null;
      const subscriptions = await ctx.db.query("memberSubscriptions").collect();
      const match = subscriptions.find(
        (row) => row.stripeSubscriptionId === subscriptionId,
      );
      if (!match) return null;
      const status =
        type === "customer.subscription.deleted"
          ? "canceled"
          : object?.status === "past_due"
          ? "past_due"
          : object?.status ?? match.status;
      await ctx.db.patch(match._id, {
        status,
        canceledAtISO:
          status === "canceled" ? new Date().toISOString() : match.canceledAtISO,
      });
      await ctx.db.insert("notifications", {
        societyId: match.societyId,
        kind: "billing",
        severity: status === "canceled" ? "warn" : "info",
        title:
          status === "canceled"
            ? "Stripe subscription canceled"
            : "Stripe subscription updated",
        body: `${match.fullName} is now ${status}.`,
        linkHref: "/membership",
        createdAtISO: new Date().toISOString(),
      });
    }
    return null;
  },
});
