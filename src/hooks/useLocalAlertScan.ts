import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { isLocalDataRuntime } from "@/lib/staticRuntime";

const scanned = new Set<string>();

/**
 * The server runs the alert scan on a schedule. A workspace that runs in the
 * browser has no scheduler, so scan once per page load instead (deadline lead
 * time, budget lines, low balance and claims waiting). The scan dedupes, so a
 * reload never repeats an alert.
 */
export function useLocalAlertScan(societyId: string | undefined, canWrite: boolean) {
  const evaluate = useMutation(api.notifications.evaluateAlerts);
  useEffect(() => {
    if (!societyId || !canWrite || !isLocalDataRuntime() || scanned.has(societyId)) return;
    // Let the page settle first; the scan reads several finance tables.
    const timer = window.setTimeout(() => {
      scanned.add(societyId);
      evaluate({ societyId }).catch(() => {
        scanned.delete(societyId);
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [societyId, canWrite, evaluate]);
}
