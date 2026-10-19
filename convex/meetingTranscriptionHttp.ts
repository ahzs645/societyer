import type { HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { meetingSourceDownloadUrl } from "../shared/storage/meetingSourceGraph";
import { MEETING_SOURCE_CHUNK_BYTES } from "../shared/storage/meetingSourceProtocol";

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
export function registerMeetingTranscriptionRoutes(http: HttpRouter) {
  http.route({ path: "/meeting-transcription/control", method: "POST", handler: httpAction(async (ctx, request) => {
    const broker = process.env.MEETING_SOURCE_BROKER_KEY;
    const key = request.headers.get("x-transcription-key") ?? "";
    if (!broker || request.headers.get("x-societyer-broker") !== broker || !/^[a-f0-9]{64}$/.test(key)) return new Response("Access denied.", { status: 403 });
    try {
      // The transfer Worker bounds the body before forwarding it. Bound it here too.
      const reader = request.body?.getReader(); if (!reader) throw Error("Body required.");
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 210_000) { await reader.cancel(); throw Error("Request too large."); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (!body || !["status", "settings", "cancel", "claim", "download", "heartbeat", "page", "complete", "fail"].includes(body.operation) || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw Error("Invalid request.");
      if (body.operation === "page") body.data.hash = await digest(JSON.stringify(body.data.segments));
      const result = await ctx.runMutation(internal.meetingTranscription.processor, { keyHash: await digest(key), operation: body.operation, data: body.data, nonce: crypto.randomUUID() });
      if (body.operation !== "download") return Response.json(result, { headers: { "Cache-Control": "no-store" } });
      const { source, offset: start } = result;
      return Response.json({ downloadUrl: await meetingSourceDownloadUrl(process.env, source), offset: start, size: source.size, length: Math.min(MEETING_SOURCE_CHUNK_BYTES, source.size - start), hash: source.hashes[start / MEETING_SOURCE_CHUNK_BYTES] }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      // No upstream URLs, credentials, recording contents or provider diagnostics.
      return Response.json({ error: "Processor request rejected. Check the connection, lease and result format." }, { status: 409 });
    }
  }) });
}
