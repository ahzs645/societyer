/**
 * How an on-device AI request leaves this app.
 *
 * - Browser-local workspace: a direct `fetch` from this page to the server the
 *   person configured. A local server must allow this page's origin (CORS).
 * - Desktop app: the main process makes the request (no CORS, and the API key
 *   stays in the main process). The renderer only names an allow-listed path.
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

export type DeviceAiRequestInit = {
  method: "GET" | "POST";
  body?: string;
  signal?: AbortSignal;
  stream?: boolean;
};

export type DeviceAiTransport = {
  kind: "direct" | "desktop";
  send(path: DeviceAiPath, init: DeviceAiRequestInit): Promise<Response>;
};

export const BROWSER_CORS_HINT =
  "If the server is running, it must allow requests from this page. Ollama: set OLLAMA_ORIGINS to this page's address (or *) and restart it. LM Studio: turn on CORS in the Developer server settings. llama.cpp: llama-server normally allows this; if it sits behind a proxy, allow this origin there.";

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
      const headers: Record<string, string> = { accept: init.stream ? "text/event-stream" : "application/json" };
      if (init.body) headers["content-type"] = "application/json";
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      try {
        return await fetchImpl(deviceAiUrl(baseUrl, path), {
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
        let host = baseUrl;
        try {
          host = new URL(baseUrl).host;
        } catch {
          // Keep the raw value.
        }
        throw new DeviceAiError("network", `Could not reach ${host}.`, { hint: BROWSER_CORS_HINT });
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

/** Electron prefixes invoke failures with the channel name; keep the reason. */
function invokeMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") || fallback;
}

function desktopError(event: Extract<DesktopLocalAiStreamEvent, { type: "error" }>) {
  return new DeviceAiError(event.code === "refused" ? "refused" : event.code, event.message);
}

export function desktopTransport(bridge: SocietyerDesktopBridge): DeviceAiTransport {
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
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
        let headed = false;
        let finished = false;
        const body = new ReadableStream<Uint8Array>({
          start(next) {
            controller = next;
          },
          cancel() {
            abort();
          },
        });
        const fail = (error: DeviceAiError) => {
          if (finished) return;
          finished = true;
          init.signal?.removeEventListener("abort", abort);
          if (!headed) reject(abortReason(init.signal) ?? error);
          else controller?.error(abortReason(init.signal) ?? error);
        };
        bridge
          .localAiStream(request, (event) => {
            if (finished) return;
            if (event.type === "head") {
              headed = true;
              resolve(responseFor(body, event.status, event.contentType ?? "text/event-stream"));
            } else if (event.type === "chunk") {
              controller?.enqueue(encoder.encode(event.text));
            } else if (event.type === "end") {
              finished = true;
              init.signal?.removeEventListener("abort", abort);
              controller?.close();
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
    return transport.send(path, {
      method: (init?.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET",
      body,
      signal: init?.signal ?? undefined,
      stream: body ? /"stream"\s*:\s*true/.test(body) : false,
    });
  };
  return routed as typeof fetch;
}
