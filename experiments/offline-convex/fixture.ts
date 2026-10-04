import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./convex/schema";
import type { Batch } from "./src/connector";

export const fixtureIssuer = "https://offline-evaluation.clerk.accounts.dev";
export async function createFixture() {
  process.env.AUTH_MODE = "clerk";
  process.env.VITE_AUTH_MODE = "clerk";
  process.env.CLERK_JWT_ISSUER_DOMAIN = fixtureIssuer;
  const native = convexTest(schema, {
    "./_generated/server.js": () => import("../../convex/_generated/server.js"),
    "./offlineDrafts.js": () => import("./convex/offlineDrafts"),
    "./offlineMeetings.js": () => import("./convex/offlineMeetings"),
  } as any);
  const ids = await native.run(async ctx => {
    const societyA = await ctx.db.insert("societies", { name: "Evaluation A", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    const societyB = await ctx.db.insert("societies", { name: "Evaluation B", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    const users: Record<string, string> = {};
    for (const [key, societyId, role] of [["owner-a", societyA, "Owner"], ["viewer-a", societyA, "Viewer"], ["owner-b", societyB, "Owner"]] as const) {
      users[key] = await ctx.db.insert("users", { societyId, role, status: "Active", email: `${key}@example.test`, displayName: key,
        authSubject: key, authProvider: "clerk", authIssuer: fixtureIssuer, createdAtISO: new Date().toISOString() });
    }
    return { societyA, societyB, users };
  });
  const apply = makeFunctionReference<"mutation", Batch, { accepted: boolean; replay: boolean }>("offlineDrafts:applyBatch");
  const list = makeFunctionReference<"query">("offlineDrafts:list");
  const meetingApply = makeFunctionReference<"mutation">("offlineMeetings:applyCommand");
  const meetingSnapshot = makeFunctionReference<"query">("offlineMeetings:authorizedSnapshot");
  const meetingDownloads = makeFunctionReference<"query">("offlineMeetings:downloads");
  const rebuild = makeFunctionReference<"mutation">("offlineMeetings:rebuildDownloads");
  const commitFile = makeFunctionReference<"mutation">("offlineMeetings:commitFile");
  const downloadFile = makeFunctionReference<"query">("offlineMeetings:fileForDownload");
  function actor(subject: string, issuer = fixtureIssuer) {
    return native.withIdentity({ subject, issuer, tokenIdentifier: `${issuer}|${subject}` });
  }
  return { native, ids, apply, list, actor, meetingApply, meetingSnapshot, meetingDownloads, rebuild, commitFile, downloadFile };
}
