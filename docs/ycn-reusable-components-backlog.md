# YCN → Societyer: Reusable Components Backlog

## Executive Summary

The YCN BC-corporate-records engine is, at heart, a declarative document factory bolted onto a bitemporal register store, and three of its sub-systems are high-leverage ports for Societyer. First, its **document-generation spine** — one parameterized export choke-point (`Print_Document_Package`) that dispatches by action, binds structured entity data into templates, names files deterministically, and exports — is exactly the unified `generateDocument` action Societyer lacks today. Second, its tiny but elegant **NLG/grammar layer** (six grammar tokens per actor-group + inline agreement rules) is what lets one template render correct prose for any board/membership size and gender mix; Societyer has the consumers (`writtenResolutions`, `minutes`, `motionTemplates`) but no grammar layer at all. Third, its **append-only versioned-register model** (supersede-old + insert-new, with an as-of-date "current record" filter) is the bitemporal backbone BC statutory registers demand — Societyer currently stores directors/members/holdings as mutable rows and cannot answer "who were the directors on 2024-03-01?". On the corporations-extension track specifically, YCN hands you ready-made specs for the **BC Transparency Register of significant individuals** and a **signed-quantity share-transaction ledger**. The pagination/text-wrap/SQL-in-cells/float-date machinery is clever but largely obsolete in a TS/HTML web stack and should be left behind except as concepts.

## Prioritized Component Backlog

| Component | What it gives Societyer | Maps to (Convex module / GAP) | Effort | Priority |
|---|---|---|---|---|
| **Document-package export pipeline** (dispatch → render → name → version → export) | One `generateDocument` choke-point every doc flow plugs into; deterministic `entity-doctype-date` naming; structured `{ok,error}` | `documents`/`documentVersions`/`signatures` exist; GAP = the unified action | M | **High** |
| **NLG grammar engine** (6 tokens per actor-group + agreement rules) | One template → correct prose for any director/member count & gender | GAP — `convex/lib/nlg.ts`; consumers = `writtenResolutions`,`minutes`,`motionTemplates`,`meetingTemplates` | S | **High** |
| **Render-context contract** (named-range "API" → typed object) | Stable template↔data boundary; tokens as object paths | GAP — shared `RenderContext`; `organizationDetails` supplies org tokens | S | **High** |
| **Legal-prose clause templates** (adoption/title/appointment sentences) | Seeded resolution boilerplate that reads grammatically correctly | `motionTemplates`/`meetingTemplates` (`body` field) | M | **High** |
| **Template-assembly layer** (list-repeat + conditional-clause primitives) | `{{#each}}` self-hiding lists; boolean clause toggles; editable prose | `motionTemplates`/`starterPolicyTemplates` do strings; GAP = binding layer | M | **High** |
| **Document type catalog** (~10 typed generators w/ data bindings) | First-class catalog of generatable records w/ explicit bindings | Partial: `writtenResolutions`+`motionTemplates`+`agm`; GAP = catalog table | M | **High** |
| **Versioned-register spine** (append-only, supersede+insert, as-of filter) | Bitemporal register history; "who were directors on date X?" | GAP — `lib/versionedRegister.ts`; affects `roleHolders`,`members`,`rightsHoldings` | L | **High** |
| **Point-in-time name/constating resolver** (date-window DGET) | Back-dated resolutions show the correct historical name/legislation | GAP; `organizationDetails`+effective-dating | M | **High** |
| **BC Transparency Register of Significant Individuals** (+ steps-taken sub-register) | Statutory beneficial-ownership register + diligence trail (corp track) | GAP — new `significantIndividuals` module | M | **High** |
| **Global People Directory** (cross-tenant dedup + typeahead) | One person reused across many societies; kills re-entry | Partial: `roleHolders`/`members` per-society; GAP = `peopleDirectory` | M | **High** |
| **Corporation_Settings** (per-entity compliance config) | One config (AGM month/day + FYE + waive-financials) auto-drives deadlines | Partial: `organizationDetails`/`annualCycle`/`deadlines`; GAP = consolidation | M | **High** |
| **Declarative diff/staging → generic apply** (UPD/DEL/NEW per row) | One generic executor over the live registers, not just import | Partial: `importSessionMergeAndApply`; GAP = live-register diff apply | M | Medium |
| **Appoint/Remove interval model** (directors/officers/providers) | Shared tenure logic; generic `serviceProviders` register | `directors` has it; GAP = officers + `serviceProviders` beyond `auditors` | S | Medium |
| **Share-transaction ledger** (signed qty, derived holdings) | Allot/transfer/consolidate as signed rows; holdings via SUM (corp track) | GAP — new (corporations only) | M | Medium |
| **Registration-facts record** (nature/legislation/registry-number) | Jurisdictional registration facts alongside annual filings | Partial: `filings`; GAP = `registrations` table | S | Medium |
| **Asset disposition leg** (symmetric acquire/dispose, multi-currency) | First-class dispose leg + chain-of-title counterparties | Partial: `assets`; GAP = disposition fields | S | Medium |
| **Entity-clone-as-template** (clone society, prune history) | Onboard similar non-profits; demo seeding; history compaction | GAP — `cloneSociety`/`pruneHistory`; pairs w/ `retention` | M | Medium |
| **`isOrganization` heuristic** (entity-type by name suffix) | Org-vs-individual member detection → drives pronouns/`kind` | `members`/`directors` + NLG util | S | Medium |
| **Reference-field constraint toggle** (`restrict to directory`) | Strict typeahead vs free-text per field; referential integrity | `customFields`/`fieldMetadata` | S | Medium |
| **Float-date codec** (`YYYYMMDD.HHMMSS` ↔ ISO) | Exact round-trip when importing legacy YCN/Access data | GAP — `convex/lib/ycnDate.ts`; used by `importSessions*` | S | Medium |
| **Confirmation-code handshake + Last_Step breadcrumb** | Typed verification result + stage-aware email error logging | `invitations`/`attestations`/`pendingEmails` | S | Medium |
| **Dividend record** (per-share × outstanding = total) | Dividend declarations (corp track only) | GAP — new (corporations only) | S | Low |
| **Auto-pagination engine** (cumulative-height + `<BRK_PAGE>`) | Keep-together concept only (CSS `break-inside:avoid`) | GAP-by-design — browser handles it | S | Low |
| **Fixed-width text-wrap** (`Char_Font_Size`+`Calc_Text_Rows`) | No-DOM line estimation fallback only | GAP-by-design — obsolete | S | Low |
| **Chronological re-indexer** (`Update_*_Date_Index`) | Insight only: pickers chronological → sort at query time | SUBSUMED | S | Low |
| **Current-row highlight / GOTO nav / `Num_Comma` / SQL-coercion / Excel-rendering machinery** | Trivial in TS (CSS, React state, `Intl.NumberFormat`, typed args) | SUBSUMED / do not port | S | Low |

---

## High-Priority Components — Detail

### 1. Document-package export pipeline (the spine)

**Idea.** A single choke-point that turns "user picked an action" into a saved, versioned PDF: select template → run layout → compute a deterministic filename → ensure output dir → export. Everything else plugs into it.

**How YCN does it (concrete).** Three batch entry points funnel into `Print_Document_Package` (`Module9` L703-793). `Document_Package_Transactions` (`Module3` L1848-1939) branches on `Main!B16` (the ACTION selector) to pick the right `Doc - *` sheet; `Document_Package_Custom` (L1940-1998) resolves a user sheet by name. The renderer is fully cell-driven: `W6` = output dir (`="c:\data\corporate_records\"&ENT_ID`), `W7` = filename (`=ENT_ID&"-Annual-"&YEAR(AI1)&"-"&MONTH&"-"&DAY&".pdf"` with a `NODATE` fallback), `W4` = print area, `AK2:AK4` = error-message targets. It `MkDir`s if missing, runs `Adjust_Page_Breaks`/`Adjust_Row_Heights`, then `ExportAsFixedFormat Type:=xlTypePDF`. A robust handler distinguishes a bad date from a file-locked error.

**Port sketch.**
```ts
// convex/documentGen.ts  (Convex action — the single choke-point)
export const generateDocument = action({
  args: { societyId: v.id("societies"), templateKey: v.string(), inputs: v.any() },
  handler: async (ctx, { societyId, templateKey, inputs }) => {
    const tmpl = await ctx.runQuery(api.documentTemplates.getByKey, { templateKey });
    const renderCtx = await ctx.runQuery(api.documentGen.buildRenderContext, { societyId, asOf: inputs.date });
    const html = renderTemplate(tmpl.bodyTemplate, { ...renderCtx, ...inputs });   // Handlebars
    const pdf  = await htmlToPdf(html);                                            // Puppeteer / service
    const storageId = await ctx.storage.store(pdf);
    const fileName = `${renderCtx.org.shortName}-${tmpl.key}-${inputs.date ?? "NODATE"}`; // deterministic
    const docId = await ctx.runMutation(api.documents.insert, {
      societyId, category: "WorkflowGenerated", title: tmpl.title, fileName, storageId,
    });
    await ctx.runMutation(api.documentVersions.insert, { documentId: docId, storageId });
    return { ok: true, documentId: docId, fileName };   // declarative error-target → typed result
  },
});
```
Keep YCN's dispatcher/renderer split: a thin `generateDocumentPackage` mutation maps a workflow step → `templateKey` (mirrors the `B16` ACTION switch); the shared renderer does layout+export once. Wire `signatures.ts` so generated resolutions can collect e-signatures (YCN left wet-ink blanks). This is the highest-leverage port — every other piece plugs in here.

### 2 & 3. NLG grammar engine + render-context contract (merged)

**Idea.** Derive grammar agreement features once per actor-group, expose them under stable names, and let templates reference tokens (not cell addresses) so one template serves any composition.

**How YCN does it (concrete).** `Transaction` sheet, six formulas per group. Directors (`B6:B11`): `DIR_NUM = 37-COUNTIF($F$3:$F$39,"")`; `DIR_GENDER = IF(B6=COUNTIF(H,"M"),"M",IF(B6=COUNTIF(H,"F"),"F","B"))` ("B"=mixed); `DIR_PLUR = IF(B6>1,"s","")`; `DIR_POSS = IF(B6=1,"'s","s'")`; pronoun `IF(B6>1,"they",IF(B7="M","he","she"))`; pron-poss `IF(B6>1,"their",...)`. Shareholders repeat at `B14:B19` (`B14` also exported as `NUM_MEM`), officers at `B22:B27`. Defined names (`DIR_NUM`,`SHLDR_*`,`OFFCR_*`,`CORP_NAME`=`A29`,`SHORT_NAME`=`A30`) are the "API surface" — templates only know token names.

**Port sketch.**
```ts
// convex/lib/nlg.ts
interface Actor { name: string; gender?: 'M' | 'F' | 'X' }
interface ActorGrammar {
  count: number; gender: 'M'|'F'|'B';
  plural: string; possessive: string; pronoun: string; pronPoss: string;
  verbS: string; hasHave: string; allTheSole: string; isAre: string; wasWere: string;
}
export function actorGrammar(actors: Actor[]): ActorGrammar {
  const n = actors.length;
  const allM = n > 0 && actors.every(a => a.gender === 'M');
  const allF = n > 0 && actors.every(a => a.gender === 'F');
  const gender = allM ? 'M' : allF ? 'F' : 'B';
  const plural = n > 1 ? 's' : '';
  const nb = n === 1 && actors[0].gender === 'X';            // non-binary single actor
  return {
    count: n, gender, plural,
    possessive: n === 1 ? "'s" : "s'",
    pronoun:  n > 1 || nb ? 'they'  : gender === 'M' ? 'he'  : 'she',
    pronPoss: n > 1 || nb ? 'their' : gender === 'M' ? 'his' : 'her',
    verbS: n > 1 ? '' : 's', hasHave: n > 1 ? 'have' : 'has',
    allTheSole: n > 1 ? 'all the' : 'the sole',
    isAre: n > 1 ? 'are' : 'is', wasWere: n > 1 ? 'were' : 'was',
  };
}
```
```ts
// the named-range contract, in code
interface RenderContext {
  org: { name; shortName; jurisdiction; registrationNumber; legislation };
  dir: ActorGrammar; members: ActorGrammar; officers: ActorGrammar;
  date: { long: string; iso: string };
}
// buildRenderContext(societyId, asOf): loads org details + directors + members + officers
```
Harden the `count===0` case (YCN folds it into the he/she branch — return neutral `they`/empty strings). Substitute "shareholders"→"members" (`NUM_MEM` already conceptually the membership) and legislation→"Societies Act". Source: `Transaction!B6:B27`, defined-names dump.

### 4 & 5. Legal-prose clause templates + template-assembly layer (merged)

**Idea.** Prose cells concatenate the stable token "API" + literal legal text with inline agreement; repeating-list rows self-hide; clause-level boolean flags include/exclude whole paragraphs.

**How YCN does it (concrete).** `Doc - Annual D101` adoption clause: `="The undersigned being "&IF(DIR_NUM>1,"all the","the sole")&" director"&IF(DIR_NUM>1,"s","")&" of "&SHORT_NAME&" hereby adopt"&IF(DIR_NUM>1,"","s")&" the foregoing resolution pursuant to the provisions of the "&Transaction!$B$35&"."` → "...the sole director of Acme hereby adopts..." vs "...all the directors of Acme hereby adopt...". Title `D4` upper-cases `"Consent Director"&IF(DIR_NUM>1,"s'","'s")&" Resolution"`. Repeating director rows `F13='=IF(Transaction!F3="","",Transaction!F3)'` self-hide via a computed 0pt height when blank. Clause toggles use named flags (`FMT_Para_Undersigned`→`System_Settings!AA8`) wrapped in `IF()`.

**Port sketch.** Use Handlebars over HTML — closest to the `IF()`/`CONCATENATE` idiom:
```hbs
The undersigned being {{dir.allTheSole}} director{{dir.plural}} of {{org.shortName}}
hereby adopt{{dir.verbS}} the foregoing resolution{{#if multipleResolutions}}s{{/if}}
pursuant to the provisions of the {{org.legislation}}.

{{#each directors}}<div class="signer">{{name}}</div>{{/each}}   {{!-- self-hides when empty --}}
```
Self-hiding rows → simply don't emit empty `{{#each}}` iterations. Clause toggles (`FMT_*`) → boolean fields on the template's input args. Store `bodyTemplate` as Handlebars source on `documentTemplates` / `motionTemplates.body` so non-devs edit prose without code. Compute each boolean once (`count>1`) and reuse to avoid drift. Seed: Director's Resolution, Members' Resolution, Appointment of Directors/Officers, Change of Registered/Records Office, Annual Consent Resolution. Source: `Doc - Annual D4/D28/D101/E12`, `Doc - Appt Officers E8`, `FMT_*` at `System_Settings!AA7/AA8`.

### 6. Document type catalog

**Idea.** A first-class catalog of generatable corporate-record documents, each with explicit structured data bindings — not ad-hoc code.

**How YCN does it (concrete).** Each `Doc - *` sheet is a self-contained template; the dispatcher reads `Main!B16` ACTION and selects the matching sheet. The catalog: Annual (consent resolutions + appointments + AGM-deemed-held), Share Allotment/Transfer/Certificate/Split, Appt Directors, Appt Officers, Change Offices, Dividends, Asset Transfer, plus `User - Custom 1..20`. Each binds named data ranges (e.g. Annual pulls `Corporation_Settings` AGM month/day, FYE, auditor flag `K3`; director list `Transaction!F3:F12`). Source: `Module3` L1848-1998.

**Port sketch.**
```ts
// documentTemplates table
{ key, title, category, requiresResolutionType: boolean,
  dataBindings: string[], bodyTemplate: string }
// one pure generator per type living beside its domain module:
//   generators/apptDirectors.ts → generate(ctx, society, inputs): { html, fields }
```
Map: Appt Directors → director appointment consent resolution (`directors.ts`); Change Offices → registered-office change record (`organizationDetails.ts`); Annual → AGM consent package (`agm.ts`/`annualCycle.ts`). Drop share/dividend/cert types for societies but **queue them for the corporations extension** — they are a ready-made spec. Persist output via `documents.ts` (category `WorkflowGenerated`) + `documentVersions.ts`.

### 7. Versioned-register spine (the data backbone)

**Idea.** Every statutory register is append-only and bitemporal: an edit = close-old (stamp `REVISE_DT_TM`) + insert-new; "current" = `REVISE_DT_TM is NULL`. Gives full audit history and as-of-date reconstruction.

**How YCN does it (concrete).** Common columns on every `DB_GLOB_*` table: `ENT_ID`, `DB_ID`, `ENTRY_DT_TM`/`ENTRY_BY`, `REVISE_DT_TM`/`REVISE_BY`, `REG_POSN`. Every read appends `AND (REVISE_DT_TM is NULL OR REVISE_DT_TM < 19000101.0900)` (`From_DB_SHARE_CAPTL` L2733-2738, repeated everywhere). Per-row status `-`/`UPD`/`DEL`: UPD/DEL UPDATE the old row's `REVISE_DT_TM`; `-`/UPD INSERT a new current row. The two link tables (`ENT_PEOPLE`, `PEOPLE_DIRECTORY`) deliberately skip the spine.

**Port sketch.**
```ts
// convex/lib/versionedRegister.ts — shared shape on every register table:
// { societyId, recordId, enteredAtISO, enteredByUserId,
//   supersededAtISO?, supersededByUserId?, regPosn?, ...payload }
async function reviseRecord(ctx, table, currentRowId, patch, actor) {
  const cur = await ctx.db.get(currentRowId);
  await ctx.db.patch(currentRowId, { supersededAtISO: now(), supersededByUserId: actor });
  return ctx.db.insert(table, { ...cur, ...patch, _id: undefined,   // same recordId, new _id
    enteredAtISO: now(), enteredByUserId: actor, supersededAtISO: undefined });
}
async function asOf(ctx, table, societyId, iso) { /* enteredAtISO<=iso && (superseded===undefined||superseded>iso) */ }
```
Index by `[societyId, recordId]` and `[societyId, supersededAtISO]`. Convex does supersede+insert in **one atomic mutation** — strictly safer than YCN's un-transactioned `oConn.Execute` loop. Model "still current" as `supersededAtISO === undefined` (not a magic past date — drop the float/`19000101` encoding; ISO strings sort fine). This is the bitemporal core directors/members/transparency registers need. Source: `From_DB_*` filters, `UPDATE_ENTITY_INDEX` L5107-5111.

### 8. Point-in-time name / constating resolver

**Idea.** A back-dated resolution must show the society's legal name + legislation **as of the document's effective date** (names change over time).

**How YCN does it (concrete).** `Transaction!A29 CORP_NAME = DGET(DB_CORP_NAME,"Corporation_Name",A37:B38)` with criteria block `A37:B38` headed `START_DT2`/`END_DT2`, where `A38="<="&VALUE(B2)` and `B38=">"&VALUE(B2)` (`B2` = transaction date). DGET selects the row whose `START_DT2 <= asOf < END_DT2`. Graceful fallback string on no match.

**Port sketch.**
```ts
async function nameAsOf(ctx, societyId, asOf): Promise<OrgNameRecord> {
  // query name-history rows; pick where effectiveFrom <= asOf < (effectiveTo ?? '9999')
  // return placeholder '[No name on file as of <date>]' instead of throwing
}
```
Reuse the date-window pattern for as-of offices/officers/directors. Feed result into `RenderContext.org`. Society constating doc = Constitution + Bylaws; legislation = "Societies Act". Source: `Transaction!A29/A30/B33-B35/A37:B38`, `DB_CORP_NAME`.

### 9. BC Transparency Register of Significant Individuals

**Idea.** The statutory beneficial-ownership register plus a paired diligence sub-register logging the steps taken to confirm an individual's information.

**How YCN does it (concrete).** `DB_GLOB_TRANSPARENCY_REG`: `NAME`, `ADDRESS`, `BIRTH`, `CITIZEN` (free text), `TAX_RESIDENT_YN` (`Y`/`N`/`Unknown`), `START_DT`, `END_DT` (null = currently significant), `REASON` (≤200 chars, e.g. "50% issued shares", "Right to elect all directors"). `DB_GLOB_TRANSPARENCY_DUE`: `NAME`, `STEPS` (255-char narrative), `STEP_DT`. The sheet `Register - Transparency` carries the exact legal-question wording per column (`B2:M3`) — reusable as form labels. Source: `From_DB_TRANSPARENCY` L3952-4043.

**Port sketch.**
```ts
significantIndividuals: { societyId, name, address?, dateOfBirth?,
  citizenshipStatus: string, taxResidentHomeJurisdiction: v.union('yes','no','unknown'),
  becameSignificantOn: string, ceasedSignificantOn?: string, reason: string }
// status derived = ceasedSignificantOn ? 'former' : 'current'
significantIndividualSteps: { societyId, individualId?, name,
  stepsNarrative: string, stepDate: string, nextReviewDate?: string }
```
**Gate behind the corporation entity type** — the BC *Societies* Act does not require this register, but BC *private corporations* do (the in-progress corporations extension). Port the column legal questions verbatim as field help text. Wire `nextReviewDate` → `deadlines.ts` (category `transparency-review`). Note: this is a **name collision** — Societyer's existing `transparency.ts` is about public disclosure, unrelated.

### 10. Global People Directory

**Idea.** Store a person once globally and reuse across many entities, with a per-entity link holding role-specific snapshot facts; a name-prefix typeahead resolves the canonical record.

**How YCN does it (concrete).** `DB_GLOB_PEOPLE_DIRECTORY`: `GLOB_ID`, `SEARCH_NAME` (normalized), `FULL/LAST/FIRST_NAME`, `ADDRESS`, `INDIVIDUAL` flag, `INDIV_DOB`, `INDIV_CUR_GENDER`. `DB_GLOB_ENT_PEOPLE`: `ENT_ID`, `PERS_ID`, `GLOB_ID` (FK), `INFO_STR`/`INFO_END`, `SIGN_ORDER`, plus **denormalized snapshot** `FULL_NAME`/`ADDRESS`/`GENDER` (the person's details as recorded for that entity at that time). Typeahead `Name_Index_From_GLOB_PEOPLE_DIRECTORY` (L5323-5380): `SELECT SEARCH_NAME,GLOB_ID ... WHERE mid(SEARCH_NAME,1,N)='<prefix>' ORDER BY SEARCH_NAME`. Link tables deliberately skip the version spine.

**Port sketch.**
```ts
peopleDirectory: { canonicalName, searchName /* lowercased */, firstName, lastName,
  dob?, isIndividual: boolean, defaultAddress? }
// roleHolders/members gain optional directoryPersonId; keep their OWN snapshot fields
export const searchByPrefix = query({ /* index on searchName, startsWith */ });
```
The per-society denormalization is **deliberate** — a register must show the director's name/address as recorded then, even if the person later moves. Don't version the directory; do version the per-society link via the register spine (#7). Kills duplicate entry for firms managing many societies. Source: `From_DB_ENT_PEOPLE` L4084-4160.

### 11. Corporation_Settings → compliance-driving config

**Idea.** One per-entity config object whose fields *drive* deadline scheduling and document generation, rather than scattered settings.

**How YCN does it (concrete).** `DB_GLOB_CORP_SETTINGS`: `AGM_MONTH`+`AGM_DAY`, `FIN_MONTH`+`FIN_DAY` (fiscal year-end), `DOC_PREP_LANGUAGE`, `WAIVE_PREP_FINANCIALS` (Y/N), `RESTRICT_PEOPLE_YND`, `CONT_PRIM_*`/`CONT_ALT_*`, `LOC_MIN_BOOK`/`LOC_SEAL_ETC` (physical record locations), `DOC_MGMT_DIRECTORY`. AGM month/day + FYE are the inputs that derive when annual filings/AGMs are due. Version-tracked like every table.

**Port sketch.**
```ts
// consolidate onto organizationDetails (or a societySettings doc):
{ agmMonth, agmDay, fiscalYearEndMonth, fiscalYearEndDay, waivePrepFinancials: boolean,
  minuteBookLocation?, sealLocation?, primaryContact?: {name,phone,email}, altContact?: {...} }
```
Then `annualCycle.ts`/`deadlines.ts` derive next-AGM and annual-report due dates from `(agmMonth, agmDay)` + FYE — for BC societies these are tied to fiscal year-end, so this becomes the single source that auto-generates `deadlines` rows. `waivePrepFinancials` maps to a society's audit/review-exemption choice. Source: `DB_GLOB_CORP_SETTINGS` (11 rows), VBA "Transfer Corporation Settings" @1190.

---

## Net-new Capabilities Societyer Lacks

- **Register-row history (bitemporal).** Directors/members/holdings are mutable current-state rows; only file blobs are versioned (`documentVersions`). "Who were the directors at the last AGM?" / "what was the membership register on date X?" cannot be answered today — the whole point of a statutory minute book. → versioned-register spine (#7).
- **A grammar/agreement layer.** No plural/possessive/pronoun/verb-agreement helper, no per-actor-group grammar object, no shared render-context. Consumers exist; the engine that makes one template correct for any board size/gender is entirely missing. → #2/#3.
- **A unified document-generation action.** Storage + string templating exist, but no dispatch → render → name → version → export choke-point, no deterministic `entity-doctype-date` naming, no list-repeat/conditional-clause primitives. → #1/#4/#5.
- **Point-in-time org-name/constating resolution** for back-dated resolutions. → #8.
- **BC Transparency Register** of significant individuals + diligence-steps sub-register (corporations track). → #9.
- **Cross-tenant people directory** with typeahead dedup. → #10.
- **Share/equity model** (signed-quantity ledger, derived holdings) and **dividend record** — corporations track only.
- **Generic `serviceProviders` register** (Bankers/Lawyers/Accountants/Transfer_Agents) beyond `auditors.ts`, plus explicit **registration-facts** (nature/legislation/registry-number per jurisdiction) alongside annual filings.
- **Clone-an-org-as-template** flow and **history-compaction/retention enforcement** on register rows (pairs with `retention.ts`, which currently has no versioned data to prune).
- **Reference-field strict/free constraint** toggle and an **organization-vs-individual** member heuristic.

## Quick Wins (high value / low effort)

1. **NLG grammar engine** (`convex/lib/nlg.ts`) — ~60 lines, unlocks correct prose everywhere (#2).
2. **Render-context contract** — a typed `RenderContext` + `buildRenderContext` helper; the stable template↔data boundary (#3).
3. **`isOrganization` / `looksLikeOrganization`** heuristic (suffix regex extended with SOCIETY/ASSOCIATION/FOUNDATION/CO-OP) → defaults member `kind`, suppresses gendered pronouns.
4. **Appoint/Remove `isActive` + tenure helpers** on `directors.ts` (already has `termStart`/`termEnd`); add generic `serviceProviders` register using YCN's FUNCTION enum as a ready taxonomy.
5. **Asset disposition leg** — add `disposedOn`/`disposalPriceCents`/`disposalCurrency`/`disposedToCounterparty`/`acquiredFromCounterparty` to `assets.ts`; invariant `status='Disposed' ⇒ disposedOn` set.
6. **Float-date codec** (`encodeYcnDate`/`decodeYcnDate`) at the import boundary only — decode via string slicing, not float math, to avoid VBA `Fix()` drift; `<19000101` ⇒ null.
7. **Reference-field constraint flag** (`referenceConstraint: 'strict'|'free'`) on `fieldMetadata` for directory-linked fields.

## Bigger Bets (high value / larger effort)

1. **Versioned-register spine** across `roleHolders`/`members`/`rightsHoldings` with `asOf` queries — the bitemporal backbone BC compliance demands; the single most foundational change.
2. **Unified `generateDocument` pipeline** + `documentTemplates` catalog + Handlebars template-assembly layer + seeded clause partials — the spine every doc flow plugs into, feeding `documents`/`documentVersions`/`signatures`.
3. **BC Transparency Register** (+ steps-taken sub-register, deadline wiring) — gated behind the corporation entity type; net-new statutory capability for the corporations extension.
4. **Global People Directory** with typeahead dedup + per-society snapshot links — multi-society data-entry win plus single-source signer/grammar resolution.
5. **Corporation_Settings consolidation** that auto-derives `deadlines` from AGM month/day + fiscal year-end — turns scattered settings into one compliance driver.
6. **Share-transaction ledger + dividends** (corporations track) — directly portable from YCN's signed-quantity model as a ready spec.

> **Deliberately not ported:** the auto-pagination accumulator and `Char_Font_Size`/`Calc_Text_Rows` text-wrap engine (a real browser/Puppeteer renderer does layout natively — keep only CSS `break-inside:avoid` for keep-together blocks); SQL-in-cells + `DB_Str`/`DB_Search_Str` escaping (Convex takes typed args — no injection surface); the float-date format as storage (ISO-8601 is the Societyer idiom); `max(DB_ID)` allocation (Convex mints ids); and all Excel-rendering machinery (ScreenUpdating, Protect/Unprotect, Display_Headings, GOTO nav, conditional-format highlight, `Num_Comma` → `Intl.NumberFormat`).