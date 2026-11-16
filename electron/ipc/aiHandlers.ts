import { app, type WebContents } from "electron";
import { z } from "zod";

import * as IpcChannels from "../ipcChannels.js";
import { handleValidatedIpc } from "../ipcValidation.js";
import { readDesktopConfig, updateDesktopConfig } from "../config.js";
import { getDesktopSecret, removeDesktopSecret } from "../safeStorage.js";
import { rm } from "node:fs/promises";
import {
  DEFAULT_DESKTOP_LOCAL_AI_CONFIG,
  LOCAL_AI_DEFAULT_TIMEOUT_MS,
  LocalAiProxyError,
  proxyTargetUrl,
  runProxyRequest,
  runProxyStream,
  sanitizeLocalAiConfig,
  shouldForgetKey,
} from "../localAiProxy.js";
import { cliRequest, cliStatusFor, cliStream, isCliKind, shutdownCliAi } from "../cliAi/cliAi.js";
import type { ToolCallBridge } from "../cliAi/toolBridge.js";
import {
  TRANSCRIPTION_MAX_BYTES,
  TRANSCRIPTION_PIECE_MAX_BYTES,
  TranscriptionUploads,
  transcribeUpload,
} from "../localTranscription.js";

// On-device AI proxy. The renderer sends a request id, an allow-listed path
// and a JSON body; the base URL and API key come from the desktop config and
// safeStorage here, so the key never crosses into the renderer. Sender
// identity is checked by handleValidatedIpc (local renderer authority).
//
// Transcription: the renderer copies the recording in ordered pieces
// (LOCAL_AI_TRANSCRIPTION_UPLOAD_CHANNEL) into a private temporary file, then
// LOCAL_AI_TRANSCRIBE_CHANNEL sends it to the speech-to-text server with the
// "stt-api-key" read here, and deletes the file. See localTranscription.ts.
//
// The CLI kinds (claude-cli, codex-cli) run a signed-in Claude Code or Codex
// instead of calling a server (electron/cliAi/). A streamed run's tool calls
// go to the renderer as "tool_call" events and come back through
// LOCAL_AI_TOOL_RESULT_CHANNEL, matched by sender, request id and call id.

const requestInput = z.object({
  requestId: z.string().min(8).max(100),
  path: z.string().min(1).max(100),
  method: z.enum(["GET", "POST"]),
  body: z.string().max(4_000_000).optional(),
  timeoutMs: z.number().int().min(1000).max(15 * 60_000).optional(),
});

const configInput = z.object({
  kind: z.enum(["ollama", "lmstudio", "openai-compatible", "openai", "openrouter", "claude-cli", "codex-cli", "none"]),
  preset: z.enum(["ollama", "lmstudio", "llamacpp", "openai-compatible", "openai", "openrouter", "claude-cli", "codex-cli"]),
  baseUrl: z.string().max(2000),
  model: z.string().max(300),
  features: z.object({ minutes: z.boolean(), assistant: z.boolean(), intake: z.boolean() }),
  minutesChunkChars: z.number(),
  speechToText: z.object({
    kind: z.enum(["none", "openai-compatible", "whisper-cpp", "whisperx"]),
    baseUrl: z.string().max(2000),
    model: z.string().max(300),
  }),
  assistantTools: z.object({ lookUpRecords: z.boolean(), proposeChanges: z.boolean() }).optional(),
  // Optional so an older renderer can still save; sanitizeLocalAiConfig fills it in.
  cli: z.object({ claudePath: z.string().max(1000), codexPath: z.string().max(1000) }).optional(),
  updatedAtISO: z.string().max(40).optional(),
});

const cliKindInput = z.enum(["claude-cli", "codex-cli"]);

const toolResultInput = z.object({
  requestId: z.string().min(8).max(100),
  callId: z.string().min(1).max(100),
  content: z.string().max(2_000_000),
  isError: z.boolean().optional(),
});

const cliStatusResult = z.object({
  kind: cliKindInput,
  found: z.boolean(),
  binaryPath: z.string().optional(),
  version: z.string().optional(),
  signedIn: z.boolean().nullable(),
  account: z.string().optional(),
  message: z.string(),
  hint: z.string().optional(),
});

const responseSchema = z.object({ status: z.number(), ok: z.boolean(), body: z.string(), contentType: z.string().optional() });

const inFlight = new Map<string, AbortController>();
/** Tool bridges of running CLI streams, by `${senderId}:${requestId}`. */
const toolBridges = new Map<string, ToolCallBridge>();
const uploads = new TranscriptionUploads();

const pieceBytes = z.custom<ArrayBuffer | Uint8Array>(
  (value) => (value instanceof ArrayBuffer || value instanceof Uint8Array) && value.byteLength <= TRANSCRIPTION_PIECE_MAX_BYTES,
  "Expected a recording piece of at most 16 MB.",
);

const uploadInput = z.object({
  requestId: z.string().min(8).max(100),
  fileName: z.string().min(1).max(500),
  totalBytes: z.number().int().min(1).max(TRANSCRIPTION_MAX_BYTES),
  offset: z.number().int().min(0).max(TRANSCRIPTION_MAX_BYTES),
  bytes: pieceBytes,
});

const transcribeInput = z.object({ requestId: z.string().min(8).max(100), language: z.string().max(40).optional() });

const transcriptionResult = z.union([
  z.object({
    ok: z.literal(true),
    parts: z.array(z.object({ offsetSec: z.number(), body: z.string() })),
    overlapSec: z.number(),
    converted: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["status", "refused", "network", "timeout", "aborted"]),
    status: z.number().optional(),
    message: z.string(),
  }),
]);

async function currentConfig() {
  return (await readDesktopConfig()).localAi ?? DEFAULT_DESKTOP_LOCAL_AI_CONFIG;
}

/**
 * An abort can arrive while its request is still reading the config, before
 * it is tracked; it is remembered briefly so the request stops when it starts.
 */
const earlyAborts = new Map<string, number>();
const EARLY_ABORT_MS = 30_000;

function stopped() {
  return new LocalAiProxyError("aborted", "The AI request was stopped.");
}

function track(senderId: number, requestId: string) {
  const key = `${senderId}:${requestId}`;
  const controller = new AbortController();
  inFlight.get(key)?.abort();
  inFlight.set(key, controller);
  const abortedAt = earlyAborts.get(key);
  earlyAborts.delete(key);
  if (abortedAt !== undefined && abortedAt > Date.now()) controller.abort(stopped());
  return { key, controller };
}

/** Stops every request of one renderer and fails its waiting tool calls. */
function stopSenderRequests(senderId: number) {
  const prefix = `${senderId}:`;
  for (const [key, controller] of inFlight) {
    if (!key.startsWith(prefix)) continue;
    controller.abort(stopped());
    inFlight.delete(key);
  }
  for (const [key, bridge] of toolBridges) if (key.startsWith(prefix)) bridge.close();
}

const watchedSenders = new WeakSet<WebContents>();

/**
 * A renderer that navigates away, crashes or closes can't read a reply or
 * answer a tool call: its requests (CLI runs included) stop with it.
 */
function watchSender(sender: WebContents) {
  if (watchedSenders.has(sender)) return;
  watchedSenders.add(sender);
  const id = sender.id;
  sender.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) stopSenderRequests(id);
  });
  sender.on("render-process-gone", () => stopSenderRequests(id));
  sender.once("destroyed", () => stopSenderRequests(id));
}

async function prepare(senderId: number, input: z.infer<typeof requestInput>, config: Awaited<ReturnType<typeof currentConfig>>) {
  const url = proxyTargetUrl(config, input.path);
  const apiKey = await getDesktopSecret("ai-api-key").catch(() => null);
  return { url, apiKey, ...track(senderId, input.requestId) };
}

export function registerAiHandlers() {
  // CLI children, the Codex app-server and the MCP tool server end with the app.
  app.once("will-quit", () => shutdownCliAi());

  handleValidatedIpc({
    channel: IpcChannels.GET_LOCAL_AI_CONFIG_CHANNEL,
    result: configInput,
    handler: () => currentConfig(),
  });

  handleValidatedIpc({
    channel: IpcChannels.SAVE_LOCAL_AI_CONFIG_CHANNEL,
    payload: configInput,
    result: configInput,
    handler: async (_event, input) => {
      const previous = await currentConfig();
      const next = sanitizeLocalAiConfig(input);
      // A stored key belongs to the server it was entered for.
      if (shouldForgetKey(previous.baseUrl, next.baseUrl)) await removeDesktopSecret("ai-api-key");
      if (shouldForgetKey(previous.speechToText.baseUrl, next.speechToText.baseUrl)) await removeDesktopSecret("stt-api-key");
      await updateDesktopConfig({ localAi: next });
      return next;
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_REQUEST_CHANNEL,
    payload: requestInput,
    result: responseSchema,
    handler: async (event, input) => {
      watchSender(event.sender);
      const config = await currentConfig();
      if (isCliKind(config.kind)) {
        const { key, controller } = track(event.sender.id, input.requestId);
        const timer = setTimeout(
          () => controller.abort(new LocalAiProxyError("timeout", "The command-line agent took too long to answer.")),
          input.timeoutMs ?? LOCAL_AI_DEFAULT_TIMEOUT_MS,
        );
        try {
          return await cliRequest(config, input, controller.signal);
        } finally {
          clearTimeout(timer);
          if (inFlight.get(key) === controller) inFlight.delete(key);
        }
      }
      const { url, apiKey, key, controller } = await prepare(event.sender.id, input, config);
      const timer = setTimeout(
        () => controller.abort(new LocalAiProxyError("timeout", "The on-device model took too long to answer.")),
        input.timeoutMs ?? LOCAL_AI_DEFAULT_TIMEOUT_MS,
      );
      try {
        return await runProxyRequest({ fetchImpl: fetch, url, method: input.method, body: input.body, apiKey, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        inFlight.delete(key);
      }
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_STREAM_CHANNEL,
    payload: requestInput,
    result: z.void(),
    handler: async (event, input) => {
      const sender = event.sender;
      watchSender(sender);
      const emit = (payload: unknown) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.LOCAL_AI_STREAM_EVENT_CHANNEL, { requestId: input.requestId, event: payload });
      };
      let config: Awaited<ReturnType<typeof currentConfig>>;
      try {
        config = await currentConfig();
      } catch {
        emit({ type: "error", code: "refused", message: "The on-device AI settings couldn't be read." });
        return;
      }
      if (isCliKind(config.kind)) {
        const { key, controller } = track(sender.id, input.requestId);
        const timer = setTimeout(
          () => controller.abort(new LocalAiProxyError("timeout", "The command-line agent took too long to answer.")),
          input.timeoutMs ?? 30 * 60_000,
        );
        try {
          await cliStream(config, input, controller.signal, emit, (bridge) => toolBridges.set(key, bridge));
        } finally {
          clearTimeout(timer);
          toolBridges.get(key)?.close();
          toolBridges.delete(key);
          if (inFlight.get(key) === controller) inFlight.delete(key);
        }
        return;
      }
      let prepared: Awaited<ReturnType<typeof prepare>>;
      try {
        prepared = await prepare(sender.id, input, config);
      } catch (error) {
        emit({ type: "error", code: "refused", message: error instanceof Error ? error.message : "This AI request is not allowed." });
        return;
      }
      // The renderer aborts on stalls; this only bounds a runaway stream.
      const timer = setTimeout(
        () => prepared.controller.abort(new LocalAiProxyError("timeout", "The on-device model took too long to answer.")),
        input.timeoutMs ?? 30 * 60_000,
      );
      try {
        await runProxyStream(
          { fetchImpl: fetch, url: prepared.url, method: input.method, body: input.body, apiKey: prepared.apiKey, signal: prepared.controller.signal },
          emit,
        );
      } finally {
        clearTimeout(timer);
        inFlight.delete(prepared.key);
      }
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_ABORT_CHANNEL,
    payload: z.string().min(8).max(100),
    handler: async (event, requestId) => {
      const key = `${event.sender.id}:${requestId}`;
      const controller = inFlight.get(key);
      if (controller) {
        controller.abort(stopped());
        inFlight.delete(key);
      } else {
        const now = Date.now();
        for (const [early, expires] of earlyAborts) if (expires <= now) earlyAborts.delete(early);
        earlyAborts.set(key, now + EARLY_ABORT_MS);
      }
      // Waiting tool calls of a CLI run fail at once; the run itself stops on the abort.
      toolBridges.get(key)?.close();
      await uploads.discard(key);
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_TOOL_RESULT_CHANNEL,
    payload: toolResultInput,
    handler: (event, input) => {
      // Only the renderer that holds the stream can answer its calls; a late or unknown answer is dropped.
      toolBridges.get(`${event.sender.id}:${input.requestId}`)?.resolve(input.callId, input.content, input.isError === true);
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_CLI_STATUS_CHANNEL,
    payload: cliKindInput,
    result: cliStatusResult,
    handler: async (_event, kind) => cliStatusFor(kind, (await currentConfig()).cli),
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_TRANSCRIPTION_UPLOAD_CHANNEL,
    payload: uploadInput,
    result: z.object({ received: z.number() }),
    handler: async (event, input) => {
      const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
      const received = await uploads.write(`${event.sender.id}:${input.requestId}`, { ...input, bytes });
      return { received };
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.LOCAL_AI_TRANSCRIBE_CHANNEL,
    payload: transcribeInput,
    result: transcriptionResult,
    handler: async (event, input) => {
      const sender = event.sender;
      const key = `${sender.id}:${input.requestId}`;
      const upload = uploads.take(key);
      if (!upload) return { ok: false as const, code: "refused" as const, message: "Send the whole recording first." };
      const controller = new AbortController();
      inFlight.get(key)?.abort();
      inFlight.set(key, controller);
      try {
        const config = await currentConfig();
        const apiKey = await getDesktopSecret("stt-api-key").catch(() => null);
        return await transcribeUpload({
          fetchImpl: fetch,
          speech: config.speechToText,
          apiKey,
          signal: controller.signal,
          upload,
          emit: (payload) => {
            if (!sender.isDestroyed()) sender.send(IpcChannels.LOCAL_AI_TRANSCRIBE_EVENT_CHANNEL, { requestId: input.requestId, event: payload });
          },
        });
      } finally {
        inFlight.delete(key);
        await rm(upload.dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  });
}
