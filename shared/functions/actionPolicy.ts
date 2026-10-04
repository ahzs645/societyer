/** One application action policy shared by hosted and local entry points. */
import type { PortableQueryCtx } from "../portable/ctx";
import { requireAuthenticated } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";

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
  users: ["users", "invitations"], tasks: ["tasks", "workflows", "workflowPackages", "workflowCatalog", "notifications", "notes", "aiChat", "aiChatActions", "aiAgents"],
  exports: ["exports"], audit: ["activity"], volunteers: ["volunteers"], communications: ["communications", "pendingEmails", "partyPortals", "publicPortal"],
  settings: ["apiPlatform", "aiSettings", "aiSettingsActions", "corporationSettings", "serviceProviders", "subscriptions", "programStatements", "secrets", "nameHistory", "recordLayouts", "objectMetadata", "customFields", "fieldMetadata", "views", "commandMenuItems", "importSessions", "waveCache", "permissions", "transparency", "calendarFeed"],
};

const RESOURCES = Object.fromEntries(Object.entries(RESOURCE_GROUPS).flatMap(([resource, domains]) => domains.map((domain) => [domain, resource])));
const HANDLER_POLICIES = new Set([
  "apiPlatform:createToken", "apiPlatform:verifyToken", "apiPlatform:resourceTenantStatus", "apiPlatform:listWebhookSubscriptionsForEvent", "apiPlatform:upsertWebhookSubscription", "apiPlatform:setWebhookSubscriptionStatus", "apiPlatform:createWebhookDelivery", "apiPlatform:updateWebhookDelivery", "apiPlatform:upsertIntegrationSyncState", "apiPlatform:bootstrapUserIdentity",
  "elections:castBallot", "elections:submitNomination",
  "files:getUrl", "users:ensureCurrentMembership", "users:recordLogin", "users:get", "users:getByAuthSubject", "users:getByEmail",
  "invitations:accept", "invitations:getByToken", "permissions:myPermissions", "permissions:check", "permissions:listAll",
  "society:createWorkspace", "society:create", "society:list", "society:listMine", "society:current", "firm:list", "firm:organizations",
  "http:currentPrincipalMemberships", "http:me", "http:gatewayApiPrincipal", "http:gatewayWorkflowBinding", "http:gatewayGeneratedDocumentAccess",
]);
// Public intake/token routes retain their existing narrow, handler-level policy.
const PUBLIC_HANDLERS = new Set(["publicPortal:getSocietyBySlug", "publicPortal:volunteerIntakeContext", "publicPortal:grantIntakeContext", "transparency:publicCenter", "partyPortals:center", "volunteers:submitApplication","grants:submitApplication", "publicPortal:getByToken", "publicPortal:submit", "partyPortals:getByToken", "partyPortals:respond"]);

export function actionPermission(name: string, kind: "query" | "mutation" | "action"): Permission | null {
  if (HANDLER_POLICIES.has(name) || PUBLIC_HANDLERS.has(name)) return null;
  const [domain, action] = name.split(":");
  if (domain === "seed" || domain.endsWith("Backfill") || domain === "seedRecordTableMetadata") return null;
  const resource = RESOURCES[domain];
  if (!resource) throw new Error(`Unclassified application action: ${name}.`);
  if (name === "society:updateIntegrationSettings" || name === "society:reset") return "settings:manage";
  if (resource === "audit") return kind === "query" ? "audit:read" : "settings:write";
  if (name === "postIncorporation:recordEvidence") return "documents:write";
  if (name === "calendarFeed:getFeedToken") return "settings:write";
  if (name === "documents:recordOpen") return "documents:read";
  if (name === "minutes:approve") return "minutes:approve";
  if (resource === "exports") return kind === "query" && action === "list" ? "exports:read" : "exports:download";
  return `${resource}:${kind === "query" ? "read" : "write"}` as Permission;
}

async function societyForArgs(ctx: PortableQueryCtx, args: Record<string, any>): Promise<string | undefined> {
  let expectedSocietyId = typeof args.societyId === "string" ? args.societyId : undefined;
  if (typeof args.patch?.societyId === "string") throw new Error("Workspace reassignment is not permitted.");
  // Resolve every referenced row recursively, including child rows whose
  // workspace is stored only on a parent. A missing record never falls back
  // to another workspace's authority.
  const referenceFields = Object.keys(args).filter((field) => (field === "id" || field.endsWith("Id")) && !field.endsWith("ExternalId") && !field.startsWith("external") && !["actingUserId", "actorUserId", "createdByUserId", "invitedByUserId", "storageId"].includes(field));
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
  const permission = actionPermission(name, kind);
  if (!permission) return; // Explicit handlers perform their specialized policy.
  requireAuthenticated(ctx);
  const societyId = await societyForArgs(ctx, args);
  if (societyId) {
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
