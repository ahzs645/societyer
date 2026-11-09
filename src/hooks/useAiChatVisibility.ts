import { useCallback, useEffect, useRef, useState } from "react";
import { readPreferenceFlag, writePreferenceFlag } from "../lib/uiPreferenceFlag";
import { isModuleEnabled } from "../lib/modules";
import { useSociety } from "./useSociety";

const STORAGE_KEY = "societyer.aiChat.hidden";
const CHANGE_EVENT = "societyer:ai-chat-changed";

function readStored(): boolean {
  return readPreferenceFlag(STORAGE_KEY);
}

/**
 * The AI chat shows only when the workspace has the AI module on (Settings →
 * Modules, off by default) and this person hasn't hidden it on this device.
 * `hidden` is the effective state; `personallyHidden` is the device choice.
 */
export function useAiChatVisibility() {
  const society = useSociety();
  // While a workspace switch is loading, keep the last known choice so an open
  // assistant isn't unmounted (losing its draft) between two AI-enabled workspaces.
  const lastKnownEnabled = useRef(false);
  if (society !== undefined) lastKnownEnabled.current = isModuleEnabled(society, "aiAgents");
  const moduleEnabled = lastKnownEnabled.current;
  const [personallyHidden, setHiddenState] = useState<boolean>(() => readStored());

  useEffect(() => {
    const sync = () => setHiddenState(readStored());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) sync();
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setHidden = useCallback((next: boolean) => {
    writePreferenceFlag(STORAGE_KEY, next);
    setHiddenState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { hidden: personallyHidden || !moduleEnabled, personallyHidden, moduleEnabled, setHidden };
}
