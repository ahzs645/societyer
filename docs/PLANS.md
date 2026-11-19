# Document-linked business records

One milestone. Add a typed supplementary register with links to authoritative records. Start with notices and director consent. Reuse existing ledger, people, documents and operational records. Extend dated records through later entries and preserve older rows. Open the register from Organization and the two primary domain pages. Verify save and subsequent read using the normal form/API path and two runtime adapters where available. Use current BC Laws sources and separate rules by existing legal profile.

- SH — Ledger-linked numbered uncertificated notice with delivery and restriction fields; recording does not post shares
- DC — Director-linked dated consent, acknowledgment, withdrawal and historical entries; saving does not end a term
- CH — Purpose-specific contact channels with dates and custodian
- PO — Mailbox details linked to existing address and rental agreement, including pickup authority and renewal
- BK — Bank relationships and client-card specific access and daily limits linked to existing banking/card records
- GD — Governance decision scope, dates and applicable financial period linked to resolution
- TX — CRA account metadata references an existing identifier
- FO — Recognition timestamp, zone and completing party reference a registration
- SU — Unissued subscription details reference an existing share class and can link resulting issuance
- EV — Each kind supports an optional readable document and source page; IDs checked against expected table and tenant, per-kind read/write permissions enforced on hosted and portable paths
- JR — Share-only options gated to corporations; BC company source guidance selected separately via jurisdiction profile and absent for other profiles

Verification: npm run convex:typecheck; npx tsc -b; npx tsx scripts/check-business-evidence.ts; portable manifest check; UI save/reload check.
