import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const overview = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [addresses, registrations, identifiers] = await Promise.all([
      ctx.db
        .query("organizationAddresses")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("organizationRegistrations")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("organizationIdentifiers")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    ]);

    return {
      addresses: sortCurrentFirst(addresses, "effectiveFrom"),
      registrations: sortCurrentFirst(registrations, "registrationDate"),
      identifiers: identifiers
        .slice()
        .sort((a, b) => String(a.kind ?? "").localeCompare(String(b.kind ?? ""))),
    };
  },
});

export const seedFromSocietyAddresses = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    const existing = await ctx.db
      .query("organizationAddresses")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const now = new Date().toISOString();
    let created = 0;

    const insertLegacy = async (type: string, address: unknown) => {
      const text = cleanText(address);
      if (!text) return;
      if (existing.some((row) => row.type === type && row.status === "current")) return;
      await ctx.db.insert("organizationAddresses", {
        societyId,
        type,
        status: "current",
        street: text,
        city: "Needs review",
        country: "Canada",
        notes: "Created from legacy society address text. Review and split into structured fields.",
        createdAtISO: now,
        updatedAtISO: now,
      });
      created += 1;
    };

    await insertLegacy("registered_office", society.registeredOfficeAddress);
    await insertLegacy("mailing", society.mailingAddress);

    return { created };
  },
});

export const upsertAddress = mutation({
  args: {
    id: v.optional(v.id("organizationAddresses")),
    societyId: v.id("societies"),
    type: v.string(),
    status: v.string(),
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    street: v.string(),
    unit: v.optional(v.string()),
    city: v.string(),
    provinceState: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.string(),
    notes: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      ...cleanObject(args),
      status: cleanText(args.status) || "current",
      type: cleanText(args.type) || "other",
      street: cleanText(args.street) || "Needs review",
      city: cleanText(args.city) || "Needs review",
      country: cleanText(args.country) || "Canada",
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("organizationAddresses", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const removeAddress = mutation({
  args: { id: v.id("organizationAddresses") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const upsertRegistration = mutation({
  args: {
    id: v.optional(v.id("organizationRegistrations")),
    societyId: v.id("societies"),
    jurisdiction: v.string(),
    assumedName: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    registrationDate: v.optional(v.string()),
    activityCommencementDate: v.optional(v.string()),
    deRegistrationDate: v.optional(v.string()),
    nuansNumber: v.optional(v.string()),
    officialEmail: v.optional(v.string()),
    representativeIds: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      ...cleanObject(args),
      jurisdiction: cleanText(args.jurisdiction) || "Needs review",
      representativeIds: args.representativeIds ?? [],
      status: cleanText(args.status) || "needs_review",
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("organizationRegistrations", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const removeRegistration = mutation({
  args: { id: v.id("organizationRegistrations") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const upsertIdentifier = mutation({
  args: {
    id: v.optional(v.id("organizationIdentifiers")),
    societyId: v.id("societies"),
    kind: v.string(),
    number: v.string(),
    jurisdiction: v.optional(v.string()),
    foreignJurisdiction: v.optional(v.string()),
    registeredAt: v.optional(v.string()),
    status: v.optional(v.string()),
    accessLevel: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      ...cleanObject(args),
      kind: cleanText(args.kind) || "other",
      number: cleanText(args.number) || "Needs review",
      status: cleanText(args.status) || "needs_review",
      accessLevel: cleanText(args.accessLevel) || "restricted",
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("organizationIdentifiers", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const removeIdentifier = mutation({
  args: { id: v.id("organizationIdentifiers") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

function sortCurrentFirst(rows: any[], dateField: string) {
  return rows.slice().sort((a, b) => {
    const statusScore = (row: any) => row.status === "current" || row.status === "active" ? 0 : 1;
    const score = statusScore(a) - statusScore(b);
    if (score !== 0) return score;
    return String(b[dateField] ?? "").localeCompare(String(a[dateField] ?? ""));
  });
}

function cleanObject<T extends Record<string, any>>(source: T) {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      const cleaned = cleanText(value);
      if (cleaned !== undefined) result[key] = cleaned;
      continue;
    }
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
