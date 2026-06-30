// PORTABLE storage download-URL signing.
//
// Resolves a `{ provider, key }` pair to a download URL. `demo` returns a
// deterministic pseudo-URL; `rustfs` returns a SigV4-presigned GET URL signed
// from RUSTFS_* env. This is pure (Web Crypto + process.env) and imports no
// Convex code, so portable handlers in shared/functions can resolve document
// download URLs without depending on convex/providers. The Convex provider
// (convex/providers/storage.ts) re-exports `createDownloadUrl` from here so
// there is a single signing implementation.

export type StorageProviderId = "rustfs" | "demo";

function env(name: string) {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hex(digest);
}

async function hmacSha256Raw(key: ArrayBuffer | Uint8Array | string, value: string) {
  const keyBytes =
    typeof key === "string"
      ? new TextEncoder().encode(key)
      : key instanceof Uint8Array
      ? key
      : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(value),
  );
}

async function signingKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = await hmacSha256Raw(`AWS4${secret}`, dateStamp);
  const kRegion = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, service);
  return await hmacSha256Raw(kService, "aws4_request");
}

function baseUrl() {
  const endpoint = env("RUSTFS_ENDPOINT") ?? "";
  if (!endpoint) throw new Error("Live storage requires RUSTFS_ENDPOINT.");
  return new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
}

function storageConfig() {
  const accessKey = env("RUSTFS_ACCESS_KEY");
  const secretKey = env("RUSTFS_SECRET_KEY");
  if (!accessKey || !secretKey) {
    throw new Error("Live storage requires RUSTFS_ACCESS_KEY and RUSTFS_SECRET_KEY.");
  }
  return {
    bucket: env("RUSTFS_BUCKET") ?? "societyer",
    region: env("RUSTFS_REGION") ?? "us-east-1",
    sessionToken: env("RUSTFS_SESSION_TOKEN"),
    service: env("RUSTFS_SERVICE") ?? "s3",
    accessKey,
    secretKey,
  };
}

function keyToPath(key: string) {
  return key
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

export async function presignUrl(args: {
  method: "PUT" | "GET";
  key: string;
  expiresSeconds: number;
}) {
  const config = storageConfig();
  const url = baseUrl();
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;
  const canonicalUri = `/${encodeRfc3986(config.bucket)}/${keyToPath(args.key)}`;
  const host = url.host;

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(args.expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  });
  if (config.sessionToken) {
    params.set("X-Amz-Security-Token", config.sessionToken);
  }

  const canonicalQueryString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");

  const canonicalRequest = [
    args.method,
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hex(
    await hmacSha256Raw(
      await signingKey(config.secretKey, dateStamp, config.region, config.service),
      stringToSign,
    ),
  );

  params.set("X-Amz-Signature", signature);
  return new URL(`${canonicalUri}?${params.toString()}`, url).toString();
}

export async function createDownloadUrl(args: {
  provider: StorageProviderId;
  key: string;
}): Promise<string> {
  if (args.provider === "demo") return `demo://download/${encodeURIComponent(args.key)}`;
  return await presignUrl({ method: "GET", key: args.key, expiresSeconds: 900 });
}
