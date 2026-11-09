/**
 * Frontend side of `workspaceDomains` (docs/shared-workspaces/architecture.md,
 * "Domains"). A mapped origin chooses the first workspace and how sign-in looks;
 * it never grants access.
 */

/** `workspaceDomains:resolveOrigin` for this origin. */
export type DomainWorkspace = {
  societyId: string;
  workspaceName: string;
  origin: string;
  logoUrl?: string;
  logoDarkUrl?: string;
  signIn: { requiredMethod: "any" | "microsoft"; supportEmail?: string };
};

const optionalString = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** Validates the query result; anything unexpected reads as "unmapped". */
export function parseDomainWorkspace(value: unknown): DomainWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const signIn = (row.signIn && typeof row.signIn === "object" ? row.signIn : {}) as Record<string, unknown>;
  if (typeof row.societyId !== "string" || !row.societyId || typeof row.workspaceName !== "string" || typeof row.origin !== "string") return null;
  return {
    societyId: row.societyId,
    workspaceName: row.workspaceName,
    origin: row.origin,
    logoUrl: optionalString(row.logoUrl),
    logoDarkUrl: optionalString(row.logoDarkUrl),
    signIn: {
      requiredMethod: signIn.requiredMethod === "microsoft" ? "microsoft" : "any",
      supportEmail: optionalString(signIn.supportEmail),
    },
  };
}

export type WorkspaceOpenRoute = { kind: "here" } | { kind: "handoff"; targetOrigin: string };

/**
 * Open a workspace in this tab, or hand the session to its own domain.
 *
 * A handoff happens only on a mapped origin, for a workspace whose canonical
 * origin is a different one. An unmapped origin (a neutral entry, preview or
 * local build) opens every workspace in place, as before; so does a workspace
 * without a canonical origin.
 */
export function workspaceOpenRoute({
  currentOrigin,
  currentOriginMapped,
  canonicalOrigin,
}: {
  currentOrigin: string;
  currentOriginMapped: boolean;
  canonicalOrigin?: string | null;
}): WorkspaceOpenRoute {
  if (!currentOriginMapped || !canonicalOrigin) return { kind: "here" };
  let target: string;
  try {
    const url = new URL(canonicalOrigin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "here" };
    target = url.origin;
  } catch {
    return { kind: "here" };
  }
  return target === currentOrigin ? { kind: "here" } : { kind: "handoff", targetOrigin: target };
}

/** "portal.ddcnorth.com" for display. */
export function originHost(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try { return new URL(origin).host; } catch { return null; }
}
