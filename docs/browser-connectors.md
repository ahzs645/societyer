# Browser-backed connectors

Societyer can run browser-backed connector actions through an optional Docker
stack:

- `blitzbrowser`: owns Chrome processes, live view, and persistent browser user
  data.
- `blitzbrowser-dashboard`: shows currently running browsers and live view.
- `connector-runner`: Societyer-owned API that starts login sessions and runs
  Playwright actions against the persisted browser profile.

AI agents working in this repo should use the plugin skill at
`plugins/societyer-document-intake/skills/societyer-browser-connectors/SKILL.md`
before operating live browser sessions. The skill contains the safe workflow,
credential rules, and command cookbook.

Start the optional stack:

```bash
npm run docker:connectors
```

Check health:

```bash
curl -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  http://127.0.0.1:8890/healthz
```

Authenticated runner calls require `CONNECTOR_RUNNER_SECRET`:

```bash
curl -X POST http://127.0.0.1:8890/sessions/start-login \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "local-demo-bc-registry",
    "startUrl": "https://www.bcregistry.ca/",
    "liveView": true
  }'
```

Open the BlitzBrowser dashboard at `http://127.0.0.1:3003` to interact with
the live browser. When login is complete, finish the session so BlitzBrowser
can save the profile:

```bash
curl -X POST http://127.0.0.1:8890/sessions/<sessionId>/finish-login \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET"
```

Run a simple profile-backed page open:

```bash
curl -X POST http://127.0.0.1:8890/runs/open-page \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "local-demo-bc-registry",
    "url": "https://www.bcregistry.ca/",
    "readOnly": true,
    "includeBodyText": true
  }'
```

## Browser utility manifests

Named connectors are the source of truth for browser utility profile defaults:

- `auth.startUrl` controls the first live-browser page.
- `auth.allowedOrigins` documents where the profile is expected to be used.
- `auth.profileKeyPrefix` produces the default local profile key.
- `auth.confirmMode` is either `verified` for connectors with a custom login
  verifier or `profile` for generic browser utilities where saving the current
  browser profile is enough.
- `actions` describe the utility work available for that profile. They can
  point at built-in runner actions, a page content script, or a Chrome
  extension workflow.

This keeps the Browser apps page provider-neutral while allowing
provider-specific panels, such as the Wave transaction import controls, to stay
available when that connector is selected.

## BC Registry filing-history utility

`bc-registry` is a browser utility connector for BC Registry filing-history
exports. It starts at `https://www.bcregistry.ca/societies/`. In testing, BCeID
cookies did not reliably survive closing and reopening the saved profile, so run
the filing export while the live browser session is still authenticated.

Start a BC Registry browser session:

```bash
curl -X POST http://127.0.0.1:8890/connectors/bc-registry/auth/start \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "bc-registry-local-demo",
    "liveView": true
  }'
```

After the user signs in, run the filing-history export against the live session:

```bash
curl -X POST http://127.0.0.1:8890/connectors/bc-registry/auth/sessions/<sessionId>/actions/filingHistoryExport \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "corpNum": "S0048345",
    "includePdfProbe": true,
    "downloadPdfs": true
  }'
```

The action navigates to `/societies/<corpNum>/filingHistory`, extracts the full
DataTables filing history, returns `filings`, `documents`, `csv`, `csvFilename`,
`resultLog`, and can verify one sample PDF endpoint with `includePdfProbe`.
Rows that only have paper records stay in the CSV with `Paper Only` set to
`true`. With `downloadPdfs: true`, it fetches PDFs inside the authenticated
browser context and writes the CSV plus PDFs to
`browser-connector-exports/<corp>-<timestamp>/`, including per-document success
or error details in the download result.

Societyer can then fill missing Society governance document links from that
export:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/browser-connectors/governance-documents/import \
  -H "content-type: application/json" \
  -d '{
    "societyId": "<societyId>",
    "corpNum": "S0048345"
  }'
```

The import first reuses the latest local
`browser-connector-exports/<corp>-<timestamp>/` export. If no export exists, or
`refresh: true` is supplied, it looks for an active `bc-registry` browser
session and runs `filingHistoryExport` before importing.

Governance matching rules:

- Constitution: prefer a standalone `Constitution` document.
- Bylaws: prefer the newest `Bylaws` document in the filing-history order.
- Combined constitution/bylaws: if no standalone constitution exists but a
  bylaws PDF exists, import that PDF as `constitutionAndBylaws` so the same
  document can satisfy both missing links.
- PIPA policy: leave missing unless the filing history actually contains a
  privacy/PIPA document. BC Registry filing history usually does not.

The same export can be transposed into `/app/filings` as registry filing
records:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/browser-connectors/filing-history/import \
  -H "content-type: application/json" \
  -d '{
    "societyId": "<societyId>",
    "corpNum": "S0048345",
    "importDocuments": true
  }'
```

Filing import behavior:

- Creates or updates one `RegistryRecord` row per BC Registry filing-history
  event, including paper-only rows.
- Uses `Date Filed` as `filedAt`; annual-report due dates are inferred as AGM
  date plus 30 days when the AGM date is present.
- Leaves `feePaidCents` and `confirmationNumber` blank until receipt parsing is
  added.
- Imports each downloaded PDF as a document, merges provenance for reused PDFs,
  and links the filing to its source document IDs.
- Stores source event IDs, document URLs, and the original CSV rows in
  `sourceExternalIds` / `sourcePayloadJson` for re-runs and review.

Save or stop the browser after export:

```bash
curl -X POST http://127.0.0.1:8890/connectors/bc-registry/auth/sessions/<sessionId>/confirm \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{}'
```

For a Chrome extension/content script on
`https://www.bcregistry.ca/societies/*/filingHistory`, use the same extraction
strategy:

- Wait for the DataTables instance to initialize.
- Iterate DataTables pages with `page.info().pages` and
  `page(index).draw("page")`; the current BC Registry table only exposes the
  current page's row nodes.
- Extract each document link and build a queue of PDF URLs.
- Generate the filing-history CSV before starting downloads.
- Download PDFs sequentially with `fetch(url, { credentials: "include" })`,
  a blob URL, and a short delay between files.
- Confirm each response is `application/pdf`; treat redirects or HTML responses
  as session-expired failures.

## Wave connector

Wave is the first named connector on top of the generic browser runner. The
connector starts at `https://next.waveapps.com/`, lets the user log in through
BlitzBrowser live view, and saves the browser profile when the user finishes the
session.

Start Wave auth:

```bash
curl -X POST http://127.0.0.1:8890/connectors/wave/auth/start \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "wave-local-demo",
    "liveView": true
  }'
```

Verify whether the saved profile still looks logged in:

```bash
curl -X POST http://127.0.0.1:8890/connectors/wave/auth/verify \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{ "profileKey": "wave-local-demo" }'
```

Confirm an active Wave login session and save it for pipeline runs. If the
connector verifier does not see a completed Wave login, the session stays open
and the response asks the user to keep signing in:

```bash
curl -X POST http://127.0.0.1:8890/connectors/wave/auth/sessions/<sessionId>/confirm \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{}'
```

Preview Wave transactions after auth is complete:

```bash
curl -X POST http://127.0.0.1:8890/connectors/wave/actions/listTransactions \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "wave-local-demo",
    "businessId": "QnVzaW5lc3M6...",
    "startDate": "2026-01-01",
    "endDate": "2026-04-30",
    "first": 100,
    "sort": "DATE_DESC"
  }'
```

Import Wave transactions into Societyer after a live browser login:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/browser-connectors/connectors/wave/auth/sessions/<sessionId>/import-transactions \
  -H "content-type: application/json" \
  -d '{
    "societyId": "<societyId>",
    "first": 100,
    "maxPages": 500,
    "sort": "DATE_DESC"
  }'
```

When dates are omitted, the connector asks Wave for every transaction the active
business returns. The connector response includes raw Wave rows for diagnostics
and a normalized `accounts` / `transactions` payload. The API gateway stores the
normalized data in `financialAccounts` and `financialTransactions`, preserving
existing account balances when the browser payload does not include balances.

The Wave action captures the short-lived Wave GraphQL bearer token only inside
the connector-runner process while the action is running. The token is not
stored, logged, or returned to Societyer.

### Wave transaction categories

Wave chart-of-accounts rows can also act as transaction category labels. For
example, an account resource such as `Professional Fees` or
`Dues & Subscriptions` is an `Accounts` resource in the cache, but transactions
can point to it as their category.

The browser import stores that relationship as
`financialTransactions.categoryAccountExternalId`. UI and Convex queries should
prefer this exact Wave account id when linking category rows to transactions.
Name matching is only a legacy fallback for older imported transactions that do
not have `categoryAccountExternalId`; otherwise duplicate account names such as
`Accounts Payable` can incorrectly inherit each other's transaction totals.

The financial UI splits Wave `account` resources into account views:

- **Money accounts**: bank, cash, credit card, and money-in-transit accounts.
- **Categories**: reusable income, expense, liability, equity, tax, payroll, and
  other chart-of-account categories.
- **Working set**: money accounts plus categories.
- **Ledger/system**: zero-balance payable and transfer-clearing rows generated
  by Wave internals.
- **Raw accounts**: every cached Wave account row.

The default account table opens on Money accounts. The noisy `PAYABLE_BILLS`
and `TRANSFERS` rows, such as hundreds of single-use `Accounts Payable` rows,
stay available under Ledger/system or Raw accounts but are hidden from default
working views.

Useful verification commands:

```bash
npx convex run waveCache:resources \
  '{"societyId":"<societyId>","resourceType":"account","search":"Dues & Subscriptions","limit":5}'
```

```bash
npx convex run financialHub:transactionsForCategoryAccountExternalId \
  '{"societyId":"<societyId>","externalId":"<waveAccountExternalId>","label":"Dues & Subscriptions","limit":5}'
```

If a Wave account row has a chart-of-accounts balance but zero linked
transactions, it means the browser transaction pull did not return rows
categorized to that exact account id in the imported set. That can happen even
when Wave shows a balance on the account resource.

## Live browser troubleshooting

Inspect active sessions:

```bash
curl -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  http://127.0.0.1:8890/sessions
```

If the embedded live browser is blank or white:

- compare with the direct Blitz dashboard at `http://127.0.0.1:3003`;
- confirm the session `currentUrl` is the expected app page;
- start a fresh session if the foreground tab is stale;
- do not force remote Chromium fullscreen as a fix.

Remote fullscreen previously made Blitz live view paint white for otherwise
healthy sessions. If the embedded view needs less surrounding chrome, use a
client-side crop or layout treatment instead of changing the remote browser
window state.

The runner currently supports the `blitz` backend. The code is structured
around a `BrowserBackend` interface so Steel Browser can be added later without
rewriting connector actions.
