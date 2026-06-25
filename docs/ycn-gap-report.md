# YCN → Societyer: Not-Yet-Incorporated Gap Report

## 1. Executive Summary

The biggest genuinely-missing capabilities cluster in four areas. First, **share-certificate lifecycle**: YCN tracks physical certificate numbers and replacement/cancellation chains and renders certificate-issuance and share-transfer resolutions — Societyer's equity ledger models signed quantities but has no certificate concept and no transfer/certificate documents. Second, **effective-dated corporate-name and constating-document history**: YCN keeps a dated register of every legal name (with its "short name" defined-term) and every constituting statute event (incorporated → transitioned → continued), point-in-time-resolved into generated documents; Societyer stores only the single current name and has no constating timeline. Third, **a directory→entity linking step and entity cloning** for onboarding. Fourth, a set of **missing document instruments** (dividend declaration, share transfer, change-of-office, director removal, BC LOTR, blank all-shareholders/all-directors resolutions) even where the underlying data is already modeled. Most other findings are narrow field gaps (asset acquire-from/dispose-to counterparties, dual currency, officer multi-title) or pure Excel/persistence mechanics that carry no product value.

## 2. Prioritized Gap Table (deduplicated, COVERED_ELSEWHERE dropped)

| Gap | Source location | What it adds | Status | Value | Effort |
|---|---|---|---|---|---|
| Share certificate # + replacement/cancellation chain | DB_GLOB_SHARE_TRANS.SHR_CERT / SHR_CERT_REPL | Physical cert numbering + surrender/replacement register | NOT_COVERED | high | M |
| Share Certificate issuance resolution | Doc - Share Certificate | Document certificating previously-issued shares | NOT_COVERED | high | M |
| Share Transfer resolution (issue new / cancel old cert) | Doc - Share Transfer | Transferor→transferee approval + cert cancellation doc | PARTIAL | high | M |
| Dividend Declaration director resolution | Doc - Dividends | The legal declaration instrument (data already modeled) | PARTIAL | high | S |
| Per-year / per-jurisdiction annual-filing ledger | DB_GLOB_REG_FILING.FILE_YN/FILE_YEAR/FILE_DT_TM | Append-only year-by-year filing history per jurisdiction | PARTIAL | high | M |
| Asset acquire-from / dispose-to counterparties + dual currency | DB_GLOB_CORP_ASSETS.ACQ_FROM/DISP_TO/ACQ_CURRENCY/DISP_CURRENCY | Named counterparties each side; independent acquire vs dispose currency | PARTIAL | high | M |
| Add directory person → entity role holder (one-click) | VBA Name_Add_From_GLOB_PEOPLE_DIRECTORY | Materialize directory entry as entity-scoped person/role | PARTIAL | high | M |
| Blank "all shareholders / all voting shareholders / all directors" resolution shells | User - Custom 1/2/3 | Signatory-plurality grammar + EN/FR boilerplate | PARTIAL | high | S |
| BC Land Owner Transparency Report (LOTR) | User - Custom 19 | Property↔interest-holder join w/ SIN/tax-residency | PARTIAL | high | M |
| Corporate name history + point-in-time resolver (+ per-name SHORT_NAME) | DB_GLOB_CORP_NAME (CORP_NAME/SHORT_NAME/START_DT_TM) | Dated name register + defined-term token into NLG | NOT_COVERED | high/med | M |
| Constating-documents register (incorp→transition chain + legislation) | DB_GLOB_CONSTATING | Dated regime lineage + "governed by [Act]" clauses | NOT_COVERED | high | M |
| Entity cloning (deep copy → new society) | VBA Copy_Entity_* | Pre-populate new corp from a similar/template entity | NOT_COVERED | medium | M |
| Annual document bundle (one-click multi-section) | VBA Document_Package_Annual | Whole annual package assembled as one deliverable | PARTIAL | medium | M |
| Transaction-routed document dispatcher (9-way action→template) | VBA Document_Package_Transactions | Canonical action→doc mapping (several templates missing) | PARTIAL | medium | M |
| Business-address register w/ named contacts + 8 free-form lines | DB_GLOB_BUS_ADDRESS (ADDRESS_1..8/CONTACT_1/2) | Operating address w/ contact person(name+role) distinct from legal offices | PARTIAL | medium | M |
| As-of resolver generalized to names/offices/constating/filings | Excel START_DT2/END_DT2 pattern (all registers) | One global as-of date slices every register, not just people | PARTIAL | medium | M |
| Office address history wired to as-of resolver | DB_GLOB_REG_OFFICE/REC_OFFICE.START_DT_TM | Point-in-time address resolution (schema supports, not wired) | PARTIAL | medium | S |
| Officer multi-title flags (PRES/SECR/OTHER concurrent) | DB_GLOB_OFFICER.PRES/SECR/OTHER | One person President+Secretary+Other in one record | PARTIAL | medium | M |
| Share Subdivision / Consolidation (split) resolution + event | Doc - Share Split | Split/reverse-split ratio engine + resolution | NOT_COVERED | medium | M |
| Change of Registered/Records Office resolution | Doc - Change Offices | Office-change resolution (triggers notice filing) | NOT_COVERED | medium | S |
| Director removal/resignation resolution | Doc - Appt Directors (remove branch) | Inverse of appointment | PARTIAL | medium | S |
| Asset Transfer (acquire/dispose) director resolution | Doc - Asset Transfer | Resolution authorizing acquire/dispose (RE vs equipment) | PARTIAL | medium | M |
| Corporation contact persons (primary/alternate name/phone/email) | DB_GLOB_CORP_SETTINGS.CONT_PRIM_*/CONT_ALT_* | Records-manager contacts on the corp | NOT_COVERED | medium | S |
| Physical record locations (minute book / seal) | DB_GLOB_CORP_SETTINGS.LOC_MIN_BOOK/LOC_SEAL_ETC | Statutory records-location disclosure | NOT_COVERED | medium | S |
| PeopleDirectory: service-provider flag, majority, gender, CORP_SIGN | DB_GLOB_PEOPLE_DIRECTORY | Grammar drivers (pronoun/capacity) + signature prefix | PARTIAL | medium | S |
| Per-entity signer roster (ENT_PEOPLE: PERS_ID↔GLOB_ID, SIGN_ORDER, validity window, CORP_SIGN) | DB_GLOB_ENT_PEOPLE | Signature-block engine's per-corp signer mapping | PARTIAL | medium | M |
| Share-class singular display form (SHR_SINGLE) | DB_GLOB_SHARE_CAPTL.SHR_SINGLE | Hand-authored singular for NLG ("1 Common Share") | PARTIAL | medium | S |
| Constating reg nature/legislation per registration (REGN_NAT/REGN_LEG, "Transition") | DB_GLOB_REG_FILING.REGN_NAT/REGN_LEG | Registration nature label + per-reg legislation | PARTIAL | medium | S |
| Asset jurisdiction (ASSET_JUR) | DB_GLOB_CORP_ASSETS.ASSET_JUR | Legal situs of asset (location is free-text only) | PARTIAL | low | S |
| Share consideration symbol vs ISO / Allot-vs-Transfer vocab | DB_GLOB_SHARE_TRANS.SHR_CONSID_*/ISS_TYP | Currency-symbol + issue-type vocabulary | PARTIAL | low | S |
| Cancellation date on issuing transaction (CANCEL_DT_TM) | DB_GLOB_SHARE_TRANS.CANCEL_DT_TM | Denormalized cancel date on issuance row | PARTIAL | low | S |
| Per-row provenance (ENTRY_BY/REVISE_BY) | All DB_GLOB_* | Human author/reviser printed in register audit cols | PARTIAL | low | M |
| REG_POSN manual register ordering | Most DB_GLOB_* | Hand-curated sort position independent of date | NOT_COVERED | low | S |
| Responsible-lawyer / file-owner (RESP_LWYR) | Retain_List | Internal file accountability / portfolio list | NOT_COVERED | low | S |
| Service-provider FIRM_ID stable identifier | DB_GLOB_SERVICE_PROVIDERS.FIRM_ID | Same-firm dedup across societies | PARTIAL | low | S |
| Doc-mgmt settings / DOC_PREP_LANGUAGE / RESTRICT_PEOPLE_YND | DB_GLOB_CORP_SETTINGS | Per-society language, people-picker scope, output dir | NOT_COVERED | low | S |
| Blank-entity overwrite guard + formation-date seed | VBA New_Entity_* | Warn-before-replace + formation timestamp seed | PARTIAL | low | S |
| Batch multi-clone loop | VBA Multiple_Copy | Spin up N corps from one template | NOT_COVERED | low | M |
| Custom doc from arbitrary user sheet | VBA Document_Package_Custom | Free-form template render escape hatch | NOT_COVERED | low | M |
| Revision-tracking purge (compact superseded rows) | VBA Delete_Revision_Tracking_Records | Admin purge of tombstoned prior revisions | PARTIAL | low | S |
| Covering letter for annual documents | User - Custom 10 | Client transmittal letter | NOT_COVERED | low | S |
| Per-class vs consolidated register printouts | User - Custom 15/16/17/18/20 | Layout-mode for printable allotment/transfer/director registers | (layout only) | low | S |
| Transparency CITIZEN free-text / ceased-with-reason in as-of view | DB_GLOB_TRANSPARENCY_REG | Mixed-semantics citizenship + cessation surfacing | PARTIAL | low | S |

**Dropped as COVERED_ELSEWHERE (considered, not gaps):** Service Providers register, Dividends register (data), Transparency diligence steps, Corporate Information Summary doc (thin layer over PointInTimeRegister), FIN_MONTH/FIN_DAY fiscal year-end, appoint-officer/director resolving-body distinction, DB_ID resequencing, entity index/picker, people-picker restriction toggle (referenceField), date-index dropdown maintenance, demo seeders, UI/conditional-format/email cosmetics.

## 3. Themes

### Theme A — Effective-dating & name/constating history
**YCN has:** dated registers for corporate names (each with its own SHORT_NAME defined-term), registered/records offices, and constating events, all sliced by one global as-of date via the START_DT2/END_DT2 next-row-interval pattern; the resolved name+short-name tokens flow into the grammar engine.
**Societyer lacks:** a name-history table (single scalar `societies.name`, no SHORT_NAME), a constating-event timeline (registrations carry no legislation/action-verb chain), and a generalized as-of resolver — `registerHistory.ts` only slices role-holders.
**Port sketch:** add `shared/effectiveDating.ts` exposing a generic `resolveAsOf(rows, asOfISO)` over `{effectiveFrom, effectiveTo}`; add schema tables `societyNameHistory(name, shortName, startISO, regPosn)` and `constatingEvents(jurisdiction, legislation, action, regNumber, startISO)`; `convex/nameHistory.ts` + `convex/constating.ts` with `*AsOf` queries reusing the generic resolver; wire resolved name+shortName into `societyRenderContext.ts`. New page `CorporateHistory` (name + constating + office change timelines). Generalize the existing `PointInTimeRegister` page to consume the new resolver for all registers.

### Theme B — Share-transaction detail & certificates
**YCN has:** certificate numbers and replacement chains (SHR_CERT/SHR_CERT_REPL), per-transaction cancel dates, singular share-class display forms, and certificate/transfer/split resolution documents.
**Societyer lacks:** any certificate concept in `equityLedger`/`rightsholdingTransfers`; `rightsClasses` has no singular form.
**Port sketch:** extend `shared/equityLedger.ts` transaction shape with `certificateNumber` + `replacesCertificateNumber`; add `singularForm` to `rightsClasses`; `convex/equityLedger.ts` mutations to issue/replace/cancel certificates and a certificate-register query; new packets `share-transfer`, `share-certificate`, `share-split` in `corporationDocumentPackets.ts` + renderers in `corporationPacketDocx.ts`. Page: extend the equity/shares page with a Certificate Register tab.

### Theme C — Document instruments (resolutions & letters)
**YCN has:** Doc sheets for dividend declaration, share transfer/certificate/split, change of offices, director removal, asset transfer, blank all-shareholders/all-voting-shareholders/all-directors resolutions (EN/FR), annual covering letter, BC LOTR; plus a transaction-routed dispatcher and one-click annual bundle.
**Societyer lacks:** packets for dividend declaration, transfer, certificate, split, change-of-office, director-removal, asset-transfer, the three generic signatory-plurality shells, the cover letter, BC LOTR, and any bundle/dispatcher orchestration.
**Port sketch:** add the missing packet definitions to `corporationDocumentPackets.ts` with `requiredSigners` encoding the resolving body (directors vs all/voting shareholders); add renderers to `corporationPacketDocx.ts` driving body text from `templateAssembly.ts`/`nlg.ts`; add a `shared/documentDispatcher.ts` mapping action→packet and a `shared/annualBundle.ts` that concatenates the annual packets into one document. Surface as an "Action → Generate" picker on the documents page.

### Theme D — Address/office model
**YCN has:** three distinct dated office registers (registered, records, business) where business address carries 8 free-form lines + two named contacts (name+role).
**Societyer has:** `organizationAddresses` with registered/records types and effectiveFrom/To, but no business-address type, no contact-person-on-address, and no as-of wiring.
**Port sketch:** add `business_address` to the address type enum plus optional `contacts: [{name, role}]` and `freeformLines`; reuse the Theme A generic resolver for address as-of; surface contacts in `organizationDetails` page.

### Theme E — Asset acquire/dispose detail
**YCN has:** acquired-from and disposed-to named counterparties, asset jurisdiction, independent acquire vs dispose currency, free-text comments.
**Societyer has:** `assets`/`assetEvents` with supplier, single currency, disposalMethod/Reason — no disposed-to buyer, no asset jurisdiction, no dual currency.
**Port sketch:** add `acquiredFrom`, `disposedTo`, `assetJurisdiction`, `acquisitionCurrency`, `dispositionCurrency`, `acquisitionComments`, `dispositionComments` to `assets`/`assetEvents`; mutations in `convex/` (or existing asset module); render in the assets page and the new asset-transfer packet (Theme C).

### Theme F — People, signers & directory linking
**YCN has:** a per-entity signer roster (ENT_PEOPLE: local PERS_ID↔global GLOB_ID, SIGN_ORDER, validity window, CORP_SIGN "By:"), officer multi-title flags (PRES/SECR/OTHER concurrent), directory person flags (service-provider, majority, gender, CORP_SIGN), and a one-click "add directory person to entity" action.
**Societyer lacks:** a directory→entity materialize mutation/link field, the per-entity signer mapping with sign order/validity/prefix, concurrent multi-title officers (single `officerTitle`), and majority/gender/CORP_SIGN on `peopleDirectory`.
**Port sketch:** add `directoryPersonId` to `roleHolders` + a `convex/peopleDirectory.ts` `addToSociety` mutation (copies identity fields, creates role holder); add `entitySigners` table (societyId, directoryPersonId, signOrder, validFromISO, validToISO, corpSign); add `isServiceProvider/atAgeOfMajority/gender/corpSign` to `peopleDirectory`; allow multiple officer titles via repeatable officer role rows or a `titles[]` array. Feed `entitySigners` (ordered, as-of filtered) into the signature-block grammar in `corporationPacketDocx`. Page: "Add from directory" action on roleHolders.

### Theme G — Entity lifecycle
**YCN has:** deep entity clone, blank-entity bootstrap with overwrite guard + formation seed, and batch multi-clone.
**Societyer lacks:** any cross-table clone/template-spin-up; normal society creation covers blank create but not warn-before-replace or formation seeding.
**Port sketch:** `convex/society.cloneSociety` mutation that, given a source societyId + new name, copies the relevant child tables (roleHolders, addresses, share classes, settings, etc.) under a new societyId; optional batch wrapper. Surface as "Clone corporation" on the society list.

### Theme H — Settings, contacts & filing ledger
**YCN has:** primary/alternate corp contacts (name/phone/email), physical record locations (minute book / seal), doc-prep language + people-picker scope, RESP_LWYR, and a per-year/per-jurisdiction annual-filing ledger with registration nature/legislation.
**Societyer lacks:** named contacts, record-location fields, language/scope settings, responsible-lawyer, and a per-year filing history (registrations hold only latest scalar).
**Port sketch:** extend `corporationSettings` (shared + convex + ComplianceSettings page) with `primaryContact`/`alternateContact`, `minuteBookLocation`, `sealLocation`, `docPrepLanguage`, `restrictPeoplePicker`, `responsibleLawyer`; add an `annualFilingLedger(societyId, jurisdiction, year, filedISO, filedFlag, regnNature, regnLegislation)` table + `convex/annualFilings.ts`; surface a per-jurisdiction filing-history view (extend filings/annualMaintenance page).

## 4. Top 5 Highest-Value Gaps to Close Next

1. **Share certificate lifecycle + transfer/certificate resolutions (Theme B/C).** Three high-value findings converge here: certificate numbering/replacement, the certificate-issuance resolution, and the share-transfer resolution. This is the single largest functional hole — Societyer can issue shares but cannot certificate, transfer-with-cancellation, or print a certificate register, which is core corporate-records work.
2. **Dividend declaration resolution (Theme C, effort S).** The data and math already exist (`dividends` module); only the resolution renderer is missing. Highest value-to-effort ratio in the report — a small packet unlocks a complete feature.
3. **Directory → entity person link (Theme F).** The directory and prefix search exist but cannot materialize a person onto a corporation as a role holder. This is the missing connective tissue that makes the global people directory actually useful for onboarding directors/officers/shareholders.
4. **Corporate name + constating history with point-in-time resolution (Theme A).** Without dated name history and the SHORT_NAME defined-term, generated documents always use today's name and cannot render "incorporated under X, transitioned to Y." This is foundational to correct historical document generation and reused by the office/registration as-of work.
5. **Per-year/per-jurisdiction annual-filing ledger (Theme H).** Currently only the latest filing scalar is retained; firms need the full append-only history of every annual filing per jurisdiction for compliance evidence and audit.

## 5. Considered but Intentionally Skipping

- **Excel/persistence mechanics:** DB_ID resequencing (Refresh_DB_ID_To_Database_Before_Saving), entity-index rebuild, date-index dropdown maintenance, people-picker validation-object swap — all Access/Excel artifacts with no web-app analog.
- **UI/screen cosmetics:** Set_Conditional_Format, Display_Headings, Font_Space_Setting — pure Excel formatting.
- **Licensing/email:** Send_Email, Send_Confirmation, trial-lock / grammar-engine trial mechanics — out of scope for the product.
- **Demo seeders:** Init_Register_Transparency canned sample rows.
- **Custom arbitrary-sheet doc render (Document_Package_Custom):** Excel power-user escape hatch, low priority.