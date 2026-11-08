import assert from "node:assert/strict";
import { createMicrosoftGraphDocumentSource } from "../shared/documentSources/microsoftGraph";
import { defaultDocumentSourceSettings, validateDocumentSourceSettings } from "../shared/documentSources/configuration";
import {
  assertReferenceMatchesSource,
  DocumentSourceError,
  validateExternalDocumentReference,
  validateMicrosoftDocumentSourceConfig,
} from "../shared/documentSources/policy";
import type {
  DocumentSourceActor,
  DocumentSourceErrorCode,
  ExternalDocumentReference,
  MicrosoftDocumentLocator,
  MicrosoftDocumentSource,
} from "../shared/documentSources/types";

const tenantId = "11111111-1111-1111-1111-111111111111";
const clientId = "22222222-2222-2222-2222-222222222222";
const siteCollectionId = "33333333-3333-3333-3333-333333333333";
const webId = "44444444-4444-4444-4444-444444444444";
const userObjectId = "55555555-5555-5555-5555-555555555555";
const anotherObjectId = "66666666-6666-6666-6666-666666666666";
const actor: DocumentSourceActor = { userId: "user-1", societyId: "society-1" };
const source: MicrosoftDocumentSource = {
  id: "source-1",
  providerId: "microsoft-sharepoint",
  label: "Organization records",
  enabled: true,
  config: {
    tenantId, clientId, siteId: "example.sharepoint.com," + siteCollectionId + "," + webId,
    driveId: "b!approved-library",
    siteUrl: "https://example.sharepoint.com/sites/records",
  },
};
const locator: MicrosoftDocumentLocator = {
  tenantId, siteId: source.config.siteId, driveId: source.config.driveId, itemId: "item-1",
};
const reference: ExternalDocumentReference = { providerId: source.providerId, sourceId: source.id, locator, mode: "latest" };

// Test tokens are deliberately not signed. Mocked Graph responses represent
// Graph accepting/rejecting them; the adapter must never validate them locally.
function token(claims: Record<string, unknown> = {}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return encode({ alg: "RS256", typ: "JWT" }) + "." + encode({
    tid: tenantId, azp: clientId, oid: userObjectId, scp: "User.Read Sites.Selected",
    ...claims,
  }) + ".mock-signature";
}
const bearer = token();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const user = (id = userObjectId) => ({ id });
const drive = (overrides: Record<string, unknown> = {}) => ({
  id: source.config.driveId,
  driveType: "documentLibrary",
  webUrl: source.config.siteUrl + "/Shared%20Documents",
  sharepointIds: { tenantId, siteId: siteCollectionId, webId, siteUrl: source.config.siteUrl },
  ...overrides,
});
const item = (overrides: Record<string, unknown> = {}) => ({
  id: locator.itemId,
  name: "Minutes.pdf",
  file: { mimeType: "application/pdf" },
  size: 123,
  eTag: '"etag-1"',
  lastModifiedDateTime: "2026-11-08T12:00:00Z",
  parentReference: { driveId: source.config.driveId, siteId: source.config.siteId, id: "folder-1" },
  webUrl: source.config.siteUrl + "/Shared%20Documents/Minutes.pdf",
  "@microsoft.graph.downloadUrl": "https://untrusted.example/download?token=secret-download",
  ...overrides,
});
const prefix = () => [json(user()), json(drive())];
type Call = { url: string; init?: RequestInit };

function fixture(responses: Array<Response | Error>, supplied = bearer) {
  const calls: Call[] = [];
  const bindings: Array<{ actor: DocumentSourceActor; source: MicrosoftDocumentSource }> = [];
  const adapter = createMicrosoftGraphDocumentSource({
    getDelegatedToken: async (boundActor, boundSource) => {
      bindings.push({ actor: boundActor, source: boundSource });
      return supplied;
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const next = responses.shift();
      if (!next) throw new Error("Unexpected provider request.");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { adapter, calls, bindings };
}
const hasCode = (code: DocumentSourceErrorCode) => (error: unknown) => {
  assert.ok(error instanceof DocumentSourceError);
  assert.equal(error.code, code);
  assert.ok(!error.message.includes(bearer));
  assert.ok(!error.message.includes("secret-download"));
  assert.equal((error as Error & { cause?: unknown }).cause, undefined);
  return true;
};
async function rejected(
  setup: ReturnType<typeof fixture>,
  code: DocumentSourceErrorCode,
  input: Partial<Parameters<typeof setup.adapter.resolve>[0]> = {},
) {
  await assert.rejects(setup.adapter.resolve({ source, actor, locator, ...input }), hasCode(code));
}

// Default configuration neither enables a source nor changes existing storage.
assert.deepEqual(defaultDocumentSourceSettings(), { enabled: false, sources: [] });
const defaults = defaultDocumentSourceSettings();
defaults.sources.push(source);
assert.equal(defaultDocumentSourceSettings().sources.length, 0);
assert.deepEqual(validateDocumentSourceSettings({ enabled: false, sources: [] }), { enabled: false, sources: [] });
assert.throws(() => validateDocumentSourceSettings({ enabled: true, sources: [source, source] }), hasCode("DOCUMENT_SOURCE_INVALID_CONFIGURATION"));
for (const config of [
  { ...source.config, clientSecret: "do-not-save" },
  { ...source.config, accessToken: bearer },
  { ...source.config, tenantId: "common" },
  { ...source.config, tenantId: "9188040d-6c67-4c5b-b112-36a304b66dad" },
  { ...source.config, siteId: "root" },
  { ...source.config, siteUrl: "http://example.sharepoint.com/sites/records" },
  { ...source.config, siteUrl: "https://example-my.sharepoint.com/personal/employee" },
  { ...source.config, siteUrl: "https://elsewhere.sharepoint.com/sites/records" },
  { ...source.config, siteUrl: "https://example.sharepoint.com/sites/records?access_token=secret" },
  { ...source.config, siteUrl: "https://user:password@example.sharepoint.com/sites/records" },
]) assert.throws(() => validateMicrosoftDocumentSourceConfig(config), hasCode("DOCUMENT_SOURCE_INVALID_CONFIGURATION"));
assert.equal(validateMicrosoftDocumentSourceConfig({ ...source.config, siteId: source.config.siteId.toUpperCase() }).siteId, source.config.siteId);
assert.deepEqual(validateExternalDocumentReference(reference), reference);
assert.throws(() => validateExternalDocumentReference({ ...reference, mode: "pinned" }), hasCode("DOCUMENT_SOURCE_UNSUPPORTED"));
assert.throws(() => validateExternalDocumentReference({ ...reference, accessToken: bearer }), hasCode("DOCUMENT_SOURCE_INVALID_REFERENCE"));
assert.throws(() => assertReferenceMatchesSource({ ...reference, sourceId: "source-2" }, source), hasCode("DOCUMENT_SOURCE_OUT_OF_SCOPE"));

// Disabled sources, malformed actors, cross-source locators and bad cursors
// fail before credentials are used or any network request starts.
const disabled = fixture([]);
await rejected(disabled, "DOCUMENT_SOURCE_DISABLED", { source: { ...source, enabled: false } });
assert.equal(disabled.bindings.length, 0);
assert.equal(disabled.calls.length, 0);
const malformedActor = fixture([]);
await rejected(malformedActor, "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED", { actor: { ...actor, userId: "" } });
assert.equal(malformedActor.bindings.length, 0);
for (const changed of [
  { ...locator, tenantId: anotherObjectId },
  { ...locator, driveId: "another-drive" },
  { ...locator, siteId: "example.sharepoint.com," + anotherObjectId + "," + webId },
]) {
  const setup = fixture([]);
  await rejected(setup, "DOCUMENT_SOURCE_OUT_OF_SCOPE", { locator: changed });
  assert.equal(setup.calls.length, 0);
}

// A successful local parse never proves token validity. Graph is required,
// and neither an arbitrary app's delegated token nor app-only tokens qualify.
for (const supplied of [
  "opaque-graph-token",
  "a.b.c.d.e",
  token({ tid: anotherObjectId }),
  token({ azp: anotherObjectId }),
  token({ appid: anotherObjectId }),
  token({ oid: "not-a-user-id" }),
  token({ roles: ["Sites.Selected"] }),
  token({ scp: "User.Read" }),
  token({ scp: "User.Read Sites.Selected Files.Read.All" }),
  token({ scp: "User.Read Sites.Selected Sites.Read.All" }),
  token({ idtyp: "app" }),
]) {
  const setup = fixture([], supplied);
  await rejected(setup, "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED");
  assert.equal(setup.calls.length, 0, "Rejected token binding must not reach metadata.");
}
const badBearer = fixture([json({ error: { message: bearer } }, 401)]);
await rejected(badBearer, "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED");
assert.equal(badBearer.calls.length, 1);
const deniedUser = fixture([json({ error: { message: "secret-download" } }, 403)]);
await rejected(deniedUser, "DOCUMENT_SOURCE_FORBIDDEN");
assert.equal(deniedUser.calls.length, 1);
const wrongUser = fixture([json(user(anotherObjectId))]);
await rejected(wrongUser, "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED");
assert.equal(wrongUser.calls.length, 1);
const v1Token = fixture([...prefix(), json(item())], token({ azp: undefined, appid: clientId, scp: "openid profile email User.Read Sites.Selected" }));
assert.equal((await v1Token.adapter.resolve({ source, actor, locator })).name, "Minutes.pdf");

// Every operation verifies the organization-owned library, not merely its host.
for (const override of [
  { driveType: "personal", sharepointIds: undefined },
  { driveType: "business" },
  { id: "foreign-drive" },
  { sharepointIds: { tenantId: anotherObjectId, siteId: siteCollectionId, webId } },
  { sharepointIds: { tenantId, siteId: anotherObjectId, webId } },
  { sharepointIds: { tenantId, siteId: siteCollectionId, webId: anotherObjectId } },
  { webUrl: "https://example-my.sharepoint.com/personal/employee/Documents" },
  { webUrl: "https://example.sharepoint.com/sites/records-other/Documents" },
]) {
  const setup = fixture([json(user()), json(drive(override))]);
  await rejected(setup, "DOCUMENT_SOURCE_OUT_OF_SCOPE");
  assert.equal(setup.calls.length, 2);
}

const valid = fixture([...prefix(), json(item())]);
const resolved = await valid.adapter.resolve({ source, actor, locator });
assert.deepEqual(resolved.locator, locator);
assert.equal(resolved.kind, "file");
assert.equal(resolved.name, "Minutes.pdf");
assert.equal(resolved.mimeType, "application/pdf");
assert.equal(resolved.sizeBytes, 123);
assert.deepEqual(valid.bindings, [{ actor, source }]);
assert.ok(!JSON.stringify(resolved).includes("secret-download"));
assert.ok(!JSON.stringify(resolved).includes(bearer));
assert.deepEqual(Object.keys(resolved).sort(), ["locator", "kind", "name", "mimeType", "sizeBytes", "modifiedAtISO", "webUrl", "eTag"].sort());
for (const call of valid.calls) {
  const url = new URL(call.url);
  assert.equal(url.origin, "https://graph.microsoft.com");
  assert.equal(call.init?.method, "GET");
  assert.equal(call.init?.redirect, "error");
  assert.equal(call.init?.credentials, "omit");
  assert.ok(call.init?.signal instanceof AbortSignal);
  assert.equal(new Headers(call.init?.headers).get("Authorization"), "Bearer " + bearer);
  assert.ok(!call.url.includes(bearer));
  assert.ok(!/\/(?:content|preview|search|createLink|createUploadSession)(?:[/?]|$)/.test(url.pathname));
}
assert.equal(new URL(valid.calls[0].url).pathname, "/v1.0/me");

// Renames and same-library moves change display metadata, not the stable key.
const moved = fixture([...prefix(), json(item({
  name: "Approved minutes.pdf",
  parentReference: { driveId: source.config.driveId, id: "different-folder" },
  webUrl: source.config.siteUrl + "/Shared%20Documents/Archive/Approved%20minutes.pdf",
}))]);
const afterMove = await moved.adapter.resolve({ source, actor, locator });
assert.deepEqual(afterMove.locator, resolved.locator);
assert.equal(afterMove.name, "Approved minutes.pdf");
assert.equal(new URL(moved.calls.at(-1)!.url).pathname, new URL(valid.calls.at(-1)!.url).pathname);
const percentName = fixture([...prefix(), json(item({
  name: "100% complete.pdf",
  webUrl: source.config.siteUrl + "/Shared%20Documents/100%25%20complete.pdf",
  file: { mimeType: null },
  eTag: null,
}))]);
const percentResult = await percentName.adapter.resolve({ source, actor, locator });
assert.equal(percentResult.name, "100% complete.pdf");
assert.ok(!Object.values(percentResult).some(value => value === undefined), "Optional metadata must serialize without undefined values.");

for (const override of [
  { id: "different-item" },
  { parentReference: { driveId: "foreign-drive" } },
  { parentReference: { driveId: source.config.driveId, siteId: "foreign-site" } },
  { remoteItem: { id: "employee-file", parentReference: { driveId: "employee-drive" } } },
  { webUrl: "https://external.example/steal" },
  { webUrl: source.config.siteUrl + "/file.pdf?tempauth=secret-download" },
  { webUrl: source.config.siteUrl + "/../outside/file.pdf" },
]) {
  await rejected(fixture([...prefix(), json(item(override))]), "DOCUMENT_SOURCE_OUT_OF_SCOPE");
}
await rejected(fixture([...prefix(), json(item({ deleted: {} }))]), "DOCUMENT_SOURCE_NOT_FOUND");

// Paging stays in the same library and folder. A continuation cannot inject a
// content endpoint, arbitrary query, bearer credential or another host.
const base = "https://graph.microsoft.com/v1.0/drives/" + source.config.driveId + "/root/children";
for (const cursor of [
  "https://external.example/children?$skiptoken=cursor",
  "http://graph.microsoft.com/v1.0/drives/" + source.config.driveId + "/root/children?$skiptoken=cursor",
  base.replace(source.config.driveId, "foreign-drive") + "?$skiptoken=cursor",
  base.replace("/root/children", "/items/foreign-folder/children") + "?$skiptoken=cursor",
  base.replace("/root/children", "/items/item-1/content") + "?$skiptoken=cursor",
  base + "?$skiptoken=cursor&access_token=secret-download",
  base + "?$skiptoken=cursor&$expand=permissions",
  base + "?$skiptoken=cursor&$select=id,name",
  base + "?$skiptoken=cursor&$top=10000",
  base + "?$skiptoken=cursor&$skipToken=duplicate",
  base + "?$skiptoken=%0D%0Asecret",
]) {
  const setup = fixture([]);
  await assert.rejects(setup.adapter.browse({ source, actor, cursor }), hasCode("DOCUMENT_SOURCE_OUT_OF_SCOPE"));
  assert.equal(setup.calls.length, 0);
  assert.equal(setup.bindings.length, 0);
}
const firstPage = fixture([...prefix(), json({
  value: [item(), item({ id: "shortcut", remoteItem: { id: "private-item" } })],
  "@odata.nextLink": base + "?$skipToken=next-page",
})]);
const page = await firstPage.adapter.browse({ source, actor });
assert.equal(page.items.length, 1, "Shortcut metadata must not be exposed.");
assert.ok(page.nextCursor);
const continued = fixture([...prefix(), json({ value: [item({ id: "item-2" })] })]);
assert.equal((await continued.adapter.browse({ source, actor, cursor: page.nextCursor })).items[0].locator.itemId, "item-2");
assert.equal(new URL(continued.calls.at(-1)!.url).searchParams.get("$skiptoken"), "next-page");
const badNextLink = fixture([...prefix(), json({ value: [item()], "@odata.nextLink": "https://external.example/children?$skiptoken=secret-download" })]);
await assert.rejects(badNextLink.adapter.browse({ source, actor }), hasCode("DOCUMENT_SOURCE_OUT_OF_SCOPE"));
assert.equal(badNextLink.calls.length, 3, "Untrusted nextLink is never fetched.");
const shortcutFolder = fixture([...prefix(), json(item({ id: "folder-1", remoteItem: { id: "outside" } }))]);
await assert.rejects(shortcutFolder.adapter.browse({ source, actor, parentItemId: "folder-1" }), hasCode("DOCUMENT_SOURCE_OUT_OF_SCOPE"));
assert.equal(shortcutFolder.calls.length, 3, "Shortcut children are never fetched.");
const normalFolder = fixture([...prefix(), json(item({ id: "folder-1", file: undefined, folder: {} })), json({ value: [] })]);
assert.deepEqual(await normalFolder.adapter.browse({ source, actor, parentItemId: "folder-1" }), { items: [] });

// Different actors never share a cached token or a provider user identity.
const concurrentCalls: Call[] = [];
const secondBearer = token({ oid: anotherObjectId });
const actorBindings: string[] = [];
const concurrent = createMicrosoftGraphDocumentSource({
  getDelegatedToken: async bound => {
    actorBindings.push(bound.userId);
    return bound.userId === actor.userId ? bearer : secondBearer;
  },
  fetch: async (input, init) => {
    const url = new URL(String(input));
    concurrentCalls.push({ url: url.href, init });
    const isFirst = new Headers(init?.headers).get("Authorization") === "Bearer " + bearer;
    if (url.pathname === "/v1.0/me") return json(user(isFirst ? userObjectId : anotherObjectId));
    if (url.pathname.endsWith("/" + source.config.driveId)) return json(drive());
    return json(item({ name: isFirst ? "First user's result.pdf" : "Second user's result.pdf" }));
  },
});
const [firstUser, secondUser] = await Promise.all([
  concurrent.resolve({ source, actor, locator }),
  concurrent.resolve({ source, actor: { userId: "user-2", societyId: "society-2" }, locator }),
]);
assert.equal(firstUser.name, "First user's result.pdf");
assert.equal(secondUser.name, "Second user's result.pdf");
assert.deepEqual(actorBindings.sort(), ["user-1", "user-2"]);
assert.equal(concurrentCalls.length, 6);

// Vendor payloads, transport exceptions, redirects and oversized metadata do
// not escape as token-bearing errors or trigger follow-up downloads.
await rejected(fixture([new Error("Transport exposed " + bearer)]), "DOCUMENT_SOURCE_UNAVAILABLE");
await rejected(fixture([json({ error: { message: bearer } }, 429)]), "DOCUMENT_SOURCE_RATE_LIMITED");
const redirected = fixture([new Response(null, { status: 302, headers: { Location: "https://external.example/?token=secret-download" } })]);
await rejected(redirected, "DOCUMENT_SOURCE_UNAVAILABLE");
assert.equal(redirected.calls.length, 1);
await rejected(fixture([...prefix(), new Response("not JSON: " + bearer)]), "DOCUMENT_SOURCE_INVALID_RESPONSE");
await rejected(fixture([...prefix(), new Response("x".repeat(1024 * 1024 + 1))]), "DOCUMENT_SOURCE_INVALID_RESPONSE");
const tooMany = fixture([...prefix(), json({ value: Array.from({ length: 101 }, () => item()) })]);
await assert.rejects(tooMany.adapter.browse({ source, actor }), hasCode("DOCUMENT_SOURCE_INVALID_RESPONSE"));
const tokenFailure = createMicrosoftGraphDocumentSource({
  getDelegatedToken: async () => { throw new Error("Token supplier exposed " + bearer); },
  fetch: async () => { throw new Error("Must not fetch."); },
});
await assert.rejects(tokenFailure.resolve({ source, actor, locator }), hasCode("DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED"));

console.log("OK external document sources: disabled defaults, delegated client/tenant/user binding, Graph validation, selected scopes, organizational libraries, stable references, safe paging, actor isolation and metadata-only reads.");
