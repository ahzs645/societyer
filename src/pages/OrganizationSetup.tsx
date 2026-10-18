import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Banner, Skeleton } from "../components/ui";
import { SetupRing } from "../components/SetupPill";
import { useSociety } from "../hooks/useSociety";
import { useIsMobile } from "../lib/useIsMobile";
import { usePermissions } from "../hooks/usePermissions";
import { organizationTodayISO } from "../lib/dateRanges";
import { isCorporation } from "../../shared/organizationDomain";
import type { OrganizationSetupProgress } from "../../shared/organizationSetup/types";
import { findSetupPhase, findSetupStep, setupPercent, useOrganizationSetup } from "../features/organizationSetup/useOrganizationSetup";
import { useSetupDisclosure } from "../features/organizationSetup/useSetupDisclosure";
import { useSetupHandlers } from "../features/organizationSetup/useSetupHandlers";
import { SetupViewContext, type SetupViewApi } from "../features/organizationSetup/SetupViewContext";
import { NextStepCard } from "../features/organizationSetup/NextStepCard";
import { SetupPhaseRail } from "../features/organizationSetup/SetupPhaseRail";
import { SetupPhaseSection } from "../features/organizationSetup/SetupPhaseSection";
import { SetupAnswersSummary } from "../features/organizationSetup/SetupAnswersSummary";
import { SkipStepDialog } from "../features/organizationSetup/SkipStepDialog";
import { MarkFiledDrawer } from "../features/organizationSetup/MarkFiledDrawer";
import { RecordCertificateDrawer } from "../features/organizationSetup/RecordCertificateDrawer";
import { setupCopyContext, setupStageLabel } from "../../shared/organizationSetup/catalogue";

/** Filed with the registry, certificate not recorded yet. */
function isWaitingForRegistry(progress: OrganizationSetupProgress | undefined) {
  return Boolean(findSetupPhase(progress, "file")?.statusNote) && findSetupStep(progress, "certificate")?.state !== "done";
}

/**
 * Organization setup (`/app/organization-setup`): the one place that says
 * what is left to set up, phase by phase, with each step's state computed
 * from the records (never ticked by hand). Step links carry `?setup=<key>`
 * so destination pages can offer "Back to setup".
 */
export function OrganizationSetupPage() {
  const society = useSociety();
  const progress = useOrganizationSetup(society?._id ? String(society._id) : null);
  const { can, loaded } = usePermissions();
  const canWrite = loaded && can("society:write");
  const [searchParams, setSearchParams] = useSearchParams();
  const welcome = searchParams.get("welcome") === "1";
  const registry = society ? setupCopyContext(society).registry : "the registry";
  // Phones: the next-step card is the one mention of the next step on the
  // first screen; the phases below start collapsed (their headers carry the
  // counts) and the phase chips are left out, since those headers list the
  // same phases.
  const isMobile = useIsMobile();
  const disclosure = useSetupDisclosure(progress, { startCollapsed: isMobile });
  const handlers = useSetupHandlers(society, registry);
  const waitingForRegistry = isWaitingForRegistry(progress);

  const viewApi = useMemo<SetupViewApi>(() => ({
    society,
    canWrite,
    registry,
    waitingForRegistry,
    decide: handlers.decide,
    openSkip: handlers.skip.open,
    openFiled: handlers.filed.open,
    undoFiled: handlers.undoFiled,
    openCertificate: handlers.certificate.open,
    chooseNumberedName: handlers.chooseNumberedName,
    focusStep: disclosure.focusStep,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [society, canWrite, registry, waitingForRegistry, handlers.decide, handlers.undoFiled, handlers.chooseNumberedName, disclosure.focusStep]);

  if (society === undefined) return <PageLoading variant="detail" />;
  if (society === null) return <SeedPrompt />;

  const today = organizationTodayISO(society);
  const stage = setupStageLabel(society, setupCopyContext(society));
  const currentIndex = progress ? progress.phases.findIndex((phase) => phase.key === progress.currentPhase) : -1;
  const dismissWelcome = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("welcome");
    setSearchParams(next, { replace: true });
  };

  return (
    <SetupViewContext.Provider value={viewApi}>
      <div className="page setup-page">
        <PageHeader
          title={`Set up ${society.name}`}
          icon={<ListChecks size={16} />}
          subtitle={stage}
          info={<>
            <p>Each step is checked against your records, so it's done when the record exists. Steps that don't apply can be crossed out with a reason, and anything can be put off for later.</p>
            <p>Societyer never files anything for you. You file with {registry} yourself, then record it here.</p>
          </>}
        />
        {welcome && (
          <Banner tone="success" title="Your workspace is ready. Here's what to do next." onDismiss={dismissWelcome} className="setup-welcome">
            Start with the next step below. Steps finish on their own when the records exist, and you can come back any time from Setup in the sidebar.
          </Banner>
        )}
        {!progress ? (
          <div className="setup-layout setup-layout--loading" aria-busy="true">
            <Skeleton variant="block" height={96} />
            <Skeleton variant="block" height={160} />
            <Skeleton variant="block" height={240} />
          </div>
        ) : (
          <div className="setup-layout">
            <section className="setup-progress" aria-label="Setup progress">
              <SetupRing percent={setupPercent(progress)} size={44} />
              <div className="setup-progress__text">
                <p className="setup-progress__count">{progress.counts.done} of {progress.counts.total} done</p>
                <p className="setup-progress__stage">{stage}</p>
              </div>
            </section>
            <div className="setup-layout__next">
              <NextStepCard progress={progress} />
            </div>
            {!isMobile && (
              <div className="setup-layout__rail">
                <SetupPhaseRail progress={progress} activePhase={disclosure.activePhase} onSelect={disclosure.selectPhase} />
              </div>
            )}
            <div className="setup-layout__phases">
              {progress.phases.map((phase, index) => (
                <SetupPhaseSection
                  key={phase.key}
                  phase={phase}
                  number={index + 1}
                  beforeCurrent={index < currentIndex}
                  open={disclosure.openPhases.has(phase.key)}
                  onToggle={() => disclosure.togglePhase(phase.key)}
                  openSteps={disclosure.openSteps}
                  onToggleStep={disclosure.toggleStep}
                  nextKey={progress.next?.key}
                />
              ))}
              <SetupAnswersSummary answers={progress.savedAnswers} defaultOpen={welcome} />
              {!canWrite && loaded && (
                <p className="setup-readonly">You can see setup progress, but only an owner or admin can mark steps as filed, put them off or cross them out.</p>
              )}
            </div>
          </div>
        )}
      </div>
      <SkipStepDialog step={handlers.skip.step} onClose={handlers.skip.close} onSave={handlers.skip.save} />
      <MarkFiledDrawer open={handlers.filed.isOpen} registry={registry} today={today} onClose={handlers.filed.close} onSave={handlers.filed.save} />
      <RecordCertificateDrawer
        open={handlers.certificate.isOpen}
        society={society}
        corporation={isCorporation(society)}
        today={today}
        onClose={handlers.certificate.close}
        onSave={handlers.certificate.save}
      />
    </SetupViewContext.Provider>
  );
}
