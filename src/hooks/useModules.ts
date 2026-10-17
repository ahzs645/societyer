import { useMemo } from "react";
import {
  isModuleEnabled,
  MODULE_KEYS,
  type ModuleKey,
  type ModuleSettings,
} from "../lib/modules";
import { useSociety } from "./useSociety";

export function useModuleSettings() {
  const society = useSociety();
  return useMemo(
    () => Object.fromEntries(MODULE_KEYS.map((key) => [key, isModuleEnabled(society, key)])) as ModuleSettings,
    [society],
  );
}

export function useModuleEnabled(key: ModuleKey) {
  const society = useSociety();
  return isModuleEnabled(society, key);
}
