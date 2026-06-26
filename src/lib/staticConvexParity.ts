// Static-mirror write parity ledger — the single source of truth shared by the
// static Convex mirror (src/lib/staticConvex.ts) and the CI parity gate
// (scripts/check-static-convex-parity.ts).
//
// Background: the static mirror re-implements the Convex backend for the
// offline/desktop ("static://societyer-demo") runtime. Every mutation/action the
// frontend calls via useMutation/useAction must be accounted for here so a write
// can never *silently* vanish. A frontend write is acceptable only if it is one
// of:
//   1. handled explicitly in staticConvex.ts (an `name === "module:fn"` case),
//   2. handled by the generic CRUD fallback (create|update|upsert|issue|setStatus|remove),
//   3. listed in STATIC_OFFLINE_NOOP_WRITES below (intentionally a no-op offline),
//   4. listed in STATIC_PENDING_WRITES below (a known, acknowledged gap).
//
// The parity gate FAILS when a frontend write matches none of the above, so new
// silent gaps cannot be introduced. At runtime the mirror surfaces a pending gap
// loudly in dev (throws) and warns (without crashing) in production builds.

// (3) Operations that genuinely cannot run in the offline/desktop runtime:
// network/third-party integrations, AI inference, outbound email, billing,
// storage upload URLs, and seed/backfill maintenance the demo data already
// reflects. These return null (a deliberate no-op) with no error.
export const STATIC_OFFLINE_NOOP_WRITES: ReadonlySet<string> = new Set([
  "apiPlatform:revokeToken",
  "apiPlatform:setWebhookSubscriptionStatus",
  // The outbound iCalendar feed needs the live Convex http server, so enabling
  // it is a no-op in the fully-offline demo runtime.
  "calendarFeed:setFeedToken",
  "communications:ensureDefaultTemplates",
  "communications:sendCampaign",
  "communications:sendMeetingNotice",
  "documentVersions:beginUpload",
  "files:generateUploadUrl",
  "files:generateLogoUploadUrl",
  "filingBot:run",
  "financialHub:disconnect",
  "financialHub:markConnectionConnected",
  "financialHub:sync",
  "meetingTemplates:seedDefaults",
  "meetings:backfillQuorumSnapshot",
  "minutes:backfillQuorumSnapshot",
  "minutes:generateDraft",
  "motionTemplates:seedDefaults",
  "notifications:sendDigest",
  "organizationDetails:backfillFromExistingRecords",
  "organizationDetails:seedFromSocietyAddresses",
  "paperless:disconnect",
  "paperless:pullSourceDocument",
  "pendingEmails:cancel",
  "pendingEmails:markSent",
  "seedRecordTableMetadata:ensureForSociety",
  "subscriptions:cancelSubscription",
  "subscriptions:simulateActivation",
  "transcripts:runPipeline",
  "workflows:inspectPdfTemplate",
  "workflows:run",
]);

// (4) Local-data writes that SHOULD persist offline but are not yet mirrored.
// Until a handler is added to staticConvex.ts, these do not persist in
// offline/desktop mode. The runtime throws on these in dev so the gap is
// obvious; production warns instead of crashing. Implementing a handler (or
// covering it via the generic CRUD verbs) and removing the entry here is the
// path to closing each gap — the parity gate flags any entry that has since
// become handled so this list cannot rot.
export const STATIC_PENDING_WRITES: ReadonlySet<string> = new Set([
  "agm:init",
  "calendarSync:stageCalendarEvents",
  "agm:markStep",
  "aiChat:archiveThread",
  "aiChat:deleteThread",
  "aiChat:renameThread",
  "attestations:sign",
  "bylawAmendments:markFiled",
  "bylawAmendments:markResolutionPassed",
  "bylawAmendments:startConsultation",
  "bylawAmendments:withdraw",
  "bylawRules:resetToDefault",
  "committees:addMember",
  "conflicts:resolve",
  "customFields:clearValue",
  "customFields:deleteDefinition",
  "customFields:setValue",
  "documents:archive",
  "elections:addQuestion",
  "elections:castBallot",
  "elections:close",
  "elections:publishNominationToBallot",
  "elections:reviewNomination",
  "elections:snapshotEligibleVoters",
  "elections:submitNomination",
  "elections:tallyElection",
  "evidenceRegisters:promoteBoardRoleToDirector",
  "filings:markFiled",
  "goals:toggleMilestone",
  "grants:convertApplication",
  "grants:reviewApplication",
  "grants:submitApplication",
  "invitations:revoke",
  "meetingTemplates:duplicate",
  "members:merge",
  "motionBacklog:carryForwardToMeeting",
  "notifications:dismiss",
  "notifications:dismissAll",
  "notifications:markAllRead",
  "notifications:markRead",
  "notifications:snooze",
  "organizationHistory:bulkImport",
  "organizationHistory:extractBudgetSourceDetails",
  "organizationHistory:saveItem",
  "organizationHistory:saveSource",
  "proxies:revoke",
  "receipts:voidReceipt",
  "reconciliation:addManualTransaction",
  "reconciliation:markManual",
  "reconciliation:match",
  "reconciliation:unmatch",
  "society:clearDarkLogo",
  "society:clearLetterhead",
  "society:clearLogo",
  "society:setDarkLogo",
  "society:setLetterhead",
  "society:setLogo",
  "society:setLogoInvertInDarkMode",
  "transcripts:importVtt",
  "transcripts:saveText",
  "users:setRole",
  "views:addField",
  "views:deleteSharedDataTableView",
  "views:reorderFields",
  "volunteers:convertApplication",
  "volunteers:reviewApplication",
  "volunteers:submitApplication",
  "workflowPackages:markFiled",
  "workflows:addNode",
  "writtenResolutions:markFailed",
  "writtenResolutions:sign",
]);

// Verbs the generic CRUD fallback in staticConvex.ts handles by table convention.
export const STATIC_GENERIC_CRUD_PREFIX = /^(create|update|upsert|issue|setStatus|remove)/;

export function isStaticGenericCrud(name: string): boolean {
  const exportName = name.split(":")[1] ?? "";
  return STATIC_GENERIC_CRUD_PREFIX.test(exportName);
}
