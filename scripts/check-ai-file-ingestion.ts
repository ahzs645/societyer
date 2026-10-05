import assert from "node:assert/strict";
import { createServer } from "node:http";
import { makeFunctionReference } from "convex/server";
import { createFixture } from "../experiments/offline-convex/fixture";
import { composeAiMessage, readAiTextAttachment, validateAiAttachments } from "../shared/aiAttachments";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableMutation, definePortableQuery } from "../shared/portable/index";
import * as chat from "../shared/functions/aiChat";
import { requireDocumentAccess } from "../shared/functions/documents";

const attachment = { name: "minutes.txt", mediaType: "text/plain", text: "Synthetic minutes: approve the community garden budget." };
for (const input of [null, [attachment, attachment, attachment, attachment, attachment], [{ ...attachment, name: "../minutes.txt" }], [{ ...attachment, text: "a".repeat(32769) }], [{ ...attachment, text: "\u0000binary" }], [{ ...attachment, name: "image.pdf", mediaType: "application/pdf" }], [{ name: "data.json", mediaType: "application/json", text: "{bad}" }], [{ ...attachment, documentId: "foreign-document" }]]) assert.throws(() => validateAiAttachments(input));
assert.throws(() => composeAiMessage("a".repeat(170_000), [attachment]));
assert.throws(() => composeAiMessage("", [attachment]));
const raw = new TextEncoder().encode(attachment.text);
assert.deepEqual(await readAiTextAttachment({ name: attachment.name, type: attachment.mediaType, size: raw.length, arrayBuffer: async () => raw.buffer }), attachment);
await assert.rejects(readAiTextAttachment({ name: "bad.txt", type: "text/plain", size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer }), /UTF-8/);
await assert.rejects(readAiTextAttachment({ name: "large.txt", type: "text/plain", size: 33000, arrayBuffer: async () => { throw new Error("Must not read rejected file"); } }), /32 KiB/);
console.log("PASS bounded text extraction, binary/malformed/oversize rejection and rejection of document or URL references");

const requests: any[] = [];
let releaseSlowProvider: (() => void) | undefined;
let slowProviderStarted: (() => void) | undefined;
const server = createServer(async (req, res) => {
  assert.equal(req.url, "/v1/chat/completions");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta: { role: "assistant", content: "The synthetic minutes propose a community garden budget." }, finish_reason: null }] })}\n\n`);
  if (requests.at(-1).messages.some((message: any) => message.content.includes("Downgrade streaming fixture"))) await new Promise<void>(resolve => { releaseSlowProvider = resolve; slowProviderStarted?.(); });
  res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta: requests.at(-1).messages.some((message: any) => message.content.includes("Downgrade streaming fixture")) ? { content: "LATE_SYNTHETIC_PRIVATE_OUTPUT" } : {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const originalKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "synthetic-local-fixture-key";
try {
  const fixture = await createFixture({
    "./aiChat.js": () => import("../convex/aiChat"), "./aiChatActions.js": () => import("../convex/aiChatActions"),
    "./aiAgents.js": () => import("../convex/aiAgents"), "./aiSettings.js": () => import("../convex/aiSettings"),
    "./documents.js": () => import("../convex/documents"), "./authorization.js": () => import("../convex/authorization"), "./http.js": () => import("../convex/http"),
  });
  const extra = await fixture.native.run(async ctx => {
    await ctx.db.insert("aiProviderSettings", { societyId: fixture.ids.societyA, scope: "workspace", provider: "openai-compatible", label: "Loopback fixture", status: "active", modelId: "fixture-model", baseUrl: `http://127.0.0.1:${address.port}/v1`, createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" });
    const directorId = await ctx.db.insert("users", { societyId: fixture.ids.societyA, role: "Director", status: "Active", email: "director@example.test", displayName: "Director", authSubject: "director-a", authProvider: "clerk", authIssuer: "https://offline-evaluation.clerk.accounts.dev", createdAtISO: "2026-01-01T00:00:00Z" });
    const document = { category: "Other", flaggedForDeletion: false, tags: [], createdAtISO: "2026-01-01T00:00:00Z" };
    const visible = await ctx.db.insert("documents", { ...document, societyId: fixture.ids.societyA, title: "Visible synthetic minutes" });
    const hidden = await ctx.db.insert("documents", { ...document, societyId: fixture.ids.societyA, title: "Private hidden synthetic record" });
    const foreign = await ctx.db.insert("documents", { ...document, societyId: fixture.ids.societyB, title: "Foreign synthetic record" });
    const meeting = await ctx.db.insert("meetings", { societyId: fixture.ids.societyA, title: "Private meeting", type: "Board", scheduledAt: "2026-01-01T00:00:00Z", electronic: false, attendeeIds: [], status: "Draft" } as any);
    await ctx.db.insert("meetingMaterials", { societyId: fixture.ids.societyA, meetingId: meeting, documentId: hidden, order: 0, requiredForMeeting: false, accessLevel: "restricted", accessGrants: [{ subjectType: "user", subjectId: fixture.ids.users["owner-a"] as any, subjectLabel: "Owner", access: "view" }], createdAtISO: "2026-01-01T00:00:00Z" });
    return { visible, hidden, foreign, directorId };
  });
  const send = makeFunctionReference<"action">("aiChatActions:sendChatMessage");
  const create = makeFunctionReference<"mutation">("aiChat:createThread");
  const messages = makeFunctionReference<"query">("aiChat:messagesForThread");
  const execute = makeFunctionReference<"mutation">("aiAgents:executeTool");
  const owner = fixture.actor("owner-a");
  const result = await owner.action(send, { societyId: fixture.ids.societyA, content: "Summarize the attached text", attachments: [attachment] });
  assert.equal(result.provider, "vercel_ai_sdk");
  assert.equal(requests.length, 1);
  assert.ok(requests[0].messages.some((message: any) => message.content.includes(attachment.text)), "Actual SDK adapter must carry extracted contents");
  const history = await owner.query(messages, { threadId: result.threadId });
  assert.equal(history.length, 2);
  assert.ok(history[0].content.includes(attachment.text));
  console.log("PASS actual native AI action and OpenAI-compatible SDK request carry extracted text to a loopback-only fixture provider");
  const before = requests.length;
  await assert.rejects(fixture.actor("viewer-a").action(send, { societyId: fixture.ids.societyA, threadId: result.threadId, content: "Denied", attachments: [attachment] }));
  await assert.rejects(fixture.actor("owner-b").action(send, { societyId: fixture.ids.societyA, threadId: result.threadId, content: "Denied" }));
  const foreignThread = await fixture.actor("owner-b").mutation(create, { societyId: fixture.ids.societyB });
  await assert.rejects(owner.action(send, { societyId: fixture.ids.societyA, threadId: foreignThread, content: "Denied" }));
  await assert.rejects(owner.action(send, { societyId: fixture.ids.societyA, content: "Denied", attachments: [{ ...attachment, text: "a".repeat(33000) }] }));
  assert.equal(requests.length, before);
  assert.equal((await owner.query(messages, { threadId: result.threadId })).length, 2);
  const found = await fixture.actor("owner-a").mutation(execute, { societyId: fixture.ids.societyA, toolName: "find_documents", arguments: { limit: 20 } });
  assert.equal(found.success, true);
  assert.deepEqual(found.rows.map((row: any) => row._id), [extra.visible, extra.hidden]);
  assert.ok(!JSON.stringify(found).includes("Foreign synthetic"));
  await assert.rejects(fixture.actor("director-a").mutation(execute, { societyId: fixture.ids.societyA, toolName: "find_documents" }), /tasks:write/);
  const getDocument = makeFunctionReference<"query">("documents:get");
  assert.equal((await fixture.actor("director-a").query(getDocument, { id: extra.visible }))._id, extra.visible);
  assert.equal(await fixture.actor("director-a").query(getDocument, { id: extra.hidden }), null);
  await assert.rejects(fixture.actor("director-a").query(getDocument, { id: extra.foreign }));
  await assert.rejects(fixture.actor("owner-b").mutation(execute, { societyId: fixture.ids.societyA, toolName: "find_documents" }));
  console.log("PASS native role/tenant/thread denial before writes or provider calls; foreign documents excluded from AI tools and lower-role private document reads denied");
  const post = (actor: any, body: any) => actor.fetch("/ai-chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post(fixture.actor("viewer-a"), { societyId: fixture.ids.societyA, threadId: result.threadId, content: "Denied" })).status, 403);
  assert.equal((await post(owner, { societyId: fixture.ids.societyA, content: "Denied", attachments: [{ ...attachment, text: "\u0000" }] })).status, 400);
  const streamed = await post(owner, { societyId: fixture.ids.societyA, content: "Summarize via streaming", attachments: [attachment] });
  assert.equal(streamed.status, 200);
  assert.ok((await streamed.text()).includes("event: done"));
  assert.equal(requests.length, before + 1);
  assert.ok(requests.at(-1).messages.some((message: any) => message.content.includes(attachment.text)));
  console.log("PASS actual native HTTP streaming sends content and denies Viewer writes and invalid attachments");
  const beforeSlow = await fixture.native.run(async ctx => (await ctx.db.query("aiMessages").collect()).length);
  const slowStarted = new Promise<void>(resolve => { slowProviderStarted = resolve; });
  const slowResponse = await post(owner, { societyId: fixture.ids.societyA, content: "Downgrade streaming fixture", attachments: [attachment] });
  await slowStarted;
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.users["owner-a"] as any, { role: "Member" }));
  releaseSlowProvider?.();
  const slowBody = await slowResponse.text();
  assert.ok(slowBody.includes("event: error") && !slowBody.includes("event: done"), "Revoked streaming completion must fail explicitly");
  assert.ok(!slowBody.includes("LATE_SYNTHETIC_PRIVATE_OUTPUT"), "Tokens generated after role downgrade must never be delivered");
  assert.equal(await fixture.native.run(async ctx => (await ctx.db.query("aiMessages").collect()).length), beforeSlow + 1, "Only the initial authorized user message remains; revoked completion and error writes are denied");
  console.log("PASS real SDK streaming completion cannot persist after the authenticated creator is downgraded during generation");
} finally {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  releaseSlowProvider?.();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

for (const label of ["MemoryDb", "LocalStoreDb"]) {
  const seed = { societies: [{ _id: "a", name: "A" }, { _id: "b", name: "B" }], users: [{ _id: "owner", societyId: "a", role: "Owner", status: "Active", authSubject: "owner", authIssuer: "https://portable-ai.example.test" }, { _id: "director", societyId: "a", role: "Director", status: "Active", authSubject: "director", authIssuer: "https://portable-ai.example.test" }, { _id: "viewer", societyId: "a", role: "Viewer", status: "Active", authSubject: "viewer", authIssuer: "https://portable-ai.example.test" }], documents: [{ _id: "visible", societyId: "a", title: "Visible" }, { _id: "hidden", societyId: "a", title: "Hidden" }, { _id: "foreign", societyId: "b", title: "Foreign" }], meetingMaterials: [{ _id: "material", societyId: "a", documentId: "hidden", accessLevel: "restricted", availabilityStatus: "available", accessGrants: [{ subjectType: "user", subjectId: "owner", subjectLabel: "Owner", access: "view" }] }] };
  const db = label === "MemoryDb" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const runtime = (subject: string) => {
    const value = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "verified-jwt", issuer: "https://portable-ai.example.test", subject }) });
    value.registerAll([definePortableMutation({ name: "aiChat:createThread", applicationPolicy: true, handler: chat.createThreadPortable }), definePortableQuery({ name: "aiChat:getThread", applicationPolicy: true, handler: chat.getThreadPortable }), definePortableQuery({ name: "documents:get", applicationPolicy: true, handler: (ctx, args: any) => requireDocumentAccess(ctx, args.id) })]);
    return value;
  };
  const id = await runtime("owner").runMutation("aiChat:createThread", { societyId: "a", title: "Local draft" });
  assert.equal((await runtime("owner").runQuery("aiChat:getThread", { threadId: id })).title, "Local draft");
  await assert.rejects(runtime("viewer").runMutation("aiChat:createThread", { societyId: "a" }));
  await assert.rejects(runtime("owner").runMutation("aiChat:createThread", { societyId: "b" }));
  assert.equal((await runtime("director").runQuery("documents:get", { id: "visible" }))._id, "visible");
  await assert.rejects(runtime("director").runQuery("documents:get", { id: "hidden" }));
  await assert.rejects(runtime("director").runQuery("documents:get", { id: "foreign" }));
  console.log(`PASS ${label}: persisted chat drafts, verified-principal denied writes, foreign workspace and private document ACLs`);
}
console.log("AI file ingestion qualification passed; no external provider received data. Local-device inference and binary extraction remain unavailable.");
