import { ConvexError, v } from "convex/values";
import {
  MODULES_BY_KEY,
  type ModuleKey,
  normalizeModuleSettings,
} from "../../src/lib/modules";

export const disabledModulesValidator = v.array(v.string());

export function getModuleSettings(society: any) {
  return normalizeModuleSettings(society);
}

export function isSocietyModuleEnabled(society: any, key: ModuleKey) {
  return getModuleSettings(society)[key];
}

export async function requireEnabledModule(
  ctx: any,
  societyId: any,
  key: ModuleKey,
) {
  const society = await ctx.db.get(societyId);
  if (!society) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Society not found.",
    });
  }
  if (!isSocietyModuleEnabled(society, key)) {
    throw new ConvexError({
      code: "MODULE_DISABLED",
      message: `${MODULES_BY_KEY[key].label} is disabled for this workspace.`,
    });
  }
  return society;
}
