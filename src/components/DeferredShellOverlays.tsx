import { lazy, Suspense, useEffect, useState } from "react";
import { usePermissions } from "../hooks/usePermissions";
import { OPEN_AI_ASSISTANT_EVENT } from "../features/ai/aiAssistantEvents";

const CommandPalette = lazy(() => import("./CommandPalette").then((module) => ({ default: module.CommandPalette })));
const AiAssistant = lazy(() => import("../features/ai/GlobalAiAssistant").then((module) => ({ default: module.GlobalAiAssistant })));

function LoadingOverlay() {
  return <div className="kbar-backdrop"><div className="kbar" role="status" aria-live="polite" style={{ padding: 24 }}>Loading…</div></div>;
}

/** The first shortcut must survive the asynchronous import. Once mounted, the
 * palette owns its existing listeners, focus handling and toggle behavior. */
export function DeferredCommandPalette() {
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    if (activated) return;
    const activate = () => setActivated(true);
    const onKey = (event: KeyboardEvent) => {
      const typingTarget = event.target instanceof HTMLElement && (
        event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      );
      const commandShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashShortcut = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typingTarget;
      if (!commandShortcut && !slashShortcut) return;
      event.preventDefault();
      activate();
    };
    window.addEventListener("kbar:open", activate);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("kbar:open", activate);
      window.removeEventListener("keydown", onKey);
    };
  }, [activated]);
  return activated ? <Suspense fallback={<LoadingOverlay />}><CommandPalette initiallyOpen /></Suspense> : null;
}

export function DeferredAiAssistant() {
  const { can } = usePermissions();
  const canRead = can("tasks:read");
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    if (activated) return;
    const activate = () => { if (canRead) setActivated(true); };
    window.addEventListener(OPEN_AI_ASSISTANT_EVENT, activate);
    return () => window.removeEventListener(OPEN_AI_ASSISTANT_EVENT, activate);
  }, [activated, canRead]);
  return activated && canRead ? <Suspense fallback={<LoadingOverlay />}><AiAssistant initiallyOpen /></Suspense> : null;
}
