import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { HttpRouter } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hostedPrincipal } from "./lib/authIdentity";
import { createDeploymentSharePointAdapter, createSharePointTokenSupplier, sharePointDeployment } from "../shared/storage/sharePointDeployment";
import { MEETING_SOURCE_CHUNK_BYTES, nextUploadOffset, validateTransferUrl } from "../shared/storage/meetingSourceProtocol";
import { meetingSourceDownloadUrl } from "../shared/storage/meetingSourceGraph";

/** JSON control plane only. File bytes go through the transfer Worker. */
export function registerMeetingSourceRoutes(http: HttpRouter) {
  http.route({ path: "/meeting-sources/control", method: "POST", handler: httpAction(async (ctx, request) => {
    const configured = process.env.MEETING_SOURCE_BROKER_KEY;
    if (!configured || configured.length < 32 || request.headers.get("x-societyer-broker") !== configured) return new Response("Unavailable.", { status: 403 });
    if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") return new Response("Sign in again.", { status: 401 });
    if (Number(request.headers.get("content-length") ?? 0) > 8192) return new Response("Request too large.", { status: 413 });
    try {
      const raw = await request.text();
      if (raw.length > 8192) throw new Error("Request too large.");
      const a = JSON.parse(raw);
      const connection = sharePointDeployment(process.env);
      const supply = createSharePointTokenSupplier(process.env);
      const drive = `/drives/${encodeURIComponent(connection.driveId)}`;
      const graph = async (path: string, init: RequestInit = {}) => {
        const token = await supply({ tenantId: connection.tenantId, authorizationMode: "application", audience: "https://graph.microsoft.com" });
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(`https://graph.microsoft.com/v1.0${drive}${path}`, {
          ...init, redirect: "manual", signal: AbortSignal.timeout(25_000),
          headers,
        });
      };
      const json = async (response: Response) => {
        if (!response.ok) throw new Error("Microsoft storage request failed. Retry or check the connection.");
        return response.json();
      };
      if (a.operation === "list") return Response.json(await ctx.runQuery(internal.meetingSources.list, { meetingId: a.meetingId }));
      let sourceId = a.sourceId as Id<"meetingSources">;
      if (a.operation === "start") {
        sourceId = await ctx.runMutation(internal.meetingSources.allocate, {
          meetingId: a.meetingId, fileName: a.fileName, size: a.size, fingerprint: a.fingerprint, nonce: crypto.randomUUID(),
        });
      }
      let s: Doc<"meetingSources"> = await ctx.runQuery(internal.meetingSources.inspect, { sourceId });
      const change = async (fields: Record<string, unknown>) => ctx.runMutation(internal.meetingSources.change, { sourceId, ...fields } as any);
      const transfer = (value: string) => validateTransferUrl(value, connection.transferHosts);
      if (a.operation === "start" && s.status === "initializing") {
        await createDeploymentSharePointAdapter(process.env).verifyResource();
        const session = await json(await graph(`/root:/${encodeURIComponent(s.remoteName)}:/createUploadSession`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name: s.remoteName } }),
        }));
        const expiresAt = Date.parse(session.expirationDateTime);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Invalid Microsoft upload session.");
        await change({ operation: "session", uploadUrl: transfer(session.uploadUrl), expiresAt });
      }
      if (a.operation === "prepare") {
        await change({ operation: "lease", offset: a.offset, hash: a.hash, size: a.size, lease: a.lease });
        return Response.json({ uploadUrl: transfer(s.uploadUrl!), size: s.size });
      }
      if (a.operation === "ack") await change({ operation: "advance", lease: a.lease, offset: a.offset });
      if (a.operation === "resume" || a.operation === "ack" || a.operation === "start") {
        s = await ctx.runQuery(internal.meetingSources.inspect, { sourceId });
        if (s.status === "uploading" && s.offset < s.size && a.operation === "resume") {
          if (s.leaseUntil && s.leaseUntil > Date.now()) throw new Error("A transfer may still be running. Wait 90 seconds before resuming.");
          const response = await fetch(transfer(s.uploadUrl!), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
          let remoteOffset: number;
          if (response.status === 404 && s.pendingSize && s.offset + s.pendingSize === s.size) {
            const item = await json(await graph(`/root:/${encodeURIComponent(s.remoteName)}`));
            if (item.size !== s.size || item.name !== s.remoteName) throw new Error("Upload session expired. Cancel and upload again.");
            remoteOffset = s.size;
          } else {
            remoteOffset = nextUploadOffset((await json(response)).nextExpectedRanges, s.size);
          }
          if (remoteOffset !== s.offset) await change({ operation: "advance", lease: s.lease, offset: remoteOffset });
        }
        s = await ctx.runQuery(internal.meetingSources.inspect, { sourceId });
        if (s.status === "uploading" && s.offset === s.size) {
          const item = await json(await graph(`/root:/${encodeURIComponent(s.remoteName)}`));
          if (item.size !== s.size || item.name !== s.remoteName || item.parentReference?.driveId !== connection.driveId || !item.file) throw new Error("Stored file does not match this upload.");
          const versions = await json(await graph(`/items/${encodeURIComponent(item.id)}/versions?$top=1`));
          const version = versions.value?.[0];
          if (!version?.id || version.size !== s.size) throw new Error("A pinned storage version is required.");
          await change({ operation: "uploaded", itemId: item.id, eTag: item.eTag, versionId: version.id });
        }
      }
      if (a.operation === "download" || a.operation === "verify") {
        if (a.operation === "download" && s.status !== "ready" || a.operation === "verify" && s.status !== "verifying") throw new Error("File is not available for this operation.");
        const offset = a.operation === "verify" ? s.verifiedOffset : a.offset;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset >= s.size || offset % MEETING_SOURCE_CHUNK_BYTES) throw new Error("Invalid download range.");
        return Response.json({ downloadUrl: await meetingSourceDownloadUrl(process.env, s), size: s.size, fileName: s.fileName,
          offset, length: Math.min(MEETING_SOURCE_CHUNK_BYTES, s.size - offset), hash: s.hashes[Math.floor(offset / MEETING_SOURCE_CHUNK_BYTES)] });
      }
      if (a.operation === "verified") await change({ operation: "verified", offset: a.offset, hash: a.hash });
      if (a.operation === "cancel") {
        // Revoke application access first; interrupted remote cancellation cannot reopen it.
        await change({ operation: "cancel" });
        if (s.uploadUrl) await fetch(transfer(s.uploadUrl), { method: "DELETE", redirect: "manual", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      }
      s = await ctx.runQuery(internal.meetingSources.inspect, { sourceId });
      return Response.json({ id: s._id, status: s.status, offset: s.offset, size: s.size, verifiedOffset: s.verifiedOffset });
    } catch (error) {
      // Never forward upstream bodies, URLs, tokens or arbitrary exceptions.
      const message = error instanceof Error && /^(A transfer may|A chunk is|Upload session expired|Files must|Choose TXT)/.test(error.message)
        ? error.message : "Transfer unavailable. Check access, retry, or cancel and restart an expired upload.";
      return Response.json({ error: message }, { status: 400 });
    }
  }) });
}
