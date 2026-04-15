// Billing adapter — Stripe in live mode, simulated subscriptions otherwise.
import { providers } from "./env";

export type CheckoutSession = {
  provider: "stripe" | "demo";
  id: string;
  url: string;
  expiresAtISO: string;
};

export async function createCheckoutSession(args: {
  priceCents: number;
  currency: string;
  interval: "month" | "year" | "one_time";
  successUrl: string;
  cancelUrl: string;
  email: string;
  metadata?: Record<string, string>;
}): Promise<CheckoutSession> {
  const p = providers.billing();
  const id = `cs_${Math.random().toString(36).slice(2, 10)}`;
  const expiresAtISO = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  if (p.id === "demo") {
    // Demo returns a deep-link the browser treats as "click-through and we're
    // done" — the Checkout page itself emulates the hosted-checkout UX.
    const meta = args.metadata ? `&meta=${encodeURIComponent(JSON.stringify(args.metadata))}` : "";
    return {
      provider: "demo",
      id,
      url: `#demo-checkout?amount=${args.priceCents}&currency=${args.currency}&email=${encodeURIComponent(args.email)}&interval=${args.interval}${meta}`,
      expiresAtISO,
    };
  }
  throw new Error("Live Stripe checkout requires STRIPE_SECRET_KEY and an HTTP action.");
}

export type BillingEvent =
  | { type: "subscription.activated"; email: string; subscriptionId: string; amountCents: number }
  | { type: "subscription.canceled"; subscriptionId: string }
  | { type: "invoice.paid"; subscriptionId: string; amountCents: number };

export function simulateWebhookFromCheckout(args: {
  email: string;
  priceCents: number;
  interval: "month" | "year" | "one_time";
}): BillingEvent {
  const subscriptionId = `sub_demo_${Math.random().toString(36).slice(2, 10)}`;
  return {
    type: "subscription.activated",
    email: args.email,
    subscriptionId,
    amountCents: args.priceCents,
  };
}
