# Legacy → portable migration audit

Audit date: 2026-07-15  
Scope: `src/**/*.{ts,tsx}` calls made through `useQuery`, `useMutation`, `usePaginatedQuery`, `useAction`, and direct `.query/.mutation/.action` calls whose first argument is `api.<module>.<function>`.

## Summary

| Measure | Count |
|---|---:|
| Hook/direct call expressions | 978 |
| Unique Convex functions called | 697 |
| Called functions in `PORTABLE_FUNCTIONS` | 631 |
| Called functions still served by a concrete legacy path | 41 |
| Called functions unserved locally (`[]` fallback or intentional `null` no-op) | 25 |
| Total migration backlog—not portable | 66 |
| Total entries in `PORTABLE_FUNCTIONS`, called or not | 797 |
| `usePaginatedQuery` call sites | 0 |

The three headline buckets are mutually exclusive: **631 portable + 41 legacy + 25 unserved = 697 called functions**.

“Legacy” means there is a concrete explicit or generic local result, not that it has hosted parity. Seven of those 41 are especially dangerous generic-fallback matches whose table or semantics are wrong:

1. `apiPlatform:createToken`
2. `apiPlatform:upsertWebhookSubscription`
3. `paperless:createBylawsHistoryImportSession`
4. `paperless:createDiscoveryImportSession`
5. `paperless:createMeetingMinutesImportSession`
6. `paperless:createTransposedImportSession`
7. `secrets:update`

No backlog function is handled by the store-level `StaticDemoDexieStore.mutationResult`; that method always returns `undefined`. Its store-level `queryResult` only handles `minutes:get`, which is not among the 66-function backlog. Actions in `StaticConvexClient.action()` are routed through the same top-level `mutationResult(...)` as mutations.

Legend:

- **Q explicit**: `mutableQueryResult → queryResult → named query case`.
- **Q missing**: `mutableQueryResult → QUERY_RESULT_NOT_MIRRORED → []`.
- **W explicit**: top-level `mutationResult → named dispatcher case`.
- **W generic**: top-level `mutationResult → generic CRUD fallback`.
- **W no-op**: `mutationResult → STATIC_OFFLINE_NOOP_WRITES → null`.
- **Shared handler?** means an exact portable handler already exists under `shared/functions/*.ts`, not merely that reusable constants or helpers exist.

## Migration backlog by domain

### AI agents and chat

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `aiAgents:getToolCatalog` | Q explicit: `queryCasesActivity1`; fixture tool catalog | `src/pages/AiAgents.tsx:77` | No | M |
| `aiAgents:listRuns` | Q explicit: `queryCasesInventoryHub2`; in-memory fixture runs | `src/pages/AiAgents.tsx:81` | No | M |
| `aiChatActions:runAgentLive` | W explicit: `mutCasesAiAgents3`; deterministic fake run | `src/pages/AiAgents.tsx:88` | No | L — LLM/tool capabilities |
| `aiChatActions:sendChatMessage` | W explicit: `mutCasesImportSessions2`; static reply | `src/features/ai/GlobalAiAssistant.tsx:110`; `src/pages/AiAgents.tsx:89` | No | L — LLM capability |
| `aiSettingsActions:listProviderModels` | W explicit: `mutCasesImportSessions2`; hard-coded catalog | `src/features/ai/GlobalAiAssistant.tsx:111`; `src/pages/AiAgents.tsx:91` | No | L — HTTP/provider capability |
| `aiSettingsActions:validateProviderKey` | W explicit: `mutCasesImportSessions2`; accepts any nonempty key | `src/pages/AiAgents.tsx:90` | No | L — HTTP/provider capability |

### API platform and webhooks

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `apiPlatform:createToken` | W generic; writes an `apiPlatform` row, not `apiTokens`—**shape-divergent** | `src/pages/ApiKeysPage.tsx:54` | No | M |
| `apiPlatform:listWebhookDeliveries` | Q missing → `[]` | `src/pages/Webhooks.tsx:35` | No | M |
| `apiPlatform:listWebhookSubscriptions` | Q missing → `[]` | `src/pages/Webhooks.tsx:31` | No | M |
| `apiPlatform:revokeToken` | W no-op → `null` | `src/pages/ApiKeysPage.tsx:55` | No | M |
| `apiPlatform:setWebhookSubscriptionStatus` | W no-op → `null` | `src/pages/Webhooks.tsx:40` | No | M |
| `apiPlatform:upsertWebhookSubscription` | W generic; writes an `apiPlatform` row, not `webhookSubscriptions`—**shape-divergent** | `src/pages/Webhooks.tsx:39` | No | M |

### Calendar feed

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `calendarFeed:getFeedToken` | Q explicit in `queryResult`; reads society field | `src/pages/CalendarSync.tsx:54` | No | S |
| `calendarFeed:setFeedToken` | W no-op → `null` | `src/pages/CalendarSync.tsx:53` | No | S for DB handler; feed serving needs HTTP capability |

### Communications

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `communications:ensureDefaultTemplates` | W no-op → `null` | `src/pages/Communications.tsx:255` | No | M |
| `communications:sendCampaign` | W no-op → `null` | `src/pages/Communications.tsx:260` | No | L — email/scheduler capability |
| `communications:sendMeetingNotice` | W no-op → `null` | `src/pages/AgmWorkflow.tsx:59` | No | L — email capability |

### Document versions and files

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `documentVersions:beginUpload` | W no-op → `null` | `src/components/DocumentVersions.tsx:32`; `src/pages/Documents.tsx:48` | No | L — storage capability |
| `documentVersions:createDemoVersion` | W explicit: `mutCasesAssets9`; delegates to uploaded-version mock | `src/components/DocumentVersions.tsx:31`; `src/pages/Documents.tsx:47` | No | M |
| `documentVersions:getDownloadTarget` | W explicit: `mutCasesAssets9`; demo/local attachment target | `src/components/DocumentVersions.tsx:35`; `src/pages/DocumentWorkbench.tsx:44`; `src/pages/Documents.tsx:463`; `src/pages/WorkflowDetail.internal.pdfFill.tsx:352` | No | L — storage capability |
| `documentVersions:recordUploadedVersion` | W explicit: `mutCasesAssets9`; flips current version and inserts metadata | `src/components/DocumentVersions.tsx:33`; `src/pages/Documents.tsx:49` | No | M |
| `files:generateLogoUploadUrl` | W no-op → `null` | `src/pages/Settings.tsx:45` | No | L — storage capability |
| `files:generateUploadUrl` | W no-op → `null` | `src/components/ImageUploadField.tsx:38`; `src/pages/MeetingDetail.tsx:191` | No | L — storage capability |

### Filing bot

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `filingBot:buildFilingPacket` | Q explicit: `queryCasesPaperless4`; filing fixture plus empty documents | `src/components/FilingBotRunner.tsx:28` | No | M |
| `filingBot:run` | W no-op → `null` | `src/components/FilingBotRunner.tsx:34` | No | L — network/storage automation |

### Financial integrations and Wave

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `financialHub:disconnect` | W no-op → `null` | `src/pages/Financials.tsx:85` | No | L — accounting provider capability |
| `financialHub:importBankCsvTransactions` | W explicit: `mutCasesAccounting4`; validates account and deduplicates rows | `src/pages/Financials.tsx:1028` | No | M |
| `financialHub:markConnectionConnected` | W no-op → `null` | `src/pages/Financials.tsx:84` | No | L — OAuth/accounting capability |
| `financialHub:oauthUrl` | Q explicit: `queryCasesAccounting5`; demo descriptor | `src/pages/Financials.tsx:80` | No | L — OAuth/accounting capability |
| `financialHub:sync` | W no-op → `null` | `src/features/financials/pages/WavePages.tsx:76,249`; `src/pages/Financials.tsx:86` | No | L — accounting/network capability |
| `waveCache:healthCheck` | W explicit: `mutCasesDocuments7`; fixture health result | `src/pages/Financials.tsx:88` | No | L — accounting/network capability |
| `waveCache:sync` | W explicit: `mutCasesDocuments7`; fixture cache summary | `src/features/financials/pages/WavePages.tsx:75`; `src/pages/Financials.tsx:87` | No | L — accounting/network capability |

### Firm document packets

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `firm:batchGeneratePacket` | W explicit: `mutCasesSociety1`; local packet-generation loop | `src/pages/Portfolio.tsx:44` | No | L — nontrivial document generation |

### Grant sources

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `grantSources:discoverFromSource` | W no-op → `null` | `src/pages/GrantSources.tsx:68` | No | L — HTTP/network capability |
| `grantSources:upsert` | W generic against `grantSources` | `src/features/grants/components/GrantSourceLibrary.tsx:30` | No | M |

### Minutes and notifications

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `minutes:generateDraft` | W no-op → `null` | `src/pages/MeetingDetail.tsx:170` | No | L — LLM capability |
| `notifications:sendDigest` | W no-op → `null` | `src/pages/Notifications.tsx:25` | No | L — email/scheduler capability |

### Paperless

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `paperless:connectionStatus` | Q explicit: `queryCasesAgendas3`; demo runtime descriptor | `src/pages/Paperless.tsx:15` | No | L — Paperless capability/status |
| `paperless:createBylawsHistoryImportSession` | W generic; writes a `paperless` row instead of an import session—**shape-divergent** | `src/pages/BylawsHistory.tsx:84` | No | L — Paperless + parsing/import semantics |
| `paperless:createDiscoveryImportSession` | W generic; wrong table/semantics—**shape-divergent** | `src/pages/ImportSessions.tsx:136` | No | L — Paperless + parsing/import semantics |
| `paperless:createMeetingMinutesImportSession` | W generic; wrong table/semantics—**shape-divergent** | `src/pages/ImportSessions.tsx:135` | No | L — Paperless + parsing/import semantics |
| `paperless:createTransposedImportSession` | W generic; wrong table/semantics—**shape-divergent** | `src/pages/ImportSessions.tsx:137` | No | L — Paperless + parsing/import semantics |
| `paperless:disconnect` | W no-op → `null` | `src/pages/Paperless.tsx:19` | No | M |
| `paperless:pullSourceDocument` | W no-op → `null` | `src/features/meetings/components/MeetingDetailSupport.tsx:262`; `src/pages/OrganizationHistory.tsx:1856` | No | L — Paperless + storage capabilities |
| `paperless:syncDocument` | W explicit: `mutCasesPaperless5`; successful demo task result, preempting the no-op ledger entry | `src/components/DocumentVersions.tsx:37`; `src/components/PaperlessDocumentAction.tsx:23`; `src/pages/Documents.tsx:50` | No | L — Paperless capability |
| `paperless:tagProfiles` | Q explicit: `queryCasesPaperless4`; static profiles | `src/pages/Paperless.tsx:17` | **Yes: `tagProfilesPortable`** | S |
| `paperless:testConnection` | W explicit: `mutCasesPaperless5`; always-success demo result | `src/pages/Paperless.tsx:20` | No | L — Paperless capability |
| `paperless:upsertConnection` | W explicit: `mutCasesDocuments7`; returns fixed connection id only | `src/pages/Paperless.tsx:18` | No | M |

### Permissions

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `permissions:myPermissions` | Q explicit: `queryCasesTransparency8`; local role mapping | `src/hooks/usePermissions.ts:16` | No; `shared/functions/access.ts` has reusable role primitives | S |

### Secrets

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `secrets:create` | W explicit: `mutCasesImportSessions2`; returns an id but does not persist a secret | `src/features/grants/pages/GrantWorkspacePage.tsx:46`; `src/pages/AiAgents.tsx:92`; `src/pages/Grants.tsx:134`; `src/pages/Secrets.tsx:61` | No | L — secure secret storage |
| `secrets:revealSecret` | W explicit: `mutCasesDocuments7`; fixed demo secret | `src/pages/Secrets.tsx:63` | No | L — secure secret storage |
| `secrets:update` | W generic; writes `secrets`, not `secretVaultItems`—**shape-divergent** | `src/pages/Secrets.tsx:62` | No | L — secure secret storage |

### Society/workspace lifecycle

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `society:createWorkspace` | W explicit: `mutCasesSociety1`; multi-table workspace/task/workflow/document seed | `src/pages/Society.tsx:55` | No | L — nontrivial multi-table semantics |
| `society:upsert` | W generic against `societies`; misses validation, uniqueness, metadata/user seeding | `src/pages/Privacy.tsx:95`; `src/pages/Society.tsx:243`; `src/pages/Transparency.tsx:53` | No | L — create path has nontrivial semantics |

### Subscriptions

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `subscriptions:beginCheckout` | W explicit: `mutCasesSubscriptions8`; demo URL without pending-subscription write | `src/pages/Membership.tsx:97` | No | L — billing capability |
| `subscriptions:simulateActivation` | W no-op → `null` | `src/pages/Membership.tsx:98` | No | M |

### Transcripts

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `transcripts:runPipeline` | W no-op → `null` | `src/pages/MeetingDetail.tsx:192` | No | L — transcription/storage capability |

### Users

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `users:remove` | W generic against `users`; skips auth and last-owner invariant | `src/pages/Users.tsx:27` | No | M |
| `users:upsert` | W generic against `users`; skips auth and first-user-owner rule | `src/pages/Users.tsx:25` | No | M |

### Workflows

| Function | Legacy path / local behavior | Callers | Shared handler? | Size |
|---|---|---|---|---|
| `workflows:create` | W generic against `workflows`; skips hosted validation/defaults | `src/pages/Workflows.tsx:127` | No | M |
| `workflows:get` | Q explicit: `queryCasesTransparency8`; fixture-only `byId`, not store-backed | `src/pages/WorkflowDetail.tsx:99` | No | S |
| `workflows:inspectPdfTemplate` | W no-op → `null` | `src/pages/WorkflowDetail.internal.pdfFill.tsx:75` | No | L — storage/PDF inspection |
| `workflows:listCatalog` | Q explicit: `queryCasesTransparency8`; static catalog | `src/pages/WorkflowDetail.tsx:101`; `src/pages/WorkflowRuns.tsx:69`; `src/pages/Workflows.tsx:125` | No | S |
| `workflows:listNodeTypes` | Q missing → `[]` | `src/pages/WorkflowDetail.tsx:102` | No; `NODE_TYPE_CATALOG` already exists in `shared/functions/workflows.ts` | S |
| `workflows:run` | W no-op → `null` | `src/pages/WorkflowDetail.tsx:111`; `src/pages/Workflows.tsx:132` | No | L — execution/network/AI capabilities |
| `workflows:setupGovernanceN8nRecipes` | W explicit: `mutCasesAiAgents3`; returns fake created names without persistence | `src/pages/Workflows.tsx:128` | No | M |

## `usePaginatedQuery` call sites

There are **no `usePaginatedQuery` call sites anywhere under `src/`**. The AST inventory and direct textual search both returned zero.

Therefore, `StaticConvexClient.watchPaginatedQuery()` is currently dormant for the app UI, but it remains a deletion blocker: any future paginated call would bypass `PortableRuntime` even when registered.

Before removing the legacy query path:

1. Route pagination through the portable registry.
2. Add a regression test that fails if a registered paginated function reaches `mutableQueryResult`.
3. Make an unregistered paginated query fail loudly rather than silently receiving legacy behavior.

## Seven semantically incorrect generic CRUD fallbacks

These functions technically have a concrete `mutationResult` path, so they are counted in the 41 “legacy” functions rather than the 25 “unserved” functions. They are nevertheless behaviorally unserved because the generic convention does not match their hosted semantics.

| Function | What the generic fallback does | Required behavior |
|---|---|---|
| `apiPlatform:createToken` | Uses module table `apiPlatform` | Insert an `apiTokens` row, enforce management authorization, preserve token status and metadata |
| `apiPlatform:upsertWebhookSubscription` | Uses module table `apiPlatform` | Query/update or insert `webhookSubscriptions`, handle secret/status fields and authorization |
| `paperless:createBylawsHistoryImportSession` | Inserts a generic `paperless` row from action arguments | Fetch/parse Paperless content and create a structured `importSessions` record plus candidate rows |
| `paperless:createDiscoveryImportSession` | Inserts a generic `paperless` row | Perform Paperless discovery and create the corresponding import session and records |
| `paperless:createMeetingMinutesImportSession` | Inserts a generic `paperless` row | Import and parse meeting-minutes content into the import-session model |
| `paperless:createTransposedImportSession` | Inserts a generic `paperless` row | Transform source records and persist the actual import session and candidate records |
| `secrets:update` | Uses table name `secrets` | Update the `secretVaultItems` domain with its security, access-control, encryption, and audit semantics |

These should be addressed before less dangerous fake-success handlers because callers currently receive success-shaped results while the intended data was not written.

## Server-only and capability-tier functions

These should not acquire local fake-success handlers. Their portable orchestration should call an injected capability and let unsupported runtimes throw structured `CAPABILITY_UNAVAILABLE`.

| Capability | Functions |
|---|---|
| `llm` / provider HTTP | `aiChatActions:sendChatMessage`, `aiChatActions:runAgentLive`, `aiSettingsActions:listProviderModels`, `aiSettingsActions:validateProviderKey`, `minutes:generateDraft` |
| `email` / `scheduler` | `communications:sendCampaign`, `communications:sendMeetingNotice`, `notifications:sendDigest` |
| `storage` | `documentVersions:beginUpload`, `documentVersions:getDownloadTarget`, `files:generateUploadUrl`, `files:generateLogoUploadUrl`, and storage portions of `paperless:pullSourceDocument`, `transcripts:runPipeline`, `workflows:inspectPdfTemplate`, and `filingBot:run` |
| `accounting` / provider HTTP / OAuth | `financialHub:oauthUrl`, `financialHub:markConnectionConnected`, `financialHub:disconnect`, `financialHub:sync`, `waveCache:sync`, `waveCache:healthCheck` |
| `paperless` / HTTP | `paperless:connectionStatus`, all four `paperless:create*ImportSession` actions, `paperless:pullSourceDocument`, `paperless:testConnection`, `paperless:syncDocument` |
| `billing` | `subscriptions:beginCheckout` |
| `transcription` | `transcripts:runPipeline` |
| generic `http` | `grantSources:discoverFromSource`, externally delivered portions of `filingBot:run`, and workflow execution that calls integrations |

`CapabilityKey` already names `accounting`, `billing`, `paperless`, `scheduler`, `http`, and `transcription`, but `PortableCapabilities` currently exposes callable surfaces only for email, SMS, storage, and LLM. Those missing interfaces and adapters must be added before the corresponding legacy/no-op paths can be deleted.

Calendar token get/set are portable database operations, but enabling an actually reachable calendar feed should be gated on an HTTP-serving capability.

## Recommended migration order

1. **Batch 0 — quick frontier cleanup (S).** Register existing `paperless:tagProfiles`; add small handlers for `permissions:myPermissions`, `calendarFeed:getFeedToken`, `calendarFeed:setFeedToken`, `workflows:get`, `workflows:listCatalog`, and `workflows:listNodeTypes`. This removes the only exact shared-but-unregistered handler and all trivial query gaps.

2. **Batch 1 — replace unsafe generic CRUD (M/L).** Port API tokens/webhook subscriptions, the four Paperless import-session entry points, `secrets:update`, `users:upsert/remove`, `society:upsert`, and `workflows:create`. Prioritize these because they currently appear to succeed while storing the wrong data or skipping invariants.

3. **Batch 2 — local-data semantics (M).** Port `aiAgents:getToolCatalog/listRuns`, webhook list/status/revoke, default communication templates, document-version metadata mutations, filing-packet aggregation, CSV import, grant-source upsert, Paperless connection CRUD, subscription activation, and workflow-recipe setup.

4. **Batch 3 — capability-backed storage and documents (L).** Port upload/download targets, filing-bot run, Paperless pull, transcript pipeline, PDF inspection, and firm packet generation. Unsupported runtimes should surface `CAPABILITY_UNAVAILABLE`, not `null` or fake success.

5. **Batch 4 — external services (L).** Port AI/provider APIs, outbound communications, accounting/Wave/OAuth, Paperless network calls, billing checkout, grant discovery, and workflow execution. Extend the capability contracts first, then port orchestration.

6. **Batch 5 — delete the escape hatches.** Make nonregistered calls fail loudly during development, remove `STATIC_OFFLINE_NOOP_WRITES` and generic CRUD dispatch, route `watchPaginatedQuery` through `PortableRuntime`, add conformance coverage for every called function, and finally delete the `mutableQueryResult`/`mutationResult` legacy dispatchers.

## Complete called-function inventory

Every unique function found in the 978 call expressions is listed below. `†` means it is one of the 66 functions not registered in `PORTABLE_FUNCTIONS`.

| Module | Called functions (`†` = not portable) |
|---|---|
| accounting | `backfillFinancialTransactionsToJournal`, `boardAuditorPackage`, `chartAccounts`, `closeFiscalPeriod`, `counterparties`, `createReconciliationRun`, `exportCsv`, `fiscalPeriods`, `fundRestrictions`, `journalEntries`, `postOpeningBalances`, `postTransactionCandidateAllocation`, `reopenFiscalPeriod`, `restrictedFundBalances`, `seedSocietyChartOfAccounts`, `setReconciliationRunStatus`, `trialBalance`, `upsertCounterparty`, `upsertFiscalPeriod`, `upsertFundRestriction`, `upsertJournalEntry` |
| activity | `list`, `listForRecord` |
| agendas | `create`, `get`, `getForMeeting`, `listForSociety`, `startMinutesFromAgenda`, `syncForMeeting` |
| agm | `init`, `markStep`, `noticeDeliveries`, `runForMeeting` |
| aiAgents | `approveToolDraft`, `getToolCatalog`†, `listAllSkills`, `listDefinitions`, `listRuns`†, `listSkills`, `listToolDrafts`, `rejectToolDraft`, `removeSkill`, `setSkillActive`, `upsertSkill` |
| aiChat | `archiveThread`, `deleteThread`, `listThreads`, `messagesForThread`, `renameThread` |
| aiChatActions | `runAgentLive`†, `sendChatMessage`† |
| aiSettings | `getEffective`, `upsert` |
| aiSettingsActions | `listProviderModels`†, `validateProviderKey`† |
| annualCycle | `summary` |
| annualFilings | `jurisdictions`, `list`, `remove`, `upsert` |
| apiPlatform | `createClient`, `createToken`†, `listClients`, `listPluginInstallations`, `listTokens`, `listWebhookDeliveries`†, `listWebhookSubscriptions`†, `revokeToken`†, `setWebhookSubscriptionStatus`†, `updateClient`, `upsertPluginInstallation`, `upsertWebhookSubscription`† |
| assets | `addConsumableStock`, `bundle`, `completeMaintenance`, `completeVerificationRun`, `create`, `dispose`, `linkReceiptLine`, `list`, `maintenance`, `recordEvent`, `remove`, `resolveScan`, `scheduleMaintenance`, `startVerificationRun`, `update`, `verificationItems`, `verificationRuns`, `verifyAsset` |
| attestations | `list`, `missingForYear`, `sign` |
| auditors | `create`, `list`, `remove`, `update` |
| bylawAmendments | `createDraft`, `list`, `markFiled`, `markResolutionPassed`, `materializeSections`, `remove`, `sectionsForAmendment`, `startConsultation`, `supersede`, `updateDraft`, `withdraw` |
| bylawRules | `getActive`, `getForDate`, `list`, `resetToDefault`, `upsertActive` |
| calendarFeed | `getFeedToken`†, `setFeedToken`† |
| calendarSync | `stageCalendarEvents` |
| commandMenuItems | `listForScope` |
| commitments | `create`, `eventsForSociety`, `list`, `recordEvent`, `remove`, `removeEvent`, `update` |
| committees | `addMember`, `create`, `detail`, `list`, `remove`, `removeMember`, `update` |
| communications | `ensureDefaultTemplates`†, `listCampaigns`, `listDeliveries`, `listMemberPrefs`, `listSegments`, `listTemplates`, `removeSegment`, `sendCampaign`†, `sendMeetingNotice`†, `upsertMemberPref`, `upsertSegment`, `upsertTemplate` |
| complianceObligations | `dismissDecision`, `listDecisions`, `markReviewed`, `reopenDecision` |
| conflicts | `create`, `forMeeting`, `list`, `remove`, `resolve` |
| constating | `create`, `list`, `narrative`, `remove` |
| courtOrders | `create`, `list`, `remove`, `update` |
| customFields | `clearValue`, `createDefinition`, `deleteDefinition`, `listDefinitions`, `listValues`, `setValue`, `updateDefinition` |
| dashboard | `navCounts`, `summary` |
| dashboardRemediation | `createComplianceReviewTask`, `createPrivacyReviewTask`, `markMemberDataAccessReviewed`, `markPrivacyProgramReviewed` |
| deadlines | `create`, `list`, `remove`, `setStatus`, `update` |
| directors | `create`, `list`, `remove`, `update` |
| dividends | `create`, `list`, `remove`, `summary` |
| documentComments | `create`, `listForDocument`, `remove`, `setStatus` |
| documentVersions | `beginUpload`†, `createDemoVersion`†, `getDownloadTarget`†, `latest`, `listForDocument`, `recordUploadedVersion`†, `rollback` |
| documents | `archive`, `create`, `createMemberDataGapMemoDraft`, `createPipaPolicyDraft`, `flagForDeletion`, `get`, `getMany`, `linkPrivacyPolicyEvidence`, `list`, `markOpened`, `remove`, `reviewQueues`, `updateDraftContent`, `updateReviewStatus` |
| elections | `addQuestion`, `castBallot`, `close`, `create`, `get`, `list`, `listMine`, `listNominations`, `publishNominationToBallot`, `reviewNomination`, `snapshotEligibleVoters`, `submitNomination`, `tally`, `tallyElection`, `updateSettings` |
| employees | `create`, `list`, `remove` |
| evidenceRegisters | `createManual`, `overview`, `promoteBoardRoleToDirector` |
| expenseReports | `list`, `remove`, `setStatus`, `upsert` |
| exports | `countTablePage`, `exportTablePage`, `listExportableTables`, `validateCurrentDatabase` |
| files | `generateLogoUploadUrl`†, `generateUploadUrl`†, `getUrl` |
| filingBot | `buildFilingPacket`†, `run`†, `runsForFiling` |
| filingExports | `craPreFill`, `societiesOnlinePreFill` |
| filings | `create`, `guidance`, `list`, `markFiled`, `remove`, `update` |
| financialHub | `accounts`, `connections`, `disconnect`†, `importBankCsvTransactions`†, `markConnectionConnected`†, `oauthUrl`†, `operatingSubscriptions`, `removeBudget`, `removeOperatingSubscription`, `summary`, `sync`†, `transactions`, `transactionsForAccountExternalId`, `transactionsForCategoryAccountExternalId`, `transactionsForCounterpartyExternalId`, `updateTransaction`, `upsertBudget`, `upsertOperatingSubscription` |
| financials | `detailByFiscalYear`, `list` |
| firm | `batchGeneratePacket`†, `overview`, `search` |
| fundingSources | `importStudentLevy`, `list`, `removeEvent`, `removeSource`, `rollup`, `upsertEvent`, `upsertSource` |
| goals | `create`, `get`, `list`, `remove`, `toggleMilestone`, `update` |
| grantSources | `addFromLibrary`, `candidates`, `createCandidate`, `discoverFromSource`†, `list`, `listWithLibrary`, `setCandidateStatus`, `upsert`† |
| grants | `applications`, `convertApplication`, `employeeLinks`, `get`, `list`, `removeEmployeeLink`, `removeGrant`, `removeReport`, `removeTransaction`, `reports`, `reviewApplication`, `submitApplication`, `summary`, `transactions`, `upsertEmployeeLink`, `upsertGrant`, `upsertReport`, `upsertTransaction` |
| importSessions | `applyApprovedDocuments`, `applyApprovedMeetings`, `applyApprovedSectionRecords`, `applyApprovedToOrgHistory`, `backfillApprovedMeetingReferences`, `bulkSetStatus`, `createFromBundle`, `get`, `list`, `removeSession`, `updateRecord` |
| inspections | `create`, `list`, `remove` |
| insurance | `create`, `list`, `remove`, `update` |
| inventoryHub | `addCountLine`, `backfillAssets`, `balances`, `candidates`, `connections`, `counts`, `createCount`, `deleteConnection`, `deleteItem`, `deleteLocation`, `deleteLot`, `importOpenBoxesSnapshot`, `items`, `linkReceipt`, `locations`, `lots`, `postCountVarianceAdjustments`, `postStockMovement`, `promoteCandidateToMovement`, `receiptLinks`, `setCandidateStatus`, `setCountLine`, `stockMovements`, `unlinkReceipt`, `upsertConnection`, `upsertItem`, `upsertLocation`, `upsertLot`, `voidCount` |
| invitations | `create`, `list`, `revoke` |
| legalOperations | `formationMaintenance`, `generateDocumentFromCatalog`, `listRoleHolders`, `removeAnnualMaintenanceRecord`, `removeFormationRecord`, `removeGeneratedLegalDocument`, `removeJurisdictionMetadata`, `removeLegalPrecedent`, `removeLegalTemplate`, `removeRightsClass`, `removeRightsholdingTransfer`, `removeRoleHolder`, `removeSupportLog`, `rightsLedger`, `seedCorporationDocumentPackets`, `seedStarterPolicyTemplates`, `stageCorporationDocumentPacket`, `stageShareIssuancePacket`, `stageShareSplitPacket`, `templateEngine`, `upsertAnnualMaintenanceRecord`, `upsertEntityAmendment`, `upsertFormationRecord`, `upsertGeneratedLegalDocument`, `upsertJurisdictionMetadata`, `upsertLegalPrecedent`, `upsertLegalPrecedentRun`, `upsertLegalSigner`, `upsertLegalTemplate`, `upsertNameSearchItem`, `upsertRightsClass`, `upsertRightsholdingTransfer`, `upsertRoleHolder`, `upsertSupportLog`, `upsertTemplateDataField`, `votingPower` |
| library | `overview` |
| meetingMaterials | `attach`, `packageForMeeting`, `remove` |
| meetingTemplates | `create`, `createFromMeeting`, `duplicate`, `list`, `remove`, `seedDefaults`, `update` |
| meetings | `applyTemplate`, `backfillQuorumSnapshot`, `create`, `get`, `list`, `markSourceReview`, `remove`, `setPackageReviewStatus`, `update` |
| memberProposals | `create`, `list`, `remove`, `update` |
| members | `create`, `get`, `list`, `merge`, `update` |
| minuteBook | `overview`, `remove`, `upsert` |
| minutes | `backfillQuorumSnapshot`, `create`, `generateDraft`†, `getByMeeting`, `list`, `update` |
| motionBacklog | `addToAgenda`, `carryForwardToMeeting`, `create`, `createFromMinutesMotion`, `createFromMinutesSection`, `list`, `remove`, `seedPipaSetup`, `seedToMinutes`, `suggestForMeeting` |
| motionTemplates | `create`, `list`, `remove`, `seedDefaults`, `update` |
| motions | `list`, `listForMeeting`, `listForMinutes`, `setTags`, `update` |
| nameHistory | `list`, `narrative`, `remove`, `upsert` |
| notes | `create`, `listForRecord`, `remove`, `update` |
| notifications | `dismiss`, `dismissAll`, `list`, `markAllRead`, `markRead`, `remove`, `removeAllDismissed`, `sendDigest`†, `snooze`, `unreadCount` |
| objectMetadata | `getFullTableSetup` |
| orgChartAssignments | `list`, `listAsOf`, `remove`, `upsert` |
| organizationDetails | `backfillFromExistingRecords`, `overview`, `removeAddress`, `removeIdentifier`, `removeRegistration`, `seedFromSocietyAddresses`, `upsertAddress`, `upsertIdentifier`, `upsertRegistration` |
| organizationHistory | `bulkImport`, `extractBudgetSourceDetails`, `list`, `removeItem`, `removeSource`, `saveItem`, `saveSource` |
| paperless | `connectionStatus`†, `createBylawsHistoryImportSession`†, `createDiscoveryImportSession`†, `createMeetingMinutesImportSession`†, `createTransposedImportSession`†, `disconnect`†, `listConnection`, `pullSourceDocument`†, `recentSyncs`, `syncDocument`†, `syncForDocument`, `tagProfiles`†, `testConnection`†, `upsertConnection`† |
| partyPortals | `center`, `create`, `list`, `revoke` |
| pendingEmails | `cancel`, `create`, `list`, `markSent`, `remove`, `update` |
| peopleDirectory | `addToSociety`, `duplicates`, `list`, `searchByPrefix`, `upsert` |
| permissions | `myPermissions`† |
| pipaTraining | `create`, `list`, `remove`, `update` |
| policies | `adoptionOptions`, `createRequiredSignerTask`, `createReviewTask`, `createTransparencyDraft`, `list`, `remove`, `upsert` |
| postIncorporation | `checklist` |
| programStatements | `create`, `list`, `remove`, `update` |
| proxies | `create`, `forMeeting`, `list`, `remove`, `revoke`, `update` |
| publicPortal | `grantIntakeContext`, `volunteerIntakeContext` |
| receipts | `issue`, `list`, `voidReceipt` |
| reconciliation | `addManualTransaction`, `markManual`, `match`, `overview`, `unmatch` |
| recordLayouts | `get`, `remove`, `upsert` |
| registerHistory | `roleHoldersAsOfDate`, `significantIndividualsAsOf` |
| retention | `expiredForSociety` |
| roleHolderHistory | `changesBetween`, `revisionHistory` |
| secrets | `create`†, `list`, `remove`, `revealSecret`†, `update`† |
| seedRecordTableMetadata | `ensureForSociety` |
| serviceProviders | `functionsCatalog`, `list`, `upsert` |
| shareCertificates | `create`, `list`, `register`, `remove`, `update` |
| signatures | `deleteProfile`, `listForEntity`, `listProfilesForSociety`, `revoke`, `sign` |
| significantIndividualSteps | `create`, `list`, `remove`, `reviewsDue` |
| society | `clearDarkLogo`, `clearLetterhead`, `clearLogo`, `cloneSociety`, `createWorkspace`†, `list`, `setDarkLogo`, `setLetterhead`, `setLogo`, `setLogoInvertInDarkMode`, `updateComplianceSettings`, `updateInventorySettings`, `updateModules`, `updateNotificationSettings`, `upsert`† |
| subscriptions | `allSubscriptions`, `beginCheckout`†, `cancelSubscription`, `feeTimeline`, `plans`, `removeFeePeriod`, `removePlan`, `simulateActivation`†, `upsertFeePeriod`, `upsertPlan` |
| tasks | `create`, `list`, `remove`, `update` |
| transcripts | `getByMeeting`, `importVtt`, `jobForMeeting`, `runPipeline`†, `saveText` |
| transparency | `listPublications`, `publicCenter`, `removePublication`, `upsertPublication` |
| treasury | `budgetVariance`, `profitAndLoss`, `restrictedFunds` |
| users | `get`, `list`, `remove`†, `resolveAuthSession`, `setRole`, `upsert`† |
| views | `addField`, `create`, `createSharedDataTableView`, `deleteSharedDataTableView`, `listSharedForDataTable`, `reorderFields`, `seedGovernanceDataTableViews`, `update`, `updateField` |
| volunteers | `applications`, `convertApplication`, `list`, `removeScreening`, `removeVolunteer`, `reviewApplication`, `screenings`, `submitApplication`, `summary`, `upsertScreening`, `upsertVolunteer` |
| waveCache | `healthCheck`†, `resource`, `resourceByExternalId`, `resources`, `structures`, `summary`, `sync`† |
| workflowPackages | `createBoardPack`, `createFollowUpTask`, `list`, `markFiled`, `remove`, `upsert` |
| workflows | `addNode`, `create`†, `get`†, `inspectPdfTemplate`†, `list`, `listCatalog`†, `listNodeTypes`†, `listRuns`, `remove`, `removeNode`, `run`†, `runsForWorkflow`, `setStatus`, `setupGovernanceN8nRecipes`†, `update`, `updateNodeConfig` |
| writtenResolutions | `create`, `list`, `markFailed`, `remove`, `sign` |
| yearEnd | `annualStatement`, `orgRevenueExpense`, `readiness`, `restrictedFundStatement` |