# Complete source meeting records

Imported minutes can keep a complete, cited source representation alongside their editable agenda, motions, decisions and tasks. `minutes.sourceMeetingRecord` stores the literal header and participant observations, ordered paragraphs and tables, embedded images, linked original documents, and the boundaries of the selected meeting within a larger package. Source observations do not establish legal membership or approval.

`minutes:completeSourceRecords` enriches existing, linked source documents through the shared portable mutation and Convex wrapper. It checks society ownership, minutes editing permission, document read access, and ordered coverage of both the selected meeting and the full package before any writes. It preserves existing editable fields and skips adopted records. The private test migration adds metadata without replacing the user's browser database.

Private exports use the complete source body once by default. Related package material is identified separately. Later changes to editable sections, metadata, motions or tasks appear as supplements, compared with the original import baseline. Every private style uses the same source representation. Public copies omit unrestricted source documents and apply the normal redaction policy.

Draft and imported records may be exported without a chair, secretary or minute-taker. Missing officer details do not become invented facts. Approval and adoption retain their separate authority and immutable snapshot checks.

The Minutes view shows readable source metadata. Sources contains original-file access and the extraction audit. Verified original downloads check each part and the complete file's SHA-256. The private test Site serves these assets under `/test-data/source-record-v3/originals/`; an offline application must provide the accompanying asset folder for those downloads. Rebuilt exports retain source wording, tables and raster images; original fonts, exact pagination and vector artwork remain available in the unchanged originals.

Word exports preserve source figure sizes within printable margins. Web PDF export embeds licensed Unicode fonts, includes symbol glyphs and keeps searchable source text instead of replacing unsupported letters with question marks. The browser Print command and desktop printing remain available.

Validation: `npm run test:source-meeting-record`, `npm run test:source-minutes-transposition`, `npm run test:meeting-governance`, minutes approval/snapshot and source-access suites. The private review additionally checks all meeting Word and PDF artifacts against full source text, native block text, tables and embedded images, and restores the exported database into fresh IndexedDB.
