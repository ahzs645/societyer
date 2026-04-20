---
name: societyer-document-intake
description: Use when extracting or transposing documents into Societyer, especially Paperless-ngx OCR, scanned minutes, filings, finance documents, grants, privacy/HR records, or reviewed JSON bundles for /app/imports.
---

# Societyer Document Intake

Use this skill to help an AI decide what Societyer can accept from source documents and how to stage it safely.

## Required Workflow

1. Read the relevant support references before creating a bundle:
   - `references/group-routing.md` for high-level document routing, source cues, and safety rules.
   - `references/page-field-support.md` for page-by-page fields and support levels.
   - `references/transposition-catalog.json` for machine-readable bundle keys, record kinds, target tables, and accepted payload fields.
2. Prefer the `/app/imports` review pipeline for document-derived data:
   - `importSessions.createFromBundle` stages reviewed JSON.
   - `paperless.createMeetingMinutesImportSession` stages meeting-minute OCR.
   - `paperless.createDiscoveryImportSession` stages source document candidates.
   - `paperless.createTransposedImportSession` stages section-native records.
3. Do not treat extraction as final data entry. Stage records as `Pending`, include confidence, source IDs, and review notes, then require a human to approve before applying.
4. Use ISO dates (`YYYY-MM-DD` or ISO datetime where the app expects one) and store money as integer cents.
5. Preserve provenance on every document-derived record with `sourceExternalIds` such as `paperless:123`, and include a source record when possible.

## Native Import Record Kinds

Societyer's import session pipeline supports these record kinds:

- Organization/history: `source`, `fact`, `event`, `boardTerm`, `motion`, `budget`
- Meeting-specific: `meetingMinutes`, `meetingAttendance`, `motionEvidence`
- Document catalog: `documentCandidate`
- Section records: `filing`, `deadline`, `publication`, `insurancePolicy`, `financialStatement`, `financialStatementImport`, `grant`, `recordsLocation`, `archiveAccession`, `boardRoleAssignment`, `boardRoleChange`, `signingAuthority`, `budgetSnapshot`, `treasurerReport`, `transactionCandidate`, `sourceEvidence`, `secretVaultItem`, `pipaTraining`, `employee`, `volunteer`

If a page is not listed as a native import target, do not invent a target. Use `documentCandidate`, `sourceEvidence`, or a clearly marked manual follow-up task.

## Privacy Gates

- Raw secrets, passwords, recovery keys, certificate bodies, SINs, payroll source documents, banking details, and screening results must not be pasted into public or general notes fields.
- For credential material, create only a `secretVaultItem` external reference. Do not place the secret value in `secretEncrypted`; humans should enter encrypted material through the app UI.
- For restricted records, use `sensitivity: "restricted"` and avoid raw OCR excerpts unless the reference catalog explicitly allows it.
- Publications and transparency records must be reviewed separately before making anything public.

## Output Expectations

When asked what a document can transpose, answer with:

- the most likely document group;
- supported target record kinds;
- exact payload fields the app can accept;
- fields that are present in the document but unsupported today;
- privacy or confidence flags;
- a sample import-session JSON bundle only when the user asks for bundle output.
