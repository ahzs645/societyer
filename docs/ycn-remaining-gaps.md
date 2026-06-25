# YCN → Societyer: Deep Re-Audit — What Genuinely Remains

A fresh, field-level pass over the **actual source** (not the prior backlog):
all 19 Access tables (`DBS_YCN_CRS_Sample_V2xx.accdb`) column-by-column and
every `Doc -*` generator sheet from `01__Master_V201`, cross-checked against the
current implementation on `claude/excel-database-analysis-ubftpj`.

> Method note: this re-audit was run as a 5-agent workflow; the four extraction
> agents completed (their raw `Doc-*` dumps are preserved) but the synthesis
> agent died before persisting a report. The synthesis below was completed
> directly by diffing the recovered Access schema + Doc sheets against the live
> `convex/tables/*.ts`, `shared/*.ts`, and packet catalogs.

## Verdict

**Structurally complete.** Every Access column with product meaning and every
document sheet now maps to an implemented feature. The residue splits into one
item with real value, one with modest value, and a tail of correctly-deferred
mechanics.

## Field-level coverage (the part that matters)

Confirmed *implemented* by direct grep against the live schema:

| Access source | Field(s) | Lands in |
|---|---|---|
| `CORP_SETTINGS` | AGM_MONTH/DAY, FIN_MONTH/DAY, WAIVE_PREP_FINANCIALS, CONT_PRIM_*, CONT_ALT_*, LOC_MIN_BOOK, LOC_SEAL_ETC, DOC_PREP_LANGUAGE, RESTRICT_PEOPLE_YND, RESP_LWYR | `society.updateComplianceSettings` (primaryContact*/alternateContact*/minuteBookLocation/sealLocation/docPrepLanguage/restrictPeoplePicker/responsibleLawyer) |
| `CORP_NAME` | CORP_NAME, SHORT_NAME, START_DT_TM | `societyNameHistory` + `societies.shortName` |
| `CONSTATING` | JURISDICTION, LEGISLATION, REG_ACTION, REG_NUMBER, START_DT_TM | `constatingEvents` |
| `REG_FILING` | REGN_NAT, REGN_LEG, FILE_YEAR, FILE_DT_TM | `annualFilingLedger` (regnNature/regnLegislation) |
| `SHARE_TRANS` | SHR_CERT, SHR_CERT_REPL, CANCEL_DT_TM, SHR_CONSID_*, ISS_TYP | `shareCertificates` + `equityLedger` (certificateNumber/replacesCertificateNumber/considerationType) |
| `SHARE_CAPTL` | SHR_SINGLE, VOTING | `rightsClasses.singularForm` |
| `DIVIDEND` | DIV_PER_SHARE, DIV_CURRENCY, DIV_TOTAL | `dividends` (per-currency totals) |
| `ENT_PEOPLE` | SIGN_ORDER, INFO_STR/INFO_END, CORP_SIGN | `entitySigners` (signOrder/validFromISO/validToISO/corpSign) |
| `PEOPLE_DIRECTORY` | SERVICE_PROVIDER, INDIV_CUR_MAJ, INDIV_CUR_GENDER, CORP_SIGN | `peopleDirectory` (isServiceProvider/atAgeOfMajority/gender/corpSign) |
| `OFFICER` | PRES, SECR, OTHER | `roleHolders.additionalOfficerTitles` |
| `CORP_ASSETS` | ASSET_JUR, ACQ_FROM, DISP_TO, ACQ/DISP_CURRENCY, *_COMMENTS | `assets` (acquiredFrom/disposedTo/assetJurisdiction/dual currency/comments) |
| `BUS_ADDRESS` | ADDRESS_1..8, CONTACT_1/2, START_DT_TM | `organizationAddresses` (business_address type, contacts, freeformLines) |
| `TRANSPARENCY_REG` | BIRTH, CITIZEN, TAX_RESIDENT_YN, REASON, END_DT | `significantIndividuals` (dateOfBirth/citizenship/taxResidentHomeJurisdiction/reason) |
| `REG_OFFICE`/`REC_OFFICE` | ADDRESS, START_DT_TM | `organizationAddresses` + `registerHistory.addressesAsOf` |
| `Retain_List` | CORP_NAME, ENT_ID, CORP_NUM | Portfolio (multi-entity) view |

No product-meaningful column is unmapped.

## What actually remains

### Tier 1 — real value, worth doing: the Annual Consent Resolution body

The `annual-resolutions` packet **exists**, but its body is a two-line stub
("The corporation records annual approvals…"). The YCN `Doc - Annual` sheet —
the single most-used document in the system — renders **six grammar-aware
operative clauses** as a combined instrument, producing *both* a shareholders'
consent resolution and a directors' consent resolution:

1. Approve the financial statements **OR** waive the requirement to produce them
   (branches on `WAIVE_PREP_FINANCIALS`), with sole/plural shareholder grammar.
2. Fix the next fiscal year-end.
3. Appoint the auditor **OR** waive the auditor appointment.
4. Ratify all lawful acts of the directors in the preceding 12 months.
5. Appoint the director slate "until successors are elected or appointed."
6. Deem the AGM to have been held on the resolution date.

We already have every input (FYE via `corporationSettings`, the director slate,
`waivePrepFinancials`, the NLG plurality engine). The gap is purely the **clause
text**: porting these six branches into the packet `sections` so the generated
annual document is a real consent resolution instead of a placeholder. This is
the highest value-to-effort item left — small, self-contained, high use.

### Tier 2 — modest value: annual bundle / action→document dispatcher

YCN's `Document_Package_Annual` emits the whole annual package as one click, and
`Document_Package_Transactions` routes a chosen action to the right Doc sheet.
We have all the individual packets and the `generateDocumentFromCatalog` action;
what's missing is the orchestration layer (one action that fans out to several
packets, or an action→packet picker). Genuine convenience, not a capability hole.

### Tier 3 — correctly deferred (confirmed absent, no product value)

Verified still-absent and appropriately skipped:

- **Provenance columns** `ENTRY_BY` / `REVISE_BY` printed in each register
  (Convex tracks its own audit trail; the per-row author columns are an Access UX
  detail).
- **`REG_POSN`** manual register sort position — hand-curated ordering.
- **`FIRM_ID`** stable service-provider identifier for cross-entity dedup.
- **`DOC_MGMT_YN` / `DOC_MGMT_DIRECTORY`** — the Windows output folder for written
  `.docx` files; Societyer's document-storage provider is the web/desktop analog.
- **BC Land Owner Transparency Report** (User-Custom 19) — niche property-law form.
- **Annual covering letter** (User-Custom 10) — trivial transmittal template.
- **Per-class vs consolidated print layouts** (User-Custom 15–20) — Excel layout modes.
- **Revision-tracking purge** — Access compaction admin.

## Recommendation

One thing is worth implementing: **flesh out the `annual-resolutions` packet body
with the six real YCN clauses** (Tier 1). It turns the most important annual
document from a stub into the actual instrument, reuses the grammar engine and
data we already have, and is a contained change. Everything else is either
orchestration sugar (Tier 2) or correctly out of scope (Tier 3).
