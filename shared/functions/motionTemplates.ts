/**
 * PORTABLE FUNCTIONS: the motion-templates domain (list / create / update /
 * remove).
 *
 * Reads/writes the `motionTemplates` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `seedDefaults` performs backfill seeding and stays on the native
 * Convex runtime.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

const SEED_MOTIONS: Array<{
  title: string;
  body: string;
  tags: string[];
  requiresSpecialResolution: boolean;
  notes?: string;
}> = [
  {
    title: "Adopt agenda",
    body: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented.",
    tags: ["governance", "approve-agenda"],
    requiresSpecialResolution: false,
  },
  {
    title: "Approve minutes of previous meeting",
    body: "BE IT RESOLVED THAT the minutes of the previous meeting, as circulated, be approved.",
    tags: ["governance", "previous-minutes"],
    requiresSpecialResolution: false,
  },
  {
    title: "Adopt annual budget",
    body: "BE IT RESOLVED THAT the annual budget, as presented by the Treasurer, be adopted.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Appoint auditor",
    body: "BE IT RESOLVED THAT [Firm Name] be appointed as the auditor of the Society for the current fiscal year.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Accept financial statements",
    body: "BE IT RESOLVED THAT the financial statements for the fiscal year ending [Date] be accepted as presented.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Amend bylaws (special resolution)",
    body: "BE IT RESOLVED AS A SPECIAL RESOLUTION THAT the bylaws of the Society be amended as set out in the attached document.",
    tags: ["bylaws"],
    requiresSpecialResolution: true,
    notes: "Requires ≥2/3 or per bylaws. Must be filed with BC Registry within 30 days.",
  },
  {
    title: "Elect director to fill vacancy",
    body: "BE IT RESOLVED THAT [Name] be elected as a director of the Society to fill the vacancy created by [reason].",
    tags: ["governance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Approve membership fee schedule",
    body: "BE IT RESOLVED THAT the membership fee schedule, as set out in the attached appendix, be approved effective [Date].",
    tags: ["membership"],
    requiresSpecialResolution: false,
  },
  {
    title: "Adjourn meeting",
    body: "BE IT RESOLVED THAT the meeting be adjourned.",
    tags: ["operations", "adjournment"],
    requiresSpecialResolution: false,
  },
  {
    title: "Approve strategic plan",
    body: "BE IT RESOLVED THAT the [Year] strategic plan, as presented, be adopted.",
    tags: ["governance"],
    requiresSpecialResolution: false,
  },
  {
    title: "Authorize bank signing authority",
    body: "BE IT RESOLVED THAT [Names and Positions] be authorized as signing officers for the Society's bank accounts, with any two to sign.",
    tags: ["finance"],
    requiresSpecialResolution: false,
  },
];

export async function seedDefaultsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  const existing = await ctx.db
    .query("motionTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  if (existing.length > 0) return { inserted: 0, existing: existing.length };
  const now = new Date().toISOString();
  let inserted = 0;
  for (const seed of SEED_MOTIONS) {
    await ctx.db.insert("motionTemplates", {
      societyId,
      title: seed.title,
      body: seed.body,
      tags: seed.tags,
      requiresSpecialResolution: seed.requiresSpecialResolution,
      notes: seed.notes,
      usageCount: 0,
      createdAtISO: now,
      updatedAtISO: now,
    });
    inserted++;
  }
  return { inserted, existing: 0 };
}

/** Normalize a tag list the same way motions.setTags does: trim, lowercase,
 *  drop blanks, dedupe. Keeps the library filter and the motions filter using
 *  the same vocabulary. */
function normalizeTags(tags?: string[]): string[] {
  return Array.from(
    new Set((tags ?? []).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean)),
  );
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("motionTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  rows.sort((a, b) => a.title.localeCompare(b.title));
  return rows;
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    body: string;
    tags?: string[];
    requiresSpecialResolution?: boolean;
    notes?: string;
  },
) {
  const now = new Date().toISOString();
  return await ctx.db.insert("motionTemplates", {
    societyId: args.societyId,
    title: args.title,
    body: args.body,
    tags: normalizeTags(args.tags),
    requiresSpecialResolution: args.requiresSpecialResolution ?? false,
    notes: args.notes,
    usageCount: 0,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { templateId, tags, ...patch }: {
    templateId: string;
    title?: string;
    body?: string;
    tags?: string[];
    requiresSpecialResolution?: boolean;
    notes?: string;
  },
) {
  const clean: Record<string, unknown> = { updatedAtISO: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  if (tags !== undefined) clean.tags = normalizeTags(tags);
  await ctx.db.patch(templateId, clean);
  return templateId;
}

export async function removePortable(ctx: PortableMutationCtx, { templateId }: { templateId: string }) {
  await ctx.db.delete(templateId);
}
