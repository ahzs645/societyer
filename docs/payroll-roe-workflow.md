# Guided Record of Employment workflow

The payroll calculator's **ROE workflow** view (`/app/payroll/calculator?tab=roe`) uses the existing official-schema ROE XML exporter. It records an internal case and the existing `recordsOfEmployment` register together. It does not transmit a file, access ROE Web, contact an employee or issue an ROE on the employer's behalf.

## Work through a case

1. Select an employee and start a case, or link the employee's existing register record. Enter the actual employment/interruption facts, pay-period dates, frequency, delivery format and source evidence. A required case creates the same pending ROE register obligation used by the register; a reviewed non-required case creates no false issuance obligation.
2. Review all saved readiness checks: insurability, dates/reason, consecutive earnings and hours, vacation/holidays/other monies, identifiers, authorized filing access and employee access instructions. Exceptions and unknown request instructions remain blocked for review. Changing facts or recording an actual rejection clears the current generated-file pointer and readiness checks while retaining audit history.
3. For an electronic case, open the existing XML form. The case's employee, first/last paid dates, final pay-period end, frequency, reason and amendment serial are locked to its reviewed facts. Complete the actual earnings/hours history and separation blocks. Enter SIN and payroll account transiently in that form. A successful local download stores only a SHA-256 hash, byte count, filename, schema version and case fingerprint. It remains **generated**, and the register remains **to issue**.
4. Use the authorized official channel outside Societyer. Record an actual submission attempt and response reference; this remains distinct from issuance. A rejected submission can be reopened with actual rejection evidence. Record the actual successful serial/date and acknowledgment only when the official action is complete. This updates the same register to **issued** and completes its linked main deadline.
5. Resolve employee access, acceptance and unanswered/missing-information follow-ups with due dates, evidence and open/blocked/done/reviewed-not-applicable status. These create generic, non-sensitive linked deadline reminders. Protected case notes and employee names are not copied into those reminders. Operational closure requires actual issuance and resolved operational follow-ups; a future retention review remains tracked.
6. Correct an issued ROE using a **linked full amendment**. The original register remains issued; the amendment gets its own pending register obligation and must use the actual original serial. An issued ROE cannot be cancelled. A missing original serial must be obtained from the official source, never invented. Historical register records can be adopted without issuing another ROE; employee access and acknowledgment review are not assumed. Missing actual serial/date can be recorded from the original source with a date-only source when its time is unknown; the review itself has its own audit timestamp.

## Official channel and employee instructions

- [ROE Web](https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/ei-roe.html) links to sign-in/registration and user requirements. The organization's authorized Primary Officer validates their identity, accepts the agreement and grants representatives appropriate access. Use the actual account and authorized employer/provider relationship.
- Upload the XML extract, review the official validation response and retain the successful acknowledgment/actual serial. A local XML download, an upload attempt or a passed XSD check does not prove Service Canada acceptance.
- For paper, obtain official pre-numbered paper forms. Give Part 1 to the employee, send Part 2 to Service Canada, PO Box 9000, Bathurst NB E2A 4T3, and retain Part 3 securely. A printed XML or app PDF is not an issued paper ROE. Other correspondence goes to the appropriate Service Canada centre.
- Employees obtain electronic ROEs through [My Service Canada Account](https://www.canada.ca/en/employment-social-development/services/my-account.html); they do not send a duplicate paper copy to Service Canada. A courtesy copy may be provided on request. Employees should apply for EI promptly even if an ROE is still outstanding. Service Canada determines EI eligibility.
- For a paper ROE amended electronically, Block 2 contains the actual original paper serial and Block 18 must include **Amending a paper ROE** plus that serial. For an ROE issued in error, follow the guide's **Previous ROE issued in error** instruction. No new/corrected information means no amendment is needed.

## Rules and dates

Rules are versioned as `service-canada-roe-guide-2026-10-23` from the [official Service Canada guide](https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/reports/roe-guide.html). The source review is documented in `docs/payroll-operations-sources.md`.

| Condition | Treatment |
| --- | --- |
| Ordinary interruption | Seven actual or anticipated consecutive calendar days without work and insurable earnings; interruption day is the last day for which paid. |
| Listed illness, pregnancy, parental and family-care circumstances | Weekly salary strictly below 60% of normal weekly salary; Sunday of the first qualifying week is the interruption date. Exactly 60% is not below 60%. |
| Part-time/on-call/casual | Review the employee-request/interruption condition, removal from the active list, Service Canada request or 30-day condition; not every seven-day gap automatically requires an ROE. |
| WLI begins | Review the actual WLI interruption, insurability and whether a later second ROE is required. |
| Regular annual business vacation, self-funded leave, nonstandard schedules | Visible specific review; the engine does not automatically declare an exception or issue/no-issue conclusion. |
| Electronic weekly/biweekly/semimonthly | Five calendar days after the end of the pay period containing the interruption. |
| Electronic monthly/13 periods | Earlier of period end +5 calendar days and interruption +15 calendar days. |
| Official paper | Five calendar days after interruption or employer awareness, using the later applicable awareness date. |
| Service Canada request | Record and verify the actual request target/instructions. Without that review, ordinary timing is explicitly an estimate and cannot make the case filing-ready. |
| Amendment | Reviewed action target, with instruction to amend as soon as the correction is known; no invented fixed statutory amendment period. |

Calendar deadlines do not automatically roll past weekends. Electronic deadlines receive no invented late-awareness extension. The pay date is not substituted for the pay-period end. Retention reminders use the end of the sixth year after the year to which the related payroll/ROE information pertains; they do not delete records automatically.

## Access, integrity and limits

Reads require `financials:read` and `employees:read`. Writes require `financials:write` and `employees:read`; the backend derives the actor from the authenticated principal. Employee, parent-case, register and deadline references are scoped to the organization. Issued facts cannot be edited/cancelled in place, original and amendment serials cannot collide, and expected versions reject stale changes.

Cases contain no SIN, payroll account or XML body. Structured cleaners discard caller-provided extra fields, and protected free-text fields reject ordinary SIN-shaped identifiers. The existing XML form keeps identifiers in memory and the user-requested downloaded file only. Workflow CSV includes source case/status/deadline/follow-up information and quotes cells safely; it excludes filing identifiers and XML contents.

Each workspace invocation uses one indexed native page with four records and a bounded byte read. The UI subscribes to every cursor page and enables complete CSV only after all pages load. Each case has an explicit 100-event / 48 KB audit limit; reaching it raises an error instead of dropping history. Main and follow-up deadline source keys are maintained by the workflow. Generic deadline edit/status/delete paths must reject those keys, including the generic record metadata editor; users follow the managed workflow link instead.

## Validation

- `npm run test:payroll-roe-workflow`: official date/threshold cases, both portable runtimes, readiness and rejection audit, generated/submitted/issued separation, original register/deadline coherence, historical adoption, amendment ownership/serial uniqueness, complete pagination, privacy and permission checks; managed generic deadline mutation rejection and ordinary reminder edits.
- `npm run test:payroll-roe-workflow-ui`: actual persisted browser workflow with a real XML download validated against the bundled official `PayrollExtractXmlV2.xsd`, transient identifier non-persistence, manual acknowledgment, blocked/nonresponse/access follow-ups, closure, amendment, CSV and read-only actor checks; managed deadline grid/board paths.
- `npm run test:payroll-reporting`: existing statement and CRA/ROE formatter regressions plus electronic amendment of an actual original paper serial and its required Block 18 content.
