import "dotenv/config";
import express from "express";
import { getMigrations } from "better-auth/db/migration";
import { toNodeHandler } from "better-auth/node";
import { auth, getAuthMode } from "./auth-config";

const port = Number(process.env.AUTH_SERVER_PORT ?? 8787);

async function main() {
  if (getAuthMode() !== "better-auth") {
    console.log("[societyer-auth] AUTH_MODE is not better-auth; server not started.");
    return;
  }

  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();

  const app = express();
  const handler = toNodeHandler(auth);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, mode: "better-auth" });
  });

  app.all("/api/auth", handler);
  app.all("/api/auth/*splat", handler);

  app.listen(port, () => {
    console.log(`[societyer-auth] listening on http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error("[societyer-auth] failed to start", error);
  process.exitCode = 1;
});
