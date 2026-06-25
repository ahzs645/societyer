# YCN Wiring Plan — turning dormant ports into live features

> Status: ✅ all five workstreams shipped on `claude/epic-turing-t0l6eq`.
>
> The through-line: every module below was already built and tested — it just had no
> consumer. Each workstream gave a dead module a real caller and shipped a
> user-visible feature. Ordered low → high risk.

## Shipped

| WS | Module(s) made live | Feature | Test(s) |
|---|---|---|---|
| WS4 | ycnDate | `.accdb` → import bundle adapter + YCN-aware cleanDate | check-ycn-access-import |
| WS2a | referenceField | restrictPeoplePicker directory enforcement | check-person-reference |
| WS2b | nlg (gender path) | gender + stated pronouns in generated documents | check-nlg-grammar |
| WS1 | shareSplit | subdivision/consolidation flow + before/after resolution | check-share-split, check-corporation-equity-ledger |
| WS3 | versionedRegister + registerDiff | role-holder edit-history + audit trail | check-role-holder-history, check-role-holder-revision-flow |

Plus: the YCN import apply path now persists `gender`/`pronouns` (WS4 → WS2b), so
imported directors render with correct pronouns.

## WS4+ · full Access-DB coverage (follow-on)

The first WS4 cut imported 5 register collections; a second pass brought in the
remaining `DB_GLOB_*` tables so the whole sample `.accdb` migrates (154 → 270 sample
records). New mappings in `shared/ycnAccessImport.ts`, new promotable section-record
kinds + apply handlers in the import pipeline (no static-mirror work — the static
bundle parser has a generic fallback and the apply step is a deferred no-op):

| Access table | → kind → table |
|---|---|
| TRANSPARENCY_REG | roleHolder (controller) → roleHolders (significance reason + tax-residency) |
| TRANSPARENCY_DUE | significantIndividualStep → significantIndividualSteps |
| SERVICE_PROVIDERS | serviceProvider → serviceProviders |
| DIVIDEND | dividend → dividends |
| CORP_NAME | nameHistory → societyNameHistory |
| CONSTATING | constatingEvent → constatingEvents |
| CORP_ASSETS | asset → assets |
| SHARE_TRANS (SHR_CERT) | shareCertificate → shareCertificates |

## Firm layer (multi-corporation)

The per-entity views match YCN and switching works (Portfolio = `Entity_Index`),
but YCN's cross-entity capability was missing. Added:

- **convex/firm.ts** — `overview` rolls up every entity's open/overdue deadlines +
  post-incorporation progress; `batchGeneratePacket` is the `Multiple_Copy`
  analogue (generate one packet across many entities, kind-gated so a corp packet
  skips societies). `generateDocumentFromCatalog`'s core was extracted to a
  reusable `generatePacketForSociety` helper.
- **Portfolio page** upgraded into a firm command centre: firm-wide totals, a
  per-entity status table (deadlines + post-incorp progress), one-click switch,
  and batch generation across selected entities. Mirrored in staticConvex.
- check-firm-flow covers the rollup, batch generate, and kind-gating.

---

A later pass closed the last two: `CORP_SETTINGS` (extracted → applied via
society:updateComplianceSettings by the runner) and the global `PEOPLE_DIRECTORY`
(extracted → peopleDirectory:upsert). Only `Retain_List` (a UI picklist) is left,
by design. **Every `DB_GLOB_*` table in the sample `.accdb` now imports.**

## Excel follow-ons (document-generation depth)

The `.xlsm` review found all 10 document *types*, all settings, and the NLG layer
already ported. The remaining gaps were generation *depth*, now closed:

- **Operative data in 6 packets** — appoint-officer/director, director-removal,
  share-transfer, share-certificate, change-of-offices, asset-transfer now bind
  their real register tables (shared/packetOperativeData.ts + buildPacketDataContext),
  with graceful English-prose fallback when empty.
- **Dividend reconciliation guard** — flags entered total ≠ per-share × shares.
- **Polish** — deterministic `short-name-doc-type-DATE.docx` naming, an opt-in
  document-ID header (FMT_Page_DOC_ID), and thousands separators (Num_Comma).
- **Bilingual (partial, honest)** — `docPrepLanguage` now drives a French
  execution/signature block (correct sole/plural agreement) and French long dates
  on generated resolutions (shared/locale.ts). Clause bodies remain English
  (fallback) pending proper legal-French authoring — no fabricated legal French.

## Dormant modules (tested, zero production consumers)

| Module | Test | Wired by |
|---|---|---|
| `shared/ycnDate.ts` | `check-ycn-date-codec.ts` | WS4 |
| `shared/referenceField.ts` | `check-reference-field-constraint.ts` | WS2a |
| `shared/nlg.ts` (gender path) | `check-nlg-grammar.ts` | WS2b |
| `shared/shareSplit.ts` | `check-share-split.ts` | WS1 |
| `shared/versionedRegister.ts` | `check-versioned-register.ts` | WS3 |
| `shared/registerDiff.ts` | `check-register-diff.ts` | WS3 |

The reference Access DB (`DBS_YCN_CRS_Sample_V2xx.accdb`) tables confirm the source
data each feature needs:

- `DB_GLOB_ENT_PEOPLE.GENDER`, `DB_GLOB_PEOPLE_DIRECTORY.INDIV_CUR_GENDER` → WS2b
- `DB_GLOB_CORP_SETTINGS.RESTRICT_PEOPLE_YND` (`Y`/`N`/`D`) → WS2a
- `*_DT_TM` float dates + `REVISE_DT_TM` supersede stamps on every `DB_GLOB_*` → WS4 / WS3
- `DB_GLOB_SHARE_TRANS.ISS_TYP` (`Allot`/`transfer`/…) → WS1

---

## WS4 · ycnDate → real YCN/Access import adapter (lowest risk — first)

**Feature:** import a real `.accdb` into a workspace through the existing staged
review → promote pipeline.

- `shared/ycnAccessImport.ts` — pure, framework-free: decode every `*_DT_TM` /
  `*_DT` float via `decodeYcnDate` (treat `isYcnNullDate` as null), drop superseded
  rows (`REVISE_DT_TM` set) unless asked otherwise, and map the YCN tables onto the
  import-bundle record kinds that already exist in `recordsFromBundle`:
  - `DB_GLOB_DIRECTOR` / `DB_GLOB_OFFICER` / `DB_GLOB_ENT_PEOPLE` → `roleHolders`
  - `DB_GLOB_SHARE_CAPTL` → `rightsClasses`
  - `DB_GLOB_SHARE_TRANS` → `rightsholdingTransfers`
  - `DB_GLOB_REG_FILING` → `organizationRegistrations`
  - `DB_GLOB_BUS_ADDRESS` / `REG_OFFICE` / `REC_OFFICE` → `organizationAddresses`
- `scripts/import-ycn-access.ts` — runner mirroring `import-ote-*.mjs`: `mdb-export`
  each table → build a bundle via the pure lib → either `--out bundle.json` (offline)
  or push to `importSessions.createFromBundle`.
- **Swap candidate:** teach `importSessionUtils.cleanDate` / `cleanDateTime` to
  recognise YCN floats (an 8-digit date previously degraded to `YYYY-01-01`).
- **Risk:** low — standalone, offline, no schema change. The sample `.accdb` is the
  test fixture.

## WS2a · referenceField → enforce restrictPeoplePicker (low risk)

**Feature:** a society can require that every director/officer/signer resolve to a
real directory person (no free-text typos), via the setting that is currently
stored-but-never-read (`society.restrictPeoplePicker`, YCN `RESTRICT_PEOPLE_YND`).

- `shared/personReference.ts` wraps `referenceField`, maps the setting → strict/free.
- Consumed by `upsertRoleHolder` (new `directoryPersonId` arg), `entitySigners.upsert`,
  and `addToSociety`. Defaults to free → existing data untouched; opt-in only.

## WS2b · gender & pronouns → make the NLG engine actually work (highest delight)

**Bug (verified):** `roleHolders` has no `gender` field, `upsertRoleHolder` never
persists it, and `addToSociety` doesn't copy it from the directory, so
`buildSocietyRenderContext.toActor` always reads `undefined` → every director renders
as "they/their" regardless of stated gender.

- Add `gender` to `roleHolders` (+ persist + copy from directory).
- Add stated `pronouns` (he/him, she/her, they/them, or custom like xe/xir) to
  `peopleDirectory` + `roleHolders`; extend `Actor` in `nlg.ts` with optional
  `customPronouns` overriding the M/F/X derivation.
- Collect both in the People Directory + role-holder forms; feed through `toActor` →
  `actorGrammar` → execution block + resolution bodies.

## WS1 · shareSplit → real subdivision / consolidation flow (medium risk)

- Add `subdivision` / `consolidation` to the `transferType` vocabulary
  (`equityLedger.ts` + `orgHubOptions`).
- `stageShareSplitPacket` mutation mirroring `stageShareIssuancePacket`:
  `validateRatio` → `applyRatioToHoldings` → post adjusted holdings → stage the packet.
- Inject `describeRatio()` + before/after holdings into the packet body.
- **Risk:** medium — splits are class-wide; `Math.floor` consolidations can drop
  fractional shares (surfaced).

## WS3 · versionedRegister + registerDiff → edit-history & audit trail (highest risk)

- Adopt the bitemporal supersede model on `roleHolders`: add
  `enteredAtISO` / `enteredByUserId` / `supersededAtISO` / `supersededByUserId`;
  rewrite `upsertRoleHolder` to `planRevision` (supersede + insert) instead of patch;
  add a `roleHolderRevisionHistory` query + history view; backfill legacy rows.
- Wire `registerDiff.diffRegister` / `planApply` into the import pipeline so imports
  classify new/update/delete/unchanged and show a diff preview.
- **Caveat:** the backend has no auth, so `enteredByUserId` is only as trustworthy as
  the client-asserted actor — full "what & when" now, reliable "who" waits on auth
  hardening.

---

## Sequencing

| Order | WS | Value | Risk |
|---|---|---|---|
| 1 | WS4 ycnDate import adapter | high (migration) | low |
| 2 | WS2a referenceField enforcement | medium | low |
| 3 | WS2b gender/pronouns | high (delight + bugfix) | low–med |
| 4 | WS1 shareSplit flow | high | med |
| 5 | WS3 versionedRegister + registerDiff | high (audit) | high |

> Branch decision: the harness pins development to `claude/epic-turing-t0l6eq`, so
> these land there (not stacked on the PR #13 branch).
