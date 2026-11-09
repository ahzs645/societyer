import { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/lib/convexApi";
import { parseDomainWorkspace, type DomainWorkspace } from "../lib/workspaceDomain";

const DOMAIN_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * `workspaceDomains:resolveOrigin` for this origin. Public, so it also brands
 * the sign-in page. A deployment without the function, an error or a slow
 * answer reads as unmapped, which is the behaviour before domains existed.
 */
export function useDomainWorkspace(enabled: boolean): DomainWorkspace | null | undefined {
  const convex = useConvex();
  const [value, setValue] = useState<DomainWorkspace | null | undefined>(enabled ? undefined : null);
  useEffect(() => {
    if (!enabled) {
      setValue(null);
      return;
    }
    let settled = false;
    const settle = (next: DomainWorkspace | null) => {
      settled = true;
      setValue(next);
    };
    const timeout = setTimeout(() => { if (!settled) settle(null); }, DOMAIN_LOOKUP_TIMEOUT_MS);
    const watch = convex.watchQuery(api.workspaceDomains.resolveOrigin, { origin: window.location.origin });
    const update = () => {
      try {
        const result: unknown = watch.localQueryResult();
        if (result !== undefined) settle(parseDomainWorkspace(result));
      } catch (error) {
        console.warn("[societyer-auth] workspace domain lookup failed", error);
        settle(null);
      }
    };
    const unsubscribe = watch.onUpdate(update);
    update();
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [convex, enabled]);
  return value;
}
