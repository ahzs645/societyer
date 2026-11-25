# Implementation and verification

## Records and review

The hosted Convex functions and the local runtime share the insurance handlers. Policy terms remain in `insurancePolicies`. Line IDs identify a coverage within a term. Renewals retain the policy series key. Archiving records the actor and time and excludes that term from current comparisons.

Contractual requirements live in `insuranceClauseChecks`. The workspace and originating opportunity key or agreement ID identify the checks. Earlier assessments saved on a policy remain in its history. A new agreement can therefore record a gap before the organization has entered a policy.

The clause checker compares coverage type, currency, limit basis, entity, period and amount. The confirmation records the revision, policy line, document version, citation, wording and reviewer. It rechecks the policy and the current version when showing a saved result. Documents are subject to workspace and document access checks. Hosted AI uses the configured provider. Local labeling uses the configured device provider on request and supports manual review.

[Policy and clause operations](../../shared/functions/insuranceClauses.ts) · [Comparison and source rules](../../shared/insuranceClauses.ts) · [Portable function inventory](../portable-functions-architecture.md)

## Desktop and phone acceptance cases

| Area | Verification |
| --- | --- |
| Renewal import | Use the file chooser, enter CAD, review a declaration and invoice, return to the same document, then confirm two policy terms and three originals in the fictional package. |
| Register and history | Check multiple limits under one policy, keep premium on its term, open the archived term from its series and start the next term in review. |
| Bid and rental | Use the same register for a per-occurrence shortfall, an award certificate, a missing professional-liability line and a rental with an eligible declaration. |
| Prior review pointing to an invoice | A saved confirmation using unsuitable proof requires another evidence review. The reviewer can reopen the original and choose evidence for the applicable line. |
| User-initiated labeling | Opening the checks does not call a provider. A provider response supplies draft clauses. The reviewer selects the clauses to save. Tests use simulated responses. |
| Navigation | The upload starts compactly and each file has its own Review action. Returning to the file list restores focus. The insurance requirement cards expose their policy comparisons on demand. |

## Run the checks

From the repository root, install the dependencies and Playwright Chromium. Run the insurance domain checks, manifest check and desktop/phone browser test.

```sh
npm ci
npx playwright install chromium
npm run test:insurance-history
npm run test:insurance-clauses
node scripts/portable-manifest.mjs --check
npx playwright test -c playwright.interface.config.ts interface-insurance-renewal.spec.ts --project=desktop --project=phone
```

The browser test creates a fresh local workspace and uses the public example files. It imports the originals through the interface, saves fixture obligations through workspace mutations, and opens the procurement reader and agreement detail. The opportunity uses a fictional catalog entry. The test writes desktop and phone PNGs to the Playwright output directory.

## Open workflow items from the interface audit

The UI identifies an evidence gap and records when evidence is due. The following work would complete the broader submission workflow.

- Create a broker request from a missing certificate or endorsement and track its owner, due date and response.
- Reconcile the catalog’s published assessment with the organization's evidence check when they disagree.
- Offer a rental’s linked agreement documents directly in the clause source picker. The current picker can use the agreement summary, a pasted excerpt or an uploaded copy.
- Link a policy line back to its dependent opportunities and agreements. Restore clause context when the reviewer returns from a linked record.
- Export approved originals and a clause matrix for a selected recipient. Preserve the exact versions and approval and record delivery as a separate action.

[Walkthrough](walkthrough.md) · [Field guide](fields.md)

## Follow-up work from the release plan

For a broader rollout, compare policy counts, premiums grouped by currency and renewal links before and after any workspace migration. Backfill coverage codes only where the source supports an unambiguous mapping. Retain broader legacy labels and their source text.

Additional document types proposed for extraction include endorsements, cancellation notices and quotations. Evaluate them against reviewed, redacted examples, including Canadian and ACORD documents. A later extension could use versioned CSIO and ACORD code mappings while preserving the wording on each historical term.

Term history and cost comparisons are available in the register. Proposed extensions include a board renewal review and broker questionnaires populated from organization, payroll and asset records. Those activities require different document access from a procurement submission.
