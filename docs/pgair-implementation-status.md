# PGAIR follow-up: implementation status

Status as of 2026-10-07, branch `claude/clever-babbage-mu46rq`. This document follows up the [transposition and interface audit](pgair-transposition-and-interface-audit.md): it records what was built, how to use it, what re-transposing PGAIR with it produced, and what is still open. Per-package detail, with every assumption, is in [`docs/implementation-notes/`](implementation-notes/). No real personal names appear here. The real-data results and the restorable PGAIR review backup were delivered outside the repository.

## What was built

| Area | Main changes | Notes |
| --- | --- | --- |
| Meeting data model and import | Person links on motions, attendance, tasks, committee members and conflicts. Per-body quorum rules. Agenda item number, requested action, time and consent fields. Action status enum. Meeting date precision, local times and time zone. Next meetings. Signing-authority tiers. External host bodies. Motion outcome synonyms and vote validation. Meeting identity by date + body, with draft/approved/copy variants folded into source versions. Role words never become attendees. Repair action for existing imports. | [wp-b](implementation-notes/wp-b-import-core.md) |
| Gap identification | Typed system gaps (`representationGaps`). Governance expectations with a BC Societies Act rule pack. Continuity engine: record gaps per body and period, cross-references to missing minutes, period marks for never held, cancelled or waived. Coverage & gaps page. Dashboard checks. Unsupported-details badges. Committee kind, cadence and mandate versions. "Held — minutes missing" and "Cancelled" meeting states. | [wp-c](implementation-notes/wp-c-gaps.md) |
| AI-led intake | Intake tables, per-class zod schemas and a source locator on every value. DOCX/PDF/XLSX/MSG/DOC extraction that keeps tables and columns. Junk filtering, duplicate and version clustering, classification. Schema-constrained LLM extraction through the configured provider, with a deterministic fallback, PII redaction and restricted classes never sent. Quote re-verification. People and body resolution. Reconciliation. Extractors for every governance class. In-app runs (`/app/intake`), three-pane review with bulk accept and undo, promotion with field provenance, View source. | [wp-d](implementation-notes/wp-d-intake-pipeline.md), [wp-l](implementation-notes/wp-l-intake-extractors.md), [wp-j](implementation-notes/wp-j-intake-ui.md) |
| Meetings and minutes interface | Edit meeting. Attendance grid with person pickers. Mover and seconder pickers. Bulk outcomes. Merging duplicate meetings. Review filters and bulk actions. Readable Word and PDF exports. Date-only meetings never show a clock time. | [wp-g](implementation-notes/wp-g-meetings-ui.md) |
| People, members, tasks, committees | Person merge with undo, and fuzzy duplicate suggestions. Re-linking keeps history. Organization members with representatives and terms. Historical source actions kept separate from current tasks. Committee rosters with person pickers and terms. People directory scoped to the workspace. | [wp-h](implementation-notes/wp-h-people.md) |
| Documents and import review | Cross-session review queue with keyboard flow and risk ordering. No hidden document categories. Document versions and duplicates. Previews from saved originals. Safe PDF/DOCX preview. "Transposed" review status. | [wp-i](implementation-notes/wp-i-documents.md) |
| Governance and compliance | All 30 governance findings. Includes bylaw amendment creation, special-resolution threshold checks, AGM-evidence-aware obligations, consistent annual cycle, and validated registers. | [wp-e](implementation-notes/wp-e-governance.md) |
| Finance and operations | Grant archive instead of a cascading delete. Accounting backfill review with a suspense account. Not-found pages. Validation on every create form. Financial statements "presented at" meeting. | [wp-f](implementation-notes/wp-f-operations.md) |
| Platform | Rich-text editor that mounts reliably, with a fallback. Record-table filter. Local-calendar date handling. Global search across records. French shell. Phone tables. Page error boundaries. Typed dates in date pickers. | [wp-a](implementation-notes/wp-a-platform.md) |
| Full-archive scale | Bulk reviews are stored as batch rows. Provenance is kept by reference instead of copying values. A "Compact this intake run" action removes staged copies and spent extracts. Backup export and restore stream large archives in chunks (format version 2; version 1 stays readable everywhere). Intake tables load lazily at boot. Import sections apply per record, with a blocked-records panel (link, retry, defer, skip), and waiting records apply once their parent exists. Minutes embedded in packages go through intake review with provenance. A full review of the PGAIR archive (91,604 fields, 1,082 documents promoted) exports and restores in 40 s with identical counts. | [scale](implementation-notes/full-archive-scale.md) |
| Agreements register | Agreements with parties, signatories, term and renewal, money, deliverables and reporting, documents and version chain, links to grants, providers, committees and the approving motion. Signing-authority tier check. Generated deadlines. Renewal/report checks on Coverage & gaps. Dashboard card for agreements expiring in 90 days. Import key `agreements`, and intake now promotes native draft agreements. On the PGAIR backup, one conversion turned the 104 contracts (plus 5 signed funding agreements) into 78 draft agreements with sources. | [agreements](implementation-notes/agreements-register.md) |
| Performance | Heavy fields stored lazily. Indexed local row store. Table-scoped query refresh. Memoized projections. Lazily loaded handler domains. On the PGAIR workspace in a production build, every main page loads in under 3 s, down from 7–16 s or a crash. | [wp-k](implementation-notes/wp-k-performance.md) |
| Re-test fixes | Five area re-tests, plus final fixes and polish: about 130 further fixes. Examples: motion typing, section saves that dropped links, and the merge default. | [retest notes](implementation-notes/) |

## Using the AI-led intake

1. Open **Intake** (`/app/intake`) and choose a folder or files; on the desktop app, choose a folder on disk.
2. The run filters junk, groups duplicates and versions, classifies every file and extracts each record with a source locator per value. In a local workspace it runs in the browser. With an AI provider configured in the AI settings, the LLM handles extraction. Otherwise the deterministic extractor runs.
3. Review the run in the three panes: the queue, the source with the quoted span highlighted, and the native fields.
   - Use **Bulk accept** for values that are stated, span-verified and above the confidence threshold. It has a sample preview and undo.
   - Resolve names in the entity panel.
   - Mark anything the app cannot hold as **Can't represent**, which records a system gap.
4. Run **Promote** or **Promote all ready**. Records land in the native registers, each field with provenance (**View source**), and the source documents become **Transposed**.
5. Open **Coverage & gaps**. It shows the record-continuity heat-map, the record gaps against the expectations (confirm or edit them; the BC rule pack is a starting point), and the backlog of system gaps.

The command-line runner (`npm run intake:run`) processes large archives and writes a validated import bundle with a coverage report.

## PGAIR re-transposed with the new pipeline

The source folder was downloaded again: 5,226 substantive files (7.6 GB) out of 10,196 entries. The pipeline ran with the deterministic engine, because no LLM key was available. Its output was staged into a fresh workspace and exported as a restorable review backup. The backup restores into a clean profile with identical tables, rows, ids and files.

| Measure | Old transposition | New |
| --- | ---: | ---: |
| Files extracted / transposed natively | 153 / 153 | 2,033 / 1,609 |
| Meetings | 142 | 262 |
| Duplicate date+body meetings | 26 | 0 |
| Titles that were file names | 84 | 0 |
| Meetings with location / start time | 0 / 0 | 237 / 203 |
| Motions / with outcome / with mover and seconder | 37 / 0 / 0 | 153 / 141 / 61 |
| Detailed attendance rows (person-linked) | 0 | 1,874 (1,872) |
| Role or organization strings counted as people | 625 | 0 |
| Action items / with owner | 467 / 0 | 2,675 / 2,308 |
| Policies / bylaw rule sets / grants / filings | 0 / 0 / 0 / 0 | 71 / 9 / 149 / 10 |
| Field provenance rows | 0 | 10,929 |
| Quotes re-verified / mismatches | — | 145,224 / 2 |
| Native coverage of extracted facts | — | 94.6% |

Two private reference sets, kept outside git, grade the result:

- **Minutes (15 documents):** motion recall and precision 100%; mover, seconder and outcome 100%; attendance recall 99.6%; header fields 99.3%; action items 93%; no hallucinated quotes.
- **Other classes (42 documents):** 100% on the 29 tuning documents and 92.4% on the 13 held out; classification 99.6%.

### Record gaps found in PGAIR's own history

- AGM minutes are missing for several years.
- Annual-report filing evidence is missing for most years from 2009 to 2021.
- Six sets of minutes are cited as adopted but are absent from the archive.
- 64 meetings are evidenced only by an agenda or package.
- 57 sets of minutes survive only as drafts.
- 86 policy versions have no adopting motion.
- The fiscal year end changed several times; confirm it was approved.
- The Operations Committee falls short of its monthly cadence in most years.

Each gap appears on the Coverage & gaps page with its evidence.

## Still open

- **OCR:** 605 scanned PDFs need OCR before they can be extracted.
- **Legacy Office files:** 147 could not be converted, and about 180 files have no extractor (`.xps`, `.nib` and others).
- **Documents page under load:** `/app/documents` measured 3.4 s against the 3 s perf gate while other jobs loaded the machine. The unchanged base build also missed the gate under the same load. It is under 3 s on an idle machine.
- **Low-confidence fields:** chair, meeting type and adopts-minutes links fall below the bulk-accept threshold. An LLM pass or calibrated thresholds would lift them.
- **Untested paths:** a live LLM provider call and a hosted-Convex intake run were never exercised end to end (no key or deployment was available). Both are typechecked and covered by mocks.
- **French:** page bodies, toasts and dialogs are still in English. The navigation, headings and settings are translated.
- **Firefox and live-lab suites:** these could not run in this environment.

## Assumptions made without sign-off

All of these are recorded in the implementation notes.

- **BC rule pack:** the citations were checked against the current Act, and the pack stays marked draft. PGAIR's quorum values were entered as labelled assumptions because its bylaws text was not in the reviewed sample.
- **Historical actions:** these are source observations, not current tasks, and they never count as open work.
- **"Transposed" review status:** it means the contents were reviewed into native records. It is not approval of the document.
- **Statement of directors:** it maps to the "change of directors" filing kind.
- **Organization time zone:** it defaults to the home province (America/Vancouver for BC) when none is set.
- **Promotion:** only values a person accepted, or that bulk-accepted under the documented rules, are promoted. Conflicting values stay pending.
