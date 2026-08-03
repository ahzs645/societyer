import {
  OutboundUrlPolicyError,
  validateOutboundUrl,
  type OutboundUrlPolicyOptions,
} from "../../shared/outboundUrlPolicy";

// Convex does not expose DNS lookup or a socket dispatcher. This wrapper applies
// the shared deterministic policy before every hop, uses manual redirects, and
// bounds time/body size; DNS answer validation and address pinning are performed
// only by the Node policy used by the gateway and connector runner.

const CONVEX_DEVELOPMENT_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
] as const;

type OutboundSource = "tenant" | "operator" | "storage";

export type ConvexOutboundOptions = {
  source: OutboundSource;
  operation: string;
  maxResponseBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

export type ConvexOutboundResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  url: string;
  bytes: Uint8Array;
  text: string;
  arrayBuffer: ArrayBuffer;
};

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

const auditedRejections = new WeakSet<object>();

function environment() {
  return (globalThis as typeof globalThis & { process?: ProcessLike }).process?.env;
}

function convexPolicy(): OutboundUrlPolicyOptions {
  const env = environment();
  const allowDevelopmentHttp = env?.NODE_ENV !== "production" &&
    env?.SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT === "true";
  return {
    allowDevelopmentHttp,
    developmentHosts: allowDevelopmentHttp ? CONVEX_DEVELOPMENT_HOSTS : [],
  };
}

function safeHostname(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "invalid";
  }
}

function auditRejection(rawUrl: string, options: ConvexOutboundOptions, error: unknown) {
  if (typeof error === "object" && error !== null) {
    if (auditedRejections.has(error)) return;
    auditedRejections.add(error);
  }
  const reason = error instanceof OutboundUrlPolicyError ? error.code : "request_failed";
  console.warn("outbound_url_rejected", {
    operation: options.operation,
    source: options.source,
    hostname: safeHostname(rawUrl),
    reason,
  });
}

export function assertConvexOutboundUrl(rawUrl: string, options: ConvexOutboundOptions) {
  try {
    return validateOutboundUrl(rawUrl, convexPolicy());
  } catch (error: unknown) {
    auditRejection(rawUrl, options, error);
    throw error;
  }
}

async function readLimitedBody(response: Response, maxResponseBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new OutboundUrlPolicyError("response_size", "Outbound response exceeded the size limit.");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new OutboundUrlPolicyError("response_size", "Outbound response exceeded the size limit.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function redirectMethod(status: number, method: string) {
  if (status === 303 || ((status === 301 || status === 302) && method.toUpperCase() === "POST")) return "GET";
  return method;
}

export async function fetchConvexOutbound(
  rawUrl: string,
  init: RequestInit,
  options: ConvexOutboundOptions,
): Promise<ConvexOutboundResponse> {
  let currentUrl = rawUrl;
  let method = init.method ?? "GET";
  let body = init.body;
  let headers = new Headers(init.headers);
  let previousOrigin: string | undefined;
  const maxRedirects = options.maxRedirects ?? 4;

  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const validated = assertConvexOutboundUrl(currentUrl, options);
      if (previousOrigin && previousOrigin !== validated.url.origin) {
        for (const name of ["authorization", "cookie", "proxy-authorization", "x-societyer-signature"]) {
          headers.delete(name);
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
      let response: Response;
      let bytes: Uint8Array;
      try {
        response = await fetch(validated.url, {
          ...init,
          method,
          body,
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
        bytes = await readLimitedBody(response, options.maxResponseBytes ?? 1_000_000);
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        const copy = new Uint8Array(bytes);
        return {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          url: validated.url.toString(),
          bytes,
          text: new TextDecoder().decode(bytes),
          arrayBuffer: copy.buffer,
        };
      }
      if (redirects === maxRedirects) {
        throw new OutboundUrlPolicyError("redirect_limit", "Outbound request exceeded the redirect limit.");
      }
      previousOrigin = validated.url.origin;
      currentUrl = new URL(location, validated.url).toString();
      const nextMethod = redirectMethod(response.status, method);
      if (nextMethod === "GET" && method !== "GET") {
        body = undefined;
        headers.delete("content-length");
        headers.delete("content-type");
      }
      method = nextMethod;
    }
  } catch (error: unknown) {
    auditRejection(currentUrl, options, error);
    throw error;
  }
  throw new OutboundUrlPolicyError("redirect_limit", "Outbound request exceeded the redirect limit.");
}
