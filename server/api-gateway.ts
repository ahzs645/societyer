import "./env";
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
