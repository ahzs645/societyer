# YCN → Societyer: Deep Re-Audit — What Genuinely Remains

A fresh five-agent pass over the **actual source** — all 19 Access tables
(`DBS_YCN_CRS_Sample_V2xx.accdb`), every `Doc -*` / `User - Custom N` generator
sheet, the full VBA dump, and the Excel calc/lookup engine — cross-checked
column-by-column and clause-by-clause against the current implementation on
`claude/excel-database-analysis-ubftpj`. 47 findings; the real (non-covered)
ones are below.

## 1. Honest summary

The **data layer is essentially complete** — every register, ledger,
effective-dating interval, certificate chain, transparency sub-register, and
settings field in the Access source has a modeled home in Convex, confirmed
column-by-column. What genuinely remains concentrates in **two places: the
document renderer and the clone routine.**

- Our generated DOCX is still a **checklist of packet metadata, not a signable
  legal instrument** — no adoption clause, no signature page, no WHEREAS
  recitals, no enumerated resolution tables, no conditional/branching prose. All
  ~12 corporation packets are prose-thin shells over a rich data model. This one
  root cause is the largest remaining theme.
- `cloneSociety` silently **drops six child tables** (equity ledger, transfers,
  dividends, assets, asset events, SI diligence steps) and does **no
  cross-reference ID remapping** — a real, latent correctness bug.
- A small cluster of **derived-state engines** specified in the Excel calc layer
  (voting-power roll-up, voting-eligibility gating, dividend reconciliation) was
  never ported.

## 2. Prioritized real-gap table

(ALREADY_DONE findings dropped — see §5.)

| Gap | Source | What it adds | Status | Value | Effort |
|---|---|---|---|---|---|
| Execution/signature block (adoption clause + named signature lines + corporate "By:") | All `Doc -*` feet; `entitySigners` table unused by renderer | Turns every generated DOCX from a checklist into a signable instrument | NOT_IMPL | high | M |
| Annual consent: full 6-clause body + separate directors' consent page | `Doc - Annual` R8–R113 | FS approve/waive, fix next FYE, auditor appoint/waive, ratify acts, director slate, deemed-AGM date, shareholder-vs-director split | PARTIAL | high | M |
| Share allotment: WHEREAS + allotment table + cert-issuance table + seal/President clause + per-subscriber Subscription Agreement | `Doc - Share Allotment` R8–R202 | Full allotment deliverable incl. auto-generated subscription annex per subscriber | PARTIAL | high | L |
| Share transfer: WHEREAS + new-cert table ("remaining untransferred") + seal clause + explicit cancellation table | `Doc - Share Transfer` R6–R51 | Four-resolution transfer instrument with partial-transfer handling | PARTIAL | high | M |
| Dividend declaration: multi-class table w/ Total-Dividends column + "payable on X to holders of record on X" | `Doc - Dividends` R8–R20 | Multi-class declaration in one resolution, computed totals, record+payment dates | PARTIAL | high | M |
| Asset transfer: 6-category branching (real-estate/equipment/securities/other × acquire/dispose) + register + further-actions clauses | `Doc - Asset Transfer` R6–R115 | Category-aware resolution + execute/register + incidental-expenditure authorizations | PARTIAL | high | M |
| `cloneSociety` omits 6 child tables (rightsHoldings, rightsholdingTransfers, dividends, assets, assetEvents, significantIndividualSteps) | VBA `Copy_Entity_Common` / `New_Entity_Create` | Clone currently loses entire share/dividend/asset/SI history | PARTIAL | high | M |
| Clone does no cross-reference ID remapping | VBA per-table `max(DB_ID)` rebasing | Cloned child rows dangle to source society's Ids — latent bug, activates once equity tables are cloned | PARTIAL | high | M |
| Voting-power roll-up (shares × votes-per-share, summed per holder, voting/non-voting partition, as-of) | `Transaction` JW/JX/BE blocks | Engine to actually enumerate "all voting shareholders" + quorum/majority math | NOT_IMPL | high | M |
| Director appt/removal: single combined instrument adopted by voting shareholders | `Doc - Appt Directors` | One appoint+remove doc, correct resolving body, corporate-shareholder "By:" | PARTIAL | med | S |
| Change-of-office: initial-vs-change branch + "from X to Y" clause per office | `Doc - Change Offices` R8–R20 | Renders prior→new address; distinguishes first-set from change | PARTIAL | med | S |
| Share split: tie to shareholders' Special Resolution + subdivision(allot) vs consolidation(cancel) cert handling | `Doc - Share Split` | Directors' resolution implementing a governing special resolution | PARTIAL | med | M |
| Share certificate: cancellation-of-replaced-cert resolution + seal/President clause | `Doc - Share Certificate` R72–R135 | Issuing a cert also cancels the one it replaces, under seal | PARTIAL | med | S |
| Voting-eligibility gating (Individual='Y' AND atMajority='Y') | `People` Z2:Z101 | Excludes minors + corporate holders from eligible-voter set | NOT_IMPL | med | S |
| Dividend reconciliation (perShare×shares vs entered total, ±1% tolerance flag) | `Record - Dividends` I2:I249 | Data-integrity guard catching mis-keyed dividend totals | NOT_IMPL | med | S |
| REG_FILING registration-event half (REGN_NAT/LEG/NUM/DT, incl. "XP Registration") not imported | `DB_GLOB_REG_FILING` | Extra-provincial registration event tied to the jurisdiction's filing ledger | PARTIAL | med | S |
| Bilingual EN/FR packet bodies | `User - Custom 3` French branch; `DOC_PREP_LANGUAGE` | French rendering of resolution prose | NOT_IMPL | med | L |
| Thousands-separator formatting in rendered numbers | VBA `Num_Comma` | "1,000,000" in allotment/transfer/cert/dividend docs | NOT_IMPL | low | S |
| OFFICER PRES/SECR structured booleans (vs flat title array) | `DB_GLOB_OFFICER` | Reliable "holds Secretary office" logic without string-matching | PARTIAL | low | S |
| ISS_TYP 'Subdivision'/'Consolidation' ledger vocabulary | `DB_GLOB_SHARE_TRANS` | Split shows as a transaction in holder history with correct nature label | PARTIAL | low | S |
| Per-contact effective date on business address | `DB_GLOB_BUS_ADDRESS` | "Who was the contact on date X" point-in-time | PARTIAL | low | S |
| SHARE_CAPTL structured VOTING boolean (votesPerShare) | `DB_GLOB_SHARE_CAPTL` | Numeric vote weight (prereq for voting-power roll-up) | PARTIAL | low | S |

## 3. Themes + port sketches

### Theme A — The renderer is a checklist, not an instrument (biggest theme)

Eight high/medium gaps share one root cause: `shared/corporationPacketDocx.ts`
(`corporationPacketDocxBlocks`, L30–52) emits packet *metadata* (title, summary,
deliverable, required-data lists, a 2-sentence section blurb, a bullet list of
role **keys**). It never emits legal prose. The data to drive all of it exists.

**A1 — Execution/signature block (do first; unblocks every packet).**
- *shared:* new `shared/executionBlock.ts` — `executionClause(packet, society, asOf)`
  (grammar-driven off resolving body: "The undersigned being all the
  directors/voting shareholders of {shortName} hereby adopt … pursuant to the
  {act}", reusing `nlg.ts` plurality + `looksLikeOrganization` for the corporate
  "By: ___" branch) and `signatureBlocks(signers)` from `entitySigners`
  (signOrder, corpSign).
- *convex:* extend the render context in `legalOperations.generateDocumentFromCatalog`
  / `createPacketRunArtifacts` to load `entitySigners` and resolve each signer's
  printed name + capacity via `peopleDirectory`. The table is already there — it's
  simply never consumed.

**A2 — Resolution-body templating (drives Annual, Dividend, Allotment, Transfer,
Cert, Asset, Split, Change-Office, Director appt/remove).** Replace each packet's
2-sentence `sections[].body` with a `templateAssembly` body using the existing
`{token}`/`{#if}`/`{#each}` engine, which already supports the needed conditionals
and iteration:
- Annual → `{#if waivePrepFinancials}`waiver`{#else}`approval`{/if}`, fix-next-FYE
  token, auditor `{#if}` branch, ratification literal, `{#each directors}` slate,
  deemed-AGM token.
- Dividend → `{#each declarationRows}` Class/PerShare/**Total** table
  (`computeDividend` already exists), "payable on {paymentDate} to shareholders of
  record on {recordDate}".
- Allotment/Transfer/Cert → `{#each certificates}` issue table + `{#each cancelled}`
  from `shareCertificates.ts` chains; "remaining untransferred" via `{#if partial}`.
- Asset → `{#each}` over assets grouped by an `assetCategory` enum
  (real-estate/equipment/securities/other; `assetJurisdiction` already exists),
  each with acquire/dispose `{#if}`.

**A3 — Subscription Agreement annex (the one L item).** Add `companionDocuments`
to the allotment packet; `createPacketRunArtifacts` loops subscribers and emits one
"Subscription for Shares" DOCX each (using the A1 signature block). The only
renderer item producing N documents from one packet.

### Theme B — Clone is lossy and unsound

In `convex/society.ts`:
- Add `rightsHoldings`, `rightsholdingTransfers`, `dividends`, `assets`,
  `assetEvents`, `significantIndividualSteps` to `CLONE_CHILD_TABLES` (L483–494) —
  all six have `by_society` indexes.
- Replace the flat `{...fields, societyId}` insert (L505–528) with a **two-pass
  idMap**: pass 1 inserts each child and records `oldId → newId`; pass 2 rewrites
  cross-ref Id fields (`rightsHoldings.rightsClassId/holderRoleHolderId/lastTransactionId`,
  `rightsholdingTransfers.sourceRoleHolderId/destinationRoleHolderId/rightsClassId`,
  any `entitySigners → roleHolders` ref). `directoryPersonId` is cross-tenant —
  leave as-is.
- Ship B2 *with* B1: without remapping, cloned equity rows point at the source
  society and produce corrupt data.

### Theme C — Derived-state engines never ported

- **C1 Voting-power roll-up** (`shared/votingPower.ts`): per holder,
  Σ(quantity × votesPerShare); partition voting(>0)/non-voting. Requires a
  **numeric** `votesPerShare?` on `rightsClasses` (today `votingRights` is free
  text). Combine with `registerHistory.activeAsOf`; expose a
  `votingShareholdersAsOf` query consumed by the "all voting shareholders" packet.
- **C2 Voting-eligibility gating** (cheap, inside C1): filter eligible voters by
  `isIndividual && atAgeOfMajority` (flags already on schema, unused).
- **C3 Dividend reconciliation** (`shared/dividends.ts`):
  `reconcileDividend(perShare, shares, enteredTotal) → 'match'|'within_1pct'|'over_1pct'`;
  surface in `validateDividend` + a warning chip on the Dividends page (add optional
  `enteredTotalCents` to compare against the computed value).

## 4. Top 5 worth doing next

1. **Execution/signature block (A1)** — highest leverage; converts *every*
   generated document into a signable instrument and finally consumes the
   already-built `entitySigners` table. high / M.
2. **Clone child-table completeness + ID remapping (B1+B2)** — fixes a real
   data-loss + dangling-reference bug; ship together. high / M.
3. **Resolution-body templating (A2)** — turns the prose-thin packets into real
   resolutions using the *existing* `{#if}/{#each}` engine and *existing* data.
   Do Annual + Dividend first. high / M per packet.
4. **Voting-power roll-up + eligibility gating (C1+C2)** — the only missing
   derived engine that blocks a feature ("all voting shareholders" can't enumerate
   voters today). high / M.
5. **Subscription Agreement annex (A3)** — completes the allotment deliverable.
   high / L.

## 5. Confirmed covered / correctly deferred (audit was thorough)

**Confirmed already covered:** blank resolution shells (Custom 1/2/3); Custom
7/12/15-20 register/ISC layouts; `Update_Restrict_Select_PEOPLE` picker scoping;
`Update_*_Date_Index` (9 procs, pure date sort); `Set_Conditional_Format` /
`Display_Headings` / `Font_Space_Setting` (cosmetic, mostly dead code);
`Send_Email`/`Send_Confirmation` (vendor licensing); `Is_Corporation` (our
`ORGANIZATION_PATTERN` is a superset); `Refresh_DB_ID` resequencing; `Num_Comma`
core logic; ISS_TYP='Certificate' re-certification; DIV_CURRENCY multi-currency;
TRANSPARENCY citizen/tax tri-state + step cadence; DIRECTOR/OFFICER revision
chains; rightsClasses singularForm + endDate(cancel); officer multi-title
conjunction grammar; days-in-month / month / char-width / cert-numbering lookup
tables.

**Correctly left deferred (low value):** LOTR (Custom 19), one-click annual
bundle, transaction-routed dispatcher, batch multi-clone, blank-entity overwrite
guard, per-class vs consolidated PRINT layouts, per-row provenance display,
REG_POSN manual ordering, FIRM_ID dedup, revision-purge
(`Delete_Revision_Tracking_Records`), `Document_Package_Custom`, annual covering
letter, Excel/PDF pagination + font-metric text-wrap, trial-version lock,
`DOC_MGMT_DIRECTORY` on-disk path (no web analog).

## Relevant files for follow-up

`shared/corporationPacketDocx.ts` (L30–52), `shared/corporationDocumentPackets.ts`,
`shared/societyDocumentPackets.ts`, `convex/society.ts` (CLONE_CHILD_TABLES
L483–494, insert L505–528), `convex/entitySigners.ts`, `shared/equityLedger.ts`,
`shared/dividends.ts`, `convex/legalOperations.ts`.

---

# CLOSURE STATUS — Top 5 worked through (see commits)

All five highest-value items are implemented, each its own commit, every gate
green (`convex:typecheck` + app `tsc` + `static-parity` + corp regressions).

| # | Item | How it was closed | Test |
|---|---|---|---|
| 1 | Execution/signature block | `shared/executionBlock.ts` (adoption clause + signature page, corporate "By:"); `createPacketRunArtifacts` builds it from `entitySigners` (as-of) or the resolving body's role holders and attaches it to the render context; the DOCX renderer prints it (opt-in, back-compat). Finally consumes the dormant `entitySigners` table. | `check-execution-block` |
| 2 | Clone completeness + ID remapping | `cloneSociety` now copies the equity ledger / dividends / assets / asset-events / SI-steps (6 added tables) and does a two-pass old→new Id remap so cloned rows reference cloned rows; cross-tenant Ids pass through. Mirrored in the static client. | `check-clone-society` |
| 3 | Resolution-body templating (Annual + Dividend) | `shared/annualResolution.ts` + `shared/dividendResolution.ts` (pure); the `annual-resolutions` packet renders the six real consent clauses (FS approve/waive, fix FYE, auditor appoint/waive, ratify acts, director slate, deemed-AGM), the `dividend-declaration` packet a multi-class currency table; data merged into the render context per packet key. | `check-annual-resolution`, `check-dividend-resolution` |
| 4 | Voting-power + eligibility engine | `shared/votingPower.ts` (Σ shares × votes-per-share, voting/non-voting partition, eligible-signatory gate); `rightsClasses.votesPerShare` field; `legalOperations.votingPower` query + static mirror + a Voting-power section on the rights-ledger page. | `check-voting-power` |
| 5 | Subscription Agreement annex | `shared/subscriptionAgreement.ts` (per-subscriber "Subscription for Shares") + generic `documentDocxBytes` export; `createPacketRunArtifacts` emits one annex per subscriber of the latest issuance for the `issue-shares` packet, linked into the minute book + run. | `check-subscription-agreement` |

## Still open (next tier, from the table above)

Director appt/removal as one voting-shareholder instrument; change-of-office
from→to clause; share-split tie to the special resolution + cert handling;
share-certificate cancellation/seal clause; dividend reconciliation (±1%);
REG_FILING registration-event import; bilingual EN/FR bodies; thousands-separator
formatting; OFFICER structured booleans; ISS_TYP split vocabulary; per-contact
business-address dates. (All medium/low value.)
