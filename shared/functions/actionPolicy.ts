/** One application action policy shared by hosted and local entry points. */
import type { PortableQueryCtx } from "../portable/ctx";
import { requireAuthenticated } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { isAllowedOption } from "../orgHubOptions";

const RESOURCE_GROUPS: Record<string, readonly string[]> = {
  society: ["society", "dashboard", "organizationDetails", "organizationHistory", "firm"],
  members: ["members", "peopleDirectory", "roleHolderHistory", "registerHistory", "orgChartAssignments"],
  directors: ["directors"], employees: ["employees", "remuneration"], committees: ["committees"],
  meetings: ["meetings", "meetingTemplates", "meetingMaterials", "agm", "calendarSync", "transcripts"],
  minutes: ["minutes", "minuteBook"], agendas: ["agendas"], motions: ["motions", "motionBacklog", "motionTemplates", "writtenResolutions", "memberProposals"],
  proxies: ["proxies"], conflicts: ["conflicts"], attestations: ["attestations", "pipaTraining"], auditors: ["auditors"], courtOrders: ["courtOrders"],
  filings: ["filings", "annualFilings", "filingExports", "filingBot"],
  deadlines: ["deadlines", "complianceObligations", "postIncorporation", "significantIndividualSteps", "annualCycle", "dashboardRemediation", ],
  commitments: ["commitments", "goals"],
  financials: ["financials", "accounting", "treasury", "financialHub", "reconciliation", "receipts", "expenseReports", "assets", "insurance", "inventoryHub", "fundingSources", "dividends", "yearEnd"],
  elections: ["elections"], grants: ["grants", "grantSources"],
  documents: ["documents", "documentVersions", "documentComments", "files", "paperless", "library", "policies", "starterPolicyTemplates", "constating", "bylawAmendments", "bylawRules", "evidenceRegisters", "shareCertificates", "signatures", "entitySigners", "retention", "recordsLocation", "inspections", "legalOperations"],
  users: ["users", "invitations"], tasks: ["pathways", "tasks", "workflows", "workflowPackages", "workflowCatalog", "notifications", "notes", "aiChat", "aiChatActions", "aiAgents"],
  exports: ["exports"], audit: ["activity"], volunteers: ["volunteers"], communications: ["communications", "pendingEmails", "partyPortals", "publicPortal"],
  settings: ["apiPlatform", "aiSettings", "aiSettingsActions", "corporationSettings", "serviceProviders", "subscriptions", "programStatements", "secrets", "nameHistory", "recordLayouts", "objectMetadata", "customFields", "fieldMetadata", "views", "commandMenuItems", "importSessions", "waveCache", "permissions", "transparency", "calendarFeed"],
};

const RESOURCES = Object.fromEntries(Object.entries(RESOURCE_GROUPS).flatMap(([resource, domains]) => domains.map((domain) => [domain, resource])));
// Built-in table names do not always equal their public function domain.
// These aliases are schema-owned, not supplied by a request or metadata row.
// Unknown/custom tables deliberately keep the settings catalog permission.
const METADATA_TABLE_DOMAINS: Readonly<Record<string, string>> = {
  roleHolders: "legalOperations", auditLogEntries: "activity",
  workflowRuns: "workflows", outboxMessages: "pendingEmails",
  auditorAppointments: "auditors", pipaTrainings: "pipaTraining",
  directorAttestations: "attestations", customFieldDefinitions: "customFields",
  publications: "transparency", apiClients: "apiPlatform", apiTokens: "apiPlatform",
  secretVaultItems: "secrets", retentionRows: "retention",
  reconciliationTransactions: "reconciliation", counterpartyTransactions: "financialHub",
  accountTransactions: "financialHub", profileFacts: "organizationDetails",
  donationReceipts: "receipts", minuteBookItems: "minuteBook",
  insurancePolicies: "insurance", volunteerApplications: "volunteers",
  volunteerScreenings: "volunteers", financialTransactions: "financialHub",
  communicationTemplates: "communications", communicationSegments: "communications",
  communicationCampaigns: "communications", communicationDeliveries: "communications",
  grantApplications: "grants", grantTransactions: "grants", grantReports: "grants",
};
const HANDLER_POLICIES = new Set([
  "apiPlatform:createToken", "apiPlatform:verifyToken", "apiPlatform:resourceTenantStatus", "apiPlatform:listWebhookSubscriptionsForEvent", "apiPlatform:upsertWebhookSubscription", "apiPlatform:setWebhookSubscriptionStatus", "apiPlatform:createWebhookDelivery", "apiPlatform:updateWebhookDelivery", "apiPlatform:upsertIntegrationSyncState", "apiPlatform:bootstrapUserIdentity", "apiPlatform:migrateUserToClerk",
  "elections:castBallot", "elections:submitNomination",
  "files:getUrl", "users:ensureCurrentMembership", "users:recordLogin", "users:get", "users:getByAuthSubject", "users:getByEmail",
  "invitations:accept", "invitations:getByToken", "permissions:myPermissions", "permissions:check", "permissions:listAll",
  "society:createWorkspace", "society:create", "society:list", "society:listMine", "society:current", "firm:list", "firm:organizations",
  "http:currentPrincipalMemberships", "http:me", "http:gatewayApiPrincipal", "http:gatewayWorkflowBinding", "http:gatewayGeneratedDocumentAccess",
]);
// Public intake/token routes retain their existing narrow, handler-level policy.
const PUBLIC_HANDLERS = new Set(["publicPortal:getSocietyBySlug", "publicPortal:volunteerIntakeContext", "publicPortal:grantIntakeContext", "transparency:publicCenter", "partyPortals:center", "volunteers:submitApplication","grants:submitApplication", "publicPortal:getByToken", "publicPortal:submit", "partyPortals:getByToken", "partyPortals:respond"]);

// These identifiers are citation keys or provider identifiers, never local row
// references. Keep the exceptions endpoint-specific: targetId and other row
// references in the same request still require workspace ownership.
const OPAQUE_IDENTIFIERS: Record<string, readonly string[]> = {
  "complianceObligations:markReviewed": ["ruleId"],
  "complianceObligations:dismissDecision": ["ruleId"],
  "complianceObligations:reopenDecision": ["ruleId"],
  "dashboardRemediation:createComplianceReviewTask": ["ruleId"],
  "dashboardRemediation:createPrivacyReviewTask": ["ruleId"],
  "dashboardRemediation:markPrivacyProgramReviewed": ["ruleId"],
  "dashboardRemediation:markMemberDataAccessReviewed": ["ruleId"],
  "legalOperations:stageCorporationDocumentPacket": ["obligationRuleId"],
  "waveCache:sync": ["businessId"],
  "waveCache:healthCheck": ["businessId"],
  "waveCache:invoicePaymentProbe": ["businessId"],
  "aiSettings:upsert": ["modelId"],
  "aiChat:createThread": ["modelId"],
  "aiChatActions:sendChatMessage": ["modelId"],
  "calendarSync:stageCalendarEvents": ["calendarId"],
  "calendarSync:upsertExternalCalendarEventMapping": ["calendarId"],
  "calendarSync:recordCalendarIncrementalCursor": ["calendarId"],
  "calendarSync:recordCalendarWebhook": ["channelId", "subscriptionId", "resourceId"],
  "workflowPackages:upsert": ["transactionId", "stripeCheckoutSessionId"],
  "workflowPackages:markFiled": ["transactionId"],
  "workflows:recordConnectorRun": ["connectorId", "actionId", "sessionId"],
  "agm:logNoticeDelivery": ["providerMessageId"],
  "subscriptions:upsertPlan": ["stripePriceId"],
  "paperless:recordSyncResult": ["paperlessTaskId"],
  "legalOperations:upsertGeneratedLegalDocument": ["syngrafiiFileId", "syngrafiiDocumentId", "syngrafiiPackageId"],
  "legalOperations:upsertJurisdictionMetadata": ["nuansReservationReportTypeId", "sourceOptionId"],
};

export function actionPermission(name: string, kind: "query" | "mutation" | "action"): Permission | null {
  if (HANDLER_POLICIES.has(name) || PUBLIC_HANDLERS.has(name)) return null;
  if (name === "seedRecordTableMetadata:ensureForSociety") return "settings:write";
  const [domain, action] = name.split(":");
  if (domain === "seed" || domain.endsWith("Backfill") || domain === "seedRecordTableMetadata") return null;
  const resource = RESOURCES[domain];
  if (!resource) throw new Error(`Unclassified application action: ${name}.`);
  if (["society:updateModules", "society:updateComplianceSettings", "society:updateInventorySettings", "society:updateNotificationSettings"].includes(name)) return "settings:write";
  if (name === "society:updateIntegrationSettings" || name === "society:reset") return "settings:manage";
  if (resource === "audit") return kind === "query" ? "audit:read" : "settings:write";
  if (domain === "orgChartAssignments") return kind === "query" ? "settings:read" : "settings:write";
  if (name === "registerHistory:directorsAsOf") return "directors:read";
  if (name === "registerHistory:significantIndividualsAsOf") return "settings:read";
  if (["pathways:approve", "pathways:reject"].includes(name)) return "documents:write";
  if (["pathways:requestSubmission", "pathways:recordManualReceipt"].includes(name)) return "filings:submit";
  if (name === "postIncorporation:recordEvidence") return "documents:write";
  if (name === "calendarFeed:getFeedToken") return "settings:write";
  if (name === "documents:recordOpen") return "documents:read";
  if (["documentVersions:getDownloadTarget", "documentVersions:getDownloadUrl", "workflows:inspectPdfTemplate"].includes(name)) return "documents:read";
  if (name === "minutes:approve") return "minutes:approve";
  if (resource === "exports") return kind === "query" && action === "list" ? "exports:read" : "exports:download";
  return `${resource}:${kind === "query" ? "read" : "write"}` as Permission;
}

async function societyForArgs(ctx: PortableQueryCtx, name: string, args: Record<string, any>): Promise<string | undefined> {
  let expectedSocietyId = typeof args.societyId === "string" ? args.societyId : undefined;
  if (typeof args.patch?.societyId === "string") throw new Error("Workspace reassignment is not permitted.");
  // Resolve every referenced row recursively, including child rows whose
  // workspace is stored only on a parent. A missing record never falls back
  // to another workspace's authority.
  const referenceFields = Object.keys(args).filter((field) => (field === "id" || field.endsWith("Id")) && !field.endsWith("ExternalId") && !field.startsWith("external") && !OPAQUE_IDENTIFIERS[name]?.includes(field) && !["actingUserId", "actorUserId", "createdByUserId", "invitedByUserId", "storageId"].includes(field));
  const seen = new Set<string>();
  async function resolve(id: string, depth = 0): Promise<string | undefined> {
    if (seen.has(id) || depth > 5) return undefined;
    seen.add(id);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Record not found.");
    if (typeof row.societyId === "string") return row.societyId;
    const society = await ctx.db.get(id, "societies");
    if (society) return society._id;
    for (const parent of ["meetingId", "documentId", "agendaId", "workflowId", "electionId", "sessionId", "runId", "grantId", "rightsClassId", "roleHolderId", "accountId"]) {
      if (typeof row[parent] === "string") {
        const result = await resolve(row[parent], depth + 1);
        if (result) return result;
      }
    }
    return undefined;
  }
  for (const field of referenceFields) {
    if (field === "societyId" || typeof args[field] !== "string") continue;
    const societyId = await resolve(args[field]);
    if (!societyId) continue;
    if (expectedSocietyId && expectedSocietyId !== societyId) throw new Error("Record not found.");
    expectedSocietyId = societyId;
  }
  return expectedSocietyId ?? (ctx.principal.kind !== "anonymous" ? ctx.principal.societyId : undefined);
}

export async function requireFunctionAction(ctx: PortableQueryCtx, name: string, kind: "query" | "mutation" | "action", args: Record<string, any>) {
  let permission = actionPermission(name, kind);
  if (!permission) return; // Explicit handlers perform their specialized policy.
  requireAuthenticated(ctx);
  if (kind === "query" && name === "registerHistory:roleHoldersAsOfDate") {
    // This query can select registers with different read authority. Controller
    // rows must not bypass the significant-individual endpoint's privacy gate.
    if (["director", "officer"].includes(args.roleType)) permission = "directors:read";
    else if (args.roleType === "controller") permission = "settings:read";
    else if (args.roleType !== "other" && !isAllowedOption("representativeTypes", args.roleType)) throw new Error("Unsupported historical role type.");
  }
  const societyId = await societyForArgs(ctx, name, args);
  if (societyId) {
    if (kind === "query") permission = await scopedMetadataPermission(ctx, name, args, societyId) ?? permission;
    const actor = await requirePermissionPortable(ctx, societyId, permission);
    if (args.actingUserId && args.actingUserId !== actor._id) throw new Error("Authenticated actor does not match the current principal.");
    return;
  }
  // Unscoped catalog operations still require a current membership. Scoped
  // references are resolved above and never authorize against another society.
  const [domain] = name.split(":");
  if (kind !== "query" && !["commandMenuItems", "fieldMetadata", "objectMetadata", "starterPolicyTemplates", "workflowCatalog"].includes(domain)) throw new Error("An authorized workspace or record is required.");
  const societies = await ctx.db.query("societies").collect();
  for (const society of societies) {
    try { await requirePermissionPortable(ctx, society._id, permission); return; } catch { /* Try another membership. */ }
  }
  throw new Error(`Permission ${permission} required in an active workspace.`);
}

/** Reading a table's layout requires that table's read permission. Catalog
 * discovery and every metadata write retain the settings policy. Resolve the
 * persisted object, never a client-supplied resource or route label. */
async function scopedMetadataPermission(ctx: PortableQueryCtx, name: string, args: Record<string, any>, societyId: string): Promise<Permission | null> {
  let object: any;
  if (name === "views:listSharedForDataTable" && args.objectMetadataId) {
    object = await ctx.db.get(args.objectMetadataId, "objectMetadata");
  } else if (["objectMetadata:getByNameSingular", "objectMetadata:getFullTableSetup"].includes(name) || (name === "views:listSharedForDataTable" && typeof args.nameSingular === "string")) {
    const rows = await ctx.db.query("objectMetadata").withIndex("by_society_name", q => q.eq("societyId", societyId).eq("nameSingular", args.nameSingular)).collect();
    object = rows.sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
  } else if (name === "objectMetadata:getByNamePlural") {
    const rows = await ctx.db.query("objectMetadata").withIndex("by_society_name_plural", q => q.eq("societyId", societyId).eq("namePlural", args.namePlural)).collect();
    object = rows.sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
  } else if (name === "objectMetadata:get") {
    object = await ctx.db.get(args.id, "objectMetadata");
  } else if (["objectMetadata:getWithFields", "fieldMetadata:listForObject", "fieldMetadata:getByName", "views:listForObject"].includes(name)) {
    object = await ctx.db.get(args.objectMetadataId, "objectMetadata");
  } else if (name === "fieldMetadata:get") {
    const field = await ctx.db.get(args.id, "fieldMetadata");
    if (field?.societyId !== societyId) throw new Error("Record not found.");
    object = await ctx.db.get(field.objectMetadataId, "objectMetadata");
  } else if (["views:get", "views:getHydrated", "views:listFieldsForView"].includes(name)) {
    const view = await ctx.db.get(args.id ?? args.viewId, "views");
    if (view?.societyId !== societyId) throw new Error("Record not found.");
    object = await ctx.db.get(view.objectMetadataId, "objectMetadata");
  } else return null;
  if (!object) return null;
  if (object.societyId !== societyId) throw new Error("Record not found.");
  const domain = Object.prototype.hasOwnProperty.call(METADATA_TABLE_DOMAINS, object.namePlural)
    ? METADATA_TABLE_DOMAINS[object.namePlural] : object.namePlural;
  const resource = Object.prototype.hasOwnProperty.call(RESOURCES, domain) ? RESOURCES[domain] : undefined;
  return resource ? `${resource}:read` as Permission : null;
}
