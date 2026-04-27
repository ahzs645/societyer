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
4. Use **Your GCOS projects** to select a project, or enter the project ID/program code manually.
5. Click **Export JSON** on a project card or in the manual export panel.
6. Copy or download the JSON.

The project list is loaded from `/OSR/pro/Project?pagesize=0` using the logged-in Chrome tab's GCOS cookies. Use **Refresh** if you switch GCOS accounts or complete login after opening the popup.

The exporter reads GCOS pages with your normal browser cookies and skips fields whose labels/names look like SIN, banking, account number, or direct deposit data. It does not submit forms.

## Import

Use either path:

- Paste or upload the JSON in Societyer: **Browser apps → GCOS → Local Chrome extension fallback**.
- Or set `Societyer API base` in the extension, then click **Import into Societyer**.

For the local dev server running on port 5180, the default API base is:

```text
http://127.0.0.1:5180/api/v1/browser-connectors
```
