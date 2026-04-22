/**
 * Shared record-table metadata definitions.
 *
 * This is the source of truth for both the Convex metadata seeder and the
 * static demo runtime. Keep it free of Convex/server imports so the browser
 * demo can bundle it safely.
 */

// Field types the registry understands — keep in sync with
// src/modules/object-record/types/FieldType.ts
export const FIELD_TYPES = {
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

export type SeedField = {
  name: string;
  label: string;
  fieldType: string;
  icon?: string;
  description?: string;
  config?: Record<string, unknown>;
  isSystem?: boolean;
  isHidden?: boolean;
  isReadOnly?: boolean;
};

export type SeedObject = {
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

export const RECORD_TABLE_OBJECTS: SeedObject[] = [
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
      // ARRAY has no inline editor yet — keep it read-only rather than rendering a broken TEXT input.
      { name: "aliases", label: "Aliases", fieldType: FIELD_TYPES.ARRAY, icon: "Tag", isReadOnly: true },
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
      {
        name: "position",
        label: "Position",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Briefcase",
        config: {
          options: [
            { value: "President", label: "President", color: "blue" },
            { value: "Vice President", label: "Vice President", color: "teal" },
            { value: "Secretary", label: "Secretary", color: "purple" },
            { value: "Treasurer", label: "Treasurer", color: "green" },
            { value: "Director", label: "Director", color: "gray" },
          ],
        },
      },
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
      { name: "aliases", label: "Aliases", fieldType: FIELD_TYPES.ARRAY, icon: "Tag", isReadOnly: true },
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
            { value: "RegistryRecord", label: "Registry record", color: "gray" },
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
      {
        name: "submissionMethod",
        label: "Method",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Send",
        config: {
          options: [
            { value: "Online", label: "Online", color: "blue" },
            { value: "Mail", label: "Mail", color: "amber" },
            { value: "In person", label: "In person", color: "purple" },
            { value: "Email", label: "Email", color: "teal" },
          ],
        },
      },
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
      // Written by the attestation workflow — shouldn't be manually edited.
      { name: "attestedAtISO", label: "Attested", fieldType: FIELD_TYPES.DATE_TIME, icon: "ShieldCheck", isReadOnly: true },
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

  /* -------------------------- Log-ish objects -------------------------- */
  // These back pages like AuditLog / WorkflowRuns / Outbox. All columns
  // are read-only (the underlying rows are machine-written); the pages
  // continue to own their own Convex queries and mutations — we only
  // declare metadata here so the RecordTable UI (search/filter/sort/
  // column visibility/saved views) works uniformly.
  {
    nameSingular: "auditLogEntry",
    namePlural: "auditLogEntries",
    labelSingular: "Audit log entry",
    labelPlural: "Audit log",
    icon: "Shield",
    iconColor: "red",
    routePath: "/app/audit-log",
    labelIdentifierFieldName: "summary",
    fields: [
      { name: "createdAtISO", label: "When", fieldType: FIELD_TYPES.DATE_TIME, icon: "Clock", isReadOnly: true, isSystem: true },
      { name: "actor", label: "Actor", fieldType: FIELD_TYPES.TEXT, icon: "User", isReadOnly: true },
      { name: "entityType", label: "Entity", fieldType: FIELD_TYPES.TEXT, icon: "Tag", isReadOnly: true },
      { name: "entityId", label: "Entity ID", fieldType: FIELD_TYPES.UUID, icon: "Hash", isReadOnly: true },
      { name: "action", label: "Action", fieldType: FIELD_TYPES.TEXT, icon: "Activity", isReadOnly: true },
      { name: "summary", label: "Summary", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isReadOnly: true, isSystem: true },
    ],
    defaultView: {
      name: "All activity",
      columns: [
        { fieldName: "createdAtISO", size: 180 },
        { fieldName: "actor", size: 180 },
        { fieldName: "entityType", size: 140 },
        { fieldName: "action", size: 160 },
        { fieldName: "summary", size: 320 },
      ],
    },
  },
  {
    nameSingular: "workflowRun",
    namePlural: "workflowRuns",
    labelSingular: "Workflow run",
    labelPlural: "Workflow runs",
    icon: "History",
    iconColor: "gray",
    routePath: "/app/workflow-runs",
    labelIdentifierFieldName: "workflowName",
    fields: [
      // `workflowName` / `recipeLabel` are projected in by the page from
      // the `workflows` + `catalog` queries before records hit the table.
      { name: "workflowName", label: "Workflow", fieldType: FIELD_TYPES.TEXT, icon: "Workflow", isReadOnly: true, isSystem: true },
      { name: "recipeLabel", label: "Recipe", fieldType: FIELD_TYPES.TEXT, icon: "Tag", isReadOnly: true },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "success", label: "success", color: "green" },
            { value: "running", label: "running", color: "amber" },
            { value: "failed", label: "failed", color: "red" },
          ],
        },
      },
      { name: "triggeredBy", label: "Triggered", fieldType: FIELD_TYPES.TEXT, icon: "Zap", isReadOnly: true },
      { name: "startedAtISO", label: "Started", fieldType: FIELD_TYPES.DATE_TIME, icon: "Clock", isReadOnly: true },
      { name: "completedAtISO", label: "Completed", fieldType: FIELD_TYPES.DATE_TIME, icon: "CheckCircle", isReadOnly: true },
    ],
    defaultView: {
      name: "Recent runs",
      columns: [
        { fieldName: "workflowName", size: 220 },
        { fieldName: "recipeLabel", size: 180 },
        { fieldName: "status", size: 120 },
        { fieldName: "triggeredBy", size: 140 },
        { fieldName: "startedAtISO", size: 180 },
        { fieldName: "completedAtISO", size: 180 },
      ],
    },
  },
  {
    nameSingular: "outboxMessage",
    namePlural: "outboxMessages",
    labelSingular: "Outbox message",
    labelPlural: "Outbox",
    icon: "Inbox",
    iconColor: "orange",
    routePath: "/app/outbox",
    labelIdentifierFieldName: "subject",
    fields: [
      { name: "subject", label: "Subject", fieldType: FIELD_TYPES.TEXT, icon: "Mail", isReadOnly: true, isSystem: true },
      { name: "to", label: "To", fieldType: FIELD_TYPES.EMAIL, icon: "User", isReadOnly: true },
      { name: "cc", label: "CC", fieldType: FIELD_TYPES.EMAIL, icon: "Users", isReadOnly: true, isHidden: true },
      { name: "bcc", label: "BCC", fieldType: FIELD_TYPES.EMAIL, icon: "Users", isReadOnly: true, isHidden: true },
      {
        // State-machine status — mutated via markSent/cancel rather than inline edit.
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "draft", label: "draft", color: "gray" },
            { value: "ready", label: "ready", color: "amber" },
            { value: "sent", label: "sent", color: "green" },
            { value: "cancelled", label: "cancelled", color: "red" },
          ],
        },
      },
      { name: "attachmentCount", label: "Attachments", fieldType: FIELD_TYPES.NUMBER, icon: "Paperclip", isReadOnly: true },
      { name: "createdAtISO", label: "Created", fieldType: FIELD_TYPES.DATE_TIME, icon: "Clock", isReadOnly: true },
      { name: "sentAtISO", label: "Sent", fieldType: FIELD_TYPES.DATE_TIME, icon: "Check", isReadOnly: true },
      { name: "sentChannel", label: "Channel", fieldType: FIELD_TYPES.TEXT, icon: "Send", isReadOnly: true },
    ],
    defaultView: {
      name: "All pending emails",
      columns: [
        { fieldName: "subject", size: 280 },
        { fieldName: "to", size: 220 },
        { fieldName: "status", size: 110 },
        { fieldName: "createdAtISO", size: 180 },
        { fieldName: "sentAtISO", size: 180 },
      ],
    },
  },

  /* ------------------------- Config / governance ------------------------- */
  // These are small reference tables (auditors, court orders, training
  // records, etc). The rows are maintained by hand through the record
  // table inline edit + the page's existing "New …" drawer.
  {
    nameSingular: "auditorAppointment",
    namePlural: "auditorAppointments",
    labelSingular: "Auditor appointment",
    labelPlural: "Auditor appointments",
    icon: "Calculator",
    iconColor: "green",
    routePath: "/app/auditors",
    labelIdentifierFieldName: "firmName",
    fields: [
      { name: "firmName", label: "Firm", fieldType: FIELD_TYPES.TEXT, icon: "Building", isSystem: true },
      {
        name: "engagementType",
        label: "Engagement",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Briefcase",
        config: {
          options: [
            { value: "Audit", label: "Audit", color: "green" },
            { value: "ReviewEngagement", label: "Review engagement", color: "blue" },
            { value: "CompilationEngagement", label: "Compilation engagement", color: "teal" },
          ],
        },
      },
      { name: "fiscalYear", label: "Fiscal year", fieldType: FIELD_TYPES.TEXT, icon: "Calendar" },
      {
        name: "appointedBy",
        label: "Appointed by",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Users",
        config: {
          options: [
            { value: "Directors", label: "Directors", color: "purple" },
            { value: "Members", label: "Members", color: "blue" },
          ],
        },
      },
      { name: "appointedAtISO", label: "Appointed on", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "independenceAttested", label: "Independent", fieldType: FIELD_TYPES.BOOLEAN, icon: "ShieldCheck" },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        config: {
          options: [
            { value: "Active", label: "Active", color: "green" },
            { value: "Completed", label: "Completed", color: "gray" },
            { value: "Resigned", label: "Resigned", color: "amber" },
            { value: "Replaced", label: "Replaced", color: "gray" },
          ],
        },
      },
      { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All appointments",
      columns: [
        { fieldName: "firmName", size: 220 },
        { fieldName: "engagementType", size: 170 },
        { fieldName: "fiscalYear", size: 110 },
        { fieldName: "appointedBy", size: 140 },
        { fieldName: "appointedAtISO", size: 140 },
        { fieldName: "independenceAttested", size: 120 },
        { fieldName: "status", size: 130 },
      ],
    },
  },
  {
    nameSingular: "courtOrder",
    namePlural: "courtOrders",
    labelSingular: "Court order",
    labelPlural: "Court orders",
    icon: "Gavel",
    iconColor: "red",
    routePath: "/app/court-orders",
    labelIdentifierFieldName: "title",
    fields: [
      { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, icon: "Gavel", isSystem: true },
      { name: "court", label: "Court", fieldType: FIELD_TYPES.TEXT, icon: "Building" },
      { name: "fileNumber", label: "File #", fieldType: FIELD_TYPES.TEXT, icon: "Hash" },
      { name: "orderDate", label: "Date", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        config: {
          options: [
            { value: "Active", label: "Active", color: "amber" },
            { value: "Satisfied", label: "Satisfied", color: "green" },
            { value: "Vacated", label: "Vacated", color: "gray" },
          ],
        },
      },
      { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All court orders",
      columns: [
        { fieldName: "title", size: 260 },
        { fieldName: "court", size: 220 },
        { fieldName: "fileNumber", size: 120 },
        { fieldName: "orderDate", size: 120 },
        { fieldName: "status", size: 120 },
      ],
    },
  },
  {
    nameSingular: "pipaTraining",
    namePlural: "pipaTrainings",
    labelSingular: "PIPA training record",
    labelPlural: "PIPA training",
    icon: "ShieldCheck",
    iconColor: "green",
    routePath: "/app/pipa-training",
    labelIdentifierFieldName: "participantName",
    fields: [
      { name: "participantName", label: "Participant", fieldType: FIELD_TYPES.TEXT, icon: "User", isSystem: true },
      { name: "participantEmail", label: "Email", fieldType: FIELD_TYPES.EMAIL, icon: "Mail" },
      {
        name: "role",
        label: "Role",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Tag",
        config: {
          options: [
            { value: "Director", label: "Director", color: "purple" },
            { value: "Staff", label: "Staff", color: "blue" },
            { value: "Volunteer", label: "Volunteer", color: "teal" },
          ],
        },
      },
      {
        name: "topic",
        label: "Topic",
        fieldType: FIELD_TYPES.SELECT,
        icon: "BookOpen",
        config: {
          options: [
            { value: "PIPA", label: "PIPA", color: "blue" },
            { value: "CASL", label: "CASL", color: "amber" },
            { value: "Privacy-refresh", label: "Privacy refresh", color: "teal" },
          ],
        },
      },
      { name: "completedAtISO", label: "Completed", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "nextDueAtISO", label: "Next due", fieldType: FIELD_TYPES.DATE, icon: "CalendarClock" },
      { name: "trainer", label: "Trainer", fieldType: FIELD_TYPES.TEXT, icon: "User" },
      { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All training records",
      columns: [
        { fieldName: "participantName", size: 200 },
        { fieldName: "role", size: 120 },
        { fieldName: "topic", size: 140 },
        { fieldName: "completedAtISO", size: 140 },
        { fieldName: "nextDueAtISO", size: 160 },
        { fieldName: "trainer", size: 160 },
      ],
    },
  },
  {
    // Proxies — each row shows "grantor → holder" for a meeting. The
    // meetingId lookup happens in the page (it joins against a meetings
    // query); the field stays as plain TEXT so the record table can
    // display it via `renderCell`.
    nameSingular: "proxy",
    namePlural: "proxies",
    labelSingular: "Proxy",
    labelPlural: "Proxies",
    icon: "UserCheck",
    iconColor: "blue",
    routePath: "/app/proxies",
    labelIdentifierFieldName: "grantorName",
    fields: [
      { name: "meetingTitle", label: "Meeting", fieldType: FIELD_TYPES.TEXT, icon: "Calendar", isReadOnly: true },
      { name: "grantorName", label: "Grantor", fieldType: FIELD_TYPES.TEXT, icon: "User", isSystem: true },
      { name: "proxyHolderName", label: "Proxy holder", fieldType: FIELD_TYPES.TEXT, icon: "UserCheck" },
      { name: "signedAtISO", label: "Signed", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "revokedAtISO", label: "Revoked", fieldType: FIELD_TYPES.DATE, icon: "LogOut", isReadOnly: true },
      {
        // Derived from `revokedAtISO` — projected in by the page.
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "Active", label: "Active", color: "green" },
            { value: "Revoked", label: "Revoked", color: "red" },
          ],
        },
      },
      { name: "instructions", label: "Instructions", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All proxies",
      columns: [
        { fieldName: "meetingTitle", size: 220 },
        { fieldName: "grantorName", size: 180 },
        { fieldName: "proxyHolderName", size: 180 },
        { fieldName: "signedAtISO", size: 130 },
        { fieldName: "status", size: 110 },
        { fieldName: "instructions", size: 300 },
      ],
    },
  },
  {
    // Director attestations — one row per Active director, joined with
    // their current-year attestation. The page projects `name`,
    // `position`, `signed`, `allTrue` and `signedAtISO` onto each row
    // before handing them to the table. The underlying Convex table is
    // `directorAttestations` but the rows are truly virtual.
    nameSingular: "directorAttestation",
    namePlural: "directorAttestations",
    labelSingular: "Director attestation",
    labelPlural: "Attestations",
    icon: "ShieldCheck",
    iconColor: "red",
    routePath: "/app/attestations",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Director", fieldType: FIELD_TYPES.TEXT, icon: "User", isReadOnly: true, isSystem: true },
      {
        name: "position",
        label: "Position",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Briefcase",
        isReadOnly: true,
        config: {
          options: [
            { value: "President", label: "President", color: "blue" },
            { value: "Vice President", label: "Vice President", color: "teal" },
            { value: "Secretary", label: "Secretary", color: "purple" },
            { value: "Treasurer", label: "Treasurer", color: "green" },
            { value: "Director", label: "Director", color: "gray" },
          ],
        },
      },
      { name: "signed", label: "Signed", fieldType: FIELD_TYPES.BOOLEAN, icon: "PenLine", isReadOnly: true },
      { name: "allTrue", label: "All clauses true", fieldType: FIELD_TYPES.BOOLEAN, icon: "Check", isReadOnly: true },
      { name: "signedAtISO", label: "Signed on", fieldType: FIELD_TYPES.DATE_TIME, icon: "Calendar", isReadOnly: true },
    ],
    defaultView: {
      name: "Current year",
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "position", size: 150 },
        { fieldName: "signed", size: 110 },
        { fieldName: "allTrue", size: 150 },
        { fieldName: "signedAtISO", size: 180 },
      ],
    },
  },
  {
    nameSingular: "customFieldDefinition",
    namePlural: "customFieldDefinitions",
    labelSingular: "Custom field",
    labelPlural: "Custom fields",
    icon: "Sliders",
    iconColor: "purple",
    routePath: "/app/custom-fields",
    labelIdentifierFieldName: "label",
    fields: [
      {
        name: "entityType",
        label: "Category",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Tag",
        // entityType is immutable after create — the page disables the
        // input when editing. The record table's inline edit only runs
        // on fields that aren't `isReadOnly`; leaving it editable here
        // is the normal case for new-record creation.
        config: {
          options: [
            { value: "members", label: "Members", color: "blue" },
            { value: "directors", label: "Directors", color: "violet" },
            { value: "volunteers", label: "Volunteers", color: "teal" },
            { value: "employees", label: "Employees", color: "green" },
          ],
        },
      },
      { name: "label", label: "Label", fieldType: FIELD_TYPES.TEXT, icon: "Type", isSystem: true },
      // `key` is the machine-readable id — locked after create. The page
      // blocks editing via the disabled attribute; flagging the column
      // read-only keeps the record table consistent.
      { name: "key", label: "Key", fieldType: FIELD_TYPES.TEXT, icon: "Hash", isReadOnly: true },
      {
        name: "kind",
        label: "Kind",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Tag",
        config: {
          options: [
            { value: "text", label: "Text", color: "gray" },
            { value: "number", label: "Number", color: "blue" },
            { value: "date", label: "Date", color: "teal" },
            { value: "boolean", label: "Checkbox", color: "green" },
            { value: "email", label: "Email", color: "purple" },
            { value: "phone", label: "Phone", color: "amber" },
          ],
        },
      },
      { name: "required", label: "Required", fieldType: FIELD_TYPES.BOOLEAN, icon: "Asterisk" },
      { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
    ],
    defaultView: {
      name: "All definitions",
      columns: [
        { fieldName: "entityType", size: 130 },
        { fieldName: "label", size: 220 },
        { fieldName: "key", size: 220 },
        { fieldName: "kind", size: 130 },
        { fieldName: "required", size: 110 },
      ],
    },
  },
  {
    // Transparency publications — the `publications` table backs the
    // Transparency page. Listing here lets the page re-use the record
    // table for search/filter/sort while the page keeps ownership of
    // the publish-flow drawer.
    nameSingular: "publication",
    namePlural: "publications",
    labelSingular: "Publication",
    labelPlural: "Publications",
    icon: "Globe",
    iconColor: "blue",
    routePath: "/app/transparency",
    labelIdentifierFieldName: "title",
    fields: [
      { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isSystem: true },
      {
        name: "category",
        label: "Category",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Tag",
        config: {
          options: [
            { value: "AnnualReport", label: "Annual report", color: "blue" },
            { value: "Bylaws", label: "Bylaws", color: "purple" },
            { value: "AGM", label: "AGM", color: "amber" },
            { value: "Policy", label: "Policy", color: "teal" },
            { value: "Notice", label: "Notice", color: "red" },
            { value: "Resource", label: "Resource", color: "green" },
            { value: "Custom", label: "Custom", color: "gray" },
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
            { value: "Draft", label: "Draft", color: "gray" },
            { value: "Published", label: "Published", color: "green" },
            { value: "Archived", label: "Archived", color: "red" },
          ],
        },
      },
      { name: "publishedAtISO", label: "Published", fieldType: FIELD_TYPES.DATE, icon: "Calendar" },
      { name: "summary", label: "Summary", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
      { name: "url", label: "External URL", fieldType: FIELD_TYPES.LINK, icon: "ExternalLink" },
    ],
    defaultView: {
      name: "All publications",
      columns: [
        { fieldName: "title", size: 260 },
        { fieldName: "category", size: 150 },
        { fieldName: "status", size: 130 },
        { fieldName: "publishedAtISO", size: 140 },
        { fieldName: "summary", size: 300 },
      ],
    },
  },
  {
    // Workflows. `recipeLabel` and `triggerLabel` are projected by the
    // page from the recipe catalog + the workflow's trigger config.
    nameSingular: "workflow",
    namePlural: "workflows",
    labelSingular: "Workflow",
    labelPlural: "Workflows",
    icon: "Workflow",
    iconColor: "orange",
    routePath: "/app/workflows",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Name", fieldType: FIELD_TYPES.TEXT, icon: "Workflow", isSystem: true },
      { name: "recipeLabel", label: "Recipe", fieldType: FIELD_TYPES.TEXT, icon: "Tag", isReadOnly: true },
      { name: "triggerLabel", label: "Trigger", fieldType: FIELD_TYPES.TEXT, icon: "Clock", isReadOnly: true },
      {
        name: "provider",
        label: "Provider",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Server",
        config: {
          options: [
            { value: "internal", label: "internal", color: "gray" },
            { value: "n8n", label: "n8n", color: "blue" },
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
            { value: "active", label: "active", color: "green" },
            { value: "paused", label: "paused", color: "amber" },
          ],
        },
      },
      { name: "lastRunAtISO", label: "Last run", fieldType: FIELD_TYPES.DATE_TIME, icon: "Clock", isReadOnly: true },
      { name: "nextRunAtISO", label: "Next run", fieldType: FIELD_TYPES.DATE_TIME, icon: "CalendarClock", isReadOnly: true },
    ],
    defaultView: {
      name: "All workflows",
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "recipeLabel", size: 200 },
        { fieldName: "triggerLabel", size: 180 },
        { fieldName: "provider", size: 120 },
        { fieldName: "status", size: 110 },
        { fieldName: "lastRunAtISO", size: 180 },
        { fieldName: "nextRunAtISO", size: 180 },
      ],
    },
  },
  {
    // API clients. Paired with apiTokens below — both are rendered on
    // the single ApiKeys page with two stacked record tables.
    nameSingular: "apiClient",
    namePlural: "apiClients",
    labelSingular: "API client",
    labelPlural: "API clients",
    icon: "KeyRound",
    iconColor: "gray",
    routePath: "/app/api-keys",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Name", fieldType: FIELD_TYPES.TEXT, icon: "KeyRound", isSystem: true },
      { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
      {
        name: "kind",
        label: "Kind",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Tag",
        config: {
          options: [
            { value: "user", label: "user", color: "blue" },
            { value: "service", label: "service", color: "purple" },
            { value: "integration", label: "integration", color: "teal" },
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
            { value: "active", label: "active", color: "green" },
            { value: "disabled", label: "disabled", color: "amber" },
            { value: "revoked", label: "revoked", color: "red" },
          ],
        },
      },
      { name: "createdAtISO", label: "Created", fieldType: FIELD_TYPES.DATE_TIME, icon: "Clock", isReadOnly: true },
    ],
    defaultView: {
      name: "All clients",
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "kind", size: 130 },
        { fieldName: "status", size: 130 },
        { fieldName: "createdAtISO", size: 180 },
      ],
    },
  },
  {
    // API tokens. `clientName` is projected by the page from the
    // `apiClients` query (the page already has both in memory).
    nameSingular: "apiToken",
    namePlural: "apiTokens",
    labelSingular: "API token",
    labelPlural: "API tokens",
    icon: "KeyRound",
    iconColor: "gray",
    routePath: "/app/api-keys",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Name", fieldType: FIELD_TYPES.TEXT, icon: "KeyRound", isSystem: true },
      { name: "clientName", label: "Client", fieldType: FIELD_TYPES.TEXT, icon: "User", isReadOnly: true },
      { name: "tokenStart", label: "Token", fieldType: FIELD_TYPES.TEXT, icon: "Hash", isReadOnly: true },
      { name: "scopes", label: "Scopes", fieldType: FIELD_TYPES.ARRAY, icon: "ListChecks", isReadOnly: true },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "active", label: "active", color: "green" },
            { value: "revoked", label: "revoked", color: "red" },
            { value: "expired", label: "expired", color: "gray" },
          ],
        },
      },
      { name: "createdAtISO", label: "Created", fieldType: FIELD_TYPES.DATE_TIME, icon: "Clock", isReadOnly: true },
    ],
    defaultView: {
      name: "All tokens",
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "clientName", size: 180 },
        { fieldName: "tokenStart", size: 140 },
        { fieldName: "scopes", size: 220 },
        { fieldName: "status", size: 120 },
        { fieldName: "createdAtISO", size: 180 },
      ],
    },
  },
  {
    // Access custody / secret vault. The raw vault entries have many
    // more fields; this view exposes the ones Ops looks at daily —
    // detail and reveal flow still live in the Secrets page drawer.
    nameSingular: "secretVaultItem",
    namePlural: "secretVaultItems",
    labelSingular: "Access record",
    labelPlural: "Access records",
    icon: "LockKeyhole",
    iconColor: "red",
    routePath: "/app/secrets",
    labelIdentifierFieldName: "name",
    fields: [
      { name: "name", label: "Record", fieldType: FIELD_TYPES.TEXT, icon: "LockKeyhole", isSystem: true },
      { name: "service", label: "Service", fieldType: FIELD_TYPES.TEXT, icon: "Server" },
      {
        name: "credentialType",
        label: "Credential",
        fieldType: FIELD_TYPES.SELECT,
        icon: "KeyRound",
        config: {
          options: [
            { value: "recovery_key", label: "Recovery key", color: "amber" },
            { value: "registry_key", label: "Registry key", color: "blue" },
            { value: "api_key", label: "API key", color: "teal" },
            { value: "password", label: "Password", color: "purple" },
            { value: "certificate", label: "Certificate", color: "green" },
            { value: "other", label: "Other", color: "gray" },
          ],
        },
      },
      { name: "custodianPersonName", label: "Custodian", fieldType: FIELD_TYPES.TEXT, icon: "User" },
      {
        name: "storageMode",
        label: "Storage",
        fieldType: FIELD_TYPES.SELECT,
        icon: "ShieldAlert",
        config: {
          options: [
            { value: "stored_encrypted", label: "Stored encrypted", color: "green" },
            { value: "external_reference", label: "External vault", color: "gray" },
            { value: "encrypted_elsewhere", label: "Encrypted elsewhere", color: "teal" },
            { value: "not_stored", label: "Not retained", color: "amber" },
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
            { value: "NeedsReview", label: "Needs review", color: "amber" },
            { value: "Active", label: "Active", color: "green" },
            { value: "Rotated", label: "Rotated", color: "gray" },
            { value: "Revoked", label: "Revoked", color: "red" },
          ],
        },
      },
      { name: "rotationDueAtISO", label: "Next review", fieldType: FIELD_TYPES.DATE, icon: "CalendarClock" },
      { name: "lastVerifiedAtISO", label: "Last reviewed", fieldType: FIELD_TYPES.DATE, icon: "Calendar", isReadOnly: true },
    ],
    defaultView: {
      name: "All access records",
      columns: [
        { fieldName: "name", size: 220 },
        { fieldName: "credentialType", size: 140 },
        { fieldName: "custodianPersonName", size: 180 },
        { fieldName: "storageMode", size: 170 },
        { fieldName: "status", size: 140 },
        { fieldName: "rotationDueAtISO", size: 150 },
      ],
    },
  },
  {
    // Retention review rows. These are *derived* from `documents` —
    // the page projects each into `{ title, category, retentionYears,
    // daysOverdue, flagged, createdAtISO }`. No direct table writes
    // from the record grid; all actions (flag / archive) stay on the
    // page's row-action buttons.
    nameSingular: "retentionRow",
    namePlural: "retentionRows",
    labelSingular: "Retention row",
    labelPlural: "Retention review",
    icon: "Archive",
    iconColor: "gray",
    routePath: "/app/retention",
    labelIdentifierFieldName: "title",
    fields: [
      { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isReadOnly: true, isSystem: true },
      { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, icon: "Tag", isReadOnly: true },
      { name: "createdAtISO", label: "Created", fieldType: FIELD_TYPES.DATE, icon: "Calendar", isReadOnly: true },
      { name: "retentionYears", label: "Retention (yrs)", fieldType: FIELD_TYPES.NUMBER, icon: "Clock", isReadOnly: true },
      { name: "daysOverdue", label: "Overdue (days)", fieldType: FIELD_TYPES.NUMBER, icon: "AlertTriangle", isReadOnly: true },
      { name: "flagged", label: "Flagged", fieldType: FIELD_TYPES.BOOLEAN, icon: "Flag", isReadOnly: true },
    ],
    defaultView: {
      name: "Expired records",
      columns: [
        { fieldName: "title", size: 260 },
        { fieldName: "category", size: 150 },
        { fieldName: "createdAtISO", size: 130 },
        { fieldName: "retentionYears", size: 130 },
        { fieldName: "daysOverdue", size: 140 },
        { fieldName: "flagged", size: 110 },
      ],
    },
  },
  {
    // Reconciliation rows — derived from `financialTransactions` joined
    // with auto-match candidates. Keep the table purely informative; the
    // side-panel in the Reconciliation page drives the match/unmatch
    // mutations via the original buttons, not through inline edit.
    nameSingular: "reconciliationTransaction",
    namePlural: "reconciliationTransactions",
    labelSingular: "Reconciliation row",
    labelPlural: "Reconciliation",
    icon: "Scale",
    iconColor: "green",
    routePath: "/app/reconciliation",
    labelIdentifierFieldName: "description",
    fields: [
      { name: "date", label: "Date", fieldType: FIELD_TYPES.DATE, icon: "Calendar", isReadOnly: true },
      { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isReadOnly: true, isSystem: true },
      { name: "counterparty", label: "Counterparty", fieldType: FIELD_TYPES.TEXT, icon: "User", isReadOnly: true },
      {
        name: "amountCents",
        label: "Amount",
        fieldType: FIELD_TYPES.CURRENCY,
        icon: "DollarSign",
        isReadOnly: true,
        config: { currencyCode: "CAD", isCents: true },
      },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Activity",
        isReadOnly: true,
        config: {
          options: [
            { value: "Reconciled", label: "Reconciled", color: "green" },
            { value: "Has suggestion", label: "Has suggestion", color: "amber" },
            { value: "Unmatched", label: "Unmatched", color: "red" },
          ],
        },
      },
    ],
    defaultView: {
      name: "All transactions",
      columns: [
        { fieldName: "date", size: 130 },
        { fieldName: "description", size: 300 },
        { fieldName: "counterparty", size: 200 },
        { fieldName: "amountCents", size: 140 },
        { fieldName: "status", size: 150 },
      ],
    },
  },
  {
    // Wave counterparty transactions (vendor / customer detail page).
    // All columns are read-only — edits to category / account live
    // upstream in Wave. `accountName` is projected client-side from
    // the row's joined `account` / `accountResource` objects so we
    // don't need a RELATION field.
    nameSingular: "counterpartyTransaction",
    namePlural: "counterpartyTransactions",
    labelSingular: "Linked transaction",
    labelPlural: "Linked transactions",
    icon: "Database",
    iconColor: "green",
    routePath: "/app/financials",
    labelIdentifierFieldName: "description",
    fields: [
      { name: "date", label: "Date", fieldType: FIELD_TYPES.DATE, icon: "Calendar", isReadOnly: true },
      { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isReadOnly: true, isSystem: true },
      { name: "externalId", label: "External ID", fieldType: FIELD_TYPES.TEXT, icon: "Hash", isReadOnly: true },
      { name: "accountName", label: "Account", fieldType: FIELD_TYPES.TEXT, icon: "Wallet", isReadOnly: true },
      { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, icon: "Tag", isReadOnly: true },
      {
        name: "amountCents",
        label: "Amount",
        fieldType: FIELD_TYPES.CURRENCY,
        icon: "DollarSign",
        isReadOnly: true,
        config: { currencyCode: "CAD", isCents: true },
      },
    ],
    defaultView: {
      name: "All linked transactions",
      columns: [
        { fieldName: "date", size: 120 },
        { fieldName: "description", size: 280 },
        { fieldName: "accountName", size: 180 },
        { fieldName: "category", size: 160 },
        { fieldName: "amountCents", size: 140 },
      ],
    },
  },
  {
    // Wave account transactions (account detail page). Slightly
    // different shape from `counterpartyTransaction` — here the
    // `counterparty` is shown as a subtext next to the description
    // and `accountName` is static context (the parent account). Kept
    // as its own metadata entry so the default column order matches
    // what Ops looks at on the account page.
    nameSingular: "accountTransaction",
    namePlural: "accountTransactions",
    labelSingular: "Account transaction",
    labelPlural: "Account transactions",
    icon: "Database",
    iconColor: "green",
    routePath: "/app/financials",
    labelIdentifierFieldName: "description",
    fields: [
      { name: "date", label: "Date", fieldType: FIELD_TYPES.DATE, icon: "Calendar", isReadOnly: true },
      { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isReadOnly: true, isSystem: true },
      { name: "counterparty", label: "Counterparty", fieldType: FIELD_TYPES.TEXT, icon: "User", isReadOnly: true },
      { name: "accountName", label: "Account", fieldType: FIELD_TYPES.TEXT, icon: "Wallet", isReadOnly: true },
      { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, icon: "Tag", isReadOnly: true },
      {
        name: "amountCents",
        label: "Amount",
        fieldType: FIELD_TYPES.CURRENCY,
        icon: "DollarSign",
        isReadOnly: true,
        config: { currencyCode: "CAD", isCents: true },
      },
    ],
    defaultView: {
      name: "All account transactions",
      columns: [
        { fieldName: "date", size: 120 },
        { fieldName: "description", size: 280 },
        { fieldName: "accountName", size: 180 },
        { fieldName: "category", size: 160 },
        { fieldName: "amountCents", size: 140 },
      ],
    },
  },
  {
    // Organization history — profile facts. Editable label/value +
    // confidence + status selects. Source-document chips stay as a
    // renderCell escape hatch in the page.
    nameSingular: "profileFact",
    namePlural: "profileFacts",
    labelSingular: "Profile fact",
    labelPlural: "Profile facts",
    icon: "FileText",
    iconColor: "blue",
    routePath: "/app/org-history",
    labelIdentifierFieldName: "label",
    fields: [
      { name: "label", label: "Fact", fieldType: FIELD_TYPES.TEXT, icon: "FileText", isSystem: true },
      { name: "value", label: "Value", fieldType: FIELD_TYPES.TEXT, icon: "StickyNote" },
      {
        name: "confidence",
        label: "Confidence",
        fieldType: FIELD_TYPES.SELECT,
        icon: "Gauge",
        config: {
          options: [
            { value: "High", label: "High", color: "green" },
            { value: "Medium", label: "Medium", color: "blue" },
            { value: "Review", label: "Review", color: "amber" },
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
            { value: "Draft", label: "Draft", color: "gray" },
            { value: "Verified", label: "Verified", color: "green" },
            { value: "NeedsReview", label: "Needs review", color: "amber" },
            { value: "Archived", label: "Archived", color: "red" },
          ],
        },
      },
      { name: "sourceIds", label: "Source documents", fieldType: FIELD_TYPES.ARRAY, icon: "Archive", isReadOnly: true },
    ],
    defaultView: {
      name: "All facts",
      columns: [
        { fieldName: "label", size: 220 },
        { fieldName: "value", size: 300 },
        { fieldName: "confidence", size: 140 },
        { fieldName: "status", size: 140 },
        { fieldName: "sourceIds", size: 260 },
      ],
    },
  },
];
