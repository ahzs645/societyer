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

The runner currently supports the `blitz` backend. The code is structured
around a `BrowserBackend` interface so Steel Browser can be added later without
rewriting connector actions.
