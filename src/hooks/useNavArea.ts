import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useRegisterCommand } from "../lib/commands";
import { NAV_AREAS, type NavAreaChoice } from "../lib/navConfig";
import { navAreaForPath } from "../lib/navTree";
import { isTypingTarget } from "../lib/shortcutsRegistry";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { useCurrentUserId } from "./useCurrentUser";

/**
 * The sidebar's workspace area (All, Governance or Finance). One shared store
 * so the sidebar, the rail button, the command palette and the keyboard
 * shortcuts agree. The choice is remembered per person: it is stored under
 * the signed-in user's key in this browser (the demo keeps it for the
 * session only, like the other sidebar preferences).
 */
const STORAGE_KEY = "societyer.sidebar.area";
const AREA_IDS = new Set<NavAreaChoice>(NAV_AREAS.map((area) => area.id));

let current: NavAreaChoice | null = null;
let storageScope = "";
const listeners = new Set<() => void>();

function storageKey() {
  return storageScope ? `${STORAGE_KEY}:${storageScope}` : STORAGE_KEY;
}

function readStored(): NavAreaChoice {
  if (isStaticDemoRuntime()) return "all";
  try {
    const value = localStorage.getItem(storageKey()) as NavAreaChoice | null;
    return value && AREA_IDS.has(value) ? value : "all";
  } catch {
    return "all";
  }
}

function getSnapshot(): NavAreaChoice {
  if (current == null) current = readStored();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setNavArea(next: NavAreaChoice) {
  if (getSnapshot() === next) return;
  current = next;
  if (!isStaticDemoRuntime()) {
    try {
      localStorage.setItem(storageKey(), next);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies.
    }
  }
  for (const listener of listeners) listener();
}

/** Re-read the stored area for a different person (on sign-in or user switch). */
export function setNavAreaScope(scope: string | null | undefined) {
  const next = scope ?? "";
  if (next === storageScope) return;
  storageScope = next;
  current = readStored();
  for (const listener of listeners) listener();
}

export function useNavArea(): NavAreaChoice {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function navAreaHome(area: NavAreaChoice) {
  return NAV_AREAS.find((entry) => entry.id === area)?.home ?? "/app";
}

/**
 * Choose an area. When the current page sits outside it, go to the area's
 * home so the sidebar and the page agree.
 */
export function useSwitchNavArea() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  return useCallback(
    (next: NavAreaChoice) => {
      setNavArea(next);
      if (next === "all") return;
      // Finance opens on its home unless already on a finance page; Governance
      // only leaves a finance page (its home is the shared dashboard).
      const pageArea = navAreaForPath(pathRef.current);
      if (next === "finance" ? pageArea !== "finance" : pageArea === "finance") navigate(navAreaHome(next));
    },
    [navigate],
  );
}

const SEQUENCE_WINDOW_MS = 1200;
/** "g then …" keys that switch area (g then f still opens Financials). */
const AREA_KEYS: Record<string, NavAreaChoice> = { g: "governance", a: "all" };

/**
 * Shell wiring for the area switcher, mounted once by the layout:
 * - the area follows the page: opening a finance page while in Governance
 *   (from search, a link or "g then f", which opens Financials) switches to
 *   Finance, and back;
 * - "g then g" switches to Governance, "g then a" shows all areas;
 * - command palette entries for each area.
 */
export function useNavAreaShell() {
  const { t } = useTranslation();
  const userScope = useCurrentUserId();
  const location = useLocation();
  const area = useNavArea();
  const switchArea = useSwitchNavArea();

  // Before paint, so a remembered area never flashes the full tree first.
  useLayoutEffect(() => {
    setNavAreaScope(userScope);
  }, [userScope]);

  useEffect(() => {
    const pageArea = navAreaForPath(location.pathname);
    if (pageArea && getSnapshot() !== "all" && getSnapshot() !== pageArea) setNavArea(pageArea);
  }, [location.pathname]);

  useEffect(() => {
    let pendingSince = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector('[aria-modal="true"], .kbar')) {
        pendingSince = 0;
        return;
      }
      const key = event.key.toLowerCase();
      const now = Date.now();
      if (pendingSince && now - pendingSince <= SEQUENCE_WINDOW_MS) {
        pendingSince = 0;
        const target = AREA_KEYS[key];
        if (target && !event.shiftKey) {
          event.preventDefault();
          switchArea(target);
        }
        return;
      }
      pendingSince = key === "g" && !event.shiftKey ? now : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [switchArea]);

  const labels = useMemo(
    () => Object.fromEntries(NAV_AREAS.map((entry) => [entry.id, t(entry.i18nKey, entry.label)])) as Record<NavAreaChoice, string>,
    [t],
  );
  const command = (id: NavAreaChoice, label: string, shortcut?: string) => ({
    id: `nav-area-${id}`,
    label: area === id ? `${label} (${t("navArea.current", "current")})` : label,
    icon: NAV_AREAS.find((entry) => entry.id === id)!.icon,
    category: "Navigation" as const,
    shortcut,
    run: () => switchArea(id),
  });
  useRegisterCommand(command("finance", t("navArea.switchToFinance", "Switch to Finance")));
  useRegisterCommand(command("governance", t("navArea.switchToGovernance", "Switch to Governance"), "G G"));
  useRegisterCommand(command("all", t("navArea.showAll", "Show all areas"), "G A"));
  return { area, labels };
}
