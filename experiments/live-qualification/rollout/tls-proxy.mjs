/** Disposable TLS transport only. Existing production broker signs every JWT. */
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const privateDirectory = resolve("tmp/offline-rollout-tls");
const tls = { key: readFileSync(resolve(privateDirectory, "server.key")), cert: readFileSync(resolve(privateDirectory, "server.crt")) };
for (const [port, target] of [[43479, 43478], [43229, 43228]]) {
  const server = https.createServer(tls, (req, res) => {
    const upstream = http.request({ hostname: "127.0.0.1", port: target, path: req.url, method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${target}` } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end("Disposable qualification upstream unavailable"); });
    req.pipe(upstream);
  });
  server.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(target, "127.0.0.1", () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
      for (const [name, value] of Object.entries(req.headers)) upstream.write(`${name}: ${name === "host" ? `127.0.0.1:${target}` : value}\r\n`);
      upstream.write("\r\n"); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
  });
  server.listen(port, "127.0.0.1", () => console.log(`Disposable HTTPS qualification proxy listening on loopback ${port}`));
}
