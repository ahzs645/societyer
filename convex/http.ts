import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

function env(name: string) {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

function normalizePhone(value?: string | null) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function signStripePayload(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toHex(signature);
}

async function verifyStripeSignature(body: string, signatureHeader: string | null) {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret || !signatureHeader) return false;

  const parts = signatureHeader
    .split(",")
    .map((part) => part.split("="))
    .reduce<Record<string, string[]>>((acc, [key, value]) => {
      if (!key || !value) return acc;
      acc[key] ??= [];
      acc[key].push(value);
      return acc;
    }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const expected = await signStripePayload(secret, `${timestamp}.${body}`);

  return signatures.some((signature) => signature === expected);
}

async function signTwilioPayload(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return typeof globalThis.btoa === "function"
    ? globalThis.btoa(String.fromCharCode(...new Uint8Array(signature)))
    : Buffer.from(new Uint8Array(signature)).toString("base64");
}

async function verifyTwilioSignature(request: Request, body: string) {
  const secret = env("TWILIO_AUTH_TOKEN");
  const signatureHeader =
    request.headers.get("x-twilio-signature") ??
    request.headers.get("X-Twilio-Signature");
  if (!secret || !signatureHeader) return false;

  const params = new URLSearchParams(body);
  const payload = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  const expected = await signTwilioPayload(secret, `${request.url}${payload}`);
  return expected === signatureHeader;
}

async function findDeliveriesByProviderMessageId(ctx: any, providerMessageId: string) {
  const societies = await ctx.runQuery(api.society.list, {});
  const matches: any[] = [];
  for (const society of societies ?? []) {
    const rows = await ctx.runQuery(api.communications.listDeliveries, {
      societyId: society._id,
      limit: 2000,
    });
    for (const row of rows ?? []) {
      if (row.providerMessageId === providerMessageId) {
        matches.push({ societyId: society._id, row });
      }
    }
  }
  return matches;
}

async function findDeliveriesByRecipientEmail(ctx: any, recipientEmail: string) {
  const societies = await ctx.runQuery(api.society.list, {});
  const normalized = recipientEmail.trim().toLowerCase();
  const matches: any[] = [];
  for (const society of societies ?? []) {
    const rows = await ctx.runQuery(api.communications.listDeliveries, {
      societyId: society._id,
      limit: 2000,
    });
    for (const row of rows ?? []) {
      if (String(row.recipientEmail ?? "").trim().toLowerCase() === normalized) {
        matches.push({ societyId: society._id, row });
      }
    }
  }
  return matches;
}

async function findMemberByEmail(ctx: any, email: string) {
  const societies = await ctx.runQuery(api.society.list, {});
  const normalized = email.trim().toLowerCase();
  for (const society of societies ?? []) {
    const members = await ctx.runQuery(api.members.list, { societyId: society._id });
    const member = (members ?? []).find((row: any) => String(row.email ?? "").trim().toLowerCase() === normalized);
    if (member) return { societyId: society._id, member };
  }
  return null;
}

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    if (!(await verifyStripeSignature(body, request.headers.get("stripe-signature")))) {
      return new Response("Invalid Stripe signature", { status: 400 });
    }

    const event = JSON.parse(body);
    await ctx.runMutation(api.subscriptions.handleStripeEvent, {
      type: String(event?.type ?? "unknown"),
      payload: JSON.stringify(event?.data?.object ?? {}),
    });

    return new Response("ok", { status: 200 });
  }),
});

http.route({
  path: "/communications/webhooks/resend",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const event = JSON.parse(body);
    const eventType = String(event?.type ?? "");
    const data = (event?.data ?? {}) as Record<string, any>;
    const providerMessageId = String(data.email_id ?? data.id ?? data.message_id ?? "");
    const recipientEmail = String(
      Array.isArray(data.to)
        ? data.to[0]
        : data.email ?? data.recipient_email ?? data.to ?? "",
    );

    const matches = providerMessageId
      ? await findDeliveriesByProviderMessageId(ctx, providerMessageId)
      : recipientEmail
        ? await findDeliveriesByRecipientEmail(ctx, recipientEmail)
        : [];

    for (const match of matches) {
      if (eventType === "email.opened") {
        await ctx.runMutation(api.communications.markDeliveryOpened, { id: match.row._id });
      } else if (
        eventType === "email.bounced" ||
        eventType === "email.failed" ||
        eventType === "email.suppressed" ||
        eventType === "email.delivery_delayed"
      ) {
        await ctx.runMutation(api.communications.markDeliveryBounced, {
          id: match.row._id,
          errorMessage: eventType,
        });
      }
    }

    if (eventType === "email.complained" || (eventType === "contact.updated" && data.unsubscribed)) {
      const lookup = recipientEmail ? await findMemberByEmail(ctx, recipientEmail) : null;
      if (lookup) {
        const pref = await ctx.runQuery(api.communications.listMemberPrefs, {
          societyId: lookup.societyId,
        });
        const existing = (pref ?? []).find((row: any) => row.memberId === lookup.member._id);
        await ctx.runMutation(api.communications.upsertMemberPref, {
          societyId: lookup.societyId,
          memberId: lookup.member._id,
          email: lookup.member.email ?? undefined,
          phone: lookup.member.phone ?? undefined,
          postalAddress: existing?.postalAddress ?? lookup.member.address ?? undefined,
          transactionalEmailEnabled: existing?.transactionalEmailEnabled ?? true,
          noticeEmailEnabled: existing?.noticeEmailEnabled ?? true,
          newsletterEmailEnabled: false,
          smsEnabled: existing?.smsEnabled ?? false,
          mailEnabled:
            existing?.mailEnabled ??
            !!(existing?.postalAddress ?? lookup.member.address),
          preferredChannel: existing?.preferredChannel ?? "email",
          unsubscribedAtISO: new Date().toISOString(),
          unsubscribeReason: eventType,
        });
        await ctx.runMutation(api.communications._recordDelivery, {
          societyId: lookup.societyId,
          memberId: lookup.member._id,
          recipientName: `${lookup.member.firstName} ${lookup.member.lastName}`,
          recipientEmail: lookup.member.email ?? recipientEmail,
          recipientPhone: lookup.member.phone,
          recipientAddress: lookup.member.address,
          channel: "email",
          provider: "resend",
          subject: data.subject ? String(data.subject) : "Unsubscribed",
          status: "unsubscribed",
          proofOfNotice: `${eventType}:${String(event?.created_at ?? new Date().toISOString())}`,
          providerEventType: eventType,
          providerPayload: body,
          unsubscribedAtISO: new Date().toISOString(),
        });
      }
    }

    return new Response("ok", { status: 200 });
  }),
});

http.route({
  path: "/communications/webhooks/twilio",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    if (!(await verifyTwilioSignature(request, body))) {
      return new Response("Invalid Twilio signature", { status: 400 });
    }

    const form = new URLSearchParams(body);
    const messageSid = String(form.get("MessageSid") ?? form.get("SmsSid") ?? "");
    const messageStatus = String(form.get("MessageStatus") ?? form.get("SmsStatus") ?? "").toLowerCase();
    const from = String(form.get("From") ?? "");
    const messageBody = String(form.get("Body") ?? "").trim().toUpperCase();

    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(messageBody)) {
      const societies = await ctx.runQuery(api.society.list, {});
      for (const society of societies ?? []) {
        const members = await ctx.runQuery(api.members.list, { societyId: society._id });
        const member = (members ?? []).find((row: any) => normalizePhone(row.phone) === normalizePhone(from));
        if (!member) continue;
        const prefs = await ctx.runQuery(api.communications.listMemberPrefs, {
          societyId: society._id,
        });
        const existing = (prefs ?? []).find((row: any) => row.memberId === member._id);
        await ctx.runMutation(api.communications.upsertMemberPref, {
          societyId: society._id,
          memberId: member._id,
          email: member.email ?? undefined,
          phone: member.phone ?? from,
          postalAddress: existing?.postalAddress ?? member.address ?? undefined,
          transactionalEmailEnabled: existing?.transactionalEmailEnabled ?? true,
          noticeEmailEnabled: existing?.noticeEmailEnabled ?? true,
          newsletterEmailEnabled: existing?.newsletterEmailEnabled ?? false,
          smsEnabled: false,
          mailEnabled:
            existing?.mailEnabled ?? !!(existing?.postalAddress ?? member.address),
          preferredChannel: existing?.preferredChannel ?? "email",
          unsubscribedAtISO: new Date().toISOString(),
          unsubscribeReason: "sms-stop",
        });
        await ctx.runMutation(api.communications._recordDelivery, {
          societyId: society._id,
          memberId: member._id,
          recipientName: `${member.firstName} ${member.lastName}`,
          recipientEmail: member.email,
          recipientPhone: member.phone ?? from,
          recipientAddress: member.address,
          channel: "sms",
          provider: "twilio",
          providerMessageId: messageSid || undefined,
          subject: "SMS opt-out",
          status: "unsubscribed",
          proofOfNotice: `${messageBody}:${new Date().toISOString()}`,
          providerEventType: messageStatus || "inbound-stop",
          providerPayload: body,
          unsubscribedAtISO: new Date().toISOString(),
        });
      }
      return new Response("ok", { status: 200 });
    }

    if (messageSid && ["failed", "undelivered", "canceled", "expired"].includes(messageStatus)) {
      const matches = await findDeliveriesByProviderMessageId(ctx, messageSid);
      for (const match of matches) {
        await ctx.runMutation(api.communications.markDeliveryBounced, {
          id: match.row._id,
          errorMessage: messageStatus,
        });
      }
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
