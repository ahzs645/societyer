import assert from "node:assert/strict";
import { SharePointAdapter, validateSharePointConnection, type SharePointConnection, type SharePointLocator } from "../shared/storage/sharePointAdapter";
const tenant = "11111111-1111-1111-1111-111111111111";
const connection: SharePointConnection = { tenantId: tenant, siteId: "approved-site", driveId: "approved-drive", authorizationMode: "application", transferHosts: ["files.example.test"], maxFileBytes: 8 * 1024 ** 2 };
const locator: SharePointLocator = { provider: "sharepoint", tenantId: tenant, siteId: connection.siteId, driveId: connection.driveId, itemId: "item-1" };
const token = "access-token-must-remain-server-only";
const metadata = (size = 3) => ({ id: "item-1", name: "test.pdf", size, eTag: "etag-1", parentReference: { driveId: connection.driveId }, "@microsoft.graph.downloadUrl": "https://files.example.test/file?secret=signed-capability" });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
let requests: Array<{ url: string; init?: RequestInit }> = [];
function adapter(responses: Array<Response | Error>, maxBytes = connection.maxFileBytes) {
  return new SharePointAdapter({ ...connection, maxFileBytes: maxBytes }, { token: async (binding) => { assert.equal(binding.tenantId, tenant); assert.equal(binding.audience, "https://graph.microsoft.com"); return token; }, wait: async () => {}, fetch: async (url, init) => {
    requests.push({ url: String(url), init }); const response = responses.shift(); if (response instanceof Error) throw response; if (!response) throw new Error("Unexpected request"); return response;
  } });
}
assert.throws(() => validateSharePointConnection({ ...connection, tenantId: "company.example" }), /UUID/);
assert.throws(() => validateSharePointConnection({ ...connection, transferHosts: ["*"] }), /exact/);
await assert.rejects(adapter([]).download({ ...locator, driveId: "foreign-drive" }), /outside/);
await assert.rejects(adapter([]).download({ ...locator, tenantId: "foreign-tenant" }), /outside/);
requests = [];
const verified = await adapter([json({ id: connection.driveId, sharePointIds: { tenantId: tenant } }), json({ id: connection.driveId })]).verifyResource();
assert.equal(verified.siteId, connection.siteId);
await assert.rejects(adapter([json({ id: connection.driveId, sharePointIds: { tenantId: "foreign" } })]).verifyResource(), /ownership/);
requests = [];
const uploaded = await adapter([json(metadata())]).upload("test.pdf", new Uint8Array([1, 2, 3]));
assert.deepEqual(uploaded.locator, locator);
assert.equal(new Headers(requests[0].init?.headers).get("Authorization"), `Bearer ${token}`);
assert.equal(new Headers(requests[0].init?.headers).get("If-None-Match"), "*");
assert.ok(!JSON.stringify(uploaded).includes("secret=")); assert.ok(!JSON.stringify(uploaded).includes(token));
await assert.rejects(adapter([]).upload("../escape.pdf", new Uint8Array([1])), /filename/);
await assert.rejects(adapter([]).upload("test.pdf", new Uint8Array([1]), { existing: { locator, eTag: "" } }), /eTag/);
await assert.rejects(adapter([json({}, 412)]).upload("test.pdf", new Uint8Array([1]), { existing: { locator, eTag: "previous-etag" } }), /conflict/);
await assert.rejects(adapter([json({ ...metadata(), parentReference: { driveId: "foreign-drive" } })]).upload("test.pdf", new Uint8Array([1, 2, 3])), /out-of-scope/);

requests = [];
const bytes = await adapter([new Response(null, { status: 302, headers: { Location: "https://files.example.test/file?secret=signed-capability" } }), new Response(new Uint8Array([1, 2, 3]))]).download({ ...locator, versionId: "3.0" });
assert.deepEqual([...bytes], [1, 2, 3]);
assert.ok(requests[0].url.includes("/versions/3.0/content"));
assert.equal(new Headers(requests[1].init?.headers).get("Authorization"), null);
assert.equal(requests[1].init?.redirect, "manual");
assert.ok(requests[1].init?.signal instanceof AbortSignal);
await assert.rejects(adapter([new Response(null, { status: 302, headers: { Location: "https://foreign.example/private?token=secret" } })]).download(locator), /outside/);
await assert.rejects(adapter([new Response(new Uint8Array([1, 2, 3, 4]))], 3).download(locator), /file limit/);
await assert.rejects(adapter([new Error("leaked signed-capability")]).download(locator), (error: Error) => !error.message.includes("leaked"));
await assert.rejects(new SharePointAdapter(connection, { token: async () => { throw new Error(token); } }).download(locator), (error: Error) => error.message === "Graph token acquisition failed.");

requests = [];
const throttled = await adapter([json({}, 429, { "Retry-After": "0" }), new Response(new Uint8Array([3]))]).download(locator);
assert.deepEqual([...throttled], [3]); assert.equal(requests.length, 2);
const versions = await adapter([json({ value: [{ id: "1.0" }, { id: "2.0" }] })]).versions(locator);
assert.deepEqual(versions.versions.map((version) => version.versionId), ["1.0", "2.0"]);
await assert.rejects(adapter([]).versions(locator, "https://graph.microsoft.com/v1.0/drives/approved-drive/items/foreign-item/versions"), /approved item/);
const continued = await adapter([json({ value: [{ id: "3.0" }] })]).versions(locator, "https://graph.microsoft.com/v1.0/drives/approved-drive/items/item-1/versions?$skiptoken=cursor");
assert.equal(continued.versions[0].versionId, "3.0");
await assert.rejects(adapter([]).delta("https://graph.microsoft.com/v1.0/drives/approved-drive/root/delta?access_token=secret"), /outside/);
const delta = await adapter([json({ value: [metadata(), { id: "item-2", deleted: {} }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/approved-drive/root/delta?token=checkpoint" })]).delta();
assert.equal(delta.items.length, 2); assert.equal(delta.resetRequired, false); assert.ok(delta.checkpoint);
await assert.rejects(adapter([]).delta("https://graph.microsoft.com/v1.0/drives/foreign-drive/root/delta"), /outside/);
assert.equal((await adapter([json({}, 410)]).delta()).resetRequired, true);

// Chunked session uploads never forward the Graph bearer token to preauthenticated URLs.
requests = [];
const large = new Uint8Array(4 * 1024 ** 2 + 1);
const chunks: Response[] = [json({ uploadUrl: "https://files.example.test/upload?secret=session" })];
for (let end = 320 * 1024; end < large.byteLength; end += 320 * 1024) chunks.push(json({ nextExpectedRanges: [`${end}-`] }, 202));
chunks.push(json(metadata(large.byteLength), 201));
const largeItem = await adapter(chunks).upload("test.pdf", large);
assert.equal(largeItem.sizeBytes, large.byteLength);
for (const request of requests.slice(1)) assert.equal(new Headers(request.init?.headers).get("Authorization"), null);
assert.ok(!JSON.stringify(largeItem).includes("session"));
requests = [];
await assert.rejects(adapter([json({ uploadUrl: "https://files.example.test/upload?secret=session" }), json({ nextExpectedRanges: ["wrong-range"] }, 202), new Response(null, { status: 204 })]).upload("test.pdf", large), (error: Error) => !error.message.includes("secret") && !error.message.includes(token));
assert.equal(requests.at(-1)?.init?.method, "DELETE");
console.log("OK SharePoint adapter: resource boundaries, stable versions, conflicts, bounded proxy, throttling, delta reset, secret separation and chunked upload");
