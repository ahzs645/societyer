import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { DEVELOPMENT_MAIL_SITE } from "../shared/developmentMailConfiguration";

const execute = promisify(execFile);
const origin = "http://127.0.0.1:4599";
const cli = path.resolve("node_modules/convex/bin/main.js");
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
type Mail = { to: string; subject: string; text: string; createdAtMs: number };
let pending: Promise<Mail[]> | undefined;
function readInbox(): Promise<Mail[]> {
  if (!pending) pending = execute(process.execPath, [cli, "run", "--deployment", "gallant-anteater-27", "developmentMail:inbox", JSON.stringify({ nowMs: Date.now() })], { timeout: 25_000, maxBuffer: 1024 * 1024 })
    .then(result => JSON.parse(result.stdout) as Mail[]).finally(() => { pending = undefined; });
  return pending;
}
function render(mail: Mail) {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  let href: string | undefined;
  if (found) {
    const url = new URL(found);
    if ((url.origin === DEVELOPMENT_MAIL_SITE && url.pathname.startsWith("/api/auth/")) || (url.origin === "http://127.0.0.1:5173" && url.pathname === "/reset-password")) href = url.href;
  }
  return `<article><h2>${escape(mail.subject)}</h2><p>To: ${escape(mail.to)} · ${escape(new Date(mail.createdAtMs).toISOString())}</p>${href ? `<p><a href="${escape(href)}">Open ${/reset/i.test(mail.subject) ? "password reset" : "verification"} link</a></p>` : ""}<pre>${escape(mail.text)}</pre></article>`;
}
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (request.headers.host !== "127.0.0.1:4599" || (request.headers.origin && request.headers.origin !== origin) || request.headers["sec-fetch-site"] === "cross-site") {
    response.writeHead(403).end("Local inbox access only."); return;
  }
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  if (request.url !== "/") { response.writeHead(404).end(); return; }
  try {
    const messages = await readInbox();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><head><title>Societyer development inbox</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;background:#f6f7fa;color:#162136}article{background:white;border:1px solid #9ca9bb;border-radius:10px;padding:20px;margin:20px 0}a{color:#1256a6}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}h2{font-size:19px}</style></head><body><h1>Societyer development inbox</h1><p>Development deployment only · No email leaves this test pipeline · Messages expire after one hour.</p><p><a href="/">Refresh inbox</a> · <a href="http://127.0.0.1:5173/login">Open local Societyer</a></p>${messages.length ? messages.map(render).join("") : "<p>No messages yet. Create an account on the local site.</p>"}</body></html>`);
  } catch {
    // CLI output can contain auth links; never log it or include it in an error page.
    response.writeHead(503, { "Content-Type": "text/plain" }).end("Development inbox unavailable. Check the dev deployment configuration and Convex CLI sign-in.");
  }
});
server.listen(4599, "127.0.0.1", () => console.log(`Development inbox: ${origin} (pinned to gallant-anteater-27; no SMTP)`));
