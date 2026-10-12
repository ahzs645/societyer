// Import-session links for share-ledger rows (YCN and other share-register imports):
// which rights class and which role holders an imported transfer names.

import { arrayOf, cleanText } from "./importSessionUtils";

/**
 * The rights class an imported transfer belongs to: an explicit id of this
 * organization, else the class applied from the same import (by its import id),
 * else a unique match on the class code (idPrefix) or name.
 */
export async function importedRightsClassId(ctx: any, societyId: string, payload: any): Promise<string | undefined> {
  const classes = await ctx.db.query("rightsClasses").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const explicit = cleanText(payload?.rightsClassId);
  if (explicit) return classes.some((row: any) => String(row._id) === explicit) ? explicit : undefined;
  const externalId = cleanText(payload?.rightsClassExternalId);
  const code = cleanText(payload?.rightsClassCode)?.toLowerCase();
  const name = cleanText(payload?.rightsClassName)?.toLowerCase();
  const pickOne = (rows: any[]) => (rows.length === 1 ? String(rows[0]._id) : undefined);
  return (externalId ? pickOne(classes.filter((row: any) => arrayOf(row.sourceExternalIds).includes(externalId))) : undefined)
    ?? (code ? pickOne(classes.filter((row: any) => cleanText(row.idPrefix)?.toLowerCase() === code)) : undefined)
    ?? (name ? pickOne(classes.filter((row: any) => cleanText(row.className)?.toLowerCase() === name)) : undefined);
}

/** true when the transfer names a class (by import id, code or name) rather than leaving it out. */
export function namesRightsClass(payload: any): boolean {
  return Boolean(cleanText(payload?.rightsClassId) || cleanText(payload?.rightsClassExternalId) || cleanText(payload?.rightsClassCode));
}

/**
 * A holder's role-holder id: an explicit id of this organization, else the
 * holder applied from the same import (by its import id), else the one
 * shareholder of that name.
 */
export async function importedRoleHolderId(
  ctx: any,
  societyId: string,
  explicitValue: unknown,
  externalValue: unknown,
  holderName?: unknown,
): Promise<string | undefined> {
  const explicit = cleanText(explicitValue);
  const externalId = cleanText(externalValue);
  if (!explicit && !externalId) return undefined;
  const rows = await ctx.db.query("roleHolders").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  if (explicit) return rows.some((row: any) => String(row._id) === explicit) ? explicit : undefined;
  const matches = rows.filter((row: any) => arrayOf(row.sourceExternalIds).includes(externalId));
  if (matches.length === 1) return String(matches[0]._id);
  const name = cleanText(holderName)?.toLowerCase();
  const byName = name ? rows.filter((row: any) => row.roleType === "shareholder" && cleanText(row.fullName)?.toLowerCase() === name) : [];
  return byName.length === 1 ? String(byName[0]._id) : undefined;
}
