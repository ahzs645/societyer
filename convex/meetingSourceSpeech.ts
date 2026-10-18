"use node";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { meetingSourceDownloadUrl } from "../shared/storage/meetingSourceGraph";
import { authorizedAction } from "./lib/authorizedServer";

function service() {
  const url = new URL(process.env.MEETING_TRANSCRIPTION_ENDPOINT ?? "https://unconfigured.invalid");
  const key = process.env.MEETING_TRANSCRIPTION_KEY;
  if (url.protocol !== "https:" || url.username || url.password || !key || key.length < 32 || url.hostname === "unconfigured.invalid") throw new Error("Configure a speech processing service before transcribing recordings.");
  return { url, key };
}

export const start = authorizedAction("meetingSourceSpeech:start", action)({
  args: { sourceId: v.id("meetingSources") }, returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const configured = service();
    const s = await ctx.runMutation(internal.meetingSources.beginSpeech, { sourceId, jobId: crypto.randomUUID() });
    if (s.alreadyStarted) return null;
    try {
      const downloadUrl = await meetingSourceDownloadUrl(process.env, s);
      const submitted = await fetch(new URL("/jobs", configured.url), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${configured.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.jobId, downloadUrl, size: s.size, fileName: s.fileName, hashes: s.hashes }),
      });
      if (!submitted.ok) throw new Error("Submission rejected.");
    } catch {
      // A lost submit response can still mean the job was accepted; polling recovers it.
    }
    await ctx.scheduler.runAfter(15_000, internal.meetingSourceSpeech.poll, { sourceId, jobId: s.jobId });
    return null;
  },
});

export const poll = internalAction({
  args: { sourceId: v.id("meetingSources"), jobId: v.string() }, returns: v.null(),
  handler: async (ctx, a) => {
    const s = await ctx.runQuery(internal.meetingSources.speechJob, a);
    if (!s) return null;
    const progress = (fields: Record<string, unknown>) => ctx.runMutation(internal.meetingSources.speechProgress, { ...a, ...fields } as any);
    if (s.accessRevoked) { await progress({ error: "Processing access was revoked." }); return null; }
    if (Date.now() - s.jobStartedAt! > 2 * 3600_000) { await progress({ error: "Speech processing timed out. The original is still attached." }); return null; }
    try {
      const configured = service();
      const response = await fetch(new URL(`/jobs/${encodeURIComponent(a.jobId)}`, configured.url), { headers: { Authorization: `Bearer ${configured.key}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (response.status === 404 && Date.now() - s.jobStartedAt! > 300_000) { await progress({ error: "Speech service did not accept the job. Check its configuration and retry." }); return null; }
      if (response.ok) {
        // Read with a strict ceiling, even when Content-Length is absent.
        let raw = ""; let length = 0; const decoder = new TextDecoder(); const reader = response.body!.getReader();
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 18_000_000) { await reader.cancel(); throw new Error("Result too large."); } raw += decoder.decode(value, { stream: true }); } } finally { reader.releaseLock(); }
        const result = JSON.parse(raw + decoder.decode());
        if (result.status === "failed") { await progress({ error: "Speech processing failed. Check the processor's provider configuration; the original remains attached." }); return null; }
        if (result.status === "complete") {
          if (typeof result.text !== "string" || !result.text.trim() || new TextEncoder().encode(result.text).length > 16_000_000) throw new Error("Invalid speech result.");
          let index = 0;
          for (let start = 0; start < result.text.length;) {
            let end = Math.min(result.text.length, start + 12_000);
            if (end < result.text.length && /[\uD800-\uDBFF]/.test(result.text[end - 1])) end--;
            await progress({ index: index++, text: result.text.slice(start, end) }); start = end;
          }
          await progress({ complete: true }); return null;
        }
      }
    } catch { /* Temporary service/network faults are retried with a bounded lifetime. */ }
    await ctx.scheduler.runAfter(60_000, internal.meetingSourceSpeech.poll, a);
    return null;
  },
});
