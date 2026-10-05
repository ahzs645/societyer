import assert from "node:assert/strict";
import { createServer } from "vite";

const previousFetch = globalThis.fetch;
const previousWindow = (globalThis as any).window;
const saved = { VITE_AUTH_MODE: process.env.VITE_AUTH_MODE, VITE_RUNTIME_MODE: process.env.VITE_RUNTIME_MODE, VITE_CONVEX_URL: process.env.VITE_CONVEX_URL };
process.env.VITE_AUTH_MODE = "clerk";
process.env.VITE_RUNTIME_MODE = "server";
process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
(globalThis as any).window = { location: { pathname: "/app", origin: "http://127.0.0.1:4177" }, localStorage: { getItem: () => null } };
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });
try {
  const auth = await server.ssrLoadModule("/src/lib/authToken.ts");
  const stream = await server.ssrLoadModule("/src/lib/aiChatStream.ts");
  const cleanup = auth.registerAuthTokenGetter(async () => "synthetic-fixture-token");
  const attachment = { name: "synthetic.txt", mediaType: "text/plain", text: "Synthetic source content" };
  const args = { societyId: "a", content: "Summarize", attachments: [attachment], onToken: (_token: string) => {} };
  let requests = 0;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    requests++;
    body = JSON.parse(String(init?.body));
    return new Response('event: ready\ndata: {"threadId":"saved-thread"}\n\nevent: token\ndata: {"text":"A response"}\n\nevent: done\ndata: {"messageId":"saved-message"}\n\n', { headers: { "content-type": "text/event-stream" } });
  };
  let threadId = "";
  assert.equal((await stream.streamChatMessage({ ...args, onThreadReady: (id: string) => { threadId = id; } })).messageId, "saved-message");
  assert.deepEqual(body.attachments, [attachment]);
  assert.equal(threadId, "saved-thread");
  assert.equal(requests, 1);
  console.log("PASS authenticated stream request carries attachment content and saved-thread identity");
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => { requests++; return new Response("Rejected", { status }); };
    await assert.rejects(stream.streamChatMessage(args), (error: unknown) => !stream.isChatStreamUnavailable(error));
  }
  for (const status of [404, 405]) {
    globalThis.fetch = async () => { requests++; return new Response("Absent", { status }); };
    await assert.rejects(stream.streamChatMessage(args), (error: unknown) => stream.isChatStreamUnavailable(error));
  }
  globalThis.fetch = async () => new Response('event: ready\ndata: {"threadId":"saved-thread"}\n\nevent: token\ndata: {"text":"Partial"}\n\n');
  await assert.rejects(stream.streamChatMessage(args), /ended before the response completed/);
  globalThis.fetch = async () => new Response('event: error\ndata: {"threadId":"error-thread","error":"Fixture provider unavailable"}\n\n');
  await assert.rejects(stream.streamChatMessage({ ...args, onThreadReady: (id: string) => { threadId = id; } }), /Fixture provider unavailable/);
  assert.equal(threadId, "error-thread");
  cleanup();
  console.log("PASS authorization/provider/network failures are never marked safe for automatic action replay; incomplete streams fail and retain saved-thread identity");
} finally {
  await server.close();
  globalThis.fetch = previousFetch;
  (globalThis as any).window = previousWindow;
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
