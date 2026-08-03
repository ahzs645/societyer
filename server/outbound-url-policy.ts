import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import {
  isPrivateOrReservedAddress,
  OutboundUrlPolicyError,
  validateOutboundUrl,
  type OutboundUrlPolicyOptions,
} from "../shared/outboundUrlPolicy.js";

export const DEVELOPMENT_OUTBOUND_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
  "connector-runner",
] as const;

export type OutboundResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export type ResolvedOutboundUrl = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
  developmentException: boolean;
};

export type OutboundRequestOptions = {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  resolver?: OutboundResolver;
  policy?: OutboundUrlPolicyOptions;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
};

export type OutboundResponse = {
  status: number;
  ok: boolean;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  url: string;
};

function defaultResolver(hostname: string) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function timeoutAfter<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function nodeDevelopmentPolicy(): OutboundUrlPolicyOptions {
  const allowDevelopmentHttp = process.env.NODE_ENV !== "production";
  return {
    allowDevelopmentHttp,
    developmentHosts: allowDevelopmentHttp ? DEVELOPMENT_OUTBOUND_HOSTS : [],
  };
}

export async function resolveOutboundUrl(
  rawUrl: string,
  options: {
    resolver?: OutboundResolver;
    policy?: OutboundUrlPolicyOptions;
    resolveTimeoutMs?: number;
  } = {},
): Promise<ResolvedOutboundUrl> {
  const validated = validateOutboundUrl(rawUrl, options.policy);
  if (validated.developmentException) {
    if (validated.hostname === "localhost") {
      return { ...validated, address: "127.0.0.1", family: 4 };
    }
    if (validated.hostname === "127.0.0.1" || validated.hostname === "::1") {
      return {
        ...validated,
        address: validated.hostname,
        family: validated.hostname.includes(":") ? 6 : 4,
      };
    }
    const developmentAnswers = await timeoutAfter(
      (options.resolver ?? defaultResolver)(validated.hostname),
      options.resolveTimeoutMs ?? 3_000,
      "Outbound DNS resolution timed out.",
    );
    const developmentAddress = developmentAnswers[0];
    if (!developmentAddress) {
      throw new OutboundUrlPolicyError("dns_empty", "Outbound hostname did not resolve.");
    }
    return {
      ...validated,
      address: developmentAddress.address,
      family: developmentAddress.family === 6 ? 6 : 4,
    };
  }

  const directFamily = validated.hostname.includes(":") ? 6 : /^\d+\.\d+\.\d+\.\d+$/.test(validated.hostname) ? 4 : undefined;
  const answers = directFamily
    ? [{ address: validated.hostname, family: directFamily } satisfies LookupAddress]
    : await timeoutAfter(
      (options.resolver ?? defaultResolver)(validated.hostname),
      options.resolveTimeoutMs ?? 3_000,
      "Outbound DNS resolution timed out.",
    );
  if (answers.length === 0) {
    throw new OutboundUrlPolicyError("dns_empty", "Outbound hostname did not resolve.");
  }
  const blocked = answers.find((answer) => isPrivateOrReservedAddress(answer.address));
  if (blocked) {
    throw new OutboundUrlPolicyError("dns_private", "Outbound hostname resolves to a private or reserved address.");
  }
  const approved = answers[0];
  return {
    ...validated,
    address: approved.address,
    family: approved.family === 6 ? 6 : 4,
  };
}

export async function validateOutboundRedirectChain(
  urls: readonly string[],
  options: { resolver?: OutboundResolver; policy?: OutboundUrlPolicyOptions } = {},
) {
  const validated: ResolvedOutboundUrl[] = [];
  for (const url of urls) {
    validated.push(await resolveOutboundUrl(url, options));
  }
  return validated;
}

function requestOnce(
  approved: ResolvedOutboundUrl,
  options: Required<Pick<OutboundRequestOptions, "method" | "connectTimeoutMs" | "readTimeoutMs" | "maxResponseBytes">> &
    Pick<OutboundRequestOptions, "headers" | "body">,
): Promise<OutboundResponse> {
  return new Promise((resolve, reject) => {
    let connected = false;
    const transport = approved.url.protocol === "https:" ? https : http;
    const request = transport.request(approved.url, {
      method: options.method,
      headers: options.headers,
      lookup: (_hostname, _lookupOptions, callback) => {
        callback(null, approved.address, approved.family);
      },
      servername: approved.url.protocol === "https:" ? approved.hostname : undefined,
    }, (response) => {
      connected = true;
      const chunks: Buffer[] = [];
      let size = 0;
      response.setTimeout(options.readTimeoutMs, () => {
        response.destroy(new Error("Outbound response timed out."));
      });
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > options.maxResponseBytes) {
          response.destroy(new Error("Outbound response exceeded the size limit."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        const status = response.statusCode ?? 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: response.headers,
          body,
          text: body.toString("utf8"),
          url: approved.url.toString(),
        });
      });
      response.on("error", reject);
    });
    request.setTimeout(options.connectTimeoutMs, () => {
      request.destroy(new Error(connected ? "Outbound request timed out." : "Outbound connection timed out."));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function redirectedMethod(status: number, method: string) {
  if (status === 303 || ((status === 301 || status === 302) && method.toUpperCase() === "POST")) return "GET";
  return method;
}

export async function requestOutboundUrl(
  rawUrl: string,
  options: OutboundRequestOptions = {},
): Promise<OutboundResponse> {
  const maxRedirects = options.maxRedirects ?? 4;
  let currentUrl = rawUrl;
  let method = options.method ?? "GET";
  let body = options.body;
  let headers = { ...(options.headers ?? {}) };
  let previousOrigin: string | undefined;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const approved = await resolveOutboundUrl(currentUrl, {
      resolver: options.resolver,
      policy: options.policy,
      resolveTimeoutMs: options.connectTimeoutMs,
    });
    if (previousOrigin && previousOrigin !== approved.url.origin) {
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) =>
        !["authorization", "cookie", "proxy-authorization", "x-societyer-signature"].includes(name.toLowerCase()),
      ));
    }
    const response = await requestOnce(approved, {
      method,
      headers,
      body,
      connectTimeoutMs: options.connectTimeoutMs ?? 3_000,
      readTimeoutMs: options.readTimeoutMs ?? 5_000,
      maxResponseBytes: options.maxResponseBytes ?? 1_000_000,
    });
    const location = response.headers.location;
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
    if (redirectCount === maxRedirects) {
      throw new OutboundUrlPolicyError("redirect_limit", "Outbound request exceeded the redirect limit.");
    }
    previousOrigin = approved.url.origin;
    currentUrl = new URL(location, approved.url).toString();
    const nextMethod = redirectedMethod(response.status, method);
    if (nextMethod === "GET" && method !== "GET") {
      body = undefined;
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) =>
        !["content-length", "content-type"].includes(name.toLowerCase()),
      ));
    }
    method = nextMethod;
  }
  throw new OutboundUrlPolicyError("redirect_limit", "Outbound request exceeded the redirect limit.");
}
