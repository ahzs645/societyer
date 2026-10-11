# Entity copy audit: society-only content in non-society workspaces

Audit date: 2026-10-11, at `claude/admiring-brown-utjnwt` 9b095a7. Produced by the automated sweep in
`tests/entity-copy-sweep.spec.ts` (config `playwright.entity-sweep.config.ts`, run with `npm run test:entity-sweep`).

## Status

**Resolved.** After the fixes on `claude/admiring-brown-utjnwt`, a strict run (`ENTITY_SWEEP_STRICT=1`)
finds no leaks for the BC company, CBCA, OBCA or custom (Quebec) workspace on any of the 108 routes. The
BC society control still shows its Societies Act content. The `knownLeaks` baseline in
`tests/fixtures/entity-copy-allowlist.json` is now empty, so `npm run test:entity-sweep` fails on any new
society-only copy in a non-society workspace. Justified matches stay in `allow`, each with a reason.

The findings below are the original audit, kept as a record of what was fixed and where.

## What was swept

Five workspaces were built through the real guided setup (`/setup` → "Start a new organization" → the Act
dropdown). No seed shortcut or mocked create mutation was used:

| Key | Setup path | Act option |
| --- | --- | --- |
| `bc-corp` | Existing organization | BC business corporation (provincial) |
| `cbca-corp` | New incorporation (preparing) | Federal business corporation (CBCA) |
| `obca-corp` | Existing organization | Ontario business corporation (OBCA) |
| `custom` | Existing organization | Another organization or Act → Quebec / Business Corporation / Business Corporations Act (Quebec) |
| `bc-society` (control) | Existing organization | BC society (nonprofit) |

The custom entity is a Quebec business corporation because Alberta has its own PIPA, so an Alberta entity could not
test BC-PIPA leakage.

Each workspace visited all **108 static in-app routes**: every `kind: "app", fixture: "route"` entry in
`tests/helpers/interfaceRoutes.ts`, mapped from `/demo/app/...` to `/app/...`. `/app/society/new` (the wizard) and
`/app/table-field-lab` (static demo only) were left out. A guard test re-reads `src/main.tsx` and fails if a new
static route is missing from the sweep. Routes with parameters were left out because a fresh workspace has no
records for them, and the ids in the matrix point at the society demo. `/demo/app` was not swept because it is a
society.

For each route the sweep collected:

- **main**: the routed content (`#main-content`), including empty states.
- **chrome**: everything outside the sidebar and main.
- **sidebar**: read once on `/app`, with every group expanded.
- **popover**: up to six page `InfoPopover`s, each opened and read.
- **toggle**: accessible labels of checkboxes, radios and switches.
- **title**: `title` tooltips in main and in the sidebar.

The workspace's own name is masked before matching.

Patterns flagged: `Societies Act`, `Societies Online`, `BC-SOC-`, `s.NN` next to "Societies", `\bsociety\b`
(case-insensitive), `\bmembers?\b` (except board/committee/team/staff members), `\bAGM\b` and "annual general meeting",
`bylaw(s)` on a line that does not mention "articles", `constitution`, `PIPA` (non-BC workspaces only), and
`charit*` in a toggle label (corporations only).

## Headline numbers

The counts are distinct snippets after the allow-list. A snippet is one matching line on one route in one channel.

| Workspace | Leaking snippets | Routes with a leak (of 108) | Clean routes | Plus the sidebar | Baseline keys (workspace, route, pattern) |
| --- | --- | --- | --- | --- | --- |
| `bc-corp` | 145 | 37 | 71 | yes | 62 |
| `cbca-corp` | 154 | 39 | 69 | yes | 67 |
| `obca-corp` | 155 | 39 | 69 | yes | 67 |
| `custom` (Quebec) | 155 | 39 | 69 | yes | 67 |
| `bc-society` (control) | n/a (516 matches, all expected) | n/a | n/a | n/a | n/a |

The four non-society workspaces have almost the same leak sets, so the copy is not keyed off the entity at all.
The only differences are the PIPA matches, which are flagged only for non-BC workspaces, and a few pathway-specific
lines.

By pattern, across all four non-society workspaces: bylaws 158, members 153, society 112, AGM 100, constitution 32,
PIPA 30, Societies Online 8, charity toggle 8, Societies Act 4, `s.NN` next to "Societies" 4.

**Already clean.** These routes showed no society-only copy in any corporation:

- the dashboard (`/app`)
- `/app/meetings`, `/app/directors` (CBCA and OBCA use pathway text, which is allow-listed)
- `/app/role-holders`, `/app/rights-ledger`
- `/app/filings`, `/app/compliance-obligations`, `/app/deadlines`
- `/app/inspections`, `/app/written-resolutions`, `/app/attestations` (main text; its popover still leaks)
- `/app/significant-individuals`, `/app/dividends`, `/app/certificate-register`, `/app/settings`

The earlier fixes on this branch hold on those routes.

**Top leaks by severity:**

1. **`/app/employees`** (every corporation, linked in the nav). The info popover cites "remuneration disclosure under
   s.36 of the Societies Act". Hard-coded in `src/pages/Employees.tsx`.
2. **`/app/research-library`** (in the nav, 45 snippets per workspace). It lists every BC society research row
   unfiltered: "BC society · SOC-T01…T08", "Ordinary society constitution", "Actual report filed in Societies Online",
   member-funded constitutional statements. The data is in `src/lib/research/societyerResearch.json` and is not
   filtered by entity in `src/pages/ResearchLibrary.tsx`.
3. **`/app/court-orders`**: "Court orders affecting the society — required to be kept with governance records under
   s.20." (`src/pages/CourtOrders.tsx`).
4. **`/app/auditors`**: "Who audits or reviews the society's financial statements", and the popover says "subsequent
   appointments made by members at the AGM" (`src/pages/Auditors.tsx`).
5. **`/app/financials/year-end`**: "Financial statements presented to members at the AGM", "Annual general meeting
   held" and "No held AGM found." Generated in `shared/functions/yearEnd.ts` and `shared/continuityRules.ts`.
6. **`/app/annual-cycle`** (reachable but not in the nav): ten AGM-only lines such as "Schedule the AGM" and "No AGM
   minutes are linked yet." (`shared/functions/annualCycle.ts`).
7. **`/app/society` and `/app/organization-details`** (one page): a "Registered CRA charity" toggle for business
   corporations, a "Bylaws: Missing" row with no articles, and a fiscal-year tooltip about "a bylaw amendment"
   (`src/pages/Society.tsx`).
8. **Sidebar**: the deadlines pill tooltip reads "…fiscal year end (Society profile) and record held AGMs…"
   (`src/components/Layout.tsx`). Nav labels "Bylaw rules", "Bylaw amendments" and "Bylaws history" appear for every
   corporation; a BC company has articles, not bylaws. "Privacy (PIPA)" and "PIPA training" appear for CBCA, OBCA and
   Quebec (`src/lib/routeIdentity.ts`, `src/i18n/locales/en.json`, `src/lib/modules.ts`).
9. **`/app/elections`**: "Member elections with anonymous ballots" and "the bylaws don't allow electronic voting"
   (`src/pages/Elections.tsx`).
10. **`/app/portfolio`** (reachable but not in the nav): the society packet catalogue, with "BC society constitution
    preparation", "Society AGM resolutions packet" and others (`shared/societyDocumentPackets.ts`).
11. **`/app/privacy`, `/app/pipa-training`, `/app/motion-backlog`, `/app/users`**: BC PIPA framing for federal,
    Ontario and Quebec corporations, plus "member-data" wording (`src/pages/Privacy.tsx`, `src/lib/legalCopy.ts`,
    `src/pages/PipaTraining.tsx`, `src/pages/MotionBacklog.tsx`, `src/lib/modules.ts`).
12. **`/app/minute-book`** "Your society's legal records…", **`/app/minutes`** "Minutes of general meetings (AGM/SGM)
    are accessible to members." and **`/app/meeting-templates/new`** "BC-specific acknowledgement, editable for the
    society."

### Notes on severity

- **Bylaws.** CBCA, OBCA and Quebec corporations do have by-laws, so "by-laws" alone is not wrong for them; the
  correct pairing is "articles and by-laws". For `bc-corp` it is wrong: BC companies have articles. The sweep flags
  `bylaws` without "articles" for every corporation, as the brief asked. Pathway text that is correct (the CBCA
  post-incorporation checklist, and CBCA/OBCA director guidance) is allow-listed. The generic Bylaw rules, Bylaw
  amendments and Bylaws history pages stay in the baseline until they adapt their label and copy.
- **AGM.** The BC Business Corporations Act (s.182) does use "annual general meeting", so the BC company
  post-incorporation checklist is allow-listed. CBCA and OBCA say "annual meeting of shareholders". Even for a BC
  company, "presented to members at the AGM" is wrong because a company has shareholders, not members.
- **Hidden routes.** `/app/members`, `/app/membership`, `/app/proposals`, `/app/annual-cycle`, `/app/portfolio`,
  `/app/integrations` and `/app/meeting-templates/new` are not linked from a corporation's sidebar but can be reached
  by URL, search and in-app links. They are reported with *In nav: no* and rank below the routes in the nav.

## Findings

The groups below sort leaks by where the fix most likely belongs:

- **A. Page component**: hard-coded copy in a page.
- **B. Shared function / shared copy helper**: copy generated in `shared/functions/*`, `src/lib/legalCopy.ts`,
  `src/lib/moduleAccess.ts` or `Layout`.
- **C. Stored metadata / seed data**: research JSON, document-packet catalogues, the integration catalogue and audit
  records.
- **D. Translation strings / nav labels**: `src/i18n/locales/*.json`, `src/lib/routeIdentity.ts` and
  `src/lib/modules.ts`.

Source files were found by grepping the snippet text across `src/`, `shared/` and `convex/`, then corrected by hand.
Treat them as strong guesses, not proof.

### Route × workspace matrix

Count of distinct matching snippets per cell, with the patterns hit. `·` = clean. *In nav* = whether the route is linked from that workspace's sidebar (hidden routes are still reachable by URL, search and links).

| Route | In nav | bc-corp | cbca-corp | obca-corp | custom |
| --- | --- | --- | --- | --- | --- |
| `(sidebar)` | yes | 5 (bylaws, society, agm) | 7 (bylaws, pipa, society, agm) | 7 (bylaws, pipa, society, agm) | 7 (bylaws, pipa, society, agm) |
| `/app/annual-cycle` | no | 10 (agm) | 10 (agm) | 10 (agm) | 10 (agm) |
| `/app/attestations` | yes | 1 (bylaws) | 1 (bylaws) | 1 (bylaws) | 1 (bylaws) |
| `/app/audit` | yes | 1 (society) | 1 (society) | 1 (society) | 1 (society) |
| `/app/auditors` | yes | 3 (society, members, agm) | 3 (society, members, agm) | 3 (society, members, agm) | 3 (society, members, agm) |
| `/app/bylaw-diff` | yes | 4 (bylaws) | 4 (bylaws) | 4 (bylaws) | 4 (bylaws) |
| `/app/bylaw-rules` | yes | 2 (bylaws) | 2 (bylaws) | 3 (bylaws) | 3 (bylaws) |
| `/app/bylaws-history` | yes | 2 (bylaws) | 2 (bylaws) | 2 (bylaws) | 2 (bylaws) |
| `/app/communications` | yes | 2 (members) | 2 (members) | 2 (members) | 2 (members) |
| `/app/court-orders` | yes | 1 (society) | 1 (society) | 1 (society) | 1 (society) |
| `/app/custom-fields` | yes | 2 (members) | 2 (members) | 2 (members) | 2 (members) |
| `/app/document-catalog` | yes | 1 (bylaws) | 1 (bylaws) | 1 (bylaws) | 1 (bylaws) |
| `/app/elections` | yes | 7 (members, bylaws) | 7 (members, bylaws) | 7 (members, bylaws) | 7 (members, bylaws) |
| `/app/employees` | yes | 2 (societies-act, societies-section) | 2 (societies-act, societies-section) | 2 (societies-act, societies-section) | 2 (societies-act, societies-section) |
| `/app/exports` | yes | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/financials/year-end` | yes | 5 (members, agm) | 5 (members, agm) | 5 (members, agm) | 5 (members, agm) |
| `/app/integrations` | no | 3 (members, agm, bylaws) | 3 (members, agm, bylaws) | 3 (members, agm, bylaws) | 3 (members, agm, bylaws) |
| `/app/meeting-templates/new` | no | 2 (society, members) | 2 (society, members) | 2 (society, members) | 2 (society, members) |
| `/app/members` | no | 5 (members) | 5 (members) | 5 (members) | 5 (members) |
| `/app/membership` | no | 3 (members) | 3 (members) | 3 (members) | 3 (members) |
| `/app/minute-book` | yes | 1 (society) | 1 (society) | 1 (society) | 1 (society) |
| `/app/minutes` | yes | 2 (members, agm) | 2 (members, agm) | 2 (members, agm) | 2 (members, agm) |
| `/app/motion-backlog` | yes | · | 1 (pipa) | 1 (pipa) | 1 (pipa) |
| `/app/notifications` | yes | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/organization-details` | yes | 3 (bylaws, charity-toggle) | 3 (bylaws, charity-toggle) | 3 (bylaws, charity-toggle) | 3 (bylaws, charity-toggle) |
| `/app/paperless` | yes | 4 (society, bylaws, constitution) | 4 (society, bylaws, constitution) | 4 (society, bylaws, constitution) | 4 (society, bylaws, constitution) |
| `/app/people-directory` | yes | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/pipa-training` | yes | · | 3 (pipa) | 3 (pipa) | 3 (pipa) |
| `/app/point-in-time-register` | yes | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/portfolio` | no | 10 (society, agm, bylaws, constitution) | 10 (society, agm, bylaws, constitution) | 10 (society, agm, bylaws, constitution) | 10 (society, agm, bylaws, constitution) |
| `/app/privacy` | yes | 3 (members) | 5 (pipa, members) | 5 (pipa, members) | 5 (pipa, members) |
| `/app/proposals` | no | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/proxies` | yes | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/research-library` | yes | 45 (societies-online, society, members, agm, bylaws, constitution) | 45 (societies-online, society, members, agm, bylaws, constitution) | 45 (societies-online, society, members, agm, bylaws, constitution) | 45 (societies-online, society, members, agm, bylaws, constitution) |
| `/app/society` | yes | 3 (bylaws, charity-toggle) | 3 (bylaws, charity-toggle) | 3 (bylaws, charity-toggle) | 3 (bylaws, charity-toggle) |
| `/app/template-engine` | yes | 1 (bylaws) | 1 (bylaws) | 1 (bylaws) | 1 (bylaws) |
| `/app/timeline` | yes | 2 (members, bylaws) | 2 (members, bylaws) | 2 (members, bylaws) | 2 (members, bylaws) |
| `/app/users` | yes | 1 (members) | 2 (members, pipa) | 2 (members, pipa) | 2 (members, pipa) |
| `/app/volunteers` | yes | 1 (members) | 1 (members) | 1 (members) | 1 (members) |
| `/app/workflows` | yes | 2 (agm) | 2 (agm) | 2 (agm) | 2 (agm) |
| **Total snippets** | | **145** | **154** | **155** | **155** |
| **Routes with a leak** | | **38** | **40** | **40** | **40** |

### A. Page component

| Route | Workspaces | In nav | Where | Patterns | Snippets | Likely source |
| --- | --- | --- | --- | --- | --- | --- |
| `/app/auditors` | all four | yes | main, popover | society, members, agm | “Who audits or reviews the society's financial statements.”<br>“First auditor appointed by directors; subsequent appointments made by members at the AGM. Only independent CP…”<br>“…ppointed by directors; subsequent appointments made by members at the AGM. Only independent CPAs or CPA firm…” | src/pages/Auditors.tsx |
| `/app/bylaw-diff` | all four | yes | main | bylaws | “Draft, consult, pass and file bylaw amendments.”<br>“Proposed bylaws” | src/pages/BylawDiff.tsx |
| `/app/bylaw-diff` | all four | yes | main | bylaws | “Current bylaws” | src/pages/BylawDiff.tsx, src/pages/BylawsHistory.tsx |
| `/app/bylaw-rules` | all four | yes | main | bylaws | “Bylaws often set a different quorum for board meetings (for example a majori…”<br>“…this entity and jurisdiction. This does not record adoption of model bylaws. Corporate quorum requires the l…” | src/pages/BylawRules.tsx |
| `/app/bylaws-history` | all four | yes | main | bylaws | “Current bylaws” | src/pages/BylawDiff.tsx, src/pages/BylawsHistory.tsx |
| `/app/communications` | all four | yes | main, popover | members | “Notices, campaigns and member contact preferences.”<br>“Templated notices, campaign history, member contact preferences and proof-of-notice delivery logs.” | src/pages/Communications.tsx |
| `/app/court-orders` | all four | yes | main | society | “Court orders affecting the society — required to be kept with governance records under s.20.” | src/pages/CourtOrders.tsx |
| `/app/custom-fields` | all four | yes | main, popover | members | “Extra fields for members, directors, volunteers and staff.”<br>“Add extra fields to any person category (members, directors, volunteers, employees). Saved values appear on e…” | src/pages/CustomFields.tsx |
| `/app/elections` | all four | yes | main, popover | members, bylaws | “Member elections with anonymous ballots.”<br>“No-auth mode: member ballots are turned off.”<br>“Bylaw restriction: the bylaws don't allow electronic voting.”<br>+4 more | src/pages/Elections.tsx |
| `/app/employees` | all four | yes | popover | societies-act, societies-section | “…of truth for T4/T4A slips, remuneration disclosure under s.36 of the Societies Act (pay of $75,000 or more),…”<br>“…yroll source of truth for T4/T4A slips, remuneration disclosure under s.36 of the Societies Act (pay of $75,…” | src/pages/Employees.tsx |
| `/app/meeting-templates/new` | all four | no | main | society, members | “BC-specific acknowledgement, editable for the society.”<br>“Discussion space for members in attendance.” | src/pages/MeetingTemplates.tsx |
| `/app/members` | all four | no | main | members | “Members”<br>“Member and contact records for this corporation. Shareholders, directors and…”<br>“New member”<br>+2 more | src/pages/Members.tsx |
| `/app/membership` | all four | no | main | members | “Fee tiers, member-fee history, signup and renewal.”<br>“Member fee timeline” | src/pages/Membership.tsx |
| `/app/membership` | all four | no | main | members | “Member Plan Status Started Renews Last payment” | src/pages/Membership.tsx (record table columns) |
| `/app/minute-book` | all four | yes | main | society | “Your society's legal records and the evidence behind them.” | src/pages/MinuteBook.tsx |
| `/app/minutes` | all four | yes | popover | members, agm | “Minutes of general meetings (AGM/SGM) are accessible to members.” | src/pages/Minutes.tsx |
| `/app/motion-backlog` | cbca-corp, obca-corp, custom | yes | main | pipa | “Add PIPA setup motions” | src/pages/MotionBacklog.tsx |
| `/app/notifications` | all four | yes | title | members | “Send a digest email to members who have opted in to notification emails.” | src/pages/Notifications.tsx |
| `/app/organization-details` | all four | yes | main, toggle, title | bylaws, charity-toggle | “Bylaws Missing No linked document”<br>“Registered CRA charity”<br>“Changing the fiscal year end can require a bylaw amendment and notification to the CRA. Affects every filing …” | src/pages/Society.tsx |
| `/app/people-directory` | all four | yes | main | members | “No directory profiles yet. Board and members are in Directors and Members.” | src/pages/PeopleDirectory.tsx |
| `/app/pipa-training` | cbca-corp, obca-corp, custom | yes | popover | pipa | “Training records for BC's Personal Information Protection Act (PIPA) and Canada's anti-spam law (CASL). Annua…” | src/pages/PipaTraining.tsx |
| `/app/point-in-time-register` | all four | yes | main | members | “Members (0)” | src/features/gaps/ExpectationsPanel.tsx |
| `/app/privacy` | all four | yes | popover, main | members, pipa | “…ivacy officer, adopting the policy and complaint process, documenting member-data access, and setting the tr…”<br>“Internal PIPA setup state, including member-data custody notes.”<br>“No PIPA setup motions in backlog” | src/pages/Privacy.tsx |
| `/app/proposals` | all four | no | main | members | “No member proposals yet” | src/pages/MemberProposals.tsx (record-table empty state) |
| `/app/proxies` | all four | yes | popover | members | “Active rules: proxies allowed, up to 1 holder(s) per member per meeting.” | src/pages/Proxies.tsx |
| `/app/society` | all four | yes | main, toggle, title | bylaws, charity-toggle | “Bylaws Missing No linked document”<br>“Registered CRA charity”<br>“Changing the fiscal year end can require a bylaw amendment and notification to the CRA. Affects every filing …” | src/pages/Society.tsx |
| `/app/timeline` | all four | yes | popover | members, bylaws | “…etings, filings, deadlines, elections, bylaw milestones, commitments, member-fee changes and funding events …”<br>“Meetings, filings, deadlines, elections, bylaw milestones, commitments, member-fee changes and funding events…” | src/pages/Timeline.tsx |
| `/app/volunteers` | all four | yes | popover | members | “Public and member intake, volunteer assignments, BC Criminal Record Review Program scre…” | src/pages/Volunteers.tsx |
| `/app/workflows` | all four | yes | main, popover | agm | “Automations like AGM prep reminders and filing alerts.”<br>“Set up automations — like AGM prep reminders or filing deadline alerts — and control when they run.” | src/pages/Workflows.tsx |

### B. Shared function / shared copy helper

| Route | Workspaces | In nav | Where | Patterns | Snippets | Likely source |
| --- | --- | --- | --- | --- | --- | --- |
| `(sidebar)` | all four | yes | title | society, agm | “…ines are tracked yet. Add the incorporation date and fiscal year end (Society profile) and record held AGMs …”<br>“…orporation date and fiscal year end (Society profile) and record held AGMs to compute statutory deadlines.” | src/components/Layout.tsx |
| `/app/annual-cycle` | all four | no | main | agm | “Schedule the AGM”<br>“No AGM is scheduled for this cycle year.”<br>“Schedule AGM”<br>+7 more | shared/functions/annualCycle.ts |
| `/app/attestations` | all four | yes | popover | bylaws | “…qualification wording before relying on it for a new jurisdiction or bylaw template.” | src/lib/legalCopy.ts |
| `/app/exports` | all four | yes | title | members | “members” | shared/functions/exports.ts (export table list) |
| `/app/financials/year-end` | all four | yes | main | members, agm | “Financial statements presented to members at the AGM”<br>“Not yet linked to an AGM.”<br>“No held AGM found.” | shared/functions/yearEnd.ts |
| `/app/financials/year-end` | all four | yes | main | agm | “Annual general meeting held” | shared/continuityRules.ts, shared/functions/yearEnd.ts |
| `/app/paperless` | all four | yes | main | society, bylaws | “Society profile, meetings, elections, bylaws, and auditor records.” | shared/functions/paperless.ts (tag/source descriptions) |
| `/app/paperless` | all four | yes | main | bylaws, constitution | “bylaws”<br>“constitution” | shared/functions/paperless.ts (default tag set) |
| `/app/privacy` | all four | yes | popover | members, pipa | “…real records, systems, roles, complaint process, retention rules, and member-data situation before adoption.”<br>“…ideas, but supplemental because it is PIPEDA-oriented rather than BC PIPA-specific.” | src/lib/legalCopy.ts |
| `/app/users` | all four | yes | main | members | “Members, directors & committees” | src/lib/moduleAccess.ts |

### C. Stored metadata / seed data

| Route | Workspaces | In nav | Where | Patterns | Snippets | Likely source |
| --- | --- | --- | --- | --- | --- | --- |
| `/app/audit` | all four | yes | main | society | “Society” | audit record entityType "society" written at workspace creation (rendered by src/pages/AuditLog.tsx) |
| `/app/document-catalog` | all four | yes | main | bylaws | “Before use: Confirm the appointing body and title authority under the bylaws or prior delegation.” | shared/corporationDocumentPackets.ts |
| `/app/integrations` | all four | no | main | members, agm, bylaws | “Map Societyer members, donors, volunteers, events, consent, and receipts to a nonprofit CRM…”<br>“Export or sync meetings, AGM dates, filing deadlines, insurance renewals, grant reports, and task…”<br>“…Registry filing history and stage filings, governance documents, and bylaws history.” | shared/integrationCatalog.ts |
| `/app/portfolio` | all four | no | main | society, agm, bylaws, constitution | “BC society constitution preparation”<br>“BC society bylaws preparation”<br>“Society AGM resolutions packet”<br>+4 more | shared/societyDocumentPackets.ts |
| `/app/research-library` | all four | yes | main | societies-online, society, members, agm, bylaws, constitution | “…reparation/authority record as useful; complete actual application in Societies Online; do not mail/fax.”<br>“Actual report filed in Societies Online; retain confirmation. Do not attach financials/minutes unless separat…”<br>“Ordinary society constitution”<br>+30 more | src/lib/research/societyerResearch.json |
| `/app/research-library` | all four | yes | main | society | “BC society · SOC-T01”<br>“BC society”<br>“BC society · SOC-T02”<br>+6 more | src/lib/research/societyerResearch.json (research_area), rendered unfiltered by src/pages/ResearchLibrary.tsx |
| `/app/template-engine` | all four | yes | main | bylaws | “…checklist. Confirm the appointing body and title authority under the bylaws or prior delegation. Active” | shared/corporationDocumentPackets.ts |

### D. Translation strings / nav labels

| Route | Workspaces | In nav | Where | Patterns | Snippets | Likely source |
| --- | --- | --- | --- | --- | --- | --- |
| `(sidebar)` | all four | yes | sidebar | bylaws | “Bylaw rules” | src/i18n/locales/en.json (nav.bylawRules), src/lib/routeIdentity.ts |
| `(sidebar)` | all four | yes | sidebar | bylaws | “Bylaw amendments” | src/lib/routeIdentity.ts, src/pages/BylawDiff.tsx |
| `(sidebar)` | all four | yes | sidebar | bylaws | “Bylaws history” | src/lib/routeIdentity.ts, src/pages/BylawsHistory.tsx |
| `(sidebar)` | cbca-corp, obca-corp, custom | yes | sidebar | pipa | “Privacy (PIPA)” | src/lib/routeIdentity.ts, src/pages/Privacy.tsx |
| `(sidebar)` | cbca-corp, obca-corp, custom | yes | sidebar | pipa | “PIPA training” | src/lib/routeIdentity.ts (label), src/lib/modules.ts |
| `/app/bylaw-diff` | all four | yes | main | bylaws | “Bylaw amendments” | src/lib/routeIdentity.ts, src/pages/BylawDiff.tsx |
| `/app/bylaw-rules` | all four | yes | main | bylaws | “Bylaw rules” | src/i18n/locales/en.json (nav.bylawRules), src/lib/routeIdentity.ts |
| `/app/bylaws-history` | all four | yes | main | bylaws | “Bylaws history” | src/lib/routeIdentity.ts, src/pages/BylawsHistory.tsx |
| `/app/pipa-training` | cbca-corp, obca-corp, custom | yes | main | pipa | “PIPA training” | src/lib/routeIdentity.ts (label), src/lib/modules.ts |
| `/app/pipa-training` | cbca-corp, obca-corp, custom | yes | main | pipa | “No PIPA training yet” | record-table empty state from object label in src/lib/modules.ts / record-table metadata |
| `/app/users` | cbca-corp, obca-corp, custom | yes | main | pipa | “PIPA training log” | src/lib/modules.ts, src/i18n/locales/en.json |

### Allow-listed matches

| Route | Workspaces | Pattern | Snippet | Reason |
| --- | --- | --- | --- | --- |
| `/app/bylaw-rules` | all four | society | “…tion rules must be configured from approved articles and by-laws; the society baseline cannot be adopted her…” | Explicit negation on the disabled 'adopt baseline' control: says the society baseline is not available for this entity. |
| `/app/directors` | cbca-corp | bylaws | “Review CBCA director qualification and by-law requirements.” | Pathway-specific director guidance; CBCA and OBCA corporations have by-laws. |
| `/app/directors` | obca-corp | bylaws | “Review OBCA director qualification and by-law requirements.” | Pathway-specific director guidance; CBCA and OBCA corporations have by-laws. |
| `/app/document-catalog` | all four | society | “…. Each incorporator must agree to take at least one share; a company, society or other authorized entity may…” | Statutory incorporator rule for business corporations (CBCA s.5 / BCA): a society may itself be an incorporator. Correct corporate content. |
| `/app/filings/prefill` | bc-corp | societies-online | “Registry route: BC Corporate Online. This entity does not use BC Societies Online. Use its jurisdiction filin…” | Explicit negation: tells a non-society entity that the Societies Online pre-fill does not apply and points it at its own registry. |
| `/app/filings/prefill` | cbca-corp | societies-online | “Registry route: Corporations Canada. This entity does not use BC Societies Online. Use its jurisdiction filin…” | Explicit negation: tells a non-society entity that the Societies Online pre-fill does not apply and points it at its own registry. |
| `/app/filings/prefill` | obca-corp | societies-online | “…egistry route: Ontario Business Registry. This entity does not use BC Societies Online. Use its jurisdiction…” | Explicit negation: tells a non-society entity that the Societies Online pre-fill does not apply and points it at its own registry. |
| `/app/filings/prefill` | custom | societies-online | “Registry route: Registry. This entity does not use BC Societies Online. Use its jurisdiction filing checklist…” | Explicit negation: tells a non-society entity that the Societies Online pre-fill does not apply and points it at its own registry. |
| `/app/organization-details` | all four | members | “Purposes or articles can require member/shareholder approval and a registry filing to change. Charities may a…” | Entity-neutral profile hint naming both members and shareholders. |
| `/app/post-incorporation` | bc-corp | agm | “7. Track the annual report separately from the AGM” | BC Business Corporations Act s.182 uses 'annual general meeting' (and annual reference date) for companies; the BC company checklist is correct. |
| `/app/post-incorporation` | bc-corp | agm | “The company annual report uses the incorporation anniversary. AGM or unanimous-resolution obligations use the…” | BC Business Corporations Act s.182 uses 'annual general meeting' (and annual reference date) for companies; the BC company checklist is correct. |
| `/app/post-incorporation` | bc-corp | agm | “…l report within two months after the incorporation anniversary; first AGM within 18 months, then assess annu…” | BC Business Corporations Act s.182 uses 'annual general meeting' (and annual reference date) for companies; the BC company checklist is correct. |
| `/app/post-incorporation` | cbca-corp | bylaws | “An incorporator or director calls an organizational meeting to make by-laws, appoint officers, authorize the …” | CBCA post-incorporation checklist: federal corporations make, confirm and amend by-laws (CBCA ss.103, 104). Correct for this pathway. |
| `/app/post-incorporation` | cbca-corp | bylaws | “4. Make by-laws” | CBCA post-incorporation checklist: federal corporations make, confirm and amend by-laws (CBCA ss.103, 104). Correct for this pathway. |
| `/app/post-incorporation` | cbca-corp | bylaws | “Adopt the by-laws that govern the corporation's internal operations (financial year-end…” | CBCA post-incorporation checklist: federal corporations make, confirm and amend by-laws (CBCA ss.103, 104). Correct for this pathway. |
| `/app/post-incorporation` | cbca-corp | bylaws | “Shareholders elect directors, confirm/modify/reject the by-laws, and appoint (or waive) an auditor.” | CBCA post-incorporation checklist: federal corporations make, confirm and amend by-laws (CBCA ss.103, 104). Correct for this pathway. |
| `/app/post-incorporation` | obca-corp, custom | members | “A permitted workspace member can start a supported preparation pathway.” | Workspace (app user) membership, not members as voters. |
| `/app/post-incorporation` | obca-corp, custom | members | “BC ordinary/member-funded societies, ordinary private BC companies and federal CBCA corp…” | Tooltip enumerating every supported preparation pathway; naming the society pathway is the point. |
| `/app/society` | all four | members | “Purposes or articles can require member/shareholder approval and a registry filing to change. Charities may a…” | Entity-neutral profile hint naming both members and shareholders. |
| `/app/template-engine` | all four | society | “…. Each incorporator must agree to take at least one share; a company, society or other authorized entity may…” | Statutory incorporator rule for business corporations (CBCA s.5 / BCA): a society may itself be an incorporator. Correct corporate content. |

## Society control

The BC society keeps its Societies Act content. The sweep matched 516 society-pattern snippets there, all expected.
Examples:

- **`/app`** (compliance card): "Fewer than 3 active directors (s.40 Societies Act; s.197 member-funded exception)"
  and "Societies Act ss.40, 197".
- **`/app/members`**: "Register of members as required under s.20 of the Societies Act."
- **`/app/directors`**: "Register of directors under BC Societies Act s.20…" and "File within 30 days via Societies
  Online."
- **`/app/inspections`**: "Societies Act s.24: the public may be charged up to $10 per day…"
- **`/app/bylaw-rules`**, **`/app/coverage`**, **`/app/filings`**, **`/app/post-incorporation`** and
  **`/app/template-engine`** carry the Societies Act baselines and authorities.

The verdict asserts two things about the society:

1. "Societies Act" appears on `/app` or `/app/members`.
2. Members is in the society's sidebar.

It also checks the reverse for every corporation, which proves the entity kind took effect: Members must not be in
the sidebar.

## Running and tightening the sweep

```sh
SOCIETYER_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:entity-sweep
```

The config uses port 4183 with its own `vite` webServer and `VITE_E2E_TEST_HARNESS=1`. Its projects run in order:

1. **`setup`**: the route-coverage guard, plus one guided setup per workspace. Each setup saves its storage state,
   including IndexedDB, to `tmp/entity-sweep/<workspace>.storage.json`.
2. **`sweep`**: five workspaces × three route shards. Each shard opens the saved state and navigates inside the app
   with a router `popstate`, so the workspace is not re-hydrated from IndexedDB on every route.
3. **`report`**: the verdict.

The run uses 4 workers and takes about 4.5 minutes. With `ENTITY_SWEEP_RELOAD=1` every route is a full page load;
this gave the same findings and took about 14 minutes.

The shards only fail on crashes. The `report` test reads every shard, writes `tmp/entity-sweep/findings.json` and
`findings.md`, and fails on:

- a match in a non-society workspace that is neither allow-listed nor in the baseline;
- the society losing its Societies Act copy or its Members link;
- a corporation gaining the Members link;
- more than 10% of routes rendering almost nothing.

### Knobs

| Env var | Effect |
| --- | --- |
| `ENTITY_SWEEP_STRICT=1` | Ignore the `knownLeaks` baseline and fail on every non-allow-listed match. |
| `ENTITY_SWEEP_ROUTES=/app,/app/members` | Sweep only these routes (stale-baseline reporting is limited to them). |
| `ENTITY_SWEEP_SHARDS=3`, `ENTITY_SWEEP_WORKERS=4` | Parallelism. |
| `ENTITY_SWEEP_RELOAD=1` | Full page load per route instead of in-app navigation. |

Re-run only the verdict on existing shard data:
`npx playwright test -c playwright.entity-sweep.config.ts --project report --no-deps`.

### Allow-list and baseline

Both live in `tests/fixtures/entity-copy-allowlist.json`:

- **`allow`** holds justified matches. Each entry has a `pattern`, an optional `route` (exact, `*`, or `prefix*`),
  optional `workspaces` and `channel`, a case-insensitive `snippet` regex and a required `reason`. Only add text that
  is correct for that entity, such as an explicit negation ("does not use BC Societies Online") or pathway-specific
  legal content. Never add a leak here to quiet the test.
- **`knownLeaks`** is the baseline of leaks tolerated today. Each line is a coarse `workspace | route | pattern` key,
  so dates and counts in a snippet do not churn it. It was generated from this audit: 263 keys.

### How to tighten

1. After a fix lands, run the sweep. The report prints "Baseline entries that no longer reproduce" and attaches them
   as a `stale-baseline` annotation. Delete those lines from `knownLeaks`.
2. To see everything still open, run with `ENTITY_SWEEP_STRICT=1`, or read `tmp/entity-sweep/findings.md`.
3. When `knownLeaks` is empty, the sweep is a strict gate. You can then drop the baseline mechanism, or keep it empty.
4. New static routes are picked up automatically through `tests/helpers/interfaceRoutes.ts`; the guard test fails if
   `src/main.tsx` gains a route the matrix lacks. To cover a route with parameters, add a record-creating step to the
   setup tests and append the concrete path to `SWEEP_ROUTES`.

### Known limits

- The workspaces are fresh and almost empty. Copy that only renders with data, such as AGM workflow pages, meeting
  detail, member detail or filled tables, is covered only through its empty state.
  `tests/corporation-governance-copy.spec.ts` covers the AGM workflow for a seeded CBCA corporation.
- It reads English UI only. `fr.json` strings are not swept.
- Popovers are capped at six per page. Dialogs, drawers and menus that need a click (other than info popovers)
  are not opened.
- The default `playwright.config.ts` would pick up this spec by name. The spec skips itself unless
  `SOCIETYER_ENTITY_SWEEP` is set, which only `playwright.entity-sweep.config.ts` does. Adding it to that config's
  `testIgnore` would be tidier, but that edits an existing file.
