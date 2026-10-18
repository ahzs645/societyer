import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createIdleUpdateState,
  updateCheckFailed,
  updateCheckStarted,
  updateCheckSucceeded,
  updateDownloadFailed,
  updateDownloadProgress,
  updateDownloadStarted,
  updateDownloadSucceeded,
} from "../electron/updateMachine";
import { DESKTOP_CSP_HEADER, desktopSecurityHeadersForContentType } from "../electron/csp";
import {
  DEFAULT_DESKTOP_LOCAL_AI_CONFIG,
  LOCAL_AI_PROXY_PATHS,
  LocalAiProxyError,
  proxyHeaders,
  proxyTargetUrl,
  runProxyRequest,
  runProxyStream,
  sanitizeLocalAiConfig,
  shouldForgetKey,
  SPEECH_PROXY_PATHS,
  speechProxyTargetUrl,
} from "../electron/localAiProxy";
import { transcribeUpload } from "../electron/localTranscription";
import { startMockOpenAiServer } from "./fixtures/mock-openai-server";
import {
  contentTypeFor,
  normalizeDesktopProtocolPathname,
  protocolPathFromUrl,
} from "../electron/protocolUtils";

const idle = createIdleUpdateState({
  channel: "stable",
  currentVersion: "1.0.0",
  feedPath: "/tmp/app-update.yml",
  reason: "Update feed configured with github.",
});

const checking = updateCheckStarted(idle);
assert.equal(checking.status, "checking");
assert.equal(checking.error, undefined);

const available = updateCheckSucceeded(checking, "1.1.0");
assert.equal(available.status, "available");
assert.equal(available.availableVersion, "1.1.0");

const downloading = updateDownloadStarted(available);
assert.equal(downloading.status, "downloading");
assert.equal(downloading.downloadPercent, 0);

const progressed = updateDownloadProgress(downloading, 44.6);
assert.equal(progressed.downloadPercent, 45);

const downloaded = updateDownloadSucceeded(progressed);
assert.equal(downloaded.status, "downloaded");
assert.equal(downloaded.downloadedVersion, "1.1.0");
assert.equal(downloaded.downloadPercent, 100);

const failedCheck = updateCheckFailed(idle, "network unavailable");
assert.equal(failedCheck.status, "error");
assert.equal(failedCheck.error, "network unavailable");

const failedDownload = updateDownloadFailed(available, "download failed");
assert.equal(failedDownload.status, "available");
assert.equal(failedDownload.downloadPercent, undefined);

assert.equal(normalizeDesktopProtocolPathname("/assets/index.js"), "assets/index.js");
assert.equal(normalizeDesktopProtocolPathname("/app/settings"), "app/settings");
assert.equal(normalizeDesktopProtocolPathname("/assets/../secrets"), null);
assert.equal(normalizeDesktopProtocolPathname("/assets/%2e%2e/secrets"), "assets/%2e%2e/secrets");

assert.equal(protocolPathFromUrl(new URL("societyer-app://index.html")), "/index.html");
assert.equal(protocolPathFromUrl(new URL("societyer-app://index.html/assets/app.js")), "/assets/app.js");
assert.equal(protocolPathFromUrl(new URL("./assets/app.js", "societyer-app://index.html")), "/assets/app.js");
assert.equal(protocolPathFromUrl(new URL("societyer-app://assets/app.js")), "/assets/app.js");
assert.equal(protocolPathFromUrl(new URL("societyer-app:///assets/app.js")), "/assets/app.js");

assert.equal(contentTypeFor("/dist/index.html"), "text/html");
assert.equal(contentTypeFor("/dist/assets/app.mjs"), "text/javascript");
assert.equal(contentTypeFor("/dist/assets/app.css"), "text/css");
assert.equal(contentTypeFor("/dist/assets/icon.webp"), "image/webp");
assert.equal(contentTypeFor("/dist/assets/data.json"), "application/json");
assert.equal(contentTypeFor("/dist/assets/intake-ocr/pdfjs/jbig2.wasm"), "application/wasm");
assert.doesNotMatch(DESKTOP_CSP_HEADER, /'unsafe-eval'/, "only WebAssembly compilation is allowed, never eval");

assert.match(DESKTOP_CSP_HEADER, /default-src 'self'/);
assert.match(DESKTOP_CSP_HEADER, /object-src 'none'/);
assert.match(DESKTOP_CSP_HEADER, /frame-ancestors 'none'/);
assert.deepEqual(desktopSecurityHeadersForContentType("text/css"), [
  ["content-type", "text/css"],
  ["x-content-type-options", "nosniff"],
]);
assert.equal(
  desktopSecurityHeadersForContentType("text/html").some(
    ([header]) => header === "content-security-policy",
  ),
  true,
);

// On-device AI proxy (electron/localAiProxy.ts + ipc/aiHandlers.ts): the main
// process supplies the base URL and key, forwards only allow-listed paths, and
// needs no CORS from the model server.
{
  const ollama = { kind: "ollama" as const, baseUrl: "http://127.0.0.1:11434/v1" };
  assert.equal(proxyTargetUrl(ollama, "/models"), "http://127.0.0.1:11434/v1/models");
  assert.equal(proxyTargetUrl(ollama, "/chat/completions"), "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(proxyTargetUrl(ollama, "/api/tags"), "http://127.0.0.1:11434/api/tags", "Ollama's tag list is at the server root");
  for (const path of ["/audio/transcriptions", "/inference"]) {
    assert.throws(() => proxyTargetUrl(ollama, path), /speech-to-text server/, `${path} never goes to the chat server`);
  }
  // Speech-to-text: only the path for the configured kind, on its own server.
  assert.deepEqual(SPEECH_PROXY_PATHS, ["/audio/transcriptions", "/inference"]);
  const speech = { kind: "openai-compatible" as const, baseUrl: "http://127.0.0.1:8000/v1", model: "" };
  assert.equal(speechProxyTargetUrl(speech, "/audio/transcriptions"), "http://127.0.0.1:8000/v1/audio/transcriptions");
  assert.equal(speechProxyTargetUrl({ ...speech, kind: "whisperx" }), "http://127.0.0.1:8000/v1/audio/transcriptions");
  assert.equal(speechProxyTargetUrl({ kind: "whisper-cpp", baseUrl: "http://127.0.0.1:8081/", model: "" }, "/inference"), "http://127.0.0.1:8081/inference");
  for (const path of ["/inference", "/models", "/chat/completions", "/audio/translations", "/../inference", ""]) {
    assert.throws(() => speechProxyTargetUrl(speech, path), LocalAiProxyError, `${path} is not a speech path for this server`);
  }
  assert.throws(() => speechProxyTargetUrl({ ...speech, kind: "none" }), /off/);
  assert.throws(() => speechProxyTargetUrl({ ...speech, baseUrl: "http://speech.example.com/v1" }), /https/, "a public speech server must use https");
  assert.throws(() => speechProxyTargetUrl({ ...speech, baseUrl: "http://user:pw@127.0.0.1:8000/v1" }), /credentials/);
  for (const path of ["/responses", "/v1/models", "/../models", "/models?x=1", "https://evil.test/models", ""]) {
    assert.throws(() => proxyTargetUrl(ollama, path), LocalAiProxyError, `${path} is not forwarded`);
  }
  assert.throws(() => proxyTargetUrl({ kind: "none", baseUrl: ollama.baseUrl }, "/models"), /off/);
  assert.throws(() => proxyTargetUrl({ kind: "openai-compatible", baseUrl: "http://llm.example.com/v1" }, "/models"), /https/, "a public server must use https");
  assert.equal(proxyTargetUrl({ kind: "openai-compatible", baseUrl: "http://192.168.1.20:8080/v1" }, "/models"), "http://192.168.1.20:8080/v1/models", "LAN servers are fine");
  assert.equal(proxyTargetUrl({ kind: "openai", baseUrl: "http://127.0.0.1:9/v1" }, "/models"), "https://api.openai.com/v1/models", "hosted kinds use their fixed address");
  assert.deepEqual(LOCAL_AI_PROXY_PATHS, ["/models", "/chat/completions", "/api/tags"]);
  assert.equal(proxyHeaders(null, false, false).authorization, undefined);
  assert.equal(proxyHeaders("main-only-key", true, true).authorization, "Bearer main-only-key");
  assert.equal(proxyHeaders("k", true, true).accept, "text/event-stream");
  assert.equal(shouldForgetKey("http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1/"), false);
  assert.equal(shouldForgetKey("http://127.0.0.1:11434/v1", "https://llm.example.com/v1"), true, "a key is bound to its server");
  assert.deepEqual(sanitizeLocalAiConfig({ kind: "bogus", baseUrl: 7 }).kind, "none");
  assert.equal(sanitizeLocalAiConfig({ kind: "openrouter", baseUrl: "http://evil.test" }).baseUrl, "https://openrouter.ai/api/v1");
  assert.deepEqual(sanitizeLocalAiConfig({}), { ...DEFAULT_DESKTOP_LOCAL_AI_CONFIG, kind: "none", preset: "ollama", baseUrl: "", model: "", updatedAtISO: undefined });

  // Against a model server that sends no CORS headers at all.
  const server = await startMockOpenAiServer({ cors: false });
  try {
    const base = { kind: "openai-compatible" as const, baseUrl: server.baseUrl };
    const listed = await runProxyRequest({ fetchImpl: fetch, url: proxyTargetUrl(base, "/models"), method: "GET", apiKey: "main-only-key", signal: new AbortController().signal });
    assert.equal(listed.status, 200);
    assert.match(listed.body, /mock-llm/);
    assert.equal(server.requests.at(-1)?.authorization, "Bearer main-only-key", "the key is added by the main process");
    const events: string[] = [];
    let text = "";
    await runProxyStream(
      { fetchImpl: fetch, url: proxyTargetUrl(base, "/chat/completions"), method: "POST", body: JSON.stringify({ model: "mock-llm", stream: true, messages: [{ role: "user", content: "Hi" }] }), apiKey: null, signal: new AbortController().signal },
      (event) => {
        events.push(event.type);
        if (event.type === "chunk") text += event.text;
      },
    );
    assert.equal(events[0], "head");
    assert.equal(events.at(-1), "end");
    assert.ok(events.filter((type) => type === "chunk").length >= 1);
    assert.match(text, /data: \[DONE\]/, "the SSE body is relayed unchanged");
    server.set({ stallMs: 2000 });
    const controller = new AbortController();
    const stalled: string[] = [];
    setTimeout(() => controller.abort(new LocalAiProxyError("aborted", "stopped")), 150);
    await runProxyStream(
      { fetchImpl: fetch, url: proxyTargetUrl(base, "/chat/completions"), method: "POST", body: JSON.stringify({ model: "mock-llm", stream: true, messages: [] }), apiKey: null, signal: controller.signal },
      (event) => stalled.push(event.type === "error" ? `error:${event.code}` : event.type),
    );
    assert.equal(stalled.at(-1), "error:aborted", "an abort ends the stream with an error event");
    // Transcription: the main process adds the speech key; replies and events never carry it.
    const dir = mkdtempSync(path.join(os.tmpdir(), "societyer-stt-arch-"));
    try {
      const file = path.join(dir, "recording.wav");
      writeFileSync(file, new Uint8Array(100_000));
      const events: unknown[] = [];
      const transcribed = await transcribeUpload({
        fetchImpl: fetch,
        speech: { kind: "openai-compatible", baseUrl: server.baseUrl, model: "mock-whisper" },
        apiKey: "main-only-speech-key",
        signal: new AbortController().signal,
        upload: { dir, file, fileName: "recording.wav", bytes: 100_000 },
        emit: (event) => events.push(event),
        ffmpeg: null,
      });
      assert.ok(transcribed.ok, "the speech path is proxied");
      assert.equal(server.requests.at(-1)?.path, "/v1/audio/transcriptions");
      assert.equal(server.requests.at(-1)?.authorization, "Bearer main-only-speech-key");
      assert.doesNotMatch(JSON.stringify({ transcribed, events }), /main-only-speech-key/, "the key never goes back to the renderer");
      const refused = await transcribeUpload({
        fetchImpl: fetch,
        speech: { kind: "openai-compatible", baseUrl: "http://speech.example.com/v1", model: "" },
        apiKey: "main-only-speech-key",
        signal: new AbortController().signal,
        upload: { dir, file, fileName: "recording.wav", bytes: 100_000 },
        emit: () => undefined,
        ffmpeg: null,
      });
      assert.ok(!refused.ok && refused.code === "refused", "a public http speech server is refused before any request");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const unreachable = await runProxyRequest({ fetchImpl: fetch, url: "http://127.0.0.1:9/v1/models", method: "GET", apiKey: null, signal: new AbortController().signal }).catch((error: unknown) => error);
    assert.ok(unreachable instanceof LocalAiProxyError && unreachable.code === "network");
  } finally {
    await server.close();
  }

  // Wiring: the renderer can never read the AI key, and every AI channel is sender-verified.
  const secretHandlers = readFileSync("electron/ipc/secretHandlers.ts", "utf8");
  assert.match(secretHandlers, /key === "ai-api-key"\) throw/, "getSecret refuses ai-api-key");
  assert.match(secretHandlers, /key === "stt-api-key"\) throw/, "getSecret refuses stt-api-key");
  const aiHandlers = readFileSync("electron/ipc/aiHandlers.ts", "utf8");
  assert.doesNotMatch(aiHandlers, /ipcMain\.handle\(/, "AI channels go through handleValidatedIpc (local renderer authority)");
  for (const channel of [
    "GET_LOCAL_AI_CONFIG_CHANNEL",
    "SAVE_LOCAL_AI_CONFIG_CHANNEL",
    "LOCAL_AI_REQUEST_CHANNEL",
    "LOCAL_AI_STREAM_CHANNEL",
    "LOCAL_AI_ABORT_CHANNEL",
    "LOCAL_AI_TRANSCRIPTION_UPLOAD_CHANNEL",
    "LOCAL_AI_TRANSCRIBE_CHANNEL",
  ]) {
    assert.match(aiHandlers, new RegExp(`channel: IpcChannels\\.${channel}`), `${channel} is registered with validation`);
  }
  assert.match(aiHandlers, /getDesktopSecret\("ai-api-key"\)/, "the key is read in the main process");
  assert.match(aiHandlers, /getDesktopSecret\("stt-api-key"\)/, "the speech-to-text key is read in the main process");
  assert.match(aiHandlers, /removeDesktopSecret\("stt-api-key"\)/, "the speech key is forgotten when its server changes");
  assert.match(aiHandlers, /payload: uploadInput/, "recording pieces are validated (size-bounded)");
  const preload = readFileSync("electron/preload.ts", "utf8");
  assert.doesNotMatch(preload, /ai-api-key|stt-api-key/, "the preload never names the AI keys");
  assert.match(readFileSync("electron/ipc.ts", "utf8"), /registerAiHandlers\(\)/);
}

// The desktop main-process build (desktop:build:main) runs tsc with
// tsconfig.electron.json, which is stricter than the renderer config
// (noImplicitAny) and must resolve the renderer's "@/" alias. A type error there
// stops desktop:build, desktop:smoke and desktop:package, so keep it at zero.
const electronTsconfig = JSON.parse(readFileSync("tsconfig.electron.json", "utf8"));
assert.deepEqual(electronTsconfig.compilerOptions.paths?.["@/*"], ["./src/*"], "tsconfig.electron.json must map the @/ alias");
if (process.env.SOCIETYER_SKIP_DESKTOP_TYPECHECK !== "1") {
  const typecheck = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.electron.json", "--noEmit"], {
    encoding: "utf8",
  });
  assert.equal(typecheck.status, 0, `desktop:typecheck failed:\n${typecheck.stdout}${typecheck.stderr}`);
}

console.log("Electron architecture checks passed.");
