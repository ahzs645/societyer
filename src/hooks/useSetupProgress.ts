import { useCallback, useEffect, useState } from "react";

/**
 * Per-organization dismissal of the setup summary (Dashboard card) and the
 * shell's setup pill. The checklist itself lives in `useOrganizationSetup`
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
