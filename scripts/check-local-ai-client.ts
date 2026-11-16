/**
 * The on-device AI client against a mock OpenAI-compatible server:
 * model listing (/v1/models and Ollama's /api/tags), the JSON-mode fallback
 * chain (json_schema -> json_object -> plain) with fence stripping, streaming,
 * stall timeouts, abort, optional keys for loopback servers, generic error
 * messages (provider bodies never surface), the AI SDK fetch adapter, and the
 * device settings parser / legacy migration, and Claude Code / Codex through a
 * fake desktop bridge: settings that never keep a CLI kind in the browser, the
 * CLI status in Test connection, the probe short-circuit, and tool calls the
 * CLI makes mid-stream (answered through localAiToolResult, handler failures,
 * abort mid-tool, the stall timer held while a tool runs).
 */
import assert from "node:assert/strict";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { startMockOpenAiServer, PROVIDER_SECRET_MARKER } from "./fixtures/mock-openai-server";
import { createDeviceAiClient, resetAcceptedJsonModes } from "../src/lib/localAi/client";
import { BROWSER_CORS_HINT, BROWSER_UNREACHABLE_HINT, DEVICE_AI_SDK_BASE_URL, DeviceAiError, deviceAiSdkFetch, desktopTransport, directTransport, invokeMessage, type DesktopAiBridge, type DeviceAiTransport } from "../src/lib/localAi/transport";
import { deviceAiKeyRequired, deviceAiLeavesComputer, deviceAiModelLabel, deviceAiUrl, devicePresetsFor, effectiveBaseUrl, isCliKind, modelListPaths } from "../src/lib/localAi/models";
import { DEFAULT_DEVICE_AI_CONFIG, deviceAiReadiness, migrateLegacyIntakePrefs, parseDeviceAiConfig } from "../src/lib/localAi/config";
import type { DesktopLocalAiCliStatus, DesktopLocalAiStreamEvent, DesktopLocalAiToolResult } from "../src/lib/desktopBridge";
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

/** What the fake CLI can do while it answers one streamed request. */
type FakeCli = {
  say(text: string): void;
  call(name: string, args: unknown): Promise<DesktopLocalAiToolResult>;
  wait(ms: number): Promise<void>;
};

class FakeAbort extends Error {}

/**
 * A desktop bridge that behaves like the main process with a CLI kind: SSE
 * text chunks, `tool_call` events that wait for `localAiToolResult`, abort.
 */
function fakeCliBridge(run: (cli: FakeCli) => Promise<void>, status?: Partial<DesktopLocalAiCliStatus>) {
  const pending = new Map<string, (result: DesktopLocalAiToolResult) => void>();
  const stops = new Map<string, () => void>();
  const results: DesktopLocalAiToolResult[] = [];
  const aborts: string[] = [];
  const events: DesktopLocalAiStreamEvent["type"][] = [];
  const requests: string[] = [];
  const bridge: DesktopAiBridge & { localAiCliStatus(kind: "claude-cli" | "codex-cli"): Promise<DesktopLocalAiCliStatus> } = {
    async localAiRequest(input) {
      requests.push(input.path);
      if (input.path === "/models") return { status: 200, ok: true, contentType: "application/json", body: JSON.stringify({ data: [{ id: "sonnet" }, { id: "opus" }, { id: "haiku" }] }) };
      return { status: 200, ok: true, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }) };
    },
    async localAiStream(input, onEvent) {
      requests.push(input.path);
      const emit = (event: DesktopLocalAiStreamEvent) => {
        events.push(event.type);
        onEvent(event);
      };
      let stopped = false;
      const stop = new Promise<"stopped">((resolve) => stops.set(input.requestId, () => {
        stopped = true;
        resolve("stopped");
      }));
      let calls = 0;
      const cli: FakeCli = {
        say(text) {
          if (stopped) throw new FakeAbort();
          emit({ type: "chunk", text: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n` });
        },
        async call(name, args) {
          if (stopped) throw new FakeAbort();
          calls += 1;
          const callId = `toolu_${calls}`;
          const answer = new Promise<DesktopLocalAiToolResult>((resolve) => pending.set(`${input.requestId}:${callId}`, resolve));
          emit({ type: "tool_call", callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
          const outcome = await Promise.race([answer, stop]);
          if (outcome === "stopped") throw new FakeAbort();
          return outcome;
        },
        async wait(ms) {
          const outcome = await Promise.race([new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), ms)), stop]);
          if (outcome === "stopped") throw new FakeAbort();
        },
      };
      emit({ type: "head", status: 200, ok: true, contentType: "text/event-stream" });
      try {
        await run(cli);
        emit({ type: "chunk", text: "data: [DONE]\n\n" });
        emit({ type: "end" });
      } catch (error) {
        emit({ type: "error", code: error instanceof FakeAbort ? "aborted" : "network", message: error instanceof FakeAbort ? "The AI request was stopped." : "The CLI failed." });
      }
    },
    async localAiAbort(requestId) {
      aborts.push(requestId);
      stops.get(requestId)?.();
    },
    async localAiToolResult(input) {
      results.push(input);
      pending.get(`${input.requestId}:${input.callId}`)?.(input);
    },
    async localAiCliStatus(kind) {
      return { kind, found: true, binaryPath: "/usr/local/bin/claude", version: "2.1.0", signedIn: true, account: "Claude Max · person@example.com", message: "Claude Code is ready.", ...status };
    },
  };
  return { bridge, results, aborts, events, requests };
}

function cliClient(bridge: ReturnType<typeof fakeCliBridge>["bridge"], options: { stallTimeoutMs?: number; transport?: DeviceAiTransport } = {}) {
  return createDeviceAiClient({
    transport: options.transport ?? desktopTransport(bridge),
    kind: "claude-cli",
    model: "",
    serverKey: "claude-cli",
    stallTimeoutMs: options.stallTimeoutMs,
    cliStatus: (kind) => bridge.localAiCliStatus(kind),
  });
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
  assert.equal(unreachable.message, "Nothing answered at 127.0.0.1:9.", "a closed port is nothing listening, not CORS");
  assert.equal(unreachable.hint, BROWSER_UNREACHABLE_HINT);
  assert.match(BROWSER_CORS_HINT, /OLLAMA_ORIGINS/);
  assert.match(BROWSER_CORS_HINT, /LM Studio/);

  // A browser failure is told apart with one no-cors request to the same address:
  // an (opaque) answer means a server is up but blocks this page; another network
  // error means nothing is listening; a probe that hangs keeps the general hint.
  const probeCases = [
    { label: "CORS-blocked", probe: async () => new Response(null), message: /^127\.0\.0\.1:11973 is running but doesn't allow requests from this page\.$/, hint: /OLLAMA_ORIGINS/ },
    { label: "nothing listening", probe: async () => Promise.reject(new TypeError("Failed to fetch")), message: /^Nothing answered at 127\.0\.0\.1:11973\.$/, hint: /^(?!.*OLLAMA_ORIGINS).*running/ },
    { label: "probe hangs", probe: () => new Promise<Response>(() => undefined), message: /^Could not reach 127\.0\.0\.1:11973\.$/, hint: /^If the server is running, it must allow requests from this page\./ },
  ];
  for (const { label, probe, message, hint } of probeCases) {
    const sent: RequestInit[] = [];
    const browserFetch: typeof fetch = (_input, init) => {
      sent.push(init ?? {});
      return init?.mode === "no-cors" ? probe() : Promise.reject(new TypeError("Failed to fetch"));
    };
    const browser = createDeviceAiClient({
      transport: directTransport(() => ({ baseUrl: "http://127.0.0.1:11973/v1", apiKey: "secret-key" }), browserFetch),
      kind: "ollama",
      model: "mock-llm",
    });
    const started = Date.now();
    const outcome = await browser.testConnection();
    assert.ok(!outcome.ok, `${label}: fails`);
    assert.match(outcome.message, message, `${label}: message`);
    assert.match(outcome.hint ?? "", hint, `${label}: hint`);
    const probes = sent.filter((init) => init.mode === "no-cors");
    assert.equal(probes.length, 1, `${label}: one probe, no retries (Ollama's /api/tags isn't tried after a network error)`);
    assert.deepEqual([probes[0].method, probes[0].credentials, probes[0].body, probes[0].headers], ["GET", "omit", undefined, undefined], `${label}: the probe is a bare GET: no key, cookies or body`);
    assert.equal(probes[0].redirect, undefined, `${label}: no-cors must follow redirects (any other mode is a network error in browsers)`);
    assert.ok(Date.now() - started < 10_000, `${label}: bounded`);
  }

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

  // 10. Claude Code and Codex: kinds, presets and settings. Desktop app only.
  assert.ok(isCliKind("claude-cli") && isCliKind("codex-cli") && !isCliKind("openai"));
  assert.equal(effectiveBaseUrl("claude-cli", "http://127.0.0.1:11434/v1"), "", "a CLI has no address");
  assert.equal(deviceAiKeyRequired("codex-cli", ""), false, "a CLI needs no key");
  assert.deepEqual(modelListPaths("claude-cli"), ["/models"]);
  assert.equal(deviceAiLeavesComputer("claude-cli", ""), true, "a CLI sends data to Anthropic / OpenAI");
  assert.equal(deviceAiLeavesComputer("ollama", "http://127.0.0.1:11434/v1"), false);
  assert.equal(deviceAiModelLabel("claude-cli", ""), "Claude Code's default model");
  assert.equal(deviceAiModelLabel("codex-cli", "gpt-5"), "gpt-5 (Codex)");
  assert.ok(!devicePresetsFor(false).some((entry) => isCliKind(entry.kind)), "the browser never offers a CLI");
  assert.deepEqual(devicePresetsFor(true).filter((entry) => entry.desktopOnly).map((entry) => entry.preset), ["claude-cli", "codex-cli"]);

  const cliRaw = { kind: "claude-cli", preset: "claude-cli", baseUrl: "http://127.0.0.1:11434/v1", model: "sonnet", cli: { claudePath: " /opt/homebrew/bin/claude ", codexPath: "bin/codex" } };
  const browserCli = parseDeviceAiConfig(cliRaw);
  assert.equal(browserCli.kind, "none", "the browser runtime turns a CLI kind off");
  assert.equal(browserCli.preset, "ollama", "and doesn't keep its preset");
  assert.equal(parseDeviceAiConfig({ kind: "none", preset: "codex-cli" }).preset, "ollama", "not even a remembered CLI preset");
  const desktopCli = parseDeviceAiConfig(cliRaw, { desktop: true });
  assert.deepEqual([desktopCli.kind, desktopCli.preset, desktopCli.baseUrl], ["claude-cli", "claude-cli", ""], "the desktop app keeps it, with no address");
  assert.deepEqual(desktopCli.cli, { claudePath: "/opt/homebrew/bin/claude", codexPath: "" }, "paths are absolute or dropped");
  assert.equal(parseDeviceAiConfig({ kind: "codex-cli", preset: "ollama" }, { desktop: true }).preset, "codex-cli", "a CLI kind shows its own preset");
  assert.equal(parseDeviceAiConfig({ kind: "ollama", preset: "claude-cli" }, { desktop: true }).preset, "ollama", "a CLI preset needs its own kind");
  assert.equal(parseDeviceAiConfig({ kind: "none", preset: "claude-cli" }, { desktop: true }).preset, "claude-cli", "turned off, the desktop app remembers the choice");
  const paths = (claudePath: unknown) => parseDeviceAiConfig({ cli: { claudePath } }, { desktop: true }).cli.claudePath;
  assert.equal(paths(`/${"a".repeat(1000)}`), "", "over 1000 characters is dropped, not cut");
  assert.equal(paths(`/${"a".repeat(999)}`).length, 1000);
  assert.equal(paths("C:\\Users\\me\\codex.exe"), "C:\\Users\\me\\codex.exe", "a Windows path");
  assert.equal(paths("/usr/bin/claude\n--yolo"), "", "control characters are dropped");
  assert.equal(paths(42), "");
  assert.deepEqual(DEFAULT_DEVICE_AI_CONFIG.cli, { claudePath: "", codexPath: "" });

  const cliState = { config: desktopCli, keyStored: false, speechKeyStored: false, loaded: true };
  assert.deepEqual(deviceAiReadiness(cliState), { ready: false, reason: "Claude Code and Codex work only in the desktop app." }, "no desktop bridge, not ready");
  const ready = fakeCliBridge(async (cli) => cli.say("ok"));
  Object.defineProperty(globalThis, "window", { value: { societyerDesktop: ready.bridge }, configurable: true });
  try {
    assert.deepEqual(deviceAiReadiness({ ...cliState, config: { ...desktopCli, model: "" } }), { ready: true }, "no address, key or model needed");
    assert.equal(parseDeviceAiConfig(cliRaw).kind, "claude-cli", "the desktop bridge is detected");
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }

  // 11. Test connection shows the CLI's status; the tool probe isn't sent.
  const found = fakeCliBridge(async (cli) => cli.say("ok"));
  const connected = await cliClient(found.bridge).testConnection();
  assert.ok(connected.ok, "a found, signed-in CLI connects");
  assert.deepEqual(connected.ok && connected.models, ["sonnet", "opus", "haiku"]);
  assert.equal(connected.cli?.account, "Claude Max · person@example.com");
  assert.equal(connected.cli?.version, "2.1.0");
  const signedOut = fakeCliBridge(async (cli) => cli.say("ok"), { signedIn: false, account: undefined, message: "Claude Code isn't signed in.", hint: "Run `claude auth login` in Terminal." });
  const notReady = await cliClient(signedOut.bridge).testConnection();
  assert.deepEqual(!notReady.ok && [notReady.message, notReady.hint], ["Claude Code isn't signed in.", "Run `claude auth login` in Terminal."]);
  assert.deepEqual(signedOut.requests, [], "a signed-out CLI isn't asked for models");
  const missing = fakeCliBridge(async (cli) => cli.say("ok"), { found: false, signedIn: null, message: "Claude Code wasn't found on this computer." });
  const absent = await cliClient(missing.bridge).testConnection();
  assert.equal(!absent.ok && absent.cli?.found, false);
  const noBridge = await createDeviceAiClient({ transport: desktopTransport(found.bridge), kind: "codex-cli", model: "" }).testConnection();
  assert.deepEqual(!noBridge.ok && noBridge.message, "Claude Code and Codex work only in the desktop app.");

  const unused: DeviceAiTransport = { kind: "desktop", send: () => Promise.reject(new Error("the probe must not send a request")) };
  const cliProbe = cliClient(found.bridge, { transport: unused });
  assert.equal(cliProbe.hostsToolLoop, true);
  assert.deepEqual(await cliProbe.probeToolCalling(), { outcome: "supported" }, "a CLI always takes tools: no probe request");
  assert.equal(client().hostsToolLoop, false, "a model server doesn't host the loop");

  // 12. Tool calls mid-stream go back through localAiToolResult.
  const tool = { type: "function" as const, function: { name: "list_meetings", description: "Meetings", parameters: { type: "object", properties: {} } } };
  const said: string[] = [];
  const ordered = fakeCliBridge(async (cli) => {
    cli.say("Let me look. ");
    const result = await cli.call("list_meetings", { limit: 2 });
    cli.say(`Found ${JSON.parse(result.content).total} meetings.`);
  });
  const step = await cliClient(ordered.bridge).chatStep({
    messages: [{ role: "user", content: "Meetings?" }],
    tools: [tool],
    onToken: (token) => said.push(token),
    onToolCall: async (call) => {
      assert.deepEqual(said, ["Let me look. "], "the preamble is read before the tool runs");
      assert.deepEqual([call.callId, call.name, JSON.parse(call.arguments)], ["toolu_1", "list_meetings", { limit: 2 }]);
      return { content: JSON.stringify({ total: 3 }) };
    },
  });
  assert.equal(step.text, "Let me look. Found 3 meetings.");
  assert.deepEqual(step.toolCalls, [], "the SSE never carries tool_calls");
  assert.equal(ordered.results.length, 1);
  assert.deepEqual([ordered.results[0].callId, ordered.results[0].content, ordered.results[0].isError], ["toolu_1", '{"total":3}', undefined]);

  const noHandler = fakeCliBridge(async (cli) => {
    const result = await cli.call("list_meetings", {});
    cli.say(result.isError ? "no tools" : "tools");
  });
  assert.equal((await cliClient(noHandler.bridge).streamChat({ messages: [{ role: "user", content: "Hi" }] })), "no tools", "a call with no handler is answered with an error");
  assert.equal(JSON.parse(noHandler.results[0].content).error.code, "not_available");

  const throwing = fakeCliBridge(async (cli) => {
    const result = await cli.call("list_meetings", {});
    cli.say(JSON.parse(result.content).error.message);
  });
  const thrown = await cliClient(throwing.bridge).chatStep({ messages: [{ role: "user", content: "Hi" }], tools: [tool], onToolCall: () => Promise.reject(new Error("disk on fire")) });
  assert.equal(thrown.text, "disk on fire", "a failing handler still answers, as an error");
  assert.equal(throwing.results[0].isError, true);

  // A slow tool produces no chunks; the stall timer waits for it, then runs again.
  const slow = fakeCliBridge(async (cli) => {
    await cli.call("list_meetings", {});
    cli.say("done");
  });
  const slowStep = await cliClient(slow.bridge, { stallTimeoutMs: 150 }).chatStep({
    messages: [{ role: "user", content: "Hi" }],
    tools: [tool],
    onToolCall: () => new Promise((resolve) => setTimeout(() => resolve({ content: "{}" }), 500)),
  });
  assert.equal(slowStep.text, "done", "a tool slower than the stall timeout doesn't time the stream out");
  const stalled = fakeCliBridge(async (cli) => {
    await cli.call("list_meetings", {});
    await cli.wait(600);
    cli.say("too late");
  });
  await rejectsWith(cliClient(stalled.bridge, { stallTimeoutMs: 150 }).chatStep({ messages: [{ role: "user", content: "Hi" }], tools: [tool], onToolCall: async () => ({ content: "{}" }) }), "timeout", "silence after the tool still times out");
  assert.equal(stalled.aborts.length, 1, "the main process is told to stop");

  // Stop while a tool runs: the request is aborted and nothing is answered.
  const stopping = new AbortController();
  const midTool = fakeCliBridge(async (cli) => {
    await cli.call("list_meetings", {});
    cli.say("never");
  });
  await rejectsWith(cliClient(midTool.bridge).chatStep({
    messages: [{ role: "user", content: "Hi" }],
    tools: [tool],
    signal: stopping.signal,
    onToolCall: () => new Promise((_resolve, reject) => {
      stopping.abort();
      reject(new DeviceAiError("aborted", "The AI request was stopped."));
    }),
  }), "aborted", "stop mid-tool");
  assert.equal(midTool.aborts.length, 1, "localAiAbort ends the CLI's request");
  assert.deepEqual(midTool.results, [], "no result is sent for a stopped tool");

  // The main process can't take a result: the request ends instead of waiting.
  const refusing = fakeCliBridge(async (cli) => {
    await cli.call("list_meetings", {});
    cli.say("never");
  });
  refusing.bridge.localAiToolResult = () => Promise.reject(new Error("Error invoking remote method 'local-ai:tool-result': Error: No such request."));
  await rejectsWith(cliClient(refusing.bridge).chatStep({ messages: [{ role: "user", content: "Hi" }], tools: [tool], onToolCall: async () => ({ content: "{}" }) }), "network", "a refused result ends the stream");
  assert.equal(refusing.aborts.length, 1);

  // Electron rejects an invoke with the error's toString: the channel and the class name go.
  const invoked = (text: string) => invokeMessage(new Error(text), "fallback");
  assert.equal(invoked("Error invoking remote method 'local-ai:cli-status': LocalAiProxyError: Claude Code isn't signed in."), "Claude Code isn't signed in.");
  assert.equal(invoked("Error invoking remote method 'local-ai:request': Error: No such request."), "No such request.");
  assert.equal(invoked("Error invoking remote method 'local-ai:request': TypeError: bad input"), "bad input");
  assert.equal(invoked("Error invoking remote method 'local-ai:request': Claude Code timed out."), "Claude Code timed out.", "a plain reason is kept");
  assert.equal(invoked("Error invoking remote method 'local-ai:request': "), "fallback");
  const cliError = fakeCliBridge(async (cli) => cli.say("ok"));
  cliError.bridge.localAiCliStatus = () => Promise.reject(new Error("Error invoking remote method 'local-ai:cli-status': LocalAiProxyError: Codex isn't installed."));
  const statusFailure = await cliClient(cliError.bridge).testConnection();
  assert.deepEqual(!statusFailure.ok && statusFailure.message, "Codex isn't installed.", "Test connection shows the main process's reason, not its class");
} finally {
  await server.close();
}

console.log("Local AI client passed: model lists (incl. /api/tags), json_schema -> json_object -> plain with fence stripping, streaming, stall/abort, optional loopback keys, generic errors, browser failures told apart (CORS-blocked vs nothing listening), SDK transport, settings parsing and migration, Claude Code / Codex settings, status, probe short-circuit and mid-stream tool calls.");
