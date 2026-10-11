# Retest: governance

This retest went through end-to-end user tasks in the governance area on three
data sets: the restored PGAIR workspace, a fresh BC society, and the demo
workspace. It fixed what blocked those tasks. It adds no schema changes and
no new Convex functions.

## Decisions

- **Quorum entry (A3, completed in the interface).**
  - A committee's own quorum rule is set on its "Body, cadence and mandate"
    card and saved through the existing `committees.update`
    (`quorumRule`/`clearQuorumRule`).
  - The board rule and the default rule for committees are set on Bylaw rules
    under "Quorum by body". They are stored in `bylawRuleSets.bodyQuorumRules`
    and carried over to every new version.
  - Rows for a specific committee or for general meetings (for example from
    an import) are kept and listed read-only.
  - Shared helpers live in `shared/bodyQuorum.ts`: `describeQuorumRule`,
    `quorumRuleProblems` and `cleanQuorumRule`.
- **Committee cadence is tracked.** A committee with a recurring structured
  cadence is an implicit meeting expectation, keyed `committee:<id>`.
  - It runs from the first mandate version, or else the first meeting.
  - It ends at the end of the last mandate version when every version has
    ended.
  - It stops when a stored expectation for that committee exists. An archived
    stored row switches it off.
  - Ad hoc and continuous cadences are not tracked.
- **Period marks follow their expectation.**
  - "Store rule pack" moves marks keyed by a rule key to the new stored row.
  - The evaluation also falls back to the rule key or implicit key, for
    workspaces seeded before this change.
- **Month-only minutes references.** "minutes of November 2018" refers to a
  month. It is satisfied by any meeting with minutes in that month, and it
  never becomes November 20 with an inferred year.
- **Local calendar day.** "Today" in continuity, in the dashboard's
  overdue/upcoming filings, and in the annual cycle, timeline and obligations
  pages is the local calendar day (`todayDateOnly`/`calendarDateKey`). A
  filing due today is not overdue.
- **Bylaw rule versions.**
  - Versions are ordered by effective day, then by version number.
  - A "Baseline" row (the jurisdiction's draft defaults from "Reset to
    defaults") never makes a new version "backdated".
- **Held meetings.** A new meeting dated before today records one already
  held. It skips the notice-minimum check and is saved as Held.
- **Obligations.** A review-only obligation that someone reviewed shows as
  "Reviewed" and leaves the overdue count. Filing obligations stay open until
  they are filed.

## Gates

- `npm run test:governance-quorum`
- `npm run test:governance-timezone`
- `npm run test:continuity` (extended)
- `npm run test:people-identity` (extended)
- Browser: `npm run test:governance-retest-ui`

Findings, including the open items for other areas, are in the retest
findings file (`findings/retest-governance.md` in the session scratchpad).
