import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";

const http = httpRouter();
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

http.route({
  path: "/ai-chat/stream",
  method: "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, {
      status: 204,
      headers: corsHeaders(),
    }),
  ),
});

http.route({
  path: "/ai-chat/stream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json().catch(() => ({}));
    const societyId = body.societyId;
    const content = String(body.content ?? "").trim();
    if (!societyId || !content) {
      return new Response("Missing societyId or content", { status: 400 });
    }
    const actingUserId = body.actingUserId || undefined;
    const runtimeConfig = await resolveAiRuntimeConfig(ctx, societyId, actingUserId, body.modelId);
    const modelId = runtimeConfig.modelId;
    const threadId =
      body.threadId ??
      (await ctx.runMutation((api as any).aiChat.createThread, {
        societyId,
        title: content,
        modelId,
        browsingContext: body.browsingContext,
        actingUserId,
      }));

    await ctx.runMutation((internal as any).aiChat._appendMessage, {
      societyId,
      threadId,
      role: "user",
      content,
      createdByUserId: actingUserId,
    });
    const [context, history] = await Promise.all([
      ctx.runQuery((api as any).aiAgents.getChatContext, {
        societyId,
        actingUserId,
        browsingContext: body.browsingContext,
      }),
      ctx.runQuery((api as any).aiChat.messagesForThread, { threadId }),
    ]);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let text = "";
        try {
          if (!runtimeConfig.model) throw new Error("No AI provider key is configured.");
          controller.enqueue(encoder.encode(sse({ threadId, modelId }, "ready")));
          const result = streamText({
            model: runtimeConfig.model,
            system: context.systemPrompt,
            messages: history
              .filter((message: any) => message.role === "user" || message.role === "assistant")
              .slice(-16)
              .map((message: any) => ({ role: message.role, content: message.content })),
          } as any);
          for await (const chunk of result.textStream) {
            text += chunk;
            controller.enqueue(encoder.encode(sse({ text: chunk }, "token")));
          }
          if (!text.trim()) {
            const retry = await generateText({
              model: runtimeConfig.model,
              system: context.systemPrompt,
              messages: history
                .filter((message: any) => message.role === "user" || message.role === "assistant")
                .slice(-16)
                .map((message: any) => ({ role: message.role, content: message.content })),
            } as any);
            text = retry.text ?? "";
            if (text) controller.enqueue(encoder.encode(sse({ text }, "token")));
          }
          if (!text.trim()) throw new Error("The model returned an empty response.");
          const messageId = await ctx.runMutation((internal as any).aiChat._appendMessage, {
            societyId,
            threadId,
            role: "assistant",
            content: text,
            status: "complete",
            modelId,
            parts: { provider: "vercel_ai_sdk_sse" },
            createdByUserId: actingUserId,
          });
          controller.enqueue(encoder.encode(sse({ threadId, messageId }, "done")));
        } catch (error: any) {
          const fallback = `Live streaming is not available: ${error?.message ?? "unknown error"}`;
          await ctx.runMutation((internal as any).aiChat._appendMessage, {
            societyId,
            threadId,
            role: "assistant",
            content: fallback,
            status: "error",
            modelId,
            parts: { provider: "sse_fallback" },
            createdByUserId: actingUserId,
          });
          controller.enqueue(encoder.encode(sse({ error: fallback, threadId }, "error")));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders(),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }),
});

function env(name: string) {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

async function resolveAiRuntimeConfig(ctx: any, societyId: any, actingUserId: any, requestedModelId?: string) {
  const settings = await ctx.runQuery((api as any).aiSettings.getEffective, {
    societyId,
    actingUserId,
  }).catch(() => null);
  const effective = settings?.effective;
  const secret = effective?.secretVaultItemId
    ? await ctx.runQuery((internal as any).secrets._revealForServer, { id: effective.secretVaultItemId }).catch(() => null)
    : null;
  const provider = effective?.provider ?? (env("OPENROUTER_API_KEY") ? "openrouter" : "openai");
  const apiKey = secret?.value ?? (provider === "openrouter" ? env("OPENROUTER_API_KEY") : env("OPENAI_API_KEY")) ?? env("OPENAI_API_KEY");
  const modelId = requestedModelId ?? effective?.modelId ?? env("SOCIETYER_AI_MODEL") ?? (provider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini");
  const baseURL = effective?.baseUrl || (provider === "openrouter" ? OPENROUTER_BASE_URL : undefined);
  const openai = apiKey ? createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null;
  const model = openai
    ? provider === "openrouter" || provider === "openai-compatible"
      ? openai.chat(modelId)
      : openai(modelId)
    : null;
  return {
    modelId,
    model,
  };
}

function sse(data: unknown, event?: string) {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function normalizePhone(value?: string | null) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string) {
  return toHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function constantTimeStringEqual(left: string, right: string) {
  if (!left || !right) return false;
  const [leftHash, rightHash] = await Promise.all([
    sha256Hex(left),
    sha256Hex(right),
  ]);
  let diff = 0;
  for (let i = 0; i < leftHash.length; i += 1) {
    diff |= leftHash.charCodeAt(i) ^ rightHash.charCodeAt(i);
  }
  return left.length === right.length && diff === 0;
}

function timestampWithinTolerance(timestampSeconds: string) {
  const timestampMs = Number(timestampSeconds) * 1000;
  if (!Number.isFinite(timestampMs)) return false;
  return Math.abs(Date.now() - timestampMs) <= WEBHOOK_TOLERANCE_MS;
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
  if (!timestampWithinTolerance(timestamp)) return false;

  const expected = await signStripePayload(secret, `${timestamp}.${body}`);

  for (const signature of signatures) {
    if (await constantTimeStringEqual(signature, expected)) return true;
  }
  return false;
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

function base64ToBytes(value: string) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary =
    typeof globalThis.atob === "function"
      ? globalThis.atob(normalized)
      : Buffer.from(normalized, "base64").toString("binary");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signSvixPayload(secret: string, payload: string) {
  const secretBody = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secretBody),
    { name: "HMAC", hash: "SHA-256" },
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

function versionedSignatures(header: string | null, version: string) {
  return String(header ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [receivedVersion, signature] = part.split(",");
      return receivedVersion === version && signature ? [signature] : [];
    });
}

async function verifyResendSignature(body: string, request: Request) {
  const secret = env("RESEND_WEBHOOK_SECRET");
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatureHeader = request.headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  if (!timestampWithinTolerance(timestamp)) return false;

  const expected = await signSvixPayload(secret, `${id}.${timestamp}.${body}`);
  for (const signature of versionedSignatures(signatureHeader, "v1")) {
    if (await constantTimeStringEqual(signature, expected)) return true;
  }
  return false;
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
  return await constantTimeStringEqual(expected, signatureHeader);
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
    await ctx.runMutation(internal.subscriptions.handleStripeEvent, {
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
    if (!(await verifyResendSignature(body, request))) {
      return new Response("Invalid Resend signature", { status: 400 });
    }
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
        await ctx.runMutation(internal.communications._recordDelivery, {
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
        await ctx.runMutation(internal.communications._recordDelivery, {
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
