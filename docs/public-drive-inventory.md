# Public Drive source collection

The Python standard-library scripts can collect a public shared folder without
Google credentials. Keep outputs outside this repository; source files can
contain personal and financial records.

```sh
python3 scripts/inventory-public-drive.py FOLDER_ID \
  --output /path/outside/repo/drive/inventory.json --workers 4 --max-folders 300
python3 scripts/download-public-drive.py \
  --inventory /path/outside/repo/drive/inventory.json \
  --output-dir /path/outside/repo/drive/downloads \
  --id FILE_ID --max-total-mb 150
```

The inventory preserves Drive IDs, names, relative source paths, parent IDs,
MIME types, rounded display sizes, metadata exclusions, folder access errors,
and pagination risks. `._*`, `.DS_Store`, `desktop.ini`, `Thumbs.db`,
`.LexarDataShield`, and `System Volume Information` are recorded but excluded
from substantive processing and recursion. The downloader accepts explicit file
IDs only and records the local path, exact byte size and SHA-256 hash. Native
Google documents requiring export are not supported by this downloader.

**A public HTML inventory is not a completeness certificate.** Drive can return
only an initial page. Folders with 50 or more observed entries are flagged;
smaller lists are still not independently certified. Access errors and queued
folders are retained. Use authenticated Drive API pagination or an independently
verified full source export before describing an entire archive as processed.

Folder HTML is cached beside the manifest, so rerunning recovers cheaply after
interruption. Delete that cache to refresh remote folder listings. Cached source
listings may be older than the manifest creation time. The HTML layout is
undocumented; a parsing failure is an error, never an empty successful folder.
The pipeline does not execute scripts, macros, or instructions inside sources.

To continue a checkpoint, rerun with `--resume --max-folders 600` (the limit is
total folder attempts, including prior attempts). Add `--retry-errors` deliberately
to retry failed folders; errors are otherwise retained. Each checkpoint records
queued and currently requested folders. SIGINT/SIGTERM finish the current bounded
request batch and save. Repeated folder IDs are traversed once, with alternate
paths recorded in `aliases`; counts refer to observed entries, not unique content.
