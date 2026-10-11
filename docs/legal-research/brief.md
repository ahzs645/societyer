# Societyer legal research brief: entity-aware law and citations

Oct 11, 2026 · @Ahmad Jalil

## Purpose and how to answer

Societies no longer see corporate rules, and corporations no longer see Societies Act wording. Where the right corporate rule was unknown, the app now hides the check instead of showing one. These questions ask for the law needed to put the correct checks and citations back, entity by entity.

Each question is tagged with an ID (for example BCC-3) so answers can be tracked against code changes. For every answer, please give:

- **Rule:** the requirement in one or two plain sentences.
- **Citation:** Act, section and subsection, in the form the app displays (for example "Business Corporations Act, SBC 2002, c. 57, s. 120").
- **Source:** a link to the current consolidation on the official site (BC Laws, Justice Laws, e-Laws, LégisQuébec), and the consolidation date you read.
- **Exact wording:** the operative words quoted, when the app will quote or paraphrase them.
- **Exceptions and variations:** what the articles, by-laws or a unanimous shareholder agreement can change, and any distributing / non-distributing or member-funded split.
- **Confidence:** settled, or needs a lawyer's review. Where practice differs from the statute (registry forms, filing portals), say which one the answer reflects.

**Entity types in scope**

| Entity type | Governing Act | Registry | App support today |
| --- | --- | --- | --- |
| BC society | Societies Act, SBC 2015, c. 18 | BC Registries (Societies Online) | Full rule set and citations |
| BC company | Business Corporations Act, SBC 2002, c. 57 | BC Registries (Corporate Online / BC Registries app) | Society rules hidden; few corporate checks |
| Federal corporation | Canada Business Corporations Act, RSC 1985, c. C-44 | Corporations Canada | Society rules hidden; obligations tracked; few checks |
| Ontario corporation | Business Corporations Act, RSO 1990, c. B.16 | Ontario Business Registry | Society rules hidden; guidance "under review" |
| Custom existing entity | Any (e.g. Quebec Business Corporations Act) | Varies | Neutral wording only |

Out of scope: tax filings (except where a governance rule points to them), charity registration rules, and anything requiring advice on a specific organization's facts.

## 1. Verify the BC Societies Act citations the app shows today

These claims are live for every BC society workspace. Before they are reused as the model for other entities, confirm each against the current consolidation of the Societies Act, SBC 2015, c. 18 and the Societies Regulation.

| ID | What the app says today | Question | Where it shows |
| --- | --- | --- | --- |
| SOC-1 | A society needs at least 3 directors (s. 40), with a member-funded exception (s. 197) | What are the director minimums for an ordinary vs member-funded society, and what exactly does s. 197 relax? | Dashboard compliance card, director count tooltip |
| SOC-2 | At least one director must ordinarily reside in BC (s. 40) | Is "ordinarily resident in BC" the test, and does it apply to member-funded societies? | Dashboard, BC-resident column on Directors |
| SOC-3 | Director consent must be on file (s. 42, s. 42(4) in one place) | Which subsection requires written consent, and what counts as consent (in writing, at a meeting, electronic)? How long must it be kept? | Continuity checks, director consent warning |
| SOC-4 | Directors attest each year to qualifications (s. 44(2)) | Does s. 44(2) set a qualification rule only, or any attestation or renewal duty? Is an annual attestation a best practice rather than a requirement? | Attestations page |
| SOC-5 | Governance records, including court orders, are kept under s. 20 | Confirm the s. 20 list of records a society must keep, including court orders, and the retention period for each. | Records, Court orders, minute book gaps |
| SOC-6 | Inspection fees are limited (s. 24) | What may a society charge members vs non-members to inspect or copy records, and which records can bylaws restrict? | Inspections page |
| SOC-7 | Remuneration of $75,000 or more must be disclosed (s. 36) | Confirm the threshold, who it covers (directors, employees, contractors) and where it must be disclosed (financial statements?). | Employees, Financials |
| SOC-8 | Conflicts must be disclosed and recorded (s. 56) | Confirm what s. 56 requires: disclosure, abstention, leaving the meeting, recording in minutes. | Conflicts of interest |
| SOC-9 | An AGM must be held each calendar year (s. 71); the dashboard says "by Dec 31" | Is the deadline "once in each calendar year", and what are the first-AGM and deferral (s. 71(1)-(3)?) rules? | Continuity checks, annual cycle |
| SOC-10 | The annual report is due within 30 days after the AGM (s. 73(1)(a)); with no AGM, by Jan 31 (s. 73(1)(b)) | Confirm both deadlines and what the annual report must contain. | Annual cycle, AGM workflow, year-end |
| SOC-11 | Bylaw and constitution alterations are filed (s. 17 and ss. 10-11) | When does an alteration take effect: on passing or on filing? Which special resolution threshold applies? | Bylaw amendments |
| SOC-12 | Written resolutions: ordinary needs majority written consent, special needs unanimous written consent | Under the s. 1 definitions, what written consent does an ordinary and a special resolution need? The app's "majority" default may be wrong. | Written resolutions |
| SOC-13 | General meeting notice is 14 to 60 days | Is 14-60 days in the Act, the Regulation or the model bylaws, and can bylaws change it? | AGM workflow notice window |
| SOC-14 | Model bylaws quorum (BC-SOC-MODEL-BYLAWS-QUORUM) | Confirm the model bylaws quorum for general and directors' meetings, and the current model bylaws version. | Bylaw rules baseline |
| SOC-15 | Director changes are filed with the registry (BC-SOC-DIRECTOR-CHANGE-FILING) | What is the filing deadline for a director change, and is it a Societies Online filing? | Directors drawer |
| SOC-16 | Other references: ss. 35(1), 48, 67, 77, 82 | For each, confirm the section still says what the app's surrounding text implies; flag any renumbering. | Various (to be mapped) |

## 2. BC companies (Business Corporations Act, SBC 2002, c. 57)

For a BC company the app hid the society checks for director minimums, residency, consent, governing documents and records. It shows almost nothing in their place. These answers would let it show the company's own checks. Existing app citations to re-check: ss. 10, 42, 51, 119.1, 167, 172, 182.

| ID | Question | What the app would do with it |
| --- | --- | --- |
| BCC-1 | Minimum number of directors for a private (non-reporting) company vs a public company. Is there any BC or Canadian residency requirement for directors today? | Restore a director-count check; confirm the residency column stays hidden |
| BCC-2 | Does a director's consent to act have to be in writing, by when, and kept where (records office)? | Consent-on-file check with a BCA citation |
| BCC-3 | Full list of records a company must keep at its records office (s. 42): articles, notice of articles, registers, minutes, resolutions, financial statements. Which may be kept electronically, and for how long? | Minute book gaps and records checklist for companies |
| BCC-4 | Transparency register (s. 119.1): who must keep it, what it records, when it is updated, who may inspect it, and the penalties | Transparency register check and prompts |
| BCC-5 | Central securities register: required contents and when entries must be made | Share register completeness check |
| BCC-6 | Annual report (s. 51): due date relative to the recognition anniversary, contents, and the effect of late filing (dissolution timeline) | Annual report deadline and late-filing warning |
| BCC-7 | Annual general meeting (s. 182): timing (first and later AGMs), and when shareholders can waive it or hold it by unanimous resolution | AGM timing check, "waived" option, annual cycle steps |
| BCC-8 | Notice of shareholder meetings (s. 169?): minimum and maximum notice for a non-reporting company, and whether articles can change it | Notice window in the AGM workflow (now neutral) |
| BCC-9 | Quorum for shareholder meetings when the articles are silent, and for directors' meetings | Governance rules baseline for BC companies |
| BCC-10 | Consent resolutions: what written consent an ordinary and a special resolution of shareholders need; same for directors' resolutions | Written resolutions signature defaults (now "all signers" for corporations) |
| BCC-11 | Special resolution threshold when the articles are silent (2/3 or up to 3/4), and which acts need one | Resolution kind labels |
| BCC-12 | Altering the articles and notice of articles: what needs a special resolution, what must be filed, and when it takes effect | "Articles alterations" page and filing prompts |
| BCC-13 | Director change filings (notice of change of directors): deadline after the change | Directors drawer deadline (now "check the governing Act") |
| BCC-14 | Director conflicts of interest (disclosable interests): disclosure, abstention, recording, and the section numbers | Conflicts page for companies |
| BCC-15 | Shareholder and public inspection rights over records, and permitted fees | Inspections page for companies |
| BCC-16 | Auditor: when a company can waive the appointment of an auditor (unanimous resolution), and what must be recorded | Auditors page for companies |
| BCC-17 | Benefit companies, community contribution companies and ULCs: which extra obligations differ from an ordinary company (benefit statement, dividend caps, ULC disclosure) | Whether to offer these subtypes or keep "review required" |

## 3. Federal corporations (Canada Business Corporations Act, RSC 1985, c. C-44)

The app already tracks some CBCA obligations: individuals with significant control, annual returns and post-incorporation steps. Governance checks for CBCA corporations are mostly blank. Existing app citations to re-check: ss. 2(1), 5, 19, 20, 21.1, 21.21, 25, 106(2), 113, 114(2), 121, 133, 263, 375, 380.

| ID | Question | What the app would do with it |
| --- | --- | --- |
| FED-1 | Minimum number of directors for a non-distributing vs a distributing corporation; is there any Canadian residency requirement today (the 25% rule was removed in 2023: confirm the date and scope)? | Director-count check; residency column stays hidden |
| FED-2 | Director consent (s. 106(2)?): written consent requirements and timing for a director elected or appointed | Consent check with CBCA citation |
| FED-3 | Records at the registered office (s. 20): exact list, electronic records, retention | Records checklist and minute book gaps |
| FED-4 | Register of individuals with significant control (ss. 21.1-21.4): contents, update deadline (15 days?), annual review, inspection rights, and the 2024 filing with Corporations Canada | ISC register check and deadlines |
| FED-5 | Annual return (s. 263): filing window after the anniversary, contents, and consequences of not filing | Annual return deadline |
| FED-6 | Annual meeting (s. 133): first meeting within 18 months, later meetings within 15 months and 6 months after year end; can it be replaced by a written resolution? | Annual meeting timing check |
| FED-7 | Notice of shareholder meetings (s. 135 and Regulations): 21-60 days for non-distributing corporations? Can the by-laws change it? | Notice window |
| FED-8 | Written resolutions (s. 142, directors s. 117): unanimous only? | Written resolutions defaults and wording |
| FED-9 | Special resolution threshold and which changes need one | Resolution kind labels |
| FED-10 | By-laws (s. 103): how directors make, amend or repeal by-laws, and when shareholders must confirm them | "By-law amendments" flow for CBCA |
| FED-11 | Directors' changes and registered office changes: filing deadlines (15 days?) | Directors drawer and office-change deadlines |
| FED-12 | Director conflicts (s. 120): disclosure timing, abstention, minute requirements | Conflicts page for CBCA |
| FED-13 | Auditor exemption (s. 163): who may waive the auditor, and the consent required | Auditors page for CBCA |
| FED-14 | Shareholder and creditor access to records (s. 21) and permitted fees | Inspections page for CBCA |
| FED-15 | Extra-provincial registration: which provinces a CBCA corporation must register in when it carries on business there, with the BC and Ontario forms and deadlines | Extra-provincial registration prompts |
| FED-16 | "Annual meeting" vs "annual general meeting": which term the CBCA and Corporations Canada forms use | Formal minutes title (now "Annual Meeting") |

## 4. Ontario corporations (Business Corporations Act, RSO 1990, c. B.16)

The Ontario incorporation pathway is marked "review required", and its guidance stays under review until these questions are answered. Existing app citations to re-check: ss. 1(1), 1.1, 94, 104(1)(c), 126(3), 129, 139.

| ID | Question | What the app would do with it |
| --- | --- | --- |
| ONT-1 | Minimum directors (non-offering vs offering corporation); confirm the resident Canadian requirement was repealed in 2021 and from what date | Director-count check; residency column |
| ONT-2 | Director consent to act (s. 119?): form and timing | Consent check |
| ONT-3 | Records (s. 140): list, location, electronic records | Records checklist |
| ONT-4 | Register of individuals with significant control (s. 140.2): contents, updates, inspection | ISC register check for Ontario |
| ONT-5 | Annual return filed with the Ontario Business Registry: deadline (within 6 months after the tax year end?), and how it relates to the CRA T2 | Annual return deadline |
| ONT-6 | Annual meeting (s. 94): timing and when it can be replaced by a written resolution | Annual meeting timing |
| ONT-7 | Notice of meetings (s. 96): 10-50 days for a non-offering corporation? | Notice window |
| ONT-8 | Written resolutions (s. 104, s. 129) and the special resolution threshold | Written resolutions defaults |
| ONT-9 | By-laws (s. 116): making, amending, shareholder confirmation | "By-law amendments" flow |
| ONT-10 | Notices of change (Corporations Information Act): deadline for director and office changes | Directors drawer deadline |
| ONT-11 | Director conflicts (s. 132) and auditor exemption (s. 148) | Conflicts and Auditors pages |
| ONT-12 | Which incorporation documents (Form 1 articles, consents) the Ontario Business Registry now requires, so the pathway can lose its "review required" label | Ontario incorporation pathway |

## 5. Privacy law by jurisdiction

The privacy module was written for BC PIPA. Outside BC, the app now says "Privacy" and points to the federal tool, but it doesn't yet know which law applies. The starter privacy policy still reads as BC PIPA for federal and Ontario corporations. Existing citations to re-check: PIPA-ACCESS, PIPA-CONSENT, PIPA-OFFICER, PIPA-POLICY, PIPA-RETENTION, OIPC-\* guides, OPC-PRIVACY-PLAN-TOOL, CASL-CONSENT.

| ID | Question | What the app would do with it |
| --- | --- | --- |
| PRV-1 | Which private-sector privacy law applies to an organization headquartered in BC, Alberta, Quebec, Ontario or elsewhere, and when does PIPEDA apply instead (interprovincial activity, federal works)? | Pick the privacy law from the jurisdiction instead of BC-or-not |
| PRV-2 | Does PIPEDA apply to a nonprofit's non-commercial activity, e.g. a society's member data? Does BC PIPA cover societies' member records? | Whether member-data steps apply outside BC |
| PRV-3 | PIPEDA equivalents of the five PIPA checks: privacy officer, policy, consent, access within 30 days, retention | A federal set of privacy checks with PIPEDA (Schedule 1 principles) citations |
| PRV-4 | Quebec Law 25: person in charge of personal information, privacy impact assessments, incident register, and the 2024 portability rules. What is mandatory for a small business? | A Quebec privacy profile |
| PRV-5 | Alberta PIPA: differences from BC PIPA that change the checks (breach notification to the Commissioner) | An Alberta privacy profile |
| PRV-6 | Breach notification and record-keeping duties in each regime (PIPEDA breach records kept 24 months, Alberta notification, BC rules) | Incident register prompts |
| PRV-7 | Status of Bill C-27 / CPPA (died on the order paper?) and any successor bill. Should the app say anything about it? | Avoid citing a law that isn't in force |
| PRV-8 | CASL: consent rules for member and shareholder newsletters vs transactional notices (meeting notices). Do the nonprofit exemptions differ from a corporation's? | Communications consent wording by entity |
| PRV-9 | Which official guides to link for each regime (OPC, OIPC BC, OIPC Alberta, CAI Quebec), with current URLs | Template resources list per jurisdiction |

## 6. Meetings, notices, resolutions and voting

These cut across entity types. Each answer should be split by entity: BC society, BC company, CBCA, OBCA.

| ID | Question | What the app would do with it |
| --- | --- | --- |
| MTG-1 | Who is entitled to notice of an annual meeting: all shareholders or only voting shareholders, plus directors and the auditor? | The notice audience (the app sends to voting shareholders today) |
| MTG-2 | Acceptable notice methods (email, posting, electronic notice-and-access) and what proof of notice should be kept | Notice delivery records and proof wording |
| MTG-3 | Electronic and hybrid meetings: allowed by default, or only if the articles or by-laws permit? | Electronic participation option and warnings |
| MTG-4 | Proxies: are they allowed by default, how many per holder, and what must a proxy form contain? For a society, does the bylaw default forbid proxies? | Proxies page rules |
| MTG-5 | Who votes in a corporation: shares by class, record date rules, and how ties are broken | Election and voter-count logic (the server still snapshots member accounts) |
| MTG-6 | Director elections at an annual meeting: cumulative voting defaults and staggered terms | Elections page wording for corporations |
| MTG-7 | Shareholder proposals: eligibility thresholds and deadlines (CBCA s. 137 and equivalents) vs society member proposals (5% of voting members?) | Proposals page thresholds |
| MTG-8 | Requisitioned meetings: thresholds (5% of shares?) and timelines for each entity | A requisition workflow |
| MTG-9 | Financial statements at the annual meeting: what must be placed before shareholders vs members, and the audit or review engagement default | Year-end readiness checks |
| MTG-10 | Minutes: what each Act requires minutes to record and who must sign them | Minutes approval checks |

## 7. Records, minute book, registers and inspection

For corporations, the minute book check now looks for "articles and minutes". The records-inspection guidance shows only for BC societies, because the corporate version is unknown.

| ID | Question | What the app would do with it |
| --- | --- | --- |
| REC-1 | For each corporate Act, the full minute book contents a lawyer would expect: articles, by-laws, registers (directors, officers, shareholders, transfers, ISC or transparency), minutes, resolutions, unanimous shareholder agreements | A per-entity minute book checklist |
| REC-2 | Retention periods for corporate records and for CRA books and records (6 years after the tax year?), and whether the two conflict | Retention schedule defaults |
| REC-3 | Who may inspect which records (shareholders, creditors, directors, the public), with fees and response times, per Act | Corporate records-inspection guidance (now hidden) |
| REC-4 | Securities registers: what a share certificate or DRS notice must state, and when certificates are optional | Share register and certificate packet wording |
| REC-5 | Court orders, consents and waivers: which Acts require these to be kept with corporate records | Court orders page for corporations (the s. 20 subtitle is hidden for them) |
| REC-6 | Remuneration disclosure: does any corporate Act require something like the Societies Act s. 36 disclosure for private corporations? | Confirm the Employees note stays hidden for corporations |
| REC-7 | Employment standards record retention by province (BC 4 years?) for the Employees page | Employees page note for every entity |

## 8. Other entity types the app lists

The organization profile offers more Acts than the app has rules for. Today these get neutral wording and no checks. A short answer per Act would show whether each is worth supporting.

| ID | Entity / Act | Question |
| --- | --- | --- |
| OTH-1 | Federal nonprofit: Canada Not-for-profit Corporations Act | Directors minimum, annual meeting timing, annual return, soliciting vs non-soliciting rules, member classes. These are closest to a society: which society checks map directly? |
| OTH-2 | Ontario nonprofit: Not-for-Profit Corporations Act, 2010 | Same questions as OTH-1, plus the October 2024 transition deadline for old Corporations Act corporations |
| OTH-3 | Quebec: Business Corporations Act (Quebec) and the Enterprise Register | Directors, annual meeting, annual updating declaration, French-language requirements for records and notices |
| OTH-4 | Societies in other provinces: Alberta Societies Act, Nova Scotia Societies Act, Saskatchewan Non-Profit Corporations Act | Which of them still need an annual return and an AGM, and with what deadlines? Should these keep society wording without BC citations (the app's current behaviour)? |
| OTH-5 | Legacy BC: "Business Corporations Act (British Columbia, legacy alias)" and old Society Act (pre-2016) societies | Are there transition rules still relevant to existing records (pre-existing societies' constitutions, unalterable provisions)? |
| OTH-6 | Registered charities on top of any entity | Which CRA obligations (T3010, books and records, receipting) apply regardless of the corporate form, so they show for every entity that is a charity |

## 9. Terminology and display wording

The wording choices below were made without a legal source. Please confirm or correct each one; a short yes or no with the statute's own term is enough.

| ID | Current wording in the app | Question |
| --- | --- | --- |
| TRM-1 | BC company: "Annual General Meeting"; CBCA and OBCA: "Annual Meeting" | Do the Acts and registry forms use these exact terms? |
| TRM-2 | BC company: "articles" only (no by-laws); CBCA and OBCA: "articles and by-laws" | Correct for each Act? Can a BC company have by-laws in any sense the app should show? |
| TRM-3 | BC company sidebar: "Governance rules", "Articles alterations", "Articles history" | Is "alteration" the right statutory term for changing a BC company's articles? |
| TRM-4 | CBCA and OBCA: "By-law amendments", "By-laws history" | Do the Acts say "amend" or "make, amend or repeal"? |
| TRM-5 | Corporations: "special meeting" for the SGM type | Is "special meeting of shareholders" the right term in each Act? |
| TRM-6 | Corporations: "Ordinary" and "Special" resolution kinds; the app avoids "majority" and "unanimous" labels | Is "ordinary resolution" a defined term in each Act, or only "special resolution"? |
| TRM-7 | "Privacy (PIPA)" for BC workspaces, "Privacy" elsewhere | Should a BC company's privacy labels name PIPA, and should Quebec name Law 25? |
| TRM-8 | "Shareholders holding voting shares" as the voter count | Is this the right test for who votes at an annual meeting, or does the record date and class matter more? |
| TRM-9 | French labels such as "Modifications des statuts" and "Règlements administratifs" | Do these match the French versions of the CBCA and the Quebec Act? |

## 10. Priority and where answers land

Research in this order. Wave 1 checks text users see today; waves 2 and 3 restore the checks corporations lost; the rest widens coverage.

1. **Wave 1, live society claims:** SOC-12 (the written-resolution "majority" default may be wrong), SOC-1 to SOC-3, SOC-9, SOC-10, SOC-13.
2. **Wave 2, BC company and CBCA basics:** BCC-1 to BCC-7, FED-1 to FED-7, TRM-1 to TRM-3.
3. **Wave 3, privacy by jurisdiction:** PRV-1 to PRV-4, PRV-8.
4. **Wave 4, meetings and records:** MTG-1 to MTG-5, REC-1 to REC-3, ONT-1 to ONT-8.
5. **Wave 5, coverage:** OTH-1 to OTH-6, the remaining IDs.

| Kind of answer | File it changes |
| --- | --- |
| A new or corrected citation (ID, Act, section, URL) | `src/lib/regulatoryCitations.ts`; its audience decides which entities see it |
| A dashboard compliance check for an entity | `shared/dashboardComplianceRules.ts` (each rule declares its audience) |
| Which rule families apply to which entity or jurisdiction | `shared/entityRuleScope.ts` |
| Deadlines: annual report or return, annual meeting, director changes | `shared/functions/annualCycle.ts`, `shared/corporationSettings.ts`, `shared/continuityRules.ts` |
| Notice windows, quorum and resolution thresholds | `shared/bylawBaselines.ts`, bylaw rule sets |
| Wording and terms (meeting names, articles vs by-laws) | `src/lib/organizationVocabulary.ts`, `shared/entityMeetingWording.ts`, en/fr locale files |
| Privacy resources, inspection guidance, attestation notes | `src/lib/legalCopy.ts` |
| Incorporation pathways and guide tracks | `shared/pathways/registry.ts`, `src/lib/jurisdictionGuideTracks.ts` |
| Text that becomes legitimate for an entity | `tests/fixtures/entity-copy-allowlist.json` (allow-list with a reason) |

Every change is guarded by `npm run test:entity-sweep` and `scripts/check-entity-rule-scope.ts`. A new citation for an entity gets an assertion there, so no other entity type can show it.
