/**
 * How an on-device AI request leaves this app.
 *
 * - Browser-local workspace: a direct `fetch` from this page to the server the
 *   person configured. A local server must allow this page's origin (CORS).
 * - Desktop app: the main process makes the request (no CORS, and the API key
 *   stays in the main process). The renderer only names an allow-listed path.
 *
 * Claude Code and Codex (desktop app only) run their own tool loop: a stream
 * may deliver `tool_call` events, which `onToolCall` answers through
 * `localAiToolResult` before the stream carries on.
 *
 * Both return a standard `Response`, so the client and the AI SDK (through
 * `deviceAiSdkFetch`) read replies the same way in either runtime.
 */
import { getDesktopBridge, type DesktopLocalAiStreamEvent, type SocietyerDesktopBridge } from "../desktopBridge";
import { DEVICE_AI_PATHS, deviceAiUrl, type DeviceAiPath } from "./models";
import { browserDeviceAiKey, deviceAiSnapshot } from "./config";

/** `tools_unsupported`: the server refused a request that offered tools (the assistant falls back to no tools). */
export type DeviceAiErrorCode = "not_configured" | "network" | "timeout" | "aborted" | "status" | "bad_reply" | "refused" | "tools_unsupported";

export class DeviceAiError extends Error {
  readonly code: DeviceAiErrorCode;
  readonly status?: number;
  /** Extra guidance for the person, e.g. how to allow this page's origin. */
  readonly hint?: string;

  constructor(code: DeviceAiErrorCode, message: string, options: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = "DeviceAiError";
    this.code = code;
    this.status = options.status;
    this.hint = options.hint;
  }
}

/** A tool the model called mid-stream (Claude Code, Codex). `arguments` is JSON text. */
export type DeviceAiToolCall = { callId: string; name: string; arguments: string };
export type DeviceAiToolAnswer = { content: string; isError?: boolean };

export type DeviceAiRequestInit = {
  method: "GET" | "POST";
  body?: string;
  signal?: AbortSignal;
  stream?: boolean;
  /**
   * Runs a tool the provider's own loop called (desktop CLI kinds). Its answer
   * goes back to the model; the stream then carries on with more text.
   */
  onToolCall?: (call: DeviceAiToolCall) => Promise<DeviceAiToolAnswer>;
};

export type DeviceAiTransport = {
  kind: "direct" | "desktop";
  send(path: DeviceAiPath, init: DeviceAiRequestInit): Promise<Response>;
};

/** How to allow this page's origin on the common model servers. */
const MODEL_SERVER_CORS_STEPS =
  "Ollama: set OLLAMA_ORIGINS to this page's address (or *) and restart it. LM Studio: turn on CORS in the Developer server settings. llama.cpp: llama-server normally allows this; if it sits behind a proxy, allow this origin there.";

/** When the browser can't say why a request failed. */
export const BROWSER_CORS_HINT = `If the server is running, it must allow requests from this page. ${MODEL_SERVER_CORS_STEPS}`;

export const BROWSER_UNREACHABLE_HINT =
  "Check that the server is running and that the address and port are right. If it is running, the browser may be blocking the connection: allow this site to reach devices on your network if the browser asks, and use an https address for a server on another computer.";

/** The no-cors probe after a failed browser request: one request, never retried. */
const BROWSER_PROBE_TIMEOUT_MS = 3_000;

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A browser request that fails with a network error doesn't say why. One
 * `no-cors` GET to the same address tells the two usual causes apart: an
 * (opaque) answer means a server is up but doesn't allow this page's origin
 * (CORS); another network error means nothing answered there. A probe that
 * doesn't finish in time leaves the cause unknown. Browser requests only: the
 * desktop app's main process has no CORS.
 */
export async function browserNetworkError(
  url: string,
  { fetchImpl, corsSteps, signal }: { fetchImpl: typeof fetch; corsSteps: string; signal?: AbortSignal },
): Promise<DeviceAiError> {
  const host = hostOf(url);
  const probe = new AbortController();
  const timer = setTimeout(() => probe.abort(), BROWSER_PROBE_TIMEOUT_MS);
  const stop = () => probe.abort();
  signal?.addEventListener("abort", stop, { once: true });
  const answered = await Promise.race([
    // no-cors only allows following redirects; any other redirect mode is a network error.
    fetchImpl(url, { method: "GET", mode: "no-cors", credentials: "omit", signal: probe.signal }).then(
      () => true,
      () => (probe.signal.aborted ? undefined : false),
    ),
    // A fetch that ignores its signal still can't hold the error back.
    new Promise<undefined>((resolve) => probe.signal.addEventListener("abort", () => resolve(undefined), { once: true })),
  ]);
  clearTimeout(timer);
  signal?.removeEventListener("abort", stop);
  if (answered === true) {
    return new DeviceAiError("network", `${host} is running but doesn't allow requests from this page.`, { hint: `Allow this page's address on the server (CORS). ${corsSteps}` });
  }
  if (answered === false) return new DeviceAiError("network", `Nothing answered at ${host}.`, { hint: BROWSER_UNREACHABLE_HINT });
  return new DeviceAiError("network", `Could not reach ${host}.`, { hint: `If the server is running, it must allow requests from this page. ${corsSteps}` });
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === "AbortError");
}

/** Reason passed to `AbortController.abort()`, if it is one of ours. */
function abortReason(signal?: AbortSignal): DeviceAiError | undefined {
  const reason: unknown = signal?.reason;
  return reason instanceof DeviceAiError ? reason : undefined;
}

export function directTransport(endpoint: () => { baseUrl: string; apiKey: string }, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): DeviceAiTransport {
  return {
    kind: "direct",
    async send(path, init) {
      const { baseUrl, apiKey } = endpoint();
      if (!baseUrl) throw new DeviceAiError("not_configured", "On-device AI has no server address.");
      const url = deviceAiUrl(baseUrl, path);
      const headers: Record<string, string> = { accept: init.stream ? "text/event-stream" : "application/json" };
      if (init.body) headers["content-type"] = "application/json";
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      try {
        return await fetchImpl(url, {
          method: init.method,
          headers,
          body: init.body,
          signal: init.signal,
          // A model server never needs this page's cookies.
          credentials: "omit",
          redirect: "error",
        });
      } catch (error) {
        const ours = abortReason(init.signal);
        if (ours) throw ours;
        if (isAbort(error, init.signal)) throw new DeviceAiError("aborted", "The AI request was stopped.");
        const failure = await browserNetworkError(url, { fetchImpl, corsSteps: MODEL_SERVER_CORS_STEPS, signal: init.signal });
        // Stopped while probing: report the stop, not the probe.
        throw abortReason(init.signal) ?? (init.signal?.aborted ? new DeviceAiError("aborted", "The AI request was stopped.") : failure);
      }
    },
  };
}

function newRequestId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function responseFor(body: BodyInit | null, status: number, contentType?: string) {
  const noBody = status === 204 || status === 205 || status === 304;
  return new Response(noBody ? null : body, { status, headers: { "content-type": contentType ?? "application/json" } });
}

/**
 * Electron prefixes invoke failures with the channel name and the error's
 * class ("Error:", "LocalAiProxyError:"); keep only the reason.
 */
export function invokeMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, "") || fallback;
}

function desktopError(event: Extract<DesktopLocalAiStreamEvent, { type: "error" }>) {
  return new DeviceAiError(event.code === "refused" ? "refused" : event.code, event.message);
}

/** What the model is told when a tool call can't be answered here. */
function toolErrorContent(code: string, message: string) {
  return JSON.stringify({ error: { code, message } });
}

/** The bridge methods the desktop transport uses. */
export type DesktopAiBridge = Pick<SocietyerDesktopBridge, "localAiRequest" | "localAiStream" | "localAiAbort" | "localAiToolResult">;

export function desktopTransport(bridge: DesktopAiBridge): DeviceAiTransport {
  return {
    kind: "desktop",
    async send(path, init) {
      const requestId = newRequestId();
      const abort = () => void bridge.localAiAbort(requestId).catch(() => undefined);
      if (init.signal?.aborted) throw abortReason(init.signal) ?? new DeviceAiError("aborted", "The AI request was stopped.");
      init.signal?.addEventListener("abort", abort, { once: true });
      const request = { requestId, path, method: init.method, body: init.body };
      if (!init.stream) {
        try {
          const reply = await bridge.localAiRequest(request);
          return responseFor(reply.body, reply.status, reply.contentType);
        } catch (error) {
          const ours = abortReason(init.signal);
          if (ours) throw ours;
          if (init.signal?.aborted) throw new DeviceAiError("aborted", "The AI request was stopped.");
          throw new DeviceAiError("network", invokeMessage(error, "Could not reach the on-device AI server."));
        } finally {
          init.signal?.removeEventListener("abort", abort);
        }
      }
      return new Promise<Response>((resolve, reject) => {
        const encoder = new TextEncoder();
        /**
         * What the main process sent, handed to the reader in order. A tool
         * call runs only when the reader asks for more, so every chunk before
         * it (the model's preamble) has been read by then.
         */
        const items: Array<{ text: string } | { call: DeviceAiToolCall }> = [];
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
        let headed = false;
        /** Nothing more will come from the main process. */
        let finished = false;
        let ended = false;
        let failed = false;
        let wake: (() => void) | null = null;
        const notify = () => {
          const next = wake;
          wake = null;
          next?.();
        };
        const fail = (error: DeviceAiError) => {
          if (finished) return;
          finished = true;
          failed = true;
          init.signal?.removeEventListener("abort", abort);
          if (!headed) reject(abortReason(init.signal) ?? error);
          else controller?.error(abortReason(init.signal) ?? error);
          notify();
        };
        /**
         * The provider's own loop called a tool: run it and answer, always.
         * A handler that fails answers with an error; a stop aborts the whole
         * stream instead (the abort listener tells the main process), so the
         * main process never waits on a call nobody will answer.
         */
        const answerToolCall = async (call: DeviceAiToolCall) => {
          let answer: DeviceAiToolAnswer;
          if (!init.onToolCall) {
            answer = { content: toolErrorContent("not_available", `${call.name} can't run here. Answer without tools.`), isError: true };
          } else {
            try {
              answer = await init.onToolCall(call);
            } catch (error) {
              if (init.signal?.aborted) return;
              const message = error instanceof Error && error.message ? error.message.slice(0, 300) : "The tool failed.";
              answer = { content: toolErrorContent("failed", message), isError: true };
            }
          }
          if (failed || init.signal?.aborted) return;
          try {
            await bridge.localAiToolResult({ requestId, callId: call.callId, content: answer.content, isError: answer.isError });
          } catch (error) {
            // The main process can't take the answer: end the request rather than leave it waiting.
            abort();
            fail(new DeviceAiError("network", invokeMessage(error, "Could not send the tool's result to the desktop app.")));
          }
        };
        const body = new ReadableStream<Uint8Array>(
          {
            start(next) {
              controller = next;
            },
            async pull(next) {
              for (;;) {
                if (failed) return;
                const item = items.shift();
                if (item && "text" in item) {
                  next.enqueue(encoder.encode(item.text));
                  return;
                }
                if (item) {
                  await answerToolCall(item.call);
                  continue;
                }
                if (ended) {
                  next.close();
                  return;
                }
                await new Promise<void>((resume) => {
                  wake = resume;
                });
              }
            },
            cancel() {
              failed = true;
              abort();
              notify();
            },
          },
          // Nothing is read ahead: `pull` runs only when the reader wants more.
          { highWaterMark: 0 },
        );
        bridge
          .localAiStream(request, (event) => {
            if (finished) return;
            if (event.type === "head") {
              headed = true;
              resolve(responseFor(body, event.status, event.contentType ?? "text/event-stream"));
            } else if (event.type === "chunk") {
              items.push({ text: event.text });
              notify();
            } else if (event.type === "tool_call") {
              items.push({ call: { callId: event.callId, name: event.name, arguments: event.arguments } });
              notify();
            } else if (event.type === "end") {
              finished = true;
              ended = true;
              init.signal?.removeEventListener("abort", abort);
              notify();
            } else {
              fail(desktopError(event));
            }
          })
          .then(() => {
            if (!finished) fail(new DeviceAiError("network", "The on-device AI stream ended unexpectedly."));
          })
          .catch((error: unknown) => fail(new DeviceAiError("network", invokeMessage(error, "Could not reach the on-device AI server."))));
      });
    },
  };
}

/** The transport for this runtime, reading the cached device settings. */
export function deviceAiTransport(): DeviceAiTransport {
  const bridge = getDesktopBridge();
  if (bridge) return desktopTransport(bridge);
  return directTransport(() => ({ baseUrl: deviceAiSnapshot().config.baseUrl, apiKey: browserDeviceAiKey() }));
}

export function isDeviceAiPath(value: string): value is DeviceAiPath {
  return (DEVICE_AI_PATHS as readonly string[]).includes(value);
}

/**
 * Base URL handed to the AI SDK. It never resolves: `deviceAiSdkFetch` keeps
 * only the path and sends it through the device transport.
 */
export const DEVICE_AI_SDK_BASE_URL = "http://device-ai.invalid/v1";

/** A `fetch` for `createOpenAI({ fetch })` that routes through a device transport. */
export function deviceAiSdkFetch(transport: DeviceAiTransport): typeof fetch {
  const routed = async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw).pathname.replace(/^\/v1(?=\/)/, "");
    if (!isDeviceAiPath(path)) throw new DeviceAiError("refused", "This AI request path is not allowed.");
    const body = typeof init?.body === "string" ? init.body : undefined;
    // The AI SDK never offers tools here, so a provider's tool call is answered with an error.
    return transport.send(path, {
      method: (init?.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET",
      body,
      signal: init?.signal ?? undefined,
      stream: body ? /"stream"\s*:\s*true/.test(body) : false,
    });
  };
  return routed as typeof fetch;
}
