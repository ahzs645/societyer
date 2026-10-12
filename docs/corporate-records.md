# Corporate records: share register, resolutions and minute book

This guide covers the corporate-records features for business corporations: the share ledger and
certificates, share-class rights, redemptions, dividends, the BC transparency register, director
and officer eligibility, the record of adopted articles, resolution packets and their Word output,
minute-book reports, and the importer for the YCN Access records system. It is written for people
changing this code and for people checking what the app does.

The design follows a BC lawyer's Excel/Access corporate records system and a 2016 BC company's
incorporation agreement and articles (Table 1 plus Parts for redeemable Class A voting preferred and
Class B/C non-voting preferred shares). Where the lawyer's tool and Societyer differ, Societyer keeps
the stricter rule. For example, it requires a solvency confirmation before a dividend and treats the
financial-statement and auditor waivers as separate decisions.

> **Legal review boundary.** Every template is preparation text for a lawyer to review. Section
> numbers were checked against the BC Laws consolidation current to 2026-10-06 (see
> [Statute references](#statute-references)). Tax consequences, such as deemed dividends on redemption
> or TOSI on dividends to family members, are flagged and never assessed. Significant-individual
> candidates and class-rights summaries are review prompts, not determinations.

## Contents

- [Scope and entity awareness](#scope-and-entity-awareness)
- [Share ledger](#share-ledger)
- [Share-class rights](#share-class-rights)
- [Redemptions](#redemptions)
- [Certificates](#certificates)
- [Class votes and electorates](#class-votes-and-electorates)
- [Dividends](#dividends)
- [Transparency register](#transparency-register)
- [Director and officer eligibility](#director-and-officer-eligibility)
- [Operative articles](#operative-articles)
- [Resolution packets](#resolution-packets)
- [Word output](#word-output)
- [Minute-book reports](#minute-book-reports)
- [Records retention and cloning](#records-retention-and-cloning)
- [YCN Access importer](#ycn-access-importer)
- [Statute references](#statute-references)
- [Tests and generated files](#tests-and-generated-files)
- [Known limits and follow-ups](#known-limits-and-follow-ups)

## Scope and entity awareness

Corporate-records rules apply to corporations only. BC-specific rules and citations apply only to
a BC company under the *Business Corporations Act*. Federal (CBCA) and Ontario (OBCA) corporations
get their own wording where the rule differs, and otherwise the rule without a BC citation.
Societies keep their own Societies Act behaviour and never see share or corporate-records copy.

Use the existing helpers rather than new entity switches:

| Helper | Use |
| --- | --- |
| `organizationRuleScope` (`shared/entityRuleScope.ts`) | Which rule family applies to an organization |
| `legalGovernanceProfile` (`shared/legalGovernanceProfiles.ts`) | The governance profile (`bc_society`, `bc_company`, `federal_cbca`, `ontario_obca`) |
| `organizationVocabulary` (`src/lib/organizationVocabulary.ts`) | Member/shareholder, board/directors and similar labels |
| `articlesApplyTo` (`shared/operativeArticles.ts`) | Whether the operative-articles record applies (BC companies only) |

The strict entity copy sweep (`ENTITY_SWEEP_STRICT=1 npm run test:entity-sweep`) fails on any
society-only copy in a corporation workspace, or the reverse. See the
[entity copy audit](entity-copy-audit.md).

## Share ledger

Code: `shared/equityLedger.ts`, `shared/functions/rightsholdingTransfers.ts`.

The `rightsholdingTransfers` table is the securities ledger. Each row is an `issuance`,
`transfer`, `redemption`, `cancellation`, split or consolidation, with a status of `draft`,
`posted` or `void`. Only posted rows count. `validateLedger` replays the posted rows in order and
rejects any holding that would go negative.

| Helper | What it does |
| --- | --- |
| `holdingsAsOf(transfers, isoDate)` | Holdings per holder and class at the end of that day. A row with no transfer date falls back to the day it was entered. |
| `compareLedgerEntries` | Chronological order: transfer date, then the optional same-day `sequence`, then entry time. |
| `validateLedgerWithout(remaining, removed, action)` | Re-validates the ledger before a posted row is deleted or voided. |

Rules enforced when a row is posted:

- **Authorized maximum:** an issuance cannot take a class above its `maxAuthorized`.
- **Fully paid before issue (BC s. 64(2)):** an issuance needs `fullyPaidConfirmedAt` on or before
  the issue date. A share issued as a stock dividend is deemed fully paid (s. 65). Par value sets
  the minimum price.
- **Directors' consent:** when `transferConsentRequired(org)` is true, a transfer needs a linked
  directors' consent. See [Operative articles](#operative-articles).
- **Redemption freeze:** shares under an outstanding redemption notice cannot be transferred.
- **Delete and void:** a posted row can be deleted or voided only if the rest of the ledger stays
  valid. For a corporation, a posted row is also protected by the retention guard. See
  [Records retention and cloning](#records-retention-and-cloning).

## Share-class rights

Code: `rightsClasses` in `convex/schema.ts`, `shared/functions/rightsClasses.ts`, the class
editor in `src/pages/LegalOperations.tsx`.

The class's free-text rights fields remain the authority. The structured fields below summarize
the articles so that the ledger, dividends, redemptions and templates can use them:

| Field | Meaning |
| --- | --- |
| `parValueCents` | Par value; absent means no par value |
| `maxAuthorized` | Maximum number of shares; absent means unlimited |
| `dividendEntitlement` | `discretionary_by_class`, `fixed_rate`, `cumulative_fixed` or `participating` |
| `dividendRateBps` | Required for fixed and cumulative dividends |
| `redemption` | `{ byCompany, byHolder, priceCents, includesDeclaredUnpaid, minNoticeDays, nonProRataPermitted }` |
| `liquidationRank` | 1 is paid first; equal numbers rank equally |
| `preEmptiveRights`, `articlesPart` | Pre-emptive rights flag; the Part of the articles that sets the rights (for example "Part 21") |
| `singularDescription`, `pluralDescription` | Wording used in templates, for example "Class A Voting Preferred Share" |

The "Family holding company" preset creates Common plus Class A voting preferred and Class B and C
non-voting preferred shares. It creates them only after the user confirms they match the articles,
and creates them as Needs review.

## Redemptions

A redemption is posted as kind `redemption`, not `cancellation`, and returns the shares to unissued
capital. Posting is refused unless all of these hold:

- the class is redeemable;
- the holder has the shares;
- the minimum notice period is met, or a waiver date is recorded;
- a solvency confirmation date is recorded (BC ss. 78–79).

A draft redemption with a notice date freezes those shares against transfer. The `share-redemption`
packet is a directors' resolution with the redemption table and notice particulars (BC ss. 77(a),
79(1)).

## Certificates

Code: `shared/shareCertificates.ts`, `shared/functions/shareCertificates.ts`.

- Certificate numbers are unique per organization, because replacement chains look a certificate
  up by its number.
- `reconcileCertificatesWithLedger` checks that the certificates outstanding for each holder and
  class equal the ledger holdings on a date.
- On a transfer, the cancelled certificate must equal the shares transferred plus the balance
  certificate issued back to the transferor (`certificateConservationIssues`). Duplicate numbers are
  caught by `duplicateCertificateNumber`.

## Class votes and electorates

Code: `shared/shareholderElectorate.ts`, `shared/functions/electionElectorate.ts`, the class-vote
UI in `src/pages/ElectionDetail.tsx`.

An ordinary poll weights each share by its class's `votesPerShare`, so non-voting shares get no
vote. A separate class vote (`classIds` set) counts every share of the selected classes, voting
or not. Each such row carries `basis: "class_separate_resolution"`. This follows BC s. 61 and
s. 173(9), and the BC citation is shown for BC companies only.

Record dates and "today" are the organization's local date (`organizationToday`), never the UTC
date.

## Dividends

Code: `dividends` in `convex/tables/ycnRegisters.ts`, `shared/dividends.ts`,
`shared/dividendHoldingsAsOf.ts`, `shared/functions/dividends.ts`, `convex/dividends.ts`.

- A declaration is linked to a class and records `recordDate`, `paymentDate` and
  `declaredByResolutionId`. It can list `excludedClassIds` when the board declares on one class and
  not others.
- `perShareAmount` is a decimal string, multiplied exactly. Each payment is rounded half up to the
  cent, and any rounding difference is reported.
- Shares outstanding come from the ledger at the end of the record date, with a per-holder
  snapshot. Unlike `holdingsAsOf`, ledger rows with no transfer date are left out and reported by
  `undatedPostedTransfers`, because an entitlement must not rest on a guessed date. A hand-entered
  count is used only when the ledger has nothing for the class.
- A declaration cannot be marked declared or paid without `solvencyConfirmedAt` and
  `solvencyBasis` (BC s. 70; director liability s. 154(1)(c)).
- For BC companies, the record date can be at most two months before payment (s. 171).
- The old ±1% reconciliation of totals is a warning only.
- The dividend form cautions that class-by-class dividends to family members may attract the tax on
  split income (TOSI) and attribution rules, and that Societyer does not assess tax.

## Transparency register

Code: `shared/significantIndividuals.ts`, transparency deadlines in `shared/corporationSettings.ts`.

The BC transparency register is in Part 4.1 of the Act (ss. 119.1–119.91). Deadlines are derived
for BC companies only:

| Obligation | Period | Section |
| --- | --- | --- |
| Record a change | Within 30 days after becoming aware | s. 119.31(1) |
| Annual review | From the recognition anniversary to two months after it | ss. 119.3, 119.31(2) |
| Notify the individual | Within 10 days after the register entry | s. 119.41 |
| Dispose of former individuals' records | Within one year after the sixth anniversary of the entry showing they ceased | s. 119.4 |

The 15-day period applies to the federal CBCA register (s. 21.1), not to BC.

Candidates are holders with 25% or more of all issued shares (every class, non-voting included) or
25% or more of the votes. Non-individual holders get a prompt to look through them. Candidates are
review prompts; the register entry is still the user's decision. Dates of birth are masked unless
the user chooses to show them. Only directors and inspecting officials may see the register
(s. 119.61).

## Director and officer eligibility

Code: `shared/registerValidation.ts`.

- For a BC company, saving is refused when a director is not an individual, or a director or officer
  is under 18 (ss. 124(1), 124(2)(a), 141(3)).
- The other s. 124(2) disqualifications appear as a review note, because the app holds no data for
  them.
- Every corporation gets warnings for an officer with no office and for two current holders of a
  single office, such as two Presidents.

## Operative articles

Code: `shared/operativeArticles.ts`, `convex/validators/operativeArticles.ts`, the Articles section
of Compliance settings, the `corporationSettings:updateOperativeArticles` mutation.

The `operativeArticles` field on the organization records which articles a BC company adopted:

- `base`: `bc_table_1` (with the Table 1 version and how it became part of the articles) or `custom`;
- the adoption date and any custom Parts;
- overrides: notice minimum, special majority, shareholder and board quorum, chair's casting vote,
  `transferConsentRequired` and `electronicParticipationRestricted`;
- the director and officer indemnity type, and the source document.

Table 1 is never inferred from silence. Under s. 261(2), later amendments to Table 1 flow into
articles that adopt it by reference, and the record warns about this.

`transferConsentRequired(org)` returns an explicit recorded answer when there is one. Otherwise it
returns true for a non-distributing BC company that recorded Table 1 (Art. 20.2).

Once formation is verified, a BC company's baseline reads the record:

- **Board quorum:** a majority of directors in office, or 1 for a sole director (Arts. 11.10–11.11).
- **General-meeting quorum:** two persons holding at least 1/20 of the voting shares (Arts. 8.2–8.3),
  worked out from the securities register through `legalMeetingQuorum`. Quorum is never confirmed
  from attendee names alone.

The `bc-incorporation-agreement` and `bc-articles-preparation` packets add the "Table 1
supplemented by Parts" pattern and generate a per-class Part skeleton (`shared/articlesPartSkeleton.ts`)
with these drafting checks:

- a rate is required for cumulative dividends;
- the ranking between preferred classes must be stated;
- freeze shares need redemption-price and price-adjustment terms;
- the rights of common shares must be spelled out.

`bc-officer-indemnity-agreement` is a preparation-only draft with the limits of ss. 160–165.

## Resolution packets

Code: `shared/corporationDocumentPackets.ts` (the catalogue), `shared/packetOperativeData.ts`
(data views), `buildPacketDataContext` in `shared/functions/legalDocuments.ts`,
`shared/renderContext.ts`, `shared/societyRenderContext.ts`, `shared/nlg.ts`,
`shared/executionBlock.ts`, `shared/annualResolution.ts`.

**Signers.** `requiredSigners` tags decide the resolving body; an `all_*` tag takes priority. The
default signers are that body's members as at the document date:

| Packet | Resolving body |
| --- | --- |
| `appoint-director`, `director-removal` | Voting shareholders. BC removal is a special resolution under s. 128(3), or the method the articles provide. |
| `appoint-director-by-directors` | Directors, for casual vacancies and additional directors only |
| `director-resignation` | Directors record the resignation; a resignation-letter annex is attached |
| `director-consent-to-act` | The director whose appointment starts on the document date. If there is none, the user chooses. |

There is no directors' route for removing a director. The BCA gives directors no such power; a
disqualified director must resign (s. 124(3)).

**Transaction scoping.** A packet renders only the transaction being approved:

- the rows effective on its event date, or the ids passed in `transactionIds`;
- names, offices and directors read as at that date;
- `packetEventDates` and `packetEventDatesByKind` list the dates where each transaction type
  exists, and the Document Catalog offers them in a transaction-date picker.

**Grammar.**

- The render context has `shareholders` and `votingShareholders` groups, plus a/an, it/them and
  class-noun helpers. It never writes "share(s)".
- The Act is named with its jurisdiction, for example "Business Corporations Act (British
  Columbia)". BC records before 29 March 2004 read "Company Act (British Columbia)".

**Operative wording.** The lawyer's wording is ported for:

- allotment, with a subscriber table and consideration recital;
- transfer, with the directors' consent where required and a balance certificate;
- replacement certificates;
- splits and consolidations, reciting the special resolution and prompting for a Notice of Alteration;
- dividends, offices and assets;
- the annual package, with an optional ratification clause and a BC deemed-AGM sentence, plus
  `annual-directors-resolution`.

**Body blocks.** A packet body item is a string or a `PacketBlock` (`shared/packetBlocks.ts`). Any
block may carry `when: "path"` or `"!path"`. The kinds are:

| Kind | Renders |
| --- | --- |
| `title` | The subtitle |
| `heading`, `paragraph`, `note` | Plain text |
| `recital` | A WHEREAS paragraph |
| `resolved` | "BE IT RESOLVED THAT:". It is also inserted automatically before clause 1. |
| `clause` | A numbered clause (optional `number`) |
| `adoption` | Replaces the generated adoption clause |
| `table` | `{ columns, rows }` or `{ columns, each, cells: ["{.field}"], emptyText, widths }` |
| `signatures` | `{ signers: [{ name, capacity, corpSign }], dateLine }` |
| `pageBreak` | A page break |

To add a packet:

1. Add an entry to `CORPORATION_DOCUMENT_PACKETS`, or to `shared/corporationReportPackets.ts` for
   report-style output.
2. Add its data view in `shared/packetOperativeData.ts` and a `case` in `buildPacketDataContext`.
3. Use blocks for the body.
4. Extend `scripts/check-packet-grammar.ts` and `scripts/check-packet-instruments.ts`.

## Word output

Code: `shared/corporationPacketDocx.ts`, `shared/packetInstrument.ts`.

An executable packet prints, in order:

1. an optional document ID;
2. the company name and a possessive title, such as "CONSENT DIRECTORS' RESOLUTION";
3. recitals;
4. "BE IT RESOLVED THAT:" and numbered clauses, with real tables;
5. "Dated:";
6. an entity-aware adoption clause;
7. a two-column signature table. Rows never split across pages, a corporate signer gets a "By:"
   line, and a caption repeats the date on the signature page.

The review checklist is a separate "Review memo" section on a new page. It is not part of the
signed instrument. `corporationPacketInstrumentDocxBytes` and `corporationPacketReviewMemoDocxBytes`
return the two parts separately. Preparation-only packets show "PREPARATION DRAFT — NOT FOR
EXECUTION".

Document IDs combine the registry number, the packet and a per-day sequence, for example
`BC1234567-share-transfer-2026-10-12-02`. The organization setting `omitAdoptionClause` drops the
adoption clause, and `includeDocumentIdHeader` controls the ID header.

## Minute-book reports

Code: `shared/corporationReportPackets.ts`, `shared/minuteBookReports.ts`,
`shared/minuteBookReportData.ts`. These appear in the "Minute book reports" card of the Document
Catalog, for corporations only, with an as-of date.

| Report | Notes |
| --- | --- |
| BC transparency register | BC only; restricted (s. 119.61) |
| Land Owner Transparency worksheet | 10% interests; BC only; restricted; SIN and tax numbers stay `<FILL>` |
| Director's consent to act | Wording per Act: BC ss. 123(1)(a), 124, 126; CBCA s. 106(9); OBCA s. 119(9)–(11) |
| Securities register | By class and holder, with certificate numbers (uses `holdingsAsOf`) |
| Registers of directors and officers | As at the date |
| Corporate information summary | Name as of the date, offices, directors, officers, share structure, holdings |
| Covering letter | Accompanies a document package |

The restricted reports are refused before anything is written for a workspace role below Director.
The stored document is marked restricted.

## Records retention and cloning

Code: `shared/registerRetention.ts`, `cloneSocietyPortable` in `shared/functions/society.ts`.

- **Protected rows:** for corporations, posted share transactions, issued certificates, name history
  and constating events cannot be hard-deleted. The error tells the user to void, cancel or end-date
  the row instead. Rows entered in the last 24 hours can still be deleted to fix mistakes.
- **History:** name history and constating events take an end date and linked source documents.
  Portfolio search finds an organization by a former name.
- **Copying an organization as a template:**
  - reset start dates to a chosen date;
  - leave out holdings, significant individuals or all people, and any row that points at them;
  - make up to 20 numbered copies;
  - set the new registry number, with a warning if it already exists.

## YCN Access importer

Code: `shared/ycnAccessImport.ts`, `shared/ycnShareConversion.ts`, `shared/ycnDate.ts`, the apply
step in `shared/functions/importSessionHelpers/`, the runner `scripts/import-ycn-access.ts`. See also
the [YCN wiring plan](ycn-wiring-plan.md). The runner needs `mdbtools`.

```bash
# List the entities in a database
npx tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --list-entities
# Build an import bundle for one entity
npx tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --entity <ENT_ID> --out bundle.json
# Or stage it straight into an organization
npx tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --entity <ENT_ID> --society <societyId>
```

**Entities.** `--entity` is required when the database holds more than one. Every table is
filtered to that entity, and the global people directory is narrowed to its roster.

**Fields.**

- Offices are dated, with current and past status.
- Registrations keep their type, number and date.
- Annual filings go into the filing ledger.
- Officers keep several titles.
- The fiscal year end is imported.
- `29991231` means no end date.
- A two-digit birth year is resolved using the age-of-majority flag, and flagged when both centuries
  are plausible.

**Shares.** The YCN register is kept by certificate: holdings on a date are the certificates active
on that date. The conversion:

- turns the certificates into ledger rows, with the source holder on every transfer;
- treats replacement certificates as replacements, not extra transfers;
- uses positive quantities for consolidations;
- records a cancellation with no successor as a redemption;
- links classes and holders by id.

It then checks that the ledger matches the active certificates at every certificate event date. The
register is staged as `posted` only if they match; otherwise it is staged as `needs_review`.

**People.** Directors, officers, shareholders and significant individuals get their name and address
from the roster as at the right date. Nobody becomes an authorized signer just for being on the
roster.

**Retain_List.** This table is a client list with a responsible lawyer, not a retention schedule.
Only `RESP_LWYR` is mapped, to `societies.responsibleLawyer`.

**Test data.** Test fixtures must be synthetic. Never commit a real YCN database, or names,
addresses, birth dates or incorporation numbers taken from one.

## Statute references

Source records live in `shared/corporateLegalSources.ts`. Each new BC source was checked against the
consolidation current to 2026-10-06. Corrections made during verification:

| Topic | Correct reference | Note |
| --- | --- | --- |
| Transparency register | Part 4.1, ss. 119.1–119.91 | Not Part 2.1; updates are due within 30 days (s. 119.31), not 15 |
| Fully paid before issue | s. 64(2) | s. 63 sets the issue price; s. 65 deems stock-dividend shares fully paid |
| Redemption | ss. 77–79, 82 | s. 76 is conversion and exchange |
| Electronic participation | s. 174 | s. 173 is voting |
| Director removal | s. 128(3)–(4) | There is no statutory directors' removal power |
| Indemnity | ss. 159–165 | s. 163(2) bars indemnity in proceedings by or for the company; only a court order under s. 164 can give relief |
| Deemed AGM date | s. 182(5) and Table 1 Art. 7.2 | The date of the unanimous resolution, not the annual reference date |

The source IDs added in this work are:

- `BC-BCA-SHARE-RIGHTS`, `BC-BCA-SHARE-ISSUE`, `BC-BCA-REDEMPTION`, `BC-BCA-SHARE-TRANSFER`;
- `BC-BCA-DIVIDENDS`, `BC-BCA-DIRECTOR-REMOVAL`;
- `BC-BCA-TABLE1-ARTICLES`, `BC-BCA-INDEMNITY`, `BC-BCA-ELECTRONIC-MEETINGS`.

The research record is in [docs/legal-research](legal-research/README.md).

## Tests and generated files

The legal regression runner (`npm run test:legal`) includes:

| Area | Checks |
| --- | --- |
| Share capital | `check-share-ledger-rules.ts` |
| Dividends | `check-dividend-declarations.ts` |
| Transparency and eligibility | `check-transparency-register.ts`, `check-director-officer-eligibility.ts` |
| Articles and retention | `check-operative-articles.ts`, `check-register-retention.ts` |
| Packets | `check-packet-instruments.ts`, `check-packet-grammar.ts`, `check-packet-operative-data.ts` |
| Reports | `check-minute-book-reports.ts` |
| YCN importer | `check-ycn-date-codec.ts`, `check-ycn-share-conversion.ts`, `check-ycn-access-import.ts` |

Before pushing a change in this area, run:

```bash
npm run test:legal                       # all legal and evidence checks
npm run test:legal:after-utc-midnight    # the same checks with the clock just after 00:00 UTC
npx tsc -b && npm run convex:typecheck
npm run test:portable-manifest           # run `npm run manifest:portable` first if you changed functions
npm run test:stage2-enforced             # run `npx tsx scripts/stage2/function-inventory.ts --write` first if you added endpoints
ENTITY_SWEEP_STRICT=1 npm run test:entity-sweep   # if you changed UI copy
```

`stage2-tenancy-report.md` is rewritten by the tenancy checks. Restore it with
`git checkout -- stage2-tenancy-report.md` unless you mean to update it.

## Known limits and follow-ups

- **Certificate class:** `shareCertificates` stores the class as a name, not a class id.
- **Retained shares:** redeemed shares retained by the company (s. 82(1)(c)) are not modelled.
- **Holder redemptions:** posting a redemption also accepts a class that is redeemable by the
  holder, not only by the company.
- **Asset identifiers:** assets have no PID field, so asset resolutions use the serial number.
- **YCN votes per share:** mdbtools cannot read the Access `VOTING` column, so votes per share is
  inferred from the class name and flagged for review.
- **Dated particulars:** the schema has no dated name or address per entity, so earlier particulars
  from a YCN import go into notes.
- **Cloning dividends:** `cloneSocietyPortable` does not remap `declaredByResolutionId` or the
  holder ids inside dividend entitlements.
- **Demo batch path:** the static demo batch path does not build report data, so it prints fallback
  text.
