// @ts-nocheck
/**
 * Seeds objectMetadata + fieldMetadata + a default "All records" view for
 * each Twenty-style object. Idempotent — re-running tops up missing rows
 * instead of creating duplicates.
 *
 * Run with: `npx convex run seedRecordTableMetadata:run`
 * Or per-society: `npx convex run seedRecordTableMetadata:runForSociety '{"societyId":"..."}'`
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Field types the registry understands — keep in sync with
// src/modules/object-record/types/FieldType.ts
const FIELD_TYPES = {
  TEXT: "TEXT",
  NUMBER: "NUMBER",
  CURRENCY: "CURRENCY",
  BOOLEAN: "BOOLEAN",
  DATE: "DATE",
  DATE_TIME: "DATE_TIME",
  SELECT: "SELECT",
  MULTI_SELECT: "MULTI_SELECT",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  LINK: "LINK",
  RELATION: "RELATION",
  RATING: "RATING",
  UUID: "UUID",
  ARRAY: "ARRAY",
} as const;

type SeedField = {
  name: string;
  label: string;
  fieldType: string;
  icon?: string;
  description?: string;
  config?: Record<string, unknown>;
  isSystem?: boolean;
  isHidden?: boolean;
};

type SeedObject = {
  nameSingular: string;
  namePlural: string;      // must match the Convex table name
  labelSingular: string;
  labelPlural: string;
  icon?: string;
  iconColor?: string;
  routePath?: string;
  labelIdentifierFieldName: string;
  fields: SeedField[];
  defaultView: {
    name: string;
    columns: { fieldName: string; size?: number; position?: number }[];
  };
};

/* --------------------------- Object definitions --------------------------- */

const OBJECTS: SeedObject[] = [
  {
    nameSingular: "member",
    namePlural: "members",
    labelSingular: "Member",
    labelPlural: "Members",
    icon: "Users",
    iconColor: "blue",
    routePath: "/app/members",
    labelIdentifierFieldName: "fullName",
    fields: [
      { name: "firstName", label: "First name", fieldType: FIELD_TYPES.TEXT, icon: "User", isSystem: true },
      { name: "lastName", label: "Last name", fieldType: FIELD_TYPES.TEXT, icon: "User", isSystem: true },
      { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, icon: "Mail" },
      { name: "phone", label: "Phone", fieldType: FIELD_TYPES.PHONE, icon: "Phone" },
      { name: "address", label: "Address", fieldType: FIELD_TYPES.TEXT, icon: "MapPin" },
      { name: "aliases", label: "Aliases", fieldType: FIELD_TYPES.ARRAY, icon: "Tag" },
      {
        name: "membershipClass",
        label: "Class",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Tag",
        config: {
          options: [
            { value: "Regular", label: "Regular", color: "blue" },
            { value: "Honorary", label: "Honorary", color: "purple" },
            { value: "Student", label: "Student", color: "teal" },
            { value: "Associate", label: "Associate", color: "gray" },
          ],
        },
      },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        config: {
          options: [
            { value: "Active", label: "Active", color: "green" },
            { value: "Inactive", label: "Inactive", color: "gray" },
            { value: "Suspended", label: "Suspended", color: "red" },
          ],
        },
      },
      { name: "votingRights", label: "Voting rights", fieldType: FIELD_TYPES.BOOLEAN, icon: "Vote" },
      { name: "joinedAt", label: "Joined", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "leftAt", label: "Left", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All members",
      columns: [
        { fieldName: "firstName", size: 160 },
        { fieldName: "lastName", size: 160 },
        { fieldName: "membershipClass", size: 140 },
        { fieldName: "status", size: 120 },
        { fieldName: "votingRights", size: 110 },
        { fieldName: "joinedAt", size: 140 },
        { fieldName: "email", size: 240 },
      ],
    },
  },
  {
    nameSingular: "director",
    namePlural: "directors",
    labelSingular: "Director",
    labelPlural: "Directors",
    icon: "ShieldCheck",
    iconColor: "violet",
    routePath: "/app/directors",
    labelIdentifierFieldName: "fullName",
    fields: [
      { name: "firstName", label: "First name", fieldType: FIELD_TYPES.TEXT, icon: "User", isSystem: true },
      { name: "lastName", label: "Last name", fieldType: FIELD_TYPES.TEXT, icon: "User", isSystem: true },
      { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, icon: "Mail" },
      { name: "position", label: "Position", fieldType: FIELD_TYPES.TEXT, icon: "Briefcase" },
      { name: "isBCResident", label: "BC resident", fieldType: FIELD_TYPES.BOOLEAN, icon: "MapPin" },
      { name: "consentOnFile", label: "Consent on file", fieldType: FIELD_TYPES.BOOLEAN, icon: "FileCheck" },
      { name: "termStart", label: "Term start", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "termEnd", label: "Term end", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "resignedAt", label: "Resigned", fieldType: FIELD_TYPES.DATE, icon: "LogOut" },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        config: {
          options: [
            { value: "Active", label: "Active", color: "green" },
            { value: "Resigned", label: "Resigned", color: "amber" },
            { value: "Inactive", label: "Inactive", color: "gray" },
          ],
        },
      },
      { name: "aliases", label: "Aliases", fieldType: FIELD_TYPES.ARRAY, icon: "Tag" },
      { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All directors",
      columns: [
        { fieldName: "firstName", size: 150 },
        { fieldName: "lastName", size: 150 },
        { fieldName: "position", size: 160 },
        { fieldName: "status", size: 120 },
        { fieldName: "termStart", size: 140 },
        { fieldName: "termEnd", size: 140 },
        { fieldName: "isBCResident", size: 110 },
        { fieldName: "consentOnFile", size: 120 },
      ],
    },
  },
  {
    nameSingular: "filing",
    namePlural: "filings",
    labelSingular: "Filing",
    labelPlural: "Filings",
    icon: "FileText",
    iconColor: "amber",
    routePath: "/app/filings",
    labelIdentifierFieldName: "kind",
    fields: [
      {
        name: "kind",
        label: "Kind",
        fieldType: FIELD_TYPES.SELECT,
        icon: "FileText",
        isSystem: true,
        config: {
          options: [
            { value: "Annual Report", label: "Annual Report", color: "blue" },
            { value: "Statement of Directors", label: "Statement of Directors", color: "purple" },
            { value: "Charity Return", label: "Charity Return", color: "green" },
            { value: "Financial Statement", label: "Financial Statement", color: "teal" },
            { value: "Other", label: "Other", color: "gray" },
          ],
        },
      },
      { name: "periodLabel", label: "Period", fieldType: FIELD_TYPES.TEXT, icon: "Calendar" },
      { name: "dueDate", label: "Due", fieldType: FIELD_TYPES.DATE, icon: "CalendarClock" },
      { name: "filedAt", label: "Filed", fieldType: FIELD_TYPES.DATE, icon: "Check" },
      { name: "submissionMethod", label: "Method", fieldType: FIELD_TYPES.TEXT, icon: "Send" },
      { name: "confirmationNumber", label: "Confirmation #", fieldType: FIELD_TYPES.TEXT, icon: "Hash" },
      {
        name: "feePaidCents",
        label: "Fee",
        fieldType: FIELD_TYPES.CURRENCY,
        icon: "DollarSign",
        config: { currencyCode: "CAD", isCents: true },
      },
      { name: "registryUrl", label: "Registry link", fieldType: FIELD_TYPES.LINK, icon: "ExternalLink" },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        config: {
          options: [
            { value: "Upcoming", label: "Upcoming", color: "gray" },
            { value: "Due", label: "Due", color: "amber" },
            { value: "Overdue", label: "Overdue", color: "red" },
            { value: "Filed", label: "Filed", color: "green" },
            { value: "Attested", label: "Attested", color: "blue" },
          ],
        },
      },
      { name: "evidenceNotes", label: "Evidence notes", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
      { name: "attestedAtISO", label: "Attested", fieldType: FIELD_TYPES.DATE_TIME, icon: "ShieldCheck" },
    ],
    defaultView: {
      name: "All filings",
      columns: [
        { fieldName: "kind", size: 200 },
        { fieldName: "periodLabel", size: 120 },
        { fieldName: "status", size: 130 },
        { fieldName: "dueDate", size: 140 },
        { fieldName: "filedAt", size: 140 },
        { fieldName: "feePaidCents", size: 120 },
        { fieldName: "confirmationNumber", size: 160 },
      ],
    },
  },
];

/* ----------------------------- Seed operations ---------------------------- */

async function seedSociety(ctx: any, societyId: any) {
  const now = new Date().toISOString();
  for (const obj of OBJECTS) {
    // Find or create the object metadata row.
    let objectRow = await ctx.db
      .query("objectMetadata")
      .withIndex("by_society_name", (q) =>
        q.eq("societyId", societyId).eq("nameSingular", obj.nameSingular),
      )
      .unique();

    if (!objectRow) {
      const objectId = await ctx.db.insert("objectMetadata", {
        societyId,
        nameSingular: obj.nameSingular,
        namePlural: obj.namePlural,
        labelSingular: obj.labelSingular,
        labelPlural: obj.labelPlural,
        icon: obj.icon,
        iconColor: obj.iconColor,
        labelIdentifierFieldName: obj.labelIdentifierFieldName,
        isSystem: true,
        isActive: true,
        routePath: obj.routePath,
        createdAtISO: now,
        updatedAtISO: now,
      });
      objectRow = await ctx.db.get(objectId);
    }

    // Seed fields, skipping any name already present.
    const existingFields = await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
      .collect();
    const existingByName = new Map(existingFields.map((f) => [f.name, f]));

    for (let i = 0; i < obj.fields.length; i++) {
      const field = obj.fields[i];
      if (existingByName.has(field.name)) continue;
      await ctx.db.insert("fieldMetadata", {
        societyId,
        objectMetadataId: objectRow._id,
        name: field.name,
        label: field.label,
        description: field.description,
        icon: field.icon,
        fieldType: field.fieldType,
        configJson: field.config ? JSON.stringify(field.config) : undefined,
        isSystem: field.isSystem ?? false,
        isHidden: field.isHidden ?? false,
        isNullable: true,
        position: i,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }

    // Seed the default view (and its columns) if missing.
    const existingViews = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
      .collect();
    const hasSystemView = existingViews.some((v) => v.isSystem);
    if (!hasSystemView) {
      const viewId = await ctx.db.insert("views", {
        societyId,
        objectMetadataId: objectRow._id,
        name: obj.defaultView.name,
        type: "table",
        density: "compact",
        isShared: true,
        isSystem: true,
        position: 0,
        createdAtISO: now,
        updatedAtISO: now,
      });
      // Look up fields again, now that they exist.
      const allFields = await ctx.db
        .query("fieldMetadata")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
        .collect();
      const byName = new Map(allFields.map((f) => [f.name, f]));
      for (let i = 0; i < obj.defaultView.columns.length; i++) {
        const col = obj.defaultView.columns[i];
        const field = byName.get(col.fieldName);
        if (!field) continue;
        await ctx.db.insert("viewFields", {
          societyId,
          viewId,
          fieldMetadataId: field._id,
          isVisible: true,
          position: col.position ?? i,
          size: col.size ?? 160,
          createdAtISO: now,
          updatedAtISO: now,
        });
      }
    }
  }
}

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const societies = await ctx.db.query("societies").collect();
    for (const society of societies) {
      await seedSociety(ctx, society._id);
    }
    return { seededSocieties: societies.length, objects: OBJECTS.length };
  },
});

export const runForSociety = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await seedSociety(ctx, societyId);
    return { ok: true, objects: OBJECTS.length };
  },
});

/**
 * Nukes metadata rows for testing. Leaves underlying record tables alone.
 */
export const wipe = mutation({
  args: {},
  handler: async (ctx) => {
    for (const name of ["viewFields", "views", "fieldMetadata", "objectMetadata"] as const) {
      const rows = await ctx.db.query(name).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    return { ok: true };
  },
});
