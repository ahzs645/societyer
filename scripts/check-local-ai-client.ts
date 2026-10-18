/**
 * The on-device AI client against a mock OpenAI-compatible server:
 * model listing (/v1/models and Ollama's /api/tags), the JSON-mode fallback
 * chain (json_schema -> json_object -> plain) with fence stripping, streaming,
 * stall timeouts, abort, optional keys for loopback servers, generic error
 * messages (provider bodies never surface), the AI SDK fetch adapter, and the
 * device settings parser / legacy migration.
 */
import assert from "node:assert/strict";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { startMockOpenAiServer, PROVIDER_SECRET_MARKER } from "./fixtures/mock-openai-server";
import { createDeviceAiClient, resetAcceptedJsonModes } from "../src/lib/localAi/client";
import { BROWSER_CORS_HINT, DEVICE_AI_SDK_BASE_URL, DeviceAiError, deviceAiSdkFetch, directTransport } from "../src/lib/localAi/transport";
import { deviceAiKeyRequired, deviceAiUrl } from "../src/lib/localAi/models";
import { DEFAULT_DEVICE_AI_CONFIG, deviceAiReadiness, migrateLegacyIntakePrefs, parseDeviceAiConfig } from "../src/lib/localAi/config";
import { buildMinutesDraftMessages, heuristicMinutesDraft, MINUTES_DRAFT_JSON_SCHEMA, parseMinutesDraft } from "../shared/ai/minutesDraft";
import { checkDeviceAiBaseUrl } from "../shared/ai/endpointPolicy";
import { buildLocalAssistantMessages, LOCAL_ASSISTANT_HISTORY_LIMIT } from "../shared/ai/localAssistantPrompt";

const server = await startMockOpenAiServer();
type Body = { response_format?: { type?: string }; stream?: boolean; messages?: Array<{ role: string; content: string }> };
const bodies = () => server.requests.filter((request) => request.path === "/v1/chat/completions").map((request) => request.body as Body);

function client(options: { kind?: "ollama" | "lmstudio" | "openai-compatible"; apiKey?: string; requestTimeoutMs?: number; stallTimeoutMs?: number; baseUrl?: string } = {}) {
  const baseUrl = options.baseUrl ?? server.baseUrl;
  return createDeviceAiClient({
    transport: directTransport(() => ({ baseUrl, apiKey: options.apiKey ?? "" })),
    kind: options.kind ?? "openai-compatible",
    model: "mock-llm",
    serverKey: baseUrl,
    requestTimeoutMs: options.requestTimeoutMs,
    stallTimeoutMs: options.stallTimeoutMs,
  });
}

async function rejectsWith(promise: Promise<unknown>, code: DeviceAiError["code"], label: string) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DeviceAiError, `${label}: a DeviceAiError, got ${String(error)}`);
    assert.equal(error.code, code, `${label}: ${error.message}`);
    assert.doesNotMatch(error.message, new RegExp(PROVIDER_SECRET_MARKER), `${label}: provider bodies are never echoed`);
    return error;
  }
  assert.fail(`${label}: expected a rejection`);
}

const meeting = { meetingTitle: "Board meeting", meetingType: "Board" };
const transcript = "Jane Doe: I call the meeting to order.\nJohn Roe: I move to approve the budget.\nJane Doe: Carried.";
const messages = buildMinutesDraftMessages({ ...meeting, transcript });

try {
  // 1. Model lists: /v1/models, and Ollama's /api/tags when /v1/models is missing.
  assert.deepEqual(await client().listModels(), ["mock-llm", "mock-small"]);
  server.set({ modelsNotFound: true });
  assert.deepEqual(await client({ kind: "ollama" }).listModels(), ["mock-llm:latest"], "Ollama falls back to /api/tags");
  await rejectsWith(client({ kind: "lmstudio" }).listModels(), "status", "non-Ollama servers do not try /api/tags");
  server.reset();
  assert.equal(deviceAiUrl("http://127.0.0.1:11434/v1", "/api/tags"), "http://127.0.0.1:11434/api/tags", "/api/tags is at the server root");

  const ok = await client().testConnection();
  assert.ok(ok.ok && ok.models.length === 2 && ok.latencyMs >= 0, "Test connection reports models and latency");
  const unreachable = await client({ baseUrl: "http://127.0.0.1:9/v1" }).testConnection();
  assert.ok(!unreachable.ok, "a closed port fails");
  assert.match(unreachable.message, /Could not reach 127\.0\.0\.1:9/);
  assert.equal(unreachable.hint, BROWSER_CORS_HINT, "a browser network failure carries the CORS hint (OLLAMA_ORIGINS / LM Studio CORS)");
  assert.match(BROWSER_CORS_HINT, /OLLAMA_ORIGINS/);
  assert.match(BROWSER_CORS_HINT, /LM Studio/);

  // 2. JSON modes: json_schema first; walk down only when the server rejects the format.
  resetAcceptedJsonModes();
  let reply = await client().completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA });
  assert.equal(reply.jsonMode, "json_schema");
  assert.equal(bodies().at(-1)?.response_format?.type, "json_schema");
  assert.deepEqual(bodies().at(-1)?.messages, messages, "the shared prompt is sent unchanged");

  server.reset();
  resetAcceptedJsonModes();
  server.set({ rejectJsonSchema: true });
  reply = await client().completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA });
  assert.equal(reply.jsonMode, "json_object", "llama.cpp-style servers fall back to json_object");
  assert.deepEqual(bodies().map((body) => body.response_format?.type), ["json_schema", "json_object"]);
  server.requests.length = 0;
  reply = await client().completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA });
  assert.deepEqual(bodies().map((body) => body.response_format?.type), ["json_object"], "the accepted mode is remembered per server and model");

  server.reset();
  resetAcceptedJsonModes();
  server.set({ rejectJsonSchema: true, rejectJsonObject: true, fenced: true });
  reply = await client().completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA });
  assert.equal(reply.jsonMode, "none", "servers with no JSON mode get a plain request");
  assert.equal(bodies().at(-1)?.response_format, undefined);
  assert.match(reply.text, /```json/, "the mock fenced its JSON");
  const parsed = parseMinutesDraft(reply.text, heuristicMinutesDraft({ ...meeting, transcript }));
  assert.equal(parsed.motions[0]?.text, "Approve the budget", "fenced JSON (with prose around it) is parsed");
  assert.deepEqual(parsed.attendees, ["Jane Doe", "John Roe"]);
  const fallback = heuristicMinutesDraft({ ...meeting, transcript });
  assert.deepEqual(parseMinutesDraft("not json at all", fallback), fallback, "an unreadable reply yields the rule-based draft");

  // LM Studio: json_object rejected, json_schema accepted.
  server.reset();
  resetAcceptedJsonModes();
  server.set({ rejectJsonObject: true });
  reply = await client({ kind: "lmstudio" }).completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA });
  assert.equal(reply.jsonMode, "json_schema");

  // 3. Failures map to plain messages; bodies with internal detail never surface.
  server.reset();
  resetAcceptedJsonModes();
  server.set({ fail500: true });
  const failure = await rejectsWith(client().completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA }), "status", "500");
  assert.equal(failure.status, 500);
  assert.match(failure.message, /internal error/i);
  await rejectsWith(client().streamChat({ messages }), "status", "500 on a stream");

  // 4. Keys: optional for loopback, sent when set, required by hosted services.
  server.reset();
  server.set({ requireKey: "local-secret" });
  await rejectsWith(client().listModels(), "status", "missing key");
  assert.deepEqual(await client({ apiKey: "local-secret" }).listModels(), ["mock-llm", "mock-small"]);
  assert.equal(server.requests.at(-1)?.authorization, "Bearer local-secret");
  server.reset();
  await client().listModels();
  assert.equal(server.requests.at(-1)?.authorization, undefined, "no key, no Authorization header");
  assert.equal(deviceAiKeyRequired("ollama", "http://127.0.0.1:11434/v1"), false);
  assert.equal(deviceAiKeyRequired("lmstudio", "http://localhost:1234/v1"), false);
  assert.equal(deviceAiKeyRequired("openai-compatible", "http://192.168.1.20:8080/v1"), false, "a LAN server usually has no key");
  assert.equal(deviceAiKeyRequired("openai-compatible", "https://llm.example.com/v1"), true);
  assert.equal(deviceAiKeyRequired("openai", "https://api.openai.com/v1"), true);
  assert.equal(deviceAiKeyRequired("openrouter", ""), true);

  // 5. Streaming: tokens arrive in pieces and add up to the reply.
  server.reset();
  const tokens: string[] = [];
  const streamed = await client().streamChat({ messages: [{ role: "user", content: "Hi" }], onToken: (token) => tokens.push(token) });
  assert.equal(streamed, server.faults.chatReply);
  assert.ok(tokens.length > 3, "the reply streamed in several pieces");
  assert.equal(tokens.join(""), streamed);
  assert.equal(bodies().at(-1)?.stream, true);

  // 6. Stalls and aborts.
  server.set({ stallMs: 1500 });
  await rejectsWith(client({ requestTimeoutMs: 300 }).completeJson({ messages, jsonSchema: MINUTES_DRAFT_JSON_SCHEMA }), "timeout", "a stalled reply times out");
  await rejectsWith(client({ stallTimeoutMs: 300 }).streamChat({ messages: [{ role: "user", content: "Hi" }] }), "timeout", "a stalled stream times out");
  const controller = new AbortController();
  const aborted = client().streamChat({ messages: [{ role: "user", content: "Hi" }], signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await rejectsWith(aborted, "aborted", "abort stops a stream");
  server.reset();

  // 7. The AI SDK (intake, Ask AI) goes through the same transport.
  const transport = directTransport(() => ({ baseUrl: server.baseUrl, apiKey: "" }));
  const provider = createOpenAI({ apiKey: "on-device", baseURL: DEVICE_AI_SDK_BASE_URL, fetch: deviceAiSdkFetch(transport) });
  const sdk = await generateText({ model: provider.chat("mock-llm"), prompt: "Hello" });
  assert.equal(sdk.text, server.faults.chatReply, "the SDK reached the mock through the device transport");
  assert.equal(server.requests.at(-1)?.authorization, undefined, "the SDK's placeholder key is not forwarded");
  await assert.rejects(() => generateText({ model: provider.responses("mock-llm"), prompt: "Hello", maxRetries: 0 }), /not allowed/, "paths outside the allow-list are refused");

  // 8. Device settings: parsing, readiness, and the conservative legacy migration.
  const parsed1 = parseDeviceAiConfig({ kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1/", model: " llama3.1:8b ", minutesChunkChars: 10, features: { minutes: false } });
  assert.equal(parsed1.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(parsed1.model, "llama3.1:8b");
  assert.equal(parsed1.minutesChunkChars, 1000, "chunk size is clamped");
  assert.deepEqual(parsed1.features, { minutes: false, assistant: true, intake: true });
  assert.equal(parseDeviceAiConfig({ kind: "openai", baseUrl: "http://evil.test/v1" }).baseUrl, "https://api.openai.com/v1", "hosted kinds ignore a typed address");
  assert.equal(parseDeviceAiConfig({ kind: "bogus" }).kind, "none");
  assert.deepEqual(deviceAiReadiness({ config: DEFAULT_DEVICE_AI_CONFIG, keyStored: false, speechKeyStored: false, loaded: true }), { ready: false, reason: "On-device AI is off." });
  assert.deepEqual(deviceAiReadiness({ config: parsed1, keyStored: false, speechKeyStored: false, loaded: true }, "assistant"), { ready: true }, "Ollama on loopback needs no key");
  assert.equal(deviceAiReadiness({ config: parsed1, keyStored: false, speechKeyStored: false, loaded: true }, "minutes").ready, false, "a feature can be switched off");
  assert.equal(deviceAiReadiness({ config: parseDeviceAiConfig({ kind: "openai", model: "gpt-4.1-mini" }), keyStored: false, speechKeyStored: false, loaded: true }).ready, false, "OpenAI needs a key");
  assert.equal(migrateLegacyIntakePrefs({ enabled: false, provider: "openai" }), null, "disabled legacy prefs are not migrated");
  const migrated = migrateLegacyIntakePrefs({ enabled: true, provider: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", modelId: "qwen" });
  assert.equal(migrated?.kind, "openai-compatible");
  assert.equal(migrated?.model, "qwen");
  assert.deepEqual(migrated?.features, { minutes: false, assistant: false, intake: true }, "only intake was opted into");
  assert.ok(checkDeviceAiBaseUrl("http://127.0.0.1:11434/v1").ok);
  assert.ok(checkDeviceAiBaseUrl("http://10.0.0.7:8080/v1").ok);
  assert.ok(!checkDeviceAiBaseUrl("http://llm.example.com/v1").ok, "public servers need https");
  assert.ok(!checkDeviceAiBaseUrl("http://user:pw@127.0.0.1/v1").ok);

  // 9. The local assistant prompt: no tools, bounded history.
  const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `turn ${index}` }));
  const chat = buildLocalAssistantMessages({ today: "2026-10-17", organizationName: "Riverside Society", pageLabel: "Meetings" }, [...history, { role: "tool", content: "x" }, { role: "user", content: " " }]);
  assert.equal(chat[0].role, "system");
  assert.match(chat[0].content, /cannot see or change any records/);
  assert.match(chat[0].content, /Riverside Society/);
  assert.equal(chat.length, LOCAL_ASSISTANT_HISTORY_LIMIT + 1);
  assert.equal(chat.at(-1)?.content, "turn 29");
} finally {
  await server.close();
}

console.log("Local AI client passed: model lists (incl. /api/tags), json_schema -> json_object -> plain with fence stripping, streaming, stall/abort, optional loopback keys, generic errors, SDK transport, settings parsing and migration.");
