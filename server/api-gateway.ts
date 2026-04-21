import "./env";
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
import { api } from "../convex/_generated/api";
import { listPermissionsForRole } from "../convex/lib/permissions";
import { auth, getAuthMode } from "./auth-config";

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

const RESOURCE_ROUTES: ResourceRoute[] = [
  resource("societies", "System", "society", {
    list: query("society.list"),
    create: mutation("society.upsert"),
    update: mutation("society.upsert"),
    listArgs: () => ({}),
    createArgs: (req) => stripActor(req.body),
    updateArgs: (req) => ({ id: req.params.id, ...stripActor(req.body) }),
  }),
  resource("users", "System", "users", {
    list: query("users.list"),
    get: query("users.get"),
    create: mutation("users.upsert"),
    update: mutation("users.upsert"),
    remove: mutation("users.remove"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("members", "People", "members", crud("members")),
  resource("directors", "People", "directors", collection("directors")),
  resource("employees", "People", "employees", collection("employees")),
  resource("committees", "People", "committees", crud("committees")),
  resource("committee-members", "People", "committees", {
    create: mutation("committees.addMember"),
    remove: mutation("committees.removeMember"),
  }),
  resource("volunteers", "People", "volunteers", {
    list: query("volunteers.list"),
    create: mutation("volunteers.upsertVolunteer"),
    update: mutation("volunteers.upsertVolunteer"),
    remove: mutation("volunteers.removeVolunteer"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("volunteer-applications", "People", "volunteers", {
    list: query("volunteers.applications"),
    create: mutation("volunteers.submitApplication"),
    createEvent: "volunteer.applicationSubmitted",
  }),
  resource("volunteer-screenings", "People", "volunteers", {
    list: query("volunteers.screenings"),
    create: mutation("volunteers.upsertScreening"),
    update: mutation("volunteers.upsertScreening"),
    remove: mutation("volunteers.removeScreening"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("meetings", "Governance", "meetings", {
    ...crud("meetings"),
    createEvent: "meeting.created",
    updateEvent: "meeting.updated",
  }),
  resource("minutes", "Governance", "minutes", {
    list: query("minutes.list"),
    create: mutation("minutes.create"),
    update: mutation("minutes.update"),
    createEvent: "minutes.created",
    updateEvent: "minutes.updated",
  }),
  resource("agendas", "Governance", "agendas", {
    list: query("agendas.listForSociety"),
    get: query("agendas.get"),
    create: mutation("agendas.create"),
    update: mutation("agendas.updateAgenda"),
    remove: mutation("agendas.remove"),
  }),
  resource("agenda-items", "Governance", "agendas", {
    create: mutation("agendas.addItem"),
    update: mutation("agendas.updateItem"),
    remove: mutation("agendas.removeItem"),
  }),
  resource("motion-templates", "Governance", "motions", {
    list: query("motionTemplates.list"),
    create: mutation("motionTemplates.create"),
    update: mutation("motionTemplates.update"),
    remove: mutation("motionTemplates.remove"),
  }),
  resource("elections", "Governance", "elections", {
    list: query("elections.list"),
    get: query("elections.get"),
    create: mutation("elections.create"),
    update: mutation("elections.updateSettings"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) =>
      withActingUser({ electionId: req.params.id, ...stripActor(req.body) }, actor),
  }),
  resource("election-nominations", "Governance", "elections", {
    list: query("elections.listNominations"),
    create: mutation("elections.submitNomination"),
    listArgs: (req, actor) => ({
      electionId: stringQuery(req.query.electionId),
      actingUserId: actor.userId,
    }),
    createArgs: (req, actor) => withActingUser(stripActor(req.body), actor),
  }),
  resource("proxies", "Governance", "proxies", {
    list: query("proxies.list"),
    create: mutation("proxies.create"),
    remove: mutation("proxies.remove"),
  }),
  resource("written-resolutions", "Governance", "motions", {
    list: query("writtenResolutions.list"),
    create: mutation("writtenResolutions.create"),
    remove: mutation("writtenResolutions.remove"),
  }),
  resource("member-proposals", "Governance", "motions", collection("memberProposals")),
  resource("conflicts", "Governance", "conflicts", {
    list: query("conflicts.list"),
    create: mutation("conflicts.create"),
    remove: mutation("conflicts.remove"),
  }),
  resource("attestations", "Governance", "attestations", {
    list: query("attestations.list"),
    create: mutation("attestations.sign"),
    remove: mutation("attestations.remove"),
  }),
  resource("auditors", "Governance", "auditors", collection("auditors")),
  resource("court-orders", "Governance", "courtOrders", {
    list: query("courtOrders.list"),
    create: mutation("courtOrders.create"),
    remove: mutation("courtOrders.remove"),
  }),
  resource("bylaw-rules", "Governance", "settings", {
    list: query("bylawRules.getActive"),
    create: mutation("bylawRules.upsertActive"),
    update: mutation("bylawRules.upsertActive"),
    listArgs: (req, actor) => ({ societyId: societyIdFrom(req, actor) }),
    updateArgs: (req, actor) => bodyWithIdAndSociety(req, actor),
  }),
  resource("bylaw-amendments", "Governance", "filings", {
    list: query("bylawAmendments.list"),
    get: query("bylawAmendments.get"),
    create: mutation("bylawAmendments.createDraft"),
    update: mutation("bylawAmendments.updateDraft"),
    remove: mutation("bylawAmendments.remove"),
  }),
  resource("filings", "Compliance", "filings", {
    ...crud("filings"),
    createEvent: "filing.created",
  }),
  resource("deadlines", "Compliance", "deadlines", {
    list: query("deadlines.list"),
    create: mutation("deadlines.create"),
    remove: mutation("deadlines.remove"),
  }),
  resource("documents", "Compliance", "documents", {
    list: query("documents.list"),
    create: mutation("documents.create"),
    remove: mutation("documents.remove"),
    createEvent: "document.created",
  }),
  resource("document-versions", "Compliance", "documents", {
    list: query("documentVersions.listForDocument"),
    get: query("documentVersions.get"),
    create: mutation("documentVersions.recordUploadedVersion"),
    createEvent: "document.uploaded",
    listArgs: (req) => ({ documentId: stringQuery(req.query.documentId) }),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
  }),
  resource("inspections", "Compliance", "documents", {
    list: query("inspections.list"),
    create: mutation("inspections.create"),
    remove: mutation("inspections.remove"),
  }),
  resource("pipa-training", "Compliance", "documents", {
    list: query("pipaTraining.list"),
    create: mutation("pipaTraining.create"),
    remove: mutation("pipaTraining.remove"),
  }),
  resource("publications", "Public", "settings", {
    list: query("transparency.listPublications"),
    create: mutation("transparency.upsertPublication"),
    update: mutation("transparency.upsertPublication"),
    remove: mutation("transparency.removePublication"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("financials", "Finance", "financials", collection("financials")),
  resource("treasurer-profit-and-loss", "Finance", "financials", {
    list: query("treasury.profitAndLoss"),
    listArgs: (req, actor) => ({
      societyId: societyIdFrom(req, actor),
      from: stringQuery(req.query.from) ?? `${new Date().getFullYear()}-01-01`,
      to: stringQuery(req.query.to) ?? new Date().toISOString().slice(0, 10),
    }),
  }),
  resource("financial-connections", "Finance", "financials", {
    list: query("financialHub.connections"),
    create: mutation("financialHub.markConnectionConnected"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
  }),
  resource("financial-accounts", "Finance", "financials", {
    list: query("financialHub.accounts"),
  }),
  resource("financial-transactions", "Finance", "financials", {
    list: query("financialHub.transactions"),
    listArgs: (req, actor) => ({
      societyId: societyIdFrom(req, actor),
      limit: numberQuery(req.query.limit),
    }),
  }),
  resource("budgets", "Finance", "financials", {
    list: query("financialHub.budgets"),
    create: mutation("financialHub.upsertBudget"),
    update: mutation("financialHub.upsertBudget"),
    remove: mutation("financialHub.removeBudget"),
    listArgs: (req, actor) => ({
      societyId: societyIdFrom(req, actor),
      fiscalYear: stringQuery(req.query.fiscalYear),
    }),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("grants", "Finance", "grants", {
    list: query("grants.list"),
    create: mutation("grants.upsertGrant"),
    update: mutation("grants.upsertGrant"),
    remove: mutation("grants.removeGrant"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("grant-applications", "Finance", "grants", {
    list: query("grants.applications"),
    create: mutation("grants.submitApplication"),
    createEvent: "grant.applicationSubmitted",
  }),
  resource("grant-reports", "Finance", "grants", {
    list: query("grants.reports"),
    create: mutation("grants.upsertReport"),
    update: mutation("grants.upsertReport"),
    remove: mutation("grants.removeReport"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("grant-transactions", "Finance", "grants", {
    list: query("grants.transactions"),
    create: mutation("grants.upsertTransaction"),
    update: mutation("grants.upsertTransaction"),
    remove: mutation("grants.removeTransaction"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("reconciliation", "Finance", "financials", {
    list: query("reconciliation.overview"),
  }),
  resource("receipts", "Finance", "financials", {
    list: query("receipts.list"),
    create: mutation("receipts.issue"),
    remove: mutation("receipts.remove"),
  }),
  resource("subscription-plans", "Finance", "settings", {
    list: query("subscriptions.plans"),
    create: mutation("subscriptions.upsertPlan"),
    update: mutation("subscriptions.upsertPlan"),
    remove: mutation("subscriptions.removePlan"),
    createArgs: (req, actor) => withActingUser(bodyWithSociety(req, actor), actor),
    updateArgs: (req, actor) => withActingUser(bodyWithIdAndSociety(req, actor), actor),
    removeArgs: (req, actor) => withActingUser({ id: req.params.id }, actor),
  }),
  resource("member-subscriptions", "Finance", "financials", {
    list: query("subscriptions.allSubscriptions"),
  }),
  resource("insurance", "Finance", "financials", collection("insurance")),
  resource("notifications", "System", "settings", {
    list: query("notifications.list"),
    create: mutation("notifications.create"),
    listArgs: (req, actor) => ({
      societyId: societyIdFrom(req, actor),
      userId: req.query.userId,
      limit: numberQuery(req.query.limit),
      unreadOnly: booleanQuery(req.query.unreadOnly),
    }),
  }),
  resource("tasks", "System", "tasks", {
    ...collection("tasks"),
    createEvent: "task.created",
    updateEvent: "task.updated",
    deleteEvent: "task.deleted",
  }),
  resource("audit", "System", "audit", {
    list: query("activity.list"),
  }),
  resource("exports", "System", "exports", {
    list: query("exports.listExportableTables"),
    listArgs: () => ({}),
  }),
  resource("paperless-status", "Integrations", "documents", {
    list: query("paperless.connectionStatus"),
  }),
];

const ACTION_ROUTES: ActionRoute[] = [
  actionRoute("/filings/:id/mark-filed", "Compliance", "filings:submit", mutation("filings.markFiled"), (req, actor) => ({
    id: req.params.id,
    ...stripActor(req.body),
    submittedByUserId: req.body?.submittedByUserId ?? actor.userId,
    attestedByUserId: req.body?.attestedByUserId ?? actor.userId,
  }), "filing.markedFiled"),
  actionRoute("/documents/:id/archive", "Compliance", "documents:write", mutation("documents.archive"), (req) => ({
    id: req.params.id,
    reason: req.body?.reason ?? "Archived through API",
  }), "document.archived"),
  actionRoute("/documents/:id/flag-for-deletion", "Compliance", "documents:write", mutation("documents.flagForDeletion"), (req) => ({
    id: req.params.id,
    flagged: Boolean(req.body?.flagged),
  })),
  actionRoute("/document-versions/:id/rollback", "Compliance", "documents:write", mutation("documentVersions.rollback"), (req, actor) => ({
    versionId: req.params.id,
    actingUserId: actor.userId,
  })),
  actionRoute("/minutes/:id/approve", "Governance", "minutes:approve", mutation("minutes.update"), (req) => ({
    id: req.params.id,
    patch: {
      approvedAt: req.body?.approvedAt ?? new Date().toISOString(),
      approvedInMeetingId: req.body?.approvedInMeetingId,
    },
  }), "minutes.approved"),
  actionRoute("/deadlines/:id/toggle-done", "Compliance", "deadlines:write", mutation("deadlines.toggleDone"), (req) => ({
    id: req.params.id,
    done: Boolean(req.body?.done),
  })),
  actionRoute("/tasks/:id/toggle-complete", "People", "tasks:write", mutation("tasks.update"), (req) => ({
    id: req.params.id,
    patch: { status: req.body?.done === false ? "Todo" : "Done" },
  }), "task.completed"),
  actionRoute("/conflicts/:id/resolve", "Governance", "conflicts:write", mutation("conflicts.resolve"), (req) => ({
    id: req.params.id,
    resolvedAt: req.body?.resolvedAt ?? new Date().toISOString(),
  })),
  actionRoute("/elections/:id/close", "Governance", "elections:tally", mutation("elections.close"), (req, actor) => ({
    electionId: req.params.id,
    actingUserId: actor.userId,
  }), "election.closed"),
  actionRoute("/elections/:id/tally", "Governance", "elections:tally", mutation("elections.tallyElection"), (req, actor) => ({
    electionId: req.params.id,
    resultsSummary: req.body?.resultsSummary,
    evidenceDocumentId: req.body?.evidenceDocumentId,
    actingUserId: actor.userId,
  }), "election.tallied"),
  actionRoute("/communications/campaigns/send", "People", "communications:write", action("communications.sendCampaign"), (req, actor) => ({
    ...stripActor(req.body),
    actingUserId: actor.userId,
  })),
  actionRoute("/grants/applications/:id/review", "Finance", "grants:write", mutation("grants.reviewApplication"), (req, actor) => ({
    id: req.params.id,
    status: req.body?.status,
    notes: req.body?.notes,
    actingUserId: actor.userId,
  }), "grant.reviewed"),
  actionRoute("/volunteer-applications/:id/review", "People", "volunteers:write", mutation("volunteers.reviewApplication"), (req, actor) => ({
    id: req.params.id,
    status: req.body?.status,
    actingUserId: actor.userId,
  }), "volunteer.reviewed"),
  actionRoute("/paperless/documents/:id/sync", "Integrations", "documents:write", action("paperless.syncDocument"), (req, actor) => ({
    documentId: req.params.id,
    societyId: societyIdFrom(req, actor),
    actingUserId: actor.userId,
  })),
];

export function mountApiGateway(app: express.Express) {
  const client = createConvexClient();
  const router = Router();
  const openApiDocument = buildOpenApiDocument();

  app.use(assignRequestId);
  app.get("/api/openapi.json", (_req, res) => res.json(openApiDocument));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  router.use(express.json({ limit: "10mb" }));

  mountPlatformRoutes(router, client);
  mountBrowserConnectorRoutes(router, client);
  mountWorkflowBridgeRoutes(router, client);
  for (const route of RESOURCE_ROUTES) mountResourceRoute(router, client, route);
  for (const route of ACTION_ROUTES) mountActionRoute(router, client, route);

  app.use("/api/v1", router);
  app.use(apiErrorHandler);
}

function createConvexClient() {
  const url =
    process.env.CONVEX_SELF_HOSTED_URL ??
    process.env.VITE_CONVEX_URL ??
    "http://127.0.0.1:3220";
  return new ConvexHttpClient(url);
}

function mountPlatformRoutes(router: Router, client: ConvexHttpClient) {
  router.get(
    "/api-clients",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rows = await convexCall(client, query("apiPlatform.listClients"), {
        societyId: societyIdFrom(req, req.actor!),
      });
      res.json(listResponse(rows));
    }),
  );

  router.post(
    "/api-clients",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const id = await convexCall(client, mutation("apiPlatform.createClient"), {
        societyId: societyIdFrom(req, req.actor!),
        name: req.body?.name,
        description: req.body?.description,
        kind: req.body?.kind,
        createdByUserId: req.actor?.userId,
      });
      await emitWebhookEvent(client, req.actor!, "plugin.clientCreated", { id });
      res.status(201).json(singleResponse({ id }));
    }),
  );

  router.patch(
    "/api-clients/:id",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      await convexCall(client, mutation("apiPlatform.updateClient"), {
        id: req.params.id,
        patch: stripActor(req.body),
      });
      res.json(singleResponse({ id: req.params.id }));
    }),
  );

  router.get(
    "/api-tokens",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rows = await convexCall(client, query("apiPlatform.listTokens"), {
        societyId: societyIdFrom(req, req.actor!),
        clientId: req.query.clientId,
      });
      res.json(listResponse(rows));
    }),
  );

  router.post(
    "/api-tokens",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rawToken = createApiToken();
      const tokenHash = hashApiToken(rawToken);
      const id = await convexCall(client, mutation("apiPlatform.createToken"), {
        societyId: societyIdFrom(req, req.actor!),
        clientId: req.body?.clientId,
        name: req.body?.name,
        tokenHash,
        tokenStart: rawToken.slice(0, 14),
        scopes: normalizeScopes(req.body?.scopes),
        expiresAtISO: req.body?.expiresAtISO,
        createdByUserId: req.actor?.userId,
      });
      res.status(201).json(singleResponse({ id, token: rawToken }));
    }),
  );

  router.post(
    "/api-tokens/:id/revoke",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      await convexCall(client, mutation("apiPlatform.revokeToken"), { id: req.params.id });
      res.json(singleResponse({ id: req.params.id, status: "revoked" }));
    }),
  );

  router.get(
    "/plugin-installations",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rows = await convexCall(client, query("apiPlatform.listPluginInstallations"), {
        societyId: societyIdFrom(req, req.actor!),
      });
      res.json(listResponse(rows));
    }),
  );

  router.post(
    "/plugin-installations",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const id = await convexCall(client, mutation("apiPlatform.upsertPluginInstallation"), {
        societyId: societyIdFrom(req, req.actor!),
        clientId: req.body?.clientId,
        name: req.body?.name,
        slug: req.body?.slug,
        status: req.body?.status,
        capabilities: Array.isArray(req.body?.capabilities) ? req.body.capabilities : [],
        configJson: req.body?.config == null ? undefined : JSON.stringify(req.body.config),
        installedByUserId: req.actor?.userId,
      });
      res.status(201).json(singleResponse({ id }));
    }),
  );

  router.get(
    "/webhook-subscriptions",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rows = await convexCall(client, query("apiPlatform.listWebhookSubscriptions"), {
        societyId: societyIdFrom(req, req.actor!),
      });
      res.json(listResponse(rows));
    }),
  );

  router.post(
    "/webhook-subscriptions",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rawSecret = createWebhookSecret();
      const secretEncrypted = encryptSecret(rawSecret);
      const id = await convexCall(client, mutation("apiPlatform.upsertWebhookSubscription"), {
        societyId: societyIdFrom(req, req.actor!),
        clientId: req.body?.clientId,
        pluginInstallationId: req.body?.pluginInstallationId,
        name: req.body?.name,
        targetUrl: req.body?.targetUrl,
        eventTypes: normalizeEventTypes(req.body?.eventTypes),
        secretEncrypted,
        status: req.body?.status,
        createdByUserId: req.actor?.userId,
      });
      res.status(201).json(singleResponse({ id, signingSecret: rawSecret }));
    }),
  );

  router.get(
    "/webhook-deliveries",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const rows = await convexCall(client, query("apiPlatform.listWebhookDeliveries"), {
        societyId: societyIdFrom(req, req.actor!),
        subscriptionId: req.query.subscriptionId,
      });
      res.json(listResponse(rows));
    }),
  );
}

function mountBrowserConnectorRoutes(router: Router, client: ConvexHttpClient) {
  router.get(
    "/browser-connectors/connectors",
    requireScope(client, "settings:manage"),
    asyncHandler(async (_req, res) => {
      res.json(await connectorRunnerRequest("GET", "/connectors"));
    }),
  );

  router.get(
    "/browser-connectors/health",
    requireScope(client, "settings:manage"),
    asyncHandler(async (_req, res) => {
      res.json(singleResponse(await connectorRunnerRequest("GET", "/healthz")));
    }),
  );

  router.get(
    "/browser-connectors/sessions",
    requireScope(client, "settings:manage"),
    asyncHandler(async (_req, res) => {
      res.json(await connectorRunnerRequest("GET", "/sessions"));
    }),
  );

  router.post(
    "/browser-connectors/sessions/start-login",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const body = stripActor(req.body ?? {});
      res.status(201).json(singleResponse(await connectorRunnerRequest("POST", "/sessions/start-login", body)));
    }),
  );

  router.post(
    "/browser-connectors/sessions/:sessionId/finish-login",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      res.json(singleResponse(await connectorRunnerRequest("POST", `/sessions/${encodeURIComponent(req.params.sessionId)}/finish-login`)));
    }),
  );

  router.post(
    "/browser-connectors/sessions/:sessionId/stop",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      res.json(singleResponse(await connectorRunnerRequest("POST", `/sessions/${encodeURIComponent(req.params.sessionId)}/stop`)));
    }),
  );

  router.post(
    "/browser-connectors/sessions/:sessionId/paste",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      res.json(singleResponse(await connectorRunnerRequest(
        "POST",
        `/sessions/${encodeURIComponent(req.params.sessionId)}/paste`,
        stripActor(req.body ?? {}),
      )));
    }),
  );

  router.post(
    "/browser-connectors/profiles/validate",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      res.json(singleResponse(await connectorRunnerRequest("POST", "/profiles/validate", stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/runs/open-page",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      res.json(singleResponse(await connectorRunnerRequest("POST", "/runs/open-page", stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/connectors/:connectorId/auth/start",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const connectorId = encodeURIComponent(String(req.params.connectorId));
      res.status(201).json(singleResponse(await connectorRunnerRequest("POST", `/connectors/${connectorId}/auth/start`, stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/connectors/:connectorId/auth/verify",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const connectorId = encodeURIComponent(String(req.params.connectorId));
      res.json(singleResponse(await connectorRunnerRequest("POST", `/connectors/${connectorId}/auth/verify`, stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/connectors/:connectorId/auth/sessions/:sessionId/confirm",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const connectorId = encodeURIComponent(String(req.params.connectorId));
      const sessionId = encodeURIComponent(String(req.params.sessionId));
      res.json(singleResponse(await connectorRunnerRequest("POST", `/connectors/${connectorId}/auth/sessions/${sessionId}/confirm`, stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/connectors/:connectorId/auth/sessions/:sessionId/actions/:actionId",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const connectorId = encodeURIComponent(String(req.params.connectorId));
      const sessionId = encodeURIComponent(String(req.params.sessionId));
      const actionId = encodeURIComponent(String(req.params.actionId));
      res.json(singleResponse(await connectorRunnerRequest("POST", `/connectors/${connectorId}/auth/sessions/${sessionId}/actions/${actionId}`, stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/connectors/wave/auth/sessions/:sessionId/import-transactions",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const sessionId = encodeURIComponent(String(req.params.sessionId));
      const body = stripActor(req.body ?? {});
      const runnerOutput: any = await connectorRunnerRequest(
        "POST",
        `/connectors/wave/auth/sessions/${sessionId}/actions/importTransactions`,
        body,
      );
      const normalized = runnerOutput?.normalized;
      if (!runnerOutput?.businessId || !normalized?.accounts || !normalized?.transactions) {
        throw httpError(502, "connector_import_invalid", "Wave connector did not return normalized transaction data.");
      }
      const importResult = await convexCall(client, mutation("financialHub.importBrowserWaveTransactions"), dropUndefined({
        societyId: societyIdFrom(req, req.actor!),
        businessId: runnerOutput.businessId,
        profileKey: runnerOutput.profileKey ?? body.profileKey,
        accounts: normalized.accounts,
        transactions: normalized.transactions,
        actingUserId: req.actor?.userId,
      }));
      res.json(singleResponse({ ...runnerOutput, import: importResult }));
    }),
  );

  router.post(
    "/browser-connectors/connectors/wave/import-transactions",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const body = stripActor(req.body ?? {});
      const runnerOutput: any = await connectorRunnerRequest(
        "POST",
        "/connectors/wave/actions/importTransactions",
        body,
      );
      const normalized = runnerOutput?.normalized;
      if (!runnerOutput?.businessId || !normalized?.accounts || !normalized?.transactions) {
        throw httpError(502, "connector_import_invalid", "Wave connector did not return normalized transaction data.");
      }
      const importResult = await convexCall(client, mutation("financialHub.importBrowserWaveTransactions"), dropUndefined({
        societyId: societyIdFrom(req, req.actor!),
        businessId: runnerOutput.businessId,
        profileKey: runnerOutput.profileKey ?? body.profileKey,
        accounts: normalized.accounts,
        transactions: normalized.transactions,
        actingUserId: req.actor?.userId,
      }));
      res.json(singleResponse({ ...runnerOutput, import: importResult }));
    }),
  );

  router.post(
    "/browser-connectors/connectors/:connectorId/actions/:actionId",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const connectorId = encodeURIComponent(String(req.params.connectorId));
      const actionId = encodeURIComponent(String(req.params.actionId));
      res.json(singleResponse(await connectorRunnerRequest("POST", `/connectors/${connectorId}/actions/${actionId}`, stripActor(req.body ?? {}))));
    }),
  );

  router.post(
    "/browser-connectors/governance-documents/import",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const societyId = societyIdFrom(req, req.actor!);
      const result = await importGovernanceDocumentsFromBcRegistry(client, {
        societyId,
        actingUserId: req.actor?.userId,
        corpNum: typeof req.body?.corpNum === "string" ? req.body.corpNum : undefined,
        refresh: req.body?.refresh === true,
      });
      res.json(singleResponse(result));
    }),
  );

  router.post(
    "/browser-connectors/filing-history/import",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const societyId = societyIdFrom(req, req.actor!);
      const result = await importBcRegistryFilingHistory(client, {
        societyId,
        actingUserId: req.actor?.userId,
        corpNum: typeof req.body?.corpNum === "string" ? req.body.corpNum : undefined,
        refresh: req.body?.refresh === true,
        importDocuments: req.body?.importDocuments !== false,
      });
      res.json(singleResponse(result));
    }),
  );

  router.post(
    "/browser-connectors/bylaws-history/import",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const societyId = societyIdFrom(req, req.actor!);
      const result = await importBylawsHistoryFromBcRegistry(client, {
        societyId,
        actingUserId: req.actor?.userId,
        corpNum: typeof req.body?.corpNum === "string" ? req.body.corpNum : undefined,
        refresh: req.body?.refresh === true,
      });
      res.json(singleResponse(result));
    }),
  );
}

function mountWorkflowBridgeRoutes(router: Router, client: ConvexHttpClient) {
  router.post(
    "/workflow-pdf/unbc-affiliate-id/fill",
    asyncHandler(async (req, res) => {
      requireWorkflowSecret(req);
      const templatePath = process.env.UNBC_AFFILIATE_TEMPLATE_PATH;
      if (!templatePath) {
        throw httpError(
          500,
          "unbc_template_missing",
          "UNBC_AFFILIATE_TEMPLATE_PATH is required to fill the UNBC Affiliate ID PDF.",
        );
      }

      const affiliate = normalizeAffiliatePayload(req.body?.affiliate ?? req.body?.input?.affiliate);
      const bytes = await fillUnbcAffiliatePdf(templatePath, affiliate);
      const fileName = workflowPdfFileName(affiliate);
      res.json(
        singleResponse({
          filename: fileName,
          mimeType: "application/pdf",
          base64: Buffer.from(bytes).toString("base64"),
        }),
      );
    }),
  );

  router.post(
    "/workflow-callbacks/n8n",
    asyncHandler(async (req, res) => {
      requireWorkflowSecret(req);
      const body = req.body ?? {};
      if (!body.workflowId || !body.runId || !body.event) {
        throw httpError(400, "invalid_workflow_callback", "workflowId, runId, and event are required.");
      }

      let generatedDocument:
        | {
            documentId: string;
            versionId: string;
            fileName: string;
            storageKey: string;
          }
        | undefined;

      if (body.generatedPdf?.base64) {
        const run = await convexCall(client, query("workflows.getRun"), {
          id: body.runId,
        });
        if (!run) throw httpError(404, "workflow_run_not_found", "Workflow run not found.");
        const pdf = decodeBase64Pdf(body.generatedPdf.base64);
        const filename = sanitizeFileName(
          body.generatedPdf.filename || `UNBC Affiliate ID Request - ${body.runId}.pdf`,
        );
        const storageKey = `${crypto.randomUUID()}-${filename}`;
        const dir = generatedWorkflowDocumentDir();
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, storageKey), pdf);

        const recorded = await convexCall(client, mutation("workflows.recordGeneratedDocument"), {
          societyId: run.societyId,
          workflowId: body.workflowId,
          runId: body.runId,
          storageKey,
          fileName: filename,
          mimeType: body.generatedPdf.mimeType ?? "application/pdf",
          fileSizeBytes: pdf.byteLength,
        });
        generatedDocument = {
          documentId: recorded.documentId,
          versionId: recorded.versionId,
          fileName: filename,
          storageKey,
        };
      }

      await convexCall(client, mutation("workflows.receiveExternalCallback"), {
        workflowId: body.workflowId,
        runId: body.runId,
        externalRunId: body.externalRunId,
        event: body.event,
        stepKey: body.stepKey,
        note: body.note,
        output: body.output,
        generatedDocument,
      });

      res.json(singleResponse({ ok: true, generatedDocument }));
    }),
  );

  router.get(
    "/workflow-generated-documents/:key",
    asyncHandler(async (req, res) => {
      const key = sanitizeStorageKey(req.params.key);
      const file = await readFile(path.join(generatedWorkflowDocumentDir(), key)).catch(() => null);
      if (!file) throw httpError(404, "generated_document_not_found", "Generated workflow document not found.");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${downloadFileNameFromStorageKey(key)}"`);
      res.send(file);
    }),
  );
}

function mountResourceRoute(router: Router, client: ConvexHttpClient, route: ResourceRoute) {
  if (route.list) {
    router.get(
      `/${route.name}`,
      requireScope(client, `${route.scope}:read`),
      asyncHandler(async (req, res) => {
        const args = route.listArgs?.(req, req.actor!) ?? { societyId: societyIdFrom(req, req.actor!) };
        const rows = await convexCall(client, route.list!, dropUndefined(args));
        const data = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
        res.json(listResponse(data));
      }),
    );
  }

  if (route.get) {
    router.get(
      `/${route.name}/:id`,
      requireScope(client, `${route.scope}:read`),
      asyncHandler(async (req, res) => {
        const data = await convexCall(client, route.get!, route.getArgs?.(req, req.actor!) ?? { id: req.params.id });
        if (!data) throw httpError(404, "not_found", `${route.name} record not found.`);
        res.json(singleResponse(data));
      }),
    );
  }

  if (route.create) {
    router.post(
      `/${route.name}`,
      requireScope(client, `${route.scope}:write`),
      asyncHandler(async (req, res) => {
        const args =
          route.createArgs?.(req, req.actor!) ??
          { societyId: societyIdFrom(req, req.actor!), ...stripActor(req.body) };
        const id = await convexCall(client, route.create!, dropUndefined(args));
        if (route.createEvent) await emitWebhookEvent(client, req.actor!, route.createEvent, { id, input: stripActor(req.body) });
        res.status(201).json(singleResponse({ id }));
      }),
    );
  }

  if (route.update) {
    router.patch(
      `/${route.name}/:id`,
      requireScope(client, `${route.scope}:write`),
      asyncHandler(async (req, res) => {
        const args =
          route.updateArgs?.(req, req.actor!) ??
          { id: req.params.id, patch: stripActor(req.body) };
        await convexCall(client, route.update!, dropUndefined(args));
        if (route.updateEvent) await emitWebhookEvent(client, req.actor!, route.updateEvent, { id: req.params.id, patch: stripActor(req.body) });
        res.json(singleResponse({ id: req.params.id }));
      }),
    );
  }

  if (route.remove) {
    router.delete(
      `/${route.name}/:id`,
      requireScope(client, `${route.scope}:write`),
      asyncHandler(async (req, res) => {
        const args = route.removeArgs?.(req, req.actor!) ?? { id: req.params.id };
        await convexCall(client, route.remove!, dropUndefined(args));
        if (route.deleteEvent) await emitWebhookEvent(client, req.actor!, route.deleteEvent, { id: req.params.id });
        res.status(204).send();
      }),
    );
  }
}

function mountActionRoute(router: Router, client: ConvexHttpClient, route: ActionRoute) {
  router.post(
    route.path,
    requireScope(client, route.scope),
    asyncHandler(async (req, res) => {
      const data = await convexCall(client, route.call, dropUndefined(route.args(req, req.actor!)));
      if (route.event) await emitWebhookEvent(client, req.actor!, route.event, { id: req.params.id, result: data });
      res.json(singleResponse(data ?? { ok: true }));
    }),
  );
}

function requireScope(client: ConvexHttpClient, requiredScope: Scope) {
  return asyncHandler(async (req, _res, next) => {
    req.actor = await resolveActor(client, req, requiredScope);
    next();
  });
}

async function resolveActor(client: ConvexHttpClient, req: Request, requiredScope: Scope): Promise<Actor> {
  const apiToken = extractApiToken(req);
  if (apiToken) {
    const result = await convexCall(client, mutation("apiPlatform.verifyToken"), {
      tokenHash: hashApiToken(apiToken),
      requiredScope,
    });
    if (!result?.valid) {
      throw httpError(
        result?.reason === "insufficient_scope" ? 403 : 401,
        result?.reason ?? "invalid_api_token",
        result?.reason === "insufficient_scope"
          ? `API token is missing required scope "${requiredScope}".`
          : "API token is invalid.",
      );
    }
    return {
      type: "api-key",
      societyId: result.societyId,
      userId: result.userId,
      clientId: result.client?._id,
      scopes: result.scopes,
    };
  }

  const localActor = await resolveLocalDevActor(client, req);
  if (localActor) {
    if (!scopeAllows(localActor.scopes, requiredScope)) {
      throw httpError(403, "insufficient_scope", `Local dev principal cannot use ${requiredScope}.`);
    }
    return localActor;
  }

  const sessionActor = await resolveBetterAuthActor(client, req);
  if (sessionActor) {
    if (!roleAllows(sessionActor.role, requiredScope)) {
      throw httpError(403, "insufficient_scope", `Role ${sessionActor.role} cannot use ${requiredScope}.`);
    }
    return sessionActor;
  }

  throw httpError(401, "unauthorized", "Provide an API key or an authenticated Better Auth session.");
}

async function resolveLocalDevActor(client: ConvexHttpClient, req: Request): Promise<Actor | null> {
  if (getAuthMode() !== "none") return null;
  if (process.env.NODE_ENV === "production") return null;
  if (!isLocalRequest(req)) return null;
  const requestedSocietyId = optionalSocietyIdFrom(req);
  const actor = await convexCall(client, query("apiPlatform.devActorForSociety"), {
    societyId: requestedSocietyId,
  });
  if (!actor) throw httpError(404, "society_not_found", "No society exists for local API mode.");
  return {
    type: "local-dev",
    societyId: actor.societyId,
    userId: actor.userId,
    scopes: ["*"],
    role: actor.role,
  };
}

async function resolveBetterAuthActor(client: ConvexHttpClient, req: Request): Promise<Actor | null> {
  if (getAuthMode() !== "better-auth") return null;
  const societyId = optionalSocietyIdFrom(req);
  if (!societyId) return null;
  const session = await auth.api
    .getSession({ headers: headersFromRequest(req) })
    .catch(() => null);
  const authSubject = session?.user?.id;
  if (!authSubject) return null;
  const actor = await convexCall(client, query("apiPlatform.actorForBetterAuthSubject"), {
    societyId,
    authSubject,
  });
  if (!actor) return null;
  return {
    type: "better-auth",
    societyId: actor.societyId,
    userId: actor.userId,
    scopes: [],
    role: actor.role,
  };
}

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
  });
  for (const subscription of subscriptions ?? []) {
    void deliverWebhook(client, subscription, event, 0);
  }
}

async function connectorRunnerRequest(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const baseUrl = process.env.CONNECTOR_RUNNER_BASE_URL ?? "http://127.0.0.1:8890";
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

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

type BcRegistryCsvRecord = Record<string, string>;

type GovernanceImportCandidate = {
  kind: "constitution" | "bylaws" | "constitutionAndBylaws" | "privacyPolicy";
  title: string;
  category: string;
  fileName: string;
  sourcePath: string;
  sourceUrl?: string;
  filing?: string;
  dateFiled?: string;
  documentName?: string;
  reportName?: string;
  eventId?: string;
  combined?: boolean;
};

async function importGovernanceDocumentsFromBcRegistry(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    corpNum?: string;
    refresh?: boolean;
  },
) {
  const society: any = await convexCall(client, query("society.getById"), { id: input.societyId });
  if (!society) throw httpError(404, "society_not_found", "Society not found.");

  const corpNum = normalizeBcRegistryCorpNum(input.corpNum ?? society.incorporationNumber);
  if (!corpNum) {
    throw httpError(400, "bc_registry_corp_number_required", "A BC Registry incorporation number is required.");
  }

  const needs = {
    constitution: !society.constitutionDocId,
    bylaws: !society.bylawsDocId,
    privacyPolicy: !society.privacyPolicyDocId,
  };
  const imported: any[] = [];
  const skipped: any[] = [];
  const missing: any[] = [];

  if (!needs.constitution && !needs.bylaws && !needs.privacyPolicy) {
    return { ok: true, corpNum, imported, skipped: [{ kind: "all", reason: "governance_documents_already_present" }], missing };
  }

  if (!needs.constitution && !needs.bylaws && needs.privacyPolicy) {
    return {
      ok: true,
      corpNum,
      imported,
      skipped,
      missing: [
        {
          kind: "privacyPolicy",
          reason: "not_available_from_bc_registry",
          message: "BC Registry filing history does not normally include a PIPA privacy policy.",
        },
      ],
    };
  }

  const exportInfo = await resolveBcRegistryExport(corpNum, Boolean(input.refresh));
  const records = await readBcRegistryFilingRecords(exportInfo.directory, corpNum);
  const candidates = pickGovernanceImportCandidates(records, exportInfo.directory);
  const importQueue: GovernanceImportCandidate[] = [];

  if (needs.constitution && needs.bylaws && candidates.constitution?.fileName === candidates.bylaws?.fileName) {
    importQueue.push({ ...candidates.constitution, kind: "constitutionAndBylaws", category: "Bylaws" });
  } else {
    if (needs.constitution && candidates.constitution) importQueue.push(candidates.constitution);
    if (needs.bylaws && candidates.bylaws) importQueue.push(candidates.bylaws);
  }

  if (needs.privacyPolicy && candidates.privacyPolicy) {
    importQueue.push(candidates.privacyPolicy);
  }

  const queuedKinds = new Set(importQueue.flatMap((candidate) => {
    if (candidate.kind === "constitutionAndBylaws") return ["constitution", "bylaws"];
    return [candidate.kind];
  }));
  for (const kind of ["constitution", "bylaws", "privacyPolicy"] as const) {
    if (!needs[kind]) continue;
    if (queuedKinds.has(kind)) continue;
    missing.push(
      kind === "privacyPolicy"
        ? {
            kind,
            reason: "not_available_from_bc_registry",
            message: "BC Registry filing history does not normally include a PIPA privacy policy.",
          }
        : {
            kind,
            reason: "no_registry_document_found",
            message: `No ${kind === "constitution" ? "constitution" : "bylaws"} document was found in the filing export.`,
          },
    );
  }

  for (const candidate of importQueue) {
    const copied = await copyGovernanceCandidateToDocumentStorage(candidate);
    const created: any = await convexCall(client, mutation("documents.createGovernanceDocumentFromLocalFile"), dropUndefined({
      societyId: input.societyId,
      documentKind: candidate.kind,
      title: candidate.title,
      category: candidate.category,
      fileName: candidate.fileName,
      mimeType: "application/pdf",
      fileSizeBytes: copied.fileSizeBytes,
      storageKey: copied.storageKey,
      sha256: copied.sha256,
      tags: [
        "bc-registry",
        "browser-connector",
        candidate.kind === "constitutionAndBylaws" ? "constitution" : candidate.kind,
        ...(candidate.kind === "constitutionAndBylaws" ? ["bylaws"] : []),
        ...(candidate.eventId ? [`bc-registry-event:${candidate.eventId}`] : []),
      ],
      sourceUrl: candidate.sourceUrl,
      changeNote: candidate.combined
        ? "Imported from BC Registry filing history; constitution appears to be bundled with bylaws."
        : "Imported from BC Registry filing history.",
      actingUserId: input.actingUserId,
    }));
    imported.push({
      kind: candidate.kind,
      title: candidate.title,
      fileName: candidate.fileName,
      filing: candidate.filing,
      dateFiled: candidate.dateFiled,
      documentName: candidate.documentName,
      reportName: candidate.reportName,
      eventId: candidate.eventId,
      documentId: created?.documentId,
      versionId: created?.versionId,
      linked: created?.linked,
    });
  }

  return {
    ok: true,
    corpNum,
    source: exportInfo.source,
    exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
    latestFiling: records[0]
      ? {
          filing: records[0].Filing,
          dateFiled: records[0]["Date Filed"],
        }
      : undefined,
    imported,
    skipped,
    missing,
  };
}

async function importBcRegistryFilingHistory(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    corpNum?: string;
    refresh?: boolean;
    importDocuments?: boolean;
  },
) {
  const society: any = await convexCall(client, query("society.getById"), { id: input.societyId });
  if (!society) throw httpError(404, "society_not_found", "Society not found.");

  const corpNum = normalizeBcRegistryCorpNum(input.corpNum ?? society.incorporationNumber);
  if (!corpNum) {
    throw httpError(400, "bc_registry_corp_number_required", "A BC Registry incorporation number is required.");
  }

  const exportInfo = await resolveBcRegistryExport(corpNum, Boolean(input.refresh));
  const records = await readBcRegistryFilingRecords(exportInfo.directory, corpNum);
  const documentImport = input.importDocuments === false
    ? { byFilename: new Map<string, string>(), created: 0, reused: 0, skipped: 0 }
    : await importBcRegistryPdfDocuments(client, {
        societyId: input.societyId,
        actingUserId: input.actingUserId,
        exportDirectory: exportInfo.directory,
        records,
      });
  const filingRecords = buildBcRegistryFilingImportRecords({
    corpNum,
    exportDirectory: exportInfo.directory,
    records,
    documentIdsByFilename: documentImport.byFilename,
  });
  const imported: any = await convexCall(client, mutation("filings.importBcRegistryHistory"), {
    societyId: input.societyId,
    records: filingRecords,
  });
  return {
    ok: true,
    corpNum,
    source: exportInfo.source,
    exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
    filingCount: filingRecords.length,
    inserted: imported?.inserted ?? 0,
    updated: imported?.updated ?? 0,
    documents: {
      created: documentImport.created,
      reused: documentImport.reused,
      skipped: documentImport.skipped,
      linkedFilingDocumentCount: filingRecords.reduce((sum, row: any) => sum + (row.sourceDocumentIds?.length ?? 0), 0),
    },
    latestFiling: records[0]
      ? {
          filing: records[0].Filing,
          dateFiled: records[0]["Date Filed"],
        }
      : undefined,
  };
}

async function importBylawsHistoryFromBcRegistry(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    corpNum?: string;
    refresh?: boolean;
  },
) {
  const society: any = await convexCall(client, query("society.getById"), { id: input.societyId });
  if (!society) throw httpError(404, "society_not_found", "Society not found.");

  const corpNum = normalizeBcRegistryCorpNum(input.corpNum ?? society.incorporationNumber);
  if (!corpNum) {
    throw httpError(400, "bc_registry_corp_number_required", "A BC Registry incorporation number is required.");
  }

  const exportInfo = await resolveBcRegistryExport(corpNum, Boolean(input.refresh));
  const records = await readBcRegistryFilingRecords(exportInfo.directory, corpNum);
  const documentImport = await importBcRegistryPdfDocuments(client, {
    societyId: input.societyId,
    actingUserId: input.actingUserId,
    exportDirectory: exportInfo.directory,
    records,
  });
  const bundle = await buildBcRegistryBylawsHistoryBundle({
    corpNum,
    exportDirectory: exportInfo.directory,
    publicDirectory: exportInfo.publicDirectory,
    records,
    documentIdsByFilename: documentImport.byFilename,
  });

  if (bundle.bylawAmendments.length === 0) {
    return {
      ok: true,
      corpNum,
      source: exportInfo.source,
      exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
      sessionId: null,
      candidateDocuments: 0,
      bylawAmendments: 0,
      visionQueue: 0,
      documents: {
        created: documentImport.created,
        reused: documentImport.reused,
        skipped: documentImport.skipped,
      },
      missing: [
        {
          reason: "no_bylaws_registry_rows",
          message: "No bylaws, constitution, Form 10, or special-resolution rows were found in the BC Registry export.",
        },
      ],
    };
  }

  const sessionId: any = await convexCall(client, mutation("importSessions.createFromBundle"), {
    societyId: input.societyId,
    name: `Bylaws history bot - BC Registry (${new Date().toISOString().slice(0, 10)})`,
    bundle,
  });

  return {
    ok: true,
    corpNum,
    source: exportInfo.source,
    exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
    sessionId,
    candidateDocuments: bundle.sources.length,
    bylawAmendments: bundle.bylawAmendments.length,
    visionQueue: bundle.metadata.visionQueue,
    documents: {
      created: documentImport.created,
      reused: documentImport.reused,
      skipped: documentImport.skipped,
    },
  };
}

async function importBcRegistryPdfDocuments(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    exportDirectory: string;
    records: BcRegistryCsvRecord[];
  },
) {
  const existingDocuments: any[] = await convexCall(client, query("documents.list"), {
    societyId: input.societyId,
  });
  const byFilename = new Map<string, string>();
  for (const document of existingDocuments ?? []) {
    if (document?.fileName && document?._id) byFilename.set(document.fileName, document._id);
  }

  let created = 0;
  let reused = 0;
  let skipped = 0;
  const documentRows = uniqueBcRegistryDocumentRows(input.records);
  for (const row of documentRows) {
    const fileName = sanitizeFileName(path.basename(String(row.Filename ?? "")));
    if (!fileName) {
      skipped += 1;
      continue;
    }
    const sourcePath = path.join(input.exportDirectory, "pdfs", fileName);
    const eventId = row["Event ID"];
    const reportName = row["Report Name"];
    const tags = [
      "bc-registry",
      "browser-connector",
      "filing-evidence",
      ...(eventId ? [`bc-registry-event:${eventId}`] : []),
      ...(reportName ? [`bc-registry-report:${reportName}`] : []),
    ];
    const sourceExternalIds = [
      ...(eventId ? [`bc-registry:event:${eventId}`] : []),
      ...(eventId && reportName ? [`bc-registry:document:${eventId}:${reportName}`] : []),
      ...(fileName ? [`bc-registry:file:${fileName}`] : []),
    ];
    const existingId = byFilename.get(fileName);
    if (existingId) {
      const metadata = await readPdfMetadata(fileName, sourcePath).catch(() => null);
      await convexCall(client, mutation("documents.mergeConnectorDocumentMetadata"), dropUndefined({
        documentId: existingId,
        title: bcRegistryDocumentTitle(row),
        category: bcRegistryDocumentCategory(row),
        fileName,
        mimeType: "application/pdf",
        fileSizeBytes: metadata?.fileSizeBytes,
        sha256: metadata?.sha256,
        tags,
        sourceUrl: row.URL || undefined,
        sourceExternalIds,
        sourcePayloadJson: JSON.stringify(row),
        changeNote: "Imported from BC Registry filing-history export.",
      }));
      reused += 1;
      continue;
    }
    const copied = await copyPdfToDocumentStorage(fileName, sourcePath).catch(() => null);
    if (!copied) {
      skipped += 1;
      continue;
    }
    const result: any = await convexCall(client, mutation("documents.createLocalDocumentFromConnector"), dropUndefined({
      societyId: input.societyId,
      title: bcRegistryDocumentTitle(row),
      category: bcRegistryDocumentCategory(row),
      fileName,
      mimeType: "application/pdf",
      fileSizeBytes: copied.fileSizeBytes,
      storageKey: copied.storageKey,
      sha256: copied.sha256,
      tags,
      sourceUrl: row.URL || undefined,
      sourceExternalIds,
      sourcePayloadJson: JSON.stringify(row),
      changeNote: "Imported from BC Registry filing-history export.",
      actingUserId: input.actingUserId,
      skipDuplicateCheck: true,
    }));
    if (result?.documentId) {
      byFilename.set(fileName, result.documentId);
      if (result.reused) reused += 1;
      else created += 1;
    }
  }

  return { byFilename, created, reused, skipped };
}

async function buildBcRegistryBylawsHistoryBundle(input: {
  corpNum: string;
  exportDirectory: string;
  publicDirectory?: string;
  records: BcRegistryCsvRecord[];
  documentIdsByFilename: Map<string, string>;
}) {
  const groups = groupBcRegistryFilingRows(input.records.filter(isBcRegistryBylawsHistoryRow))
    .sort((a, b) => {
      const left = parseBcRegistryDate(a.rows[0]?.["Date Filed"]) ?? "";
      const right = parseBcRegistryDate(b.rows[0]?.["Date Filed"]) ?? "";
      return left.localeCompare(right) || a.key.localeCompare(b.key);
    });
  const sources: any[] = [];
  const bylawAmendments: any[] = [];
  let previousText = "";
  let visionQueue = 0;

  for (const group of groups) {
    const row = bestBcRegistryBylawsDocumentRow(group.rows);
    const eventId = firstNonEmpty(group.rows.map((item) => item["Event ID"]));
    const reportName = row["Report Name"];
    const rawFilename = String(row.Filename ?? "").trim();
    const fileName = rawFilename ? sanitizeFileName(path.basename(rawFilename)) : "";
    const sourcePath = fileName ? path.join(input.exportDirectory, "pdfs", fileName) : "";
    const filedAt = parseBcRegistryDate(row["Date Filed"]);
    const sourceExternalIds = uniqueStrings([
      eventId ? `bc-registry:event:${eventId}` : "",
      eventId ? `bc-registry:event-id:${eventId}` : "",
      eventId && reportName ? `bc-registry:document:${eventId}:${reportName}` : "",
      fileName ? `bc-registry:file:${fileName}` : "",
    ]);
    const primaryExternalId = sourceExternalIds[0] ?? `bc-registry:paper:${crypto.createHash("sha1").update(group.key).digest("hex").slice(0, 16)}`;
    const rawText = sourcePath ? await extractPdfTextWithPdftotext(sourcePath) : "";
    const fullBylaws = looksLikeFullBylawsText(rawText || `${row.Filing} ${row.Details} ${row["Document Name"]} ${row["Report Name"]}`);
    const needsVisionReview = cleanRegistryText(rawText).length < 300;
    if (needsVisionReview) visionQueue += 1;
    const proposedText = needsVisionReview
      ? registryVisionReviewMarkdown(row, fileName || undefined)
      : registryBylawsMarkdownFromText(rawText, bcRegistryBylawsSourceTitle(row));
    const status = fullBylaws && !needsVisionReview ? "Filed" : "Draft";
    const confidence = fullBylaws && !needsVisionReview ? "Medium" : "Review";
    const sourceDocumentId = fileName ? input.documentIdsByFilename.get(fileName) : undefined;
    const notes = [
      needsVisionReview
        ? "The registry PDF appears to be scanned or did not yield enough digital text. Run page-by-page vision transcription before approving."
        : "The registry PDF yielded digital text via pdftotext and was normalized into Markdown. Verify against the PDF before approval.",
      fullBylaws
        ? "This looks like a complete bylaws version."
        : "This looks like a partial amendment, special resolution, or filing source. Merge it into the previous full bylaws text before marking it filed.",
      sourceDocumentId ? `Linked document: ${sourceDocumentId}.` : "No local source document was linked.",
    ].join(" ");

    sources.push({
      externalSystem: "bc-registry",
      externalId: primaryExternalId,
      title: bcRegistryBylawsSourceTitle(row),
      sourceDate: filedAt,
      category: "BC Registry Bylaws Source",
      confidence,
      notes,
      url: row.URL || undefined,
      localPath: sourcePath ? path.relative(process.cwd(), sourcePath) : undefined,
      fileName: fileName || undefined,
      tags: ["bc-registry", "bylaws", needsVisionReview ? "vision-review" : "pdf-text"],
    });

    bylawAmendments.push({
      title: `${status === "Filed" ? "Bylaws version" : "Bylaws source needing review"}: ${bcRegistryBylawsSourceTitle(row)}${filedAt ? ` (${filedAt})` : ""}`,
      status,
      baseText: previousText,
      proposedText,
      createdByName: "BC Registry bylaws history bot",
      createdAtISO: dateToStartIso(filedAt),
      updatedAtISO: dateToStartIso(filedAt),
      filedAtISO: status === "Filed" ? dateToStartIso(filedAt) : undefined,
      sourceDate: filedAt,
      sourceExternalIds,
      importedFrom: "BC Registry bylaws history bot",
      confidence,
      notes,
      sourceDocumentId,
      extractionPlan: needsVisionReview
        ? {
            mode: "page_by_page_vision",
            reason: "Digital PDF text extraction was sparse or unavailable.",
            reviewerInstruction: "Render each PDF page as an image, transcribe clauses in order, preserve numbering, and mark uncertain words with [[uncertain: ...]].",
          }
        : {
            mode: "pdftotext_markdown_normalization",
            reason: "Digital text was available from the registry PDF.",
          },
    });

    if (status === "Filed") previousText = proposedText;
    else if (!previousText) previousText = proposedText;
  }

  return {
    metadata: {
      name: "Bylaws history bot - BC Registry",
      createdFrom: "BC Registry filing-history export",
      corpNum: input.corpNum,
      exportDirectory: input.publicDirectory ?? path.relative(process.cwd(), input.exportDirectory),
      candidateDocuments: sources.length,
      bylawAmendments: bylawAmendments.length,
      visionQueue,
      note: "Registry PDFs were staged as review records. Digital PDFs are normalized to Markdown; scan-only PDFs are queued for page-by-page vision transcription.",
    },
    sources,
    bylawAmendments,
  };
}

function uniqueBcRegistryDocumentRows(records: BcRegistryCsvRecord[]) {
  const byFilename = new Map<string, BcRegistryCsvRecord>();
  for (const row of records) {
    if (row["Paper Only"] === "true" || !row.Filename) continue;
    if (!byFilename.has(row.Filename)) byFilename.set(row.Filename, row);
  }
  return [...byFilename.values()];
}

function isBcRegistryBylawsHistoryRow(row: BcRegistryCsvRecord) {
  const text = [
    row.Filing,
    row.Details,
    row["Document Name"],
    row["Report Name"],
    row.Filename,
  ].join(" ");
  if (!/\b(bylaws?|by-laws?|constitution|special resolution|copy of resolution|form\s*10|transition)\b/i.test(text)) {
    return false;
  }
  if (/\b(receipt|invoice|payment|annual report)\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) &&
    !/\b(bylaw|constitution|resolution)\b/i.test(text)) {
    return false;
  }
  return true;
}

function bestBcRegistryBylawsDocumentRow(rows: BcRegistryCsvRecord[]): BcRegistryCsvRecord {
  return rows.find((row) => /\bbylaws?|by-laws?\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) && row.Filename) ??
    rows.find((row) => /\bconstitution\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) && row.Filename) ??
    rows.find((row) => /\bspecial resolution|copy of resolution|form\s*10\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) && row.Filename) ??
    rows.find((row) => row.Filename) ??
    rows[0] ??
    {};
}

function bcRegistryBylawsSourceTitle(row: BcRegistryCsvRecord) {
  return row["Document Name"] || row["Report Name"] || compactBcRegistryFilingLabel(row.Filing ?? "") || "BC Registry bylaws source";
}

async function extractPdfTextWithPdftotext(sourcePath: string) {
  const exists = await stat(sourcePath).catch(() => null);
  if (!exists) return "";
  return await new Promise<string>((resolve) => {
    execFile(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", sourcePath, "-"],
      { timeout: 45_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) resolve("");
        else resolve(String(stdout ?? ""));
      },
    );
  });
}

function registryBylawsMarkdownFromText(raw: string, title: string) {
  const source = rebreakRegistryBylawsText(raw || title);
  const lines = source
    .split(/\n+/)
    .map((line) => normalizeRegistryBylawLine(line))
    .filter(Boolean);
  const out: string[] = [`# ${title}`];
  let previousWasHeading = true;

  for (const line of lines) {
    if (isRegistryPdfPageMarker(line)) continue;
    if (sameRegistryNormalizedText(line, title)) continue;

    if (/^(part|article)\s+[0-9ivxlcdm]+(\b|[:. -])/i.test(line)) {
      out.push("", `## ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (/^(section|bylaw)\s+\d+(\b|[:. -])/i.test(line)) {
      out.push("", `### ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (isLikelyRegistryStandaloneHeading(line)) {
      out.push("", `## ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (/^\d+(?:\.\d+)*[.)]?\s+/.test(line) || /^\([a-z0-9ivxlcdm]+\)\s+/i.test(line)) {
      out.push(previousWasHeading ? line : `\n${line}`);
      previousWasHeading = false;
      continue;
    }

    out.push(line);
    previousWasHeading = false;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function registryVisionReviewMarkdown(row: BcRegistryCsvRecord, fileName?: string) {
  return [
    `# ${bcRegistryBylawsSourceTitle(row)}`,
    "",
    "## Vision transcription required",
    "",
    "The BC Registry PDF did not yield enough digital text to reconstruct this bylaws version safely.",
    "",
    "Reviewer checklist:",
    "",
    "1. Open the linked registry PDF.",
    "2. Render each page as an image and transcribe it in order.",
    "3. Preserve all headings, clause numbers, definitions, schedules, signatures, and handwritten annotations.",
    "4. Mark uncertain words as `[[uncertain: text]]` and missing/unreadable areas as `[[illegible: page N]]`.",
    "",
    `Filing: ${row.Filing || "BC Registry filing"}`,
    row["Date Filed"] ? `Date filed: ${row["Date Filed"]}` : "",
    fileName ? `File: ${fileName}` : "",
  ].filter(Boolean).join("\n");
}

function rebreakRegistryBylawsText(value: string) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+(Part\s+[0-9IVXLCDM]+[:. -])/gi, "\n\n$1")
    .replace(/\s+((?:Article|Section|Bylaw)\s+\d+(?:\.\d+)*[:. -])/gi, "\n\n$1")
    .replace(/\s+(\d+(?:\.\d+)*[.)]\s+)/g, "\n$1")
    .replace(/\s+(\([a-z0-9ivxlcdm]+\)\s+)/gi, "\n$1")
    .trim();
}

function normalizeRegistryBylawLine(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function cleanRegistryText(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeFullBylawsText(text: string) {
  const cleaned = cleanRegistryText(text);
  const score = [
    /\bbylaws?|by-laws?\b/i,
    /\bpart\s+\d+|article\s+\d+|section\s+\d+|\b\d+\.\s+[A-Z]/i,
    /\bmembers?\b/i,
    /\bdirectors?\b/i,
    /\bgeneral meetings?|annual general meeting|special general meeting\b/i,
    /\bquorum|vot(?:e|ing)|special resolution\b/i,
  ].reduce((sum, regex) => sum + (regex.test(cleaned) ? 1 : 0), 0);
  return score >= 4 && cleaned.length > 900;
}

function isRegistryPdfPageMarker(line: string) {
  return /^(page\s*)?\d+\s*(of\s+\d+)?$/i.test(line) ||
    /^-+\s*\d+\s*-+$/.test(line);
}

function sameRegistryNormalizedText(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalize(left) === normalize(right);
}

function isLikelyRegistryStandaloneHeading(line: string) {
  if (line.length < 4 || line.length > 90) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/^(and|or|the|a|an|to|of|in|for)\b/i.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > 10) return false;
  const capitalized = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
  return capitalized >= Math.max(1, Math.ceil(words.length * 0.6));
}

function dateToStartIso(date: string | undefined) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00Z`;
  return new Date().toISOString();
}

function buildBcRegistryFilingImportRecords(input: {
  corpNum: string;
  exportDirectory: string;
  records: BcRegistryCsvRecord[];
  documentIdsByFilename: Map<string, string>;
}) {
  const groups = groupBcRegistryFilingRows(input.records);
  return groups.map((group) => {
    const row = group.rows[0];
    const eventId = firstNonEmpty(group.rows.map((item) => item["Event ID"]));
    const filedAt = parseBcRegistryDate(row["Date Filed"]);
    const dueDate = deriveBcRegistryDueDate(row) ?? filedAt ?? new Date().toISOString().slice(0, 10);
    const sourceDocumentIds = uniqueStrings(
      group.rows
        .map((item) => input.documentIdsByFilename.get(item.Filename))
        .filter((value): value is string => Boolean(value)),
    );
    const receiptDocumentId = group.rows
      .find((item) => /receipt/i.test(`${item["Report Name"]} ${item["Document Name"]}`))
      ?.Filename;
    const stagedPacketDocumentId = group.rows
      .find((item) => item.Filename && !/receipt/i.test(`${item["Report Name"]} ${item["Document Name"]}`))
      ?.Filename;
    const documentNames = group.rows
      .filter((item) => item.Filename)
      .map((item) => `${item["Document Name"] || item["Report Name"] || "Document"} (${item.Filename})`);
    const sourceKey = eventId
      ? `bc-registry:event:${eventId}`
      : `bc-registry:paper:${crypto.createHash("sha1").update(group.key).digest("hex").slice(0, 16)}`;
    return dropUndefined({
      kind: "RegistryRecord",
      periodLabel: deriveBcRegistryPeriodLabel(row),
      dueDate,
      filedAt,
      submissionMethod: "Online",
      status: "Filed",
      registryUrl: `https://www.bcregistry.ca/societies/${input.corpNum}/filingHistory`,
      receiptDocumentId: receiptDocumentId ? input.documentIdsByFilename.get(receiptDocumentId) : undefined,
      stagedPacketDocumentId: stagedPacketDocumentId ? input.documentIdsByFilename.get(stagedPacketDocumentId) : undefined,
      sourceDocumentIds,
      sourceExternalIds: uniqueStrings([
        sourceKey,
        ...(eventId ? [`bc-registry:event-id:${eventId}`] : []),
      ]),
      sourcePayloadJson: JSON.stringify({
        exportDirectory: path.relative(process.cwd(), input.exportDirectory),
        rows: group.rows,
      }),
      evidenceNotes: [
        "Imported from BC Registry filing history.",
        eventId ? `Event ID: ${eventId}.` : "Paper-only registry row.",
        `Filing: ${row.Filing}.`,
        row["Date Filed"] ? `Date filed: ${row["Date Filed"]}.` : "",
        documentNames.length ? `Documents: ${documentNames.join("; ")}.` : "Documents: Available on paper only.",
      ].filter(Boolean).join(" "),
      notes: row.Details || undefined,
    });
  });
}

function groupBcRegistryFilingRows(records: BcRegistryCsvRecord[]) {
  const groups = new Map<string, { key: string; rows: BcRegistryCsvRecord[] }>();
  for (const row of records) {
    const eventId = row["Event ID"];
    const key = eventId
      ? `event:${eventId}`
      : `paper:${row.Filing}|${row["Date Filed"]}|${row.Details}`;
    const group = groups.get(key) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function normalizeBcRegistryCorpNum(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase().replace(/-/g, "");
  if (!text) return "";
  if (!/^[A-Z0-9]+$/.test(text)) {
    throw httpError(400, "invalid_bc_registry_corp_number", "BC Registry incorporation number is invalid.");
  }
  return text;
}

async function resolveBcRegistryExport(corpNum: string, refresh: boolean) {
  const existing = refresh ? null : await latestBcRegistryExport(corpNum);
  if (existing) return { ...existing, source: "latest-export" as const };

  const exported = await runBcRegistryExportFromActiveSession(corpNum).catch(async (error) => {
    const fallback = await latestBcRegistryExport(corpNum);
    if (fallback) return { ...fallback, source: "latest-export" as const, warning: error?.message };
    throw error;
  });
  return exported;
}

function browserConnectorExportRoot() {
  return path.resolve(process.cwd(), "browser-connector-exports");
}

async function latestBcRegistryExport(corpNum: string) {
  const root = browserConnectorExportRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ directory: string; publicDirectory: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${corpNum}-`)) continue;
    const directory = path.join(root, entry.name);
    const csvPath = path.join(directory, `${corpNum}_filing_history.csv`);
    const [dirStat, csv] = await Promise.all([
      stat(directory).catch(() => null),
      readFile(csvPath).catch(() => null),
    ]);
    if (!dirStat || !csv) continue;
    candidates.push({
      directory,
      publicDirectory: path.posix.join("browser-connector-exports", entry.name),
      mtimeMs: dirStat.mtimeMs,
    });
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
}

async function runBcRegistryExportFromActiveSession(corpNum: string) {
  const sessionsPayload: any = await connectorRunnerRequest("GET", "/sessions");
  const sessions: any[] = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
  const session =
    sessions.find((item) => item?.connectorId === "bc-registry" && String(item?.currentUrl ?? "").includes(`/societies/${corpNum}/`)) ??
    sessions.find((item) => item?.connectorId === "bc-registry");
  if (!session?.sessionId) {
    throw httpError(
      409,
      "bc_registry_login_required",
      "Open a BC Registry browser app session, sign in, and navigate to the filing history page.",
    );
  }

  const output: any = await connectorRunnerRequest(
    "POST",
    `/connectors/bc-registry/auth/sessions/${encodeURIComponent(session.sessionId)}/actions/filingHistoryExport`,
    { corpNum, includePdfProbe: true, downloadPdfs: true },
  );
  const publicDirectory =
    typeof output?.download?.exportPublicDirectory === "string"
      ? output.download.exportPublicDirectory
      : undefined;
  if (publicDirectory) {
    return {
      directory: path.resolve(process.cwd(), publicDirectory),
      publicDirectory,
      source: "active-session" as const,
      exportResult: {
        filingCount: output?.filingCount,
        documentCount: output?.documentCount,
        downloadedCount: output?.download?.downloadedCount,
        failedCount: output?.download?.failedCount,
      },
    };
  }

  const latest = await latestBcRegistryExport(corpNum);
  if (latest) return { ...latest, source: "active-session" as const };
  throw httpError(502, "bc_registry_export_missing", "BC Registry export completed without a local export directory.");
}

async function readBcRegistryFilingRecords(exportDirectory: string, corpNum: string): Promise<BcRegistryCsvRecord[]> {
  const csv = await readFile(path.join(exportDirectory, `${corpNum}_filing_history.csv`), "utf8").catch(() => null);
  if (!csv) throw httpError(404, "bc_registry_export_csv_missing", "BC Registry filing export CSV was not found.");
  const rows = parseCsv(csv);
  const [headers, ...data] = rows;
  if (!headers?.length) return [];
  return data.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function pickGovernanceImportCandidates(records: BcRegistryCsvRecord[], exportDirectory: string) {
  const docs = records.filter((row) => row["Paper Only"] !== "true" && row.Filename);
  const byReport = (pattern: RegExp) =>
    docs.find((row) => pattern.test(row["Report Name"] ?? "") || pattern.test(row["Document Name"] ?? ""));
  const bylaws = byReport(/^bylaws$/i) ?? byReport(/bylaw/i);
  const standaloneConstitution = byReport(/^constitution$/i);
  const constitution = standaloneConstitution ?? (bylaws ? { ...bylaws, __combinedConstitution: "true" } : undefined);
  const privacyPolicy =
    byReport(/\bpipa\b/i) ??
    byReport(/privacy/i) ??
    docs.find((row) => /personal information|privacy/i.test(`${row.Filing} ${row.Details}`));

  return {
    constitution: constitution
      ? candidateFromRegistryRow(
          constitution,
          exportDirectory,
          standaloneConstitution ? "constitution" : "constitutionAndBylaws",
          standaloneConstitution ? "Constitution" : "Bylaws",
          standaloneConstitution ? "Constitution - BC Registry" : "Constitution and Bylaws - BC Registry",
          !standaloneConstitution,
        )
      : undefined,
    bylaws: bylaws
      ? candidateFromRegistryRow(bylaws, exportDirectory, "bylaws", "Bylaws", "Bylaws - BC Registry")
      : undefined,
    privacyPolicy: privacyPolicy
      ? candidateFromRegistryRow(privacyPolicy, exportDirectory, "privacyPolicy", "Policy", "Privacy policy - BC Registry")
      : undefined,
  };
}

function candidateFromRegistryRow(
  row: BcRegistryCsvRecord,
  exportDirectory: string,
  kind: GovernanceImportCandidate["kind"],
  category: string,
  baseTitle: string,
  combined = false,
): GovernanceImportCandidate {
  const fileName = sanitizeFileName(path.basename(String(row.Filename ?? "")));
  const dateFiled = row["Date Filed"] || undefined;
  const title = `${baseTitle}${dateFiled ? ` (${dateFiled.replace(/\s+\d{1,2}:\d{2}\s*[AP]M$/i, "")})` : ""}`;
  return {
    kind,
    title,
    category,
    fileName,
    sourcePath: path.join(exportDirectory, "pdfs", fileName),
    sourceUrl: row.URL || undefined,
    filing: row.Filing || undefined,
    dateFiled,
    documentName: row["Document Name"] || undefined,
    reportName: row["Report Name"] || undefined,
    eventId: row["Event ID"] || undefined,
    combined,
  };
}

async function copyGovernanceCandidateToDocumentStorage(candidate: GovernanceImportCandidate) {
  return copyPdfToDocumentStorage(candidate.fileName, candidate.sourcePath);
}

async function readPdfMetadata(fileName: string, sourcePath: string) {
  const pdf = await readFile(sourcePath).catch(() => null);
  if (!pdf) {
    throw httpError(404, "bc_registry_export_pdf_missing", `${fileName} was not found in the BC Registry export.`);
  }
  if (pdf.byteLength === 0 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw httpError(400, "bc_registry_export_pdf_invalid", `${fileName} is not a PDF file.`);
  }
  return {
    pdf,
    fileSizeBytes: pdf.byteLength,
    sha256: crypto.createHash("sha256").update(pdf).digest("hex"),
  };
}

async function copyPdfToDocumentStorage(fileName: string, sourcePath: string) {
  const metadata = await readPdfMetadata(fileName, sourcePath);
  const storageKey = `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
  await mkdir(generatedWorkflowDocumentDir(), { recursive: true });
  await writeFile(path.join(generatedWorkflowDocumentDir(), storageKey), metadata.pdf);
  return {
    storageKey,
    fileSizeBytes: metadata.fileSizeBytes,
    sha256: metadata.sha256,
  };
}

function bcRegistryDocumentTitle(row: BcRegistryCsvRecord) {
  const name = row["Document Name"] || row["Report Name"] || "BC Registry document";
  const date = parseBcRegistryDate(row["Date Filed"]);
  return `${name} - BC Registry${date ? ` (${date})` : ""}`;
}

function bcRegistryDocumentCategory(row: BcRegistryCsvRecord) {
  const text = `${row["Report Name"]} ${row["Document Name"]}`;
  if (/receipt/i.test(text)) return "Receipt";
  if (/constitution/i.test(text)) return "Constitution";
  if (/bylaw/i.test(text)) return "Bylaws";
  return "Filing";
}

function parseBcRegistryDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!match) return undefined;
  const month = monthNumber(match[1]);
  if (!month) return undefined;
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function monthNumber(value: string) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.findIndex((month) => value.toLowerCase().startsWith(month));
  return index >= 0 ? String(index + 1).padStart(2, "0") : undefined;
}

function deriveBcRegistryDueDate(row: BcRegistryCsvRecord) {
  if (/annual report/i.test(row.Filing ?? "")) {
    const agmDate = parseBcRegistryDate(row.Filing.replace(/^.*\bAGM:\s*/i, ""));
    if (agmDate) return addDaysISO(agmDate, 30);
  }
  return parseBcRegistryDate(row["Date Filed"]);
}

function addDaysISO(dateISO: string, days: number) {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function deriveBcRegistryPeriodLabel(row: BcRegistryCsvRecord) {
  const filing = row.Filing ?? "";
  const annualYear = filing.match(/\b(\d{4})\s+BC\s+Annual\s+Report\b/i)?.[1];
  if (annualYear) return annualYear;
  const filedAt = parseBcRegistryDate(row["Date Filed"]);
  const year = filedAt?.slice(0, 4);
  const label = compactBcRegistryFilingLabel(filing);
  return year ? `${year} ${label}` : label;
}

function compactBcRegistryFilingLabel(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (/change of directors/i.test(text)) return "Change of Directors";
  if (/bylaw/i.test(text)) return "Bylaw Alteration";
  if (/transition/i.test(text)) return "Transition";
  if (/incorporat/i.test(text)) return "Incorporation";
  if (/special resolution|registrar/i.test(text)) return "Special Resolution";
  if (/annual report/i.test(text)) return "Annual Report";
  return text.replace(/\bApplication\b/gi, "").trim().slice(0, 80) || "Registry Record";
}

function firstNonEmpty(values: string[]) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim())));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
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
    });
    if (shouldRetry) {
      setTimeout(() => {
        void deliverWebhook(client, subscription, event, attemptNumber);
      }, retryDelay);
    }
  }
}

function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.register("ApiResource", ApiResourceSchema);
  registry.register("ApiListResponse", ApiListSchema);
  registry.register("ApiSingleResponse", ApiSingleSchema);
  registry.register("ApiError", ApiErrorSchema);

  for (const route of RESOURCE_ROUTES) registerResourceOpenApi(registry, route);
  for (const route of ACTION_ROUTES) registerActionOpenApi(registry, route);
  registerPlatformOpenApi(registry);

  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Societyer API",
      version: "1.0.0",
      description: "Stable REST API for Societyer plugins and external integrations.",
    },
    servers: [{ url: "/" }],
  });
  doc.components ??= {};
  doc.components.securitySchemes = {
    bearerApiKey: { type: "http", scheme: "bearer" },
    xApiKey: { type: "apiKey", in: "header", name: "x-api-key" },
  };
  return doc;
}

function registerResourceOpenApi(registry: OpenAPIRegistry, route: ResourceRoute) {
  const base = `/api/v1/${route.name}`;
  if (route.list) {
    registry.registerPath({
      method: "get",
      path: base,
      tags: [route.tag],
      operationId: operationId("list", route.name),
      security: security(),
      "x-required-scope": `${route.scope}:read`,
      request: {
        query: z.object({ societyId: z.string().optional(), limit: z.coerce.number().optional() }),
      },
      responses: responses(ApiListSchema),
    });
  }
  if (route.get) {
    registry.registerPath({
      method: "get",
      path: `${base}/{id}`,
      tags: [route.tag],
      operationId: operationId("get", route.name),
      security: security(),
      "x-required-scope": `${route.scope}:read`,
      request: { params: z.object({ id: z.string() }) },
      responses: responses(ApiSingleSchema),
    });
  }
  if (route.create) {
    registry.registerPath({
      method: "post",
      path: base,
      tags: [route.tag],
      operationId: operationId("create", route.name),
      security: security(),
      "x-required-scope": `${route.scope}:write`,
      request: { body: jsonBody(RequestBodySchema) },
      responses: responses(ApiSingleSchema, 201),
    });
  }
  if (route.update) {
    registry.registerPath({
      method: "patch",
      path: `${base}/{id}`,
      tags: [route.tag],
      operationId: operationId("update", route.name),
      security: security(),
      "x-required-scope": `${route.scope}:write`,
      request: {
        params: z.object({ id: z.string() }),
        body: jsonBody(RequestBodySchema),
      },
      responses: responses(ApiSingleSchema),
    });
  }
  if (route.remove) {
    registry.registerPath({
      method: "delete",
      path: `${base}/{id}`,
      tags: [route.tag],
      operationId: operationId("delete", route.name),
      security: security(),
      "x-required-scope": `${route.scope}:write`,
      request: { params: z.object({ id: z.string() }) },
      responses: {
        204: { description: "Deleted" },
        ...errorResponses(),
      },
    });
  }
}

function registerActionOpenApi(registry: OpenAPIRegistry, route: ActionRoute) {
  registry.registerPath({
    method: "post",
    path: `/api/v1${route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`,
    tags: [route.tag],
    operationId: route.operationId,
    security: security(),
    "x-required-scope": route.scope,
    request: { body: jsonBody(RequestBodySchema) },
    responses: responses(ApiSingleSchema),
  });
}

function registerPlatformOpenApi(registry: OpenAPIRegistry) {
  const platformPaths = [
    ["get", "/api/v1/api-clients", "listApiClients"],
    ["post", "/api/v1/api-clients", "createApiClient"],
    ["patch", "/api/v1/api-clients/{id}", "updateApiClient"],
    ["get", "/api/v1/api-tokens", "listApiTokens"],
    ["post", "/api/v1/api-tokens", "createApiToken"],
    ["post", "/api/v1/api-tokens/{id}/revoke", "revokeApiToken"],
    ["get", "/api/v1/plugin-installations", "listPluginInstallations"],
    ["post", "/api/v1/plugin-installations", "createPluginInstallation"],
    ["get", "/api/v1/webhook-subscriptions", "listWebhookSubscriptions"],
    ["post", "/api/v1/webhook-subscriptions", "createWebhookSubscription"],
    ["get", "/api/v1/webhook-deliveries", "listWebhookDeliveries"],
  ] as const;
  for (const [method, path, operation] of platformPaths) {
    registry.registerPath({
      method,
      path,
      tags: ["Plugin Platform"],
      operationId: operation,
      security: security(),
      "x-required-scope": "settings:manage",
      request: method === "get" ? undefined : { body: jsonBody(RequestBodySchema) },
      responses: responses(method === "get" ? ApiListSchema : ApiSingleSchema, method === "post" ? 201 : 200),
    });
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

function crud(module: string): Partial<ResourceRoute> {
  return {
    list: query(`${module}.list`),
    get: query(`${module}.get`),
    create: mutation(`${module}.create`),
    update: mutation(`${module}.update`),
    remove: mutation(`${module}.remove`),
  };
}

function collection(module: string): Partial<ResourceRoute> {
  return {
    list: query(`${module}.list`),
    create: mutation(`${module}.create`),
    update: mutation(`${module}.update`),
    remove: mutation(`${module}.remove`),
  };
}

function resource(
  name: string,
  tag: string,
  scope: string,
  config: Partial<ResourceRoute>,
): ResourceRoute {
  return {
    name,
    tag,
    scope,
    updateArgs: (req) => ({ id: req.params.id, patch: stripActor(req.body) }),
    removeArgs: (req) => ({ id: req.params.id }),
    ...config,
  };
}

function actionRoute(
  path: string,
  tag: string,
  scope: Scope,
  call: ConvexCall,
  args: ActionRoute["args"],
  event?: string,
): ActionRoute {
  return {
    method: "post",
    path,
    tag,
    scope,
    call,
    args,
    event,
    operationId: operationId(path.split("/").filter(Boolean).join("-"), "action"),
  };
}

async function fillUnbcAffiliatePdf(templatePath: string, affiliate: Record<string, unknown>) {
  const pdfDoc = await PDFDocument.load(await readFile(templatePath));
  const form = pdfDoc.getForm();
  for (const [fieldName, rawValue] of Object.entries(affiliate)) {
    if (fieldName === "Authorizing Signature") continue;
    const value = rawValue == null ? "" : String(rawValue);
    try {
      if (typeof rawValue === "boolean") {
        const checkbox = form.getCheckBox(fieldName);
        if (rawValue) checkbox.check();
        else checkbox.uncheck();
        continue;
      }
      form.getTextField(fieldName).setText(value);
    } catch {
      // The template has a few non-text widgets. Unknown fields are ignored so
      // the n8n payload can be broader than this specific PDF revision.
    }
  }
  form.updateFieldAppearances();
  return await pdfDoc.save();
}

function normalizeAffiliatePayload(value: unknown) {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    "Legal First Name of Affiliate": input["Legal First Name of Affiliate"] ?? input.firstName ?? "",
    "Legal Middle Name of Affiliate": input["Legal Middle Name of Affiliate"] ?? input.middleName ?? "",
    "Legal Last Name of Affiliate": input["Legal Last Name of Affiliate"] ?? input.lastName ?? "",
    "Current Mailing Address": input["Current Mailing Address"] ?? input.mailingAddress ?? "",
    "Emergency Contact(Name and Ph)": input["Emergency Contact(Name and Ph)"] ?? input.emergencyContact ?? "",
    "UNBC ID #": input["UNBC ID #"] ?? input.unbcId ?? "",
    "Birthdate of Affiliate (MM/DD/YYYY)": input["Birthdate of Affiliate (MM/DD/YYYY)"] ?? input.birthdate ?? "",
    "Personal email address": input["Personal email address"] ?? input.email ?? "",
    "Name of requesting Manager": input["Name of requesting Manager"] ?? input.managerName ?? "",
    "UNBC Department/Organization": input["UNBC Department/Organization"] ?? input.department ?? "",
    "Length of Affiliate status(lf known)": input["Length of Affiliate status(lf known)"] ?? input.affiliateStatusLength ?? "",
    ManagerPhone: input.ManagerPhone ?? input.managerPhone ?? "",
    "Manager Email": input["Manager Email"] ?? input.managerEmail ?? "",
    "Authorizing Name (if different from Manager)": input["Authorizing Name (if different from Manager)"] ?? input.authorizingName ?? "",
    "Date signed": input["Date signed"] ?? input.dateSigned ?? new Date().toISOString().slice(0, 10),
    "Check Box0": Boolean(input["Check Box0"] ?? input.previousUnbcIdYes),
    "Check Box1": Boolean(input["Check Box1"] ?? input.previousUnbcIdNo),
  };
}

function workflowPdfFileName(affiliate: Record<string, unknown>) {
  const first = String(affiliate["Legal First Name of Affiliate"] ?? "Affiliate").trim() || "Affiliate";
  const last = String(affiliate["Legal Last Name of Affiliate"] ?? "Request").trim() || "Request";
  return sanitizeFileName(`UNBC Affiliate ID Request - ${last}, ${first}.pdf`);
}

function requireWorkflowSecret(req: Request) {
  const expected = process.env.SOCIETYER_WORKFLOW_CALLBACK_SECRET;
  if (!expected) {
    throw httpError(500, "workflow_secret_missing", "SOCIETYER_WORKFLOW_CALLBACK_SECRET is not configured.");
  }
  const provided =
    req.get("x-societyer-workflow-secret") ??
    req.get("x-societyer-callback-secret") ??
    bearerToken(req) ??
    (typeof req.body?.callbackSecret === "string" ? req.body.callbackSecret : undefined);
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw httpError(401, "invalid_workflow_secret", "Workflow callback secret is invalid.");
  }
}

function bearerToken(req: Request) {
  const header = req.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return undefined;
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decodeBase64Pdf(value: string) {
  const pdf = Buffer.from(value, "base64");
  if (pdf.byteLength === 0 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw httpError(400, "invalid_pdf_payload", "generatedPdf.base64 must be a PDF file.");
  }
  return pdf;
}

function generatedWorkflowDocumentDir() {
  return path.resolve(process.cwd(), "data", "workflow-generated-documents");
}

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.endsWith(".pdf") ? cleaned : `${cleaned || "workflow-generated-document"}.pdf`;
}

function sanitizeStorageKey(value: string) {
  if (!/^[a-zA-Z0-9._, -]+$/.test(value)) {
    throw httpError(400, "invalid_document_key", "Generated document key is invalid.");
  }
  return value;
}

function downloadFileNameFromStorageKey(value: string) {
  return sanitizeFileName(value.replace(/^[0-9a-f-]+-/i, ""));
}

async function convexCall(client: ConvexHttpClient, call: ConvexCall, args: Record<string, unknown>) {
  const ref = functionRef(call.name);
  if (call.kind === "query") return await client.query(ref as any, args);
  if (call.kind === "mutation") return await client.mutation(ref as any, args);
  return await client.action(ref as any, args);
}

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
