import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { OrganizationSetupProgress, SetupPhaseKey, SetupStepKey } from "../../../shared/organizationSetup/types";
import { findSetupStep } from "./useOrganizationSetup";

const STEP_HASH = /^#step-([a-z-]+)$/;

function toggled(set: Set<string>, key: string) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/**
 * Which phases and steps are expanded. The current phase (and the phase of
 * the next step) open on first load, unless `startCollapsed` (phones, where
 * the next-step card already names that step at the top and the open phase
 * would repeat it); `#step-<key>` expands that step, opens its phase and
 * scrolls to it, on load and whenever the hash changes.
 */
export function useSetupDisclosure(progress: OrganizationSetupProgress | undefined, { startCollapsed = false }: { startCollapsed?: boolean } = {}) {
  const location = useLocation();
  const [openPhases, setOpenPhases] = useState<Set<string>>(new Set());
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [activePhase, setActivePhase] = useState<SetupPhaseKey | undefined>();
  const initialized = useRef(false);
  const pendingScroll = useRef<string | null>(null);

  // Scroll once the expanded phase or step has rendered.
  useEffect(() => {
    const target = pendingScroll.current;
    if (!target) return;
    pendingScroll.current = null;
    const element = document.getElementById(target);
    if (!element) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    element.querySelector<HTMLElement>(".setup-step__toggle, .setup-phase__toggle")?.focus({ preventScroll: true });
  });

  const focusStep = useCallback((key: SetupStepKey | string) => {
    const step = findSetupStep(progress, key);
    if (!step) return;
    setOpenPhases((prev) => new Set(prev).add(step.phase));
    setOpenSteps((prev) => new Set(prev).add(step.key));
    setActivePhase(step.phase);
    pendingScroll.current = `step-${step.key}`;
  }, [progress]);

  useEffect(() => {
    if (!progress || initialized.current) return;
    initialized.current = true;
    const phases = new Set<string>();
    const next = findSetupStep(progress, progress.next?.key);
    // With nothing left to do there is no next-step card repeating a step.
    if (!startCollapsed || !next) {
      phases.add(progress.currentPhase);
      if (next) phases.add(next.phase);
    }
    setOpenPhases(phases);
    setActivePhase(progress.currentPhase);
    const hashKey = STEP_HASH.exec(location.hash)?.[1];
    if (hashKey) focusStep(hashKey);
  }, [progress, location.hash, focusStep, startCollapsed]);

  useEffect(() => {
    if (!initialized.current) return;
    const hashKey = STEP_HASH.exec(location.hash)?.[1];
    if (hashKey) focusStep(hashKey);
    // Only a hash change re-focuses; progress updates must not scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  return {
    openPhases,
    openSteps,
    activePhase,
    focusStep,
    togglePhase: (key: SetupPhaseKey) => setOpenPhases((prev) => toggled(prev, key)),
    toggleStep: (key: SetupStepKey) => setOpenSteps((prev) => toggled(prev, key)),
    selectPhase: (key: SetupPhaseKey) => {
      setOpenPhases((prev) => new Set(prev).add(key));
      setActivePhase(key);
      pendingScroll.current = `phase-${key}`;
    },
  };
}
