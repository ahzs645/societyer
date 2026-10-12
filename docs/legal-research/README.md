# Entity-aware legal research and implementation

**Review date: 11 October 2026. Coverage: 102 of 102 questions answered.**

This directory completes the supplied [research brief](brief.md) and connects its answers to Societyer's legal profiles, source records, evidence workflows and regression gates. The work builds on the entity-isolation foundation at commit `24500708d8a61678aedcf1e90d20f9d0df566b01` (`claude/admiring-brown-utjnwt`). That foundation is part of this review branch; the repository's older `main` does not contain it.

The answers distinguish the law, registry practice, the organization's governing documents, and facts that must be established before a workflow can claim completion. A researched answer does not mean every exception can be decided automatically. The machine-readable [coverage manifest](coverage.json) identifies implementation levels and review boundaries for each question.

## Read the findings

| Questions | Answer file | Coverage |
| --- | --- | ---: |
| BC societies, SOC-1–SOC-16 | [Societies](societies.md) | 16/16 |
| BC companies, BCC-1–BCC-17 | [Corporations](corporations.md#bcc-1) | 17/17 |
| Federal CBCA companies, FED-1–FED-16 | [Corporations](corporations.md#fed-1) | 16/16 |
| Ontario OBCA companies, ONT-1–ONT-12 | [Corporations](corporations.md#ont-1) | 12/12 |
| Privacy, PRV-1–PRV-9 | [Privacy](privacy.md) | 9/9 |
| Meetings and voting, MTG-1–MTG-10 | [Meetings and records](meetings-records.md#mtg-1) | 10/10 |
| Records, REC-1–REC-7 | [Meetings and records](meetings-records.md#rec-1) | 7/7 |
| Other entities, OTH-1–OTH-6 | [Other entities and terminology](other-entities-terminology.md#oth-1) | 6/6 |
| Terminology, TRM-1–TRM-9 | [Other entities and terminology](other-entities-terminology.md#trm-1) | 9/9 |

[UI and source review](ui-source-review.md) records the additional qualification, auditor, conflict and privacy sources checked while updating the actual screens. [Extending the system](extending-legal-profiles.md) describes the code contract and gates for future laws. [Verification](verification.md) records the executed checks and remaining environment limits.

## Findings that change behaviour

The following corrections are supported by the detailed answers and their linked official sources:

1. **Federal resident-Canadian directors remain required under the general CBCA rule.** Section 105(3) still provides the 25% rule, with at least one when there are fewer than four directors. Separate regulated-sector and meeting-attendance rules require their own review. Ontario's repealed quota must not be generalized to federal corporations. See [FED-1](corporations.md#fed-1).
2. **A member-funded BC society still needs at least one director.** The exception removes the ordinary three-director minimum and BC-residence requirement; it does not remove the director requirement altogether. Annual qualification attestations are optional governance practice unless separately required. See [SOC-1](societies.md#soc-1), [SOC-2](societies.md#soc-2), [SOC-4](societies.md#soc-4).
3. **Written approval does not use one universal majority.** BC ordinary member/shareholder consent follows the statutory special majority, usually two-thirds, after circulation to the entire eligible electorate. Federal shareholder and board written resolutions require unanimity. Ontario non-offering ordinary shareholder resolutions may use a majority of the shares entitled to vote, subject to higher requirements and notice to non-signers. Special resolutions and auditor waivers have separate rules. See [SOC-12](societies.md#soc-12), [BCC-10](corporations.md#bcc-10), [FED-8](corporations.md#fed-8), [ONT-8](corporations.md#ont-8).
4. **Annual business and annual filing use different clocks.** BC societies have calendar-year AGM and AGM/no-AGM filing rules. BC companies use a two-calendar-month anniversary filing period; federal companies use 60 days; Ontario uses the taxation period and applicable six-month filing period. Scheduled meetings, undated annual-year fields and an old receipt with no identifiable reporting period cannot silently close these obligations. See [SOC-9–10](societies.md#soc-9), [BCC-6–7](corporations.md#bcc-6), [FED-5–6](corporations.md#fed-5), [ONT-5–6](corporations.md#ont-5).
5. **BC company notice has a two-calendar-month maximum.** Calculating backwards from the meeting date matters at month end. The lawful minimum also depends on public status and the articles. Notice audiences differ from voting audiences and financial-statement recipients. See [BCC-8](corporations.md#bcc-8), [MTG-1–2](meetings-records.md#mtg-1).
6. **Privacy follows activities and information handling.** BC PIPA applies to every organization, including a not-for-profit (ss. 1, 3(1)), so it is presumed for a BC-home workspace and labelled as a presumption until the recorded facts confirm or displace it (federal work, health or public-sector records, operations outside BC). No other law is presumed from incorporation, and federal incorporation does not establish a federal undertaking. The app records operating jurisdictions, commercial activity, cross-border handling, federal-work status, sector-specific law and Alberta nonprofit status. More than one law can apply. See [PRV-1–6](privacy.md#prv-1).
7. **Record access and retention depend on the record and law.** Shareholder/member inspection rights do not automatically extend to all board records or restricted beneficial-ownership data. A general seven-year destruction rule is inappropriate for many core corporate records. See [REC-1–3](meetings-records.md#rec-1).
8. **A calculated calendar date is not always the final legal boundary.** The applicable interpretation statute, holiday calendar, locality and filing office can affect expiry. BC notice boundaries before a meeting can move earlier. The system retains nominal dates for planning and requires specific calendar evidence before an adverse legal timeliness finding. See the [calendar review](meetings-records.md#mtg-2), the [BC Interpretation Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96238_01), [federal Interpretation Act s. 26](https://laws-lois.justice.gc.ca/eng/acts/I-21/section-26.html) and [Ontario Legislation Act ss. 88–89](https://www.ontario.ca/laws/statute/06l21).

## Delivered application behaviour

### Four reviewed governance profiles

BC society, BC company, federal CBCA and Ontario OBCA profiles now supply director requirements, annual-meeting and filing rules, notice windows, resolution thresholds, records guidance and source identifiers. Explicit unknown or contradictory governing Acts remain in review status. Non-share nonprofit corporations and cooperatives do not inherit business-company shareholder rules merely because their name includes “corporation.”

The dashboard and director screens use those profiles. The Canadian-residency assessment is distinct from BC ordinary residence and includes unknown status. Qualification, auditor, conflict and court-order screens use the applicable sources. New forms no longer pre-confirm material factual attestations such as abstention or auditor independence.

### Evidence for written resolutions and elections

Written resolutions require operative text, governing-instrument review, circulation evidence and a frozen eligible electorate. Counts use stable register identities. Corporate counts derive from reviewed share/class holdings; Ontario's ordinary written denominator excludes non-voting shares and uses entitled shares rather than weighted votes. An entered threshold cannot lower the statutory threshold.

An officer records an existing person's consent and its actual time; that action does not impersonate the signer. Audit recording time is separate. Chronology, duplicate evidence, foreign records and signature weights are validated. Legacy carried rows without verified authority remain available but appear as requiring review. Ontario non-signer notice has its own evidence and reviewed business-day deadline; a carried resolution can still have notice outstanding.

Corporate elections use reviewed share-class and record-date inputs, explicit authorized representative accounts and frozen opening weights. Cumulative voting uses its own allocation logic. Notice coverage uses recipient identities and actual sent evidence, so repeated messages to one recipient do not cover missing recipients. These workflows retain class, historical-register, representation and governing-document review boundaries.

### Annual cycle, filings and documents

Annual-cycle and settings screens share an evidence adapter and statutory date assessments. Filings can record a reporting year and exact taxation period end. Old unfiled cycles stay visible. Ambiguous fiscal ranges do not establish a registry reporting year. An authorized postponed BC society AGM is attributed once; an overdue planned meeting does not become a held meeting when the date passes.

The annual assessment retains `nominalDueDate` and a separate calendar review state. A completed filing remains factually complete even when its timeliness needs review. A reviewed date must match the exact profile, obligation, cycle and nominal boundary, with affirmative verification and supporting calendar evidence. No universal weekend adjustment is inferred. Compliance settings record the calendar review with its basis, evidence and reviewer; without one, a boundary passed by more than seven days is overdue. Older compliance schedule packs display calculated scheduling status with the same limitation.

Annual corporate packets are preparation drafts. Their Act-specific clauses and selected source editions are captured at generation. Shareholder approval, director approval, financial-statement preparation/receipt waivers and auditor waivers remain separate decisions. Creating a draft does not deem an AGM held, appoint an auditor or supply a legal shareholder-signature roster. Preparation-only records cannot be signed or finalized as completed annual business through the ordinary document action. Core annual records do not receive an automatic seven-year destruction default.

Ontario's reviewed annual preparation packet is available through a narrow catalogue exception; Ontario incorporation remains gated. Older unexecuted annual drafts receive a visible review guard and retention warning. Executed originals retain their stored contents, execution evidence and provenance. Independently reviewed annual-business completions can be supplied to the shared adapter; a generic carried resolution is not promoted into that evidence.

### Privacy, records and terminology

Privacy assessment exposes confirmed and possible laws separately. Policy drafts and setup tasks use the same scoped source data in client and portable server code, preserve authored drafts and avoid duplicate setup records. Access-day bases and incident retention differences are represented in the profiles. Proposals and uncommenced law remain excluded from operative rules.

Minute-book and inspection screens expose the entity's record categories, retention conditions, access rights and exceptions. Employment/remuneration guidance separates financial-statement disclosure from employment and tax retention. Workspace permission checks remain a separate layer from a legal inspection right; possessing one does not confer the other.

## Review fixes

The PR review produced these corrections, each covered by the legal checks:

- **Annual deadlines start after recorded evidence.** Assessment begins at the cycle after the latest evidenced AGM, written completion or filing, or at the current cycle when there is none, instead of walking forward from incorporation. Older cycles without evidence are listed as "history not verified" (informational). An unreviewed boundary passed by more than 7 days is overdue. See [statutory calendar review](extending-legal-profiles.md#statutory-calendar-review).
- **Calendar reviews and written annual business can be recorded.** New tenant-scoped, audited mutations (`recordAnnualDeadlineCalendarReview`, `recordWrittenAnnualBusinessCompletion`, `updateAnnualEvidenceSettings`) have forms on Compliance settings. An Ontario return needs its taxation-year end to be marked filed. Generated deadlines store a `compliance:<obligation>:<cycle>` source key, and a cloned workspace drops the source's annual evidence.
- **Written resolutions.** The directors' electorate draws on both the directors table and director role holders. A 72-hour circulation-recording window and record dates on the organization's local calendar replace the UTC-date rule. Profiles carry `recordDates` limits, statutory or conservative (see [MTG-5](meetings-records.md#mtg-5)). OBCA s. 95(2) is enforced in both directions for a fixed meeting record date (30 to 60 days before). The Societies Act s. 1 (c) votes-cast route is decided by a separate `writtenResolutions:certifyVoteCount` step. Directors can record a reviewed lesser threshold where the Act allows it (Societies Act s. 54(2)(b), BC BCA s. 140(3)). The BC company special majority must be confirmed against the articles. The OBCA non-signer notice due date is bounded; its five-weekday holiday allowance is a product choice. Preview counts use singular and plural units.
- **Meeting notices and campaigns.** Meeting-notice registers are filtered by the caller's register permissions again, and the `meeting_notice` audience (shareholders, directors and auditor) is separate from `voting_shareholders` (holders with votes).
- **Guide packs.** Verified commencement dates are restored so past meetings keep their guidance; rules new in this PR carry a "commencement not verified" caveat.
- **Privacy.** BC PIPA is presumed for BC-home workspaces until facts displace it, and the dashboard warning asks for those facts. See [TRM-7](privacy.md#trm-7).
- **CI.** A browser job runs the entity browser suites and the polish check. The legal checks run a second time with the clock just after midnight UTC (`npm run test:legal:after-utc-midnight`).

## Corporate records

The share ledger, share-class rights, redemptions, dividends, BC transparency register, director eligibility, operative articles, resolution packets, minute-book reports and the YCN Access importer are described in the [corporate records guide](../corporate-records.md). That work verified its new BC sources against the consolidation current to 2026-10-06. It corrected the transparency register reference (Part 4.1, 30-day updates), fully paid before issue (s. 64(2)), redemption (ss. 77–79, 82), electronic participation (s. 174) and director removal (s. 128; directors have no removal power).

## Boundaries that remain explicit

The other-entity research covers nonprofit statutes, cooperatives, Québec, Alberta, Saskatchewan and other distinctions requested in the brief. Those answers establish extension boundaries; they do not enable unreviewed automatic profiles. Regulated companies, subtype obligations, historical transactions, specific articles/bylaws/USAs, court orders, disputed qualifications and actual filing acceptance need their own facts and authority.

Ontario's direct full-page e-Laws retrieval failed during research; current official indexed provisions and amendment annotations were checked, and the limitation is recorded. Alberta's Act was checked against the King's Printer consolidation current as of 2025-09-01; its regulation's consolidation date remains unverified. The Saskatchewan research identifies conflicts between older guidance and current statutory/regulatory text. Source review date, displayed consolidation currency and legal commencement are distinct metadata.

No automatic production migration rewrites historical consents, privacy assessments, share ownership or completed filing claims. Existing evidence stays available for review. The new fields are additive. Hosting deployment and organizational legal approval are separate from completing this implementation and research branch.

## Reproduce the checks

```sh
npm ci
npm run research:coverage
npm run test:legal
npm run test:portable-manifest
npm run build
```

`test:legal` invokes the 57 focused legal checks with `node --import tsx`, including real Convex-schema and portable-runtime evidence tests. It does not require the `tsx` command's IPC server. The dedicated pull-request workflow runs the legal gates, manifest check and production build. The Stage 2 tenancy gate's generated function inventory (`scripts/stage2/function-inventory.json`) holds 2152 entries. Source currency still needs human review when legislation changes; a passing test suite does not update the law by itself.
