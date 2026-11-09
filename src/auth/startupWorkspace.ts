/**
 * Which workspace a signed-in tab opens first. The rules are in
 * docs/shared-workspaces/architecture.md ("Frontend startup on a mapped origin"):
 *
 * 1. An explicit choice wins: a handoff `workspace`, `refreshMembership(id)`,
 *    or the tab's own selection once startup has run.
 * 2. On a mapped origin, the domain's workspace opens if the person can reach it.
 * 3. If that workspace is locked, its lock screen offers the missing step.
 * 4. If the person isn't a member there, say so. Never open another
 *    organization silently.
 *
 * An unmapped origin keeps the old behaviour: the remembered workspace, else
 * the first one. Membership, not this choice, is the access boundary.
 */

export type StartupChoice<L, D> =
  | { kind: "open"; societyId: string }
  | { kind: "locked"; workspace: L }
  | { kind: "no-access-here"; domainWorkspace: D }
  | { kind: "none" };

export function chooseStartupWorkspace<L extends { id: string }, D extends { societyId: string }>({
  memberships,
  lockedWorkspaces,
  domainWorkspace,
  explicitSocietyId,
  rememberedSocietyId,
}: {
  /** Workspaces this session can open now. */
  memberships: readonly { societyId: string }[];
  lockedWorkspaces: readonly L[];
  /** The workspace mapped to this origin, or null when the origin is unmapped. */
  domainWorkspace: D | null;
  explicitSocietyId?: string | null;
  rememberedSocietyId?: string | null;
}): StartupChoice<L, D> {
  const open = (id: string | null | undefined) =>
    id && memberships.some((membership) => membership.societyId === id) ? id : null;
  const locked = (id: string | null | undefined) =>
    id ? lockedWorkspaces.find((workspace) => workspace.id === id) ?? null : null;

  const explicitOpen = open(explicitSocietyId);
  if (explicitOpen) return { kind: "open", societyId: explicitOpen };
  const explicitLocked = locked(explicitSocietyId);
  if (explicitLocked) return { kind: "locked", workspace: explicitLocked };

  if (domainWorkspace) {
    const domainOpen = open(domainWorkspace.societyId);
    if (domainOpen) return { kind: "open", societyId: domainOpen };
    const domainLocked = locked(domainWorkspace.societyId);
    if (domainLocked) return { kind: "locked", workspace: domainLocked };
    return memberships.length || lockedWorkspaces.length
      ? { kind: "no-access-here", domainWorkspace }
      : { kind: "none" };
  }

  const fallback = open(rememberedSocietyId) ?? memberships[0]?.societyId;
  if (fallback) return { kind: "open", societyId: fallback };
  const fallbackLocked = locked(rememberedSocietyId) ?? lockedWorkspaces[0];
  return fallbackLocked ? { kind: "locked", workspace: fallbackLocked } : { kind: "none" };
}

// An explicit choice that has to survive a page load: a handoff landing or the
// Microsoft round trip from a lock screen. Per tab, short-lived, and only a
// preference: chooseStartupWorkspace still requires a membership.
const PENDING_KEY = "societyer.startupWorkspace";
const PENDING_TTL_MS = 10 * 60_000;
let pendingFallback: { id: string; until: number } | null = null;

export function rememberStartupWorkspace(id: string, now = Date.now()) {
  const value = { id, until: now + PENDING_TTL_MS };
  pendingFallback = value;
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)); } catch { /* The in-memory value covers this load. */ }
}

export function takeStartupWorkspace(now = Date.now()): string | null {
  let value = pendingFallback;
  pendingFallback = null;
  try {
    const stored = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (stored) value = JSON.parse(stored) as { id: string; until: number };
  } catch { /* Storage unavailable or malformed: use the in-memory value. */ }
  return value && typeof value.id === "string" && typeof value.until === "number" && value.until > now ? value.id : null;
}
