// Shared foundations for the API gateway: request/response types, OpenAPI zod
// schemas, constants, and generic request/auth/crypto/serialization helpers.
// Extracted from api-gateway.ts so route groups can depend on one foundation
// module (one-way dependency: api-gateway -> {routes} -> shared).

import "../env";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { NextFunction, Request, Response, Router } from "express";
import swaggerUi from "swagger-ui-express";
import { ConvexHttpClient } from "convex/browser";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { api } from "../../convex/_generated/api";
import { listPermissionsForRole } from "../../convex/lib/permissions";
import {
  buildPdfTableImportBundle,
  normalizePdfTableStructures,
} from "../../convex/lib/pdfTableNormalization";
import { auth, getAuthMode } from "../auth-config";
import {
  importGcosProjectSnapshotViaConvex,
  normalizeGcosExportedSnapshot,
} from "../gcos-import";
import { recordConnectorRun as recordConnectorRunHistory } from "../integrations/connector-run-recorder";
import { stageConnectorImportSession } from "../integrations/staged-imports";
import { waveTransactionsImportBundle } from "../integrations/wave-staging";
import { gcosProjectSnapshotImportBundle } from "../integrations/gcos-staging";
import {
  bcRegistryFilingHistoryBundle,
  bcRegistryGovernanceDocumentsBundle,
  type BcRegistryCsvRecord,
  type GovernanceImportCandidate,
} from "../integrations/bc-registry-staging";


extendZodWithOpenApi(z);

type ConvexCall = { kind: "query" | "mutation" | "action"; name: string };
type Scope = string;
type Actor = {
  type: "api-key" | "better-auth" | "local-dev";
  societyId?: string;
  userId?: string;
  clientId?: string;
  scopes: string[];
  role?: string;
};

type ResourceRoute = {
  name: string;
  tag: string;
  scope: string;
  list?: ConvexCall;
  get?: ConvexCall;
  create?: ConvexCall;
  update?: ConvexCall;
  remove?: ConvexCall;
  createEvent?: string;
  updateEvent?: string;
  deleteEvent?: string;
  createArgs?: (req: Request, actor: Actor) => Record<string, unknown>;
  updateArgs?: (req: Request, actor: Actor) => Record<string, unknown>;
  listArgs?: (req: Request, actor: Actor) => Record<string, unknown>;
  getArgs?: (req: Request, actor: Actor) => Record<string, unknown>;
  removeArgs?: (req: Request, actor: Actor) => Record<string, unknown>;
};

type ActionRoute = {
  method: "post";
  path: string;
  tag: string;
  operationId: string;
  scope: Scope;
  call: ConvexCall;
  args: (req: Request, actor: Actor) => Record<string, unknown>;
  event?: string;
};

const RequestBodySchema = z.record(z.string(), z.unknown()).openapi("ApiRequestBody");
const ApiResourceSchema = z.record(z.string(), z.unknown()).openapi("ApiResource");
const ApiListSchema = z
  .object({
    data: z.array(ApiResourceSchema),
    meta: z.object({ count: z.number() }),
  })
  .openapi("ApiListResponse");
const ApiSingleSchema = z.object({ data: ApiResourceSchema }).openapi("ApiSingleResponse");
const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi("ApiError");

const EVENT_TYPES = [
  "member.created",
  "member.updated",
  "member.deleted",
  "director.created",
  "director.updated",
  "director.deleted",
  "document.created",
  "document.uploaded",
  "document.archived",
  "filing.created",
  "filing.markedFiled",
  "meeting.created",
  "meeting.updated",
  "minutes.created",
  "minutes.updated",
  "minutes.approved",
  "task.created",
  "task.updated",
  "task.completed",
  "task.deleted",
  "grant.applicationSubmitted",
  "grant.reviewed",
  "volunteer.applicationSubmitted",
  "volunteer.reviewed",
  "election.closed",
  "election.tallied",
] as const;

const SENSITIVE_KEYS = new Set([
  "_creationTime",
  "storageId",
  "storageKey",
  "tokenHash",
  "secretEncrypted",
  "payloadJson",
  "providerPayload",
  "rawPayload",
]);


function functionRef(name: string) {
  return name.split(".").reduce((ref: any, part) => ref[part], api as any);
}

function singleResponse(data: unknown) {
  return { data: sanitizeDto(data) };
}

function listResponse(rows: unknown[]) {
  const data = rows.map(sanitizeDto);
  return { data, meta: { count: data.length } };
}

function sanitizeDto(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDto);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (key === "_id") {
      output.id = raw;
      continue;
    }
    if (key.endsWith("Json") && typeof raw === "string") {
      const dtoKey = key.slice(0, -"Json".length);
      try {
        output[dtoKey] = sanitizeDto(JSON.parse(raw));
      } catch {
        output[dtoKey] = raw;
      }
      continue;
    }
    if (key.startsWith("_")) continue;
    output[key] = sanitizeDto(raw);
  }
  return output;
}

function stripActor(body: any) {
  const copy = { ...(body ?? {}) };
  delete copy.actingUserId;
  return copy;
}

function bodyWithSociety(req: Request, actor: Actor) {
  return { societyId: societyIdFrom(req, actor), ...stripActor(req.body) };
}

function bodyWithIdAndSociety(req: Request, actor: Actor) {
  return { id: req.params.id, societyId: societyIdFrom(req, actor), ...stripActor(req.body) };
}

function withActingUser<T extends Record<string, unknown>>(args: T, actor: Actor): T {
  if (!actor.userId) return args;
  return { ...args, actingUserId: actor.userId };
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function societyIdFrom(req: Request, actor: Actor) {
  const value = optionalSocietyIdFrom(req) ?? actor.societyId;
  if (!value) throw httpError(400, "society_required", "societyId is required.");
  return value;
}

function optionalSocietyIdFrom(req: Request) {
  return (
    stringQuery(req.query.societyId) ??
    stringQuery(req.params.societyId) ??
    (typeof req.body?.societyId === "string" ? req.body.societyId : undefined)
  );
}

function stringQuery(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberQuery(value: unknown) {
  if (typeof value !== "string" || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function booleanQuery(value: unknown) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizeScopes(value: unknown) {
  if (!Array.isArray(value)) return ["society:read"];
  return value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
}

function normalizeEventTypes(value: unknown) {
  if (!Array.isArray(value)) return ["*"];
  const events = value.filter((event): event is string => typeof event === "string" && event.length > 0);
  return events.length ? events : ["*"];
}

function extractApiToken(req: Request) {
  const header = req.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.get("x-api-key")?.trim() || null;
}

function hashApiToken(token: string) {
  const pepper = apiTokenPepper();
  return crypto.createHmac("sha256", pepper).update(token).digest("hex");
}

function apiTokenPepper() {
  const pepper = process.env.API_TOKEN_PEPPER;
  if (pepper) return pepper;
  if (process.env.NODE_ENV === "production") {
    throw httpError(500, "api_token_pepper_missing", "API_TOKEN_PEPPER is required in production.");
  }
  return "societyer-local-dev-token-pepper";
}

function createApiToken() {
  return `soc_${crypto.randomBytes(32).toString("base64url")}`;
}

function createWebhookSecret() {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

function apiPlatformServiceToken() {
  const configured =
    process.env.SOCIETYER_API_PLATFORM_TOKEN ??
    process.env.CONVEX_INSTANCE_SECRET;
  if (configured) return configured;
  throw httpError(
    500,
    "api_platform_service_token_missing",
    "SOCIETYER_API_PLATFORM_TOKEN or CONVEX_INSTANCE_SECRET is required.",
  );
}

function maintenanceServiceToken() {
  const configured =
    process.env.SOCIETYER_MAINTENANCE_TOKEN ??
    process.env.CONVEX_INSTANCE_SECRET;
  if (configured) return configured;
  throw httpError(
    500,
    "maintenance_token_missing",
    "SOCIETYER_MAINTENANCE_TOKEN or CONVEX_INSTANCE_SECRET is required.",
  );
}

function encryptionKey() {
  const configured = process.env.API_SECRET_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();
  if (process.env.NODE_ENV === "production") {
    throw httpError(500, "api_secret_key_missing", "API_SECRET_ENCRYPTION_KEY is required in production.");
  }
  return crypto.createHash("sha256").update("societyer-local-dev-secret-key").digest();
}

function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value: string) {
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== "v1") throw new Error("Unsupported webhook secret version.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function isLocalRequest(req: Request) {
  const remote = req.ip || req.socket.remoteAddress || "";
  const host = req.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    remote === "::1" ||
    remote === "127.0.0.1" ||
    remote.endsWith("127.0.0.1")
  );
}

function headersFromRequest(req: Request) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value != null) headers.set(key, String(value));
  }
  return headers;
}

function scopeAllows(scopes: string[], requiredScope: string) {
  if (scopes.includes("*") || scopes.includes(requiredScope)) return true;
  const [resource] = requiredScope.split(":");
  return scopes.includes(`${resource}:*`);
}

function roleAllows(role: string | undefined, requiredScope: string) {
  if (!role) return false;
  return scopeAllows([...listPermissionsForRole(role)], requiredScope);
}

function assignRequestId(req: Request, res: Response, next: NextFunction) {
  const requestId = req.get("x-request-id") || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

function asyncHandler<T extends (...args: any[]) => Promise<any>>(handler: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function apiErrorHandler(error: any, req: Request, res: Response, _next: NextFunction) {
  const status = error?.statusCode ?? error?.status ?? 500;
  const code = error?.code ?? "internal_error";
  const message = status >= 500 ? error?.message ?? "Internal server error." : error?.message;
  res.status(status).json({
    error: {
      code,
      message,
      requestId: req.requestId ?? "unknown",
    },
  });
}

function httpError(statusCode: number, code: string, message: string) {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function operationId(verb: string, resourceName: string) {
  const words = `${verb}-${resourceName}`
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1));
  return `${words[0]?.toLowerCase() ?? "op"}${words.slice(1).join("")}`;
}

function jsonBody(schema: z.ZodTypeAny) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
  };
}

function responses(schema: z.ZodTypeAny, successStatus = 200) {
  return {
    [successStatus]: {
      description: "Success",
      content: {
        "application/json": {
          schema,
        },
      },
    },
    ...errorResponses(),
  };
}

function errorResponses() {
  return {
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
  };
}

function security() {
  return [{ bearerApiKey: [] }, { xApiKey: [] }] as Record<string, string[]>[];
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      actor?: Actor;
    }
  }
}


export {
  RequestBodySchema,
  ApiResourceSchema,
  ApiListSchema,
  ApiSingleSchema,
  ApiErrorSchema,
  EVENT_TYPES,
  SENSITIVE_KEYS,
  functionRef,
  singleResponse,
  listResponse,
  sanitizeDto,
  stripActor,
  bodyWithSociety,
  bodyWithIdAndSociety,
  withActingUser,
  dropUndefined,
  societyIdFrom,
  optionalSocietyIdFrom,
  stringQuery,
  numberQuery,
  booleanQuery,
  normalizeScopes,
  normalizeEventTypes,
  extractApiToken,
  hashApiToken,
  apiTokenPepper,
  createApiToken,
  createWebhookSecret,
  apiPlatformServiceToken,
  maintenanceServiceToken,
  encryptionKey,
  encryptSecret,
  decryptSecret,
  isLocalRequest,
  headersFromRequest,
  scopeAllows,
  roleAllows,
  assignRequestId,
  asyncHandler,
  apiErrorHandler,
  httpError,
  operationId,
  jsonBody,
  responses,
  errorResponses,
  security,
};

export type {
  ConvexCall,
  Scope,
  Actor,
  ResourceRoute,
  ActionRoute,
};


// --- generic serialization helpers (moved from api-gateway.ts) ---
function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function arrayOf(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function compactStrings(values: unknown[]) {
  return values.map(stringValue).filter((value): value is string => Boolean(value));
}

export {
  safeJson,
  arrayOf,
  stringValue,
  compactStrings,
};
