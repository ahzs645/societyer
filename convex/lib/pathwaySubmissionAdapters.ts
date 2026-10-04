import { createSubmissionAdapterRegistry, type TrustedSubmissionAdapter } from "../../shared/pathways/submissions";

/**
 * Install reviewed API implementations here, in trusted server code. An adapter's
 * isConfigured check must inspect local deployment configuration without I/O;
 * actual provider calls belong only in submit(), executed by an internal action.
 * Government routes currently use official-portal and have no automated adapter.
 */
const installedAdapters: readonly TrustedSubmissionAdapter[] = [];
export const pathwaySubmissionAdapters = createSubmissionAdapterRegistry(installedAdapters);

export async function pathwaySubmissionCapabilities() {
  return Promise.all(pathwaySubmissionAdapters.describe().map(async (entry) => {
    if (entry.mode === "manual") return { adapterId: entry.id, label: entry.label, mode: "manual", available: false, reason: "Official portal filing requires an authorized human. No automated filing is performed." };
    let available = false;
    try { available = Boolean(await pathwaySubmissionAdapters.resolve(entry.id)?.isConfigured()); } catch { /* Configuration errors expose no credentials. */ }
    return { adapterId: entry.id, label: entry.label, mode: "trusted-api", available,
      reason: available ? "Reviewed server adapter is configured; submission requires current approval and authority." : "Server adapter configuration is unavailable. No automated submission will be sent." };
  }));
}
