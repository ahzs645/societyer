/**
 * Server-side publisher transport: one workspace-scoped bearer key against the
 * deployment's /procurement-publisher route. It never reads a Convex CLI login
 * or deploy key, so it can run on a server (Zoer's backend) with no Mac.
 */
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePublisherEndpoint, PUBLISHER_KEY_PATTERN } from "../../shared/procurementReview/publisherConnection";

export type PublisherOperation = "status" | "reportSource" | "publicationPolicy" | "recordPublication";
export type PublisherStatus = { societyId: string; folder: string | null; catalogSource: "convex" | "service"; serviceOnlyAllowed: boolean };
export type PublisherClientOptions = { fetch?: typeof fetch; timeoutMs?: number };

/** A regular file holding exactly the 64-hex key, readable only by its owner. */
export function readPublisherKey(path: string): string {
  const stat = lstatSync(resolve(path));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256) throw new Error("The publisher key file must be a small regular file.");
  if (stat.mode & 0o077) throw new Error("The publisher key file must be readable only by its owner (mode 0600 or stricter).");
  const key = readFileSync(resolve(path), "utf8").trim();
  if (!PUBLISHER_KEY_PATTERN.test(key)) throw new Error("The publisher key file must contain the 64 lowercase hex character key only.");
  return key;
}

export function createPublisherClient(endpoint: string, keyFile: string, options: PublisherClientOptions = {}) {
  const url = validatePublisherEndpoint(endpoint), key = readPublisherKey(keyFile), transport = options.fetch ?? fetch;
  return {
    async run(operation: PublisherOperation, data?: unknown): Promise<unknown> {
      let response: Response, text: string;
      try {
        response = await transport(url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(data === undefined ? { operation } : { operation, data }),
        });
        text = await response.text();
      } catch { throw new Error(`The publisher endpoint did not answer the ${operation} request; retry this exact publication.`); }
      // The route never explains a rejection; Societyer shows the reason to its administrators.
      if (response.status === 403) throw new Error("The publisher key was refused. Check Zoer's connection in Societyer's catalog source settings.");
      if (!response.ok) throw new Error(`The publisher endpoint rejected ${operation} (HTTP ${response.status}). Societyer's catalog source settings show the reason.`);
      if (text.length > 64_000) throw new Error("Publisher response exceeds the limit.");
      try { return JSON.parse(text) as unknown; } catch { throw new Error("The publisher endpoint returned an invalid response."); }
    },
    async status(): Promise<PublisherStatus> {
      const value = await this.run("status") as PublisherStatus | null;
      if (!value || typeof value.societyId !== "string" || typeof value.serviceOnlyAllowed !== "boolean") throw new Error("The publisher endpoint returned an invalid status.");
      return value;
    },
  };
}
export type PublisherClient = ReturnType<typeof createPublisherClient>;
