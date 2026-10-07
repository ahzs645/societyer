# WP-F: finance, operations and admin

Implements the `ui-operations` audit findings (H1–H3, M1–M12, L1–L23) and
schema finding B7, except the items owned by WP-A (record-table filter
popover H2, global search and palette gaps M7/M8, pluralisation L6, touch
targets L10, save-as-view prompt L12, dark banner contrast L20,
notifications dialog role L22, French i18n M10).

## What was built

### Shared pieces other work packages can reuse

| Piece | Purpose |
| --- | --- |
| `shared/recordValidation.ts` | Field-keyed validators (`validateGrantInput`, `validateInsurancePolicyInput`, `validateDocumentInput`, `validateWorkspaceUserInput`, `validateOutboxEmailInput`, `validateFiscalPeriodInput`, `validateBudgetLineInput`, `validateAsset*Input`, `validateAccessCustodyInput`, `validateCounterpartyInput`) plus `assertValid` / `hasErrors`. Forms show the messages inline through `Field error=`; portable handlers call `assertValid` so every runtime rejects the same input. |
| `src/components/RecordNotFound.tsx` | Not-found page for `/app/<area>/:id` routes: keeps an `h1`, a `role=status` explanation and a link back to the list. |
| `src/hooks/useRecordQuery.ts` | `useQuery` for detail pages: `undefined` loading, `null` missing, record otherwise. Hosted Convex "not found" query errors become `null`; other errors still reach the error boundary. |
| `src/lib/detailRecordQueries.ts` | Allowlist of detail queries whose "Record not found." rejection resolves to `null` in the local query cache (`src/lib/portableQueryCache.ts`). Add a query name here when giving another detail page a not-found state. |
| `shared/functions/recordLookup.ts` | `findOwnedRow` returns `null` for missing, wrong-table and foreign rows (used by `grants:get`). |
| `shared/accountingBackfill.ts` | Pure planner for posting imported bank transactions to the journal. |

### Findings

| ID | Status | Notes |
| --- | --- | --- |
| H1 | Done | Grant trash icon opens `GrantRemoveDialog`: lists reports, ledger entries (with total), journal lines, restricted funds, linked applications and employee links. Archive is the default (`grants:setArchived`, new optional `archivedAtISO` / `archivedReason`); archived grants leave the pipeline and its counts but keep all history, with a "Show N archived" toggle. `grants:removeGrant` refuses server-side while grant transactions, journal lines or fund restrictions reference the grant; otherwise it deletes the grant, its reports and employee links and unlinks applications. `grants:deletionImpact` feeds the dialog. |
| H3 | Done | "Backfill imports" opens a review drawer (`accounting:backfillPreview`) with per-category account choice, a before-opening toggle and a per-row status list. Unmapped rows post to an explicit `2999 Suspense - unmapped imports` liability account (created on first use). Rows dated on or before the opening-balance entry are skipped by default; when included they are flagged (`journalEntries.reviewFlags: ["before_opening_balance"]`, memo prefix). Category choices can be saved as account mappings. Gate: `npm run test:accounting-backfill` reproduces the $76,980 → $78,535 drift on the demo seed and proves the default path ends at $72,405 (= $76,980 + only the 2026 activity). |
| M1 | Done | Grants (view and edit), assets, inventory verification runs, documents, workflows, Wave accounts and Wave records, insurance policies render `RecordNotFound`. Verified in the browser for all eight routes listed in the audit. |
| M2 | Done | In-app `useConfirm` naming the record for: grant ledger entries and reports, application decline (reason required, not offered after conversion; server refuses it too), budget lines, program budgets, insurance policies, funding sources and events, expense reports, workflows, access-custody records, assets (replaces `window.confirm`). Asset "Dispose" requires a reason and disappears once disposed. |
| M3 | Done | Server + inline validation for grants (title, funder, fit 0–100, non-negative money, date order), grant ledger entries and reports, insurance (type, insurer, policy number, dates, non-negative money; blank fields are no longer filled with "Needs review"), documents (title; an attached file names an untitled document), users (name, email format, case-insensitive uniqueness), outbox (valid addresses; drafts may be incomplete but not empty; ready/sent emails need recipient, subject and body; "Mark sent" refuses incomplete emails), workflow and package names (client). |
| M4 | Done | Reconciliation row click selects the transaction for the match panel (view forced to `openRecordIn: "page"` on that page only) and every row has a "Match" button. |
| M5 | Done | Fiscal periods: year and label required, valid dates, start ≤ end, no overlap with non-archived periods (server and inline). |
| M6 | Done | Budget lines: inline errors for empty/negative/duplicate (same fiscal year + category + program code), edit action, confirm on delete, `aria-label` uses the category. |
| M9 | Done (feedback) | "Open file" now says when no stored file can be found instead of doing nothing; `openDocumentDownloadTarget` returns whether it opened anything. The demo legacy URL path itself was not changed. |
| M11 | Done | Users roster renders as labelled cards below 760 px. |
| M12 | Done (labels) | Each restricted-funds figure states its basis: restricted bank accounts (Financials), fund-restriction ledger lines (Accounting), the year's statements (annual statement). The seed data itself was not reconciled. |
| L1 | Done | Counterparty email validated. |
| L2 | Done | Ledger reconciliation requires an account and a statement balance before calling the server. |
| L3 | Done | Seed bylaws PDF records decoded bytes, so a pristine demo backup is complete. |
| L4 | Done | Restore preflights the file (ZIP signature or JSON object) before the "replace everything" confirmation, in Settings and Data export. |
| L5 | Done | Webhooks "API docs" is a disabled button with an explanation in a local workspace. |
| L7 | Done | Enter sends (Shift+Enter newline) in the assistant and AI agents chat; thread messages sort by time with the question first, and the demo reply is stamped 1 ms after the question. |
| L8 | Done | Local provider-key checks report "Simulated validation". |
| L9 | Partly | "Act as" in the demo says it resets on reload. Favourites/locale persistence belongs to WP-A's shell work. |
| L11 | Done | Statements card formats amounts with `Intl` currency formatting. |
| L13 | Done | Custody (custodian for checkout/transfer, location for check-in), maintenance (title, type, due date) and disposal validated server-side and inline; custody changes on disposed assets are refused. |
| L14 | Done | Org-history budget snapshots warn when header income/expense totals differ from their line groups. |
| L15 | Done | Interface manifest opens `financials/fy/2025-2026`; empty fiscal-year pages link to the years that exist. |
| L16 | Done | Physical inventory run not-found has an `h1` (RecordNotFound). |
| L17 | Done | Membership audit entries store the actor's name; the audit log also resolves old raw user ids to names. |
| L18 | Done | Viewers see "View task" labels. |
| L19 | Done | Calendar sync explains why pasted text produced no events; the staging toast mentions the extra calendar source record (2 events → 3 candidates is expected). |
| L21 | Done | Access-custody records persist in the local runtime (they returned a fake id before), validate required fields and emails, refuse plaintext secret values locally (server encryption needed), and confirm deletes. |
| L23 | Done | "Run now" explains why it is disabled; pause/resume toast. |
| B7 | Done | Fiscal-year page "Approval and presentation" card: board approval date, presented-at meeting picker (members' meetings after year end first), statements document picker. `financials:update` accepts `statementsDocId` (ownership-checked) and a `clear` list for the link fields. |

## Decisions and assumptions

- **Archive over delete.** A grant with any ledger history can only be
  archived. Reports and employee links are workflow data owned by the grant
  and are deleted with it when deletion is allowed.
- **Suspense is a liability.** Following common practice, unmapped imports
  go to a balance-sheet suspense account, so the income statement is not
  distorted until someone reclassifies them. Rows on the opening-balance date
  itself count as "before opening" because opening balances are stated as of
  that day.
- **Validation scope.** Updates validate only the fields they change
  (`partial`), so legacy imported rows (for example policies without a
  policy number) can still be edited field by field. Creates validate the
  whole record.
- **Email format** is deliberately permissive (`name@host`, single-label
  hosts allowed) because local workspaces use addresses such as
  `owner@local`.
- **Budget duplicates** are keyed by fiscal year + category + program code,
  so per-program budget lines for the same account stay possible.
- **Detail not-found mapping** is opt-in per query name. Background queries
  keep the existing undefined-on-failure behaviour to avoid render loops.
- **Hosted Convex** may redact server error messages in production; in that
  case `useRecordQuery` rethrows and the route error boundary shows instead
  of the not-found page (no regression from before).

## Gates

- `npm run test:record-validation` (new) — every server rule above against
  the demo seed through the portable handlers, plus the grant archive/delete
  guard and B7 updates.
- `npm run test:accounting-backfill` (new) — planner unit cases and the
  demo-seed drift reproduction.
- Re-run and passing: `test:authorization-policy`, `test:static-parity`,
  `test:permissioned-mutation`, `test:workspace-access`,
  `test:insurance-history`, `test:accounting-core`,
  `test:accounting-program-tracking`, `test:accounting-statements`,
  `test:portable-manifest`, `test:portable-query-cache`,
  `test:portable-runtime`, `test:ai-demo-chat`, `npx tsc -b`,
  `npm run convex:typecheck`, `npm run lint` (0 errors).
- `test:interface-route-coverage` fails on `main` already for
  `/app/people-directory/:id`, `/app/people-history` and
  `/app/source-model-coverage` (routes added without manifest entries; not
  touched here).

## For other work packages

- New Convex functions: `grants:deletionImpact` (query), `grants:setArchived`
  (mutation), `accounting:backfillPreview` (query). The backfill mutation has
  new optional args (`categoryChoices`, `includeBeforeOpening`, `useSuspense`,
  `transactionIds`, `rememberMappings`). `financials:update` has `clear`.
- Schema additions (all optional): `grants.archivedAtISO`,
  `grants.archivedReason`, `journalEntries.reviewFlags`.
- `shared/functions/portable-manifest.json` was regenerated; expect a
  conflict at merge and regenerate with `node scripts/portable-manifest.mjs`.
- `src/styles/_views-operations.scss` is a new partial used by index.scss.
