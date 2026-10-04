import assert from "node:assert/strict";
import { createServer } from "vite";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as any).window;
const originalMode = process.env.VITE_AUTH_MODE;
const originalRuntime = process.env.VITE_RUNTIME_MODE;

async function checkMode(mode: string, runtime: string, requiresToken: boolean) {
  process.env.VITE_AUTH_MODE = mode;
  process.env.VITE_RUNTIME_MODE = runtime;
  const browser = {
    location: { pathname: "/app", origin: "https://app.example.test" },
    localStorage: { getItem: (_key: string): string | null => null },
  };
  (globalThis as any).window = browser;
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const auth = await server.ssrLoadModule("/src/lib/authToken.ts");
    const documents = await server.ssrLoadModule("/src/lib/documentDownload.ts");
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { input, init };
      return new Response("{}", { status: 200 });
    };

    if (requiresToken) {
      await assert.rejects(auth.authenticatedFetch("/api/v1/test"), /Sign in again/);
      assert.equal(request, undefined, "Missing session must not send an anonymous request");
      const cleanupOld = auth.registerAuthTokenGetter(async () => "old-session");
      const cleanupActive = auth.registerAuthTokenGetter(async () => {
        await Promise.resolve();
        return "session-jwt";
      });
      cleanupOld();
      await auth.authenticatedFetch("/api/v1/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer session-jwt");
      assert.equal(new Headers(request?.init?.headers).get("content-type"), "application/json");
      assert.equal(request?.init?.body, "{}");
      for (const url of [
        "/api/v1/workflow-generated-documents/file-id?societyId=society-a",
        "https://app.example.test/api/v1/workflow-generated-documents/file-id?societyId=society-a",
      ]) {
        await documents.fetchDocumentDownload(url);
        assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer session-jwt");
        assert.equal(request?.init?.redirect, "error", "Authenticated file fetches must reject redirects");
      }
      for (const url of [
        "https://bucket.example.test/file?signature=signed",
        "https://company.sharepoint.com/documents/file",
        "https://other.example.test/api/v1/workflow-generated-documents/file-id",
        "https://app.example.test/api/v1/other-endpoint",
        "//other.example.test/api/v1/workflow-generated-documents/file-id",
        "https://user:password@app.example.test/api/v1/workflow-generated-documents/file-id",
        "data:application/pdf;base64,AA==",
        "blob:https://app.example.test/file-id",
      ]) {
        await documents.fetchDocumentDownload(url);
        assert.equal(new Headers(request?.init?.headers).has("authorization"), false,
          `Must not send the session token to ${url}`);
      }
      cleanupActive();
      await assert.rejects(auth.getAuthToken(), /Sign in again/);

      browser.location.pathname = "/demo";
      await auth.authenticatedFetch("/api/v1/demo");
      assert.equal(new Headers(request?.init?.headers).has("authorization"), false);
      browser.location.pathname = "/app";
      browser.localStorage.getItem = () => JSON.stringify({ mode: "local", workspaceId: "test-workspace" });
    }
    await auth.authenticatedFetch("/api/v1/local");
    assert.equal(new Headers(request?.init?.headers).has("authorization"), false,
      "Local and no-auth runtimes must retain their existing bypass");
    console.log(`PASS auth tokens: ${mode} / ${runtime}`);
  } finally {
    await server.close();
  }
}

try {
  await checkMode("clerk", "convex-cloud", true);
  await checkMode("better-auth", "convex-self-hosted", true);
  await checkMode("none", "convex-self-hosted", false);
  await checkMode("clerk", "local-indexeddb", false);
  await checkMode("clerk", "electron-local", false);
} finally {
  globalThis.fetch = originalFetch;
  (globalThis as any).window = originalWindow;
  if (originalMode === undefined) delete process.env.VITE_AUTH_MODE;
  else process.env.VITE_AUTH_MODE = originalMode;
  if (originalRuntime === undefined) delete process.env.VITE_RUNTIME_MODE;
  else process.env.VITE_RUNTIME_MODE = originalRuntime;
}
