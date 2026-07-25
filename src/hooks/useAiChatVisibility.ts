import { useCallback, useEffect, useState } from "react";
import { isStaticDemoRuntime } from "../lib/staticRuntime";

const STORAGE_KEY = "societyer.aiChat.hidden";
const CHANGE_EVENT = "societyer:ai-chat-changed";

function readStored(): boolean {
  if (isStaticDemoRuntime()) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
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
    if (!isStaticDemoRuntime()) {
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore quota / disabled-storage failures
      }
    }
    setHiddenState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { hidden, setHidden };
}
