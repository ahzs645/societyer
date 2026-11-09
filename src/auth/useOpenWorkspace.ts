import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { startHandoff } from "../lib/sessionHandoff";
import { workspaceOpenRoute } from "../lib/workspaceDomain";
import { useAuth } from "./AuthProvider";

export type OpenableWorkspace = { societyId: Id<"societies">; canonicalOrigin?: string };

/**
 * Opens a workspace the way the switcher does: in this tab, or through a
 * session handoff to its own domain (see workspaceOpenRoute). A locked
 * workspace opens its lock screen.
 */
export function useOpenWorkspace() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [opening, setOpening] = useState<Id<"societies"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async ({ societyId, canonicalOrigin }: OpenableWorkspace, next = "/app") => {
    setError(null);
    const route = workspaceOpenRoute({
      currentOrigin: window.location.origin,
      currentOriginMapped: Boolean(auth.domainWorkspace),
      canonicalOrigin,
    });
    if (route.kind === "here") {
      auth.selectWorkspace(societyId);
      navigate(next);
      return;
    }
    setOpening(societyId);
    try {
      startHandoff({ targetOrigin: route.targetOrigin, societyId, next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That workspace couldn't be opened. Try again.");
      setOpening(null);
    }
  }, [auth, navigate]);

  return { open, opening, error };
}
