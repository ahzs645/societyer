/**
 * One minutes-drafting path for every runtime.
 *
 * 1. The hosted action (minutes:generateDraft under convex-test, pointed at the
 *    mock OpenAI-compatible server) and the on-device orchestrator
 *    (draftMinutesOnDevice through the device client, then the portable
 *    minutes:upsertFromDraft) send the same prompt and produce the same upsert
 *    arguments and the same stored minutes.
 * 2. Long transcripts on a small budget are drafted in parts and merged.
 * 3. Adopted minutes are refused before any model call, on device too.
 * 4. Hosted drafting now uses the workspace's saved AI provider, and a saved
 *    address on a private host is refused (the deployment key is used instead).
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { MemoryDb, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { startMockOpenAiServer } from "./fixtures/mock-openai-server";
import { createDeviceAiClient, resetAcceptedJsonModes } from "../src/lib/localAi/client";
import { directTransport } from "../src/lib/localAi/transport";
import { draftMinutesOnDevice } from "../src/features/meetings/localMinutesDraft";
import { buildMinutesDraftMessages } from "../shared/ai/minutesDraft";
import { mergeMinuteDrafts, splitTranscript } from "../shared/ai/minutesDraftChunks";
import { ADOPTED_MINUTES_DRAFT_BLOCKED } from "../shared/minutesDraftInput";

const server = await startMockOpenAiServer();
const ENV_KEY = "deployment-env-key";
delete process.env.ANTHROPIC_API_KEY;
process.env.OPENAI_API_KEY = ENV_KEY;
process.env.OPENAI_API_BASE_URL = `${server.baseUrl}/chat/completions`;
process.env.OPENAI_MINUTES_MODEL = "mock-llm";

type ChatBody = { model?: string; messages?: Array<{ role: string; content: string }>; response_format?: { type?: string } };
const chatBodies = () => server.requests.filter((request) => request.path === "/v1/chat/completions").map((request) => request.body as ChatBody);

const TITLE = "October board meeting";
const TYPE = "Board";
const SCHEDULED = "2026-10-04T18:00:00Z";
const transcript = [
  "Jane Doe: I call the meeting to order.",
  "John Roe: I move to approve the 2027 budget.",
  "Mary Major: Seconded.",
  "Jane Doe: Carried.",
  "Mary Major: Action: circulate the budget to members.",
].join("\n");

// ---- Hosted: convex-test, OpenAI-compatible env endpoint = the mock ----------
const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./meetings.js": () => import("../convex/meetings"),
  "./minutes.js": () => import("../convex/minutes"),
  "./aiSettings.js": () => import("../convex/aiSettings"),
  "./secrets.js": () => import("../convex/secrets"),
});
const hosted = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Shared drafting", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", email: "owner@example.test", displayName: "Owner", authSubject: "owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: TITLE, type: TYPE, scheduledAt: SCHEDULED, electronic: false, status: "Held", attendeeIds: [] });
  const secondMeetingId = await ctx.db.insert("meetings", { societyId, title: TITLE, type: TYPE, scheduledAt: SCHEDULED, electronic: false, status: "Held", attendeeIds: [] });
  return { societyId, meetingId, secondMeetingId };
});
const owner = test.withIdentity({ subject: "owner", issuer });
const hostedRow = (meetingId: string) => test.run((ctx) => ctx.db.query("minutes").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).first());

resetAcceptedJsonModes();
await owner.action(api.minutes.generateDraft, { meetingId: hosted.meetingId, transcript });
const hostedBody = chatBodies().at(-1)!;
assert.equal(server.requests.at(-1)?.authorization, `Bearer ${ENV_KEY}`, "the deployment key is used when no workspace provider is saved");

// ---- On device: portable runtime + device client to the same mock ------------
const societyId = "device-society";
const db = new MemoryDb({
  seed: {
    ...portableTestSeed(societyId),
    meetings: [{ _id: "meeting", societyId, title: TITLE, type: TYPE, scheduledAt: SCHEDULED, electronic: false, status: "Held", attendeeIds: [] }],
  },
});
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => portableTestPrincipal() }).registerAll(PORTABLE_FUNCTIONS);
const deviceClient = createDeviceAiClient({ transport: directTransport(() => ({ baseUrl: server.baseUrl, apiKey: "" })), kind: "ollama", model: "mock-llm", serverKey: server.baseUrl });
const deviceMeeting = { _id: "meeting", societyId, title: TITLE, type: TYPE, scheduledAt: SCHEDULED, attendeeIds: [] };

const device = await draftMinutesOnDevice({ client: deviceClient, meeting: deviceMeeting, transcript, existingMinutes: null, chunkChars: 8000 });
const deviceBody = chatBodies().at(-1)!;
assert.equal(device.requests, 1);
assert.equal(device.chunked, false);
assert.equal(server.requests.at(-1)?.authorization, undefined, "a loopback server gets no key");

// Same prompt on both sides (only the JSON mode differs by endpoint).
assert.deepEqual(deviceBody.messages, hostedBody.messages, "hosted and on-device send the identical prompt");
assert.deepEqual(hostedBody.messages, buildMinutesDraftMessages({ transcript, meetingTitle: TITLE, meetingType: TYPE }));
assert.equal(hostedBody.response_format?.type, "json_object");
assert.equal(deviceBody.response_format?.type, "json_schema");

await runtime.runMutation("minutes:upsertFromDraft", device.args);
const deviceRow = await runtime.runQuery<Record<string, unknown>>("minutes:getByMeeting", { meetingId: "meeting" });
const hostedView = await owner.query(api.minutes.getByMeeting, { meetingId: hosted.meetingId });
const hostedStored = await hostedRow(hosted.meetingId);
assert.ok(hostedStored && deviceRow && hostedView);

// Identical upsert arguments: every argument the device sent is what the hosted action stored.
// Stored rows drop undefined fields, so compare JSON-equivalent values.
const plain = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const { societyId: _s, meetingId: _m, motions, ...comparable } = device.args;
for (const [key, value] of Object.entries(comparable)) {
  if (value === undefined) continue;
  assert.deepEqual(plain((hostedStored as Record<string, unknown>)[key]), plain(value), `hosted minutes.${key} matches the on-device upsert argument`);
  assert.deepEqual(plain(deviceRow[key]), plain(value), `on-device minutes.${key} matches its upsert argument`);
}
const motionView = (row: Record<string, unknown>) =>
  ((row.displayMotions as Array<Record<string, unknown>> | undefined) ?? []).map((motion) => ({ text: motion.text, movedBy: motion.movedBy, outcome: motion.outcome }));
assert.deepEqual(motionView(hostedView as Record<string, unknown>), motions.map((motion) => ({ text: motion.text, movedBy: motion.movedBy, outcome: motion.outcome })));
assert.deepEqual(motionView(deviceRow), motionView(hostedView as Record<string, unknown>), "both runtimes store the same motions");
assert.deepEqual(device.args.attendees, ["Jane Doe", "John Roe", "Mary Major"]);
assert.equal(device.args.quorumStatus, "not_recorded", "unknown quorum is not established");
assert.equal(device.args.draftTranscript, transcript);
assert.equal(device.args.actionItems[0]?.text, "circulate the budget to members");

// ---- Long transcripts: drafted in parts, merged in order ---------------------
const long = Array.from({ length: 40 }, (_, index) =>
  index % 10 === 3 ? `Speaker ${index % 4}: I move to adopt item ${index}.` : `Speaker ${index % 4}: Discussion line ${index} ${"about the agenda ".repeat(4)}`,
).join("\n");
const parts = splitTranscript(long, 1000);
assert.ok(parts.length > 2, "a long transcript splits into several parts");
assert.equal(parts.join("\n"), long, "splitting loses no text");
assert.ok(parts.every((part) => part.length <= 1000));
assert.deepEqual(splitTranscript("x".repeat(2500), 1000).map((part) => part.length), [1000, 1000, 500], "an overlong line is cut");
server.requests.length = 0;
const chunked = await draftMinutesOnDevice({ client: deviceClient, meeting: { ...deviceMeeting, _id: "meeting-2" }, transcript: long, existingMinutes: null, chunkChars: 1000 });
assert.equal(chunked.chunked, true);
assert.equal(chunked.requests, parts.length);
assert.equal(chatBodies().length, parts.length, "one model request per part");
assert.ok(chatBodies().every((body, index) => body.messages?.[1]?.content.startsWith(`This is part ${index + 1} of ${parts.length}`)));
assert.deepEqual(chunked.args.motions.map((motion) => motion.text), ["Adopt item 3", "Adopt item 13", "Adopt item 23", "Adopt item 33"], "motions keep spoken order across parts");
assert.deepEqual(chunked.args.attendees, ["Speaker 0", "Speaker 1", "Speaker 2", "Speaker 3"], "attendees are de-duplicated across parts");
assert.equal(chunked.args.draftTranscript, long, "the full transcript is stored, not a part");
const merged = mergeMinuteDrafts([
  { discussion: "A", motions: [], decisions: ["Same"], actionItems: [], attendees: ["Ann"], absent: ["Bob"], calledToOrderAt: "7:00", adjournedAt: "7:30" },
  { discussion: "B", motions: [], decisions: ["same"], actionItems: [], attendees: ["Bob"], absent: [], adjournedAt: "8:15" },
]);
assert.deepEqual([merged.discussion, merged.decisions, merged.absent, merged.calledToOrderAt, merged.adjournedAt], ["A\n\nB", ["Same"], [], "7:00", "8:15"], "someone who spoke is not absent; opening/closing facts from first/last part");

// ---- Adopted minutes: refused before any model call --------------------------
await runtime.runMutation("minutes:update", { id: String(deviceRow._id), patch: { discussion: "", sections: [], approvedAt: "2026-10-05", approvedInMeetingId: "meeting" } });
const adopted = await runtime.runQuery("minutes:getByMeeting", { meetingId: "meeting" });
server.requests.length = 0;
await assert.rejects(
  () => draftMinutesOnDevice({ client: deviceClient, meeting: deviceMeeting, transcript, existingMinutes: adopted, chunkChars: 8000 }),
  new RegExp(ADOPTED_MINUTES_DRAFT_BLOCKED.slice(0, 20)),
);
assert.equal(server.requests.length, 0, "adopted minutes never reach the model");
await assert.rejects(() => runtime.runMutation("minutes:upsertFromDraft", device.args), /Adopted minutes are frozen/, "the portable upsert refuses too");
await assert.rejects(() => draftMinutesOnDevice({ client: deviceClient, meeting: deviceMeeting, transcript: "  ", existingMinutes: null, chunkChars: 8000 }), /Add a transcript first/);

// ---- Hosted: the saved workspace provider is used (and policy-checked) -------
async function saveWorkspaceProvider(baseUrl: string) {
  const secretVaultItemId = await owner.mutation(api.secrets.create, {
    societyId: hosted.societyId,
    name: "Workspace AI key",
    service: "OpenAI-compatible",
    credentialType: "api_key",
    secretValue: "saved-workspace-key",
    custodianPersonName: "Owner",
  });
  await owner.mutation(api.aiSettings.upsert, {
    societyId: hosted.societyId,
    scope: "workspace",
    provider: "openai-compatible",
    label: "Workspace model",
    modelId: "mock-small",
    baseUrl,
    secretVaultItemId,
    validationStatus: "ok",
  });
}
await saveWorkspaceProvider("http://169.254.169.254/v1");
server.requests.length = 0;
await owner.action(api.minutes.generateDraft, { meetingId: hosted.secondMeetingId, transcript });
assert.equal(server.requests.at(-1)?.authorization, `Bearer ${ENV_KEY}`, "a saved metadata-host address is refused; the deployment endpoint is used");

process.env.SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT = "true";
const workspaceTest = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./meetings.js": () => import("../convex/meetings"),
  "./minutes.js": () => import("../convex/minutes"),
  "./aiSettings.js": () => import("../convex/aiSettings"),
  "./secrets.js": () => import("../convex/secrets"),
});
const ws = await workspaceTest.run(async (ctx) => {
  const id = await ctx.db.insert("societies", { name: "Workspace provider", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  await ctx.db.insert("users", { societyId: id, role: "Owner", status: "Active", email: "owner@example.test", displayName: "Owner", authSubject: "owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
  const meetingId = await ctx.db.insert("meetings", { societyId: id, title: TITLE, type: TYPE, scheduledAt: SCHEDULED, electronic: false, status: "Held", attendeeIds: [] });
  return { societyId: id, meetingId };
});
const wsOwner = workspaceTest.withIdentity({ subject: "owner", issuer });
const secretVaultItemId = await wsOwner.mutation(api.secrets.create, { societyId: ws.societyId, name: "Workspace AI key", service: "OpenAI-compatible", credentialType: "api_key", secretValue: "saved-workspace-key", custodianPersonName: "Owner" });
await wsOwner.mutation(api.aiSettings.upsert, { societyId: ws.societyId, scope: "workspace", provider: "openai-compatible", label: "Workspace model", modelId: "mock-small", baseUrl: server.baseUrl, secretVaultItemId, validationStatus: "ok" });
server.requests.length = 0;
await wsOwner.action(api.minutes.generateDraft, { meetingId: ws.meetingId, transcript });
assert.equal(server.requests.at(-1)?.authorization, "Bearer saved-workspace-key", "the saved workspace provider and key are used");
assert.equal(chatBodies().at(-1)?.model, "mock-small", "with the saved model");
assert.equal(chatBodies().at(-1)?.response_format?.type, "json_schema", "an OpenAI-compatible server starts at json_schema");
delete process.env.SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT;

await server.close();
console.log("Shared minutes drafting passed: hosted and on-device send the same prompt and store the same minutes, long transcripts are drafted in parts, adopted minutes are refused before the model, and hosted drafts use the saved workspace provider under the outbound URL policy.");
