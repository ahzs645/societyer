import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getFunctionName } from "convex/server";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import {
  commitLinkPortable, externalDocumentsEnabled, listPortable, resolveContextPortable,
  savePortable, setEnabledPortable, sourceContextPortable, unlinkPortable,
} from "../shared/functions/documentSources";
import {
  assertDocumentSupportsStoredContent, getPortable as getDocument, removePortable,
  updateDraftContentPortable,
} from "../shared/functions/documents";
import { latestPortable, getPortable as getVersion } from "../shared/functions/documentVersions";
import { exportTablePagePortable } from "../shared/functions/exports";
import { actionPermission, requireFunctionAction } from "../shared/functions/actionPolicy";
import * as hosted from "../convex/documentSources";

const issuer = "https://source-tests.example";
const config = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  siteId: "organization.sharepoint.com,33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444",
  driveId: "b!approved-library",
  siteUrl: "https://organization.sharepoint.com/sites/board",
};
const graphUserId = "55555555-5555-4555-8555-555555555555";
const jwtPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = `${jwtPart({ alg: "RS256" })}.${jwtPart({
  tid: config.tenantId, azp: config.clientId, oid: graphUserId,
  scp: "User.Read Sites.Selected", idtyp: "user",
})}.signature`;
const graphName = "Source-confidential-name.docx";
const db = new MemoryDb({ seed: {
  societies: [
    { _id: "workspace", name: "Source tests", isCharity: false, isMemberFunded: false, updatedAt: 0 },
    { _id: "foreign", name: "Other workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 },
  ],
  users: ["Owner", "Admin", "Director", "Member"].map(role => ({
    _id: role, societyId: "workspace", role, status: "Active", authIssuer: issuer, authSubject: role,
  })),
} });

function context(role = "Owner"): PortableMutationCtx {
  return {
    db, capabilities: makeCapabilities({}),
    principal: { kind: "user", runtime: "test", assurance: "verified-jwt", subject: role, issuer, userId: role },
    runQuery: async () => { throw new Error("Unexpected nested portable query"); },
    runMutation: async () => { throw new Error("Unexpected nested portable mutation"); },
  };
}
const owner = context(), admin = context("Admin"), member = context("Member");
assert.equal(externalDocumentsEnabled({}), false);
assert.equal(externalDocumentsEnabled({ disabledModules: [] }), false);
assert.equal(externalDocumentsEnabled({ disabledModules: ["+externalDocuments"] }), true);
assert.equal(externalDocumentsEnabled({ disabledModules: ["+externalDocuments", "externalDocuments"] }), false);
assert.equal(actionPermission("documentSources:browse", "action"), "documents:read");
assert.equal(actionPermission("documentSources:resolve", "action"), "documents:read");
assert.equal(actionPermission("documentSources:save", "mutation"), "settings:write");
await assert.rejects(() => savePortable(member, { societyId: "workspace", label: "Denied", config }), /settings:write/);
await assert.rejects(() => savePortable(owner, { societyId: "foreign", label: "Denied", config }), /membership/);

const sourceId = await savePortable(admin, { societyId: "workspace", label: "Board source", config });
assert.equal((await listPortable(owner, { societyId: "workspace" }))[0].enabled, false, "new sources default off even while configuration is available");
await assert.rejects(() => savePortable(admin, { societyId: "workspace", sourceId, label: "Retarget", config: { ...config, driveId: "other-drive" } }), /cannot be changed/);
await assert.rejects(() => savePortable(admin, { societyId: "workspace", label: "Secret", config: { ...config, accessToken } as any }), /Check the source/);

let currentRole = "Owner";
const queryArguments: unknown[] = [];
const actionCtx = {
  async runQuery(reference: any, args: any) {
    queryArguments.push(args);
    const name = getFunctionName(reference);
    if (name === "authorization:checkAction") {
      await requireFunctionAction(context(currentRole), args.name, args.kind, args.args);
      return null;
    }
    if (name === "documentSources:sourceContext") return sourceContextPortable(context(currentRole), args);
    if (name === "documentSources:resolveContext") return resolveContextPortable(context(currentRole), args);
    throw new Error(`Unexpected internal query: ${name}`);
  },
  async runMutation(reference: any, args: any) {
    assert.equal(getFunctionName(reference), "documentSources:commitLink");
    assert.ok(!JSON.stringify(args).includes(accessToken));
    return db.transaction(() => commitLinkPortable(context(currentRole), args));
  },
};
const runAction = (name: "browse" | "link" | "resolve", args: unknown) => (hosted[name] as any)._handler(actionCtx, args);
const actionArgs = { societyId: "workspace", sourceId, accessToken };
const item = (itemId: string) => ({
  id: itemId, name: graphName, file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  size: 123, eTag: "source-version-1", webUrl: config.siteUrl + "/Documents/source.docx",
  parentReference: { driveId: config.driveId, siteId: config.siteId },
});
const originalFetch = globalThis.fetch;
const requests: string[] = [];
let onItemRead: (() => Promise<void>) | undefined;
let sourceDenied = false;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  requests.push(url.pathname);
  assert.equal(init?.method, "GET", "external document actions never write Microsoft files");
  assert.equal(url.origin, "https://graph.microsoft.com");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer " + accessToken);
  if (sourceDenied) return new Response("private Microsoft diagnostic", { status: 403 });
  let payload: unknown;
  if (url.pathname === "/v1.0/me") payload = { id: graphUserId };
  else if (url.pathname === "/v1.0/drives/" + config.driveId) payload = {
    id: config.driveId, driveType: "documentLibrary", webUrl: config.siteUrl + "/Documents",
    sharepointIds: {
      tenantId: config.tenantId, siteId: config.siteId.split(",")[1], webId: config.siteId.split(",")[2], siteUrl: config.siteUrl,
    },
  };
  else if (url.pathname.endsWith("/root/children")) payload = { value: [item("original-item")] };
  else if (url.pathname.includes("/items/")) {
    const effect = onItemRead;
    onItemRead = undefined;
    if (effect) await effect();
    payload = item(url.pathname.split("/").at(-1)!);
  } else throw new Error("Unexpected Microsoft request");
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

try {
  await assert.rejects(() => runAction("browse", actionArgs), /turned off/);
  assert.equal(requests.length, 0, "module off never contacts Microsoft");
  await db.patch("workspace", { disabledModules: ["+externalDocuments"] });
  await assert.rejects(() => runAction("browse", actionArgs), /disabled/);
  assert.equal(requests.length, 0, "source off never contacts Microsoft");
  await setEnabledPortable(admin, { societyId: "workspace", sourceId, enabled: true });
  await assert.rejects(() => runAction("browse", { ...actionArgs, accessToken: "" }), /Connect your Microsoft account/);
  assert.equal(requests.length, 0, "missing credentials never contacts Microsoft");
  currentRole = "Member";
  await assert.rejects(() => runAction("link", { ...actionArgs, item: { itemId: "original-item" } }), /documents:write/);
  assert.equal(requests.length, 0, "app permission denial precedes Microsoft access");
  currentRole = "Owner";
  const page = await runAction("browse", actionArgs);
  assert.equal(page.items[0].name, graphName);
  const linked = await runAction("link", { ...actionArgs, item: { itemId: "original-item" }, category: "Policy" });
  const document = await getDocument(owner, { id: linked.documentId });
  assert.equal(document.title, "Linked document", "the source filename is not copied into the ordinary catalog");
  for (const field of ["fileName", "mimeType", "content", "url", "storageId", "fileSizeBytes"]) assert.equal(document[field], undefined);
  assert.deepEqual(Object.keys(document.externalReference).sort(), ["sourceId", "providerId", "referenceId", "mode"].sort());
  assert.equal(db.dump("documentVersions").length, 0);
  assert.ok(!JSON.stringify([db.dump("documents"), db.dump("documentSources"), db.dump("externalDocumentReferences")]).includes(graphName));
  assert.ok(!JSON.stringify([db.dump("documents"), db.dump("documentSources"), db.dump("externalDocumentReferences")]).includes(accessToken));
  assert.ok(!JSON.stringify(queryArguments).includes(accessToken), "credentials never enter the secondary auth or context query");
  assert.equal((await runAction("link", { ...actionArgs, item: { itemId: "original-item" } })).documentId, linked.documentId);
  assert.equal(db.dump("externalDocumentReferences").length, 1, "same stable source/item identity is deduplicated");
  assert.equal((await runAction("resolve", { documentId: linked.documentId, accessToken })).name, graphName);
  assert.equal(await latestPortable(owner, { documentId: linked.documentId }), null);
  assert.throws(() => assertDocumentSupportsStoredContent(document), /external original/);
  await assert.rejects(() => updateDraftContentPortable(owner, { id: linked.documentId, title: "Copied", content: "copied bytes" }), /external original/);
  const staleVersion = await db.insert("documentVersions", { societyId: "workspace", documentId: linked.documentId, storageKey: "should-not-open" });
  await assert.rejects(() => getVersion(owner, { id: staleVersion }), /external original/);
  await db.delete(staleVersion);

  const materialId = await db.insert("meetingMaterials", {
    societyId: "workspace", documentId: linked.documentId, meetingId: "meeting", accessLevel: "restricted", accessGrants: [], availabilityStatus: "available",
  });
  currentRole = "Member";
  const beforeDeniedResolve = requests.length;
  await assert.rejects(() => runAction("resolve", { documentId: linked.documentId, accessToken }), /not found/);
  assert.equal(requests.length, beforeDeniedResolve, "document ACL denial precedes source lookup");
  const exported = await exportTablePagePortable(member, {
    societyId: "workspace", table: "externalDocumentReferences", paginationOpts: { numItems: 20, cursor: null },
  });
  assert.equal(exported.page.length, 0, "generic export cannot disclose private locators of an inaccessible document");
  await assert.rejects(() => unlinkPortable(member, { documentId: linked.documentId }), /not found|documents:write/);
  currentRole = "Owner";

  onItemRead = async () => setEnabledPortable(admin, { societyId: "workspace", sourceId, enabled: false });
  await assert.rejects(() => runAction("link", { ...actionArgs, item: { itemId: "disabled-mid-request" } }), /disabled/);
  assert.equal(db.dump("externalDocumentReferences").length, 1);
  await setEnabledPortable(admin, { societyId: "workspace", sourceId, enabled: true });
  onItemRead = async () => {
    await setEnabledPortable(admin, { societyId: "workspace", sourceId, enabled: false });
    await setEnabledPortable(admin, { societyId: "workspace", sourceId, enabled: true });
  };
  await assert.rejects(() => runAction("link", { ...actionArgs, item: { itemId: "re-enabled-mid-request" } }), /access changed/);
  onItemRead = async () => db.patch("Owner", { status: "Disabled" });
  await assert.rejects(() => runAction("link", { ...actionArgs, item: { itemId: "revoked-mid-request" } }), /disabled/);
  await db.patch("Owner", { status: "Active" });
  onItemRead = async () => db.patch("workspace", { disabledModules: [] });
  await assert.rejects(() => runAction("link", { ...actionArgs, item: { itemId: "module-off-mid-request" } }), /turned off/);
  await db.patch("workspace", { disabledModules: ["+externalDocuments"] });
  sourceDenied = true;
  await assert.rejects(() => runAction("resolve", { documentId: linked.documentId, accessToken }), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("private Microsoft diagnostic"));
    return /does not have access/.test(error.message);
  });
  sourceDenied = false;

  const second = await runAction("link", { ...actionArgs, item: { itemId: "second-item" }, title: "User's record" });
  await removePortable(owner, { id: second.documentId });
  assert.equal(db.dump("externalDocumentReferences").length, 1, "ordinary document removal cleans up only its private reference");
  await setEnabledPortable(admin, { societyId: "workspace", sourceId, enabled: false });
  await db.patch("workspace", { disabledModules: [] });
  const beforeUnlink = requests.length;
  await unlinkPortable(owner, { documentId: linked.documentId });
  assert.equal(requests.length, beforeUnlink, "unlink is an app-only operation even with module and source off");
  assert.equal(db.dump("externalDocumentReferences").length, 0);
  assert.equal((await db.get(linked.documentId))?.title, "Linked document", "unlink keeps the Societyer record");
  assert.equal((await db.get(linked.documentId))?.externalReference, undefined);
  assert.ok(await db.get(materialId), "unlink preserves meeting associations");
  assert.equal((hosted.commitLink as any).isInternal, true);
  assert.notEqual((hosted.commitLink as any).isPublic, true);
  assert.ok(!readFileSync("shared/functions/registry.ts", "utf8").includes('name: "documentSources:commitLink"'));

  for (let index = 1; index < 50; index++) await savePortable(admin, { societyId: "workspace", label: `Source ${index}`, config });
  assert.equal((await listPortable(owner, { societyId: "workspace" })).length, 50);
  await assert.rejects(() => savePortable(admin, { societyId: "workspace", label: "One too many", config }), /at most 50/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("document source backend: gates, delegated verification, atomic commit, ACLs, metadata separation, and unlink passed");
