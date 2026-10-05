/** Operator-supplied provider boundaries. These functions never trust a tenant record as an external-account grant. */
export function operatorWaveBusinessId(societyId: string, requestedBusinessId: string | undefined, serializedBindings: string | undefined): string {
  if (!serializedBindings?.trim()) throw new Error("Wave requires operator-approved SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON for this workspace.");
  let bindings: unknown;
  try { bindings = JSON.parse(serializedBindings); } catch { throw new Error("SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON is invalid; contact the deployment administrator."); }
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new Error("SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON must map workspace IDs to Wave business IDs.");
  const record = bindings as Record<string, unknown>;
  const businessId = Object.prototype.hasOwnProperty.call(record, societyId) ? record[societyId] : undefined;
  if (typeof businessId !== "string" || !businessId.trim() || businessId.length > 512) throw new Error("Wave is not assigned to this workspace by the deployment administrator.");
  if (requestedBusinessId !== undefined && requestedBusinessId.trim() !== businessId.trim()) throw new Error("Wave business is not assigned to this workspace.");
  return businessId.trim();
}

export function requireOperatorPaperlessWorkspace(societyId: string, assignedSocietyId: string | undefined): void {
  if (!assignedSocietyId?.trim()) throw new Error("Paperless requires operator-approved PAPERLESS_SOCIETY_ID before archive access.");
  if (societyId !== assignedSocietyId.trim()) throw new Error("This Paperless archive is not assigned to this workspace.");
}

export function providerDeploymentEnv(name: string): string | undefined {
  return (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}
