// Convex / connector-runner call helpers extracted from api-gateway.ts:
// ConvexCall builders, convexCall dispatch, connector-runner HTTP, connector-run
// recording, and webhook emission/delivery.

import crypto from "node:crypto";
import { Request } from "express";
import { ConvexHttpClient } from "convex/browser";
import { recordConnectorRun as recordConnectorRunHistory } from "../integrations/connector-run-recorder";
import {
  functionRef,
  sanitizeDto,
  EVENT_TYPES,
  apiPlatformServiceToken,
  decryptSecret,
  httpError,
  societyIdFrom,
  safeJson,
  stringValue,
} from "./shared";
import type { ConvexCall, Actor } from "./shared";

async function emitWebhookEvent(client: ConvexHttpClient, actor: Actor, type: string, data: unknown) {
  if (!actor.societyId || !EVENT_TYPES.includes(type as any)) return;
  const event = {
    id: crypto.randomUUID(),
    type,
    createdAtISO: new Date().toISOString(),
    data: sanitizeDto(data),
    actor: {
      type: actor.type,
      clientId: actor.clientId,
      userId: actor.userId,
    },
  };
  const subscriptions = await convexCall(client, query("apiPlatform.listWebhookSubscriptionsForEvent"), {
    societyId: actor.societyId,
    eventType: type,
    serviceToken: apiPlatformServiceToken(),
  });
  for (const subscription of subscriptions ?? []) {
    void deliverWebhook(client, subscription, event, 0);
  }
}

async function connectorRunnerRequest(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  // Treat an empty/whitespace value as unset (compose injects "" when the var
  // is not provided) so it falls back to the default rather than fetching "".
  const baseUrl = process.env.CONNECTOR_RUNNER_BASE_URL?.trim() || "http://127.0.0.1:8890";
  const secret = process.env.CONNECTOR_RUNNER_SECRET;
  const response = await fetch(new URL(path, baseUrl).toString(), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(secret ? { "x-connector-runner-secret": secret } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const message = data?.message ?? data?.error ?? `Connector runner returned ${response.status}.`;
    throw httpError(response.status, "connector_runner_error", message);
  }
  return data;
}

async function recordConnectorRun(
  client: ConvexHttpClient,
  req: Request,
  input: {
    connectorId: string;
    actionId: string;
    sessionId?: string;
    output?: any;
    error?: string;
  },
) {
  return await recordConnectorRunHistory(client, convexCall, {
    societyId: societyIdFrom(req, req.actor!),
    connectorId: input.connectorId,
    actionId: input.actionId,
    profileKey: stringValue(input.output?.profileKey ?? req.body?.profileKey),
    sessionId: input.sessionId,
    output: input.output,
    error: input.error,
    triggeredByUserId: req.actor?.userId,
  });
}

async function deliverWebhook(client: ConvexHttpClient, subscription: any, event: any, attemptsAlready: number) {
  const body = JSON.stringify(event);
  const timestamp = new Date().toISOString();
  const secret = decryptSecret(subscription.secretEncrypted);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const deliveryId = await convexCall(client, mutation("apiPlatform.createWebhookDelivery"), {
    societyId: subscription.societyId,
    subscriptionId: subscription._id,
    eventId: event.id,
    eventType: event.type,
    payloadJson: body,
    status: "pending",
    attempts: attemptsAlready,
    serviceToken: apiPlatformServiceToken(),
  });

  const attemptNumber = attemptsAlready + 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(subscription.targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Societyer-Event-Id": event.id,
        "X-Societyer-Timestamp": timestamp,
        "X-Societyer-Signature": `v1=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw Object.assign(new Error(`Webhook returned ${response.status}`), {
        statusCode: response.status,
      });
    }
    await convexCall(client, mutation("apiPlatform.updateWebhookDelivery"), {
      id: deliveryId,
      status: "delivered",
      attempts: attemptNumber,
      lastStatusCode: response.status,
      deliveredAtISO: new Date().toISOString(),
      serviceToken: apiPlatformServiceToken(),
    });
  } catch (error: any) {
    clearTimeout(timeout);
    const retryDelay = [60_000, 300_000, 1_800_000][attemptsAlready];
    const shouldRetry = attemptNumber < 3 && retryDelay;
    await convexCall(client, mutation("apiPlatform.updateWebhookDelivery"), {
      id: deliveryId,
      status: shouldRetry ? "pending" : "failed",
      attempts: attemptNumber,
      nextAttemptAtISO: shouldRetry ? new Date(Date.now() + retryDelay).toISOString() : undefined,
      lastStatusCode: error?.statusCode,
      lastError: error?.message ?? "Webhook delivery failed.",
      serviceToken: apiPlatformServiceToken(),
    });
    if (shouldRetry) {
      setTimeout(() => {
        void deliverWebhook(client, subscription, event, attemptNumber);
      }, retryDelay);
    }
  }
}

function query(name: string): ConvexCall {
  return { kind: "query", name };
}

function mutation(name: string): ConvexCall {
  return { kind: "mutation", name };
}

function action(name: string): ConvexCall {
  return { kind: "action", name };
}

async function convexCall(client: ConvexHttpClient, call: ConvexCall, args: Record<string, unknown>) {
  const ref = functionRef(call.name);
  if (call.kind === "query") return await client.query(ref as any, args);
  if (call.kind === "mutation") return await client.mutation(ref as any, args);
  return await client.action(ref as any, args);
}

export {
  emitWebhookEvent,
  connectorRunnerRequest,
  recordConnectorRun,
  deliverWebhook,
  query,
  mutation,
  action,
  convexCall,
};
