# Historical actions, quorum observations and source versions

Open a meeting, choose **Minutes**, and scroll to **Meeting history**. This panel is separate from the legacy action checkboxes and the current task register, because historical evidence does not establish today's task status.

## Historical actions

Each `historicalActions` row is an observation in one meeting. It has its own stable `entryId`, a reviewed `actionKey`, optional source action number/assigned date/owner/due date, and explicit status: unknown, open, in progress, ongoing, on hold, completed or cancelled. `statusAsOf` is the date supported by the source. Original status wording, locators and source references remain alongside the interpretation.

The panel filters observations by status or text and shows other meetings' observations with the same action identity. A newly generated identity does not establish a link to another action. Imported cross-meeting identities require corroborating committee scope, original number, assigned date and source content; ambiguous cases retain independent identities and review notes.

**Carry an action forward** selects a prior minutes record and observation. The mutation copies the verified identity and source context into a new observation; its status becomes unknown and its as-of date is unset for review. It never changes the source minutes. Repeating the same carry into the same target is idempotent. The operation requires minutes read/write permission and access to linked source documents. The server rejects foreign-organization links, missing source entries, conflicting identities, cycles, backward chronological links with known dates, and approved target minutes.

The register is stored as observations within native minutes, not as a second set of current operational tasks. Cross-meeting history is derived from these records. No historical status automatically updates a task checkbox.

## Quorum timeline

`quorumEvents` records source-ordered observations with `confirmed`/`not_met`/`not_recorded` status (displayed as met/not met/not recorded), time as recorded, scope (meeting, session or agenda item), scope label, optional eligible/present counts and supporting evidence. Zero counts remain zero. Session/item observations need a scope label; missing times remain missing. The interface can reorder observations without inventing timestamps.

These events do not overwrite the existing scalar quorum field or establish legal validity. A statement at the AGM opening need not apply to a later Board session. A recorded quorum event is not a reconstructed voting-eligibility calculation.

## Source versions

`sourceVersions` records draft, revised, adopted or unknown source variants. Every version has a stable identity and source references. It may link to a preceding version through `supersedesVersionId`; missing targets and cycles are rejected. Source dates describe evidenced document/revision dates rather than guessed meeting dates.

Mark a version adopted only with a recorded adoption date and evidence. The API can also accept a validated carried adoption motion targeting these minutes. An adopting-meeting link alone is insufficient. Provided native links must belong to the organization and agree with each other. An APPROVED filename is not adoption evidence.

An optional `contentJson` captures version content or a clearly labelled excerpt/structural preview. The interface presents it as readable content, not a raw JSON editor. Imported previews are not necessarily full documents; preserve the originals. Once a version is saved as adopted, its row and captured content cannot be edited or removed—even if the minutes are reopened. Append a revised version instead. Source-version adoption does not automatically approve the import candidate or stamp the whole minutes record approved.

## Persistence and compatibility

The three arrays are optional additions to the existing minutes table, so older rows require no migration. They pass through both hosted Convex and portable local APIs, import normalization, actual native promotion, backup and restore. Import merge appends distinct observation identities; contradictory reuse of an identity stops promotion rather than overwriting history. Unrelated edits and AI draft updates preserve unspecified history.

Approved minutes freeze recorded content, including these arrays. The existing explicit reopen-approval workflow permits subsequent history changes, except immutable adopted source versions. All six minutes render styles show history in internal exports, including complete-source recreation. Public/redacted exports omit these arrays because their source evidence and affiliations have not been reviewed for public release.

Older clients do not offer the editor and may omit these fields from exports. Use the updated app; do not round-trip the new data through an older schema deployment.

## Checks

```sh
npm run test:meeting-history
npm run test:meeting-intake-fidelity
npm run test:intake-pipeline
npx tsc --noEmit -p tsconfig.json
npm run convex:typecheck
npm run test:meeting-history-ui
```

The first checks cover strict values, actual hosted Convex validators and local mutation behavior, ownership, cycles, source preservation, immutable adoption, restore, native import/merge, all six render styles and public-copy suppression. `test:meeting-history-ui` is a dedicated Playwright local-IndexedDB flow for forms, save/reload, carry-forward and revisions. It requires Chromium and a runtime that permits its sockets. In the authoring environment Chromium launch was blocked by an OS socket restriction, so that browser gate was not verified; do not report it as passing.

The original calendar-date/noon-UTC placeholder behavior, person/proxy identity resolution and attachment-byte restoration are separate remaining limitations. Do not mistake this module for those fixes.
