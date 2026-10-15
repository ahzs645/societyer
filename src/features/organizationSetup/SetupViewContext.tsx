import { createContext, useContext } from "react";
import type { SetupStepKey, SetupStepView } from "../../../shared/organizationSetup/types";

/** Actions the setup view hands to its rows, panels and the next-step card. */
export type SetupViewApi = {
  society: any;
  /** The viewer may change setup decisions and lifecycle (society:write). */
  canWrite: boolean;
  /** Registry name for filing copy ("Corporations Canada", "BC Registries"). */
  registry: string;
  /** True while the filing is submitted and the certificate hasn't been recorded. */
  waitingForRegistry: boolean;
  decide: (step: SetupStepView, decision: "later" | null) => void;
  openSkip: (step: SetupStepView) => void;
  openFiled: () => void;
  undoFiled: () => void;
  openCertificate: () => void;
  chooseNumberedName: () => void;
  /** Expand a step (and its phase) and scroll to it. */
  focusStep: (key: SetupStepKey) => void;
};

export const SetupViewContext = createContext<SetupViewApi | null>(null);

export function useSetupView(): SetupViewApi {
  const value = useContext(SetupViewContext);
  if (!value) throw new Error("useSetupView must be used inside the organization setup view");
  return value;
}
