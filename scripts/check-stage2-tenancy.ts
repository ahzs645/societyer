import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry.ts";
import { makeCapabilities } from "../shared/portable/capabilities.ts";
import type { PortableDoc, PortablePrincipal } from "../shared/portable/ctx.ts";
import { PortableRuntime } from "../shared/portable/define.ts";
import { MemoryDb } from "../shared/portable/memoryDb.ts";
import {
  buildFunctionInventory,
  inventoryForSnapshot,
  readInventorySnapshot,
  REPO_ROOT,
  type ArgumentTemplate,
  type FunctionInventoryEntry,
  type IdArgument,
} from "./stage2/function-inventory.ts";

type Tenant = "A" | "B";
type Outcome = "blocked" | "leaked-read" | "leaked-write" | "error" | "not-applicable";

interface Finding {
  functionKey: string;
  functionName: string;
  attackClass: string;
  argument: string;
  principal: string;
  outcome: Outcome;
  detail: string;
}

interface LeakBaseline {
  version: 1;
  leaks: string[];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(REPO_ROOT, "stage2-tenancy-report.md");
const baselinePath = path.join(scriptDir, "stage2", "tenancy-leak-baseline.json");
const caps = makeCapabilities({});

const tenantId = (tenant: Tenant, table: string): string => `stage2-${tenant.toLowerCase()}-${table}`;
const tenantMarker = (tenant: Tenant): string => `stage2-tenant-${tenant}`;

const userPrincipal = (tenant: Tenant): PortablePrincipal => ({
  kind: "user",
  runtime: "test",
  assurance: "verified-jwt",
  subject: `stage2-subject-${tenant.toLowerCase()}`,
  issuer: "https://stage2.test",
  userId: tenantId(tenant, "users"),
  societyId: tenantId(tenant, "societies"),
});

const servicePrincipal: PortablePrincipal = {
  kind: "service",
  runtime: "test",
  assurance: "trusted-internal",
  subject: "stage2-service",
  societyId: tenantId("A", "societies"),
  actorUserId: tenantId("A", "users"),
  clientId: "stage2-service-client",
  scopes: ["*"],
};

const anonymousPrincipal: PortablePrincipal = {
  kind: "anonymous",
  runtime: "test",
  assurance: "none",
};

function portableTableNames(entry: FunctionInventoryEntry): string[] {
  const names = new Set<string>([
    "activity",
    "societies",
    "storageOwnership",
    "users",
  ]);
  for (const argument of entry.idArguments) {
    if (argument.table !== "unknown") names.add(argument.table);
  }
  const definition = PORTABLE_FUNCTIONS.find((candidate) => candidate.name === entry.name);
  if (definition) {
    for (const match of definition.handler.toString().matchAll(/\.db\.(?:query|insert)\(\s*["']([A-Za-z][A-Za-z0-9]*)["']/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function idFieldTables(inventory: FunctionInventoryEntry[]): Map<string, string> {
  const mappings = new Map<string, string>();
  for (const entry of inventory) {
    for (const argument of entry.idArguments) {
      const field = argument.path.split(".").at(-1);
      if (field && field !== "id" && argument.table !== "unknown" && !mappings.has(field)) {
        mappings.set(field, argument.table);
      }
    }
  }
  return mappings;
}

function genericRow(table: string, tenant: Tenant, mappings: Map<string, string>): PortableDoc {
  const societyId = tenantId(tenant, "societies");
  const row: PortableDoc = {
    _id: tenantId(tenant, table),
    _creationTime: tenant === "A" ? 1 : 2,
    societyId,
    stage2Tenant: tenantMarker(tenant),
    name: `${tenantMarker(tenant)} ${table}`,
    title: `${tenantMarker(tenant)} ${table}`,
    description: tenantMarker(tenant),
    status: "Active",
    role: "Owner",
    displayName: `Stage 2 User ${tenant}`,
    email: `stage2-${tenant.toLowerCase()}@example.test`,
    authSubject: `stage2-subject-${tenant.toLowerCase()}`,
    tags: [],
    position: 0,
    isSystem: false,
    createdAtISO: "2026-01-01T00:00:00.000Z",
    updatedAtISO: "2026-01-01T00:00:00.000Z",
  };
  for (const [field, targetTable] of mappings) row[field] = tenantId(tenant, targetTable);
  row.societyId = societyId;
  return row;
}

function fixtureSeed(tables: string[], mappings: Map<string, string>): Record<string, PortableDoc[]> {
  return Object.fromEntries(tables.map((table) => [
    table,
    [genericRow(table, "A", mappings), genericRow(table, "B", mappings)],
  ]));
}

function sampleString(pathName: string): string {
  if (/email/i.test(pathName)) return "stage2@example.test";
  if (/date|AtISO/i.test(pathName)) return "2026-01-01T00:00:00.000Z";
  if (/status/i.test(pathName)) return "Active";
  if (/role/i.test(pathName)) return "Owner";
  if (/url/i.test(pathName)) return "https://example.test/stage2";
  return "stage2";
}

function pathContains(candidate: string, target: string): boolean {
  return candidate === target || target.startsWith(`${candidate}.`);
}

function materializeArgs(
  template: ArgumentTemplate | undefined,
  tenant: Tenant,
  includedOptionalPaths: Set<string>,
  prefix = "",
): unknown {
  if (!template) return {};
  if (template.kind === "id") return tenantId(tenant, template.table);
  if (template.kind === "string") return sampleString(prefix);
  if (template.kind === "number") return 1;
  if (template.kind === "boolean") return true;
  if (template.kind === "literal") return template.value;
  if (template.kind === "unknown") return {};
  if (template.kind === "array") return [materializeArgs(template.item, tenant, includedOptionalPaths, prefix)];
  const result: Record<string, unknown> = {};
  for (const field of template.fields) {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    const include = !field.optional || [...includedOptionalPaths].some((target) => pathContains(fieldPath, target));
    if (include) result[field.name] = materializeArgs(field.value, tenant, includedOptionalPaths, fieldPath);
  }
  return result;
}

function setPath(root: Record<string, unknown>, argument: IdArgument, tenant: Tenant): void {
  const segments = argument.path.split(".");
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1) ?? argument.path] = argument.array
    ? [tenantId(tenant, argument.table)]
    : tenantId(tenant, argument.table);
}

function argsFor(
  entry: FunctionInventoryEntry,
  baseTenant: Tenant,
  target?: IdArgument,
  targetTenant?: Tenant,
  includeActingUser = true,
): Record<string, unknown> {
  const optionalPaths = new Set<string>();
  if (target) optionalPaths.add(target.path);
  if (includeActingUser && entry.idArguments.some((argument) => argument.path === "actingUserId")) {
    optionalPaths.add("actingUserId");
  }
  const materialized = materializeArgs(entry.argumentTemplate, baseTenant, optionalPaths);
  const args = materialized && typeof materialized === "object" && !Array.isArray(materialized)
    ? materialized as Record<string, unknown>
    : {};
  if (target && targetTenant) setPath(args, target, targetTenant);
  return args;
}

function databaseSnapshot(db: MemoryDb, tables: string[]): string {
  const rows = tables.flatMap((table) => db.dump(table)
    .map((row) => ({ table, row })));
  return JSON.stringify(rows.sort((left, right) => `${left.table}:${left.row._id}`.localeCompare(`${right.table}:${right.row._id}`)));
}

function containsTenantData(value: unknown, tenant: Tenant): boolean {
  const serialized = JSON.stringify(value) ?? "";
  return serialized.includes(tenantMarker(tenant)) || serialized.includes(`stage2-${tenant.toLowerCase()}-`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBlockedError(message: string): boolean {
  return /auth|forbidden|role .*required|not part of this society|unknown user|disabled|not found|does not exist|access denied|permission/i.test(message);
}

async function executeAttempt(options: {
  entry: FunctionInventoryEntry;
  args: Record<string, unknown>;
  principal: PortablePrincipal;
  principalLabel: string;
  forbiddenTenant: Tenant;
  attackClass: string;
  argument: string;
  tables: string[];
  mappings: Map<string, string>;
}): Promise<Finding> {
  const db = new MemoryDb({ seed: fixtureSeed(options.tables, options.mappings), now: () => 3 });
  const runtime = new PortableRuntime({
    db,
    capabilities: caps,
    principalProvider: () => options.principal,
  }).registerAll(PORTABLE_FUNCTIONS);
  const before = databaseSnapshot(db, options.tables);
  try {
    const result = options.entry.kind === "query"
      ? await runtime.runQuery<unknown>(options.entry.name, options.args)
      : await runtime.runMutation<unknown>(options.entry.name, options.args);
    const after = databaseSnapshot(db, options.tables);
    const outcome: Outcome = before !== after
      ? "leaked-write"
      : containsTenantData(result, options.forbiddenTenant)
        ? "leaked-read"
        : "blocked";
    return {
      functionKey: options.entry.key,
      functionName: options.entry.name,
      attackClass: options.attackClass,
      argument: options.argument,
      principal: options.principalLabel,
      outcome,
      detail: outcome === "blocked" ? "No forbidden-tenant data returned or changed." : "Forbidden-tenant fixture data was observed.",
    };
  } catch (error) {
    const message = errorMessage(error).replace(/\s+/g, " ").slice(0, 240);
    return {
      functionKey: options.entry.key,
      functionName: options.entry.name,
      attackClass: options.attackClass,
      argument: options.argument,
      principal: options.principalLabel,
      outcome: isBlockedError(message) ? "blocked" : "error",
      detail: message,
    };
  }
}

function notApplicable(entry: FunctionInventoryEntry, detail: string): Finding {
  return {
    functionKey: entry.key,
    functionName: entry.name,
    attackClass: "foreign-id",
    argument: entry.idArguments.map((argument) => argument.path).join(", ") || "none",
    principal: "user-A",
    outcome: "not-applicable",
    detail,
  };
}

function leakKey(finding: Finding): string {
  return [finding.functionKey, finding.attackClass, finding.argument, finding.principal, finding.outcome].join("|");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderReport(
  inventory: FunctionInventoryEntry[],
  findings: Finding[],
  newLeaks: string[],
  resolvedLeaks: string[],
  inventoryMatches: boolean,
): string {
  const outcomes: Outcome[] = ["blocked", "leaked-read", "leaked-write", "error", "not-applicable"];
  const access = ["public", "authenticated", "service", "unclassified"] as const;
  const severe = findings.filter((finding) => finding.outcome === "leaked-write" || finding.outcome === "leaked-read");
  const lines = [
    "# Stage 2 tenancy findings",
    "",
    "Generated by `node --import tsx scripts/check-stage2-tenancy.ts`.",
    "",
    `Inventory: ${inventory.length} entries; ${access.map((value) => `${value}=${inventory.filter((entry) => entry.access === value).length}`).join(", ")}.`,
    `Inventory snapshot: ${inventoryMatches ? "matches" : "STALE"}.`,
    `Outcomes: ${outcomes.map((outcome) => `${outcome}=${findings.filter((finding) => finding.outcome === outcome).length}`).join(", ")}.`,
    `Leak baseline: new=${newLeaks.length}, resolved=${resolvedLeaks.length}, observed=${severe.length}.`,
    "",
    "## Leak findings",
    "",
    "| Function | Attack | Argument | Principal | Outcome | Detail |",
    "| --- | --- | --- | --- | --- | --- |",
    ...severe.map((finding) => `| ${escapeCell(finding.functionKey)} | ${escapeCell(finding.attackClass)} | ${escapeCell(finding.argument)} | ${escapeCell(finding.principal)} | ${finding.outcome} | ${escapeCell(finding.detail)} |`),
    "",
    "## Full attempt matrix",
    "",
    "| Function | Attack | Argument | Principal | Outcome | Detail |",
    "| --- | --- | --- | --- | --- | --- |",
    ...findings.map((finding) => `| ${escapeCell(finding.functionKey)} | ${escapeCell(finding.attackClass)} | ${escapeCell(finding.argument)} | ${escapeCell(finding.principal)} | ${finding.outcome} | ${escapeCell(finding.detail)} |`),
    "",
  ];
  if (newLeaks.length) lines.splice(8, 0, `New leak keys: ${newLeaks.map((key) => `\`${key}\``).join(", ")}.`, "");
  return `${lines.join("\n")}\n`;
}

const inventory = buildFunctionInventory();
const snapshot = readInventorySnapshot();
const inventoryMatches = JSON.stringify(inventoryForSnapshot(inventory)) === JSON.stringify(snapshot);
const mappings = idFieldTables(inventory);
const findings: Finding[] = [];

for (const entry of inventory) {
  if (entry.idArguments.length === 0) {
    findings.push(notApplicable(entry, "No Convex ID validator was found."));
    continue;
  }
  if (entry.surface !== "portable") {
    const detail = entry.surface === "convex" && PORTABLE_FUNCTIONS.some((definition) => definition.name === entry.name)
      ? "Equivalent portable handler is exercised separately."
      : entry.surface === "http"
        ? "HTTP listener is intentionally unavailable in this harness."
        : "Hosted Convex runtime is intentionally unavailable in this harness.";
    findings.push(notApplicable(entry, detail));
    continue;
  }
  if (!entry.argumentTemplate) {
    findings.push(notApplicable(entry, "No callable argument template could be derived."));
    continue;
  }
  const tables = portableTableNames(entry);

  for (const argument of entry.idArguments) {
    const attackClass = argument.path === "actingUserId" ? "foreign-acting-user" : "foreign-id";
    findings.push(await executeAttempt({
      entry,
      args: argsFor(entry, "A", argument, "B"),
      principal: userPrincipal("A"),
      principalLabel: "user-A",
      forbiddenTenant: "B",
      attackClass,
      argument: argument.path,
      tables,
      mappings,
    }));
  }

  const foreignTarget = entry.idArguments.find((argument) => argument.path !== "actingUserId") ?? entry.idArguments[0];
  findings.push(await executeAttempt({
    entry,
    args: argsFor(entry, "A", foreignTarget, "B"),
    principal: servicePrincipal,
    principalLabel: "service-A",
    forbiddenTenant: "B",
    attackClass: "foreign-id-service-principal",
    argument: foreignTarget.path,
    tables,
    mappings,
  }));
  findings.push(await executeAttempt({
    entry,
    args: argsFor(entry, "A", foreignTarget, "B"),
    principal: anonymousPrincipal,
    principalLabel: "anonymous",
    forbiddenTenant: "B",
    attackClass: "foreign-id-anonymous-principal",
    argument: foreignTarget.path,
    tables,
    mappings,
  }));

  const actingUserArgument = entry.idArguments.find((argument) => argument.path === "actingUserId");
  if (actingUserArgument) {
    const tenantTarget = entry.idArguments.find((argument) => argument.path !== "actingUserId");
    if (tenantTarget) {
      findings.push(await executeAttempt({
        entry,
        args: argsFor(entry, "A", tenantTarget, "B", false),
        principal: userPrincipal("A"),
        principalLabel: "user-A",
        forbiddenTenant: "B",
        attackClass: "omitted-acting-user",
        argument: tenantTarget.path,
        tables,
        mappings,
      }));
    }
    const forgedArgs = argsFor(entry, "A", actingUserArgument, "A");
    findings.push(await executeAttempt({
      entry,
      args: forgedArgs,
      principal: userPrincipal("B"),
      principalLabel: "user-B",
      forbiddenTenant: "A",
      attackClass: "forged-acting-user",
      argument: actingUserArgument.path,
      tables,
      mappings,
    }));
    findings.push(await executeAttempt({
      entry,
      args: forgedArgs,
      principal: anonymousPrincipal,
      principalLabel: "anonymous",
      forbiddenTenant: "A",
      attackClass: "forged-acting-user-anonymous",
      argument: actingUserArgument.path,
      tables,
      mappings,
    }));
  }
}

findings.sort((left, right) =>
  left.functionKey.localeCompare(right.functionKey) ||
  left.attackClass.localeCompare(right.attackClass) ||
  left.argument.localeCompare(right.argument) ||
  left.principal.localeCompare(right.principal),
);

const observedLeaks = findings
  .filter((finding) => finding.outcome === "leaked-read" || finding.outcome === "leaked-write")
  .map(leakKey)
  .sort();
let baseline: LeakBaseline = { version: 1, leaks: [] };
if (process.argv.includes("--write-baseline")) {
  baseline = { version: 1, leaks: observedLeaks };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
} else {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as LeakBaseline;
}
const baselineLeaks = new Set(baseline.leaks);
const observedLeakSet = new Set(observedLeaks);
const newLeaks = observedLeaks.filter((key) => !baselineLeaks.has(key));
const resolvedLeaks = baseline.leaks.filter((key) => !observedLeakSet.has(key));
writeFileSync(reportPath, renderReport(inventory, findings, newLeaks, resolvedLeaks, inventoryMatches));

const outcomes: Outcome[] = ["blocked", "leaked-read", "leaked-write", "error", "not-applicable"];
console.log(`Stage 2 tenancy: ${outcomes.map((outcome) => `${outcome}=${findings.filter((finding) => finding.outcome === outcome).length}`).join(", ")}; new-leaks=${newLeaks.length}.`);
if (!inventoryMatches) {
  console.error("Function inventory snapshot is stale; regenerate scripts/stage2/function-inventory.json.");
  process.exitCode = 1;
}
if (newLeaks.length) {
  console.error(`New cross-tenant leaks exceed the committed baseline (${newLeaks.length}).`);
  process.exitCode = 1;
}
