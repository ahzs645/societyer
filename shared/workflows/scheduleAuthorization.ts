/** Fields approved by a person for the hosted, narrowly scoped schedule runner. */
export type WorkflowScheduleAuthorization = {
  version: number;
  authorizerUserId: string;
  authIssuer: string;
  authSubject: string;
  externalIdentityId?: string;
  authorizedAtISO: string;
  expiresAtISO: string;
  definitionFingerprint: string;
  revokedAtISO?: string;
  revokedReason?: string;
};

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error("The workflow definition is too deeply nested for automatic scheduling.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item, depth + 1)]));
  }
  throw new Error("The workflow definition contains an unsupported schedule value.");
}

/** Includes workspace/record binding, but not cosmetic name or mutable run status. */
export function scheduleDefinition(workflow: Record<string, any>): string {
  const definition = JSON.stringify(canonical({
    executorVersion: 1,
    workflowId: workflow._id,
    societyId: workflow.societyId,
    recipe: workflow.recipe,
    provider: workflow.provider ?? "internal",
    providerConfig: workflow.providerConfig ?? {},
    trigger: workflow.trigger,
    config: workflow.config ?? {},
    nodePreview: workflow.nodePreview ?? [],
  }));
  if (definition.length > 64_000) throw new Error("The workflow definition is too large for automatic scheduling.");
  return definition;
}

export async function scheduleDefinitionFingerprint(workflow: Record<string, any>): Promise<string> {
  const bytes = new TextEncoder().encode(scheduleDefinition(workflow));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Public workflow records do not expose the authorizer's identity bindings. */
export function workflowWithoutScheduleAuthority<T extends Record<string, any>>(workflow: T): Omit<T, "scheduleAuthorization"> {
  const { scheduleAuthorization: _scheduleAuthorization, ...publicRecord } = workflow;
  return publicRecord;
}

/** Used by both local and hosted edits: ordinary edits never silently renew authority. */
export function invalidateScheduleForPatch(workflow: Record<string, any>, patch: Record<string, any>, nowISO = new Date().toISOString()): Record<string, any> {
  const grant = workflow.scheduleAuthorization as WorkflowScheduleAuthorization | undefined;
  if (!grant) return {};
  const paused = patch.status !== undefined && patch.status !== "active";
  let changed = true;
  try { changed = scheduleDefinition(workflow) !== scheduleDefinition({ ...workflow, ...patch }); }
  catch { /* Advanced definitions remain editable, but cannot retain automatic authority. */ }
  if (!paused && !changed) return {};
  return {
    scheduleEnabled: false,
    nextRunAtISO: undefined,
    scheduleAuthorization: {
      ...grant,
      revokedAtISO: grant.revokedAtISO ?? nowISO,
      revokedReason: changed ? "configuration_changed" : "paused",
    },
  };
}
