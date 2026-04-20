# Societyer Page Field Support

Generated from these local files on 2026-04-20:

- `src/main.tsx`
- `src/pages/*.tsx`
- `convex/importSessions.ts`
- `convex/paperless.ts`
- `convex/schema.ts`

Use this as a page-by-page map for document intake. "Native import" means the `/app/imports` review pipeline can stage and apply document-derived records. "Manual/API only" means the page has writable fields, but the current import transposer does not create that target directly.

## Native Import And Transposition Surface

| Page | Route | Native import kinds | Supported document fields |
|---|---|---|---|
| Import sessions | `/app/imports` | all bundle records | Session name, import JSON, review status, confidence, source external IDs, review notes, payload JSON. Specialized editors exist for source, fact, event, board term, motion, and budget. |
| Org history | `/app/org-history` | `source`, `fact`, `event`, `boardTerm`, `motion`, `budget` | Sources: title, system, external ID, source date, category, confidence, URL, notes. Facts: label, value, sources. Events: date, title, category, summary, sources. Board terms: person, position, board/committee, start/end, change, notes, sources. Motions: meeting date/title, motion text, outcome, moved/seconded by, votes, notes, sources. Budgets: fiscal year, title, source date, currency, income, expenses, net, ending balance, line items, notes, sources. |
| Documents | `/app/documents` | `documentCandidate`, `source` placeholders | Title, category, file name, MIME type, file size, tags, retention years, committee, source metadata. Actual file upload/version history is UI driven. |
| Meetings | `/app/meetings`, `/app/meetings/:id` | `meetingMinutes`, `motion`, `meetingAttendance`, `motionEvidence` | Meeting date/title, type inferred, agenda items, present, absent/regrets, quorum, discussion, motions, decisions, action items, source document IDs, raw transcript/notes. |
| Filings | `/app/filings` | `filing` | Kind, period label, due date, filed date, submission method, submission checklist, confirmation number, fee paid, staged packet document, receipt/evidence document, evidence notes, status, notes. |
| Deadlines | `/app/deadlines` | `deadline` | Title, description, category, due date, recurrence, done status. |
| Insurance | `/app/insurance` | `insurancePolicy` | Kind, status, insurer, broker, policy number, coverage, premium, deductible, coverage summary, additional insureds, start, end, renewal, source external IDs, sensitivity, confidence, risk flags, notes. |
| Financials | `/app/financials`, `/app/finance-imports`, `/app/treasurer`, `/app/reconciliation` | `financialStatement`, `financialStatementImport`, `budgetSnapshot`, `treasurerReport`, `transactionCandidate` | Fiscal year, period dates, revenue, expenses, net assets, restricted funds, statement type, financial lines, budget lines, cash balance, highlights, concerns, transaction date/description/amount/debit/credit/balance/account/counterparty/category. Wave sync data is separate. |
| Grants | `/app/grants` | `grant` | Title, funder, program, status, requested/awarded amounts, restricted purpose, application due, submitted date, decision date, start/end, next report due, notes. The page has more fields than the import apply path currently fills. |
| Transparency | `/app/transparency` | `publication` | Publication title, category, document, external URL, published date, status, summary. Public slug/contact/feature settings are manual society fields. |
| Records inspections/archive | `/app/inspections`, `/app/records-archive` | `recordsLocation`, `archiveAccession`, `sourceEvidence` | Records location address, notice posted, computer provided for inspection, archive title, accession number, container type, location, custodian, date received, date range, access restrictions, evidence summary/excerpt. Inspection request records are manual/API only. |
| Governance registers | `/app/governance-registers`, `/app/directors` | `boardRoleAssignment`, `boardRoleChange`, `signingAuthority` | Person, role title, role group/type, effective/start/end dates, change type, previous person, institution, account label, authority type, status, confidence, notes. Legal director register fields are manual/API only. |
| PIPA training | `/app/pipa-training` | `pipaTraining` | Participant, email, role, topic, completed date, next due, trainer, source document, notes. |
| Employees | `/app/employees` | `employee` | First name, last name, email, role, type, start/end, annual salary, hourly wage, WorkSafeBC number, CPP/EI flags, notes. Current Paperless transposer skips payroll/T4/TD1/ROE sources for safety. |
| Volunteers | `/app/volunteers` | `volunteer` | First name, last name, email, phone, status, committee, role wanted, availability, interests, training status, orientation completed, applied date, renewal due, screening required, intake source, notes. Volunteer screening records are manual/API only. |
| Access custody | `/app/access-custody` | `secretVaultItem` | Record name, service, credential type, owner role, primary/backup custodian, emails, username, access URL, storage mode, external location, reveal policy, last/next review, status, sensitivity, notes. Secret values are not importable by AI. |

## Manual/API Writable Pages Not Natively Transposed

| Page | Route | Fields | Intake guidance |
|---|---|---|---|
| Society profile | `/app/society` | Registered office, mailing address, privacy officer, privacy officer email, board cadence, day, time, notes. | Can be filled from governing documents or annual reports, but no import bundle applies it today. Stage as `sourceEvidence` plus manual task. |
| Members | `/app/members` | First name, last name, email, phone, address, class, status, joined date, notes. | Manual/API only. Do not infer legal member register from arbitrary docs unless explicitly reviewed. |
| Directors | `/app/directors` | First name, last name, email, position, term start/end, status, BC residency, consent on file, notes. | Use `boardRoleAssignment` and `boardRoleChange` for evidence; promote to legal register manually after review. |
| Committees | `/app/committees`, `/app/committees/:id` | Name, mission, description, cadence, cadence notes, color, member name/email/role, linked director/member, committee tasks. | Manual/API only. Committee facts can be staged as org history evidence. |
| Conflicts of interest | `/app/conflicts` | Director, declared date, contract/matter, nature of interest, abstained, left room, notes. | Manual/API only. Motions/minutes can provide source evidence but the import pipeline does not create conflict records. |
| Communications | `/app/communications` | Templates, segments, member preferences, campaign fields. | Manual/API only. Do not transpose notices into campaigns without human approval. |
| Goals and tasks | `/app/goals`, `/app/goals/:id`, `/app/tasks` | Goal title/description/category/status/dates/owner; task title/description/status/priority/due/assignee/links. | Manual/API only. Use generated tasks for follow-up when a document has unsupported fields. |
| Agenda builder and motion library | `/app/agendas`, `/app/motion-library` | Agenda title/items, motion template title/body/category/notes. | Manual/API only. Imported motions go to minutes/evidence, not reusable templates. |
| Membership billing | `/app/membership` | Plan name, description, price, interval, class, benefits, active, signup name/email. | Manual/API only. Financial source docs should not create billing plans automatically. |
| Records inspections | `/app/inspections` | Inspector name, records requested, related document, date, delivery, fees, notes. | Manual/API only. Records-location and archive data are transposable; inspection request events are not. |
| Auditors | `/app/auditors` | Firm, engagement, fiscal year, appointed by/date, engagement letter. | Manual/API only. Financial statements can link source docs but do not create auditor appointments. |
| Member proposals and proxies | `/app/proposals`, `/app/proxies` | Proposal title/text/submitter/date/signatures; proxy meeting/grantor/holder/instructions/signed date. | Manual/API only. Motions/minutes may be supporting evidence. |
| Receipts | `/app/receipts` | Charity number, donor fields, amount, eligible amount, date, location, description, appraiser. | Manual/API only. Donation receipts are sensitive; do not transpose automatically today. |
| Court orders | `/app/court-orders` | Title, court, file number, order date, description, document, status. | Manual/API only. Use document/source evidence for legal review. |
| Written resolutions | `/app/written-resolutions` | Title, text, kind, required signatures, signatures, status. | Manual/API only. Source documents can become motion evidence, not final signatures. |
| Bylaw amendments and rules | `/app/bylaw-diff`, `/app/bylaw-rules`, `/app/bylaws-history` | Draft title, current/proposed bylaws, vote counts, filing status; notice/quorum/proxy/proposal/voting thresholds. | Manual/API only. Filing evidence and source documents can be imported; active bylaw rules require human interpretation. |
| Elections | `/app/elections`, `/app/elections/:id` | Election settings, questions, candidates, nominations, settings, results summary, evidence document. | Manual/API only. Do not infer ballots or votes from source docs. |
| Workflows | `/app/workflows`, `/app/workflows/:id` | Recipe, name, provider, trigger, cron, anchor, offset, PDF template. | Manual/API only. Document field auto-detection is marked as future work in UI. |
| Paperless settings | `/app/paperless` | Tag prefix, auto-create tags, auto-upload. | Configuration only, not document intake content. |
| Public volunteer application | `/public/:slug/volunteer-apply` | First name, last name, email, phone, role/area of interest, availability, interests, notes. | Public intake form, not document transposition. Admin volunteer records can be transposed to `volunteer`. |
| Public grant application | `/public/:slug/grant-apply` | Program, applicant, organization, email, phone, requested amount, project title/summary, use of funds, outcomes. | Public intake form, not document transposition. Admin grant records can be transposed to `grant`. |

## Read-Only Or Reporting Pages

These pages should not receive transposed document payloads directly: `/`, `/app`, `/login`, `/public`, `/portal`, `/app/minutes`, `/app/privacy`, `/app/timeline`, `/app/notifications`, `/app/audit`, `/app/exports`, `/app/retention`, `/app/workflow-runs`, `/app/settings`, `/app/meetings/:id/agm`, `/app/filings/prefill`.

For these pages, create review records in `/app/imports`, source evidence, or a manual follow-up task instead.

## Full Route Inventory

This is the one-by-one page pass. Routes with no writable fields are still listed so an intake agent can explain why a document cannot be transposed there.

| Route | Page | Intake status | Writable or relevant fields |
|---|---|---|---|
| `/` | Landing | Report/public only | No document intake fields. |
| `/login` | Login | Auth only | Name, email, password are auth fields, not document intake fields. |
| `/public`, `/public/:slug` | Public transparency | Public read-only | Published transparency data only. |
| `/public/:slug/volunteer-apply` | Volunteer application | Public intake form | First name, last name, email, phone, role/area of interest, availability, interests, notes. |
| `/public/:slug/grant-apply` | Grant application | Public intake form | Program/opportunity, applicant, organization, email, phone, requested amount, project title, summary, use of funds, outcomes. |
| `/portal` | Portal | Report/user portal | No document transposition fields found. |
| `/app` | Dashboard | Report only | Compliance flags and summaries only. |
| `/app/society` | Society profile | Manual/API only | Registered office, mailing address, privacy officer/name/email, board cadence, day, time, notes. |
| `/app/org-history` | Org history | Native import | Source, fact, event, board term, motion, and budget fields. |
| `/app/org-history/budgets/:budgetId` | Budget snapshot detail | Native import detail | Budget extraction/review fields; source pull action. |
| `/app/governance-registers` | Governance registers | Native import display | Board role assignments/changes, signing authorities, source evidence. |
| `/app/meeting-evidence` | Meeting evidence | Native import display | Meeting attendance and motion evidence. |
| `/app/finance-imports` | Finance imports | Native import display | Financial statement imports, budget snapshots, transactions. |
| `/app/records-archive` | Records archive | Native import display | Records locations, archive accessions, source evidence. |
| `/app/imports` | Import sessions | Native import hub | Session name, import JSON, review status, confidence, source IDs, review notes, payload JSON. |
| `/app/members` | Members | Manual/API only | First name, last name, email, phone, address, class, status, joined date, notes. |
| `/app/directors` | Directors | Manual/API only | First name, last name, email, position, BC resident, term start/end, consent on file, resigned date, status, notes. |
| `/app/meetings` | Meetings | Native import plus manual | Title, type, scheduled date/time, location, electronic, notice sent, quorum, status, agenda, notes. |
| `/app/meetings/:id` | Meeting detail | Native import plus manual | Agenda items, present, absent/regrets, raw transcript/notes, minutes payload. |
| `/app/minutes` | Minutes index | Report only | No direct fields; minutes are created from meetings/import sessions. |
| `/app/filings` | Filings | Native import | Kind, period, due date, notes, filed date, submission method, checklist, confirmation, fee, packet/evidence docs, evidence notes. |
| `/app/deadlines` | Deadlines | Native import | Title, description, category, due date, recurrence, done status. |
| `/app/documents` | Documents | Native import metadata plus upload | Title, category, file/version, committee, tags, retention years. |
| `/app/conflicts` | Conflicts | Manual/API only | Director, declared date, contract/matter, nature, abstained, left room, resolved date, notes. |
| `/app/financials` | Financials | Native import plus integrations | Budgets, financial statement totals, restricted funds, Wave connection/sync. |
| `/app/grants` | Grants | Native import partial | Title, funder, program, opportunity type, priority, fit, URL, next action, status, committee, requested/awarded amounts, restricted purpose, public description, instructions, dates, owner, account, notes, reports, transactions, requirements. |
| `/app/privacy` | Privacy | Report/checklist only | No direct document transposition fields. |
| `/app/communications` | Communications | Manual/API only | Template name/slug/kind/channel/audience/subject/body, segment filters, member preferences, campaign options. |
| `/app/committees` | Committees | Manual/API only | Name, mission, description, cadence, cadence notes, color. |
| `/app/committees/:id` | Committee detail | Manual/API only | Member/director link, name, email, role, linked tasks with title/description/status/priority/due/assignee. |
| `/app/volunteers` | Volunteers | Native import partial | Volunteer profile fields and screening profile fields; screening result documents remain manual. |
| `/app/goals` | Goals | Manual/API only | Title, description, category, status, start, target, committee, owner. |
| `/app/goals/:id` | Goal detail | Manual/API only | Goal update/toggle fields; no document transposition target. |
| `/app/tasks` | Tasks | Manual/API only | Title, description, status, priority, due, assignee, committee, goal. |
| `/app/timeline` | Timeline | Report only | No direct fields. |
| `/app/notifications` | Notifications | Report/action only | Mark read/send digest actions only. |
| `/app/users` | Users and roles | Admin only | Display name, email, role, status. Not document intake. |
| `/app/audit` | Audit log | Report only | No direct fields. |
| `/app/exports` | Data export | Export only | Format/search/export options only. |
| `/app/agendas` | Agenda builder | Manual/API only | Agenda and agenda item fields. |
| `/app/motion-library` | Motion library | Manual/API only | Title, motion text, category, notes. |
| `/app/treasurer` | Treasurer dashboard | Native import display | Treasurer reports and finance summaries; date filters only in UI. |
| `/app/membership` | Membership billing | Manual/API only | Plan name, description, price, interval, class, benefits, active, signup name/email. |
| `/app/inspections` | Records inspections | Manual/API only | Inspector, records requested, document, date, delivery, inspection/copy fees, notes. |
| `/app/attestations` | Qualification check | Manual/API only | Director qualification confirmations and optional notes. |
| `/app/retention` | Retention | Review/action only | Flag/archive document actions only. |
| `/app/insurance` | Insurance | Native import | Kind, insurer, broker, policy number, coverage, premium, deductible, dates, status, risk/confidence, notes. |
| `/app/access-custody` | Access custody | Native import reference only | Credential reference and custody metadata; never raw secret values. |
| `/app/secrets` | Secrets redirect | Redirect | Redirects to `/app/access-custody`. |
| `/app/pipa-training` | PIPA training | Native import | Participant, email, role, topic, completed, next due, trainer, document, notes. |
| `/app/proxies` | Proxies and ballots | Manual/API only | Meeting, grantor, proxy holder, instructions, signed date. |
| `/app/auditors` | Auditor appointments | Manual/API only | Firm, engagement, fiscal year, appointed by/date, engagement letter, independence, status, notes. |
| `/app/proposals` | Member proposals | Manual/API only | Title, text, submitter, submitted/received dates, signatures, threshold, eligible voters, agenda inclusion, status, notes. |
| `/app/receipts` | Donation receipts | Manual/API only | Charity number, receipt number, donor fields, amount, eligible amount, received/issued dates, location, description, non-cash/appraiser fields. |
| `/app/employees` | Employees | Native import partial | First/last name, email, role, type, start/end, salary/wage, WorkSafeBC, CPP/EI flags, notes. |
| `/app/court-orders` | Court orders | Manual/API only | Title, court, file number, order date, description, document, status, notes. |
| `/app/written-resolutions` | Written resolutions | Manual/API only | Title, resolution text, kind, circulated/completed dates, signatures, required count, status, notes. |
| `/app/meetings/:id/agm` | AGM workflow | Workflow action only | AGM steps and notice delivery actions; not a document target. |
| `/app/filings/prefill` | Filing pre-fill | Export/helper only | Provider, form, fiscal year. |
| `/app/bylaw-diff` | Bylaw amendments | Manual/API only | Title, current bylaws, proposed bylaws, vote counts, consultation/filed status, notes. |
| `/app/bylaw-rules` | Bylaw rules | Manual/API only | Notice windows, quorum, proxy, proposal, requisition, annual report, voting, inspection thresholds/settings. |
| `/app/bylaws-history` | Bylaws history | Report only | No direct fields. |
| `/app/elections` | Elections | Manual/API only | Title, description, open/close dates, nominations, scrutineers, ballot questions/options. |
| `/app/elections/:id` | Election detail | Manual/API only | Nominee, email, ballot question, statement, settings, results summary, evidence document. |
| `/app/reconciliation` | Bank reconciliation | Native import display plus manual matching | Transaction candidates are imported; matching/unmatching is manual. |
| `/app/transparency` | Public transparency | Native import via publication plus manual settings | Public slug, summary, contact email, publication title/category/document/URL/date/status/summary. |
| `/app/paperless` | Paperless-ngx | Configuration only | Auto-create tags, auto-upload, tag prefix, connection test. |
| `/app/workflows` | Workflows | Manual/API only | Recipe, name, provider, trigger, cron, anchor, days before. |
| `/app/workflows/:id` | Workflow detail | Manual/API only | Workflow node config, PDF template. PDF field auto-detection is future work. |
| `/app/workflow-runs` | Workflow runs | Report only | No direct fields. |
| `/app/settings` | Settings | Configuration only | Demo mode and module toggles. |

## Current Paperless Heuristics

The built-in Paperless transposer looks for these source signals:

- filings: Society Act, registrar, BC Registry, annual report, Form 10, constitution, bylaws, special resolution, dissolution;
- deadlines: deadline, due date, renewal, expiry, filing deadline, publication days;
- insurance: insurance, liability, policy number, certificate, coverage, premium, insurer, broker;
- financials: income statement, balance sheet, financial report, trial balance;
- grants: grant, funding, proposal, subsidy, Canada Summer Jobs, club funding;
- records/archive: records location, key control, archives, archival agreement, inspection, custody, accession;
- governance roles: board, director, officer, president, secretary, treasurer, chair, elected, appointed, resigned, removed;
- signing authority: authorized signer, bank signing, cheque signing, online banking;
- minutes evidence: meeting minutes, AGM, present, regrets, quorum, motion, moved by, seconded by, carried;
- privacy/HR/volunteer: PIPA, CASL, employment contract, WorkSafeBC, volunteer, orientation, screening.

Payroll, T4, TD1, ROE, raw banking, screening result, credential, and similar restricted documents should remain restricted and require manual review.
