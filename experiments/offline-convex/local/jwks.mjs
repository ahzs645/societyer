// Local test signer only. This server publishes public keys; it cannot mint tokens.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { generateKeyPair, exportJWK, importJWK } from "jose";
const path = new URL("../.env.signer.local", import.meta.url);
let privateJwk;
if (existsSync(path)) privateJwk = JSON.parse(readFileSync(path, "utf8"));
else {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  privateJwk = { ...await exportJWK(privateKey), kid: "local-pilot-es256", alg: "ES256", use: "sig" };
  writeFileSync(path, JSON.stringify(privateJwk), { mode: 0o600 });
}
chmodSync(path, 0o600);
const { d: _privateScalar, ...publicJwk } = privateJwk;
await importJWK(publicJwk, "ES256");
createServer((request, response) => {
  if (request.url !== "/jwks.json" || request.method !== "GET") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ keys: [publicJwk] }));
}).listen(43212, "0.0.0.0", () => console.log("Local pilot public JWKS listening on port 43212."));
