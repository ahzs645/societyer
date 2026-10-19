import { MEETING_SOURCE_CHUNK_BYTES, validateTransferUrl } from "../../shared/storage/meetingSourceProtocol";
import { readBoundedSharePointUpload } from "../../shared/storage/sharePointDeployment";

type Env = { CONVEX_SITE_URL: string; MEETING_SOURCE_BROKER_KEY: string; SHAREPOINT_TRANSFER_HOSTS: string };
export async function transcriptionRequest(request: Request, env: Env): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (request.method !== "POST") return new Response("Not found.", { status: 404, headers });
  const key = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!key) return new Response("Access denied.", { status: 403, headers });
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 210_000) { await reader.cancel(); return new Response("Request too large.", { status: 413, headers }); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const response = await fetch(new URL("/meeting-transcription/control", env.CONVEX_SITE_URL), { method: "POST", redirect: "manual", signal: AbortSignal.timeout(55_000), headers: { "Content-Type": "application/json", "x-transcription-key": key, "x-societyer-broker": env.MEETING_SOURCE_BROKER_KEY }, body: bytes });
    if (!response.ok) return Response.json({ error: "Processor request rejected." }, { status: response.status === 409 ? 409 : 403, headers });
    const result = await response.json() as any;
    if (body.operation !== "download") return Response.json(result, { headers });
    const url = validateTransferUrl(result.downloadUrl, env.SHAREPOINT_TRANSFER_HOSTS.split(",").map(s => s.trim()));
    const range = `bytes ${result.offset}-${result.offset + result.length - 1}/${result.size}`;
    const remote = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Range: `bytes=${result.offset}-${result.offset + result.length - 1}` } });
    if (remote.status !== 206 || remote.headers.get("content-range") !== range) throw Error();
    const payload = await readBoundedSharePointUpload(new Request("https://storage.invalid", { method: "PUT", body: remote.body, duplex: "half" } as RequestInit), result.length, MEETING_SOURCE_CHUNK_BYTES);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", payload as BufferSource)), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== result.hash) throw Error();
    return new Response(payload as BodyInit, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(payload.length), "X-Content-SHA256": hash } });
  } catch {
    return Response.json({ error: "Recording range unavailable. Retry while the processing lease is active." }, { status: 502, headers });
  }
}
