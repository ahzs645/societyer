# Published filing schemas

These are unchanged CRA information-return XSD packages and the Service Canada payroll extract v2.0 schema, downloaded from the official URLs in `sources.json` on 2026-10-23. Archive SHA-256 hashes are recorded there. CRA submission schema versions are distinct from the earnings/taxation year: the 2026 submission version is accepted through December 22, 2026; the 2027 version starts January 11, 2027. Government availability dates do not prevent preparing a file for review.

`fieldMaps.json` maps published additional-information box codes to actual XSD element names and types, cross-checked against CRA's version-specific T4/T4A specification pages. Unsupported legacy/nonmonetary fields produce explicit errors, rather than an invented XML element. T4 filing currently supports CPP/CPP2 jurisdictions; Quebec QPP/QPP2 requires a separate supported calculation and is explicitly blocked. T4A classification must be reviewed from the actual relationship, never inferred from an honorarium label.

`npx tsx scripts/check-payroll-reporting.tsx` generates synthetic fixtures, validates both CRA versions and ROE with the actual XSDs using Python `lxml`, then renders and reads the native branded pay-statement PDF. Install `lxml` in the verification environment if it is unavailable. No live identifiers are used. The CRA dependency tree is retained because the official entry points include the common complex types for all supported returns.

An XSD validates structure, not all filing business rules. The pure exporters also validate reviewed mandatory fields, SIN/BN checksums, exemption/dental codes, amount sizes, source completeness, legal-employer and currency assertions, exact CPP2 fields, RPP classification, consecutive ROE periods/hours, reason/recall dates and separation payment rules. External filing portal history and acceptance remain subject to authorized review. Generating/downloading a file never submits it.

Identifiers enter only the transient filing form and generated file. They are excluded from immutable payroll snapshots, statement DTOs, URLs, logs and persistent browser storage.
