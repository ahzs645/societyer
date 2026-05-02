import type { ConvexHttpClient } from "convex/browser";

type ConvexCall = { kind: "query" | "mutation" | "action"; name: string };
type ConvexCaller = (client: ConvexHttpClient, call: ConvexCall, args: Record<string, unknown>) => Promise<any>;

function mutation(name: string): ConvexCall {
  return { kind: "mutation", name };
}

export async function stageConnectorImportSession(
  client: ConvexHttpClient,
  convexCall: ConvexCaller,
  input: {
    societyId: string;
    name: string;
    bundle: any;
  },
) {
  const sessionId = await convexCall(client, mutation("importSessions.createFromBundle"), {
    societyId: input.societyId,
    name: input.name,
    bundle: input.bundle,
  });
  return { staged: true, sessionId, recordCount: importBundleRecordCount(input.bundle) };
}

function importBundleRecordCount(bundle: any) {
  return [
    "sources",
    "filings",
    "grants",
    "deadlines",
    "transactionCandidates",
    "documentMap",
    "bylawAmendments",
    "sourceEvidence",
  ].reduce((sum, key) => sum + (Array.isArray(bundle?.[key]) ? bundle[key].length : 0), 0);
}
