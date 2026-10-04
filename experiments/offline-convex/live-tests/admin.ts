import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import type { ConvexHttpClient as HttpClient } from "convex/browser";
const require = createRequire(import.meta.url);
const { ConvexHttpClient } = require("convex/browser") as typeof import("convex/browser");
const { makeFunctionReference } = require("convex/server") as typeof import("convex/server");
export const settings = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const admin = new ConvexHttpClient(settings.CONVEX_SELF_HOSTED_URL!, { logger: false }) as HttpClient & { setAdminAuth(key: string): void; function(ref: unknown, component: undefined, args: unknown): Promise<any> };
admin.setAdminAuth(settings.CONVEX_SELF_HOSTED_ADMIN_KEY!);
export async function rebuild(societyId: string) { return admin.function(makeFunctionReference("offlineMeetings:rebuildDownloads"), undefined, { societyId }); }
export async function publicMutation(token: string, name: string, args: Record<string, unknown>) {
  const client = new ConvexHttpClient(settings.CONVEX_SELF_HOSTED_URL!, { logger: false }); client.setAuth(token);
  return client.mutation(makeFunctionReference<"mutation">(name), args);
}
