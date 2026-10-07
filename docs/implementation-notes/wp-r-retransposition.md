# WP-R: re-transposing a full real archive end to end

This work package ran the merged intake pipeline (WP-D, WP-L), the in-app review
and promotion (WP-J), the import core (WP-B), gaps and continuity (WP-C), people
(WP-H) and documents (WP-I) against a complete real society archive (a public
Drive folder of about 10,000 entries) and fixed what broke at that scale. The
archive, every real name and every real-data result stay outside the
repository (in the session scratchpad); this note describes the method, the
fixes and aggregate behaviour only.

## Method

1. **Acquisition.** The public-folder inventory was filtered to substantive
   files (no AppleDouble/metadata trees, media, fonts or design sources) and
   downloaded in priority order (governance and finance classes first) with
   8 parallel `gdown` workers, retries with backoff and a ledger (id, path,
   status, SHA-256). About 99% of the planned files arrived; the rest are
   listed with the reason in the scratchpad ledger.
2. **Pipeline.** `scripts/intake-run.ts --drive-inventory` with each entry's
   `localPath` pointing at the downloaded copy; deterministic engine (no LLM
   key); LibreOffice converted legacy `.doc/.xls/.ppt`; `--extract-cache`
   made re-runs after extractor fixes take minutes instead of an hour.
3. **Fix loop.** Coverage, record gaps, representation gaps, preflight issues
   and failed quotes were reviewed after each run, and samples of each field
   type were read against the originals. Fixes are general rules (no
   per-document exceptions). Both private golden-set evaluations were re-run
   after every change and stayed at their previous level.
4. **Staging (browser-local workspace, production build).** First-run setup →
   Start a new organization (Societies Act, BC; legal name and registry
   number from a registry filing in the archive) → AI intake → **Import a run
   processed on another computer** (the CLI output folder) → **Add original
   files** per source subfolder → bulk accept "All minutes in the run" →
   **Add run people to directory** → **Promote ready meetings** → class
   records through import sessions in two batches → **Approve
   evidence-verified** → Create docs / Create minutes / Apply sections →
   Coverage & gaps: store the BC rule pack, confirm inferred cadences only at
   ≥ 80% confidence → People directory: duplicate suggestions left pending.
5. **Backup.** Settings → Runtime → Download ZIP backup, then restore into a
   fresh profile and compare per-table row counts.

## Fixes and features

### Pipeline and extractors (general rules)

| Area | Problem seen at archive scale | Fix |
| --- | --- | --- |
| Version clusters | Version families ignored the dates in file names, so every monthly minutes file of a body became one "version" cluster (up to 167 files) and one promoted meeting cited all of them (a single minutes row reached ~47 MB) | Names dated differently are never versions or near-duplicates (`nameDateSignature`); promotion never cites a package that embeds the minutes or a file dated for another meeting |
| Robustness | A parser promise that never settles ended a 10,000-file run silently at 99% | Per-file extraction deadline (180 s), the file is catalogued with the reason |
| Re-runs | Each re-run re-parsed every PDF and re-converted every legacy file | `intake-run.ts --extract-cache <dir>` keyed by content hash and extractor version |
| Motion grammar | "X makes a motion to …, Y seconded. Motion accepted." lost mover and seconder; "… Motion Carried Unanimously." left "Motion" in the wording | `makes a motion` joins the trigger, mover and wording rules; a trailing outcome sentence is not wording ("carried forward" inside the wording stays) |
| Header location | The same place in two header cells became "X, X" | Repeated location parts are stated once |
| Bodies | A meeting room ("… Committee Meeting Room") became a committee; "ORG ABC Committee" and "ABC Committee" were two committees; acronym working groups defaulted to the board | Rooms and floors are not committees; an organization acronym before a committee acronym is dropped; `[A-Z]{1,6}WG` and "… Working Group" are committees |
| Agenda dates | A combined minutes + agenda file was dated by the next meeting it announced | A file named with a full date whose own `Date:` line carries that date is dated by that line |
| Evidenced meetings | Press/media releases and rescheduled draft agendas became phantom "held, minutes missing" meetings beside the real one | Releases are not evidence of a held meeting; an agenda within seven days of a held meeting of the same body is that meeting's (its material links there) unless it says the meeting is special |
| Impossible dates | A typo ("January 11, 2032") made a future meeting and stretched the AGM-per-year rule to 2032 | Minutes dated after the run date get the file-name date as a `conflicting` value (a person must confirm); AGM gaps stop at the year before the run |
| Dates in item numbers | "4.2 July 2022 … Minutes" was read as 2 July 2022 | A day-first date is never preceded by "n." |
| Unresolved references | Headings ("Notes:"), report titles and durations ("limited to 10 minutes") became missing-minutes record gaps | Only citations of minutes or meetings count |
| Policies | Copies of one version staged once per copy; "(Approved by: …)" stayed in the name; versions sharing a title were refused by the import as duplicates | One policy per (title, version, date) citing every copy; approval suffixes removed; versions of one family carry their date in the name |
| Insurance | A "Broker" heading cell became the broker; every line mentioning additional insureds became one | Heading cells are not brokers; only the named party is an additional insured |
| PDF columns | pdf.js reports the space between two columns as one wide " " item, so the second column ran into the first; a long organization in a "Name / Organization" list swallowed the next attendee (names came through as fragments) | Whitespace items never close a column gap; tabbed rows that start at the same left edge stay separate rows |
| PDF minutes tables | "Agenda Item / Group Action" tables were not recognised, a table lost its columns on the next page, and a vertically centred cell ("1:08PM" over "7. Adjourn") became its own row | More header labels (group, who, responsible, decision, minutes); column anchors carry to a header-less next page; a one-line cell just above its row's item joins that row; a bare time in an "Adjourn" item is the adjournment time |
| ACTION / DECISION lines | "DECISION:" lines stayed in the discussion; decisions repeated the motions | "DECISION:" lines are stated decisions (cut before an "ACTION:" on the same line); a decision equal to or contained in a motion is dropped |
| Action / WHO / FOR columns | "Agenda Item / Discussion / Action / WHO / FOR" tables were read as action registers or the WHO cell became a second action | Such tables are minutes tables; WHO is the action's assignee and FOR its due date |

### Review, promotion and staging

- **Import a CLI run** (`/app/intake`, `src/features/intake/importPipelineOutput.ts`):
  choose the `--out` folder of `intake-run.ts`; only the text the review needs
  is stored (documents with an extraction, their package and version-cluster
  members), which keeps an archive of this size under the 256 MB restore
  limit.
- **Add original files** (run details): choose the source folder or any
  subfolder, as often as needed; files are matched by path suffix and size
  and cached for the viewer and promotion. (Choosing several hundred
  megabytes in one file dialog can exhaust a browser tab.)
- **Run-wide bulk accept in batches** (`intake:bulkAccept`): whole documents
  up to 5,000 fields per call with `remainingFields`; the review screen
  repeats the call and undo works across batches.
- **Promote all ready** (review screen, from the integration branch; it
  replaced this package's earlier "Promote ready meetings"): after the
  run-wide minutes bulk accept it promotes the canonical copy of every
  meeting whose exact date and body are accepted; documents missing a
  required field stay in the queue.
- **Add run people to directory** (review screen): one directory person per
  distinct full name as written in the run (role words, organizations and
  single names excluded; spelling variants stay separate so the directory's
  duplicate suggestions can propose merges). Import-time name resolution in
  a trusted local workspace now also sees the workspace's unowned directory
  people and ignores merged tombstones; before, a fresh browser workspace
  could never link an attendee, chair, mover or seconder.
- **Thresholds.** Minutes `location` and `recorder` are accepted at 0.8
  (the extractor's level for stated values; 100% correct on the private
  golden set). Class documents accept titles, insurers and labelled dates at
  0.8; heuristic guesses (0.6–0.75) stay below.
- **Evidence rule for class records** (`shared/intake/evidenceRule.ts`): a
  record staged through import sessions is evidence-verified when nothing in
  its source extraction failed re-verification or conflicts and its key facts
  (identity and every stated date) pass the bulk-accept rule. It is staged
  `confidence: "High"` with a marker; import sessions offer **Approve
  evidence-verified**; records still land in their review statuses.
- **Browser workspace file store**: in a browser-local workspace an uploaded
  document version (including originals saved on promotion) is stored in the
  workspace's IndexedDB, opens offline and is exported in ZIP backups.

## Gates

- `npm run test:intake-retransposition` (`scripts/check-intake-retransposition.ts`,
  also part of `test:intake-ai`) covers every fix and feature above on
  synthetic data.
- Private golden sets (outside git), re-run after each change and unchanged:
  minutes — 100% motion recall/precision, mover/seconder/outcome 100%,
  attendance recall 99.6%, header 99.3%, 0% hallucination; classes — dev
  100% (151/151), holdout 92.4% (61/66), classification 99.6%.
- Also passing: `tsc -b`, `convex:typecheck`, lint (0 errors),
  `test:static-parity`, `test:authorization-policy`, `test:portable-manifest`,
  `test:import-core`, `test:people-identity`, `test:intake-review`,
  intake stages/functions.

## Assumptions and decisions

- "Verified" means the review screen's bulk-accept rule (stated, span
  re-verified, not conflicting, at or above the threshold). For class records
  it applies to the record's key facts; clause outlines, statement lines and
  lists are not individually reviewed and remain for a person.
- The final staging promotes every class through the intake review: a
  run-wide bulk accept ("Every document in the run", the bulk-accept rule),
  then "Promote all ready". Every native record then has field provenance.
  Only minutes embedded in agendas or packages go through an import session,
  because they have no extraction row of their own. Meetings evidenced only
  by an agenda are created when that agenda is promoted. The evidence rule
  and "Approve evidence-verified" serve that import path and any bulk import.
- A document with no accepted field is not promoted, even when its class has
  no required field. Before this rule, "Promote all ready" wrote unreviewed
  correspondence, agreements, consents, rosters and proxies.
- A section-apply preflight that finds any blocked record returns the blocked
  ones to Pending (with the reason) and applies nothing; the apply is run
  again for the rest. Meeting materials whose meeting is still pending stay
  blocked until that meeting is promoted.
- The organization is created with its legal name, registry number, Act and
  operating region only; addresses, fiscal year end and incorporation date
  stay on the onboarding checklist.
- Inferred cadences are confirmed only at ≥ 80% confidence; people duplicate
  suggestions are never merged automatically.

## Deferred / remaining

- OCR for scanned PDFs (registry certificates, signed consents, scanned
  annual reports): catalogued, not extracted.
- `.xps`, `.pages`, `.nib`, design and media files are catalogued only.
- Minutes embedded in agendas or packages have no extraction row, so they
  cannot be promoted from the review screen.
- Fields for what is still a representation gap (agreements, quorum
  head-counts, consensus rules, signing tiers, AGM notice, bylaw cadence and
  term rules, insurance continuity dates).
- Chair, meeting type and adopts-minutes links stay below the bulk-accept
  thresholds without a larger labelled set to calibrate them.
