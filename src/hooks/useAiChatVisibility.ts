import { useCallback, useEffect, useState } from "react";
import { readPreferenceFlag, writePreferenceFlag } from "../lib/uiPreferenceFlag";

const STORAGE_KEY = "societyer.aiChat.hidden";
const CHANGE_EVENT = "societyer:ai-chat-changed";

function readStored(): boolean {
  return readPreferenceFlag(STORAGE_KEY);
}

export function useAiChatVisibility() {
  const [hidden, setHiddenState] = useState<boolean>(() => readStored());

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

  return { hidden, setHidden };
}
