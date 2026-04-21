---
name: societyer-browser-connectors
description: Use when operating Societyer browser-backed connectors, live BlitzBrowser sessions, Wave imports, BC Registry browser utilities, connector-runner APIs, or diagnosing white/blank live browser streams and saved browser profiles.
---

# Societyer Browser Connectors

Use this skill to operate Societyer's browser-backed connector stack without asking the user for credentials or bypassing the live-login review flow.

## Core Workflow

1. Confirm the connector stack is running:
   - `curl -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" http://127.0.0.1:8890/healthz`
   - `curl -H "x-connector-runner-secret: $CONNECTOR_RUNNER_SECRET" http://127.0.0.1:8890/sessions`
2. Reuse an active session when it already exists for the target connector and profile.
3. Start a live session only when needed, using `/connectors/<id>/auth/start` with `liveView: true`.
4. Ask the user to complete login in the live browser. Do not request, store, paste, or echo passwords, MFA codes, recovery codes, or banking secrets.
5. Verify or confirm the profile after login:
   - `verified` connectors, such as Wave, use `/connectors/<id>/auth/verify` or `/connectors/<id>/auth/sessions/<sessionId>/confirm`.
   - `profile` connectors, such as BC Registry, save the browser profile after the user reaches the useful page.
6. Run the connector action or app proxy route.
7. Verify results in Societyer/Convex before telling the user the task is done.

Read `references/api-cookbook.md` when you need exact curl examples, Wave import routes, Convex verification commands, or live-browser troubleshooting.

## Safety Rules

- Treat the browser as user-controlled. Let the user type credentials in the live view.
- Do not expose or log Wave GraphQL bearer tokens. They are short-lived and runner-local.
- Keep `CONNECTOR_RUNNER_SECRET` out of chat output. Use the environment variable in commands.
- Prefer profile keys scoped by connector, for example `wave-local-demo` and `bc-registry-local-demo`.
- Do not force remote Chromium fullscreen. It has caused blank live streams in BlitzBrowser. If the user wants less chrome in the embedded stream, prefer client-side cropping or layout changes.

## Common Tasks

### Diagnose a white live browser

Check `/sessions` first. If a session exists but live view is blank:

- open the Blitz dashboard at `http://127.0.0.1:3003` to compare direct live view;
- check whether the runner session is on the expected `currentUrl`;
- start a fresh live session if the foreground tab is stale;
- keep Chromium non-fullscreen and bring the target page to front.

### Import Wave transactions

Use an active Wave session when possible. Run the app proxy import route after login so normalized accounts and transactions are stored in Societyer. Validate at least one category-account example with `financialHub:transactionsForCategoryAccountExternalId`.

Wave chart-of-accounts rows can represent transaction categories. Use `categoryAccountExternalId` for exact transaction-category links. Fall back to category label only for legacy transactions where the exact category account id is absent.

The financial UI separates Wave account rows into Money accounts, Categories, Working set, Ledger/system, and Raw accounts. Treat zero-balance `PAYABLE_BILLS`, `PAYABLE_OTHER`, and `TRANSFERS` rows as ledger/system artifacts unless there is evidence they represent a real account balance. These rows often look like many duplicate `Accounts Payable` or `Transfer Clearing` entries and should not be mixed into default account/category analysis.

### Use BC Registry utilities

Open a `bc-registry` live browser profile, let the user navigate to the society filing-history page, then save the profile. Filing-history export should run as a page utility/content script against the authenticated page and should fetch PDFs with `credentials: "include"`.
