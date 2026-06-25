I have all the audit findings I need to produce the manifest. The task is pure synthesis of the provided structured data, deduplicated and dependency-ordered. Let me write the deliverable.

# YCN → Societyer: Build Manifest

## 1. Reality Check

The backlog — written from module *names* only — materially overstated the gaps. The entire document-generation spine the backlog flags as missing (`generateDocument`, doc-type catalog, DOCX/OOXML export) **already exists and is tested**: `convex/legalOperations.ts:createPacketRunArtifacts` is the dispatch→render→name→version→persist chokepoint, `legalTemplates`/`legalPrecedents` are the catalog tables, and `shared/corporationPacketDocx.ts` is a complete framework-free OOXML writer. The share-transaction ledger (`shared/equityLedger.ts`), registration-facts register (`convex/organizationDetails.ts`), asset acquire/dispose legs (`convex/assets.ts`), and all number/date/case-folding/email/notification utilities are likewise **done**. Significant-individuals data already lives on `roleHolders` (the `controller` roleType), not in a missing table. The genuinely-absent work is narrower and concentrated in: (a) the NLG/grammar + render-context + name-heuristic foundation libs, (b) the data-binding layer that threads real values into the existing generators (today they emit static field-name checklists), (c) the bitemporal versioned-register spine + as-of resolvers, and (d) a handful of net-new registers (global people directory, dividends, service providers). The float-date codec is real but import-boundary-scoped.

## 2. Status Table (deduplicated across domains)

Three components were reported by multiple audit domains and are merged here: **NLG grammar engine**, **RenderContext contract**, and **isOrganization heuristic**. Note the resolution decisions called out in the footnotes.

| Component | Status | Target files | Depends on | Effort | Recommendation |
|---|---|---|---|---|---|
| NLG grammar engine (`actorGrammar`) ¹ | GAP | `shared/nlg.ts`, `scripts/check-nlg-grammar.ts` | — | S | **build-now** |
| `looksLikeOrganization` name heuristic ² | GAP/PARTIAL | `shared/nlg.ts` *(canonical)*, `scripts/check-nlg-grammar.ts`; mirror in `shared/organizationDomain.ts` + `scripts/check-organization-domain.ts` | NLG engine | S | **build-now** |
| RenderContext contract + `buildRenderContext` ³ | GAP/PARTIAL | `shared/renderContext.ts`, `scripts/check-render-context.ts`, `convex/legalOperations.ts` | NLG engine, Template-assembly | M | **build-now** |
| YCN float-date codec (`encode/decodeYcnDate`) | GAP | `shared/ycnDate.ts`, `scripts/check-ycn-date-codec.ts` | — | S | **build-now** (import-boundary scope) |
| Template-assembly layer (token / list-repeat / conditional) | PARTIAL | `shared/templateAssembly.ts`, `shared/corporationPacketDocx.ts`, `shared/corporationDocumentPackets.ts`, `shared/starter-template-rendering.ts`, `convex/legalOperations.ts` | — | M | **build-now** |
| Generic versioned-register helper | GAP | `shared/versionedRegister.ts`, `src/lib/versionedRegister.ts`, `scripts/check-versioned-register.ts` | — | M | **build-now** |
| asOf / point-in-time query (Convex) | GAP | `convex/versionedRegister.ts`, `shared/equityLedger.ts`, `scripts/check-holdings-as-of.ts`, `scripts/check-versioned-register-query.ts` | Versioned-register helper | M | **build-now** |
| Reference-field strict/free constraint | PARTIAL | `src/modules/object-record/types/FieldType.ts`, `shared/referenceField.ts`, `scripts/check-reference-field-constraint.ts` | — | S | **build-now** |
| Significant-Individuals extension + steps sub-register | PARTIAL | `convex/schema.ts`, `convex/legalOperations.ts`, `shared/significantIndividuals.ts`, `convex/lib/orgHubOptions.ts` | — | M | **build-now** |
| Global People Directory (cross-tenant dedup/typeahead) | GAP | `convex/schema.ts`, `convex/peopleDirectory.ts`, `shared/peopleDirectory.ts`, `src/lib/people/directory.ts` | — | M | **build-now** |
| Corporation Settings → compliance-driving config (AGM/FYE) | PARTIAL | `shared/corporationSettings.ts`, `convex/schema.ts`, `convex/organizationDetails.ts`, `convex/annualCycle.ts`, `src/lib/compliance/engine.ts` | — | M | **build-now** |
| Point-in-time org name / constating resolver | PARTIAL | `convex/schema.ts`, `convex/organizationDetails.ts`, `shared/versionedRegister.ts` | Versioned-register helper, asOf query | M | build-later |
| Declarative diff/staging → live-register apply | PARTIAL | `shared/registerDiff.ts`, `convex/versionedRegister.ts` | Versioned-register helper | M | build-later |
| Dividend record (per-share × outstanding) | GAP | `shared/dividends.ts`, `convex/schema.ts`, `convex/legalOperations.ts`, `src/lib/equity/dividends.ts` | Share ledger (exists) | S | build-later |
| Generic Service Providers register | PARTIAL | `convex/schema.ts`, `convex/serviceProviders.ts`, `shared/serviceProviders.ts` | — | S | build-later |
| Asset disposition counterparty/currency fields | EXISTS | `convex/assets.ts` | — | S | build-later (small edit) |
| Confirmation-handshake / `lastStep` breadcrumb | PARTIAL | `convex/pendingEmails.ts`, `convex/schema.ts` | — | S | build-later |
| Unified document-generation chokepoint | EXISTS | `convex/legalOperations.ts` | — | S | skip |
| Document type catalog table | EXISTS | `convex/schema.ts` (`legalTemplates`/`legalPrecedents`) | — | S | skip |
| DOCX/OOXML export generator | EXISTS | `shared/corporationPacketDocx.ts` | — | S | skip |
| Share-transaction ledger | EXISTS | `shared/equityLedger.ts` | — | S | skip |
| Registration-facts register | EXISTS | `convex/organizationDetails.ts` | — | S | skip |
| Number/currency formatting | EXISTS | `src/lib/format.ts` | — | S | skip |
| Date helpers + chronological ordering | EXISTS | `src/lib/format.ts` | — | S | skip |
| Case-insensitive lookup helper | EXISTS | (idiomatic `.toLowerCase()`) | — | S | skip |
| Email / notification / digest infra | EXISTS | `convex/notifications.ts`, `convex/pendingEmails.ts` | — | S | skip |
| Current-row highlight / GOTO / SQL-coercion / Excel machinery | SKIP | — | — | S | skip |

**Footnotes / merge resolutions:**
1. *Two audits proposed `shared/nlg.ts`. Build it ONCE.* Use the Foundation-libs interface (`Actor`/`ActorGrammar` with `count===0` → neutral they/empty hardening, organization/non-binary → suppress gender). Substitute societies vocabulary (`members` not `shareholders`) **at the consumer**, keep the engine generic.
2. *`looksLikeOrganization` is the canonical home inside `shared/nlg.ts`* (it feeds `Actor.isOrganization` default → neutral pronouns). The General-Utilities audit's request to also surface `inferMemberKind` on `shared/organizationDomain.ts` is satisfied by re-exporting/mirroring; anchor the regex on word boundaries (no false-positive on "Smithson"/"…inc…").
3. *RenderContext build-now*, but its consumer-side `buildRenderContext` **Convex query** that loads real role-holder rows depends on the Template-assembly layer landing first. The pure `shared/renderContext.ts` assembler depends only on `nlg.ts`.

## 3. Dependency-Ordered Build Sequence (WAVES)

**Schema serialization rule:** `convex/schema.ts` (4367 lines) is the dominant shared chokepoint. Every item that adds a table/field to it is collapsed into a **single serial schema step per wave** — never edit schema.ts from two parallel items. Other multi-touch files flagged inline.

---

### WAVE 1 — Foundation libs (pure `shared/`, zero deps)
All four are pure-logic + standalone tsx tests. **Fully parallel** except the shared-file note below.

- **1a. `shared/nlg.ts`** — `actorGrammar()` + `looksLikeOrganization()` + test `scripts/check-nlg-grammar.ts`. *(Build the grammar engine and the name heuristic together — they share one file and one test script. Mirror/re-export `looksLikeOrganization`/`inferMemberKind` into `shared/organizationDomain.ts` as a follow-on edit within this same item to avoid a second writer.)*
- **1b. `shared/ycnDate.ts`** — `encode/decodeYcnDate` (string-slicing, `<19000101 → null`) + `scripts/check-ycn-date-codec.ts`. Parallel-safe.
- **1c. `shared/versionedRegister.ts`** (+ `src/lib/versionedRegister.ts` re-export) — `currentRows`/`asOfRows`/`planRevision` + `scripts/check-versioned-register.ts`. Parallel-safe.
- **1d. `shared/referenceField.ts`** — `validateReference()` + `scripts/check-reference-field-constraint.ts`. Touches `src/modules/object-record/types/FieldType.ts` (add `referenceConstraint?`). Parallel-safe.

⚠️ **Serial within 1a only:** both NLG sub-tasks write `shared/nlg.ts` + `scripts/check-nlg-grammar.ts`. Do them as one unit.
**Gate after Wave 1:** register `test:nlg-grammar`, `test:ycn-date-codec`, `test:versioned-register`, `test:reference-field` in `package.json`; `npm run convex:typecheck` stays green (only `FieldType.ts` non-convex change).

---

### WAVE 2 — Template binding + render context (depend on Wave 1 NLG)

- **2a. `shared/templateAssembly.ts`** (M) — promote `{Token}`/`{#list}`/`{#cond}` regex helpers out of `shared/starter-template-rendering.ts` (keep it re-exporting so existing scripts stay green); thread `values` through `shared/corporationPacketDocx.ts` + `shared/corporationDocumentPackets.ts` + `convex/legalOperations.ts`. New `scripts/check-template-assembly.ts`; extend `scripts/check-corporation-document-packets.ts` to assert bound values. Depends on **1a** (grammar tokens). **No schema.ts touch.**
- **2b. `shared/renderContext.ts`** (pure assembler) — depends on **1a**. The **pure** half can run parallel to 2a; its `scripts/check-render-context.ts` and the `convex/legalOperations.ts` `buildRenderContext` query wiring must land **after 2a** (shares `convex/legalOperations.ts` + depends on the assembly renderer).

⚠️ **Serialize `convex/legalOperations.ts`:** items 2a and 2b's Convex wiring both edit it — do 2a's threading first, then 2b's `buildRenderContext` query. `shared/corporationPacketDocx.ts` is touched only by 2a.
**Gate:** `test:template-assembly`, `test:render-context`; `convex:typecheck` green.

---

### WAVE 3 — Versioned Convex layer + schema-additive registers
**This wave concentrates all `convex/schema.ts` writes — serialize them into ONE step (3-SCHEMA) before the per-item Convex modules.**

**Step 3-SCHEMA (SERIAL — single editor of `convex/schema.ts`):** add, in one pass:
- `roleHolders` extra fields: `becameSignificantOn`, `ceasedSignificantOn`, `taxResidentHomeJurisdiction` (yes/no/unknown), `significanceReason`.
- new `significantIndividualSteps` table (+ `by_society`).
- new `peopleDirectory` table (+ `by_search_name` range index); optional `directoryPersonId` on `roleHolders`.
- AGM/FYE settings fields on the societies/`organizationDetails` surface (`agmMonth`, `agmDay`, `fiscalYearEndMonth/Day`, `waivePrepFinancials`, locations, contacts).

**Then, parallel per-module work (distinct files — no conflicts):**
- **3a. Significant-Individuals** — `convex/legalOperations.ts` (upsert/list steps + roleHolder fields), `shared/significantIndividuals.ts` (`deriveSignificanceStatus`), `convex/lib/orgHubOptions.ts` (option list). Extends `scripts/check-static-corporation-people-register.ts`.
- **3b. People Directory** — `convex/peopleDirectory.ts`, `shared/peopleDirectory.ts`, `src/lib/people/directory.ts` + `scripts/check-people-directory.ts`.
- **3c. asOf query layer** — `convex/versionedRegister.ts` (generic `asOfRows` reader; `addressAsOf` first consumer) + `holdingsAsOf` added to `shared/equityLedger.ts`. Tests `scripts/check-holdings-as-of.ts` + `scripts/check-versioned-register-query.ts`. Depends on **1c**.
- **3d. Corporation Settings** — `shared/corporationSettings.ts` (`nextAgmDueDate`/`nextAnnualReportDueDate`), `convex/organizationDetails.ts` (settings CRUD), `convex/annualCycle.ts` (fallback to derived AGM), `src/lib/compliance/engine.ts` (read agmMonth/agmDay). `scripts/check-corporation-settings.ts`.

⚠️ **Serialize:** `convex/legalOperations.ts` is touched by 3a (and was touched in Wave 2) — 3a is its only Wave-3 writer, fine. `convex/organizationDetails.ts` is touched by 3d only. `shared/equityLedger.ts` by 3c only. **`convex/schema.ts` = step 3-SCHEMA exclusively.**
**Gate:** register `test:significant-individual-steps`, `test:people-directory`, `test:holdings-as-of`, `test:versioned-register-query`, `test:corporation-settings`; `convex:typecheck` green (the big one — schema changed).

---

### WAVE 4 — build-later features (depend on Waves 1/3)
Lower priority; sequence when capacity allows. Schema writes again serialized into one **4-SCHEMA** step.

**Step 4-SCHEMA (SERIAL):** add `organizationNameHistory` table; `dividends` table; `serviceProviders` table (+ `by_society_function`); asset `disposedToCounterparty`/`disposalCurrency`; `pendingEmails` `lastStep`/`failureStage`.

**Then parallel:**
- **4a. Org-name as-of resolver** — `convex/organizationDetails.ts`, `shared/versionedRegister.ts` (reuse). Depends on **1c + 3c**. `scripts/check-org-name-as-of.ts`.
- **4b. Declarative diff/apply** — `shared/registerDiff.ts`, `convex/versionedRegister.ts`. Depends on **1c**. `scripts/check-register-diff.ts`.
- **4c. Dividends** — `shared/dividends.ts`, `convex/legalOperations.ts`, `src/lib/equity/dividends.ts`. Reuses `deriveCurrentHoldings`. `scripts/check-corporation-dividends.ts`.
- **4d. Service Providers** — `convex/serviceProviders.ts`, `shared/serviceProviders.ts`. `scripts/check-service-providers.ts`.
- **4e. Asset disposition fields** — `convex/assets.ts` (small). 
- **4f. Email handshake breadcrumb** — `convex/pendingEmails.ts`.

⚠️ **Serialize:** `convex/versionedRegister.ts` is touched by 4a and 4b — do 4a then 4b. `convex/legalOperations.ts` by 4c only. **`convex/schema.ts` = step 4-SCHEMA exclusively.**

---

**Cross-wave file-contention summary (serialize every appearance):**
- `convex/schema.ts` → one step per wave (3-SCHEMA, 4-SCHEMA). Never parallel.
- `convex/legalOperations.ts` → Wave 2 (2a then 2b), Wave 3 (3a), Wave 4 (4c). One writer per wave.
- `convex/versionedRegister.ts` → Wave 3 (3c) then Wave 4 (4a→4b).
- `convex/organizationDetails.ts` → Wave 3 (3d), Wave 4 (4a).
- `shared/equityLedger.ts` → Wave 3 (3c).
- `shared/nlg.ts` / `scripts/check-nlg-grammar.ts` → Wave 1 (1a, single unit).
- `shared/versionedRegister.ts` → Wave 1 (1c create), reused read-only/extended in 4a.
- `scripts/check-corporation-document-packets.ts` → extended in Wave 2 (2a).

## 4. Already Done — Do Not Rebuild

- **Document-generation chokepoint** — `convex/legalOperations.ts:createPacketRunArtifacts` (dispatch→render→name→version→persist), tested by `scripts/check-corporation-document-packets.ts`.
- **Document type catalog** — `legalTemplates` + `legalPrecedents` tables; content in `shared/corporationDocumentPackets.ts` (7 packets) + `convex/starterPolicyTemplates.ts` (19 templates); idempotent seeding via `seedCorporationDocumentPacketsForSociety`.
- **DOCX/OOXML export** — `shared/corporationPacketDocx.ts` (real ZIP writer, data-URL output). (PDF deliberately not ported.)
- **Share-transaction ledger** — `shared/equityLedger.ts` (signed deltas, derived holdings, validators) + `convex/legalOperations.ts` rights ledger + `rightsHoldings` materialization.
- **Registration-facts register** — `convex/organizationDetails.ts` (`organizationRegistrations` + `organizationIdentifiers`), consumed by `src/lib/compliance/engine.ts`.
- **Asset acquire/dispose legs** — `convex/assets.ts` (`dispose` mutation + `assetEvents` chain-of-custody); only counterparty/currency fields outstanding (Wave 4e).
- **Number/currency + date formatting** — `src/lib/format.ts` (Intl.NumberFormat + date-fns) and the field-display registry.
- **Case-insensitive lookup** — idiomatic `.toLowerCase()`/`localeCompare` already pervasive.
- **Email / notification / digest** — `convex/notifications.ts` + `convex/pendingEmails.ts` + `convex/providers/email.ts`.
- **Confirmation-code handshake** — `convex/invitations.ts` token mint/lookup + `convex/attestations.ts` typed signed confirmations.

## 5. Skip — Not Worth Porting

- **`generateDocument` net-new action** — spine exists; at most a thin `buildGeneratedDocumentArtifacts` refactor, not new capability.
- **New `documentTemplates` catalog table** — `legalTemplates`/`legalPrecedents` already serve; richer bodies go in an optional `bodyTemplate` field, not a new table.
- **PDF/pagination renderer** — backlog marks it deliberately-not-ported; browser/CSS handles it.
- **YCN float-date as a storage format** — codec is import-boundary-only; Societyer stays ISO-8601 everywhere.
- **Num_Comma string-padding / chronological re-indexer (`Update_*_Date_Index`)** — subsumed by Intl.NumberFormat and lexicographic ISO ordering; porting would regress.
- **Dedicated `caseInsensitiveEqual()` module** — would just wrap `.toLowerCase()`.
- **Current-row highlight / GOTO nav / SQL-coercion escaping / Excel ScreenUpdating-Protect-Display_Headings** — framework features (React state, typed Convex args, CSS); no web analogue.