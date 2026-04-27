import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./users";

export const get = query({
  args: {
    societyId: v.id("societies"),
    scopeKey: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, scopeKey, actingUserId }) => {
    await requireRole(ctx, { societyId, actingUserId, required: "Viewer" });
    const rows = await ctx.db
      .query("recordLayouts")
      .withIndex("by_society_scope", (q) => q.eq("societyId", societyId).eq("scopeKey", scopeKey))
      .take(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      layout: parseLayout(row.layoutJson),
    };
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    scopeKey: v.string(),
    layoutJson: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, scopeKey, layoutJson, actingUserId }) => {
    await requireRole(ctx, { societyId, actingUserId, required: "Member" });
    const layout = parseLayout(layoutJson);
    if (!layout) throw new Error("Invalid record layout.");
    const normalizedLayoutJson = JSON.stringify(layout);
    const now = new Date().toISOString();
    const rows = await ctx.db
      .query("recordLayouts")
      .withIndex("by_society_scope", (q) => q.eq("societyId", societyId).eq("scopeKey", scopeKey))
      .collect();
    const existing = rows[0];
    if (existing) {
      await ctx.db.patch(existing._id, { layoutJson: normalizedLayoutJson, updatedAtISO: now });
      await Promise.all(rows.slice(1).map((row) => ctx.db.delete(row._id)));
      return existing._id;
    }
    return await ctx.db.insert("recordLayouts", {
      societyId,
      scopeKey,
      layoutJson: normalizedLayoutJson,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const remove = mutation({
  args: {
    societyId: v.id("societies"),
    scopeKey: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, scopeKey, actingUserId }) => {
    await requireRole(ctx, { societyId, actingUserId, required: "Member" });
    const rows = await ctx.db
      .query("recordLayouts")
      .withIndex("by_society_scope", (q) => q.eq("societyId", societyId).eq("scopeKey", scopeKey))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
  },
});

function parseLayout(raw: string | unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || parsed.version !== 1 || !parsed.sections || typeof parsed.sections !== "object") return null;
    const sections: Record<string, { order: string[]; hidden: string[] }> = {};
    for (const section of ["summary", "tabs", "inspector"]) {
      const state = parsed.sections[section];
      if (!state || typeof state !== "object") continue;
      sections[section] = {
        order: uniqueStrings(state.order),
        hidden: uniqueStrings(state.hidden),
      };
    }
    return { version: 1, sections };
  } catch {
    return null;
  }
}

function uniqueStrings(value: unknown) {
  return Array.from(new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []));
}
