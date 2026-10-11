/** Enumerate production public wrappers; this is source coverage, not runtime coverage. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { actionPermission } from "../shared/functions/actionPolicy";
import { ROLES } from "../shared/functions/access";
import { listPermissionsForRole } from "../shared/functions/permissions";
import { getModuleAccess, MODULE_ACCESS_POLICY_NOTE } from "../src/lib/moduleAccess";
import { writeTrackedReport } from "./lib/writeTrackedReport.mjs";

const endpoints: any[] = [];
for (const file of readdirSync("convex").filter(file => file.endsWith(".ts")).sort()) {
  const source = readFileSync(`convex/${file}`, "utf8");
  for (const match of source.matchAll(/export const (\w+) = authorized(Query|Mutation|Action)\("([^"]+)"/g)) {
    const [, exported, builder, name] = match;
    const kind = builder.toLowerCase() as "query" | "mutation" | "action";
    assert.equal(name, `${file.slice(0, -3)}:${exported}`, "Wrapper policy identifier must match the exported endpoint");
    const permission = actionPermission(name, kind);
    endpoints.push({ name, kind, source: `convex/${file}`, line: source.slice(0, match.index).split("\n").length,
      authorization: permission ? "fixed-permission-and-handler" : "specialized-handler",
      permission, argumentDependent: ["roleHolderHistory:revisionHistory", "evidenceRegisters:createManual", "evidenceRegisters:updateReview", "evidenceRegisters:finishFinancePaperlessReview", "evidenceRegisters:finishSafePaperlessReview", "firm:batchGeneratePacket", "minutes:update", "files:generateUploadUrl", "registerHistory:roleHoldersAsOfDate", "objectMetadata:getByNameSingular", "objectMetadata:getByNamePlural", "objectMetadata:getFullTableSetup", "objectMetadata:get", "objectMetadata:getWithFields", "fieldMetadata:listForObject", "fieldMetadata:getByName", "fieldMetadata:get", "views:listSharedForDataTable", "views:listForObject", "views:get", "views:getHydrated", "views:listFieldsForView"].includes(name), responseResourceFiltered: ["library:overview", "dashboard:summary", "dashboard:navCounts", "minuteBook:overview", "evidenceRegisters:overview", "legalOperations:listRoleHolders", "legalOperations:rightsLedger", "roleHolderHistory:registerAsOf", "roleHolderHistory:changesBetween", "firm:overview", "firm:search"].includes(name), declaredRoles: permission ? ROLES.filter(role => listPermissionsForRole(role).includes(permission)) : null });
  }
  assert.ok(!/export const \w+ = (?:query|mutation|action)\(\{/.test(source), `${file} contains an unguarded public entry point`);
}
const payload = { recordedAt: new Date().toISOString(), qualification: "Static enumeration of production public wrappers. Runtime coverage is recorded separately; specialized handlers, state rules and record ACLs can narrow these declared role grants.",
  total: endpoints.length, fixedPermission: endpoints.filter(row => row.permission).length, specializedHandler: endpoints.filter(row => !row.permission).length,
  modules: Object.fromEntries(ROLES.map(role => [role, getModuleAccess(role)])), modulePolicyNote: MODULE_ACCESS_POLICY_NOTE,
  endpoints };
writeTrackedReport("artifacts/offline/authorization-surface.json", JSON.stringify(payload, null, 2) + "\n");
console.log(`Enumerated ${payload.total} production public wrappers: ${payload.fixedPermission} fixed permission, ${payload.specializedHandler} specialized handler.`);
