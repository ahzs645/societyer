# Societyer GCOS Exporter

Local Chrome extension fallback for GCOS when GCKey rejects the Blitz/Docker browser.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `extensions/gcos-exporter`.

## Export

1. Log into GCOS in normal Chrome.
2. Open any authenticated GCOS page under `https://srv136.services.gc.ca/OSR/pro`.
3. Click the Societyer GCOS Exporter extension.
4. In **1. Choose a project**, select one of the detected projects. You can also type the project ID and program code manually in **2. Confirm export target**.
5. Click **Export & download JSON**.
6. The background worker exports the project, updates the progress bar, and downloads a `.json` file. You can close and reopen the popup while it is running.
7. When complete, the same JSON appears in the popup so you can copy it or import it into Societyer.

The project list is loaded from `/OSR/pro/Project?pagesize=0` using the logged-in Chrome tab's GCOS cookies. Use **Refresh** if you switch GCOS accounts or complete login after opening the popup.

The exporter reads GCOS pages with your normal browser cookies and skips fields whose labels/names look like SIN, banking, account number, or direct deposit data. It does not submit forms.

Use **Export ZIP + PDFs** when you also want a local evidence bundle. The zip contains `snapshot.json`, `manifest.json`, and agreement PDFs from GCOS agreement document URLs. Banking/direct-deposit documents are intentionally not downloaded.

Exports use `schemaVersion: 3`. The v3 snapshot keeps the earlier raw page blocks for compatibility, but also adds deterministic DOM-derived data:

- `projects[]` for every project card found on `/OSR/pro/Project?pagesize=0`.
- `meta` and per-page `_meta` with screen identifier, page version, URL, and scrape timestamp.
- `formState` for display pages, grouped by radio, checkbox, select, textarea, text, and hidden field name.
- `structured.jobsRequested[]`, `structured.jobsApproved[]`, and `structured.jobDeltas[]`.
- `structured.manage`, `structured.agreements[]`, and `structured.correspondence[]` with ISO dates from GCOS `data-date` values where available.

## Import

Use either path:

- Paste or upload the JSON/ZIP in Societyer: **Browser apps → GCOS → Local Chrome extension fallback**, or use **Grants → Import GCOS**.
- Or set `Societyer API base` in the extension, then click **Import into Societyer**.

For the local dev server running on port 5180, the default API base is:

```text
http://127.0.0.1:5180/api/v1/browser-connectors
```
