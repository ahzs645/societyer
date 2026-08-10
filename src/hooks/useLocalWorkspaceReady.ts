import { useEffect, useState } from "react";
import { isLocalDataRuntime } from "../lib/staticRuntime";

type HydratableClient = { whenLocalWorkspaceReady?: () => Promise<void> };

/**
 * False until a local (IndexedDB-backed) workspace has finished reading its
 * persisted rows. Server runtimes report ready immediately — Convex has its own
 * loading states and nothing to hydrate here.
 */
export function useLocalWorkspaceReady() {
  const [ready, setReady] = useState(() => !isLocalDataRuntime());

  useEffect(() => {
    if (ready) return;
    let active = true;
    void import("../lib/localDataClient")
      .then(({ localDataClient }) => (localDataClient as unknown as HydratableClient).whenLocalWorkspaceReady?.())
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [ready]);

  return ready;
}
