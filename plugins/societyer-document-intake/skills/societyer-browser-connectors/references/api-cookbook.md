# Societyer Browser Connector API Cookbook

Use these commands from the Societyer repo root unless a task gives a different workspace.

## Ports

- Societyer app/API proxy: `http://127.0.0.1:8787/api/v1/browser-connectors`
- Connector runner: `http://127.0.0.1:8890`
- BlitzBrowser dashboard: `http://127.0.0.1:3003`

## Health and Session Inspection

```bash
curl -sS \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  http://127.0.0.1:8890/healthz
```

```bash
curl -sS \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  http://127.0.0.1:8890/sessions
```

Expected healthy shape:

```json
{
  "ok": true,
  "runner": "connector-runner",
  "browser": { "ok": true, "provider": "blitz" },
  "activeSessions": 1
}
```

## Start a Wave Live Session

```bash
curl -sS -X POST http://127.0.0.1:8890/connectors/wave/auth/start \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "wave-local-demo",
    "liveView": true,
    "timezone": "America/Vancouver"
  }'
```

The response includes `sessionId`, `currentUrl`, `dashboardUrl`, and `vncWebSocketUrl`. Tell the user to finish login in live view. Do not ask for credentials.

## Verify or Confirm Wave Login

Check a saved profile:

```bash
curl -sS -X POST http://127.0.0.1:8890/connectors/wave/auth/verify \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{ "profileKey": "wave-local-demo" }'
```

Confirm an active login session:

```bash
curl -sS -X POST http://127.0.0.1:8890/connectors/wave/auth/sessions/<sessionId>/confirm \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{}'
```

## Import Wave Transactions

Use the Societyer app proxy when importing into Societyer records:

```bash
curl -sS -X POST \
  http://127.0.0.1:8787/api/v1/browser-connectors/connectors/wave/auth/sessions/<sessionId>/import-transactions \
  -H "content-type: application/json" \
  -d '{
    "societyId": "<societyId>",
    "profileKey": "wave-local-demo",
    "first": 100,
    "maxPages": 500,
    "sort": "DATE_DESC"
  }'
```

Useful success fields:

- `pageCount`
- `transactionCount`
- `import.accounts`
- `import.importedAccounts`
- `import.transactions`
- `import.skippedTransactions`

## Preview Wave Transactions Without Importing

```bash
curl -sS -X POST http://127.0.0.1:8890/connectors/wave/actions/listTransactions \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "wave-local-demo",
    "first": 100,
    "maxPages": 2,
    "sort": "DATE_DESC"
  }'
```

## Verify Category Account Links

Check a category account resource:

```bash
npx convex run waveCache:resources \
  '{"societyId":"<societyId>","resourceType":"account","search":"Dues & Subscriptions","limit":5}'
```

Check linked transactions by exact category account id:

```bash
npx convex run financialHub:transactionsForCategoryAccountExternalId \
  '{"societyId":"<societyId>","externalId":"<waveAccountExternalId>","label":"Dues & Subscriptions","limit":5}'
```

Interpretation:

- `linkedCategoryTransactionCount` means the Wave account row is being used as a transaction category.
- `categoryAccountExternalId` on transactions is the exact Wave chart-of-accounts id.
- A chart-of-accounts balance with zero linked transactions can be legitimate when the browser transaction pull does not return rows for that exact category in the imported window.

## Start a BC Registry Session

```bash
curl -sS -X POST http://127.0.0.1:8890/connectors/bc-registry/auth/start \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{
    "profileKey": "bc-registry-local-demo",
    "liveView": true
  }'
```

After the user navigates to the useful page:

```bash
curl -sS -X POST http://127.0.0.1:8890/connectors/bc-registry/auth/sessions/<sessionId>/confirm \
  -H "content-type: application/json" \
  -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" \
  -d '{}'
```

## Troubleshooting Blank Live View

1. Check `GET /sessions` for `currentUrl`, `dashboardUrl`, and `vncWebSocketUrl`.
2. Open `http://127.0.0.1:3003` to compare direct Blitz live view.
3. If runner APIs work but the VNC is white, suspect a foreground-tab or window-state issue.
4. Do not restore remote fullscreen as a fix. It previously caused white streams.
5. Rebuild/restart only the runner when code changes require it:

```bash
docker compose --profile connectors up -d --build connector-runner
```

This may close active runner sessions, so warn the user first when they are mid-login.
