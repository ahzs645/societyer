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
import { nodeDevelopmentPolicy, requestOutboundUrl } from "../outbound-url-policy";

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

function connectorTenantKey(societyId: string): string {
  const signingKey = process.env.CONNECTOR_TENANT_KEY_SECRET?.trim()
    || process.env.CONNECTOR_RUNNER_SECRET?.trim()
    || (process.env.NODE_ENV === "production" ? "" : "societyer-local-dev-connector-tenant-key");
  if (!signingKey) {
    throw httpError(500, "connector_tenant_key_unavailable", "Connector tenant signing is not configured.");
  }
  const digest = crypto.createHmac("sha256", signingKey)
    .update(`society\0${societyId}`)
    .digest("base64url");
  return `ct1_${digest}`;
}

function connectorTenantContext(req: Request): { societyId: string; tenantKey: string } {
  const societyId = societyIdFrom(req, req.actor!);
  return { societyId, tenantKey: connectorTenantKey(societyId) };
}

function withConnectorOwnership(value: unknown, societyId: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.sessions)) {
    return {
      ...record,
      sessions: record.sessions.map((session) => withConnectorOwnership(session, societyId)),
    };
  }
  return {
    ...record,
    societyId,
    ...(typeof record.profileKey === "string" ? { profileSocietyId: societyId } : {}),
    ...(typeof record.sessionId === "string" ? { sessionSocietyId: societyId } : {}),
  };
}

async function connectorRunnerRequest(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  tenantKey?: string,
) {
  // Treat an empty/whitespace value as unset (compose injects "" when the var
  // is not provided) so it falls back to the default rather than fetching "".
  const baseUrl = process.env.CONNECTOR_RUNNER_BASE_URL?.trim() || "http://127.0.0.1:8890";
  const secret = process.env.CONNECTOR_RUNNER_SECRET;
  const internalBody = body ? { ...body } : undefined;
  if (internalBody) {
    delete internalBody.tenantKey;
    delete internalBody.societyId;
    delete internalBody.profileSocietyId;
    delete internalBody.sessionSocietyId;
  }
  const response = await requestOutboundUrl(new URL(path, baseUrl).toString(), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(secret ? { "x-connector-runner-secret": secret } : {}),
      ...(tenantKey ? { "x-connector-tenant-key": tenantKey } : {}),
    },
    body: internalBody ? JSON.stringify(internalBody) : undefined,
    policy: nodeDevelopmentPolicy(),
    connectTimeoutMs: 3_000,
    readTimeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
  });
  const text = response.text;
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
  const societyId = societyIdFrom(req, req.actor!);
  const profileKey = stringValue(input.output?.profileKey ?? req.body?.profileKey);
  return await recordConnectorRunHistory(client, convexCall, {
    societyId,
    connectorId: input.connectorId,
    actionId: input.actionId,
    profileKey,
    profileSocietyId: profileKey ? societyId : undefined,
    sessionId: input.sessionId,
    sessionSocietyId: input.sessionId ? societyId : undefined,
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
  try {
    const response = await requestOutboundUrl(subscription.targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Societyer-Event-Id": event.id,
        "X-Societyer-Timestamp": timestamp,
        "X-Societyer-Signature": `v1=${signature}`,
      },
      body,
      policy: nodeDevelopmentPolicy(),
      connectTimeoutMs: 3_000,
      readTimeoutMs: 5_000,
      maxResponseBytes: 128_000,
    });
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
  } catch (error: unknown) {
    const failure: Error & { statusCode?: number } = error instanceof Error
      ? error as Error & { statusCode?: number }
      : new Error("Webhook delivery failed.");
    const retryDelay = [60_000, 300_000, 1_800_000][attemptsAlready];
    const shouldRetry = attemptNumber < 3 && retryDelay;
    await convexCall(client, mutation("apiPlatform.updateWebhookDelivery"), {
      id: deliveryId,
      status: shouldRetry ? "pending" : "failed",
      attempts: attemptNumber,
      nextAttemptAtISO: shouldRetry ? new Date(Date.now() + retryDelay).toISOString() : undefined,
      lastStatusCode: failure.statusCode,
      lastError: failure.message,
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
  connectorTenantContext,
  withConnectorOwnership,
  recordConnectorRun,
  deliverWebhook,
  query,
  mutation,
  action,
  convexCall,
};
