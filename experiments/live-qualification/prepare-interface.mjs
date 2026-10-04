/** Populate synthetic records on the disposable native backend, then map every
 * routed detail view to native IDs. This operator-only setup is separate from
 * browser tests, which authenticate through genuine Better Auth sessions. */
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const path = resolve(root, "tmp/live-interface-fixture.json");
const fixture = JSON.parse(readFileSync(path, "utf8"));
const config = JSON.parse(readFileSync(resolve(here, ".env.accounts.local"), "utf8"));
if (new URL(config.convexUrl).hostname !== "127.0.0.1" || new URL(config.appUrl).hostname !== "127.0.0.1") throw new Error("Interface fixture setup is restricted to isolated loopback instances.");
const owner = config.accounts.find((account) => account.key === "owner-a");
const client = new ConvexHttpClient(config.convexUrl, { logger: false });
const operator = new ConvexHttpClient(config.convexUrl, { logger: false });
operator.setAdminAuth(config.adminKey);
// Admin impersonation is used solely for dataset preparation. No browser test
// receives this deployment key or this operator-created identity transport.
client.setAdminAuth(config.adminKey, { issuer: config.issuer, subject: owner.subject, tokenIdentifier: `${config.issuer}|${owner.subject}` });
const query = (name, args) => client.query(makeFunctionReference(name), args);
const mutate = (name, args) => client.mutation(makeFunctionReference(name), args);
const scope = { societyId: fixture.societyId };

let templates = await query("meetingTemplates:list", scope);
if (!templates.length) {
  await mutate("meetingTemplates:create", { ...scope, name: "Live qualification board template", meetingType: "Board", items: [{ title: "Call to order" }, { title: "Business" }] });
  templates = await query("meetingTemplates:list", scope);
}
let elections = await query("elections:list", scope);
if (!elections.length) {
  await mutate("elections:create", { ...scope, title: "Isolated interface election", opensAtISO: "2036-01-01T00:00:00.000Z", closesAtISO: "2036-01-02T00:00:00.000Z" });
  elections = await query("elections:list", scope);
}
let assets = await query("assets:list", scope);
if (!assets.length) {
  await mutate("assets:create", { ...scope, assetTag: "LIVE-INTERFACE-BASE", name: "Isolated interface equipment", category: "Equipment" });
  assets = await query("assets:list", scope);
}
let wave = await query("waveCache:resources", scope);
if (!wave.length) {
  // Cached provider UI uses clearly labelled synthetic native cache records.
  // This does not make a live call to Wave or imply a provider qualification.
  await operator.function(makeFunctionReference("interfaceFixture:seedWave"), undefined, scope);
  wave = await query("waveCache:resources", scope);
}
const [members, meetings, documents, grants, committees, goals, policies, workflows] = await Promise.all([
  query("members:list", scope), query("meetings:list", scope), query("documents:list", scope), query("grants:list", scope), query("committees:list", scope), query("goals:list", scope), query("insurance:list", scope), query("workflows:list", scope),
]);
const pick = (rows, predicate = () => true) => {
  const row = rows.find(predicate);
  if (!row) throw new Error("Required native interface fixture record is missing.");
  return row._id;
};
fixture.ids = {
  static_member_mina: pick(members),
  static_meeting_template_board: pick(templates),
  static_meeting_board_q2: pick(meetings, (row) => row.type === "Board" && row.status === "Held"),
  static_meeting_agm_2025: pick(meetings, (row) => row.type === "AGM" && row.status === "Held"),
  static_document_bylaws: pick(documents, (row) => /bylaw/i.test(row.title)),
  static_wave_account_operating: pick(wave, (row) => row.resourceType === "account"),
  static_wave_business_resource: pick(wave, (row) => row.resourceType === "business"),
  static_grant: pick(grants), static_committee_finance: pick(committees), static_goal_agm: pick(goals),
  static_asset_projector: pick(assets), static_insurance_do: pick(policies), static_election: pick(elections), static_workflow_unbc: pick(workflows),
};
// Exercise populated nested panels, including record-type permissions that
// differ from their parent member register. Each viewport has a text field so
// positive save/reload cases do not overwrite one another's values.
let definitions = await query("customFields:listDefinitions", { ...scope, entityType: "members" });
for (const field of [
  ...[320, 390, 768, 1440].map((width) => ({ key: `live_interface_text_${width}`, label: `Live qualification text ${width}`, kind: "text" })),
  { key: "live_interface_boolean", label: "Live qualification boolean", kind: "boolean" },
  { key: "live_interface_date", label: "Live qualification date", kind: "date" },
]) if (!definitions.some((definition) => definition.key === field.key)) {
  await mutate("customFields:createDefinition", { ...scope, entityType: "members", ...field });
}
definitions = await query("customFields:listDefinitions", { ...scope, entityType: "members" });
const notes = await query("notes:listForRecord", { ...scope, entityType: "member", subjectId: fixture.ids.static_member_mina });
const memberNote = "Live qualification authored Member note";
if (!notes.some((note) => note.body === memberNote)) await mutate("notes:create", {
  ...scope, entityType: "member", subjectId: fixture.ids.static_member_mina,
  author: "member-a", body: memberNote,
});
fixture.memberPanels = { memberNote, fields: definitions.filter((definition) => definition.key.startsWith("live_interface_")) };
if (!fixture.partyPortal) {
  // Public token qualification uses its own synthetic workspace, never A's
  // private records. The portal token is a credential and stays ignored.
  const created = await mutate("society:createWorkspace", { name: "Private portal interface qualification", seedDocumentPackets: false });
  await mutate("directors:create", {
    societyId: created.societyId, firstName: "Synthetic", lastName: "Portal Director", position: "Director",
    isBCResident: true, termStart: "2026-01-01", consentOnFile: true, status: "Active",
  });
  const token = randomBytes(32).toString("hex");
  const portalId = await mutate("partyPortals:create", { societyId: created.societyId, token, label: "Disposable interface reviewer", scopes: ["board"], allowDownload: false });
  fixture.partyPortal = { societyId: created.societyId, portalId, token, societyName: "Private portal interface qualification", label: "Disposable interface reviewer" };
}
if (!fixture.publicIntake) fixture.publicIntake = await operator.function(makeFunctionReference("roleFixture:seedPublicIntake"), undefined, {});
fixture.routePaths = {
  ...(fixture.routePaths ?? {}),
  "/public/:slug": `/public/${fixture.publicIntake.slug}`,
  "/public/:slug/volunteer-apply": `/public/${fixture.publicIntake.slug}/volunteer-apply`,
  "/public/:slug/grant-apply": `/public/${fixture.publicIntake.slug}/grant-apply`,
  // A valid native document from another category exercises a missing budget
  // without sending an invalid Convex ID through its strict query validator.
  "/app/org-history/budgets/:budgetId": `/app/org-history/budgets/${pick(documents, (row) => row.category === "Constitution")}`,
};
const routeSource = readFileSync(resolve(root, "tests/helpers/interfaceRoutes.ts"), "utf8");
const expectedAliases = [...new Set(routeSource.match(/static_[a-z0-9_]+/g) ?? [])];
for (const alias of expectedAliases) if (!fixture.ids[alias]) throw new Error(`Native interface route alias is missing: ${alias}`);
fixture.rows = { ...fixture.rows, members, meetings, documents, grants, committees, goals, insurancePolicies: policies, assets, elections, meetingTemplates: templates, waveCacheResources: wave, workflows };
fixture.providerQualification = { wave: "Synthetic cached resources only; external provider integration is not exercised." };
const preparedPath = `${path}.prepared`;
writeFileSync(preparedPath, JSON.stringify(fixture), { mode: 0o600 });
renameSync(preparedPath, path);
console.log(`Prepared ${Object.keys(fixture.ids).length} native detail identifiers and safe missing-record paths; credentials remain in the ignored fixture.`);
