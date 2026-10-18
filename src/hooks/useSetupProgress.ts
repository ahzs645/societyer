import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Per-organization dismissal of the setup reminders: the shell's setup pill
 * and, with it, the Dashboard card. (Dismissing only the Dashboard card is a
 * dashboard layout choice and keeps the pill.) The checklist itself lives in `useOrganizationSetup`
 * (`/app/organization-setup`); this only remembers, per browser, that the
 * viewer hid the reminders. It never hides the setup view.
 *
 * The storage key predates the setup view and is kept so earlier dismissals
 * still apply.
 */

export const HIDDEN_ONBOARDING_FLOW_KEY = "societyer.dashboard.hiddenOnboardingFlowSocietyIds";
/** Same-tab sync: `storage` events only fire in other tabs. */
export const SETUP_GUIDE_VISIBILITY_EVENT = "societyer:setup-guide-visibility";

export function readHiddenOnboardingFlowSocietyIds(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_ONBOARDING_FLOW_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenOnboardingFlowSocietyIds(ids: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_ONBOARDING_FLOW_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the choice lasts for this page view */
  }
  window.dispatchEvent(new CustomEvent(SETUP_GUIDE_VISIBILITY_EVENT, { detail: ids }));
}

/** Per-organization dismissal, kept in sync across every reader in the tab. */
export function useSetupGuideHidden(societyId: string | null | undefined) {
  const [hiddenIds, setHiddenIds] = useState<string[]>(readHiddenOnboardingFlowSocietyIds);
  useEffect(() => {
    const sync = () => setHiddenIds(readHiddenOnboardingFlowSocietyIds());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === HIDDEN_ONBOARDING_FLOW_KEY) sync();
    };
    window.addEventListener(SETUP_GUIDE_VISIBILITY_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SETUP_GUIDE_VISIBILITY_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const hidden = Boolean(societyId && hiddenIds.includes(societyId));
  const setHidden = useCallback(
    (next: boolean) => {
      if (!societyId) return;
      const current = readHiddenOnboardingFlowSocietyIds();
      const ids = next
        ? Array.from(new Set([...current, societyId]))
        : current.filter((id) => id !== societyId);
      setHiddenIds(ids);
      writeHiddenOnboardingFlowSocietyIds(ids);
    },
    [societyId],
  );
  return { hidden, setHidden };
}

/*
 * Setup progress shows in one place at a time: while the Dashboard's setup
 * card is on screen, the shell's setup pill (top-bar ring on phones) stays
 * out of the way. The card registers itself here; once it is dismissed or
 * setup is done the pill comes back as the way into setup.
 */
let setupSummaryMounts = 0;
const setupSummaryListeners = new Set<() => void>();
const notifySetupSummary = () => setupSummaryListeners.forEach((listener) => listener());
const subscribeSetupSummary = (listener: () => void) => {
  setupSummaryListeners.add(listener);
  return () => {
    setupSummaryListeners.delete(listener);
  };
};

/** Call from the setup summary card: marks it on screen while mounted. */
export function useRegisterSetupSummary() {
  useEffect(() => {
    setupSummaryMounts += 1;
    notifySetupSummary();
    return () => {
      setupSummaryMounts -= 1;
      notifySetupSummary();
    };
  }, []);
}

/** True while a setup summary card is on screen. */
export function useSetupSummaryOnScreen(): boolean {
  return useSyncExternalStore(subscribeSetupSummary, () => setupSummaryMounts > 0, () => false);
}
