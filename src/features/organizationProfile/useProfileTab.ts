import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUrlTab } from "../../hooks/useUrlTab";
import { anchorIdFromHash, onRevealAnchor, revealAnchor } from "../../lib/anchorReveal";
import { PROFILE_ANCHOR_TABS } from "./tabFields";
import { PROFILE_TABS, type ProfileTab } from "./types";

/**
 * The profile's tab, kept in `?tab=` (Overview when absent).
 *
 * `showTab(tab, anchor)` opens a tab and, with an anchor, puts it in the hash
 * so the app's anchor reveal scrolls to that section once the tab renders it.
 * Without an anchor the current hash is kept, so a reveal already under way
 * (a deep link) is not cancelled.
 *
 * Section links from before the tabs (`#registered-office`, `#tax-identifiers`,
 * `#more-organization-details`) open the tab that now holds the section, both
 * as deep links and as same-page reveals.
 */
export function useProfileTab() {
  const [tab, setTab] = useUrlTab(PROFILE_TABS, "overview");
  const location = useLocation();
  const navigate = useNavigate();

  const showTab = (next: ProfileTab, anchor?: string) => {
    const params = new URLSearchParams(location.search);
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const search = params.toString();
    const hash = anchor ? `#${anchor}` : location.hash;
    // The same hash is no navigation for the reveal hook; reveal it directly.
    if (anchor && location.hash === hash) revealAnchor(anchor);
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash }, { replace: true });
  };

  const latest = useRef({ tab, showTab });
  latest.current = { tab, showTab };
  const openSectionTab = (id: string | null) => {
    const target = id ? PROFILE_ANCHOR_TABS[id] : undefined;
    if (target && target !== latest.current.tab) latest.current.showTab(target);
  };
  const openSectionTabRef = useRef(openSectionTab);
  openSectionTabRef.current = openSectionTab;

  useEffect(() => {
    openSectionTabRef.current(anchorIdFromHash(location.hash));
  }, [location.hash]);
  useEffect(() => onRevealAnchor((id) => openSectionTabRef.current(id)), []);

  return { tab, setTab, showTab };
}
