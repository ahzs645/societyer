# Browser-backed connectors

Societyer can run browser-backed connector actions through an optional Docker
stack:

- `blitzbrowser`: owns Chrome processes, live view, and persistent browser user
  data.
- `blitzbrowser-dashboard`: shows currently running browsers and live view.
- `connector-runner`: Societyer-owned API that starts login sessions and runs
  Playwright actions against the persisted browser profile.

Start the optional stack:

```bash
npm run docker:connectors
```

Check health:

```bash
curl http://127.0.0.1:8890/healthz
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

This keeps the Plugin connections page provider-neutral while allowing
provider-specific panels, such as the Wave transaction import controls, to stay
available when that connector is selected.

## BC Registry filing-history utility

`bc-registry` is a generic browser profile connector for BC Registry filing
history exports. It starts at `https://www.bcregistry.ca/societies/` and saves a
persistent profile without a custom login verifier.

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

After the user navigates to the target society filing history, save the profile:

```bash
curl -X POST http://127.0.0.1:8890/connectors/bc-registry/auth/sessions/<sessionId>/confirm \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{}'
```

The filing export itself is best implemented as a Chrome extension/content
script on `https://www.bcregistry.ca/societies/*/filingHistory`:

- Wait for the DataTables instance to initialize.
- Read every row from `$('#filings-table').DataTable().rows().nodes()` rather
  than clicking through pagination.
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

The runner currently supports the `blitz` backend. The code is structured
around a `BrowserBackend` interface so Steel Browser can be added later without
rewriting connector actions.
