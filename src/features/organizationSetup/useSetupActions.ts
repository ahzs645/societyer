import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { SetupStepKey } from "../../../shared/organizationSetup/types";
// SETUP-FALLBACK (delete at merge): local stand-ins until the organizationSetup mutations exist.
import { SETUP_FALLBACK_ACTIVE } from "./fallback/setupFallback";
import { fallbackSetupActions } from "./fallback/useSetupFallback";

export type SetupActions = {
  /** `organizationSetup:decideStep`: "Doesn't apply to us" (needs a reason), "Remind me later", or undo (`null`). */
  decideStep: (args: { societyId: string; stepKey: SetupStepKey; decision: "not_applicable" | "later" | null; reason?: string }) => Promise<unknown>;
  /** `organizationSetup:markSubmitted`: preparing → submitted, or back with `undo`. */
  markSubmitted: (args: { societyId: string; submittedOn?: string; reference?: string; undo?: boolean }) => Promise<unknown>;
  /** `organizationSetup:recordIncorporation`: certificate, number and date → incorporated and active. */
  recordIncorporation: (args: { societyId: string; certificateDocumentId: string; certificateReference?: string; certificateDate: string; incorporationNumber: string }) => Promise<unknown>;
};

/** The three setup lifecycle mutations. */
export function useSetupActions(): SetupActions {
  const decideStep = useMutation(api.organizationSetup.decideStep);
  const markSubmitted = useMutation(api.organizationSetup.markSubmitted);
  const recordIncorporation = useMutation(api.organizationSetup.recordIncorporation);
  if (SETUP_FALLBACK_ACTIVE) return fallbackSetupActions; // SETUP-FALLBACK (delete at merge)
  return { decideStep, markSubmitted, recordIncorporation } as SetupActions;
}
