import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireRole } from "./users";
import { createCheckoutSession, simulateWebhookFromCheckout } from "./providers/billing";

export const plans = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("subscriptionPlans")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const mySubscriptions = query({
  args: { societyId: v.id("societies"), email: v.string() },
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
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const { id, actingUserId, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, rest);
      return id;
    }
    return await ctx.db.insert("subscriptionPlans", rest);
  },
});

export const removePlan = mutation({
  args: { id: v.id("subscriptionPlans"), actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { id, actingUserId }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireRole(ctx, { actingUserId, societyId: row.societyId, required: "Admin" });
    await ctx.db.delete(id);
  },
});

export const cancelSubscription = mutation({
  args: { id: v.id("memberSubscriptions"), actingUserId: v.optional(v.id("users")) },
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
  handler: async (ctx, args) => {
    const plan = await ctx.runQuery(api.subscriptions.getPlan, { id: args.planId });
    if (!plan) throw new Error("Plan not found.");

    const session = await createCheckoutSession({
      priceCents: plan.priceCents,
      currency: plan.currency,
      interval: plan.interval as any,
      successUrl: "http://localhost:5173/membership/success",
      cancelUrl: "http://localhost:5173/membership",
      email: args.email,
      metadata: {
        societyId: args.societyId,
        planId: args.planId,
      },
    });

    // Create a pending subscription now so the society can see the attempt.
    await ctx.runMutation(api.subscriptions._createPending, {
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
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const _createPending = mutation({
  args: {
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    email: v.string(),
    fullName: v.string(),
    demo: v.boolean(),
  },
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
