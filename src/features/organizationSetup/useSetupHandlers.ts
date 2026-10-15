import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../components/Toast";
import type { SetupStepView } from "../../../shared/organizationSetup/types";
import { useSetupActions } from "./useSetupActions";
import type { CertificateValues } from "./RecordCertificateDrawer";

/**
 * The setup view's writes (skip, later, filed, certificate, numbered name),
 * each confirmed with a toast that offers Undo where the change can be undone,
 * plus the open/closed state of the three sheets.
 */
export function useSetupHandlers(society: any, registry: string) {
  const actions = useSetupActions();
  const upsertSociety = useMutation(api.society.upsert);
  const toast = useToast();
  const societyId = society?._id ? String(society._id) : "";
  const [skipStep, setSkipStep] = useState<SetupStepView | null>(null);
  const [filedOpen, setFiledOpen] = useState(false);
  const [certificateOpen, setCertificateOpen] = useState(false);

  const fail = useCallback((title: string) => (error: unknown) => {
    toast.error(title, error instanceof Error ? error.message : String(error));
  }, [toast]);

  const undoDecision = useCallback((step: SetupStepView) => {
    void actions.decideStep({ societyId, stepKey: step.key, decision: null }).catch(fail("Couldn't undo"));
  }, [actions, societyId, fail]);

  const decide = useCallback((step: SetupStepView, decision: "later" | null) => {
    const wasDecided = step.state === "later" || step.state === "not_applicable";
    void actions.decideStep({ societyId, stepKey: step.key, decision })
      .then(() => {
        if (decision === "later") {
          toast.success("Moved to later", {
            description: `${step.title} stays on the list but won't be suggested next.`,
            action: { label: "Undo", onClick: () => undoDecision(step) },
          });
        } else if (wasDecided) {
          toast.success("Back on the list", step.title);
        }
      })
      .catch(fail("Couldn't update the step"));
  }, [actions, societyId, toast, fail, undoDecision]);

  const saveSkip = async (reason: string) => {
    if (!skipStep) return;
    const step = skipStep;
    await actions.decideStep({ societyId, stepKey: step.key, decision: "not_applicable", reason });
    setSkipStep(null);
    toast.success("Marked as not applying", {
      description: step.title,
      action: { label: "Undo", onClick: () => undoDecision(step) },
    });
  };

  const saveFiled = async (values: { submittedOn: string; reference?: string }) => {
    await actions.markSubmitted({ societyId, ...values });
    setFiledOpen(false);
    toast.success("Marked as filed", {
      description: `Record the certificate when ${registry} sends it.`,
      action: { label: "Undo", onClick: () => void actions.markSubmitted({ societyId, undo: true }).catch(fail("Couldn't undo")) },
    });
  };

  const undoFiled = useCallback(() => {
    void actions.markSubmitted({ societyId, undo: true })
      .then(() => toast.success("Filing undone", "The filing step is back on your list."))
      .catch(fail("Couldn't undo the filing"));
  }, [actions, societyId, toast, fail]);

  const saveCertificate = async (values: CertificateValues) => {
    await actions.recordIncorporation({ societyId, ...values });
    setCertificateOpen(false);
    toast.success("Certificate recorded", `${society?.name ?? "Your organization"} is now incorporated and active.`);
  };

  // The numbered-name choice is an ordinary profile field (`numbered`).
  const setNumbered = useCallback(async (numbered: boolean) => {
    if (!society) return;
    await upsertSociety({
      id: society._id,
      name: society.name,
      isCharity: Boolean(society.isCharity),
      isMemberFunded: Boolean(society.isMemberFunded),
      jurisdictionCode: society.jurisdictionCode || undefined,
      homeJurisdictionCode: society.homeJurisdictionCode || undefined,
      incorporationDate: society.incorporationDate || undefined,
      numbered,
    });
  }, [society, upsertSociety]);

  const chooseNumberedName = useCallback(() => {
    void setNumbered(true)
      .then(() => toast.success("Using a numbered name", {
        description: `${registry} assigns the number when you file. Your working name stays in Societyer until then.`,
        action: { label: "Undo", onClick: () => void setNumbered(false).catch(fail("Couldn't undo")) },
      }))
      .catch(fail("Couldn't save the name choice"));
  }, [setNumbered, registry, toast, fail]);

  return {
    decide,
    chooseNumberedName,
    undoFiled,
    skip: { step: skipStep, open: setSkipStep, close: () => setSkipStep(null), save: saveSkip },
    filed: { isOpen: filedOpen, open: () => setFiledOpen(true), close: () => setFiledOpen(false), save: saveFiled },
    certificate: { isOpen: certificateOpen, open: () => setCertificateOpen(true), close: () => setCertificateOpen(false), save: saveCertificate },
  };
}
