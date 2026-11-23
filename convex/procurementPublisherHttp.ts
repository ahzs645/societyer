import type { HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const PUBLISHER_BODY_LIMIT = 64 * 1024;
const headers = { "Cache-Control": "no-store" };
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");

/** Null when the body is missing, too large or not a `{ operation, data }` object. */
async function readRequest(request: Request): Promise<{ operation: string; data?: unknown } | null> {
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > PUBLISHER_BODY_LIMIT) { await reader.cancel(); return null; } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const { operation, data } = body as { operation?: unknown; data?: unknown };
    return typeof operation === "string" && operation.length <= 40 ? { operation, data } : null;
  } catch { return null; }
}

/**
 * Server-to-server publisher access (Zoer's backend). `Authorization: Bearer
 * <64 lowercase hex>`; the key is looked up by its SHA-256. No CORS: browsers
 * never call this route.
 */
export function registerProcurementPublisherRoutes(http: HttpRouter) {
  http.route({ path: "/procurement-publisher", method: "POST", handler: httpAction(async (ctx, request) => {
    const key = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!key) return Response.json({ error: "Access denied." }, { status: 403, headers });
    // An unreadable body still goes through the key check first, so an unknown
    // caller always sees 403 rather than learning anything about the format.
    const body = await readRequest(request);
    const keyHash = await digest(key);
    const dispatch = (operation: string, data?: unknown) => ctx.runMutation(internal.procurementPublisher.dispatch, { keyHash, operation, ...(data !== undefined ? { data } : {}) });
    // JSON that Convex cannot store (for example a "$"-prefixed field) fails
    // before the handler runs; dispatch again without it so the key is still checked.
    const outcome = await dispatch(body?.operation ?? "", body?.data).catch(() => dispatch(""));
    if (outcome.status === "denied") return Response.json({ error: "Access denied." }, { status: 403, headers });
    // No receipt contents, validation detail or catalog configuration in the response.
    if (outcome.status !== "ok") return Response.json({ error: "Publisher request rejected. Check the workspace, folder and receipt." }, { status: 409, headers });
    return Response.json(outcome.result ?? null, { headers });
  }) });
}
