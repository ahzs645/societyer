# Governing-document and privacy-policy evidence

Last reviewed: 2026-11-21

The dashboard used to ask "Is the constitution uploaded?" and "Is a privacy
policy linked?". A missing link only means Societyer doesn't have the document
identified; the organization may well keep it in the registry, a records binder
or another system. These checks now ask:

- **Current constitution (bylaws) identified and required records accounted
  for?** Satisfied by an uploaded copy *or* a recorded location held elsewhere.
- **Is the identified copy current?** A separate attestation by a named person.
- **Where is the privacy policy maintained, and has someone reviewed the
  policies and practices?** An evidence location plus a review attestation.

Code: `shared/governingDocumentEvidence.ts` (model and helpers),
`shared/functions/governingDocumentEvidence.ts` (mutations),
`shared/dashboardComplianceRules.ts` (rules),
`src/features/governingDocuments/EvidenceDialogs.tsx` (forms). Gate:
`npm run test:governing-document-evidence` and
`npm run test:dashboard-compliance`.

## Data (on the `societies` row, all optional)

| Field | Shape |
| --- | --- |
| `constitutionDocId`, `bylawsDocId`, `privacyPolicyDocId` | Unchanged: the uploaded document link. |
| `governingDocumentEvidence[]` | One entry per field when the authoritative copy is held elsewhere: `kind` (`external` system reference or `physical` records location), `reference` (URL, system reference or location), `custodian`, `version`, `effectiveDate`, `recordedAtISO`, `recordedByUserId`, `recordedByName`. |
| `governingDocumentVerifications[]` | One per field: `verifiedAsOf` (date), `versionReference` (version or filing reference), `notes`, who and when, and the copy it verified (`evidenceKind` + `documentId` or the held-elsewhere entry's `recordedAtISO`). |
| `privacyProgramReview` | The latest review attestation: `policiesReviewed`, `versionOrEffectiveDate`, `maintainedAt`, `unresolvedFindings`, `findingsBlocking` (stored with findings: `false` when the reviewer judged them minor follow-ups; absent on older reviews, which count as blocking), `reviewedOn`, `reviewedAtISO`, reviewer id and name. Earlier reviews stay in the activity log. |

An uploaded link wins over a held-elsewhere entry when both exist. A
verification applies only to the copy it was made for: replacing the document
or the held-elsewhere reference leaves the new copy unverified.

## Mutations (portable; `society:write`)

- `society:setGoverningDocumentEvidence({ societyId, field, evidence | null })`
  records or clears where the copy is held. Only fields the organization keeps
  (a BC company has articles only; every organization may keep a privacy policy).
- `society:verifyGoverningDocumentCurrent({ societyId, field, verifiedAsOf, versionReference?, notes? })`
  needs an identified copy first. It never links or uploads anything.
- `society:recordPrivacyReview({ societyId, policiesReviewed, reviewedOn, versionOrEffectiveDate?, maintainedAt?, unresolvedFindings?, findingsBlocking? })`
  sets `privacyProgramStatus` to `Documented` only when a policy location is
  recorded (in the review, or as an uploaded / held-elsewhere policy) and there
  are no blocking findings; otherwise `Needs review`. Findings block unless
  `findingsBlocking: false` (the form's "These are minor follow-ups — the
  program is in place", unchecked by default).
- `dashboardRemediation:markPrivacyProgramReviewed` is retired. The route stays
  registered so a client loaded before the change gets a clear "Reload and use
  Record review" error; it writes nothing.

Each writes an activity row attributed to the signed-in person.

## Rules

| Rule | Gap (`warn`) | Note (`info`) | Clear |
| --- | --- | --- | --- |
| `BC-SOC-CONSTITUTION-EVIDENCE`, `BC-SOC-BYLAWS-EVIDENCE` | "Current constitution not yet identified in Societyer…" (nothing uploaded or recorded) | "Constitution on record — currentness not verified." | Identified and verified current |
| `PIPA-POLICY-EVIDENCE` | Societyer doesn't have the policy's location identified | — | Uploaded or held elsewhere |
| `PIPA-POLICY-DOCUMENTED` | No review and not documented; the review left blocking findings (shown in the text, with "Reviewed by … · date"); the review recorded no location; status changed since the review | Marked documented without a review attestation (legacy data or the privacy page's status field); documented with minor follow-ups ("Privacy program is documented, with follow-ups from the review (…): …") | Review with a location, no findings, status Documented |
| `LEGAL-<profile>-GOVERNING-DOCUMENTS` (corporations) | Neither articles nor by-laws identified | — | Either uploaded or held elsewhere |
| `PRIVACY-<law>-POLICY` (non-BC privacy laws) | Policy location not identified, or program not settled | — | Identified and documented with no blocking findings |

Why the currentness check is `info`: once the authoritative copy is accounted
for, the records requirement the rule tracks is met; whether that copy is the
latest consolidation is a review note. Making it `warn` would turn every
workspace with uploaded documents amber without a new legal gap. There is no
"not applicable" path for a BC society's constitution or bylaws; correcting the
organization's legal profile is the way to change which rules apply
(`shared/entityRuleScope.ts`).

Dismissing (`shared/dashboardFindingPolicy.ts`): the constitution and bylaws
rules are statutory at `warn` (no copy identified), so that gap can only be
acknowledged, assigned or snoozed. At `info` the currentness note is a
recommendation and can be dismissed. The dismissal is tied to the copy on
record: the document id, or the held-elsewhere entry's reference and when it
was recorded. Uploading a replacement or recording a different external copy
brings the note back. `PIPA-POLICY-DOCUMENTED` at `info` (marked documented
with no review) stays statutory: its action is **Record review**, with
Acknowledge and Assign follow-up in the menu.

## Interface

- Organization profile, Documents tab (`/app/society?tab=documents`): each
  governing document has **Held elsewhere** (or **Where it's held** once
  recorded) and **Verify current**; the privacy policy row has **Held
  elsewhere** and **Record review**, and shows "Reviewed by … · date" and any
  findings: "Unresolved findings: …" when they block, "Follow-ups: …" when the
  reviewer marked them minor.
- Dashboard actions open those forms with
  `/app/society?tab=documents&record=held-elsewhere|verify|privacy-review&field=<field>#governing-documents`
  (`governingEvidenceHref`).
- Privacy page: **Record review** on "Adopt the policy and complaint process",
  which now shows the attestation instead of "marked documented".
