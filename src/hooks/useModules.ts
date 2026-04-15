import { useMemo } from "react";
import {
  isModuleEnabled,
  normalizeModuleSettings,
  type ModuleKey,
} from "../lib/modules";
import { useSociety } from "./useSociety";

export function useModuleSettings() {
  const society = useSociety();
  return useMemo(
    () => normalizeModuleSettings(society),
    [society],
  );
}

export function useModuleEnabled(key: ModuleKey) {
  const society = useSociety();
  return isModuleEnabled(society, key);
}
