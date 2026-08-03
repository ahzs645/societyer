import { defineTable } from "convex/server";
import { v } from "convex/values";

export const storageTables = {
  storageOwnership: defineTable({
    storageId: v.id("_storage"),
    societyId: v.id("societies"),
    createdAtISO: v.string(),
  }).index("by_storage", ["storageId"]),
};
