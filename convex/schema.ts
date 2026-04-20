import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  societies: defineTable({
    name: v.string(),
    incorporationNumber: v.optional(v.string()),
    incorporationDate: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.string()),
    jurisdictionCode: v.optional(v.string()),
    isCharity: v.boolean(),
    isMemberFunded: v.boolean(),
    registeredOfficeAddress: v.optional(v.string()),
    mailingAddress: v.optional(v.string()),
    purposes: v.optional(v.string()),
    bylawsDocId: v.optional(v.id("documents")),
    constitutionDocId: v.optional(v.id("documents")),
    privacyPolicyDocId: v.optional(v.id("documents")),
    privacyOfficerName: v.optional(v.string()),
    privacyOfficerEmail: v.optional(v.string()),
    boardCadence: v.optional(v.string()),
    boardCadenceDayOfWeek: v.optional(v.string()),
    boardCadenceTime: v.optional(v.string()),
    boardCadenceNotes: v.optional(v.string()),
    publicSlug: v.optional(v.string()),
    publicSummary: v.optional(v.string()),
    publicContactEmail: v.optional(v.string()),
    publicTransparencyEnabled: v.optional(v.boolean()),
    publicShowBoard: v.optional(v.boolean()),
    publicShowBylaws: v.optional(v.boolean()),
    publicShowFinancials: v.optional(v.boolean()),
    publicVolunteerIntakeEnabled: v.optional(v.boolean()),
    publicGrantIntakeEnabled: v.optional(v.boolean()),
    disabledModules: v.optional(v.array(v.string())),
    demoMode: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_public_slug", ["publicSlug"]),

  users: defineTable({
    societyId: v.id("societies"),
    email: v.string(),
    displayName: v.string(),
    role: v.string(), // Owner | Admin | Director | Member | Viewer
    authProvider: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    status: v.string(), // Active | Invited | Disabled
    avatarColor: v.optional(v.string()),
    createdAtISO: v.string(),
    emailVerifiedAtISO: v.optional(v.string()),
    lastLoginAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_email", ["email"])
    .index("by_auth_subject", ["authSubject"]),

  apiClients: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.string(), // plugin | integration | service
    status: v.string(), // active | disabled
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  apiTokens: defineTable({
    societyId: v.id("societies"),
    clientId: v.id("apiClients"),
    name: v.string(),
    tokenHash: v.string(),
    tokenStart: v.string(),
    scopes: v.array(v.string()),
    status: v.string(), // active | revoked
    expiresAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    lastUsedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_client", ["clientId"])
    .index("by_token_hash", ["tokenHash"]),

  pluginInstallations: defineTable({
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    name: v.string(),
    slug: v.string(),
    status: v.string(), // installed | disabled | removed
    capabilities: v.array(v.string()),
    configJson: v.optional(v.string()),
    installedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_slug", ["societyId", "slug"]),

  webhookSubscriptions: defineTable({
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    name: v.string(),
    targetUrl: v.string(),
    eventTypes: v.array(v.string()),
    secretEncrypted: v.string(),
    status: v.string(), // active | disabled
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  webhookDeliveries: defineTable({
    societyId: v.id("societies"),
    subscriptionId: v.id("webhookSubscriptions"),
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    status: v.string(), // pending | delivered | failed
    attempts: v.number(),
    attemptHistoryJson: v.optional(v.string()),
    nextAttemptAtISO: v.optional(v.string()),
    lastAttemptAtISO: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAtISO: v.string(),
    deliveredAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_subscription", ["subscriptionId"])
    .index("by_event", ["eventId"])
    .index("by_status_next", ["status", "nextAttemptAtISO"]),

  documentVersions: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    version: v.number(),
    storageProvider: v.string(), // convex | rustfs | demo
    storageKey: v.string(),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
    uploadedByUserId: v.optional(v.id("users")),
    uploadedByName: v.optional(v.string()),
    uploadedAtISO: v.string(),
    changeNote: v.optional(v.string()),
    isCurrent: v.boolean(),
  })
    .index("by_document", ["documentId"])
    .index("by_society", ["societyId"]),

  paperlessConnections: defineTable({
    societyId: v.id("societies"),
    status: v.string(), // connected | disconnected | error
    baseUrl: v.optional(v.string()),
    apiVersion: v.optional(v.string()),
    serverVersion: v.optional(v.string()),
    autoCreateTags: v.boolean(),
    autoUpload: v.boolean(),
    tagPrefix: v.optional(v.string()),
    connectedAtISO: v.string(),
    lastCheckedAtISO: v.optional(v.string()),
    lastSyncAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    demo: v.boolean(),
  }).index("by_society", ["societyId"]),

  paperlessDocumentSyncs: defineTable({
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    connectionId: v.optional(v.id("paperlessConnections")),
    status: v.string(), // queued | processing | complete | failed
    paperlessTaskId: v.optional(v.string()),
    paperlessDocumentId: v.optional(v.number()),
    paperlessDocumentUrl: v.optional(v.string()),
    title: v.string(),
    fileName: v.optional(v.string()),
    tags: v.array(v.string()),
    queuedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    lastCheckedAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"])
    .index("by_task", ["paperlessTaskId"]),

  notifications: defineTable({
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")), // null = broadcast to whole society
    kind: v.string(), // deadline | filing | minutes | signature | billing | bot | general
    severity: v.string(), // info | warn | success | err
    title: v.string(),
    body: v.optional(v.string()),
    linkHref: v.optional(v.string()),
    readAt: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_user", ["userId"]),

  notificationPrefs: defineTable({
    userId: v.id("users"),
    channel: v.string(), // email | inApp | slack
    kind: v.string(), // deadline | filing | minutes | billing | bot | general | all
    enabled: v.boolean(),
  }).index("by_user", ["userId"]),

  memberCommunicationPrefs: defineTable({
    societyId: v.id("societies"),
    memberId: v.id("members"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    transactionalEmailEnabled: v.boolean(),
    noticeEmailEnabled: v.boolean(),
    newsletterEmailEnabled: v.boolean(),
    smsEnabled: v.boolean(),
    mailEnabled: v.optional(v.boolean()),
    preferredChannel: v.string(), // email | sms | mail
    newsletterConsentAtISO: v.optional(v.string()),
    smsConsentAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
    unsubscribeReason: v.optional(v.string()),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"]),

  communicationSegments: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    includeAudience: v.string(), // all_members | voting_members | directors | overdue_subscribers | volunteers | custom
    memberStatus: v.optional(v.string()),
    membershipClass: v.optional(v.string()),
    votingRightsOnly: v.optional(v.boolean()),
    hasEmail: v.optional(v.boolean()),
    hasPhone: v.optional(v.boolean()),
    volunteerStatus: v.optional(v.string()),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  communicationTemplates: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    slug: v.string(),
    kind: v.string(), // notice | renewal | digest | newsletter | reminder
    channel: v.string(), // email | inApp | sms
    audience: v.string(), // all_members | voting_members | directors | overdue_subscribers
    subject: v.string(),
    bodyText: v.string(),
    bodyHtml: v.optional(v.string()),
    system: v.boolean(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_slug", ["societyId", "slug"]),

  communicationCampaigns: defineTable({
    societyId: v.id("societies"),
    templateId: v.optional(v.id("communicationTemplates")),
    segmentId: v.optional(v.id("communicationSegments")),
    meetingId: v.optional(v.id("meetings")),
    kind: v.string(),
    channel: v.string(),
    audience: v.string(),
    customAudienceLabel: v.optional(v.string()),
    subject: v.string(),
    bodyText: v.string(),
    status: v.string(), // draft | sending | sent | partial | failed
    memberCount: v.number(),
    deliveredCount: v.number(),
    openedCount: v.number(),
    bouncedCount: v.number(),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    sentAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  communicationDeliveries: defineTable({
    societyId: v.id("societies"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    templateId: v.optional(v.id("communicationTemplates")),
    meetingId: v.optional(v.id("meetings")),
    memberId: v.optional(v.id("members")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    channel: v.string(),
    provider: v.string(),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.string(), // queued | sent | opened | bounced | failed | skipped | unsubscribed
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    providerEventType: v.optional(v.string()),
    providerPayload: v.optional(v.string()),
    sentAtISO: v.string(),
    openedAtISO: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_campaign", ["campaignId"])
    .index("by_meeting", ["meetingId"])
    .index("by_provider_message", ["provider", "providerMessageId"]),

  financialConnections: defineTable({
    societyId: v.id("societies"),
    provider: v.string(), // wave | demo
    status: v.string(), // connected | disconnected | error
    accountLabel: v.optional(v.string()),
    externalBusinessId: v.optional(v.string()),
    connectedAtISO: v.string(),
    lastSyncAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    demo: v.boolean(),
  }).index("by_society", ["societyId"]),

  waveCacheSnapshots: defineTable({
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    businessName: v.string(),
    currencyCode: v.optional(v.string()),
    fetchedAtISO: v.string(),
    resourceCountsJson: v.string(),
    resourceTypes: v.array(v.string()),
    structureTypes: v.array(v.string()),
    status: v.string(), // complete | error
    lastError: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_connection", ["connectionId"])
    .index("by_society_provider", ["societyId", "provider"]),

  waveCacheResources: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("waveCacheSnapshots"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    resourceType: v.string(), // business | account | vendor | customer | product | invoice | estimate | salesTax
    externalId: v.optional(v.string()),
    label: v.string(),
    secondaryLabel: v.optional(v.string()),
    typeValue: v.optional(v.string()),
    subtypeValue: v.optional(v.string()),
    status: v.optional(v.string()),
    currencyCode: v.optional(v.string()),
    amountValue: v.optional(v.string()),
    dateValue: v.optional(v.string()),
    searchText: v.string(),
    rawJson: v.string(),
    fetchedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"])
    .index("by_society_type", ["societyId", "resourceType"])
    .index("by_society_external", ["societyId", "externalId"]),

  waveCacheStructures: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("waveCacheSnapshots"),
    connectionId: v.optional(v.id("financialConnections")),
    provider: v.string(), // wave
    businessId: v.string(),
    typeName: v.string(),
    kind: v.string(),
    fieldCount: v.number(),
    fieldsJson: v.string(),
    rawJson: v.string(),
    fetchedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"])
    .index("by_type", ["typeName"]),

  financialAccounts: defineTable({
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    externalId: v.string(),
    name: v.string(),
    currency: v.string(),
    accountType: v.string(), // Bank | Credit | Income | Expense | Asset | Liability | Equity
    balanceCents: v.number(),
    isRestricted: v.boolean(),
    restrictedPurpose: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_connection", ["connectionId"]),

  financialTransactions: defineTable({
    societyId: v.id("societies"),
    connectionId: v.id("financialConnections"),
    accountId: v.id("financialAccounts"),
    externalId: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    category: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    // Reconciliation — match this bank line to an internal record so we can
    // prove the general ledger agrees with the bank statement.
    reconciledAtISO: v.optional(v.string()),
    reconciledByName: v.optional(v.string()),
    matchedKind: v.optional(v.string()), // filing | receipt | payroll | manual
    matchedId: v.optional(v.string()),
    reconciliationNote: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_account", ["accountId"])
    .index("by_society_date", ["societyId", "date"]),

  budgets: defineTable({
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    category: v.string(),
    plannedCents: v.number(),
    notes: v.optional(v.string()),
  }).index("by_society_fy", ["societyId", "fiscalYear"]),

  budgetSnapshots: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    periodLabel: v.optional(v.string()),
    sourceDate: v.optional(v.string()),
    currency: v.string(),
    totalIncomeCents: v.optional(v.number()),
    totalExpenseCents: v.optional(v.number()),
    netCents: v.optional(v.number()),
    endingBalanceCents: v.optional(v.number()),
    preparedByName: v.optional(v.string()),
    lastModifiedDate: v.optional(v.string()),
    sourcePageCount: v.optional(v.number()),
    importGroupKey: v.optional(v.string()),
    status: v.string(), // NeedsReview | Verified | Superseded
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_fy", ["societyId", "fiscalYear"]),

  budgetSnapshotLines: defineTable({
    societyId: v.id("societies"),
    snapshotId: v.id("budgetSnapshots"),
    lineType: v.string(), // income | expense | balance | note
    category: v.string(),
    parentCategory: v.optional(v.string()),
    rowKind: v.optional(v.string()), // detail | subtotal | tax | total | ytd | note
    sortOrder: v.optional(v.number()),
    description: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    projectedCents: v.optional(v.number()),
    ytdCents: v.optional(v.number()),
    sourcePage: v.optional(v.string()),
    rawLabel: v.optional(v.string()),
    rawAmountText: v.optional(v.string()),
    confidence: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_snapshot", ["snapshotId"]),

  financialStatementImports: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    statementType: v.string(), // income_statement | balance_sheet | trial_balance | full_statement
    periodStart: v.optional(v.string()),
    periodEnd: v.string(),
    revenueCents: v.optional(v.number()),
    expensesCents: v.optional(v.number()),
    netAssetsCents: v.optional(v.number()),
    restrictedFundsCents: v.optional(v.number()),
    status: v.string(), // NeedsReview | Verified | Rejected
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_fy", ["societyId", "fiscalYear"]),

  financialStatementImportLines: defineTable({
    societyId: v.id("societies"),
    statementImportId: v.id("financialStatementImports"),
    section: v.string(),
    label: v.string(),
    amountCents: v.optional(v.number()),
    confidence: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_statement_import", ["statementImportId"]),

  treasurerReports: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    fiscalYear: v.string(),
    reportDate: v.string(),
    authorName: v.optional(v.string()),
    cashBalanceCents: v.optional(v.number()),
    highlights: v.array(v.string()),
    concerns: v.array(v.string()),
    status: v.string(), // NeedsReview | Verified | Archived
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "reportDate"]),

  transactionCandidates: defineTable({
    societyId: v.id("societies"),
    transactionDate: v.string(),
    importGroupKey: v.optional(v.string()),
    periodLabel: v.optional(v.string()),
    sourcePage: v.optional(v.string()),
    rowOrder: v.optional(v.number()),
    description: v.string(),
    amountCents: v.optional(v.number()),
    debitCents: v.optional(v.number()),
    creditCents: v.optional(v.number()),
    balanceCents: v.optional(v.number()),
    chequeNumber: v.optional(v.string()),
    comment: v.optional(v.string()),
    rawText: v.optional(v.string()),
    accountName: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    category: v.optional(v.string()),
    debitCredit: v.optional(v.string()),
    status: v.string(), // NeedsReview | Matched | Ignored | Restricted
    sensitivity: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "transactionDate"]),

  signatures: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(), // minutes | resolution | filing
    entityId: v.string(),
    userId: v.optional(v.id("users")),
    signerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(), // typed | drawn | email_confirm
    typedName: v.optional(v.string()),
    signedAtISO: v.string(),
    ipAddress: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["entityType", "entityId"]),

  filingBotRuns: defineTable({
    societyId: v.id("societies"),
    filingId: v.id("filings"),
    kind: v.string(), // AnnualReport | BylawAmendment | ChangeOfDirectors
    status: v.string(), // queued | running | success | failed | manual_required
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    steps: v.array(
      v.object({
        label: v.string(),
        status: v.string(), // pending | running | ok | fail | skip
        atISO: v.optional(v.string()),
        note: v.optional(v.string()),
      }),
    ),
    demo: v.boolean(),
    confirmationNumber: v.optional(v.string()),
    pdfDocumentId: v.optional(v.id("documents")),
    triggeredByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_filing", ["filingId"]),

  workflows: defineTable({
    societyId: v.id("societies"),
    recipe: v.string(), // agm_prep | insurance_renewal | annual_report_filing | unbc_affiliate_id_request
    name: v.string(),
    status: v.string(), // active | paused | archived
    provider: v.optional(v.string()), // internal | n8n
    providerConfig: v.optional(
      v.object({
        externalWorkflowId: v.optional(v.string()),
        externalWebhookUrl: v.optional(v.string()),
        externalEditUrl: v.optional(v.string()),
      }),
    ),
    nodePreview: v.optional(
      v.array(
        v.object({
          key: v.string(),
          type: v.string(),
          label: v.string(),
          description: v.optional(v.string()),
          status: v.optional(v.string()),
          config: v.optional(v.any()),
        }),
      ),
    ),
    trigger: v.object({
      kind: v.string(), // cron | manual | date_offset
      cron: v.optional(v.string()),
      offset: v.optional(
        v.object({
          anchor: v.string(), // meetings.scheduledAt | insurancePolicies.renewalDate | filings.dueDate
          anchorId: v.optional(v.string()),
          daysBefore: v.number(),
        }),
      ),
    }),
    config: v.optional(v.any()),
    lastRunAtISO: v.optional(v.string()),
    nextRunAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_next_run", ["nextRunAtISO"]),

  // Queued manual-send emails (the "outbox"). Used when no live email
  // provider is configured, or when the workflow author explicitly wants a
  // human to send the message from their own inbox.
  pendingEmails: defineTable({
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    nodeKey: v.optional(v.string()),
    to: v.string(),
    cc: v.optional(v.string()),
    bcc: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    attachments: v.array(
      v.object({
        documentId: v.id("documents"),
        fileName: v.string(),
      }),
    ),
    status: v.string(), // draft | ready | sent | cancelled
    createdAtISO: v.string(),
    createdByUserId: v.optional(v.id("users")),
    sentAtISO: v.optional(v.string()),
    sentByUserId: v.optional(v.id("users")),
    sentChannel: v.optional(v.string()), // personal_email | other
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  workflowRuns: defineTable({
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    recipe: v.string(),
    status: v.string(), // queued | running | success | failed | manual_required
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    steps: v.array(
      v.object({
        key: v.optional(v.string()),
        label: v.string(),
        status: v.string(), // pending | running | ok | fail | skip
        atISO: v.optional(v.string()),
        note: v.optional(v.string()),
      }),
    ),
    provider: v.optional(v.string()), // internal | n8n
    externalRunId: v.optional(v.string()),
    externalStatus: v.optional(v.string()),
    generatedDocumentId: v.optional(v.id("documents")),
    generatedDocumentVersionId: v.optional(v.id("documentVersions")),
    output: v.optional(v.any()),
    demo: v.boolean(),
    triggeredBy: v.string(), // cron | manual | event
    triggeredByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_workflow", ["workflowId"]),

  subscriptionPlans: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(), // month | year | one_time
    benefits: v.array(v.string()),
    membershipClass: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_society", ["societyId"]),

  memberSubscriptions: defineTable({
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    memberId: v.optional(v.id("members")),
    email: v.string(),
    fullName: v.string(),
    status: v.string(), // active | canceled | past_due | trialing | pending
    startedAtISO: v.string(),
    currentPeriodEndISO: v.optional(v.string()),
    canceledAtISO: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    lastPaymentAtISO: v.optional(v.string()),
    lastPaymentCents: v.optional(v.number()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"])
    .index("by_email", ["email"]),

  transcripts: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    provider: v.string(), // whisper | demo
    storageKey: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    language: v.optional(v.string()),
    text: v.string(),
    segments: v.array(
      v.object({
        speaker: v.string(),
        text: v.string(),
        startSec: v.number(),
        endSec: v.number(),
      }),
    ),
    createdAtISO: v.string(),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  transcriptionJobs: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    status: v.string(), // queued | running | complete | failed
    provider: v.string(),
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    error: v.optional(v.string()),
    transcriptId: v.optional(v.id("transcripts")),
    demo: v.boolean(),
  }).index("by_meeting", ["meetingId"]),

  // Per-category custom field definitions. Admins add a definition under
  // members/directors/volunteers/employees, then each person in that
  // category can have a value stored in customFieldValues.
  customFieldDefinitions: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(), // members | directors | volunteers | employees
    key: v.string(), // machine key, e.g. "unbc_affiliate_role"
    label: v.string(),
    kind: v.string(), // text | number | date | boolean | email | phone
    required: v.boolean(),
    order: v.number(),
    description: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_entity", ["societyId", "entityType"])
    .index("by_society_entity_key", ["societyId", "entityType", "key"]),

  customFieldValues: defineTable({
    societyId: v.id("societies"),
    definitionId: v.id("customFieldDefinitions"),
    entityType: v.string(),
    entityId: v.string(),
    value: v.any(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_definition", ["definitionId"])
    .index("by_entity_def", ["entityType", "entityId", "definitionId"]),

  members: defineTable({
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    membershipClass: v.string(),
    status: v.string(),
    joinedAt: v.string(),
    leftAt: v.optional(v.string()),
    votingRights: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  directors: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    position: v.string(),
    isBCResident: v.boolean(),
    termStart: v.string(),
    termEnd: v.optional(v.string()),
    consentOnFile: v.boolean(),
    resignedAt: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  boardRoleAssignments: defineTable({
    societyId: v.id("societies"),
    personName: v.string(),
    personKey: v.optional(v.string()),
    roleTitle: v.string(),
    roleGroup: v.optional(v.string()),
    roleType: v.string(), // director | officer | committee | staff | observed
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.string(), // Observed | Verified | Superseded | Rejected
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    importedFrom: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_start", ["societyId", "startDate"])
    .index("by_person", ["societyId", "personKey"]),

  boardRoleChanges: defineTable({
    societyId: v.id("societies"),
    effectiveDate: v.string(),
    changeType: v.string(), // added | removed | renamed | appointed | resigned | elected
    roleTitle: v.string(),
    personName: v.optional(v.string()),
    previousPersonName: v.optional(v.string()),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    motionEvidenceId: v.optional(v.string()),
    status: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "effectiveDate"]),

  signingAuthorities: defineTable({
    societyId: v.id("societies"),
    personName: v.string(),
    roleTitle: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    accountLabel: v.optional(v.string()),
    authorityType: v.string(), // signing | banking | card | online-banking | other
    effectiveDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "effectiveDate"]),

  committees: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    mission: v.optional(v.string()),
    cadence: v.string(),
    cadenceNotes: v.optional(v.string()),
    nextMeetingAt: v.optional(v.string()),
    chairDirectorId: v.optional(v.id("directors")),
    color: v.string(),
    status: v.string(),
    createdAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  committeeMembers: defineTable({
    committeeId: v.id("committees"),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    joinedAt: v.string(),
    leftAt: v.optional(v.string()),
  })
    .index("by_committee", ["committeeId"])
    .index("by_society", ["societyId"]),

  volunteers: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    committeeId: v.optional(v.id("committees")),
    publicApplicationId: v.optional(v.id("volunteerApplications")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.string(), // Prospect | Applied | Active | Paused | Inactive | Declined
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    screeningRequired: v.boolean(),
    orientationCompletedAtISO: v.optional(v.string()),
    trainingStatus: v.optional(v.string()), // Pending | InProgress | Complete
    applicationReceivedAtISO: v.optional(v.string()),
    approvedAtISO: v.optional(v.string()),
    renewalDueAtISO: v.optional(v.string()),
    intakeSource: v.optional(v.string()), // public | portal | admin
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"])
    .index("by_committee", ["committeeId"]),

  volunteerApplications: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    linkedVolunteerId: v.optional(v.id("volunteers")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    notes: v.optional(v.string()),
    source: v.string(), // public | portal | admin
    status: v.string(), // Submitted | Reviewing | Approved | Declined | Converted
    submittedAtISO: v.string(),
    reviewedAtISO: v.optional(v.string()),
    reviewedByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_status", ["societyId", "status"]),

  volunteerScreenings: defineTable({
    societyId: v.id("societies"),
    volunteerId: v.id("volunteers"),
    kind: v.string(), // Orientation | ReferenceCheck | CriminalRecordCheck | PolicyAttestation | Training
    status: v.string(), // needed | requested | clear | failed | expired | waived
    provider: v.optional(v.string()), // BC_CRRP | Manual | Other
    portalUrl: v.optional(v.string()),
    requestedAtISO: v.optional(v.string()),
    completedAtISO: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    referenceNumber: v.optional(v.string()),
    consentDocumentId: v.optional(v.id("documents")),
    resultDocumentId: v.optional(v.id("documents")),
    verifiedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_volunteer", ["volunteerId"]),

  meetings: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    noticeSentAt: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    minutesId: v.optional(v.id("minutes")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "scheduledAt"])
    .index("by_committee", ["committeeId"]),

  minutes: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    motions: v.array(
      v.object({
        text: v.string(),
        movedBy: v.optional(v.string()),
        secondedBy: v.optional(v.string()),
        outcome: v.string(),
        votesFor: v.optional(v.number()),
        votesAgainst: v.optional(v.number()),
        abstentions: v.optional(v.number()),
        resolutionType: v.optional(v.string()), // Ordinary | Special | Unanimous
      }),
    ),
    decisions: v.array(v.string()),
    actionItems: v.array(
      v.object({
        text: v.string(),
        assignee: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        done: v.boolean(),
      }),
    ),
    approvedAt: v.optional(v.string()),
    approvedInMeetingId: v.optional(v.id("meetings")),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    draftTranscript: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  meetingAttendanceRecords: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    meetingTitle: v.string(),
    meetingDate: v.string(),
    personName: v.string(),
    roleTitle: v.optional(v.string()),
    attendanceStatus: v.string(), // present | absent | regrets | guest | needs_review
    quorumCounted: v.optional(v.boolean()),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_society_date", ["societyId", "meetingDate"]),

  motionEvidence: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    meetingTitle: v.string(),
    meetingDate: v.string(),
    motionText: v.string(),
    movedBy: v.optional(v.string()),
    secondedBy: v.optional(v.string()),
    outcome: v.string(),
    voteSummary: v.optional(v.string()),
    pageRef: v.optional(v.string()),
    evidenceText: v.optional(v.string()),
    confidence: v.string(),
    status: v.string(), // Extracted | Verified | Rejected
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_society_date", ["societyId", "meetingDate"]),

  filings: defineTable({
    societyId: v.id("societies"),
    kind: v.string(),
    periodLabel: v.optional(v.string()),
    dueDate: v.string(),
    filedAt: v.optional(v.string()),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    confirmationNumber: v.optional(v.string()),
    feePaidCents: v.optional(v.number()),
    receiptDocumentId: v.optional(v.id("documents")),
    stagedPacketDocumentId: v.optional(v.id("documents")),
    submissionChecklist: v.optional(v.array(v.string())),
    registryUrl: v.optional(v.string()),
    evidenceNotes: v.optional(v.string()),
    attestedByUserId: v.optional(v.id("users")),
    attestedAtISO: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "dueDate"]),

  grants: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    boardOwnerUserId: v.optional(v.id("users")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    opportunityUrl: v.optional(v.string()),
    opportunityType: v.optional(v.string()),
    priority: v.optional(v.string()),
    fitScore: v.optional(v.number()),
    nextAction: v.optional(v.string()),
    publicDescription: v.optional(v.string()),
    allowPublicApplications: v.optional(v.boolean()),
    applicationInstructions: v.optional(v.string()),
    requirements: v.optional(
      v.array(
        v.object({
          id: v.string(),
          category: v.string(),
          label: v.string(),
          status: v.string(), // Needed | Requested | Ready | Attached | Waived
          dueDate: v.optional(v.string()),
          documentId: v.optional(v.id("documents")),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    confirmationCode: v.optional(v.string()),
    sourcePath: v.optional(v.string()),
    sourceImportedAtISO: v.optional(v.string()),
    sourceFileCount: v.optional(v.number()),
    sourceNotes: v.optional(v.string()),
    keyFacts: v.optional(v.array(v.string())),
    useOfFunds: v.optional(
      v.array(
        v.object({
          label: v.string(),
          amountCents: v.optional(v.number()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    timelineEvents: v.optional(
      v.array(
        v.object({
          label: v.string(),
          date: v.string(),
          status: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    complianceFlags: v.optional(
      v.array(
        v.object({
          label: v.string(),
          status: v.string(),
          notes: v.optional(v.string()),
          requirementId: v.optional(v.string()),
        }),
      ),
    ),
    contacts: v.optional(
      v.array(
        v.object({
          role: v.string(),
          name: v.optional(v.string()),
          organization: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    answerLibrary: v.optional(
      v.array(
        v.object({
          section: v.string(),
          title: v.string(),
          body: v.string(),
        }),
      ),
    ),
    title: v.string(),
    funder: v.string(),
    program: v.optional(v.string()),
    status: v.string(), // Prospecting | Drafting | Submitted | Awarded | Declined | Active | Closed
    amountRequestedCents: v.optional(v.number()),
    amountAwardedCents: v.optional(v.number()),
    restrictedPurpose: v.optional(v.string()),
    applicationDueDate: v.optional(v.string()),
    submittedAtISO: v.optional(v.string()),
    decisionAtISO: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    nextReportDueAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  grantApplications: defineTable({
    societyId: v.id("societies"),
    grantId: v.optional(v.id("grants")),
    memberId: v.optional(v.id("members")),
    linkedGrantId: v.optional(v.id("grants")),
    applicantName: v.string(),
    organizationName: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    amountRequestedCents: v.optional(v.number()),
    projectTitle: v.string(),
    projectSummary: v.string(),
    proposedUseOfFunds: v.optional(v.string()),
    expectedOutcomes: v.optional(v.string()),
    source: v.string(), // public | portal | admin
    status: v.string(), // Submitted | Reviewing | Shortlisted | Approved | Declined | Converted
    submittedAtISO: v.string(),
    reviewedAtISO: v.optional(v.string()),
    reviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"])
    .index("by_status", ["societyId", "status"]),

  grantReports: defineTable({
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    title: v.string(),
    dueAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(), // Upcoming | Due | Submitted | Overdue
    spendingToDateCents: v.optional(v.number()),
    outcomeSummary: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    submittedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"]),

  grantTransactions: defineTable({
    societyId: v.id("societies"),
    grantId: v.id("grants"),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    documentId: v.optional(v.id("documents")),
    date: v.string(),
    direction: v.string(), // inflow | outflow | commitment | adjustment
    amountCents: v.number(),
    description: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"]),

  deadlines: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.string(),
    category: v.string(),
    done: v.boolean(),
    recurrence: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
  })
    .index("by_society", ["societyId"])
    .index("by_society_due", ["societyId", "dueDate"]),

  documents: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileSizeBytes: v.optional(v.number()),
    retentionYears: v.optional(v.number()),
    createdAtISO: v.string(),
    flaggedForDeletion: v.boolean(),
    archivedAtISO: v.optional(v.string()),
    archivedReason: v.optional(v.string()),
    importSessionId: v.optional(v.id("documents")),
    importRecordKind: v.optional(v.string()),
    tags: v.array(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_category", ["societyId", "category"])
    .index("by_import_session", ["importSessionId"])
    .index("by_committee", ["committeeId"]),

  publications: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    summary: v.optional(v.string()),
    category: v.string(), // AnnualReport | Bylaws | AGM | Policy | Notice | Resource | Custom
    documentId: v.optional(v.id("documents")),
    url: v.optional(v.string()),
    publishedAtISO: v.optional(v.string()),
    status: v.string(), // Draft | Published | Archived
    reviewStatus: v.optional(v.string()), // Draft | InReview | Approved
    approvedByUserId: v.optional(v.id("users")),
    approvedAtISO: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    createdAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  conflicts: defineTable({
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    declaredAt: v.string(),
    contractOrMatter: v.string(),
    natureOfInterest: v.string(),
    abstainedFromVote: v.boolean(),
    leftRoom: v.boolean(),
    resolvedAt: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_director", ["directorId"]),

  financials: defineTable({
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodEnd: v.string(),
    revenueCents: v.number(),
    expensesCents: v.number(),
    netAssetsCents: v.number(),
    restrictedFundsCents: v.optional(v.number()),
    auditStatus: v.string(),
    auditorName: v.optional(v.string()),
    approvedByBoardAt: v.optional(v.string()),
    presentedAtMeetingId: v.optional(v.id("meetings")),
    remunerationDisclosures: v.array(
      v.object({ role: v.string(), amountCents: v.number() }),
    ),
    statementsDocId: v.optional(v.id("documents")),
  }).index("by_society", ["societyId"]),

  bylawRuleSets: defineTable({
    societyId: v.id("societies"),
    version: v.number(),
    status: v.string(), // Draft | Active | Archived
    effectiveFromISO: v.optional(v.string()),
    sourceBylawDocumentId: v.optional(v.id("documents")),
    sourceAmendmentId: v.optional(v.id("bylawAmendments")),
    generalNoticeMinDays: v.number(),
    generalNoticeMaxDays: v.number(),
    allowElectronicMeetings: v.boolean(),
    allowHybridMeetings: v.boolean(),
    allowElectronicVoting: v.boolean(),
    allowProxyVoting: v.boolean(),
    proxyHolderMustBeMember: v.boolean(),
    proxyLimitPerGrantorPerMeeting: v.number(),
    quorumType: v.string(), // fixed | percentage
    quorumValue: v.number(),
    memberProposalThresholdPct: v.number(),
    memberProposalMinSignatures: v.number(),
    memberProposalLeadDays: v.number(),
    requisitionMeetingThresholdPct: v.number(),
    annualReportDueDaysAfterMeeting: v.number(),
    requireAgmFinancialStatements: v.boolean(),
    requireAgmElections: v.boolean(),
    ballotIsAnonymous: v.boolean(),
    voterMustBeMemberAtRecordDate: v.boolean(),
    inspectionMemberRegisterByMembers: v.boolean(),
    inspectionMemberRegisterByPublic: v.boolean(),
    inspectionDirectorRegisterByMembers: v.boolean(),
    inspectionCopiesAllowed: v.boolean(),
    ordinaryResolutionThresholdPct: v.number(),
    specialResolutionThresholdPct: v.number(),
    unanimousWrittenSpecialResolution: v.boolean(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  goals: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    title: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    status: v.string(),
    startDate: v.string(),
    targetDate: v.string(),
    progressPercent: v.number(),
    ownerName: v.optional(v.string()),
    milestones: v.array(
      v.object({
        title: v.string(),
        done: v.boolean(),
        dueDate: v.optional(v.string()),
      }),
    ),
    keyResults: v.array(
      v.object({
        description: v.string(),
        currentValue: v.number(),
        targetValue: v.number(),
        unit: v.string(),
      }),
    ),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_committee", ["committeeId"]),

  tasks: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(),
    priority: v.string(),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    goalId: v.optional(v.id("goals")),
    tags: v.array(v.string()),
    createdAtISO: v.string(),
    completedAt: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_committee", ["committeeId"])
    .index("by_goal", ["goalId"])
    .index("by_meeting", ["meetingId"]),

  activity: defineTable({
    societyId: v.id("societies"),
    actor: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_entity", ["societyId", "entityType", "entityId"]),

  notes: defineTable({
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    author: v.string(),
    body: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_entity", ["societyId", "entityType", "entityId"])
    .index("by_society", ["societyId"]),

  invitations: defineTable({
    societyId: v.id("societies"),
    email: v.string(),
    role: v.string(),
    token: v.string(),
    invitedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    acceptedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_token", ["token"]),

  // ========== Priority A additions ==========

  inspections: defineTable({
    societyId: v.id("societies"),
    documentId: v.optional(v.id("documents")),
    inspectorName: v.string(),
    isMember: v.boolean(),
    recordsRequested: v.string(),
    inspectedAtISO: v.string(),
    feeCents: v.optional(v.number()),
    copyPages: v.optional(v.number()),
    copyFeeCents: v.optional(v.number()),
    deliveryMethod: v.string(), // "in-person" | "electronic"
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_document", ["documentId"]),

  directorAttestations: defineTable({
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    year: v.number(),
    signedAtISO: v.string(),
    isAtLeast18: v.boolean(),
    notBankrupt: v.boolean(),
    notDisqualified: v.boolean(),
    stillResidentOrEligible: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_director", ["directorId"])
    .index("by_director_year", ["directorId", "year"]),

  writtenResolutions: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    text: v.string(),
    kind: v.string(), // Ordinary | Special
    circulatedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    // Required: unanimous signatures from all voting members (for members' special resolutions in lieu of meeting)
    signatures: v.array(
      v.object({
        signerName: v.string(),
        signedAtISO: v.string(),
        memberId: v.optional(v.id("members")),
      }),
    ),
    requiredCount: v.number(),
    status: v.string(), // Draft | Circulating | Carried | Failed
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  agmRuns: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    step: v.string(), // notice | held | financialsPresented | electionsHeld | minutesApproved | annualReportFiled | complete
    noticeSentAt: v.optional(v.string()),
    noticeRecipientCount: v.optional(v.number()),
    quorumCheckedAtISO: v.optional(v.string()),
    financialsPresentedAt: v.optional(v.string()),
    electionsCompletedAt: v.optional(v.string()),
    minutesApprovedAt: v.optional(v.string()),
    annualReportFiledAt: v.optional(v.string()),
    annualReportFilingId: v.optional(v.id("filings")),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  noticeDeliveries: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    channel: v.string(), // email | mail | in-person
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    sentAtISO: v.string(),
    openedAtISO: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    status: v.string(), // queued | sent | bounced | failed
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  // ========== Priority B additions ==========

  insurancePolicies: defineTable({
    societyId: v.id("societies"),
    kind: v.string(), // DirectorsOfficers | GeneralLiability | PropertyCasualty | CyberLiability | Other
    insurer: v.string(),
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    coverageCents: v.optional(v.number()),
    premiumCents: v.optional(v.number()),
    deductibleCents: v.optional(v.number()),
    coverageSummary: v.optional(v.string()),
    additionalInsureds: v.optional(v.array(v.string())),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    renewalDate: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    confidence: v.optional(v.string()),
    sensitivity: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    status: v.string(), // NeedsReview | Active | Lapsed | Cancelled
    createdAtISO: v.optional(v.string()),
    updatedAtISO: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  pipaTrainings: defineTable({
    societyId: v.id("societies"),
    participantUserId: v.optional(v.id("users")),
    participantMemberId: v.optional(v.id("members")),
    participantName: v.string(),
    role: v.string(), // Director | Staff | Volunteer
    participantEmail: v.optional(v.string()),
    topic: v.string(), // PIPA | CASL | Privacy-refresh
    completedAtISO: v.string(),
    nextDueAtISO: v.optional(v.string()),
    trainer: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  proxies: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    grantorName: v.string(),
    grantorMemberId: v.optional(v.id("members")),
    proxyHolderName: v.string(),
    proxyHolderMemberId: v.optional(v.id("members")),
    instructions: v.optional(v.string()), // specific instructions, if any
    signedAtISO: v.string(),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  auditorAppointments: defineTable({
    societyId: v.id("societies"),
    firmName: v.string(),
    engagementType: v.string(), // Audit | ReviewEngagement | CompilationEngagement
    fiscalYear: v.string(),
    appointedBy: v.string(), // Directors | Members
    appointedAtISO: v.string(),
    engagementLetterDocId: v.optional(v.id("documents")),
    independenceAttested: v.boolean(),
    status: v.string(), // Active | Completed | Resigned | Replaced
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  memberProposals: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    text: v.string(),
    submittedByName: v.string(),
    submittedAtISO: v.string(),
    receivedAtISO: v.optional(v.string()),
    signatureCount: v.number(),
    thresholdPercent: v.number(), // default 5
    eligibleVotersAtSubmission: v.optional(v.number()),
    includedInAgenda: v.boolean(),
    status: v.string(), // Submitted | MeetsThreshold | Rejected | Included
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  elections: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // Draft | Open | Closed | Tallied | Cancelled
    opensAtISO: v.string(),
    closesAtISO: v.string(),
    nominationsOpenAtISO: v.optional(v.string()),
    nominationsCloseAtISO: v.optional(v.string()),
    eligibilityCutoffISO: v.optional(v.string()),
    anonymousBallot: v.boolean(),
    scrutineerUserIds: v.optional(v.array(v.id("users"))),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    talliedAtISO: v.optional(v.string()),
    resultsPublishedAtISO: v.optional(v.string()),
    evidenceDocumentId: v.optional(v.id("documents")),
    resultsSummary: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  electionQuestions: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.optional(v.string()), // single_choice | multi_choice
    maxSelections: v.number(),
    seatsAvailable: v.optional(v.number()),
    options: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        memberId: v.optional(v.id("members")),
        statement: v.optional(v.string()),
      }),
    ),
    order: v.number(),
  })
    .index("by_election", ["electionId"])
    .index("by_society", ["societyId"]),

  electionEligibleVoters: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    memberId: v.id("members"),
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    fullName: v.string(),
    status: v.string(), // Eligible | Confirmed | Voted | Revoked
    eligibilityReason: v.optional(v.string()),
    confirmedAtISO: v.optional(v.string()),
    votedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_election", ["electionId"])
    .index("by_member", ["memberId"])
    .index("by_election_member", ["electionId", "memberId"]),

  electionBallots: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    receiptCode: v.string(),
    submittedAtISO: v.string(),
    choices: v.array(
      v.object({
        questionId: v.id("electionQuestions"),
        optionIds: v.array(v.string()),
      }),
    ),
    spoiledAtISO: v.optional(v.string()),
  })
    .index("by_election", ["electionId"])
    .index("by_receipt", ["electionId", "receiptCode"]),

  electionNominations: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    questionId: v.optional(v.id("electionQuestions")),
    memberId: v.optional(v.id("members")),
    nomineeName: v.string(),
    nomineeEmail: v.optional(v.string()),
    statement: v.optional(v.string()),
    status: v.string(), // Submitted | Accepted | Rejected | Withdrawn | OnBallot
    submittedByUserId: v.optional(v.id("users")),
    submittedAtISO: v.string(),
    reviewedByUserId: v.optional(v.id("users")),
    reviewedAtISO: v.optional(v.string()),
    addedToBallotAtISO: v.optional(v.string()),
  })
    .index("by_election", ["electionId"])
    .index("by_society", ["societyId"]),

  electionAuditEvents: defineTable({
    societyId: v.id("societies"),
    electionId: v.id("elections"),
    actorName: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_election", ["electionId"])
    .index("by_society", ["societyId"]),

  donationReceipts: defineTable({
    societyId: v.id("societies"),
    charityNumber: v.string(),
    receiptNumber: v.string(),
    donorName: v.string(),
    donorEmail: v.optional(v.string()),
    donorAddress: v.optional(v.string()),
    amountCents: v.number(),
    eligibleAmountCents: v.number(),
    receivedOnISO: v.string(),
    issuedAtISO: v.string(),
    location: v.string(),
    description: v.optional(v.string()), // non-cash gifts
    isNonCash: v.boolean(),
    appraiserName: v.optional(v.string()),
    voidedAtISO: v.optional(v.string()),
    voidReason: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_receipt_number", ["societyId", "receiptNumber"]),

  employees: defineTable({
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    employmentType: v.string(), // FullTime | PartTime | Casual | Contractor
    annualSalaryCents: v.optional(v.number()),
    hourlyWageCents: v.optional(v.number()),
    worksafeBCNumber: v.optional(v.string()),
    cppExempt: v.boolean(),
    eiExempt: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  courtOrders: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    orderDate: v.string(),
    court: v.string(),
    fileNumber: v.optional(v.string()),
    description: v.string(),
    documentId: v.optional(v.id("documents")),
    status: v.string(), // Active | Satisfied | Vacated
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  bylawAmendments: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    // Current bylaws text at the time this draft was started (immutable snapshot).
    baseText: v.string(),
    // Proposed replacement text. Editable while Draft; frozen after consultation starts.
    proposedText: v.string(),
    // Draft | Consultation | ResolutionPassed | Filed | Superseded | Withdrawn
    status: v.string(),
    createdByName: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    consultationStartedAtISO: v.optional(v.string()),
    consultationEndedAtISO: v.optional(v.string()),
    resolutionMeetingId: v.optional(v.id("meetings")),
    resolutionPassedAtISO: v.optional(v.string()),
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),
    filingId: v.optional(v.id("filings")),
    filedAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    history: v.array(
      v.object({
        atISO: v.string(),
        actor: v.string(),
        action: v.string(),
        note: v.optional(v.string()),
      }),
    ),
  }).index("by_society", ["societyId"]),

  // ========== Board meeting workflow ==========

  agendas: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    title: v.string(),
    status: v.string(), // Draft | Published | Finalized
    notes: v.optional(v.string()),
    updatedAtISO: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  agendaItems: defineTable({
    societyId: v.id("societies"),
    agendaId: v.id("agendas"),
    order: v.number(),
    type: v.string(), // discussion | motion | report | break | executive_session
    title: v.string(),
    details: v.optional(v.string()),
    presenter: v.optional(v.string()),
    timeAllottedMinutes: v.optional(v.number()),
    motionTemplateId: v.optional(v.id("motionTemplates")),
    motionText: v.optional(v.string()),
    outcome: v.optional(v.string()), // carried | defeated | tabled | deferred
    resolutionId: v.optional(v.id("writtenResolutions")),
    createdAtISO: v.string(),
  })
    .index("by_agenda", ["agendaId"])
    .index("by_society", ["societyId"]),

  motionTemplates: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    body: v.string(),
    category: v.string(), // governance | finance | membership | operations | bylaws | other
    requiresSpecialResolution: v.boolean(),
    notes: v.optional(v.string()),
    usageCount: v.optional(v.number()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_category", ["societyId", "category"]),

  // Where records are kept if not at the registered office
  recordsLocation: defineTable({
    societyId: v.id("societies"),
    address: v.string(),
    noticePostedAtOffice: v.boolean(),
    postedAtISO: v.optional(v.string()),
    computerProvidedForInspection: v.boolean(),
    notes: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  sourceEvidence: defineTable({
    societyId: v.id("societies"),
    sourceDocumentId: v.optional(v.id("documents")),
    externalSystem: v.string(),
    externalId: v.optional(v.string()),
    sourceTitle: v.string(),
    sourceDate: v.optional(v.string()),
    evidenceKind: v.string(), // provenance | restricted | publication_sidecar | import_support
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    sensitivity: v.string(), // standard | restricted
    accessLevel: v.string(), // public | internal | restricted
    summary: v.string(),
    excerpt: v.optional(v.string()),
    status: v.string(), // NeedsReview | Linked | Verified | Rejected
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_external", ["societyId", "externalId"])
    .index("by_source", ["sourceDocumentId"])
    .index("by_target", ["targetTable", "targetId"]),

  secretVaultItems: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    service: v.string(),
    credentialType: v.string(), // recovery_key | registry_key | api_key | password | certificate | other
    ownerRole: v.optional(v.string()),
    custodianUserId: v.optional(v.id("users")),
    custodianPersonName: v.optional(v.string()),
    custodianEmail: v.optional(v.string()),
    backupCustodianName: v.optional(v.string()),
    backupCustodianEmail: v.optional(v.string()),
    username: v.optional(v.string()),
    accessUrl: v.optional(v.string()),
    storageMode: v.string(), // stored_encrypted | external_reference | encrypted_elsewhere | not_stored
    externalLocation: v.optional(v.string()),
    secretEncrypted: v.optional(v.string()),
    secretPreview: v.optional(v.string()),
    secretUpdatedAtISO: v.optional(v.string()),
    secretUpdatedByUserId: v.optional(v.id("users")),
    secretLastRevealedAtISO: v.optional(v.string()),
    secretLastRevealedByUserId: v.optional(v.id("users")),
    revealPolicy: v.optional(v.string()), // owner_admin | owner_admin_custodian | owner_only
    authorizedUserIds: v.optional(v.array(v.id("users"))),
    lastVerifiedAtISO: v.optional(v.string()),
    rotationDueAtISO: v.optional(v.string()),
    status: v.string(), // Active | NeedsReview | Rotated | Revoked
    sensitivity: v.string(), // restricted | high
    accessLevel: v.string(), // restricted
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_service", ["societyId", "service"])
    .index("by_society_status", ["societyId", "status"]),

  archiveAccessions: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    accessionNumber: v.optional(v.string()),
    containerType: v.string(), // box | binder | drive | folder | external_archive | other
    location: v.string(),
    custodian: v.optional(v.string()),
    dateReceived: v.optional(v.string()),
    dateRange: v.optional(v.string()),
    status: v.string(), // NeedsReview | InCustody | Transferred | Archived
    accessRestrictions: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "dateReceived"]),

});
