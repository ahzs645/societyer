import "./env";
import express from "express";
import { getMigrations } from "better-auth/db/migration";
import { toNodeHandler } from "better-auth/node";
import { auth, getAuthMode, microsoftSsoConfig } from "./auth-config";
import { mountApiGateway } from "./api-gateway";
import { clerkVerificationConfig } from "./clerk-auth";
import { microsoftProviderDiscovery } from "./microsoft-sso";

const port = Number(process.env.AUTH_SERVER_PORT ?? 8787);

async function main() {
  const authMode = getAuthMode();
  if (authMode === "clerk") clerkVerificationConfig();

  const app = express();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, mode: authMode, api: true });
  });

  app.get("/api/auth/providers", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(microsoftProviderDiscovery(authMode, microsoftSsoConfig));
  });

  if (authMode === "better-auth" || authMode === "clerk") {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  }

  if (authMode === "better-auth") {
    const handler = toNodeHandler(auth);
    app.all("/api/auth", handler);
    app.all("/api/auth/*splat", handler);
  } else if (authMode === "clerk") {
    // The gateway still signs bounded machine calls. Only its public signing
    // keys are exposed; Clerk owns all user authentication endpoints.
    app.get("/api/auth/jwks", async (_req, res, next) => {
      try {
        res.json(await auth.api.getJwks());
      } catch (error) {
        next(error);
      }
    });
    app.all("/api/auth", (_req, res) => {
      res.status(404).json({ error: "User authentication is managed by Clerk" });
    });
    app.all("/api/auth/*splat", (_req, res) => {
      res.status(404).json({ error: "User authentication is managed by Clerk" });
    });
  } else {
    app.all("/api/auth", (_req, res) => {
      res.status(404).json({ error: "Better Auth is disabled" });
    });
    app.all("/api/auth/*splat", (_req, res) => {
      res.status(404).json({ error: "Better Auth is disabled" });
    });
  }

  mountApiGateway(app);

  const server = app.listen(port, () => {
    const address = server.address();
    const boundPort = address && typeof address !== "string" ? address.port : port;
    console.log(`[societyer-auth] listening on http://127.0.0.1:${boundPort}`);
  });
}

main().catch((error) => {
  console.error("[societyer-auth] failed to start", error);
  process.exitCode = 1;
});
