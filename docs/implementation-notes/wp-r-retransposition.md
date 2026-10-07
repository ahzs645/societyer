# WP-R: re-transposing a full real archive end to end

This work package ran the merged intake pipeline (WP-D, WP-L), the in-app review
and promotion (WP-J), the import core (WP-B), gaps and continuity (WP-C), people
(WP-H) and documents (WP-I) against a complete real society archive (a public
Drive folder of about 10,000 entries) and fixed what broke. The archive, every
real name and every real-data result stay outside the repository (in the
session scratchpad); this note describes only the method, the fixes and
aggregate behaviour.

## Method

1. **Acquisition.** The public-folder inventory was filtered to substantive
   files (no AppleDouble/metadata trees, media, fonts or design sources), then
   downloaded in priority order (governance and finance classes first) with
   8 parallel `gdown` workers, retries with backoff and a ledger (id, path,
   status, SHA-256). Originals already downloaded earlier were reused by id.
2. **Pipeline.** `scripts/intake-run.ts --drive-inventory` with each entry's
   `localPath` pointing at the downloaded copy (deterministic engine, no LLM;
   LibreOffice converted legacy `.doc/.xls/.ppt`).
3. **Fix loop.** Coverage, record gaps, representation gaps, preflight issues
   and failed quotes were reviewed, and samples of every field type were read
   against the originals. Fixes are general rules (no per-document
   exceptions); both private golden-set evaluations were re-run after every
   change and stayed at their previous level.
4. **Staging.** A fresh browser-local workspace was created through first-run
   setup (Societies Act, BC), the run was imported with the new **Import a run
   processed on another computer** action, minutes were bulk-accepted with
   the review screen's rule and promoted with **Promote ready meetings**, the
   class records went through import sessions in batches and only the
   evidence-verified ones were approved and applied. The BC continuity rule
   pack was stored, inferred cadences were confirmed only at high confidence,
   and the people duplicate suggestions were left pending.
5. **Backup.** Settings → Runtime → Download ZIP backup, then a restore into
   another fresh profile with record counts compared.

## What was fixed or built

### Pipeline and extractors (general rules)

| Area | Problem seen at archive scale | Fix |
| --- | --- | --- |
| Motion grammar | "X makes a motion to …, Y seconded. Motion accepted." lost mover and seconder; "… Motion Carried Unanimously." left "Motion" in the wording | `makes a motion` joins `made a motion` in the trigger, mover and body rules; a trailing outcome sentence is removed from the wording (but "carried forward" inside the wording stays) |
| Header location | The same place in two header cells became "MS TEAMS, MS TEAMS" | Repeated location parts are stated once |
| Bodies | "2nd Floor Committee Meeting Room" became a committee; "ORG AQMP Committee" and "AQMP Committee" were two committees; acronym working groups ("RWG", "MWG") defaulted to the board | Committee names never come from a room/floor phrase; an organization acronym before a committee acronym is dropped; `[A-Z]{1,6}WG` and "… Working Group" are committees |
| Agenda dates | A combined "minutes + agenda" file was dated by the next meeting it announced | A file named with a full date whose own `Date:` line carries that date is dated by that line |
| Agenda-evidenced meetings | Press/media releases and rescheduled draft agendas became phantom "held, minutes missing" meetings next to the real one | Releases are not evidence that a meeting was held; an agenda within seven days of a held meeting of the same body is that meeting's agenda (and its material links there) unless it says the meeting is special |
| Policies | Copies of one policy saved in several folders staged one policy per copy; "(Approved by: …)" stayed in the name | One policy per (title, version, date) citing every copy; approval suffixes are removed from the name |
| Insurance | A "Broker" heading cell became the broker; every line mentioning additional insureds became an "additional insured" | Heading cells are not brokers; only the named party ("… extended to cover <party> as an additional insured", "Additional insured: <party>") is kept |

### Product changes needed to stage a corpus of this size

- **Import a CLI run** (`/app/intake` → "Import a run processed on another
  computer", `src/features/intake/importPipelineOutput.ts`): choose the
  `--out` folder of `intake-run.ts` (run.json, coverage.json, extracts) and,
  optionally, the original source folder; originals that match a run file by
  path and size are cached on the device for the review viewer and promotion.
  Only the text the review needs is stored in the workspace (documents with an
  extraction, their package and their version-cluster members), which keeps a
  large archive under the 256 MB restore limit.
- **Run-wide bulk accept in batches** (`intake:bulkAccept`): instead of
  refusing a scope above 5,000 fields, each call accepts whole documents up to
  5,000 fields and reports `remainingFields`; the review screen repeats the
  call and undo works across batches (undo is chunked to the 1,000-review
  limit).
- **Promote ready meetings** (review screen): promotes the canonical copy of
  every reconciled meeting whose required fields (exact date, body) are
  accepted; drafts, copies and anything whose required fields are not
  accepted (conflicting, inferred, unreviewed) stay pending, and the reasons
  are summarized.
- **Evidence rule for class records** (`shared/intake/evidenceRule.ts`): a
  staged class record (policy, rule set, insurance, filing, statement,
  budget, grant, director, seat, meeting staged from an agenda or package …)
  and its source documents are marked `confidence: "High"` +
  `evidenceVerified: true` when every source extraction has no failed quote,
  no conflicting value, and every header value it states passes the review
  screen's bulk-accept rule. Import sessions show **Approve evidence-verified**
  for those pending records; everything else stays pending. Records still
  land in their review statuses (draft policies and rule sets, directors
  needing review, insurance needing review).
- **Browser workspace file store**: in a browser-local workspace an uploaded
  document version (including originals saved on promotion) is kept in the
  workspace's IndexedDB file store (`saveLocalWorkspaceFile`), opens offline
  and is exported in ZIP backups; before, the browser runtime recorded only
  metadata.

## Gates

- `npm run test:intake-retransposition` (`scripts/check-intake-retransposition.ts`,
  also part of `test:intake-ai`): every fix above on synthetic text, the
  evidence rule, policy copy staging and bulk-accept batching.
- Private golden sets (outside git) re-run after each change:
  `SOCIETYER_GOLDEN_SET=… npx tsx scripts/check-intake-eval.ts` and
  `SOCIETYER_GOLDEN_SET_CLASSES=… npx tsx scripts/check-intake-class-eval.ts`
  stayed at their previous level (minutes: 100% motion recall/precision,
  99.6% attendance recall, 99.3% header, 0% hallucination; classes: dev 100%,
  holdout 92.4%, classification 99.6%).

## Assumptions and decisions

- "Verified" means the review screen's bulk-accept rule (stated, span
  re-verified, not conflicting, at or above the class threshold). For class
  records it is applied to the record's header facts; clause outlines, lines
  and lists are not individually reviewed and remain for a person.
- Minutes go through intake promotion (field provenance per value); other
  classes go through import sessions (record-level source links). Minutes
  embedded in packages and meetings evidenced only by an agenda are staged
  through import sessions because they have no separate extraction row.
- The organization is created through first-run setup with only its legal
  name, registry number, Act and operating region; addresses, fiscal year end
  and incorporation date are left to the onboarding checklist.
- Inferred meeting cadences are confirmed only at high confidence; everything
  else stays a suggestion. People duplicate suggestions are never merged
  automatically.

## Deferred / remaining

See the session's findings report for the archive-level results. Generic
items that remain for other packages:

- OCR for scanned PDFs (registry certificates, signed consents and scanned
  annual reports are catalogued, not extracted).
- `.xps`, `.pages`, `.nib`, design and media files are catalogued only.
- Promotion of non-minutes classes through the intake review (with field
  provenance) instead of import sessions.
- A native agreements table and fields for the bylaw rules that are still
  representation gaps.
