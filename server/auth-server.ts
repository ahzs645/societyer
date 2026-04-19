import "./env";
import express from "express";
import { getMigrations } from "better-auth/db/migration";
import { toNodeHandler } from "better-auth/node";
import { auth, getAuthMode } from "./auth-config";
import { mountApiGateway } from "./api-gateway";

const port = Number(process.env.AUTH_SERVER_PORT ?? 8787);

async function main() {
  const authMode = getAuthMode();

  const app = express();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, mode: authMode, api: true });
  });

  if (authMode === "better-auth") {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();

    const handler = toNodeHandler(auth);
    app.all("/api/auth", handler);
    app.all("/api/auth/*splat", handler);
  } else {
    app.all("/api/auth", (_req, res) => {
      res.status(404).json({ error: "Better Auth is disabled" });
    });
    app.all("/api/auth/*splat", (_req, res) => {
      res.status(404).json({ error: "Better Auth is disabled" });
    });
  }

  mountApiGateway(app);

  app.listen(port, () => {
    console.log(`[societyer-auth] listening on http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error("[societyer-auth] failed to start", error);
  process.exitCode = 1;
});
