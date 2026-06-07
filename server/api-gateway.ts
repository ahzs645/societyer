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
import {
  buildPdfTableImportBundle,
  normalizePdfTableStructures,
} from "../convex/lib/pdfTableNormalization";
import { auth, getAuthMode } from "./auth-config";
import {
  importGcosProjectSnapshotViaConvex,
  normalizeGcosExportedSnapshot,
} from "./gcos-import";
import { recordConnectorRun as recordConnectorRunHistory } from "./integrations/connector-run-recorder";
import { stageConnectorImportSession } from "./integrations/staged-imports";
import { waveTransactionsImportBundle } from "./integrations/wave-staging";
import { gcosProjectSnapshotImportBundle } from "./integrations/gcos-staging";
import {
  bcRegistryFilingHistoryBundle,
  bcRegistryGovernanceDocumentsBundle,
  type BcRegistryCsvRecord,
  type GovernanceImportCandidate,
} from "./integrations/bc-registry-staging";

extendZodWithOpenApi(z);

import {
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
} from "./api-gateway/shared";
import {
  fillUnbcAffiliatePdf,
  fillGenericPdf,
  inspectPdfTemplate,
  inspectPdfField,
  pdfFieldType,
  pdfFieldValue,
  cleanPdfFieldValue,
  detectRepeatedPdfFieldTables,
  detectLayoutTextTables,
  parseRepeatedFieldName,
  boundsForRects,
  roundNumber,
  slugifyPdfKey,
  readPdfFile,
  assertPdfBytes,
  normalizePdfFieldPayload,
  sanitizeTemplateKey,
  workflowPdfTemplatePath,
  workflowPdfFileNameForTemplate,
  normalizeAffiliatePayload,
  workflowPdfFileName,
  requireWorkflowSecret,
  bearerToken,
  timingSafeEqual,
  decodeBase64Pdf,
  generatedWorkflowDocumentDir,
  sanitizeFileName,
  sanitizeStorageKey,
  downloadFileNameFromStorageKey,
} from "./api-gateway/pdf";
import { safeJson, arrayOf, stringValue, compactStrings } from "./api-gateway/shared";
import {
  emitWebhookEvent,
  connectorRunnerRequest,
  recordConnectorRun,
  deliverWebhook,
  query,
  mutation,
  action,
  convexCall,
} from "./api-gateway/convex-client";
import {
  importGovernanceDocumentsFromBcRegistry,
  importBcRegistryFilingHistory,
  importBylawsHistoryFromBcRegistry,
  importBcRegistryPdfDocuments,
  buildBcRegistryBylawsHistoryBundle,
  uniqueBcRegistryDocumentRows,
  isBcRegistryBylawsHistoryRow,
  bestBcRegistryBylawsDocumentRow,
  bcRegistryBylawsRowsToStage,
  isBcRegistryFullBylawsVersionRow,
  bcRegistryBylawsSourceTitle,
  extractPdfTextWithPdftotext,
  registryBylawsMarkdownFromText,
  registryVisionReviewMarkdown,
  rebreakRegistryBylawsText,
  normalizeRegistryBylawLine,
  cleanRegistryText,
  looksLikeFullBylawsText,
  isRegistryPdfPageMarker,
  sameRegistryNormalizedText,
  isLikelyRegistryStandaloneHeading,
  dateToStartIso,
  buildBcRegistryFilingImportRecords,
  groupBcRegistryFilingRows,
  normalizeBcRegistryCorpNum,
  resolveBcRegistryExport,
  browserConnectorExportRoot,
  latestBcRegistryExport,
  runBcRegistryExportFromActiveSession,
  readBcRegistryFilingRecords,
  pickGovernanceImportCandidates,
  candidateFromRegistryRow,
  copyGovernanceCandidateToDocumentStorage,
  readPdfMetadata,
  copyPdfToDocumentStorage,
  bcRegistryDocumentTitle,
  bcRegistryDocumentCategory,
  parseBcRegistryDate,
  monthNumber,
  deriveBcRegistryDueDate,
  addDaysISO,
  deriveBcRegistryPeriodLabel,
  compactBcRegistryFilingLabel,
  firstNonEmpty,
  uniqueStrings,
  parseCsv,
} from "./api-gateway/bc-registry";
import type {
  ConvexCall,
  Scope,
  Actor,
  ResourceRoute,
  ActionRoute,
} from "./api-gateway/shared";

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

  mountMaintenanceRoutes(router, client);
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

function mountMaintenanceRoutes(router: Router, client: ConvexHttpClient) {
  router.post(
    "/maintenance/seed",
    requireLocalMaintenanceAccess,
    asyncHandler(async (_req, res) => {
      const result = await convexCall(client, mutation("seed.run"), {
        serviceToken: maintenanceServiceToken(),
      });
      res.json(result);
    }),
  );

  router.post(
    "/maintenance/reset",
    requireLocalMaintenanceAccess,
    asyncHandler(async (_req, res) => {
      const result = await convexCall(client, mutation("seed.reset"), {
        serviceToken: maintenanceServiceToken(),
      });
      res.json(result ?? { ok: true });
    }),
  );
}

function requireLocalMaintenanceAccess(req: Request, _res: Response, next: NextFunction) {
  if (getAuthMode() !== "none" || process.env.NODE_ENV === "production" || !isLocalRequest(req)) {
    throw httpError(403, "maintenance_unavailable", "Maintenance endpoints are local development only.");
  }
  next();
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
        serviceToken: apiPlatformServiceToken(),
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
        serviceToken: apiPlatformServiceToken(),
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
      const connectorIdRaw = String(req.params.connectorId);
      const sessionIdRaw = String(req.params.sessionId);
      const actionIdRaw = String(req.params.actionId);
      const connectorId = encodeURIComponent(connectorIdRaw);
      const sessionId = encodeURIComponent(sessionIdRaw);
      const actionId = encodeURIComponent(actionIdRaw);
      const runnerOutput: any = await connectorRunnerRequest("POST", `/connectors/${connectorId}/auth/sessions/${sessionId}/actions/${actionId}`, stripActor(req.body ?? {}));
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: connectorIdRaw,
        actionId: actionIdRaw,
        sessionId: sessionIdRaw,
        output: runnerOutput,
      });
      res.json(singleResponse({ ...runnerOutput, workflowRunId }));
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
      const societyId = societyIdFrom(req, req.actor!);
      const importResult = body.applyDirect === true
        ? await convexCall(client, mutation("financialHub.importBrowserWaveTransactions"), dropUndefined({
            societyId,
            businessId: runnerOutput.businessId,
            profileKey: runnerOutput.profileKey ?? body.profileKey,
            accounts: normalized.accounts,
            transactions: normalized.transactions,
            actingUserId: req.actor?.userId,
          }))
        : await stageConnectorImportSession(client, convexCall, {
            societyId,
            name: `Wave transactions - ${new Date().toISOString().slice(0, 10)}`,
            bundle: waveTransactionsImportBundle(runnerOutput, normalized),
          });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "wave",
        actionId: "importTransactions",
        sessionId: String(req.params.sessionId),
        output: { ...runnerOutput, import: importResult },
      });
      res.json(singleResponse({ ...runnerOutput, import: importResult, workflowRunId }));
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
      const societyId = societyIdFrom(req, req.actor!);
      const importResult = body.applyDirect === true
        ? await convexCall(client, mutation("financialHub.importBrowserWaveTransactions"), dropUndefined({
            societyId,
            businessId: runnerOutput.businessId,
            profileKey: runnerOutput.profileKey ?? body.profileKey,
            accounts: normalized.accounts,
            transactions: normalized.transactions,
            actingUserId: req.actor?.userId,
          }))
        : await stageConnectorImportSession(client, convexCall, {
            societyId,
            name: `Wave transactions - ${new Date().toISOString().slice(0, 10)}`,
            bundle: waveTransactionsImportBundle(runnerOutput, normalized),
          });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "wave",
        actionId: "importTransactions",
        output: { ...runnerOutput, import: importResult },
      });
      res.json(singleResponse({ ...runnerOutput, import: importResult, workflowRunId }));
    }),
  );

  router.post(
    "/browser-connectors/connectors/gcos/auth/sessions/:sessionId/import-project-snapshot",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const sessionId = encodeURIComponent(String(req.params.sessionId));
      const body = stripActor(req.body ?? {});
      const runnerOutput: any = await connectorRunnerRequest(
        "POST",
        `/connectors/gcos/auth/sessions/${sessionId}/actions/exportProjectSnapshot`,
        body,
      );
      if (!runnerOutput?.normalizedGrant) {
        throw httpError(502, "connector_import_invalid", "GCOS connector did not return a normalized grant snapshot.");
      }
      const societyId = societyIdFrom(req, req.actor!);
      const importResult = body.applyDirect === true
        ? await importGcosProjectSnapshotViaConvex(client, convexCall, {
            societyId,
            normalizedGrant: runnerOutput.normalizedGrant,
            snapshot: runnerOutput,
            actingUserId: req.actor?.userId,
          })
        : await stageConnectorImportSession(client, convexCall, {
            societyId,
            name: `GCOS project snapshot - ${new Date().toISOString().slice(0, 10)}`,
            bundle: gcosProjectSnapshotImportBundle(runnerOutput.normalizedGrant, runnerOutput),
          });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "gcos",
        actionId: "exportProjectSnapshot",
        sessionId: String(req.params.sessionId),
        output: { ...runnerOutput, import: importResult },
      });
      res.json(singleResponse({ ...runnerOutput, import: importResult, workflowRunId }));
    }),
  );

  router.post(
    "/browser-connectors/connectors/gcos/import-project-snapshot",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const body = stripActor(req.body ?? {});
      const runnerOutput: any = await connectorRunnerRequest(
        "POST",
        "/connectors/gcos/actions/exportProjectSnapshot",
        body,
      );
      if (!runnerOutput?.normalizedGrant) {
        throw httpError(502, "connector_import_invalid", "GCOS connector did not return a normalized grant snapshot.");
      }
      const societyId = societyIdFrom(req, req.actor!);
      const importResult = body.applyDirect === true
        ? await importGcosProjectSnapshotViaConvex(client, convexCall, {
            societyId,
            normalizedGrant: runnerOutput.normalizedGrant,
            snapshot: runnerOutput,
            actingUserId: req.actor?.userId,
          })
        : await stageConnectorImportSession(client, convexCall, {
            societyId,
            name: `GCOS project snapshot - ${new Date().toISOString().slice(0, 10)}`,
            bundle: gcosProjectSnapshotImportBundle(runnerOutput.normalizedGrant, runnerOutput),
          });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "gcos",
        actionId: "exportProjectSnapshot",
        output: { ...runnerOutput, import: importResult },
      });
      res.json(singleResponse({ ...runnerOutput, import: importResult, workflowRunId }));
    }),
  );

  router.post(
    "/browser-connectors/connectors/gcos/import-exported-snapshot",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const body = stripActor(req.body ?? {});
      const snapshot = body.snapshot ?? body;
      const normalizedFromSnapshot = normalizeGcosExportedSnapshot(snapshot) ?? {};
      const normalizedGrant = dropUndefined({
        ...((snapshot as any)?.normalizedGrant ?? {}),
        ...normalizedFromSnapshot,
        ...(body.normalizedGrant ?? {}),
      });
      if (!normalizedGrant) {
        throw httpError(400, "gcos_export_invalid", "GCOS export JSON must include a snapshot or normalizedGrant.");
      }
      const societyId = societyIdFrom(req, req.actor!);
      const importResult = body.applyDirect === true
        ? await importGcosProjectSnapshotViaConvex(client, convexCall, {
            societyId,
            normalizedGrant,
            snapshot,
            actingUserId: req.actor?.userId,
          })
        : await stageConnectorImportSession(client, convexCall, {
            societyId,
            name: `GCOS exported snapshot - ${new Date().toISOString().slice(0, 10)}`,
            bundle: gcosProjectSnapshotImportBundle(normalizedGrant, snapshot),
          });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "gcos",
        actionId: "importExportedSnapshot",
        output: { snapshot, normalizedGrant, import: importResult },
      });
      res.json(singleResponse({ snapshot, normalizedGrant, import: importResult, workflowRunId }));
    }),
  );

  router.post(
    "/browser-connectors/connectors/:connectorId/actions/:actionId",
    requireScope(client, "settings:manage"),
    asyncHandler(async (req, res) => {
      const connectorIdRaw = String(req.params.connectorId);
      const actionIdRaw = String(req.params.actionId);
      const connectorId = encodeURIComponent(connectorIdRaw);
      const actionId = encodeURIComponent(actionIdRaw);
      const runnerOutput: any = await connectorRunnerRequest("POST", `/connectors/${connectorId}/actions/${actionId}`, stripActor(req.body ?? {}));
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: connectorIdRaw,
        actionId: actionIdRaw,
        output: runnerOutput,
      });
      res.json(singleResponse({ ...runnerOutput, workflowRunId }));
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
        stageOnly: req.body?.stageOnly === true,
      });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "bc-registry",
        actionId: req.body?.stageOnly === true ? "stageGovernanceDocuments" : "importGovernanceDocuments",
        output: result,
      });
      res.json(singleResponse({ ...result, workflowRunId }));
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
        stageOnly: req.body?.stageOnly !== false,
      });
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "bc-registry",
        actionId: req.body?.stageOnly === false ? "importFilingHistory" : "stageFilingHistory",
        output: result,
      });
      res.json(singleResponse({ ...result, workflowRunId }));
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
      const workflowRunId = await recordConnectorRun(client, req, {
        connectorId: "bc-registry",
        actionId: "stageBylawsHistory",
        output: result,
      });
      res.json(singleResponse({ ...result, workflowRunId }));
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
    "/workflow-pdf/inspect",
    asyncHandler(async (req, res) => {
      requireWorkflowSecret(req);
      const sourcePath = typeof req.body?.sourcePath === "string" ? req.body.sourcePath : undefined;
      const base64 = typeof req.body?.base64 === "string" ? req.body.base64 : undefined;
      let pdf: Buffer;
      if (sourcePath) {
        pdf = await readPdfFile(sourcePath, path.basename(sourcePath));
      } else if (base64) {
        pdf = Buffer.from(base64, "base64");
        assertPdfBytes(pdf, "base64 payload");
      } else {
        throw httpError(400, "pdf_source_required", "Provide sourcePath or base64.");
      }
      const text = sourcePath ? await extractPdfTextWithPdftotext(sourcePath) : "";
      const inspection = await inspectPdfTemplate(pdf, {
        fileName: sourcePath ? path.basename(sourcePath) : req.body?.fileName,
        sourcePath,
        layoutTextAvailable: Boolean(text.trim()),
      });
      const textTables = detectLayoutTextTables(text);
      const normalizedTables = normalizePdfTableStructures({
        fields: inspection.fields,
        layoutText: text,
        metadata: inspection,
      });
      const importBundle = buildPdfTableImportBundle({
        tables: normalizedTables,
        metadata: inspection,
        source: {
          externalSystem: "workflow-pdf",
          externalId: sourcePath ? path.basename(sourcePath) : req.body?.fileName,
          title: sourcePath ? path.basename(sourcePath) : req.body?.fileName,
          fileName: sourcePath ? path.basename(sourcePath) : req.body?.fileName,
          localPath: sourcePath,
          mimeType: "application/pdf",
        },
      });
      res.json(singleResponse({
        ...inspection,
        textTables,
        normalizedTables,
        recordTables: normalizedTables.map((table) => table.recordTable),
        importBundle,
      }));
    }),
  );

  router.post(
    "/workflow-pdf/:templateKey/fill",
    asyncHandler(async (req, res) => {
      requireWorkflowSecret(req);
      const templateKey = sanitizeTemplateKey(req.params.templateKey);
      const templatePath = workflowPdfTemplatePath(templateKey);
      if (!templatePath) {
        throw httpError(
          500,
          "workflow_pdf_template_missing",
          `No local template path is configured for PDF template "${templateKey}".`,
        );
      }
      const fieldValues = normalizePdfFieldPayload(
        req.body?.fieldValues ??
          req.body?.fields ??
          req.body?.affiliate ??
          req.body?.input?.fieldValues ??
          req.body?.input?.affiliate,
      );
      const bytes = await fillGenericPdf(templatePath, fieldValues);
      res.json(
        singleResponse({
          filename: workflowPdfFileNameForTemplate(templateKey, fieldValues),
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
      serviceToken: apiPlatformServiceToken(),
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


