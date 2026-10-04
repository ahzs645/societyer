import { configureLiveSession } from "./server/liveSession";
import { defineConfig, type ViteDevServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import type { GenericId } from "convex/values";
import { createFixture, fixtureIssuer } from "./fixture";
import { toPortableQueryCtx } from "../../convex/lib/portable";
import { requirePermissionPortable } from "../../shared/functions/permissions";

// These routes exist only on this loopback evaluation server. No production auth endpoints.
export default defineConfig({
  build: { rollupOptions: { input: { drafts: "index.html", meeting: "meeting.html" } } },
  envDir: ".",
  optimizeDeps: { exclude: ["@powersync/web"] },
  worker: { format: "es" },
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  preview: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  plugins: [{ name: "local-live-pilot-session", configureServer: configureLiveSession, configurePreviewServer: configureLiveSession }, VitePWA({
    registerType: "prompt", injectRegister: false,
    manifest: { name: "Societyer meeting pilot", short_name: "Meeting pilot", start_url: "/meeting.html", display: "standalone", theme_color: "#16324f", background_color: "#ffffff", icons: [{ src: "/pilot-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] },
    workbox: { clientsClaim: true, ignoreURLParametersMatching: [/^(live|run)$/, /^utm_/], globPatterns: ["**/*.{js,css,html,wasm,svg}"], maximumFileSizeToCacheInBytes: 10_000_000, navigateFallbackDenylist: [/^\/__(fixture|live)\//] },
  }), {
    name: "offline-evaluation-fixture",
    configureServer: configureFixture,
    configurePreviewServer: configureFixture,
  }],
});

async function configureFixture(server: Pick<ViteDevServer, "middlewares">) {
      let fixture = await createFixture();
      let loseAcknowledgement = false;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__fixture/")) return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          const url = new URL(req.url, "http://localhost");
          let body: any = {};
          if (req.method === "POST") {
            let text = "";
            for await (const chunk of req) {
              text += chunk;
              if (text.length > 1_500_000) throw new Error("Fixture request too large.");
            }
            body = JSON.parse(text || "{}");
          }
          let value: unknown;
          const subject = String(body.subject ?? url.searchParams.get("subject") ?? "owner-a");
          if (!Object.prototype.hasOwnProperty.call(fixture.ids.users, subject) && url.pathname !== "/__fixture/reset") throw new Error("Unknown fixture actor.");
          switch (url.pathname) {
            case "/__fixture/reset": fixture = await createFixture(); loseAcknowledgement = false; value = { ok: true }; break;
            case "/__fixture/session": {
              const user = await fixture.native.run(ctx => ctx.db.get(fixture.ids.users[subject] as GenericId<"users">));
              value = { issuer: fixtureIssuer, subject, societyId: subject === "owner-b" ? fixture.ids.societyB : fixture.ids.societyA, role: user?.role }; break;
            }
            case "/__fixture/upload":
              value = await fixture.actor(subject).mutation(fixture.apply, body.batch);
              if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("Simulated lost acknowledgement after commit."); }
              break;
            case "/__fixture/list": value = await fixture.actor(subject).query(fixture.list, { societyId: subject === "owner-b" ? fixture.ids.societyB : fixture.ids.societyA }); break;
            case "/__fixture/meeting-command":
              value = await fixture.actor(subject).mutation(fixture.meetingApply, body.args);
              if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("Simulated lost acknowledgement after commit."); }
              break;
            case "/__fixture/meeting-downloads": value = await fixture.actor(subject).query(fixture.meetingDownloads, { societyId: subject === "owner-b" ? fixture.ids.societyB : fixture.ids.societyA }); break;
            case "/__fixture/meeting-snapshot": value = await fixture.actor(subject).query(fixture.meetingSnapshot, { societyId: subject === "owner-b" ? fixture.ids.societyB : fixture.ids.societyA }); break;
            case "/__fixture/meeting-file": {
              // Fixture action boundary: permission before accepting bytes;
              // commitFile rechecks current permissions, ownership and hash.
              const actor = fixture.actor(subject);
              await actor.run(async ctx => { await requirePermissionPortable(await toPortableQueryCtx(ctx), body.societyId, "documents:write"); });
              const bytes = Buffer.from(body.content, "base64");
              if (bytes.length > 1_000_000) throw new Error("Fixture file too large.");
              const storageId = await fixture.native.run(ctx => ctx.storage.store(new Blob([bytes])));
              try {
                const result = await actor.mutation(fixture.commitFile, { societyId: body.societyId, meetingUuid: body.meetingUuid, storageId });
                if (result.storageId !== storageId) await fixture.native.run(ctx => ctx.storage.delete(storageId));
                value = result;
              }
              catch (error) { await fixture.native.run(ctx => ctx.storage.delete(storageId)); throw error; }
              break;
            }
            case "/__fixture/meeting-download-file": {
              const storageId = await fixture.actor(subject).query(fixture.downloadFile, { societyId: body.societyId, meetingUuid: body.meetingUuid });
              const content = await fixture.native.run(async ctx => {
                const blob = await ctx.storage.get(storageId);
                return Buffer.from(await blob!.arrayBuffer()).toString("base64");
              });
              value = { content };
              break;
            }
            case "/__fixture/role":
              await fixture.native.run(async ctx => { await ctx.db.patch(fixture.ids.users[subject] as any, { role: body.role, status: body.status ?? "Active" }); });
              await fixture.native.mutation(fixture.rebuild, { societyId: subject === "owner-b" ? fixture.ids.societyB : fixture.ids.societyA });
              value = { ok: true }; break;
            case "/__fixture/lose-ack": loseAcknowledgement = true; value = { ok: true }; break;
            default: res.statusCode = 404; value = { error: "Unknown fixture endpoint." };
          }
          res.end(JSON.stringify(value));
        } catch (error) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });

}
