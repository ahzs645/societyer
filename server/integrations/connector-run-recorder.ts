import type { ConvexHttpClient } from "convex/browser";

type ConvexCall = { kind: "query" | "mutation" | "action"; name: string };
type ConvexCaller = (client: ConvexHttpClient, call: ConvexCall, args: Record<string, unknown>) => Promise<any>;

function mutation(name: string): ConvexCall {
  return { kind: "mutation", name };
}

export async function recordConnectorRun(
  client: ConvexHttpClient,
  convexCall: ConvexCaller,
  input: {
    societyId: string;
    connectorId: string;
    actionId: string;
    sessionId?: string;
    profileKey?: string;
    output?: any;
    error?: string;
    triggeredByUserId?: string;
  },
) {
  return await convexCall(client, mutation("workflows.recordConnectorRun"), dropUndefined({
    societyId: input.societyId,
    connectorId: input.connectorId,
    connectorName: connectorName(input.connectorId),
    actionId: input.actionId,
    actionName: connectorActionName(input.connectorId, input.actionId),
    status: input.error ? "failed" : "success",
    externalRunId: stringValue(input.output?.runId ?? input.output?.id),
    profileKey: stringValue(input.output?.profileKey ?? input.profileKey),
    sessionId: input.sessionId,
    output: compactConnectorRunOutput(input.output),
    error: input.error,
    triggeredByUserId: input.triggeredByUserId,
  }));
}

function compactConnectorRunOutput(output: any) {
  if (!output || typeof output !== "object") return output;
  return dropUndefined({
    runId: output.runId ?? output.id,
    profileKey: output.profileKey,
    businessId: output.businessId,
    currentUrl: output.currentUrl,
    transactionCount: output.transactionCount ?? output.normalized?.transactions?.length,
    accountCount: output.accountCount ?? output.normalized?.accounts?.length,
    projectCount: output.projectCount,
    filingCount: output.filingCount,
    downloadedCount: output.download?.downloadedCount ?? output.agreement?.downloadedAgreementPdfs?.downloadedCount,
    normalizedGrantTitle: output.normalizedGrant?.title,
    import: output.import,
    workflowRunId: output.workflowRunId,
  });
}

function connectorName(connectorId: string) {
  const labels: Record<string, string> = {
    wave: "Wave",
    gcos: "GCOS",
    "bc-registry": "BC Registry",
  };
  return labels[connectorId] ?? labelizeConnector(connectorId);
}

function connectorActionName(connectorId: string, actionId: string) {
  const labels: Record<string, Record<string, string>> = {
    wave: {
      listTransactions: "List transactions",
      importTransactions: "Stage transactions",
    },
    gcos: {
      exportProjects: "Export projects",
      exportProjectSnapshot: "Stage project snapshot",
      importExportedSnapshot: "Stage exported snapshot",
    },
    "bc-registry": {
      filingHistoryExport: "Export filing history",
      stageFilingHistory: "Stage filing history",
      importFilingHistory: "Import filing history",
      stageBylawsHistory: "Stage bylaws history",
      stageGovernanceDocuments: "Stage governance documents",
      importGovernanceDocuments: "Import governance documents",
    },
  };
  return labels[connectorId]?.[actionId] ?? labelizeConnector(actionId);
}

function labelizeConnector(value: string) {
  return String(value || "connector")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
