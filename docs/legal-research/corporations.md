# Corporate law research: BC BCA, federal CBCA and Ontario OBCA

**Reviewed/retrieved: 2026-10-11.** This answers every corporate question in the supplied brief: BCC-1–BCC-17, FED-1–FED-16 and ONT-1–ONT-12. The operative descriptions below are faithful paraphrases, not reproduced statutory passages. “Settled core” means the cited general rule was verified; it does not establish the corporation's status, articles, ownership, filings, consents or transaction facts.

The implementation is deliberately separated into official-source records (`shared/corporateLegalSources.ts`) and extensible entity profiles (`shared/corporateLegalProfiles.ts`). A profile's default numbers must never override a more specific provision, valid article/bylaw/USA provision, share-class right, court/registrar order or regulated subtype. A document upload is evidence to review, not proof of legal compliance.

## Source currency and authority

| Short reference | Official instrument/source | Actual currency shown | Method and qualification |
| --- | --- | --- | --- |
| BC BCA | [Business Corporations Act, S.B.C. 2002, c. 57](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00_multi) | 2026-10-06 | Official full consolidation retrieved; linked section anchors provide the exact provisions. |
| BC Regulation | [Business Corporations Regulation, B.C. Reg. 65/2004](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/65_2004) | 2026-10-06; last amended 2026-01-12 | The 2026 transparency exclusions must not be omitted. |
| CCC Regulation | [Community Contribution Company Regulation, B.C. Reg. 63/2013](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/63_2013) | 2026-09-29 | This page displayed an earlier currency date than the other BC instruments. |
| CBCA | [Canada Business Corporations Act, R.S.C. 1985, c. C-44](https://laws-lois.justice.gc.ca/eng/acts/C-44/FullText.html) | 2026-09-21; last amended 2026-03-26 | Official Justice Laws consolidation. Residency remains in the operative text. |
| CBCA Regulations | [Canada Business Corporations Regulations, 2001, SOR/2001-512](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2001-512/FullText.html) | 2026-09-21; last amended 2023-05-04 | Official Justice Laws consolidation. |
| OBCA | [Business Corporations Act, R.S.O. 1990, c. B.16](https://www.ontario.ca/laws/statute/90b16) | Consolidation period begins 2025-10-01; e-Laws currency 2026-10-07 | Current official e-Laws indexed passages, amendment annotations and official enactments were checked. Direct full-page retrieval returned an access error. The global [e-Laws currency](https://www.ontario.ca/laws) is recorded separately from the period's starting date. |
| Ontario CIA | [Corporations Information Act, R.S.O. 1990, c. C.39](https://www.ontario.ca/laws/statute/90c39) | Period begins 2025-11-27; e-Laws currency 2026-10-07 | Includes the express future-commencement annotation for the new ISC filing provision. |
| Ontario CIA Regulation | [General, O. Reg. 400/21](https://www.ontario.ca/laws/regulation/210400) | Period begins 2021-10-19; e-Laws currency 2026-10-07 | This is the current regulation. R.R.O. 1990, Reg. 182 is obsolete. |
| Ontario EPCA | [Extra-Provincial Corporations Act, R.S.O. 1990, c. E.27](https://www.ontario.ca/laws/statute/90e27) | e-Laws currency 2026-10-07 | Statutory licensing and information-return obligations are distinct. |
| Registry guidance/forms | Official BC Registries, Corporations Canada and Ontario Business Registry pages identified below | Consolidation date not applicable/not exposed | Operational guidance is labelled as such. Retrieval on 2026-10-11 is not a claim that an instrument is consolidated through that date. |

### Corrections to assumptions in the brief

- The CBCA resident-Canadian director rule **has not been generally removed**. The current s. 105(3) still imposes the 25%/at-least-one rule. Ontario's 2021 repeal is different legislation.
- BC ordinary written shareholder approval is normally **at least two-thirds of all entitled votes**, following the statutory special majority, after circulation to all eligible holders. It is neither an ordinary meeting's simple majority nor necessarily unanimous.
- Ontario non-offering ordinary written resolutions may use a **majority of all entitled voting shares**, subject to higher governing-document thresholds and a **ten-business-day** notice to non-signers. Written special resolutions and auditor waivers retain their separate all-holder rules.
- BC shareholder notice is normally **21 days to two calendar months**, with private articles permitted to specify at least ten days. Two calendar months is not always 60 days.
- Federal director consent is in **s. 106(9)**, not s. 106(2). BC consent has no general ten-day written deadline and includes other statutory routes.
- Ontario's new CIA ISC filing provision is enacted but **not yet in force in the consolidation reviewed**. The federal 2024 public-filing workflow must not be copied into Ontario.

## British Columbia companies

<a id="bcc-1"></a>

### BCC-1 — Director minimum, residency and status

**Authority (law):** BC BCA ss. 120, 124; CCC exception s. 51.93. Source IDs: `BC-BCA-DIRECTORS-MIN`, `BC-BCA-CCC`.

An ordinary company needs at least one director; a public company needs at least three. The general BCA has no BC-resident or Canadian-resident quota. A community contribution company needs at least three even if privately held. Articles may require a larger board. Eligibility under s. 124 is separate: directors must be individuals of sufficient age and satisfy incapacity, bankruptcy and relevant conviction requirements and exceptions.

**Implementation and confidence:** Settled core. Store public/CCC status and article requirements as evidence-backed facts. A BC mailing address is neither required evidence of residency for a quota nor a substitute for director eligibility. Regulated institutions require their additional law.

<a id="bcc-2"></a>

### BCC-2 — Consent to act and retention

**Authority (law):** BC BCA ss. 121–123, 42(1)(f), 44(1). Source ID: `BC-BCA-DIRECTOR-CONSENT`.

Written consent may precede or follow designation/election/appointment. Knowingly acting as a director is also a statutory consent route. Presence at the election meeting without refusal and specified first-director/incorporator cases must be considered. Later consent can relate back under s. 123(2). Consent continues subject to the cessation/revocation events in s. 123(3). There is no blanket rule that every BC consent must be signed within ten days.

Keep each written consent actually received and deposit it promptly at the records office. Retain the appointment, election, attendance/non-refusal or acting evidence associated with the route used. Electronic storage is permitted under the corporate records rules; do not assume an unchecked identity or electronic-signature process proves execution.

**Implementation and confidence:** Settled law; individual appointment validity may require review. Record consent route, appointment date, signed date and evidence reference. Missing written evidence should request review rather than declare an appointment void where another route may apply.

<a id="bcc-3"></a>

### BCC-3 — Complete corporate-record checklist, form and retention

**Authority (law):** BC BCA ss. 42–44, 196, 351(2); BC Regulation ss. 11, 20, 25. Source IDs: `BC-BCA-RECORDS`, `BC-BCA-RECORD-REGULATION`.

Section 42(1) requires these categories, where the underlying event/record exists:

1. Recognition/incorporation, conversion, amalgamation or continuation certificates; name-change and restoration certificates.
2. Entered court and registrar orders; specified Securities Commission orders; prescribed amalgamation/dissolution affidavits; applicable financial-institution regulatory orders.
3. The central securities register, or the statutory notice identifying its authorized alternative location; the directors register.
4. Received director consents, written resignations, and investigation reports delivered under s. 253(1).
5. Shareholder meeting minutes; each written consent resolution and s. 327(1) consent; every counterpart. Preserve full resolution texts and applicable current-director/senior-officer disclosures separately if absent from the minutes/resolution.
6. Board/committee minutes, including a directors-present list if not in the minutes; each written resolution and counterpart. Preserve full resolution texts, applicable interest disclosures and s. 195(7)(a) financial-assistance disclosures separately if necessary.
7. Written director dissents under s. 154(5)/(8).
8. Audited statements of the company and subsidiaries and related audit reports; the most recent financial-year statements described in s. 185(1) if not otherwise retained.
9. Departing-auditor representations under s. 209(5) and the company's responses under s. 209(6).
10. Community contribution reports or benefit reports for those subtypes, and the specified corresponding records of each amalgamating predecessor.

Section 42(2) adds operative and prior/replaced articles, attached amendment records, applicable adopted Table 1/Table A text or the permitted availability record, the signed incorporation agreement, required pre-continuation/foreign-amalgamation records, and legacy memorandum/articles/registers and other former Company Act records. Section 42(3) permits specified legacy registers to be replaced where the complete information appears in the central securities register. Section 42(1)(b) is repealed: the notice of articles remains a necessary governing/registry record, including for the s. 48(2) free-copy right, but must not be falsely attributed to that paragraph.

Paper, electronic and other prescribed formats are allowed. Section 43 allows eligible records older than seven years to be relocated with production within 48 hours excluding Saturdays/holidays; it does **not** authorize destruction at seven years. Accessible electronic offsite storage has separate conditions. Section 44 requires prompt deposit, specified receipt annotations and protection against loss/falsification. Accounting records have a seven-year corporate-law period. Dissolved-company records have a minimum two-year prescribed period, subject to other applicable laws/holds.

**Implementation and confidence:** Settled checklist and basic retention. Use event-conditional categories, full-text/counterpart checks and distinct access/retention classes. Do not flag a nonexistent court order or auditor representation as a missing document. Tax retention is not a replacement for corporate-record duties.

<a id="bcc-4"></a>

### BCC-4 — Transparency register

**Authority (law):** BC BCA ss. 119.1–119.8, 426(4.1), 427.1, 428(2.1); BC Regulation ss. 47–52. Source IDs: `BC-BCA-TRANSPARENCY`, `BC-BCA-TRANSPARENCY-ACCESS`, `BC-BCA-TRANSPARENCY-EXEMPTIONS`.

An in-scope private company keeps an internal transparency register. Significant-individual tests include at least 25% of issued shares by number, at least 25% of general-meeting voting rights, and majority-director appointment/removal control; indirect, joint and associated holdings/control require the prescribed analysis. The share-number test must not be replaced with the federal fair-market-value test.

Record name, date of birth, latest address, Canadian citizenship/permanent-resident status or other citizenship particulars, Canadian tax-residence status, became/ceased dates, and the nature of significant control. If none are identified or inquiries fail, record the appropriate finding, available information and inquiry steps. Keep court-directed corrections. Review during the two-month period following the incorporation anniversary; update new information within 30 days after awareness. Send the individual the required notice within ten days of an entry saying they became or ceased to be significant.

The private-company definition and Regulation s. 47 exclude specified public issuers/equivalents/listed companies, qualifying wholly owned subsidiaries, certain insurance/trust companies, government/municipal entities and schools, and the **2026** wholly Indigenous-nation-owned and wholly professional-LLP-owned categories. Establish the exact ownership/status before applying an exemption.

Keep the register at the records office or electronically available there. Statutory access belongs to directors and specified authorized officials, not ordinary shareholders or the general public. Personal information is disposed of within one year after the sixth anniversary of the entry indicating cessation. Relevant offences carry maximum fines up to $100,000 for a corporation and $50,000 for an individual; elements and defences matter.

**Implementation and confidence:** Settled internal-register framework; control chains, exclusions and access requests need fact-specific review. Keep deadline events distinct: annual inquiry, 30-day entry, ten-day individual notice, and prescribed disposal. Do not publish the complete register in a generic minute-book/shareholder export.

<a id="bcc-5"></a>

### BCC-5 — Central securities register

**Authority (law):** BC BCA ss. 111–112, 42(1)(d). Source ID: `BC-BCA-SECURITIES-REGISTER`.

The register records issued/transferred shares, holder names and addresses, classes/series, share numbers, dates and transaction particulars. Branch-register entries must be reflected promptly in the central register. The directors can designate another location, including the Act's permitted outside-BC arrangements, while maintaining statutory BC inspection and a records-office location notice. The register cannot simply be closed to prevent access.

**Implementation and confidence:** Settled core. Maintain a transaction history, including issue/transfer evidence and current balances; one “shareholders” contact list is insufficient. The general statutory obligation is prompt recording, not an invented universal 15-day transaction-entry limit. Complex beneficial ownership is a separate transparency analysis.

<a id="bcc-6"></a>

### BCC-6 — Annual report, information and non-filing

**Authority (law):** BC BCA ss. 51, 422. **Registry practice:** [BC company annual-report overview](https://www.corporateonline.gov.bc.ca/WebHelp/overview_annbc.htm). Source ID: `BC-BCA-ANNUAL-REPORT`.

File within two calendar months after each anniversary of recognition, with particulars current as of that anniversary. Recognition may be incorporation, amalgamation or continuance. The registry's annual-report form/service collects the appropriate corporate, office, director and annual-reference/meeting particulars and authorized filing information. Update associated changes through the required transactions; do not infer a receipt from a generated form. A return is required independently of AGM or financial/audit waivers.

Failure for two consecutive years permits the s. 422 dissolution process. It includes a default letter and initial remedy period, publication and a further period, registrar discretion/extensions and finally the registrar's dissolution entry. It is not automatic dissolution exactly two years after a missed due date.

**Implementation and confidence:** Settled deadline; fields and submission workflow are registry practice and may evolve. Track each anniversary cycle and accepted filing separately. An unfiled or overdue cycle remains visible instead of rolling automatically to the next anniversary.

<a id="bcc-7"></a>

### BCC-7 — AGM and written alternatives

**Authority (law):** BC BCA s. 182, including subsections (2)–(5). Source ID: `BC-BCA-AGM`.

The first AGM must occur no later than 18 months after recognition. After the first annual reference date, the company must satisfy **both** a meeting in every calendar year and a maximum interval of 15 months from the preceding year's annual reference date. All AGM voting shareholders may unanimously defer within the permitted timing, consent to all required annual business, or waive the relevant meeting. The resolution must select a legally appropriate annual reference date where s. 182(3) requires it. The registrar can grant an extension under s. 182(4).

**Implementation and confidence:** Settled core, but a bare “AGM waived” checkbox is insufficient. Preserve resolution text, electorate, signatures, selected reference date, covered year and any registrar conditions. A planned meeting is not held evidence; an ordinary written resolution does not automatically dispose of every annual matter or waive the AGM. Statutory reporting and financial duties remain separate.

<a id="bcc-8"></a>

### BCC-8 — Meeting notice

**Authority (law):** BC BCA ss. 169–170, 219(1); BC Regulation s. 3. Source IDs: `BC-BCA-MEETING-NOTICE`, `BC-BCA-NOTICE-REGULATION`.

Default shareholder notice is at least 21 days and not more than **two calendar months** before the meeting. A non-public company's articles can set a minimum of at least ten days; absent such a provision, 21 applies. A public company uses at least 21 days or the longer articles period. Notice goes to entitled shareholders, directors and the auditor; electronic-meeting access information and the business/resolution particulars must be sufficient. Individual waiver/reduction and attendance-without-objection rules are separate.

**Implementation and confidence:** Settled. Store dispatch/service evidence, entitled recipients, meeting date, public status, articles override and any individual waiver. Compute the upper bound with calendar months, not a fixed 60-day subtraction. Do not treat failure to object in advance as automatic waiver.

<a id="bcc-9"></a>

### BCC-9 — Shareholder and board quorum

**Authority (law):** BC BCA ss. 172, 140; applicable Table 1 articles only if adopted. Source ID: `BC-BCA-QUORUM`.

Subject to the articles, shareholder quorum is two shareholders entitled to vote present personally or by proxy; if the corporation has fewer eligible shareholders than the applicable quorum, all suffice. A sole holder can therefore form quorum. Operative articles can differ. Table 1's shareholder provision includes a share-percentage condition and is not interchangeable with the bare statutory default.

Board quorum comes from the Act and the operative articles/directors' authorized determination. Table 1's majority default applies only when that table governs; the BCA does not impose an identical majority quorum on every company's board. Sole-director and conflict provisions can affect the result.

**Implementation and confidence:** Settled default; actual quorum requires governing-document, class, attendance, proxy and conflict facts. Separate shareholder headcount from voting-share thresholds and the board's eligible-director count.

<a id="bcc-10"></a>

### BCC-10 — Ordinary, special and director written resolutions

**Authority (law):** BC BCA s. 1 definitions, s. 140(3), s. 42(1)(j)/(m). Source ID: `BC-BCA-RESOLUTIONS`.

An ordinary meeting resolution uses a simple majority of votes cast. An ordinary written resolution must be submitted to every holder entitled to vote at general meetings and approved by holders of at least the applicable **special majority of all entitled votes**. The default is two-thirds. A special written resolution is signed by all eligible general-voting shareholders. Class-specific or transaction-specific rights may require additional consent.

The default board/committee written route requires all directors entitled to vote on the resolution. Section 140(3) also permits another consent manner authorized by the Act or articles. Preserve every signed counterpart in the corporate records and distinguish eligible voters from conflicted directors.

**Implementation and confidence:** Settled core. A fractional threshold is applied to the correct total entitled vote base, not the number who responded. Ordinary written majority logic from Ontario must not be reused for BC.

<a id="bcc-11"></a>

### BCC-11 — Special majorities and actions requiring them

**Authority (law):** BC BCA s. 1, ss. 137, 257, 259 and the relevant transaction sections. Source IDs: `BC-BCA-RESOLUTIONS`, `BC-BCA-ALTERATIONS`.

The ordinary special majority is at least two-thirds of meeting votes cast. Articles can specify a higher percentage up to three-quarters; specified pre-existing companies use a three-quarter legacy rule unless validly altered. A special written resolution needs all eligible holders. The meeting notice must properly identify the intended special resolution.

Special resolutions are required where the transaction provision says so, including specified director-power transfers under s. 137 and the default articles/notice alterations under ss. 257/259 where neither the Act nor articles supplies a different applicable resolution. Fundamental transactions have their own approvals, separate class rights, dissent and filing requirements; “special resolution passed” alone is not a complete transaction authorization.

**Implementation and confidence:** Settled threshold hierarchy; a comprehensive transaction wizard needs transaction-specific overlays. Capture legacy/public status, operative special-majority provision and class rights before offering a conclusive pass/fail result.

<a id="bcc-12"></a>

### BCC-12 — Articles and notice-of-articles alterations

**Authority (law):** BC BCA ss. 257, 259, 263–265 and applicable filing/effective-time provisions. Source ID: `BC-BCA-ALTERATIONS`.

First use the resolution specified by the Act; otherwise use the applicable articles requirement; absent both, use a special resolution. Changing the special majority itself requires a special resolution. Article changes that affect notice-of-articles information or special rights/restrictions require the relevant deposited resolution and notice alteration filing and take effect at the applicable registry time. Other article changes generally take effect on deposit of the alteration resolution in the records office, subject to an allowed later effective date.

Names, class rights, restricted/unalterable provisions, special rights and future-effective dates introduce additional steps. Preserve the full approval, amended text, deposited record and receipt/certificate as applicable.

**Implementation and confidence:** Settled sequence; bespoke amendment review required. “Approved,” “deposited,” “filed” and “effective” are different states. The UI must not label an unfiled notice alteration effective because a vote passed.

<a id="bcc-13"></a>

### BCC-13 — Director-change filing

**Authority (law):** BC BCA s. 127. Source ID: `BC-BCA-DIRECTOR-CHANGES`.

File the prescribed notice within 15 days of a change in directors or their prescribed addresses. Filing changes the notice of articles. The appointment/removal/resignation itself must be supported by the actual corporate action and its effective date; a registry entry is not a substitute for it.

**Implementation and confidence:** Settled. Track effective change, statutory due date, filing date and acceptance, including late submissions. Do not wait until the annual report to report a director change.

**Who acts (law):** BC BCA s. 128, ss. 122(2)–(3), 130–131. Source ID: `BC-BCA-DIRECTOR-REMOVAL`. A resignation takes effect when the written resignation is provided (or at the later time it states), so the directors only record it. Removal before the end of the term is a shareholder decision: a special resolution, or the lesser resolution or other method the memorandum or articles provide; class directors are removed by their class. The directors have no statutory removal power. They may fill a casual vacancy and, only if the articles allow, appoint additional directors up to one-third of the other current directors. The document packets follow this split: `director-resignation` (directors record the letter), `director-removal` (voting shareholders), `appoint-director` (voting shareholders elect) and `appoint-director-by-directors` (casual vacancy or additional director). Federal and Ontario packets use the shareholders' ordinary resolution (CBCA s. 109(1); OBCA s. 122(1)).

<a id="bcc-14"></a>

### BCC-14 — Conflicts

**Authority (law):** BC BCA ss. 147–153, 42(1)(k)/(n). Source ID: `BC-BCA-CONFLICTS`.

The material-contract/transaction regime depends on the director/senior officer's material interest and knowledge; specified wholly owned group, remuneration, indemnity/guarantee and other exceptions must be checked. Required disclosure must be in the minutes, consent resolution or another retained written record. A general written disclosure can operate within s. 148(4). Conflicting offices/property/duties under s. 153 require prompt disclosure as well.

Interested directors generally cannot vote on approval; the all-interested and other express exceptions matter. Unless the articles say otherwise, the Act can permit an interested director to count toward quorum. Unlike Ontario, the BC provision does not impose a universal duty to leave every discussion. Shareholders have a targeted right to inspect the interest-disclosure portions under s. 148(5). Approval, disclosure and fairness/accountability must be considered together.

**Implementation and confidence:** Settled procedural framework; materiality, permitted exceptions and transaction validity require facts. Preserve disclosure, abstention, quorum and approval evidence without treating a disclosure checkbox as a complete liability release.

<a id="bcc-15"></a>

### BCC-15 — Inspection and copies

**Authority (law):** BC BCA ss. 43, 46–48, 119.61, 196; BC Regulation ss. 12–14. Source IDs: `BC-BCA-RECORD-ACCESS`, `BC-BCA-RECORD-REGULATION`.

Current directors inspect the broad corporate layer free; former directors have period-specific rights. Shareholders and qualifying debenture holders generally inspect the shareholder-level s. 42 records free, with former-holder limits. Board/committee minutes, director written resolutions, board disclosures and dissents are not a blanket shareholder inspection entitlement, subject to specific rights such as conflict disclosures and any permitted articles expansion. Accounting access is governed separately by s. 196.

Public companies, CCCs and specified regulated/legacy categories have wider public access; benefit reports have a specific public right. Ordinary private-company public access is narrower. A permitted fee cannot exceed $10 per day; permitted copies are capped at $0.50 per page and provided promptly. Authorized restricted hours must still include at least two consecutive statutory-business hours; archived records have the s. 43 production period. A shareholder can obtain a free current articles/notice copy. The transparency register is separate and restricted.

**Implementation and confidence:** Settled layers; identify requester, current/former status, record category, relevant period, company subtype and any article entitlement before disclosing. Do not expose all uploads to all shareholders or apply a universal fee.

<a id="bcc-16"></a>

### BCC-16 — Auditor waiver

**Authority (law):** BC BCA ss. 203(1)–(3), 204(5), 200. Source ID: `BC-BCA-AUDITOR-WAIVER`.

The default is an auditor. All shareholders, including holders without ordinary voting rights, can waive appointment by unanimous resolution for **one financial year**. It may be given before, on or after the appointment would be due. Keep the written unanimous resolution and identify the covered financial year. Court appointment under s. 204(5) remains possible.

Section 203 does not itself restrict the waiver to private companies, but a public/regulated entity's independent securities or other audit requirement remains. A financial-statement production/publication waiver under s. 200 is a different all-shareholder resolution and must be separately established.

**Implementation and confidence:** Settled statutory waiver; check all share classes and external audit obligations. A recurring “waive auditor” preference is not annual consent, and a meeting majority cannot replace unanimity.

<a id="bcc-17"></a>

### BCC-17 — Benefit companies, CCCs and ULCs

**Authority (law):** BC BCA Parts 2.1, 2.2 and 2.3, especially ss. 51.11, 51.21, 51.3–51.4, 51.93–51.96, 51.992–51.994; CCC Regulation ss. 4–5, 8–9. Source IDs: `BC-BCA-BENEFIT-COMPANY`, `BC-BCA-CCC`, `BC-BCA-CCC-REGULATION`, `BC-BCA-ULC`.

**Benefit company:** The notice/articles include the required status, public-benefit and responsible/sustainable-business commitments. Directors have statutory balancing obligations. An annual third-party-standard assessment and benefit report is due by the annual reference date, approved by the board, signed and retained, with website/public-access duties. Benefit status alone does not impose the CCC dividend cap.

**CCC:** At least three directors; special asset-transfer and director-power restrictions; no general financial-statement waiver. The dividend regime generally permits 40% of profit plus qualifying unused carry-forward, with the Regulation's exception for shares held only by qualified entities. At least 60% of residual distributable assets on dissolution goes to qualified entities. The annual public report has financial, community-purpose, transfer and remuneration particulars. Remuneration of $75,000 or more is reportable; if over ten persons qualify, the highest ten are reported. Specific transfer reporting thresholds and prescribed content also apply.

**ULC:** Mandatory status/name disclosure and specialized shareholder liability on liquidation/dissolution, including former-shareholder rules and special conversion consequences. Its documentation must not promise ordinary limited shareholder liability. Conversion, capitalization, article/share-document warnings and transactions require the applicable detailed provisions.

**Implementation and confidence:** Settled subtype distinctions. Allow accurate subtype identification and subtype records/checklists; mark distribution calculations, conversions and complex restructurings review-required until a dedicated verified overlay covers the transaction.

## Federal CBCA corporations

<a id="fed-1"></a>

### FED-1 — Minimum directors and Canadian residency

**Authority (law):** CBCA ss. 102(2), 105(3)–(4), 114(3)–(4), 115(1); resident-Canadian definition in s. 2(1) and applicable Regulations. Source ID: `CBCA-DIRECTORS-MIN`.

An ordinary corporation needs one director. A distributing corporation with outstanding securities held by more than one person needs at least three and at least two who are not officers/employees of it or its affiliates. The current Act retains the **25% resident-Canadian requirement**, with at least one where the board has fewer than four. Regulated sectors can require a majority under s. 105(3.1); s. 105 contains limited sector/holding-company exceptions, not a blanket repeal.

**Currency note:** s. 105(3) is in force in the Justice Laws consolidation current to 2026-09-21. Re-verify it at each consolidation update before relying on the 25% rule. The s. 105(3.1) majority rule for prescribed sectors is a caveat for the entity's facts, not the general default.

Board business also requires the s. 114 resident-Canadian attendance or qualifying absent-director approval conditions. A managing director under s. 115(1) must be a resident Canadian. Residency is a defined legal status, not simply a Canadian postal address.

**Implementation and confidence:** Settled, high-impact correction to the brief. For a generic CBCA board use the ceiling of 25% with the at-least-one rule; require review of distributing/regulated status and any claimed exception. Do not import Ontario's repeal.

<a id="fed-2"></a>

### FED-2 — Consent

**Authority (law):** CBCA s. 106(9), and electronic-record provisions ss. 252.3–252.7 as applicable. Source ID: `CBCA-DIRECTOR-CONSENT`.

The relevant provision is s. 106(9), not s. 106(2), which concerns the first directors' term. Presence at the election/appointment meeting without refusal suffices; if absent, consent in writing before or within ten days, or acting as a director pursuant to the appointment, can qualify. Preserve the actual statutory route and its evidence. The CBCA record list does not repeat BC's standalone rule listing every written consent received, but the relevant statutory notices and proceedings must be retained and signed-consent evidence is prudent.

**Implementation and confidence:** Settled core; validity on unusual facts needs review. Do not declare all absent unsigned directors invalid without considering acting evidence, and do not call an unsigned draft “consent.”

<a id="fed-3"></a>

### FED-3 — Minute book, location, electronic records and retention

**Authority (law):** CBCA ss. 20–22, 50. Source IDs: `CBCA-RECORDS`, `CBCA-RECORD-ACCESS`.

The s. 20(1) layer contains articles/bylaws and amendments, unanimous shareholder agreements, shareholder meeting minutes/resolutions, statutory notices under ss. 106/113, and the securities register. Section 20(2) adds accounting and board/committee proceedings. The ISC register is additional under s. 21.1.

Core records are maintained at the registered office or another directors-designated place in Canada. Board/accounting records have their own location/access provisions. Foreign storage is possible only with statutory Canadian accessibility and technical-assistance conditions, subject to tax laws; foreign accounting also has the required sufficiently detailed Canadian records. Electronic records must be intelligibly reproducible within a reasonable time and protected against loss/falsification.

Accounting records have a six-year period after the financial year to which they relate, subject to longer applicable law. No such six-year blanket destruction rule applies to the full minute book, articles, shareholder history or resolutions.

**Implementation and confidence:** Settled structure; cloud-hosting/replication arrangements require actual access and location evidence. Separate records by access and retention type, not by one generic “company document” permission.

<a id="fed-4"></a>

### FED-4 — ISC register and post-2024 filing/public access

**Authority (law):** CBCA ss. 2.1, 21.1, 21.21, 21.303–21.31. **Registry practice:** [ISC filing instructions](https://ised-isde.canada.ca/site/corporations-canada/en/individuals-significant-control/individuals-significant-control-file-your-information). Source IDs: `CBCA-ISC`, `CBCA-ISC-FILING`, `CBCA-ISC-REGISTRY`.

Control tests include at least 25% of voting rights or fair market value, direct/indirect control and prescribed joint arrangements/control in fact. The register records name, birth date, residential and optional service addresses, citizenship, tax-residence jurisdictions, became/ceased dates, control description and diligence steps. Assess statutory/prescribed public and other exclusions. Review at least once each financial year and on required additional triggers; enter newly known information within **15 days of awareness**.

The statutory filing regime sends information annually and after organizational events as fixed by the Director, and within **15 days after a change is recorded**. Those are separate clocks. Registry instructions implement filing at incorporation, within 30 days after amalgamation/continuance, with the annual return and within 15 days after an entry changes. Excluded corporations still confirm the exclusion through the registry process.

Public information is limited to specified name, control, became/ceased dates and address fields; service address avoids publishing a residential address in that field. Birth date, citizenship and tax residence are not ordinary public fields, and underage/safety exceptions apply. Old s. 21.3 shareholder/creditor inspection is repealed; access to the full register is a distinct authorized-enforcement regime. Dispose of former-ISC personal information in the year after the sixth anniversary of cessation, subject to longer legal retention.

**Implementation and confidence:** Settled core. Internal register, public filing payload and receipt are distinct objects with different permissions. Failure-to-file and knowing false-information offences have separate elements; do not expose private fields or announce automatic maximum penalties.

<a id="fed-5"></a>

### FED-5 — Annual return and dissolution

**Authority (law):** CBCA ss. 263, 212(1)(a)(iii), 212(2). **Director-fixed registry policy:** [Policy on annual filings](https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/policy-annual-filings-canada-business-corporations-act), modified 2026-02-25. Source IDs: `CBCA-ANNUAL-RETURN`, `CBCA-ANNUAL-RETURN-REGISTRY`.

File within **60 days after** the incorporation/amalgamation/continuance anniversary, beginning the following year. The registry will not accept filing before the anniversary. The return contains current corporate information, last annual-meeting/written-annual-business date, distributing status and authorized knowledgeable filer details; ISC information is filed concurrently. Inactive but existing corporations still file. A tax return does not satisfy this corporate return.

Late status affects access to a certificate of compliance. The Act permits dissolution for the specified one-year default ground after the statutory process. Current policy generally begins dissolution after two unfiled annual cycles and gives an additional **120-day** final notice. Legal authority, administrative practice and actual dissolution must remain separate.

**Implementation and confidence:** Settled filing rule. Keep anniversary cycle, dispatch and acceptance evidence; an overdue filing never becomes completed because the anniversary passed again.

<a id="fed-6"></a>

### FED-6 — Annual meeting and written annual business

**Authority (law):** CBCA ss. 133, 142. Source ID: `CBCA-ANNUAL-MEETING`.

First meeting: within 18 months after existence begins. Later meetings: within 15 months of the last annual meeting **and** within six months after the preceding financial year-end. Section 133(3) allows a court extension. Section 142 permits a written resolution disposing of all required annual business signed by all shareholders entitled to vote, subject to director/auditor written-statement exceptions.

**Implementation and confidence:** Settled. Apply the distinct first-meeting rule, then both subsequent constraints. Require the actual preceding completed financial-year end and held/valid written-business date. A bare waiver or planned date does not indefinitely replace annual business or filing.

<a id="fed-7"></a>

### FED-7 — Notice

**Authority (law):** CBCA ss. 135–136; CBCA Regulations s. 44. Source IDs: `CBCA-MEETING-NOTICE`, `CBCA-NOTICE-REGULATION`.

Default notice is 21–60 days. A **non-distributing** corporation may specify a shorter minimum in articles or bylaws under s. 135(1.1); the provision does not establish a universal ten-day floor. Distributing corporations cannot use that exception. Notice goes to entitled shareholders, directors and auditor, with appropriate business and electronic participation particulars. Individual notice waiver and attendance rules are separate.

**Implementation and confidence:** Settled. Validate public status, governing documents, statutory recipient list, delivery evidence and each waiver. Do not transplant BC calendar-month maxima or Ontario's 50-day maximum.

<a id="fed-8"></a>

### FED-8 — Written shareholder/director resolutions

**Authority (law):** CBCA ss. 117, 142, 2(1). Source ID: `CBCA-RESOLUTIONS`.

Written shareholder resolutions require every shareholder entitled to vote on that particular resolution; ordinary written approval is not a private majority route. Annual written resolutions must dispose of all annual business and satisfy the exceptions concerning director/auditor statements. Written board/committee resolutions require all directors entitled to vote. Retain the resolutions in the respective minute-book layer.

**Implementation and confidence:** Settled. Determine the electorate and vote rights for the resolution, excluding only those legally ineligible and respecting class-specific/unanimity-only provisions. Electronic evidence must satisfy the applicable record/signature rules.

<a id="fed-9"></a>

### FED-9 — Special resolutions and articles amendments

**Authority (law):** CBCA ss. 2(1), 6(3), 173, 176–179 and transaction-specific provisions. Source IDs: `CBCA-RESOLUTIONS`, `CBCA-ARTICLES`.

A special meeting resolution normally needs at least two-thirds of votes cast; a written special resolution is signed by all entitled shareholders. Articles/USA can increase voting requirements where the Act permits. Articles amendments under s. 173 cover such matters as name, registered-office province, restrictions, share structure/rights and director-number provisions, with separate class/series approvals where s. 176 applies. Filed amendment articles and the resulting certificate determine effect under ss. 178–179.

**Implementation and confidence:** Settled default, but a fundamental transaction must use its exact transaction provisions, class rights and dissent process. “Two-thirds approved” is not sufficient evidence that filing, class approval or an effective date exists.

<a id="fed-10"></a>

### FED-10 — Bylaws

**Authority (law):** CBCA s. 103. Source ID: `CBCA-BYLAWS`.

Subject to articles, bylaws or USA, directors make/amend/repeal bylaws by resolution effective immediately and submit them at the next shareholder meeting for ordinary confirmation, amendment or rejection. Failure to submit or rejection ends their effect. Re-enacting substantially the same purpose cannot evade shareholder confirmation. Keep the board action, amended text and shareholder outcome.

**Implementation and confidence:** Settled. Ordinary CBCA bylaws are not routinely filed with Corporations Canada; do not copy the Canada Not-for-profit Corporations Act filing regime. Articles amendments remain separate.

<a id="fed-11"></a>

### FED-11 — Directors, addresses and registered-office changes

**Authority (law):** CBCA ss. 19, 113, 173. Source ID: `CBCA-DIRECTOR-CHANGES`.

The corporation files a director change within 15 days. A director notifies their corporation of an address change within 15 days; the corporation's own address-change filing clock runs from receipt of that notice. Registered-office address changes are filed within 15 days. Moving the registered office to another province requires the articles-amendment approval and filing process, not an ordinary address notice.

**Implementation and confidence:** Settled. Preserve actual event/receipt dates, not one shared “updated” date. Distinguish address correction, office move, director appointment and province amendment.

<a id="fed-12"></a>

### FED-12 — Conflict disclosure and approval

**Authority (law):** CBCA s. 120. Source ID: `CBCA-CONFLICTS`.

A director/officer with a material interest in a material contract/transaction discloses in writing or requests entry in minutes. Director timing follows the first meeting considering the matter or the specified later interest/appointment trigger; officers disclose promptly under their applicable trigger. Transactions not requiring routine board approval still require disclosure. A qualifying general notice can cover recurring interests.

An interested director generally cannot vote, subject to remuneration, indemnity/insurance and affiliate exceptions. Section 120 does not impose Ontario's express general requirement to leave discussion. Shareholders have the specific disclosure-record inspection right in s. 120(6.1). Approval, disclosure and fairness conditions affect validity and accountability; court remedies remain possible.

**Implementation and confidence:** Settled process, case-specific materiality/validity. Record interest, disclosure, eligible quorum/vote and any exception; do not offer an automatic liability release.

<a id="fed-13"></a>

### FED-13 — Auditor exemption

**Authority (law):** CBCA s. 163. Source ID: `CBCA-AUDITOR-WAIVER`.

Only a non-distributing corporation can use this no-auditor resolution. Every shareholder must consent, including non-voting holders. It remains effective only until the next annual meeting. Preserve the complete consent/electorate evidence and covered annual period. The financial-statement obligation is separate.

**Implementation and confidence:** Settled. Public/distributing corporations cannot use the private exception, and majority approval is insufficient. Independent contractual or regulated audit duties must still be identified.

<a id="fed-14"></a>

### FED-14 — Inspection and copies

**Authority (law):** CBCA ss. 20(4), 21, 21.31. Source ID: `CBCA-RECORD-ACCESS`.

Shareholders, creditors, their representatives and the Director receive the applicable s. 20(1) inspection/extract rights free; directors have the broader records entitlement. Distributing corporations have additional public rights subject to reasonable fees and statutory affidavit conditions for securities-register access. A shareholder is entitled to one free copy of articles, bylaws and a USA. A statutory shareholder-list request requires the affidavit/fee and permitted-purpose conditions and is delivered within ten days with the prescribed currency.

**Implementation and confidence:** Settled layers. Board minutes/accounting and the full ISC register are not automatically available because someone owns a share. Resolve requester status, record type, purpose and public status before disclosure.

<a id="fed-15"></a>

### FED-15 — Additional BC and Ontario registration

**Authority (law):** BC BCA ss. 375–376, 380–381, 386; Ontario CIA ss. 3–4 and O. Reg. 400/21; Ontario EPCA ss. 1–2, 4. **Registry guidance:** [Federal provincial-registration guidance](https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/provincial-registration-federal-business-corporations). Source IDs: `BC-BCA-EXTRAPROVINCIAL`, `ON-CIA-RETURNS-CHANGES`, `ON-EXTRAPROVINCIAL-FEDERAL`.

**BC:** Register within two calendar months after beginning to carry on business. Statutory deeming indicators include local advertising/directory particulars, a resident agent, warehouse/office/place of business and otherwise carrying on business, subject to exceptions. File the registrar's registration statement with federal name, home jurisdiction, relevant incorporation/continuance/amalgamation date and number, head-office addresses and attorney particulars. Federal corporations do not reserve their federal name. A qualifying BC attorney is generally required unless the charter head office is in BC. The BC extraprovincial annual report uses the **BC registration anniversary**, with a two-month deadline; later changes have their own prompt notification rule.

**Ontario:** A federal corporation is **class 2**, not class 1, under the EPCA and requires no EPCA licence. The CIA initial return is normally due within 60 days after starting to carry on business; a required business-name registration can make it due earlier. Required information/change notices remain applicable, generally within 15 days after a change. The federal corporation is not automatically an OBCA corporation owing Ontario's OBCA annual return merely because it registered; apply the CIA Regulation's exact class/exemption rules.

**Implementation and confidence:** Settled general regimes; “carrying on business” and exemptions are fact-specific. Do not claim federal incorporation alone completes every province's registration, or treat a federal annual return as a BC extraprovincial report.

<a id="fed-16"></a>

### FED-16 — Terminology

**Authority (law):** CBCA s. 133 and Corporations Canada's annual-return instructions. Source ID: `CBCA-ANNUAL-MEETING`.

Use **annual meeting of shareholders** in formal CBCA workflow labels and documents. “AGM” is understandable shorthand but is not a reason to apply a society's members, bylaws, electorate or filing rules. Board meetings are meetings of directors; resolutions are shareholder/director resolutions as appropriate. Corporate governing documents are articles and bylaws, with a USA where applicable.

**Implementation and confidence:** Settled terminology. Keep legal profile identity independent of display labels so relabelling “AGM” does not change the underlying obligation.

## Ontario OBCA corporations

<a id="ont-1"></a>

### ONT-1 — Board count and residency repeal

**Authority (law):** OBCA ss. 115(2)–(3), 118; 2020, c. 34, Sched. 1, s. 5, effective 2021-07-05. Source ID: `OBCA-DIRECTORS-MIN`.

An ordinary non-offering corporation requires at least one director. An offering corporation requires at least three, with at least one-third outside management. Ontario's resident-Canadian quota was repealed effective **July 5, 2021**. Other individual eligibility and actual article board-size rules still apply.

**Implementation and confidence:** Settled. Do not impose a BC-address or Canadian quota on an OBCA board, and do not infer from this repeal that the CBCA was amended similarly.

<a id="ont-2"></a>

### ONT-2 — Consent and first-director forms

**Authority (law):** OBCA ss. 5(2)–(2.1), 119(9)–(12). Source ID: `OBCA-DIRECTOR-CONSENT`.

Written consent is required before or within ten days of election/appointment under the general rule; later written consent can cure the initial deficiency. An uninterrupted re-election/reappointment has a specific exception. The Director may request consent copies. Required first directors use the approved consent form and the corporation retains it at the registered office; first-director consents have specific free inspection/copy rights for directors, shareholders and creditors.

**Implementation and confidence:** Settled. Distinguish first-director approved-form requirements, later election consent, continuous re-election and later cure. Record execution dates and preserve the actual consent rather than treating a nominee's contact record as acceptance.

<a id="ont-3"></a>

### ONT-3 — Records, electronic form and retention

**Authority (law):** OBCA ss. 139–141, 144–146. Source IDs: `OBCA-RECORDS`, `OBCA-LAND-REGISTER`, `OBCA-RECORD-ACCESS`.

Maintain articles/bylaws/amendments and any USA known to directors; shareholder minutes/resolutions; the director register with required current/former particulars and dates; the securities register; the **Ontario land-ownership-interest register** and supporting title records; and the applicable ISC register. Also maintain adequate accounting and board/committee minutes/resolutions, including required pre-continuation records. Do not omit Ontario land records because the company is not a real-estate business.

Any record form is permitted with safeguards against falsification and accurate intelligible production within a reasonable time. Statutory location/electronic accessibility conditions still apply; the land register requires its Ontario arrangement. Accounting records are retained six years from the end of the last fiscal period to which they relate, after satisfying applicable tax retention. That period is not a licence to destroy articles, minutes and ownership history.

**Implementation and confidence:** Settled categories. Make land and ISC applicability explicit; keep director and shareholder access distinct. Actual storage/access arrangement and lawful destruction require verification.

<a id="ont-4"></a>

### ONT-4 — ISC register, access and uncommenced filing law

**Authority (law):** OBCA ss. 1.1, 140.2–140.3, 145, 258.1; prospective Ontario CIA s. 6.1. **Registry guidance:** [Ontario beneficial-ownership requirements](https://www.ontario.ca/page/beneficial-ownership-information-requirements). Source IDs: `OBCA-ISC`, `ON-CIA-ISC-NOT-COMMENCED`.

In-scope corporations identify significant controllers through the 25% voting/fair-market-value and direct/indirect/control-in-fact tests, including applicable joint/related arrangements. Record name, birth date, latest address, tax-residence jurisdiction, became/ceased dates, explanation of control and inquiry steps. Review at least once per financial year and enter new information within **15 days after awareness**; shareholders must respond promptly and accurately to proper inquiries. Dispose of former-individual personal information in the year after the sixth anniversary of cessation unless law/court order requires longer.

Offering/public-exchange and qualifying wholly owned subsidiary/prescribed exclusions require exact status evidence. Authorized law-enforcement/tax/regulatory bodies have the special access route; s. 145 excludes the ISC register from ordinary shareholder/creditor inspection. Corporate default and knowing individual offences have separate elements and maxima, including corporate $5,000 and individual $200,000/six-month exposure under the applicable offence provisions.

The 2025 CIA amendment would authorize ISC filing in prescribed circumstances, but the current e-Laws annotation says it awaits proclamation. It must be represented as **enacted, not in force**, not as an active public register or federal-style filing duty. The code's existing source-status vocabulary uses `proposed` for this non-operative source and includes that exact clarification.

**Implementation and confidence:** Settled current internal-register requirement; future commencement/regulations need re-verification before activation. Complex control and exemptions require review. Restrict full-register exports.

<a id="ont-5"></a>

### ONT-5 — Annual return

**Authority (law):** Ontario CIA s. 3.1; O. Reg. 400/21 ss. 3, 11. **Registry guidance:** [Ontario annual-return Director's notice](https://forms.mgcs.gov.on.ca/dataset/6c1fdc85-c100-493d-93ca-d86ef2c6a260/resource/a1e78643-e06e-403f-9aec-f26c10b26712/download/on00229e.pdf), effective 2025-02-01. Source IDs: `ON-CIA-RETURNS-CHANGES`, `ON-CIA-ANNUAL-RETURN-REGULATION`.

An OBCA annual return is due within the prescribed corporate-income-tax return period, normally **six months after the taxation year-end**. It is filed through Ontario's registry process separately from the CRA tax return; the former combined process must not be assumed. Prescribed corporate/director/officer/office information and the actual reporting year must be supplied. Current regulation is O. Reg. 400/21, not revoked Reg. 182.

The [CRA's official T2 timing instructions](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-income-tax-return/when-file-your-corporation-income-tax-return.html) preserve month ends: a February 28 month-end produces August 31, and June 30 produces December 31. A non-month-end uses the corresponding day. This convention is separate from generic anniversary-month arithmetic. The helper returns the nominal date; authority-specific holiday/office and timely-receipt rules require their own assessment rather than a universal weekend assumption.

**Implementation and confidence:** Settled normal rule; unusual taxation periods and class exemptions need review. Use the actual completed taxation-year end, not the next future recurring fiscal date, and preserve submission evidence by covered period. A prepared T2, AGM or annual return draft is not proof of Ontario filing.

<a id="ont-6"></a>

### ONT-6 — Annual meetings

**Authority (law):** OBCA ss. 94, 104, 154(1). Source ID: `OBCA-ANNUAL-MEETING`.

The first annual meeting is called within 18 months after incorporation and later meetings within 15 months of the last annual meeting. Section 94 does **not** contain the CBCA's distinct six-month-after-year-end meeting deadline. Section 154's financial-statement freshness requirement is a separate constraint on materials/business, not a copied meeting deadline.

Section 104 supports written annual-business alternatives. For non-offering ordinary business the eligible majority route can apply, but all-shareholder or special matters still require their exact consent. Director/auditor written-statement exceptions matter. An auditor waiver cannot be accomplished by an otherwise valid simple majority annual resolution.

**Implementation and confidence:** Settled distinction. Record the actual held/complete written-business date and the legal route; a planned date or partial resolution does not reset the annual-meeting clock.

<a id="ont-7"></a>

### ONT-7 — Notice

**Authority (law):** OBCA ss. 96, 98. Source ID: `OBCA-MEETING-NOTICE`.

Non-offering shareholder meetings require **10–50 days** notice; offering meetings require **21–50 days**. Entitled shareholders, directors and auditors receive the relevant notices. Special business and electronic participation details have content requirements. Waivers have their statutory conditions; ordinary articles/bylaws cannot simply replace a statutory floor with a lower number.

**Implementation and confidence:** Settled. Capture status, recipient entitlement, dispatch/service date, notice content and individual waiver evidence. Do not apply federal 60-day or BC two-month maxima.

<a id="ont-8"></a>

### ONT-8 — Written resolutions and majority notice

**Authority (law):** OBCA ss. 1(1), 104, 129. Source ID: `OBCA-RESOLUTIONS`.

Special meeting resolutions generally require two-thirds of votes cast; written special resolutions require every entitled shareholder. Written board/committee resolutions require all directors entitled to vote. A non-offering corporation may pass an ordinary written resolution under s. 104(1)(c) through holders of **more than half of all shares entitled to vote**, subject to a higher articles/USA threshold under s. 104(5).

For that majority route, the corporation must within **ten business days** give non-signing entitled shareholders notice containing the resolution text and a description of and reasons for the business dealt with. Do not count only respondents or use business-day timing as calendar-day timing. Offering corporations cannot use the private majority exception.

**Higher-threshold notice interaction — review needed:** subsection 104(3) expressly starts the notice period when signatures reach a majority of eligible shares. Subsection 104(5) expressly changes the passage requirements in paragraph (1)(c), without expressly amending the notice trigger, and refers to the specified number of shareholders. For an articles/USA threshold, preserve the first statutory-majority signature date separately from the reviewed passage date and use the earlier notice clock as a conservative operational safeguard. Do not infer that a higher passage threshold extends notice, or convert a bespoke holder/vote/share requirement into a percentage without reading the instrument. A reviewed notice due date must account for the applicable meaning of business days and holiday calendar; counting weekdays alone is insufficient. This interaction is not presented as a settled judicial interpretation.

**Implementation and confidence:** Settled. Model legal electorate, entitled share totals, higher threshold, date passed and required notices as separate checks. Unanimity-only matters such as the auditor exemption remain outside a generic majority pass result.

<a id="ont-9"></a>

### ONT-9 — Bylaw adoption and confirmation

**Authority (law):** OBCA s. 116. Source ID: `OBCA-BYLAWS`.

Subject to articles/bylaws/USA, directors can adopt, amend or repeal bylaws effective immediately and must submit them to the next shareholder meeting for confirmation/amendment/rejection. Failure to submit or rejection ends their effect, and re-enactment cannot circumvent confirmation. A shareholder-originated bylaw adopted under the statutory route has its own effective treatment. The Act does not require every such resolution to be labelled a bylaw.

**Implementation and confidence:** Settled. Track board-effective text and shareholder confirmation separately. Ordinary bylaws are internal records, not routine OBR filings; distinguish articles amendments and any professional/regulated approvals.

<a id="ont-10"></a>

### ONT-10 — Changes and information filings

**Authority (law):** Ontario CIA ss. 2–4; O. Reg. 400/21. Source ID: `ON-CIA-RETURNS-CHANGES`.

Generally file a notice of each change in information previously filed within **15 days after the change**. This includes applicable director, officer and office particulars. Statutory exceptions include uninterrupted director re-election and specified information/name and agent-service circumstances. The Ontario initial return is normally due within 60 days after incorporation/amalgamation/continuance; extraprovincial and required name-registration triggers differ.

**Implementation and confidence:** Settled general rule; specific exception must be identified, not presumed. Corporate appointment, resignation, office decision and articles amendment are substantive acts; a CIA notice merely reports the applicable change. Keep occurrence and filing evidence separately.

<a id="ont-11"></a>

### ONT-11 — Conflicts and auditor waiver

**Authority (law):** OBCA ss. 132, 148. Source IDs: `OBCA-CONFLICTS`, `OBCA-AUDITOR-WAIVER`.

**Conflict:** Disclose a material contract/transaction interest in writing or minutes at the appropriate director/officer trigger, even for applicable ordinary-course matters that do not require board approval. A director generally must **not attend the discussion and must not vote**, subject to the express remuneration-as-director, indemnity/insurance and affiliate exceptions. Under s. 132(5.1), remaining directors can be deemed quorum where conflict exclusion alone caused the absence of quorum. If all directors are required to disclose, shareholder approval is required under s. 132(5.2). The special shareholder-confirmation/fairness route in s. 132(8) is separate. Do not silently collapse every approval into an ordinary or special threshold without identifying the route.

**Auditor:** A non-offering corporation may dispense with the auditor for a financial year only with **written consent from every shareholder, including non-voting holders**. The private ordinary-majority rule is not sufficient. Keep the annual waiver and financial statements separately.

**Implementation and confidence:** Settled procedural differences; conflict materiality, fairness and exceptions require review. Record absence, abstention, disclosure, approval and electorate. Do not carry an auditor preference forward as renewed annual consent.

<a id="ont-12"></a>

### ONT-12 — Current incorporation packet and enablement

**Authority (law):** OBCA ss. 4–6, 8–9. **Official registry instructions:** [Director's incorporation notice](https://forms.mgcs.gov.on.ca/en/dataset/on00224), effective 2025-02-01; [Articles Form 5351](https://forms.mgcs.gov.on.ca/en/dataset/5351); [First Director Consent Form 5260](https://forms.mgcs.gov.on.ca/en/dataset/5260). Source IDs: `OBCA-INCORPORATION`, `OBCA-INCORPORATION-REGISTRY`.

The current packet is not safely identified by an old generic “Form 1” label. It must collect the legal corporate name/numbered-name choice; administrative contact, official email and NAICS information required by the registry; physical Ontario registered-office address; director number and particulars; incorporator individual/corporate details; business/power restrictions; share classes, rights and transfer restrictions; other provisions; requested effective date; and filing/payment information.

For a named corporation, satisfy the current Ontario-biased/weighted NUANS and naming/consent requirements, retaining the report and required evidence. An identical-name case may require a legal opinion. Obtain the required approved-form first-director consents. All incorporators sign the final articles **before** filing; the electronic/paper method must preserve the executed document and signature evidence, supporting consents and records the Director can request. A future effective date may be at most 30 days ahead under the registry instructions. The actual filing produces the certificate, endorsed articles and associated registry outputs; a drafted packet does not create the corporation.

**Enablement decision:** Enable preparation for ordinary private OBCA incorporations only where the app actually collects the required particulars, records incorporator execution and first-director evidence, and clearly distinguishes draft/prepared/submitted/certified states. Keep professional corporations, bespoke/complex share rights, identical-name opinions and other specialized approvals in review. Do not claim automated filing or incorporation unless the filing service was used and the certificate received.

## Implementation boundaries and verification priorities

The profile numbers are usable defaults for known ordinary entities. The following inputs remain necessary before a conclusive legal result: exact governing Act and subtype; recognition and financial dates; offering/distributing/public status; actual articles/bylaws/USA and class rights; director and ownership eligibility facts; held or valid written annual-business evidence; and accepted filings with their covered period.

The most important regression cases are BC ordinary written two-thirds versus Ontario private majority versus federal unanimity; retained CBCA residency; BC two-calendar-month notice/report math; BC annual calendar-year plus 15-month AGM requirements; federal first meeting versus subsequent 15-month/six-month rules; Ontario financial-statement freshness kept separate from the AGM interval; director-consent statutory alternatives; and unfiled prior-year cycles remaining overdue. Public/minor/beneficial-ownership information must be filtered by the correct statutory access layer.

Uncommenced changes are kept separately from in-force rules. A future legal update should add/replace versioned source facts and profile data, followed by targeted regression cases and a new review date; it should not scatter statute-specific guesses throughout UI components.

### Annual preparation and historical evidence

The reviewed annual preparation packet is available for the three supported corporation profiles. Ontario's exception is limited to `annual-resolutions` while that catalog entry remains a preparation-only draft; it does not enable Ontario incorporation or a specialist subtype. The catalog, shared native mutation and local client use the same scoped pathway check. Generated annual drafts enter review with no presumed shareholder signatures, bind clauses to the governing Act, and retain their resolved legal context and the source editions used at generation.

Historical unexecuted annual packet drafts are identified by their saved template provenance or stable packet marker. Reads project a review state and an explicit warning that the old clauses, shareholder electorate and retention setting require review. Updating such a draft adds a separate review annotation, preserves the original template snapshot, and prevents the preparation record from being sent for signatures or declared signed. Executed originals and their execution evidence are preserved. Historical retention values are not silently rewritten; newly generated corporate minute-book documents have no blanket seven-year expiry.

The annual settings adapter accepts separately supplied annual-business completions only with an explicit completion kind, a valid past date, affirmative verification and a nonempty evidence reference. BC written annual business additionally needs the reviewed annual reference date; a cross-calendar BC society extension needs the evidenced registrar extension and a completion within its permitted following-year period. **The app does not yet promote a generic carried resolution into completion of annual business automatically.** A carried motion, generated draft or planned meeting date is not sufficient evidence. This preserves a narrow import/integration boundary without introducing a general annual execution workflow.

Annual return evidence must identify the home return kind and a covered year or actual reporting period. Explicit branch or extra-provincial contexts, conflicting jurisdictions and unrecognized explicit jurisdictions cannot close the home annual cycle. Legacy records with no context, and known matching home jurisdiction aliases, remain usable. Native and local regression gates verify the preparation boundary, Ontario exception, historical document preservation and annual-period evidence.
