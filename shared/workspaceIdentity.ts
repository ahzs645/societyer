/** A portable backup contains records, never proof of a hosted login identity. */
export const IMPORTED_AUTH_BINDING_FIELDS = [
  "authProvider", "authIssuer", "authSubject", "externalIdentityId", "emailVerifiedAtISO", "lastLoginAtISO",
] as const;

export function stripImportedAuthBindings<T extends Record<string, any[]>>(tables: T): T {
  const result: Record<string, any[]> = { ...tables };
  delete result.externalIdentities;
  if (Array.isArray(result.users)) {
    result.users = result.users.map((row) => {
      const localUser = { ...row };
      for (const field of IMPORTED_AUTH_BINDING_FIELDS) delete localUser[field];
      return localUser;
    });
  }
  if (Array.isArray(result.workflows)) {
    result.workflows = result.workflows.map(row => {
      const workflow = { ...row, scheduleEnabled: false };
      // A restored record is not an authorization to resume unattended work.
      // Keep the workflow definition and run history, but require a fresh grant.
      delete workflow.scheduleAuthorization;
      delete workflow.nextRunAtISO;
      return workflow;
    });
  }
  return result as T;
}
