/** Live production endpoint checks using real Better Auth sessions and Convex JWT verification. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
if (config.convexUrl !== "http://127.0.0.1:43230" || config.authUrl !== "http://127.0.0.1:43487") throw new Error("Isolated qualification endpoints required.");
const admin = new ConvexHttpClient(config.convexUrl, { logger: false });
admin.setAdminAuth(config.adminKey);
const ref = name => makeFunctionReference(name);
const nativeAttempts = { queries: 0, mutations: 0, completed: 0, rejected: 0, operatorFixtureCalls: 0, brokerRequests: 0, byEndpoint: {} };
const internal = (name, args) => { nativeAttempts.operatorFixtureCalls++; return admin.function(ref(name), undefined, args); };
const fixture = config.fixture;
const clients = {};
for (const account of config.accounts) {
  nativeAttempts.brokerRequests++;
  const response = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.ok, true, `Actual Better Auth login for ${account.key}`);
  const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookies, `Login must create an actual session for ${account.key}`);
  nativeAttempts.brokerRequests++;
  const authResponse = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } });
  assert.equal(authResponse.ok, true, `Convex JWT from actual broker for ${account.key}`);
  const { token } = await authResponse.json(); assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, { logger: false }); client.setAuth(token);
  clients[account.key] = client;
}
clients.anonymous = new ConvexHttpClient(config.convexUrl, { logger: false });
for (const client of Object.values(clients)) for (const kind of ["query", "mutation"]) {
  const method = client[kind].bind(client);
  client[kind] = (...args) => {
    nativeAttempts[kind === "query" ? "queries" : "mutations"]++;
    const endpoint = getFunctionName(args[0]);
    const row = nativeAttempts.byEndpoint[endpoint] ??= { kind, attempted: 0, completed: 0, rejected: 0 };
    row.attempted++;
    return method(...args).then(value => { row.completed++; nativeAttempts.completed++; return value; }, error => { row.rejected++; nativeAttempts.rejected++; throw error; });
  };
}
const roles = ["Owner", "Admin", "Director", "Member", "Viewer"];
const actor = role => clients[`${role.toLowerCase()}-a`];
const results = [];
const failures = [];
async function check(name, body) {
  try { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); failures.push(name); console.error(`FAIL ${name}: ${error}`); }
}
const policyDenial = /Permission|membership|not found|disabled|not active|Authentication|Role .*required|authorized/i;
async function mustDeny(client, kind, name, args) { await assert.rejects(() => client[kind](ref(name), args), policyDenial, `${name} must deny the principal before exposing protected data or changing rows`); }
const memberRead = new Set(["society", "members", "meetings", "minutes", "elections", "documents", "grants", "agendas", "motions", "volunteers", "communications", "tasks"]);
const readEndpoints = [
  ...["members", "directors", "employees", "committees", "meetings", "minutes", "motions", "proxies", "conflicts", "attestations", "auditors", "courtOrders", "filings", "deadlines", "commitments", "financials", "elections", "documents", "users", "tasks", "volunteers", "grants"].map(domain => ({ domain, name: `${domain}:list` })),
  { domain: "society", name: "society:getById", args: { id: fixture.societyA } },
  { domain: "agendas", name: "agendas:listForSociety" },
  { domain: "members", name: "peopleDirectory:list" },
  { domain: "members", name: "peopleDirectory:duplicates" },
  { domain: "members", name: "peopleDirectory:searchByPrefix", args: { societyId: fixture.societyA, prefix: "Qualification" } },
  { domain: "communications", name: "communications:listTemplates" },
  { domain: "audit", name: "activity:list" },
  { domain: "settings", name: "secrets:list" },
  // This catalog is a download-capability endpoint; Viewer has only exports:read.
  { domain: "exports", name: "exports:listExportableTables", allowed: ["Owner", "Admin", "Director"] },
  ...["insurance:list", "assets:list", "reconciliation:overview", "receipts:list", "pipaTraining:list", "inspections:list", "transparency:listPublications", "subscriptions:plans", "paperless:listConnection", "workflows:list"].map(name => ({ domain: ["paperless", "inspections"].includes(name.split(":")[0]) ? "documents" : name.startsWith("workflows:") ? "tasks" : name.startsWith("pipaTraining:") ? "attestations" : ["transparency", "subscriptions"].includes(name.split(":")[0]) ? "settings" : "financials", name })),
];
for (const endpoint of readEndpoints) {
  const args = endpoint.args ?? { societyId: fixture.societyA };
  await check(`Read roles and hostile principals: ${endpoint.name}`, async () => {
    for (const role of roles) {
      const allowed = endpoint.allowed ? endpoint.allowed.includes(role) : role !== "Member" || memberRead.has(endpoint.domain);
      if (allowed) await actor(role).query(ref(endpoint.name), args);
      else await mustDeny(actor(role), "query", endpoint.name, args);
    }
    for (const key of ["anonymous", "owner-b", "disabled-a", "invited-a"]) await mustDeny(clients[key], "query", endpoint.name, args);
  });
}
const writeEndpoints = [
  ["peopleDirectory:upsert", { fullName: "Qualification directory person", nowISO: new Date().toISOString() }],
  ["members:create", { firstName: "Qualification", lastName: "Member", membershipClass: "Regular", status: "Active", joinedAt: "2026-10-04", votingRights: true }],
  ["directors:create", { firstName: "Qualification", lastName: "Director", position: "Director", isBCResident: true, termStart: "2026-10-04", consentOnFile: true, status: "Active" }],
  ["employees:create", { firstName: "Qualification", lastName: "Employee", role: "Coordinator", startDate: "2026-10-04", employmentType: "Part-time", cppExempt: false, eiExempt: false }],
  ["committees:create", { name: "Qualification committee", cadence: "Monthly", color: "blue" }],
  ["meetings:create", { type: "Board", title: "Qualification meeting", scheduledAt: "2026-11-15T10:00:00Z", electronic: false, status: "Scheduled", attendeeIds: [] }, ["Owner", "Admin", "Director"]],
  ["motions:create", { text: "Qualification motion" }],
  ["auditors:create", { firmName: "Qualification firm", engagementType: "Audit", fiscalYear: "2026", appointedBy: "Board", appointedAtISO: "2026-10-04T12:00:00Z", independenceAttested: true, status: "Active" }],
  ["courtOrders:create", { title: "Qualification court order", orderDate: "2026-10-04", court: "BC court", description: "Test record", status: "Active" }],
  ["filings:create", { kind: "Annual report", dueDate: "2026-11-01", status: "Draft" }],
  ["deadlines:create", { title: "Qualification deadline", dueDate: "2026-11-01", category: "Governance" }],
  ["commitments:create", { title: "Qualification commitment", category: "Governance", requirement: "Review test records", cadence: "Annual", status: "Active" }],
  ["financials:create", { fiscalYear: "2026", periodEnd: "2026-03-31", revenueCents: 10000, expensesCents: 1000, netAssetsCents: 9000, auditStatus: "Unaudited", remunerationDisclosures: [] }],
  ["elections:create", { title: "Qualification election", opensAtISO: "2026-11-01T00:00:00Z", closesAtISO: "2026-11-02T00:00:00Z" }],
  ["documents:create", { title: "Qualification document", category: "General", content: "Test content", tags: [] }, ["Owner", "Admin", "Director"]],
  ["tasks:create", { title: "Qualification task", status: "Open", priority: "Normal", tags: [] }],
  ["users:upsert", { email: "unbound-member@qualification.example.test", displayName: "Qualification unbound member", role: "Member", status: "Active" }],
  ["grants:upsertGrant", { title: "Qualification grant", funder: "Test funder", status: "Prospect" }],
  ["volunteers:upsertVolunteer", { firstName: "Qualification", lastName: "Volunteer", status: "Active", interests: [], screeningRequired: false }],
  ["communications:upsertTemplate", { name: "Qualification template", slug: "qualification", kind: "notice", channel: "email", audience: "all_members", subject: "Test", bodyText: "Test", system: false }],
  ["society:clearLogo", {}],
  ["society:updateModules", { disabledModules: [] }],
  ["society:updateIntegrationSettings", { integrationSettings: { preferredProvider: "existing", authorizationMode: "delegated", tenantId: "", siteId: "", libraryId: "", consentStatus: "unknown", resourceGrantStatus: "unknown", permissionEvidence: "", canadianResidencyRequired: false, storageRegion: "", residencyEvidence: "", custodian: "organization", custodianContact: "", offboardingPlan: "" } }, ["Owner"]],
];
for (const [name, fields, allowed = ["Owner", "Admin"]] of writeEndpoints) {
  await check(`Write roles and hostile principals: ${name}`, async () => {
    const args = { societyId: fixture.societyA, ...fields };
    for (const role of roles) {
      if (allowed.includes(role)) await actor(role).mutation(ref(name), args);
      else await mustDeny(actor(role), "mutation", name, args);
    }
    for (const key of ["anonymous", "owner-b", "disabled-a", "invited-a"]) await mustDeny(clients[key], "mutation", name, args);
  });
}
let meetingId, directorId, minutesId;
await check("References for child endpoint authorization come from actual protected records", async () => {
  const rows = await actor("Owner").query(ref("meetings:list"), { societyId: fixture.societyA });
  meetingId = rows.find(row => row.title === "Qualification meeting")._id;
  directorId = (await actor("Owner").query(ref("directors:list"), { societyId: fixture.societyA }))[0]._id;
});
for (const [name, fields, allowed] of [
  ["agendas:create", () => ({ meetingId, title: "Qualification agenda" }), ["Owner", "Admin", "Director"]],
  ["minutes:create", () => ({ meetingId, heldAt: "2026-11-15", attendees: [], absent: [], quorumMet: false, discussion: "Qualification discussion", motions: [], decisions: [], actionItems: [] }), ["Owner", "Admin", "Director"]],
  ["conflicts:create", () => ({ directorId, declaredAt: "2026-10-04", contractOrMatter: "Qualification", natureOfInterest: "Test", abstainedFromVote: true, leftRoom: true }), ["Owner", "Admin"]],
  ["attestations:sign", () => ({ directorId, year: 2026, isAtLeast18: true, notBankrupt: true, notDisqualified: true, stillResidentOrEligible: true }), ["Owner", "Admin"]],
  ["proxies:create", () => ({ meetingId, grantorName: "Test member", proxyHolderName: "Test proxy", signedAtISO: "2026-10-04T12:00:00Z" }), ["Owner", "Admin"]],
]) {
  await check(`Child writes and inferred workspace: ${name}`, async () => {
    assert.ok(meetingId); assert.ok(directorId);
    const args = { societyId: fixture.societyA, ...fields() };
    for (const role of roles) {
      if (allowed.includes(role)) {
        if (name === "proxies:create") await assert.rejects(() => actor(role).mutation(ref(name), args), /Proxy voting is disabled by the active bylaw rule set/);
        else { const id = await actor(role).mutation(ref(name), args); if (name === "minutes:create") minutesId = id; }
      }
      else await mustDeny(actor(role), "mutation", name, args);
    }
    for (const key of ["anonymous", "owner-b", "disabled-a", "invited-a"]) await mustDeny(clients[key], "mutation", name, args);
  });
}
await check("Drafting permission cannot approve or clear minutes approval", async () => {
  assert.ok(minutesId);
  for (const patch of [{ approvedAt: "2026-10-04" }, { approvedInMeetingId: meetingId }, { clearApproval: true }, { clearApprovedInMeeting: true }]) {
    await assert.rejects(() => actor("Director").mutation(ref("minutes:update"), { id: minutesId, patch }), /Permission minutes:approve/);
  }
  await actor("Admin").mutation(ref("minutes:update"), { id: minutesId, patch: { approvedAt: "2026-10-04", approvedInMeetingId: meetingId } });
  const approved = (await internal("roleFixture:inspect", { societyId: fixture.societyA, table: "minutes" })).find(row => row._id === minutesId);
  assert.equal(approved.approvedAt, "2026-10-04"); assert.ok(Array.isArray(approved.motionSnapshots));
  await assert.rejects(() => actor("Director").mutation(ref("minutes:update"), { id: minutesId, patch: { clearApproval: true } }), /Permission minutes:approve/);
  await actor("Admin").mutation(ref("minutes:update"), { id: minutesId, patch: { clearApproval: true } });
});
await check("Carried adoption checks approval authority atomically, while unchanged adoption remains draftable", async () => {
  const targetMeeting = await actor("Owner").mutation(ref("meetings:create"), { societyId: fixture.societyA, type: "Board", title: "Qualification adoption target", scheduledAt: "2026-09-15T10:00:00Z", electronic: false, status: "Complete", attendeeIds: [] });
  const target = await actor("Owner").mutation(ref("minutes:create"), { societyId: fixture.societyA, meetingId: targetMeeting, heldAt: "2026-09-15", attendees: [], absent: [], quorumMet: false, discussion: "Target draft", motions: [], decisions: [], actionItems: [] });
  const motions = [{ text: "Adopt prior minutes", outcome: "Carried", adoptsMinutesId: target }];
  await assert.rejects(() => actor("Director").mutation(ref("minutes:update"), { id: minutesId, patch: { discussion: "Unauthorized adoption", motions } }), /Permission minutes:approve/);
  let rows = await internal("roleFixture:inspect", { societyId: fixture.societyA, table: "minutes" });
  assert.equal(rows.find(row => row._id === target).approvedAt, undefined);
  assert.notEqual(rows.find(row => row._id === minutesId).discussion, "Unauthorized adoption");
  await actor("Owner").mutation(ref("minutes:update"), { id: minutesId, patch: { motions } });
  rows = await internal("roleFixture:inspect", { societyId: fixture.societyA, table: "minutes" });
  assert.equal(rows.find(row => row._id === target).approvedInMeetingId, meetingId);
  await actor("Director").mutation(ref("minutes:update"), { id: minutesId, patch: { discussion: "Continued draft", motions } });
});
await check("Cross-workspace row and nested-reference substitutions are denied", async () => {
  const foreignMeeting = await clients["owner-b"].mutation(ref("meetings:create"), { societyId: fixture.societyB, type: "Board", title: "Foreign meeting", scheduledAt: "2026-11-15T10:00:00Z", electronic: false, status: "Scheduled", attendeeIds: [] });
  await mustDeny(actor("Owner"), "query", "meetings:get", { id: foreignMeeting });
  await mustDeny(actor("Owner"), "mutation", "meetings:update", { id: foreignMeeting, patch: { title: "Overwrite" } });
  await mustDeny(actor("Owner"), "mutation", "agendas:create", { societyId: fixture.societyA, meetingId: foreignMeeting, title: "Foreign child" });
  await mustDeny(actor("Owner"), "mutation", "tasks:create", { societyId: fixture.societyA, meetingId: foreignMeeting, title: "Foreign reference", status: "Open", priority: "Normal", tags: [] });
});
await check("Caller actor fields cannot impersonate another workspace user", async () => {
  await assert.rejects(() => actor("Admin").mutation(ref("grants:upsertGrant"), { societyId: fixture.societyA, title: "Forged attribution", funder: "Test", status: "Prospect", actingUserId: fixture.users["owner-a"] }), /Authenticated actor does not match/i);
});
await check("Self profile and policy inspection do not grant Member workspace roster access", async () => {
  assert.equal((await actor("Member").query(ref("users:get"), { id: fixture.users["member-a"] })).role, "Member");
  assert.equal((await actor("Member").query(ref("permissions:myPermissions"), { societyId: fixture.societyA, userId: fixture.users["member-a"] })).role, "Member");
  await mustDeny(actor("Member"), "query", "users:get", { id: fixture.users["owner-a"] });
  await mustDeny(actor("Member"), "query", "permissions:myPermissions", { societyId: fixture.societyA, userId: fixture.users["owner-a"] });
  assert.equal((await actor("Admin").query(ref("permissions:myPermissions"), { societyId: fixture.societyA, userId: fixture.users["owner-a"] })).role, "Owner");
});
await check("Admin manages ordinary roles while elevated authority remains Owner-only", async () => {
  await assert.rejects(() => actor("Admin").mutation(ref("users:setRole"), { id: fixture.users["admin-a"], role: "Owner" }), /Only an Owner/);
  await assert.rejects(() => actor("Admin").mutation(ref("users:setRole"), { id: fixture.users["owner-a"], role: "Member" }), /Only an Owner/);
  await actor("Admin").mutation(ref("users:setRole"), { id: fixture.users["viewer-a"], role: "Member" });
  assert.equal((await clients["viewer-a"].query(ref("permissions:myPermissions"), { societyId: fixture.societyA, userId: fixture.users["viewer-a"] })).role, "Member");
  await actor("Admin").mutation(ref("users:setRole"), { id: fixture.users["viewer-a"], role: "Viewer" });
  await mustDeny(actor("Admin"), "mutation", "users:remove", { id: fixture.users["viewer-a"] });
  const ordinary = await actor("Owner").mutation(ref("users:upsert"), { societyId: fixture.societyA, email: "removable@qualification.example.test", displayName: "Removable member", role: "Member", status: "Active" });
  await actor("Owner").mutation(ref("users:remove"), { id: ordinary });
  assert.equal((await actor("Owner").query(ref("users:list"), { societyId: fixture.societyA })).some(row => row._id === ordinary), false);
});
await check("Last Active Owner survives demotion/removal/ordinary disabling", async () => {
  const ownerId = fixture.users["owner-a"];
  await assert.rejects(() => actor("Owner").mutation(ref("users:setRole"), { id: ownerId, role: "Viewer" }), /last Active Owner/);
  await assert.rejects(() => actor("Owner").mutation(ref("users:remove"), { id: ownerId }), /last Active Owner/);
  const account = config.accounts.find(row => row.key === "owner-a");
  await assert.rejects(() => actor("Owner").mutation(ref("users:upsert"), { id: ownerId, societyId: fixture.societyA, email: account.email, displayName: "owner-a", role: "Owner", status: "Disabled" }), /last Active Owner/);
});
await check("An existing session immediately loses write authority after role downgrade", async () => {
  await actor("Owner").mutation(ref("users:setRole"), { id: fixture.users["director-a"], role: "Viewer" });
  try { await mustDeny(clients["director-a"], "mutation", "meetings:update", { id: meetingId, patch: { title: "Stale Director write" } }); }
  finally { await actor("Owner").mutation(ref("users:setRole"), { id: fixture.users["director-a"], role: "Director" }); }
});
await check("Hosted directory edits and references cannot cross workspaces", async () => {
  const prefix = `qualify${randomBytes(5).toString("hex")}`;
  const ownedA = await actor("Owner").mutation(ref("peopleDirectory:upsert"), { societyId: fixture.societyA, fullName: `${prefix} A`, nowISO: new Date().toISOString() });
  const ownedB = await clients["owner-b"].mutation(ref("peopleDirectory:upsert"), { societyId: fixture.societyB, fullName: `${prefix} A`, nowISO: new Date().toISOString() });
  const ownedDuplicate = await actor("Owner").mutation(ref("peopleDirectory:upsert"), { societyId: fixture.societyA, fullName: `${prefix} A`, nowISO: new Date().toISOString() });
  const args = { societyId: fixture.societyA };
  const duplicates = await actor("Owner").query(ref("peopleDirectory:duplicates"), args);
  assert.ok(duplicates.some(group => group.some(row => row.id === ownedA) && group.some(row => row.id === ownedDuplicate)));
  assert.equal(duplicates.flat().some(row => row.id === ownedB), false);
  const rows = await actor("Owner").query(ref("peopleDirectory:list"), args);
  assert.ok(rows.some(row => row._id === ownedA)); assert.equal(rows.some(row => row._id === ownedB), false);
  const matches = await actor("Owner").query(ref("peopleDirectory:searchByPrefix"), { ...args, prefix });
  assert.ok(matches.some(row => row.id === ownedA)); assert.equal(matches.some(row => row.id === ownedB), false);
  await mustDeny(actor("Owner"), "mutation", "peopleDirectory:upsert", { ...args, id: ownedB, fullName: "Cross-workspace edit", nowISO: new Date().toISOString() });
  await mustDeny(actor("Owner"), "mutation", "peopleDirectory:addToSociety", { ...args, directoryPersonId: ownedB, roleType: "other", nowISO: new Date().toISOString() });
  await assert.rejects(() => actor("Owner").mutation(ref("peopleDirectory:upsert"), { fullName: "Unscoped hosted mutation", nowISO: new Date().toISOString() }), /workspace|society|authorized/i);
});
await check("Legacy global directory is readable only through authorized links and unsafe edits are denied", async () => {
  const prefix = `legacy${randomBytes(5).toString("hex")}`;
  const ids = await internal("roleFixture:seedLegacyDirectory", { societyA: fixture.societyA, societyB: fixture.societyB, prefix });
  const rows = await actor("Owner").query(ref("peopleDirectory:list"), { societyId: fixture.societyA });
  assert.ok(rows.some(row => row._id === ids.soleA)); assert.ok(rows.some(row => row._id === ids.shared));
  assert.equal(rows.some(row => row._id === ids.soleB), false); assert.equal(rows.some(row => row._id === ids.unlinked), false);
  for (const id of [ids.soleB, ids.shared, ids.unlinked]) await assert.rejects(() => actor("Owner").mutation(ref("peopleDirectory:upsert"), { societyId: fixture.societyA, id, fullName: "Unsafe legacy modification", nowISO: new Date().toISOString() }), /not found|legacy|shared|scope|claim|workspace/i);
  assert.equal(await actor("Owner").mutation(ref("peopleDirectory:upsert"), { societyId: fixture.societyA, id: ids.soleA, fullName: `${prefix} Claimed`, nowISO: new Date().toISOString() }), ids.soleA);
  await mustDeny(clients["owner-b"], "mutation", "peopleDirectory:upsert", { societyId: fixture.societyB, id: ids.soleA, fullName: "Claimed legacy cross-workspace", nowISO: new Date().toISOString() });
});
await check("Firm overview and mixed search include only current authorized workspaces and resource reads", async () => {
  const prefix = `search${randomBytes(5).toString("hex")}`;
  const rowsA = [], rowsB = [];
  for (const [client, societyId, rows] of [[actor("Owner"), fixture.societyA, rowsA], [clients["owner-b"], fixture.societyB, rowsB]]) {
    rows.push(await client.mutation(ref("peopleDirectory:upsert"), { societyId, fullName: `${prefix} Person`, nowISO: new Date().toISOString() }));
    rows.push(await client.mutation(ref("deadlines:create"), { societyId, title: `${prefix} Deadline`, dueDate: "2026-11-01", category: "Governance" }));
    rows.push(await client.mutation(ref("documents:create"), { societyId, title: `${prefix} Document`, category: "General", content: "Protected record", tags: [] }));
  }
  for (const role of roles) {
    const overview = await actor(role).query(ref("firm:overview"), {});
    if (role === "Member") assert.deepEqual(overview.entities, []);
    else assert.ok(overview.entities.some(row => row._id === fixture.societyA));
    assert.equal(overview.entities.some(row => row._id === fixture.societyB), false);
    const matches = await actor(role).query(ref("firm:search"), { query: prefix });
    assert.equal(matches.some(row => rowsB.includes(row.id)), false);
    assert.ok(matches.some(row => row.id === rowsA[0]));
    if (role === "Member") assert.equal(matches.some(row => row.kind === "deadline"), false);
  }
  const foreignOverview = await clients["owner-b"].query(ref("firm:overview"), {});
  assert.equal(foreignOverview.entities.some(row => row._id === fixture.societyA), false);
  const foreignMatches = await clients["owner-b"].query(ref("firm:search"), { query: prefix });
  assert.equal(foreignMatches.some(row => rowsA.includes(row.id)), false);
  for (const key of ["anonymous", "disabled-a", "invited-a"]) for (const name of ["firm:overview", "firm:search"]) await mustDeny(clients[key], "query", name, name === "firm:search" ? { query: prefix } : {});
});
await check("Firm packet batching accepts Owner/Admin but denies readonly and mixed foreign selections before side effects", async () => {
  const packetFixture = await internal("roleFixture:seedBatchSociety", { issuer: config.issuer, identities: config.accounts.filter(account => account.key.endsWith("-a")).map(({ subject, email, role, status }) => ({ subject, email, role, status })) });
  const societyId = packetFixture.societyId;
  try {
  await actor("Owner").mutation(ref("directors:create"), { societyId, firstName: "Packet", lastName: "Director", position: "Director", isBCResident: true, termStart: "2026-10-04", consentOnFile: true, status: "Active" });
  const args = { societyIds: [societyId], packetKey: "society-directors-resolution", effectiveDate: "2026-10-04" };
  for (const role of ["Owner", "Admin"]) {
    const result = await actor(role).mutation(ref("firm:batchGeneratePacket"), args);
    assert.equal(result.generated, 1, `${role}: ${JSON.stringify(result.results)}`);
    assert.equal(result.failed, 0);
  }
  const before = {};
  for (const table of ["legalPrecedentRuns", "generatedLegalDocuments"]) {
    before[table] = (await internal("roleFixture:inspect", { societyId, table })).length;
    assert.ok(before[table] < 100, "A bounded fixture snapshot must include every row to qualify no side effects");
  }
  for (const role of ["Director", "Member", "Viewer"]) await mustDeny(actor(role), "mutation", "firm:batchGeneratePacket", args);
  for (const key of ["anonymous", "owner-b", "disabled-a", "invited-a"]) await mustDeny(clients[key], "mutation", "firm:batchGeneratePacket", args);
  await mustDeny(actor("Owner"), "mutation", "firm:batchGeneratePacket", { ...args, societyIds: [societyId, fixture.societyB] });
  await mustDeny(actor("Owner"), "mutation", "firm:batchGeneratePacket", { ...args, societyIds: [fixture.societyB, societyId] });
  for (const table of Object.keys(before)) assert.equal((await internal("roleFixture:inspect", { societyId, table })).length, before[table], "Rejected batch must not generate an allowed-workspace prefix");
  } finally {
    // Keep normal browser membership resolution unchanged after the temporary
    // multi-workspace authority test, even when a generation assertion fails.
    await internal("roleFixture:cleanupBatchMemberships", { societyId });
  }
});
await check("All optional switches persist separately from assigned role grants", async () => {
  const keys = ["communications", "volunteers", "grants", "voting", "auditors", "attestations", "courtOrders", "filingPrefill", "recordsInspection", "pipaTraining", "insurance", "secrets", "transparency", "reconciliation", "assets", "donationReceipts", "membershipBilling", "employees", "paperless", "browserConnectors", "workflows"];
  const before = await actor("Owner").query(ref("permissions:myPermissions"), { societyId: fixture.societyA, userId: fixture.users["owner-a"] });
  await actor("Owner").mutation(ref("society:updateModules"), { societyId: fixture.societyA, disabledModules: keys });
  try {
    assert.deepEqual((await actor("Owner").query(ref("society:getById"), { id: fixture.societyA })).disabledModules.sort(), keys.sort());
    assert.deepEqual(await actor("Owner").query(ref("permissions:myPermissions"), { societyId: fixture.societyA, userId: fixture.users["owner-a"] }), before);
    await actor("Owner").query(ref("grants:list"), { societyId: fixture.societyA });
    await actor("Owner").mutation(ref("grants:upsertGrant"), { societyId: fixture.societyA, title: "Disabled feature, authorized operator", funder: "Test", status: "Prospect" });
    await assert.rejects(() => clients.anonymous.mutation(ref("volunteers:submitApplication"), { societyId: fixture.societyA, firstName: "Public", lastName: "Applicant", email: "public@example.test", interests: [] }), /disabled|MODULE_DISABLED/i);
  } finally { await actor("Owner").mutation(ref("society:updateModules"), { societyId: fixture.societyA, disabledModules: [] }); }
});
await check("Public callers cannot access operator-only fixture helpers", async () => {
  await assert.rejects(() => clients.anonymous.query(ref("roleFixture:inspect"), { societyId: fixture.societyA, table: "users" }));
  await assert.rejects(() => clients.anonymous.mutation(ref("roleFixture:seed"), { societyId: fixture.societyA, issuer: config.authUrl, identities: [] }));
});
writeFileSync(new URL("../../artifacts/offline/live-role-results.json", import.meta.url), JSON.stringify({ completedAt: new Date().toISOString(), endpoint: config.convexUrl, auth: "Real Better Auth email sessions and /api/auth/token JWTs verified by actual self-hosted Convex", readEndpoints: readEndpoints.map(row => row.name), writeEndpoints: [...writeEndpoints.map(row => row[0]), "agendas:create", "minutes:create", "conflicts:create", "attestations:sign", "proxies:create"],
  roleReadMatrix: Object.fromEntries(readEndpoints.map(endpoint => [endpoint.name, Object.fromEntries(roles.map(role => [role, endpoint.allowed ? endpoint.allowed.includes(role) : role !== "Member" || memberRead.has(endpoint.domain)]))])),
  roleWriteMatrix: Object.fromEntries(writeEndpoints.map(([name, , allowed = ["Owner", "Admin"]]) => [name, Object.fromEntries(roles.map(role => [role, allowed.includes(role)]))])),
  nativePublicAttemptCount: nativeAttempts.queries + nativeAttempts.mutations, nativeAttempts,
  hostilePrincipals: ["anonymous", "foreign workspace Owner", "disabled Admin", "invited Admin"],
  proxyQualification: "Owner/Admin requests pass their write authority and are rejected by the active bylaw prohibition on proxy voting; lower roles are rejected by permissions.", passed: results.filter(row => row.passed).length, failed: failures.length, results,
  limitations: ["Static inventory does not mean every operation state and input on all 920 public endpoints was exercised", "Optional feature switches preserve role permissions; public intake and selected execution handlers additionally enforce module enablement", "Clerk and tenant-restricted Microsoft external sign-in require configured providers; separate reconciled regression checks retain those policies", "Role matrix is server qualification, not browser route coverage"], }, null, 2) + "\n");
console.log(`${results.length - failures.length}/${results.length} live authorization scenarios passed.`);
if (failures.length) process.exitCode = 1;
