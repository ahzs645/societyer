import { transcriptionRequest } from "./transcription";
import { MEETING_SOURCE_CHUNK_BYTES, nextUploadOffset, validateTransferUrl } from "../../shared/storage/meetingSourceProtocol";
import { readBoundedSharePointUpload } from "../../shared/storage/sharePointDeployment";

type Env = { CONVEX_SITE_URL: string; SITE_ORIGIN: string; MEETING_SOURCE_BROKER_KEY: string; SHAREPOINT_TRANSFER_HOSTS: string };
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), b => b.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Origin" });
    if (origin && origin !== env.SITE_ORIGIN) return new Response("Origin denied.", { status: 403 });
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, PUT, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (new URL(request.url).pathname === "/meeting-transcription") return transcriptionRequest(request, env);
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return new Response("Sign in again.", { status: 401, headers });
    const path = new URL(request.url).pathname;
    const operation = path.match(/^\/meeting-sources\/(start|list|resume|cancel|chunk|verify|download)$/)?.[1];
    if (!operation || request.method !== (operation === "chunk" ? "PUT" : "POST")) return new Response("Not found.", { status: 404, headers });
    try {
      const control = async (data: Record<string, unknown>) => {
        const response = await fetch(new URL("/meeting-sources/control", env.CONVEX_SITE_URL), {
          // Workers rejects redirect:"error" at runtime. Never follow a redirect
          // carrying the user's token and the private control-plane credential.
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(50_000),
          headers: { Authorization: authorization, "x-societyer-broker": env.MEETING_SOURCE_BROKER_KEY, "Content-Type": "application/json" }, body: JSON.stringify(data),
        });
        if (response.status >= 300 && response.status < 400) throw new Error("Transfer unavailable. Unexpected control redirect.");
        if (!response.ok) console.warn("Meeting source control request rejected", { status: response.status });
        if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
          console.warn("Meeting source control returned a non-JSON response", { status: response.status });
          throw new Error("Transfer unavailable. Check the file transfer connection.");
        }
        const result = await response.json() as any;
        if (!response.ok) throw new Error(result.error || "Access denied or storage unavailable.");
        return result;
      };
      const transfer = (value: string) => validateTransferUrl(value, env.SHAREPOINT_TRANSFER_HOSTS.split(",").map(s => s.trim()));
      if (operation === "chunk") {
        const url = new URL(request.url);
        const sourceId = url.searchParams.get("sourceId");
        const offset = Number(url.searchParams.get("offset"));
        const size = Number(url.searchParams.get("size"));
        if (!sourceId || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid chunk.");
        await control({ operation: "status", sourceId });
        const bytes = await readBoundedSharePointUpload(request, size, MEETING_SOURCE_CHUNK_BYTES);
        const hash = await digest(bytes); const lease = crypto.randomUUID();
        const prepared = await control({ operation: "prepare", sourceId, offset, size, hash, lease });
        const end = offset + size;
        const response = await fetch(transfer(prepared.uploadUrl), {
          method: "PUT", redirect: "manual", signal: AbortSignal.timeout(60_000),
          headers: { "Content-Length": String(size), "Content-Range": `bytes ${offset}-${end - 1}/${prepared.size}` }, body: bytes as BodyInit,
        });
        if (end < prepared.size) {
          if (response.status !== 202 || nextUploadOffset((await response.json() as any).nextExpectedRanges, prepared.size) !== end) throw new Error("Chunk was not acknowledged. Resume the upload after 90 seconds.");
        } else if (response.status !== 200 && response.status !== 201) throw new Error("Final chunk was not acknowledged. Resume after 90 seconds.");
        const result = await control({ operation: "ack", sourceId, offset: end, lease });
        return Response.json(result, { headers });
      }
      const raw = await readBoundedJson(request);
      if (operation === "verify" || operation === "download") {
        const pinned = await control({ operation, sourceId: raw.sourceId, ...(operation === "download" ? { offset: raw.offset } : {}) });
        const response = await fetch(transfer(pinned.downloadUrl), {
          redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Range: `bytes=${pinned.offset}-${pinned.offset + pinned.length - 1}` },
        });
        if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${pinned.offset}-${pinned.offset + pinned.length - 1}/${pinned.size}`) throw new Error("Stored range unavailable.");
        const bytes = await readBoundedSharePointUpload(new Request("https://storage.invalid", { method: "PUT", body: response.body, duplex: "half" } as RequestInit), pinned.length, MEETING_SOURCE_CHUNK_BYTES);
        const hash = await digest(bytes);
        if (hash !== pinned.hash) throw new Error("Stored file checksum mismatch. Cancel this upload and retry.");
        if (operation === "download") {
          headers.set("Content-Type", "application/octet-stream"); headers.set("Content-Length", String(bytes.length));
          return new Response(bytes as BodyInit, { headers });
        }
        return Response.json(await control({ operation: "verified", sourceId: raw.sourceId, offset: pinned.offset, hash }), { headers });
      }
      return Response.json(await control({ ...raw, operation }), { headers });
    } catch (error) {
      // All errors originate in our fixed messages/control plane; no upstream bodies are reflected.
      const safe = error instanceof Error && /^(Transfer unavailable|Access denied|A transfer may|A chunk is|Upload session expired|Files must|Choose TXT|Invalid chunk|Chunk was not|Final chunk was not|Stored range unavailable|Stored file checksum|Stored file unavailable|Request too large|Request required|SharePoint upload|A file body)/.test(error.message);
      return Response.json({ error: safe ? (error as Error).message : "File transfer failed. Retry or check access and the storage connection." }, { status: 400, headers });
    }
  },
};

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request required.");
  let text = ""; let size = 0; const decoder = new TextDecoder();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new Error("Request too large."); } text += decoder.decode(value, { stream: true }); }
  } finally { reader.releaseLock(); }
  return JSON.parse(text + decoder.decode());
}
