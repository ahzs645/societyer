import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, readFileSync, statSync, realpathSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { openCatalog, catalogMeta, readRow, readRows, boundedReviews, sqliteSelfTest } from "./database";
import { CatalogHttpError, grantVerifier, safeIdentifier, type WorkspaceBinding } from "./grants";
import { currentPath, previousPath, releasePath, switchCurrent, type ActivationReceipt, type ActivationRequest } from "./releases";
import { AnalysisWorker, prepareInWorker, qualifyInWorker } from "./workers";

export type ServiceConfig = { root: string; issuer: string; publicKeys: Record<string, string>; workspaces: WorkspaceBinding[]; origins: string[]; adminSecret: string; onError?: (error: unknown) => void };
type Runtime = { directory: string; receipt: ActivationReceipt; db: ReturnType<typeof openCatalog>; analysis: AnalysisWorker; readers: number; retired: boolean };
const fail = (status: number, message: string): never => { throw new CatalogHttpError(status, message); };
async function body(request: IncomingMessage, maximum: number): Promise<any> {
  if (!request.headers["content-type"]?.startsWith("application/json")) fail(415, "Use application/json.");
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += chunk.length; if (size > maximum) fail(413, "Request exceeds the limit."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail(400, "Invalid JSON."); }
}
function json(response: ServerResponse, status: number, value: unknown) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 8_000_000) fail(413, "Result exceeds the response limit.");
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" }); response.end(encoded);
}
/** No deployment or network side effects on import; fixtures exercise this same listener. */
export async function createCatalogService(config: ServiceConfig) {
  sqliteSelfTest();
  if (config.adminSecret.length < 32) throw new Error("A dedicated administrator secret of at least 32 characters is required.");
  const root = realpathSync(resolve(config.root)), verify = grantVerifier(config.issuer, config.publicKeys, config.workspaces);
  const bindings = new Map(config.workspaces.map(binding => [binding.societyId, binding.folder]));
  const origins = new Set(config.origins);
  for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error("CORS entries must be exact origins.");
  const runtimes = new Map<string, Runtime>(), activating = new Set<string>();
  const runtimeKey = (workspace: string, publication: string) => workspace + "/" + publication;
  async function load(directory: string): Promise<Runtime> {
    const receipt = JSON.parse(readFileSync(join(directory, "receipt.json"), "utf8")) as ActivationReceipt;
    if (bindings.get(receipt.societyId) !== receipt.folder || directory !== releasePath(root, receipt.societyId, receipt.publicationId)) throw new Error("Release binding differs from the configured workspace.");
    const key = runtimeKey(receipt.societyId, receipt.publicationId), prior = runtimes.get(key); if (prior) return prior;
    const db = openCatalog(join(directory, "catalog.sqlite"));
    let analysis: AnalysisWorker | undefined;
    try {
      const meta = catalogMeta(db);
      if (meta.inventoryHash !== receipt.inventoryHash || meta.societyId !== receipt.societyId || meta.folder !== receipt.folder || meta.generation !== receipt.generation) throw new Error("Release metadata differs from its receipt.");
      analysis = new AnalysisWorker(directory); await analysis.ready;
      const runtime = { directory, receipt, db, analysis, readers: 0, retired: false }; runtimes.set(key, runtime); return runtime;
    } catch (error) { db.close(); analysis?.close(); throw error; }
  }
  for (const binding of config.workspaces) { const directory = currentPath(root, binding.societyId); if (directory) await load(directory); }
  const inFlightLoads = new Map<string, Promise<Runtime>>();
  const dispose = (runtime: Runtime) => { runtime.db.close(); runtime.analysis.close(); rmSync(runtime.directory, { recursive: true, force: true }); };
  function retained(workspace: string) {
    return [currentPath(root, workspace), previousPath(root, workspace)].filter((v): v is string => !!v);
  }
  async function publication(workspace: string, id: string) {
    const directory = releasePath(root, workspace, id);
    if (!retained(workspace).includes(directory)) fail(410, "This publication is no longer available. Reload the catalog.");
    const key = runtimeKey(workspace, id), prior = runtimes.get(key); if (prior) return prior;
    if (!inFlightLoads.has(key)) {
      try { statSync(join(directory, "receipt.json")); } catch { fail(410, "This publication is no longer available. Reload the catalog."); }
      inFlightLoads.set(key, load(directory).finally(() => inFlightLoads.delete(key)));
    }
    return inFlightLoads.get(key)!;
  }
  const handler = async (request: IncomingMessage, response: ServerResponse, operator: boolean) => {
    let reading: Runtime | undefined;
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Vary", "Authorization, Origin, Accept-Encoding");
    try {
      const origin = request.headers.origin;
      if (origin) {
        if (!origins.has(origin)) fail(403, "This site is not allowed to read the catalog.");
        response.setHeader("Access-Control-Allow-Origin", origin);
      }
      if (request.method === "OPTIONS") {
        if (!origin || !origins.has(origin)) fail(403, "Origin required.");
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" }); response.end(); return;
      }
      const url = new URL(request.url ?? "/", "http://catalog.invalid"), path = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/healthz" && request.method === "GET") { json(response, 200, { ok: true, activeWorkspaces: config.workspaces.filter(w => currentPath(root, w.societyId)).length }); return; }
      if (path[0] === "admin") {
        // The public listener cannot serve operator routes, including normalized
        // path variants. Publishing uses a separate loopback-only listener.
        if (!operator) fail(404, "Unknown catalog route.");
        const supplied = Buffer.from(request.headers.authorization ?? ""), expected = Buffer.from("Bearer " + config.adminSecret);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(401, "Administrator authentication required.");
        if (url.pathname === "/admin/status" && request.method === "GET") {
          json(response, 200, { workspaces: config.workspaces.map(w => { const current = currentPath(root, w.societyId); return { societyId: w.societyId, activating: activating.has(w.societyId), current: current ? JSON.parse(readFileSync(join(current, "receipt.json"), "utf8")) : null }; }) }); return;
        }
        if (url.pathname === "/admin/qualify" && request.method === "POST") {
          const input = await body(request, 2000);
          if (!bindings.has(input.societyId)) fail(403, "Workspace is not enabled.");
          const runtime = await publication(input.societyId, safeIdentifier(input.publicationId)); reading = runtime; runtime.readers++;
          if (activating.has(input.societyId)) fail(409, "A publication operation is already running.");
          activating.add(input.societyId);
          try { json(response, 200, await qualifyInWorker(runtime.directory, input.asOf)); }
          finally { activating.delete(input.societyId); }
          return;
        }
        if (url.pathname !== "/admin/activate" || request.method !== "POST") fail(404, "Unknown operator route.");
        const input = await body(request, 2000) as ActivationRequest;
        safeIdentifier(input.societyId); safeIdentifier(input.publicationId);
        if (!bindings.has(input.societyId)) fail(403, "Workspace is not enabled on this service.");
        if (activating.has(input.societyId)) fail(409, "A publication is already being prepared for this workspace.");
        activating.add(input.societyId);
        try {
          const prepared = await prepareInWorker(root, input);
          if (prepared.receipt.folder !== bindings.get(input.societyId)) fail(409, "Publication folder differs from the configured workspace.");
          const prior = currentPath(root, input.societyId);
          if (prior && Date.parse(JSON.parse(readFileSync(join(prior, "receipt.json"), "utf8")).publishedAt) > Date.parse(prepared.receipt.publishedAt)) fail(409, "An older publication cannot replace the serving catalog.");
          await load(prepared.directory); // warm all analytics before changing the pointer
          switchCurrent(root, prepared.receipt);
          const keep = new Set(retained(input.societyId));
          for (const [key, runtime] of runtimes) if (runtime.receipt.societyId === input.societyId && !keep.has(runtime.directory)) {
            runtimes.delete(key); runtime.retired = true; if (!runtime.readers) dispose(runtime);
          }
          json(response, 200, { ...prepared.receipt, state: "ready" });
        } finally { activating.delete(input.societyId); }
        return;
      }
      if (path[0] !== "v1" || !path[1]) fail(404, "Unknown catalog route.");
      const workspace = safeIdentifier(path[1]); verify(request.headers.authorization, workspace);
      if (path.length === 3 && path[2] === "catalog" && request.method === "GET") {
        const directory = currentPath(root, workspace);
        if (!directory) { json(response, 200, null); return; }
        const { receipt } = await load(directory);
        json(response, 200, { generation: receipt.generation, publicationId: receipt.publicationId, publishedAt: receipt.publishedAt, counts: receipt.counts }); return;
      }
      if (path[2] !== "p" || !path[3]) fail(404, "Unknown catalog route.");
      const runtime = await publication(workspace, safeIdentifier(path[3])), { db, directory } = runtime;
      reading = runtime; runtime.readers++;
      // Time-sensitive analyses have their own clock and cannot be cached immutably.
      if (path.length === 5 && path[4] === "analysis" && request.method === "POST") {
        const input = await body(request, 8000);
        const result = await runtime.analysis.request(input.request, input.asOf);
        json(response, 200, { result: JSON.parse(result.resultJson), asOf: result.asOf, computedAt: Date.now() }); return;
      }
      if (request.method !== "GET") fail(405, "Method not allowed.");
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      if (path.length === 6 && path[4] === "list" && /^(opportunity|award)\.json$/.test(path[5])) {
        const file = join(directory, "list-" + path[5] + ".gz");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (/\bgzip\b/.test(request.headers["accept-encoding"] ?? "")) {
          response.setHeader("Content-Encoding", "gzip"); response.setHeader("Content-Length", statSync(file).size);
          const stream = createReadStream(file); stream.on("error", () => response.destroy()); response.on("close", () => stream.destroy()); stream.pipe(response);
        } else response.end(gunzipSync(readFileSync(file)));
        return;
      }
      const key = url.searchParams.get("key") ?? "";
      if (key.length > 500) fail(400, "Record key is too long.");
      if (path.length === 5 && path[4] === "notice") {
        const notice = readRow(db, "procurementRecords", key), detail = readRow(db, "procurementDetails", key);
        json(response, 200, notice ? { summary: notice.row, dataJson: detail?.row.dataJson ?? "{}", documents: readRows(db, "procurementDocuments", key, notice.removed), removed: notice.removed } : null); return;
      }
      if (path.length === 5 && (path[4] === "review" || path[4] === "reviews")) {
        const { rows, truncated } = boundedReviews(db, path[4] === "review" ? key : undefined);
        json(response, 200, { rows: rows.map(row => ({ recordKey: row.recordKey, source: row.source, dataJson: row.dataJson })), truncated }); return;
      }
      if (path.length === 5 && path[4] === "search") {
        const query = (url.searchParams.get("q") ?? "").trim(), kind = url.searchParams.get("kind") ?? "opportunity";
        const limit = Number(url.searchParams.get("limit") ?? 100);
        if (query.length < 2 || query.length > 200 || !["opportunity", "award"].includes(kind) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "Use 2–200 search characters, a valid kind, and a limit of 1–100.");
        const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
        if (!terms.length) { json(response, 200, { matches: [], truncated: false }); return; }
        const expression = terms.slice(0, 20).map(term => '"' + term.replaceAll('"', '""') + '"*').join(" AND ");
        const matches = db.prepare(`SELECT f.record_key AS recordKey, f.title AS title, snippet(notice_text,2,'','', ' … ',24) AS snippet FROM notice_text f JOIN notices n ON n.rowid=f.rowid WHERE notice_text MATCH ? AND n.active=1 AND json_extract(n.source_json,'$.kind')=? ORDER BY rank LIMIT ?`).all(expression, kind, limit + 1);
        json(response, 200, { matches: matches.slice(0, limit), truncated: matches.length > limit }); return;
      }
      fail(404, "Unknown catalog route.");
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = error instanceof CatalogHttpError ? error.status : 503;
      response.setHeader("Cache-Control", "no-store");
      // Detailed failure stays in operator logs, without request/token/body data.
      if (!(error instanceof CatalogHttpError)) { config.onError?.(error); console.error("catalog_request_failed", error instanceof Error ? error.name : "UnknownError"); }
      json(response, status, { error: error instanceof CatalogHttpError ? error.message : "The catalog could not complete this request. Retry shortly." });
    } finally {
      const runtime = reading;
      if (runtime) {
        let released = false;
        const release = () => { if (released) return; released = true; if (--runtime.readers === 0 && runtime.retired) dispose(runtime); };
        if (response.writableFinished || response.destroyed) release(); else { response.once("finish", release); response.once("close", release); }
      }
    }
  };
  const server = createServer((request, response) => void handler(request, response, false));
  const adminServer = createServer((request, response) => void handler(request, response, true));
  for (const listener of [server, adminServer]) { listener.requestTimeout = 11 * 60_000; listener.headersTimeout = 15_000; listener.keepAliveTimeout = 5000; }
  server.on("close", () => { adminServer.close(); for (const runtime of runtimes.values()) { runtime.db.close(); runtime.analysis.close(); } });
  return Object.assign(server, { adminServer });
}
