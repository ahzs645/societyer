export type IntegrationKind =
  | "board_pack"
  | "calendar"
  | "office_documents"
  | "crm_bridge"
  | "browser_connector"
  | "document_archive"
  | "accounting"
  | "grant_portal"
  | "registry"
  | "workflow";

export type IntegrationCapability =
  | "meetings:board_pack"
  | "meetings:calendar_sync"
  | "deadlines:calendar_sync"
  | "calendar:webhook_subscribe"
  | "calendar:incremental_sync"
  | "documents:external_links"
  | "documents:drive_import"
  | "documents:paperless_sync"
  | "documents:ocr_import"
  | "documents:source_staging"
  | "members:crm_import"
  | "members:crm_export"
  | "volunteers:crm_sync"
  | "receipts:crm_export"
  | "communications:consent_sync"
  | "finance:browser_import"
  | "finance:stage_transactions"
  | "grants:browser_import"
  | "grants:stage_snapshot"
  | "registry:browser_export"
  | "registry:stage_filings"
  | "registry:stage_bylaws"
  | "connectors:record_runs"
  | "workflows:run"
  | "webhooks:emit";

export type IntegrationAction = {
  id: string;
  label: string;
  description: string;
  kind: "setup" | "export" | "import" | "sync" | "workflow" | "health_check";
  scope: string;
};

export type IntegrationManifest = {
  slug: string;
  name: string;
  kind: IntegrationKind;
  category: "Governance" | "Calendar" | "Documents" | "CRM" | "Automation";
  summary: string;
  description: string;
  status: "ready" | "planned" | "browser_backed";
  capabilities: IntegrationCapability[];
  requiredSecrets: string[];
  dataMappings: string[];
  auditEvents: string[];
  healthChecks: string[];
  actions: IntegrationAction[];
};

export const INTEGRATION_CATALOG: IntegrationManifest[] = [
  {
    slug: "board-pack-workflow",
    name: "Board-pack workflow",
    kind: "board_pack",
    category: "Governance",
    summary: "Package meeting prep, materials, notices, minutes, actions, and minute-book publication into one tracked workflow.",
    description:
      "Creates a board-pack control record and follow-up tasks around the existing meetings, agendas, documents, minutes, tasks, and minute-book surfaces.",
    status: "ready",
    capabilities: ["meetings:board_pack", "workflows:run", "webhooks:emit"],
    requiredSecrets: [],
    dataMappings: [
      "meetings -> package lifecycle",
      "meetingMaterials/documents -> board-pack parts",
      "minutes.actionItems -> follow-up tasks",
      "minuteBook -> publication evidence",
    ],
    auditEvents: [
      "boardPack.created",
      "boardPack.noticeQueued",
      "boardPack.minutesDrafted",
      "boardPack.published",
    ],
    healthChecks: [
      "Confirm meeting has scheduled date",
      "Confirm agenda and material records are available",
      "Confirm follow-up task creation works",
    ],
    actions: [
      {
        id: "create_board_pack",
        label: "Create board pack",
        description: "Create a workflow package and the standard prep/follow-up task set for a selected meeting.",
        kind: "workflow",
        scope: "workflows:write",
      },
    ],
  },
  {
    slug: "google-calendar",
    name: "Google Calendar",
    kind: "calendar",
    category: "Calendar",
    summary: "Export or sync meetings, AGM dates, filing deadlines, insurance renewals, grant reports, and task due dates.",
    description:
      "Defines the calendar mapping and token scopes needed for a future Google Calendar provider without coupling Societyer to a specific OAuth implementation.",
    status: "planned",
    capabilities: [
      "meetings:calendar_sync",
      "deadlines:calendar_sync",
      "calendar:webhook_subscribe",
      "calendar:incremental_sync",
    ],
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    dataMappings: [
      "meetings.scheduledAt -> calendar event start",
      "meetings.remoteUrl/location -> conference/location",
      "deadlines.dueDate -> all-day deadline event",
      "tasks.dueDate -> optional task reminder",
      "Google syncToken/channelId -> integrationSyncStates",
    ],
    auditEvents: ["calendar.eventCreated", "calendar.eventUpdated", "calendar.eventDeleted"],
    healthChecks: ["OAuth credentials present", "Calendar write test available", "Webhook/channel renewal configured"],
    actions: [
      {
        id: "export_ics",
        label: "Export ICS feed",
        description: "Generate a read-only iCalendar feed before full OAuth sync is enabled.",
        kind: "export",
        scope: "calendar:read",
      },
      {
        id: "sync_events",
        label: "Sync events",
        description: "Push Societyer meeting and deadline changes into Google Calendar.",
        kind: "sync",
        scope: "calendar:write",
      },
      {
        id: "subscribe_calendar_changes",
        label: "Subscribe to changes",
        description: "Register Google Calendar watch channels and store renewal/sync-token state.",
        kind: "setup",
        scope: "calendar:write",
      },
      {
        id: "incremental_sync",
        label: "Run incremental sync",
        description: "Use the stored sync token to pull event additions, updates, and deletes.",
        kind: "sync",
        scope: "calendar:write",
      },
    ],
  },
  {
    slug: "microsoft-365",
    name: "Microsoft 365",
    kind: "office_documents",
    category: "Documents",
    summary: "Connect Outlook calendar, Teams meeting links, OneDrive, and SharePoint document links.",
    description:
      "Provides the manifest for Outlook/Teams meeting coordination and lighter document-link ingestion beside RustFS and Paperless-ngx.",
    status: "planned",
    capabilities: [
      "meetings:calendar_sync",
      "deadlines:calendar_sync",
      "calendar:webhook_subscribe",
      "calendar:incremental_sync",
      "documents:external_links",
      "documents:drive_import",
    ],
    requiredSecrets: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"],
    dataMappings: [
      "meetings -> Outlook events",
      "meetings.remoteUrl -> Teams join link",
      "OneDrive/SharePoint file metadata -> Societyer document external source",
      "document links -> meeting materials",
      "Graph deltaLink/subscriptionId -> integrationSyncStates",
    ],
    auditEvents: ["microsoft.eventSynced", "microsoft.documentLinked", "microsoft.healthChecked"],
    healthChecks: ["OAuth credentials present", "Graph calendar permission granted", "Drive read permission granted"],
    actions: [
      {
        id: "link_document",
        label: "Link cloud document",
        description: "Attach a OneDrive or SharePoint URL as a Societyer document source.",
        kind: "import",
        scope: "documents:write",
      },
      {
        id: "sync_outlook_events",
        label: "Sync Outlook events",
        description: "Push meetings and deadlines into Outlook calendar.",
        kind: "sync",
        scope: "calendar:write",
      },
      {
        id: "subscribe_graph_changes",
        label: "Subscribe to changes",
        description: "Register Microsoft Graph event subscriptions and store renewal/delta state.",
        kind: "setup",
        scope: "calendar:write",
      },
      {
        id: "delta_sync_events",
        label: "Run delta sync",
        description: "Use the stored Graph delta link to pull event additions, updates, and removals.",
        kind: "sync",
        scope: "calendar:write",
      },
    ],
  },
  {
    slug: "civicrm-bridge",
    name: "CiviCRM bridge",
    kind: "crm_bridge",
    category: "CRM",
    summary: "Map Societyer members, donors, volunteers, events, consent, and receipts to a nonprofit CRM.",
    description:
      "Keeps Societyer focused on governance while supporting CiviCRM-style import/export for constituent and fundraising systems.",
    status: "planned",
    capabilities: [
      "members:crm_import",
      "members:crm_export",
      "volunteers:crm_sync",
      "receipts:crm_export",
      "communications:consent_sync",
      "webhooks:emit",
    ],
    requiredSecrets: ["CIVICRM_BASE_URL", "CIVICRM_API_KEY", "CIVICRM_SITE_KEY"],
    dataMappings: [
      "members <-> contacts",
      "volunteers <-> activities/groups",
      "donation receipts -> contributions/receipts",
      "communications consent -> opt-in groups",
      "meeting attendance -> event participation",
    ],
    auditEvents: ["crm.memberExported", "crm.memberImported", "crm.receiptExported", "crm.consentSynced"],
    healthChecks: ["Base URL reachable", "API key accepted", "Contact read/write permission confirmed"],
    actions: [
      {
        id: "export_members",
        label: "Export members",
        description: "Export Societyer members and consent fields to CRM contacts.",
        kind: "export",
        scope: "members:read",
      },
      {
        id: "import_contacts",
        label: "Import contacts",
        description: "Import CRM contacts into Societyer members or volunteers after review.",
        kind: "import",
        scope: "members:write",
      },
      {
        id: "export_receipts",
        label: "Export receipts",
        description: "Send donation receipt summaries to the CRM contribution history.",
        kind: "export",
        scope: "receipts:read",
      },
    ],
  },
  {
    slug: "paperless-ngx",
    name: "Paperless-ngx",
    kind: "document_archive",
    category: "Documents",
    summary: "Sync Societyer documents to Paperless-ngx and stage OCR-discovered records for review.",
    description:
      "Uses the existing Paperless-ngx adapter for upload sync, tag profiles, source pulls, meeting discovery, bylaws history, and reviewed import sessions.",
    status: "ready",
    capabilities: ["documents:paperless_sync", "documents:ocr_import", "documents:source_staging"],
    requiredSecrets: ["PAPERLESS_NGX_URL", "PAPERLESS_NGX_TOKEN"],
    dataMappings: [
      "documents/documentVersions -> Paperless documents",
      "Societyer categories -> Paperless tags/document types",
      "Paperless OCR/source metadata -> import sessions",
      "Paperless document IDs -> sourceExternalIds",
    ],
    auditEvents: ["paperless.documentQueued", "paperless.documentSynced", "paperless.importSessionCreated"],
    healthChecks: ["Paperless URL reachable", "API token accepted", "Tag profile read/write available"],
    actions: [
      {
        id: "sync_document",
        label: "Sync document",
        description: "Upload a Societyer document version to Paperless-ngx with contextual tags.",
        kind: "sync",
        scope: "documents:write",
      },
      {
        id: "stage_ocr_import",
        label: "Stage OCR import",
        description: "Create an import session from Paperless OCR and metadata for review.",
        kind: "import",
        scope: "documents:write",
      },
    ],
  },
  {
    slug: "wave-browser",
    name: "Wave browser connector",
    kind: "accounting",
    category: "Automation",
    summary: "Pull Wave accounting exports through a user-authorized browser session and stage transactions for review.",
    description:
      "Keeps browser-only Wave transaction access auditable by recording connector runs and staging transaction candidates before applying them to finance records.",
    status: "browser_backed",
    capabilities: ["finance:browser_import", "finance:stage_transactions", "connectors:record_runs", "workflows:run"],
    requiredSecrets: ["CONNECTOR_RUNNER_SECRET"],
    dataMappings: [
      "Wave accounts -> financial account candidates",
      "Wave transactions -> transactionCandidates import session",
      "Connector run IDs -> workflowRuns",
    ],
    auditEvents: ["connector.wave.runRecorded", "wave.transactionsStaged", "wave.transactionsImported"],
    healthChecks: ["Connector runner reachable", "Browser provider ready", "Wave profile validated"],
    actions: [
      {
        id: "stage_transactions",
        label: "Stage transactions",
        description: "Pull Wave transactions and create a reviewed import session instead of writing finance records directly.",
        kind: "import",
        scope: "finance:write",
      },
    ],
  },
  {
    slug: "bc-registry-browser",
    name: "BC Registry browser connector",
    kind: "registry",
    category: "Governance",
    summary: "Export authenticated BC Registry filing history and stage filings, governance documents, and bylaws history.",
    description:
      "Uses the browser connector where Societies Online requires a signed-in account, then routes filing exports through import sessions and workflow-run history.",
    status: "browser_backed",
    capabilities: ["registry:browser_export", "registry:stage_filings", "registry:stage_bylaws", "connectors:record_runs", "workflows:run"],
    requiredSecrets: ["CONNECTOR_RUNNER_SECRET"],
    dataMappings: [
      "BC Registry filing rows -> filing import records",
      "Registry PDFs -> source/document candidates",
      "Bylaws sources -> bylawAmendments import session",
      "Connector run IDs -> workflowRuns",
    ],
    auditEvents: ["connector.bcRegistry.runRecorded", "registry.filingsStaged", "registry.bylawsStaged"],
    healthChecks: ["Connector runner reachable", "BC Registry profile available", "Filing export readable"],
    actions: [
      {
        id: "stage_filing_history",
        label: "Stage filing history",
        description: "Create a reviewed import session from BC Registry filing-history rows.",
        kind: "import",
        scope: "filings:write",
      },
      {
        id: "stage_bylaws_history",
        label: "Stage bylaws history",
        description: "Create a reviewed import session from registry bylaws and special-resolution sources.",
        kind: "import",
        scope: "documents:write",
      },
    ],
  },
  {
    slug: "gcos-browser",
    name: "GCOS browser connector",
    kind: "grant_portal",
    category: "Automation",
    summary: "Capture Grants and Contributions Online Services project snapshots and stage grant records for review.",
    description:
      "Turns read-only GCOS browser snapshots into grant import sessions, records connector runs, and keeps sensitive portal data out of direct writes until reviewed.",
    status: "browser_backed",
    capabilities: ["grants:browser_import", "grants:stage_snapshot", "connectors:record_runs", "workflows:run"],
    requiredSecrets: ["CONNECTOR_RUNNER_SECRET"],
    dataMappings: [
      "GCOS project snapshot -> grant import record",
      "Agreement/report dates -> deadline candidates",
      "Connector run IDs -> workflowRuns",
    ],
    auditEvents: ["connector.gcos.runRecorded", "gcos.snapshotStaged", "gcos.grantImported"],
    healthChecks: ["Connector runner reachable", "GCOS profile available", "Project snapshot readable"],
    actions: [
      {
        id: "stage_project_snapshot",
        label: "Stage project snapshot",
        description: "Create a reviewed grant import session from a GCOS project snapshot.",
        kind: "import",
        scope: "grants:write",
      },
    ],
  },
];

export function getIntegrationManifest(slug: string) {
  return INTEGRATION_CATALOG.find((item) => item.slug === slug);
}
