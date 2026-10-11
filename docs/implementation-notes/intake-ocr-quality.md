# Intake: OCR, extraction quality, legacy Office and agreements

This package adds a local OCR stage to the intake pipeline, reads legacy Office,
PowerPoint and XPS files without LibreOffice, calibrates the minutes fields that
stayed below the bulk-accept thresholds (chair, meeting type, adopts-minutes
links), renders pipe-joined source tables as tables, and improves agreement
extraction for the new native agreements register. Real PGAIR data and every
real-data result stay outside the repository; the numbers below are aggregates.

## 1. OCR

### What it does

- **When.** A PDF page whose text layer has fewer than 20 characters and that
  paints an image (a scan) or many vector paths (outlined text) is rendered and
  read by OCR. Images (`jpg/jpeg/jfif/png/tif/tiff/bmp/gif/webp/pbm`) are read
  when they look like documents: `isDocumentImage` takes scans, signed forms,
  certificates, letters, receipts and forms by name or folder, and leaves photos,
  logos, posters and camera file names (`IMG_1234`, `DSC_0193`) catalogued. An
  image that OCR finds fewer than 12 words in (or below 45% confidence) is
  catalogued as an image after all.
- **Engine.** tesseract.js 7 with the bundled English LSTM model
  (`@tesseract.js-data/eng`, `4.0.0_best_int`). The CLI uses the system
  `tesseract` binary instead when one is installed (`--ocr-engine auto`), which is
  faster and reads TIFF; its TSV output maps to the same words.
- **Rasterizing.** pdf.js renders pages (300 dpi, at most 20 M pixels; 12 M in a
  browser tab): `@napi-rs/canvas` in Node, `OffscreenCanvas` in the intake web
  worker (with a worker-safe canvas factory). pdf.js gets its `wasmUrl` so JBIG2
  and JPEG 2000 scans decode.
- **Rotation.** A page read at 0° with many low-confidence words is probed at 90°,
  270° and 180° at 150 dpi and re-read at the rotation whose words look most like
  text. Small skew is corrected by tesseract (`rotateAuto`). The page's own
  `/Rotate` is honoured by pdf.js.
- **Layout.** Recognised words become positioned text items in PDF points, and the
  same layout code that reads a PDF text layer lays them out: lines, TAB columns,
  minutes tables, action registers, paragraphs, running headers. Scanner specks
  and rule fragments ("|", ":", "oo") are dropped; item numbers are kept.
- **Output.** Extract method `ocr` (every page) or `pdfjs-text+ocr` (some pages);
  `methodVersion` names the engine. Every OCR block carries `ocr.confidence` (mean
  word confidence, 0–1) and the words read below 60%. The extract carries
  `ocr.pages[]`: page, confidence, rotation, dpi, word counts, size and line boxes
  with per-word confidences and boxes (in points from the top-left). Workspace rows
  (`intakeExtracts.ocr`) keep the page summaries without line boxes.
- **Confidence.** `applyOcrConfidence` runs after span verification in the
  pipeline, for embedded minutes and in `intakeActions` (LLM and deterministic):
  a value whose quote contains a word read below 60% is capped at 0.5; a value
  from a block below 75% at 0.6 (both under every bulk-accept threshold); good OCR
  lowers confidence slightly. The field note says it was read by OCR. Quote
  re-verification works unchanged because quotes are re-found in the OCR text.
- **Budget.** A per-run page budget (`OcrPageBudget`); pages past it stay listed as
  "OCR required" with the reason. Concurrency: `--ocr-concurrency` (CLI), one
  recogniser in the browser.
- **Privacy.** OCR is local in every runtime. No page, image or text leaves the
  device; the assets are served from the build.

### Where

| Area | Files |
| --- | --- |
| Shared OCR stage | `shared/intake/extract/ocr.ts` (types, budget, upright detection, noise cleanup, word → items, page summary, block stats, `applyOcrConfidence`, `isDocumentImage`), `shared/intake/extract/ocrTesseract.ts` (tesseract.js pool and block mapping), `shared/intake/extract/image.ts` |
| PDF | `shared/intake/extract/pdf.ts`: page collection, OCR of empty pages, `layoutPages` shared with OCR and XPS |
| Node host | `shared/intake/node/ocr.ts` (`createNodeOcrHost`, system tesseract TSV, bundled model path) |
| Browser / desktop host | `src/features/intake/ocrHost.ts` (lazy; tesseract.js worker, SIMD or plain core), `intake.worker.ts`, `runIntake.ts`, `workerProtocol.ts`, `collectFiles.ts` (document images kept, extensionless files kept) |
| UI | `src/pages/IntakeRuns.tsx`: "Scanned documents" options (on by default, page budget 200, remembered on the device), document-image count in the selection summary, OCR progress message |
| Offline assets | `vite.config.ts` plugin `societyer-intake-ocr-assets`: copies the tesseract worker, both cores, the English model and pdf.js decoders to `assets/intake-ocr/` (served from any `/intake-ocr/` path in dev); `tesseract.js` is pre-bundled in dev |
| CSP / desktop | `'wasm-unsafe-eval'` added to `script-src` (`index.html`, `electron/csp.ts`; WebAssembly compilation only, never `eval`); `.wasm` served as `application/wasm` by the desktop protocol |
| Pipeline | `shared/intake/pipeline.ts` (`ocrImages`, OCR'd images classified by name without the extension and by their text, confidence caps; the per-file extract deadline counts time without progress and OCR pages restart it through `withOcrActivity`), `convex/intakeActions.ts`, `shared/intake/stageRun.ts` and `shared/functions/intake.ts` (`ocr` summary on extract rows) |
| CLI | `scripts/intake-run.ts`: OCR on by default; `--ocr-concurrency`, `--ocr-page-budget`, `--ocr-engine auto|tesseract.js|system`, `--ocr-dpi`, `--no-ocr`; cached extracts that still need OCR (or were unsupported/empty) are read again; the summary reports OCR pages, confidence, rotations, skipped pages |
| Dependencies | dev: `tesseract.js` ^7, `@tesseract.js-data/eng` ^1, `@napi-rs/canvas` (already installed by pdf.js) |

### Size

The OCR assets are 11 MB in `dist/assets/intake-ocr/` (worker 111 KB, SIMD and
plain LSTM cores 3.9 MB each — 1.5 MB gzipped — the English model 2.9 MB, pdf.js
decoders 0.45 MB). Nothing is in a static import closure: `npm run
test:frontend-bundle-budget` passes (local dashboard 590 KB gzip of 900 KB
after merging the full-archive work). The packages are dev dependencies, so the desktop app ships only the
built assets, not `node_modules/tesseract.js-core` (44 MB).

### Verified

- Browser (dev server and production build, local runtime): four files chosen
  (a scanned two-page minutes PDF with one sideways sheet, a scanned consent PNG,
  an `.xls`, a `.ppt`): the run OCR'd both scans in 15–20 s, staged three
  documents and the review shows the scan with OCR-level confidences (an
  uncertain word in the location kept it at 50%). Only `assets/intake-ocr/*` was
  requested (no CDN). Screenshots: `shots/impl-ocr-*.png`, `impl-ocr-prod-*.png`.
- Desktop: typechecked, CSP and content type gated (`test:electron-architecture`);
  not run in Electron here (no display).

## 2. Extraction quality and calibration

### Changes

- **Chair.** "(chair)" marks in any cell of an attendance row, ", chair" tails and
  "(chair & notes)" (also the recorder); "Meeting Chair:" and tab-separated role
  rows; a "Chair: Name" header line; "presided over by". Who called the meeting
  to order ("… at 5:30 PM by X", "… (S. Ortiz)", "X called the meeting to order")
  corroborates another source (confidence 0.92, second locator), contradicts it
  (capped at 0.84 with a note naming both) or, alone, is an inferred chair (0.7).
  Attendance marks are 0.88 (was 0.75). Text evidence still wins.
- **Meeting type.** Bulk threshold 0.8 for `meetingType` (it is read from the same
  header label as `bodyLabel`, already 0.8).
- **Adopts minutes.** A full date in the motion 0.92, in its agenda item title 0.88,
  a day and month whose year follows from the meeting 0.8; after reconciliation a
  link to minutes the archive holds is corroborated (0.95) and an undated "previous
  minutes" motion gets the linked meeting's date (inferred, a person confirms).
  The bundle's motion payload now carries `adoptsMinutes`, which import apply
  resolves to `adoptsMinutesId`: before this, no promotion could create the link
  whatever its confidence.
- **Calibration report.** `check-intake-eval.ts` prints, per field, how many golden
  values would be bulk-accepted and right, bulk-accepted and wrong, and right but
  below the threshold; the gate fails on any bulk-wrong value.

### Minutes golden set (15 documents, private)

| Field | Before: bulk-correct / wrong / right but below τ | After |
| --- | --- | --- |
| Chair | 5 of 10 / 0 / 4 | 7 of 10 / 0 / 2 (one held back as a source conflict) |
| Meeting type | 0 of 15 / 0 / 15 | 14 of 15 / 0 / 1 |
| Body | 14 of 15 / 0 / 1 | 14 of 15 / 0 / 1 |
| Adopts-minutes links | 0 of 7 / 0 / 5 | 5 of 7 / 0 / 0 |

Every other metric is unchanged: motion recall and precision 100%, mover,
seconder and outcome 100%, attendance recall 99.6%, header 99.3%, tasks
93.1/94.4/90.5%, hallucination 0% of 1,580 quotes. Synthetic fixture: 100%, 0
bulk-wrong.

### Classes golden set (private)

Updated for the agreements register: C-AR1 no longer expects an
`agreement.contract` gap and expects native parties instead; six PGAIR agreements
were hand-labelled (C-AR3–C-AR8, tuning) and two more after the changes were
written (C-AR9, C-AR10, holdout).

| | Before | After |
| --- | --- | --- |
| Dev (tuned on) | 151/151 (29 docs) | 188/188 (35 docs) |
| Holdout | 61/66 (13 docs) | 74/78 (15 docs; the two new holdout agreements scored 11/12 on first pass and 12/12 after one general fix for collapsed PDF columns) |
| Agreements | — | 39/49 → 61/61 (10 docs) |
| Classification (235 files) | 234/235 | 234/235 |

### Source tables

`shared/sourceMeetingRecord.ts` gains `splitPipeTables`; the minutes column
(`MeetingMinutesColumn.internal.tsx`) and the Word/PDF exports
(`minutesRenderer.ts`) render pipe-joined rows from earlier imports as real
tables with a detected header row. Stored text and `sourceMeetingBlockText` are
unchanged, so existing records keep round-tripping. Screenshot
`impl-ocr-5-minutes-table.png`.

## 3. Legacy Office and other formats

- **Excel 97–2003** (`shared/intake/extract/xls.ts`): BIFF8 Workbook stream (SST
  with CONTINUE, LABELSST/LABEL/RSTRING, NUMBER, RK/MULRK, BOOLERR, FORMULA with
  its cached value and STRING), date formats via FORMAT/XF, the 1904 date system;
  BIFF5 best effort; encrypted workbooks reported. SheetJS was not used: the npm
  release (0.18.5) has known advisories and newer builds are only on its CDN. On
  80 PGAIR workbooks it agrees with LibreOffice on 84,382 of 84,382 cells (after
  two fixes in the XLSX reader it was compared through: the 1904 date system, and
  number formats whose quoted text or `[$-1009]` codes contain d/y).
- **PowerPoint**: PPTX/POTX (`slides.ts`, slides in order, title placeholders as
  headings, tables, speaker notes) and PowerPoint 97–2003 (text atoms per slide
  from the slide list and slide containers, notes matched by `NotesAtom`). Before,
  `.pptx` and `.ppt` went to LibreOffice's Word filter and failed.
- **XPS/OXPS**: glyph runs with render transforms laid out like a PDF page.
- **HTML saved as .xls/.doc**: tables stay tables.
- **No extension**: the format is read from the bytes (PDF, JPEG/PNG/TIFF, RTF,
  OLE Word/Excel/PowerPoint/Outlook, OOXML, XPS, e-mail, plain text).
- **Node CLI**: `.doc` and `.xls` fall back to the native readers when LibreOffice
  fails or returns no text.

On the 147 files LibreOffice could not convert in run8 (97 `.pptx`, 45 `.ppt`,
5 `.doc`) the native readers now read 136: `.ppt` 45/45, `.pptx` 90/97 (6 are
corrupt zips, 1 has only images), `.doc` 1/5 (4 hold only images). They also read
55/55 `.xps`, the `.potx`/`.dotm` files and 4 of 10 extensionless files (the rest
are application bundle files). Still unconvertible: corrupt zips, image-only
Office files (OCR of embedded images is not done), `.pages`, `.nib`, design,
media and archive files.

## 4. Agreements (added to this package by the orchestrator)

`shared/intake/extractors/agreement.ts`:

- **Parties**: BETWEEN … AND blocks (inline, stacked with address lines, two
  columns, names wrapped inside a column, columns collapsed by PDF extraction),
  "Letter of Agreement between X and Y" sentences, role labels (Contractor:,
  Recipient of the grant, Submitted by/to:), quoted role aliases ("X (the
  “Consultant”)", never defined terms like the “Grant”), signature blocks ("on
  behalf of X", an organization over "Per:") and a funder's own sentence ("the X,
  is able to provide funding"). Addresses, incorporation notes, "the secretariat
  for …" tails and sentence fragments are cut; a person is a party only as a
  named contractor or consultant.
- **Title** from the heading, never a label line ("Contract #: …"; "Event #:
  12756 License Agreement" → "License Agreement"); dates are not titles.
- **Term**: "commencing (on) (and including) … ending (on) …", and a stated end
  date when the start is month-precise.
- **Value**: the strongest cue wins — a maximum amount (also written without a
  dollar sign) over fees, a fee cap ("shall not exceed", "up to") over totals.
  Insurance and liability limits are never the agreement's value.
- **Deliverables**: also under "will:"/"shall:" headings, tasks, duties and
  statements of work. **Agreement numbers** keep a trailing year.

On the 104 PGAIR files classified as agreements (about 30 are reports, papers or
notes the classifier calls agreements): two or more parties 46 → 52, one party
8 → 13, label-line titles 32 → 3, deliverables 32 → 36, a term 55 → 57, a value
57 → 55 (insurance limits no longer counted).

## 5. OCR golden set and the corpus re-run

### OCR golden set (private, `findings/golden-set-ocr.json`)

14 scanned PGAIR PDFs (21 pages): minutes with a sideways sign-in sheet, an annual
report filing confirmation, a certificate of incorporation, two director consents,
a proxy and a representative form (handwritten values), two insurance documents,
a sideways agreement signature page, a postal receipt, a budget, a support letter
and a grant agreement. Labels: printed phrases OCR must read, class field checks,
handwritten flags and contact data that must never appear.

| | First pass | After fixes (tuned on these documents) |
| --- | --- | --- |
| Printed phrases read | 68/73 (93.2%) | 68/73 |
| Mean page confidence | 85.6% | 85.6% |
| Rotated pages detected | 2/2 | 2/2 |
| Classification | 13/14 | 14/14 |
| Printed fields | 34/44 | 39/44 |
| Handwritten fields | 0/7 | 0/7 (never bulk-accepted) |
| Wrong values that would be bulk-accepted | 0 | 0 |
| PII leaks / hallucinated quotes | 0 / 0 of 177 | 0 / 0 of 180 |

The fixes were general: registrar certificates are registry filings, a grant's
funder can be named in its own sentence (and only a request letter's addressee is
its funder), a month-precise start no longer hides a stated end date, and
certificate tables read by OCR separate term dates with "|". Remaining printed
misses: an insurer named only in a reference line, a receipt's vendor and
subtotal, a budget table whose OCR merges columns.

### Corpus re-run (run8 → run9-ocr)

Same Drive inventory (10,196 files), `scripts/intake-run.ts` with OCR on
(tesseract.js, 3 recognisers, 4 file workers, unlimited page budget). run8 is the
pre-OCR baseline. The cold OCR pass took about 3 h 45 min of wall time on four
shared CPUs (roughly 10 pages a minute). With the extract cache warm, a re-run takes 12 min.

| | run8 | run9-ocr |
| --- | --- | --- |
| Files extracted | 4,029 | 4,761 |
| Catalogued | 2,914 | 2,028 |
| — OCR required / scan without text | 605 | 10 |
| — LibreOffice failed | 142 | 0 |
| — no extractor | 181 | 70 |
| — extraction failed (corrupt) | 6 | 12 |
| Pending (bytes not downloaded) | 10 | 102 |
| Read by OCR (all pages / some pages) | 0 | 604 / 196 |
| Read natively: .ppt / .pptx / .xps | 0 / 0 / 0 | 45 / 93 / 55 |
| Extractions | 2,189 | 2,533 |
| Files with an extraction (coverage) | 2,033 | 2,376 |
| Files transposed into native records | 1,609 | 1,891 |
| Native facts | 114,602 | 118,215 |
| Gap facts (representation gaps) | 1,385 | 528 |
| Unresolved facts | 5,124 | 5,656 |
| Native coverage | 94.63% | 95.03% |
| Minutes chair values / bulk-eligible | 205 / 42 | 249 / 204 |
| Meeting type bulk-eligible (τ 0.85 → 0.8) | 0 | 364 |
| Adopts-minutes links: bulk-eligible / bundled | 0 / 0 | 24 / 32 |
| Agreements staged in the native register | 0 (gap) | 138 |
| — with a counterparty / term / value | — | 96 / 78 / 76 |
| Bad quotes (mismatched or invalid) | 2 of 145,224 | 3 of 149,054 |
| Bundle preflight issues | 0 | 0 |

Extractions gained per class: director consents 45 → 98, invoices 230 → 358,
financial statements 88 → 160, proxies 27 → 41, insurance 49 → 63, agreements
104 → 131, bylaws 18 → 25; minutes and agendas barely changed (they were mostly
born digital).

OCR across the corpus: 2,494 pages in 800 files, mean page confidence 73.5%, 896
pages below 75% (their values stay under bulk-accept thresholds), 271 pages read
upright after rotation, no pages skipped by the budget, and 509 pages on which OCR
found no words (blank sheets, photos and signature-only pages; they stay listed in
`emptyPages`).

The third bad quote is not from OCR: it is one of run8's two mismatches, now also
found in an embedded-minutes copy inside a meeting package. No OCR-read value
produced a mismatched quote.

Two problems the first full run found were fixed and re-run:

- 51 long scans were catalogued as "timed out after 180 s". The per-file deadline
  counted total time. It now counts time without progress: every OCR page
  restarts it (`withOcrActivity`, used by the CLI and the browser worker), and a
  parser that never settles is still cut off.
- Four OCR'd insurance documents had neither an insurer nor a policy number. They
  were bundled anyway, and the importer drops such policies. They now stay
  reviewable extractions.

The pending rise is 92 images and extensionless files the local copy never
downloaded. Before OCR they were catalogued by name without their bytes.

**Still unread or unconvertible:**

- 1,782 photos, audio and video files.
- 137 design source files.
- 12 archives.
- 70 files with no extractor:
  - 37 `.nib`, 8 `.css`, 7 `.swf`, 5 `.fla`;
  - 2 Apple `.pages`, 2 `.plist`, 2 `.strings`;
  - 1 each of `.webarchive`, `.icns`, `.car`, `.js`, `.mpg`, `.textClipping` and a file with no extension.
- 12 damaged files:
  - 6 `.pptx`, 1 `.xlsx` and 1 `.docx` whose zip is truncated;
  - 1 PDF with a broken structure;
  - 3 `.doc` that are not Word files.
- 9 Word files that hold only images. OCR of images embedded in Office files is deferred.
- 1 PDF page that OCR read as blank.

## Gates

- `scripts/check-intake-ocr.ts` (`test:intake-ocr`, in `test:intake-ai`):
  unit checks, the committed synthetic scans read offline with tesseract.js,
  rotation, page budget, confidence caps, photo vs document images, the pipeline
  end to end, and the native `.xls/.ppt/.pptx/.xps`/HTML/extensionless readers;
  optional private OCR golden set (`SOCIETYER_GOLDEN_SET_OCR`).
- `scripts/check-intake-agreement-extraction.ts` and
  `scripts/check-source-pipe-tables.ts` (in `test:intake-ai`).
- `check-intake-eval.ts` bulk-accept calibration (fails on any bulk-wrong value).
- Fixtures: `tests/fixtures/intake/ocr/` (synthetic; regenerate with `npm run
  intake:ocr-fixtures`, needs LibreOffice for `.xls`/`.ppt`).
- Passing: `tsc -b`, `convex:typecheck`, `desktop:typecheck`, lint (0 errors),
  `test:intake-ai`, `test:agreements`, `test:static-parity`,
  `test:portable-manifest`, `test:electron-architecture`,
  `test:frontend-bundle-budget`, `test:import-apply-per-record` (re-run after
  merging the full-archive scale work).

## Assumptions and decisions

- OCR is on by default in the app (page budget 200 per run) and the CLI
  (unlimited unless `--ocr-page-budget`); both can be turned off.
- English only. Other languages need their model added to the asset list.
- Handwriting is read when it can be, but values that rely on uncertain words stay
  below every bulk-accept threshold; a person reads the scan.
- An image is OCR'd only when its name or folder says it is a document; undecided
  names stay catalogued (photos are common in society archives).
- `'wasm-unsafe-eval'` is the narrowest CSP change that lets the bundled
  WebAssembly compile; JavaScript `eval` stays blocked.
- `check-intake-review.ts` tolerates four promoted fields without a provenance
  row instead of three: meeting type now bulk-accepts and, like body and
  bodyLabel, maps to the meeting type, which a merge never attributes.

## Deferred

- OCR of images embedded in Word/PowerPoint files, of scanned XPS pages and of
  multi-page TIFF in the browser (the system tesseract binary reads TIFF in the CLI).
- OCR quality for tables of figures (budgets) and receipts; an LLM pass over OCR
  text would help most there.
- A blind holdout for the OCR golden set (all 14 documents were used to tune).
- The classifier still calls about 30 reports and notes "agreements".
