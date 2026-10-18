/**
 * Desktop on-device AI proxy (pure part, no Electron imports so it can be
 * tested under Node).
 *
 * The renderer names an allow-listed path; the main process supplies the base
 * URL from the desktop config and the API key from safeStorage, then makes the
 * request itself. So desktop requests avoid CORS, and the key never reaches
 * the renderer. Model servers are expected on this computer or the local
 * network; anything else must be HTTPS.
 */
import type {
  DesktopLocalAiConfig,
  DesktopLocalAiPath,
  DesktopLocalAiResponse,
  DesktopLocalAiStreamEvent,
} from "../src/lib/desktopBridge";
import { isSpeechToTextKind, SPEECH_PATHS, speechKindInfo, speechRequestUrl } from "../shared/ai/speechRequest.js";

export const LOCAL_AI_PROXY_PATHS: readonly DesktopLocalAiPath[] = ["/models", "/chat/completions", "/api/tags"];
/** Speech-to-text paths: only through the transcription channel, to the speech-to-text server. */
export const SPEECH_PROXY_PATHS = SPEECH_PATHS;
export const LOCAL_AI_MAX_RESPONSE_BYTES = 8_000_000;
export const LOCAL_AI_DEFAULT_TIMEOUT_MS = 5 * 60_000;

const KINDS = ["ollama", "lmstudio", "openai-compatible", "openai", "openrouter", "none"] as const;
const PRESETS = ["ollama", "lmstudio", "llamacpp", "openai-compatible", "openai", "openrouter"] as const;

export const DEFAULT_DESKTOP_LOCAL_AI_CONFIG: DesktopLocalAiConfig = {
  kind: "none",
  preset: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "",
  features: { minutes: true, assistant: true, intake: true },
  minutesChunkChars: 8000,
  speechToText: { kind: "none", baseUrl: "", model: "" },
  assistantTools: { lookUpRecords: false, proposeChanges: false },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fixedBaseUrl(kind: DesktopLocalAiConfig["kind"]) {
  if (kind === "openai") return "https://api.openai.com/v1";
  if (kind === "openrouter") return "https://openrouter.ai/api/v1";
  return null;
}

export function sanitizeLocalAiConfig(raw: unknown): DesktopLocalAiConfig {
  const row = record(raw);
  const kind = (KINDS as readonly string[]).includes(String(row.kind)) ? (row.kind as DesktopLocalAiConfig["kind"]) : "none";
  const preset = (PRESETS as readonly string[]).includes(String(row.preset)) ? (row.preset as DesktopLocalAiConfig["preset"]) : "ollama";
  const features = record(row.features);
  const speech = record(row.speechToText);
  const chunk = Number(row.minutesChunkChars);
  const tools = record(row.assistantTools);
  const lookUpRecords = tools.lookUpRecords === true;
  return {
    kind,
    preset,
    baseUrl: (fixedBaseUrl(kind) ?? text(row.baseUrl)).replace(/\/+$/, ""),
    model: text(row.model, 300),
    features: { minutes: features.minutes !== false, assistant: features.assistant !== false, intake: features.intake !== false },
    minutesChunkChars: Number.isFinite(chunk) && chunk > 0 ? Math.min(200_000, Math.max(1000, Math.floor(chunk))) : 8000,
    speechToText: {
      kind: isSpeechToTextKind(speech.kind) ? speech.kind : "none",
      baseUrl: text(speech.baseUrl).replace(/\/+$/, ""),
      model: text(speech.model, 300),
    },
    assistantTools: { lookUpRecords, proposeChanges: lookUpRecords && tools.proposeChanges === true },
    updatedAtISO: text(row.updatedAtISO, 40) || undefined,
  };
}

function isLocalNetworkHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || !host.includes(".") && !host.includes(":")) return true;
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") || host.endsWith(".internal")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
}

/** Why the configured address cannot be used, or null when it can. */
export function localAiBaseUrlProblem(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "The on-device AI address is not valid.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "The on-device AI address must use http or https.";
  if (url.username || url.password || url.search || url.hash) return "The on-device AI address cannot contain credentials or a query string.";
  if (url.protocol === "http:" && !isLocalNetworkHost(url.hostname)) return "Use https:// for a server that is not on this computer or your local network.";
  return null;
}

export class LocalAiProxyError extends Error {
  constructor(readonly code: "refused" | "network" | "timeout" | "aborted", message: string) {
    super(message);
    this.name = "LocalAiProxyError";
  }
}

/** The URL for an allow-listed path under the configured base URL. */
export function proxyTargetUrl(config: Pick<DesktopLocalAiConfig, "kind" | "baseUrl">, path: string): string {
  if ((SPEECH_PROXY_PATHS as readonly string[]).includes(path)) {
    throw new LocalAiProxyError("refused", "Speech-to-text requests go to the speech-to-text server, not the chat model server.");
  }
  if (!(LOCAL_AI_PROXY_PATHS as readonly string[]).includes(path)) throw new LocalAiProxyError("refused", "This AI request path is not allowed.");
  if (config.kind === "none") throw new LocalAiProxyError("refused", "On-device AI is off.");
  const base = (fixedBaseUrl(config.kind) ?? config.baseUrl).replace(/\/+$/, "");
  const problem = localAiBaseUrlProblem(base);
  if (problem) throw new LocalAiProxyError("refused", problem);
  return path === "/api/tags" ? `${new URL(base).origin}/api/tags` : `${base}${path}`;
}

/**
 * The speech-to-text URL: the configured server plus the one path its kind
 * uses (`/audio/transcriptions` or `/inference`). Any other path is refused.
 */
export function speechProxyTargetUrl(speech: DesktopLocalAiConfig["speechToText"], path?: string): string {
  if (speech.kind === "none") throw new LocalAiProxyError("refused", "On-device speech-to-text is off.");
  if (path !== undefined && path !== speechKindInfo(speech.kind).path) {
    throw new LocalAiProxyError("refused", "This speech-to-text path is not allowed.");
  }
  const base = speech.baseUrl.replace(/\/+$/, "");
  const problem = localAiBaseUrlProblem(base);
  if (problem) throw new LocalAiProxyError("refused", problem.replace("on-device AI", "speech-to-text"));
  return speechRequestUrl(speech.kind, base);
}

export function proxyHeaders(apiKey: string | null, hasBody: boolean, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: stream ? "text/event-stream" : "application/json" };
  if (hasBody) headers["content-type"] = "application/json";
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

/** A stored key is bound to the server it was entered for. */
export function shouldForgetKey(previousBaseUrl: string, nextBaseUrl: string): boolean {
  const origin = (value: string) => {
    try {
      return new URL(value).origin;
    } catch {
      return "";
    }
  };
  return origin(previousBaseUrl) !== origin(nextBaseUrl);
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ProxyCall = {
  fetchImpl: FetchLike;
  url: string;
  method: "GET" | "POST";
  body?: string;
  apiKey: string | null;
  signal: AbortSignal;
};

function networkError(error: unknown, signal: AbortSignal): LocalAiProxyError {
  if (error instanceof LocalAiProxyError) return error;
  const reason: unknown = signal.reason;
  if (reason instanceof LocalAiProxyError) return reason;
  if (signal.aborted) return new LocalAiProxyError("aborted", "The AI request was stopped.");
  return new LocalAiProxyError("network", "Could not reach the on-device AI server. Check that it is running.");
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > LOCAL_AI_MAX_RESPONSE_BYTES) throw new LocalAiProxyError("refused", "The AI server's reply was too large.");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > LOCAL_AI_MAX_RESPONSE_BYTES) throw new LocalAiProxyError("refused", "The AI server's reply was too large.");
  return new TextDecoder().decode(buffer);
}

export async function runProxyRequest(call: ProxyCall): Promise<DesktopLocalAiResponse> {
  try {
    const response = await call.fetchImpl(call.url, {
      method: call.method,
      headers: proxyHeaders(call.apiKey, Boolean(call.body), false),
      body: call.body,
      signal: call.signal,
      redirect: "error",
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await readLimited(response),
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } catch (error) {
    throw networkError(error, call.signal);
  }
}

/** Streams the reply as events; resolves after "end" or "error" was emitted. */
export async function runProxyStream(call: ProxyCall, emit: (event: DesktopLocalAiStreamEvent) => void): Promise<void> {
  let response: Response;
  try {
    response = await call.fetchImpl(call.url, {
      method: call.method,
      headers: proxyHeaders(call.apiKey, Boolean(call.body), true),
      body: call.body,
      signal: call.signal,
      redirect: "error",
    });
  } catch (error) {
    const failure = networkError(error, call.signal);
    emit({ type: "error", code: failure.code, message: failure.message });
    return;
  }
  emit({ type: "head", status: response.status, ok: response.ok, contentType: response.headers.get("content-type") ?? undefined });
  if (!response.body) {
    emit({ type: "end" });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LOCAL_AI_MAX_RESPONSE_BYTES) throw new LocalAiProxyError("refused", "The AI server's reply was too large.");
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) emit({ type: "chunk", text: chunk });
    }
    const rest = decoder.decode();
    if (rest) emit({ type: "chunk", text: rest });
    emit({ type: "end" });
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    const failure = networkError(error, call.signal);
    emit({ type: "error", code: failure.code, message: failure.message });
  }
}
