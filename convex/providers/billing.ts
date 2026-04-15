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
  priceId?: string;
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

  const secretKey = (globalThis as any)?.process?.env?.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Live Stripe checkout requires STRIPE_SECRET_KEY.");
  }

  const body = new URLSearchParams();
  body.set("mode", args.interval === "one_time" ? "payment" : "subscription");
  body.set("success_url", args.successUrl);
  body.set("cancel_url", args.cancelUrl);
  body.set("customer_email", args.email);
  body.set("line_items[0][quantity]", "1");

  if (args.priceId) {
    body.set("line_items[0][price]", args.priceId);
  } else {
    body.set("line_items[0][price_data][currency]", args.currency.toLowerCase());
    body.set("line_items[0][price_data][unit_amount]", String(args.priceCents));
    if (args.interval !== "one_time") {
      body.set("line_items[0][price_data][recurring][interval]", args.interval);
    }
    body.set("line_items[0][price_data][product_data][name]", "Society membership");
  }

  for (const [key, value] of Object.entries(args.metadata ?? {})) {
    body.set(`metadata[${key}]`, value);
    if (args.interval !== "one_time") {
      body.set(`subscription_data[metadata][${key}]`, value);
    } else {
      body.set(`payment_intent_data[metadata][${key}]`, value);
    }
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `Stripe checkout failed with status ${response.status}.`);
  }

  const data = await response.json().catch(() => ({}));
  if (!(data as any)?.url) {
    throw new Error("Stripe checkout did not return a hosted URL.");
  }

  return {
    provider: "stripe" as const,
    id: String((data as any).id),
    url: String((data as any).url),
    expiresAtISO:
      typeof (data as any).expires_at === "number"
        ? new Date((data as any).expires_at * 1000).toISOString()
        : expiresAtISO,
  };
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
