# Federal incorporation and BC registration preparation

The federal business-corporation pathway includes a detailed preparation inventory for CBCA incorporation and, conditionally, BC extra-provincial registration. It supports founders preparing an ordinary private company. It is not a government application, legal-readiness validator or filing service.

## Where it appears

- Organization profile (`/app/society`), below the existing incorporation overview.
- The incorporation filing step in guided setup (`/app/organization-setup`).
- The downloadable incorporation-preparation worksheet in Document catalog (`/app/document-catalog`).

The existing pathway resolver determines eligibility. A federal CBCA home entity with a BC office remains federal. BC home companies, societies, federal nonprofits, Ontario corporations and inconsistent profiles do not receive this pack. BC registration instructions are expressly conditional on carrying on business in BC.

## Shared content

`shared/federalBcIncorporation.ts` owns the source catalog, review date, sequence, rules and field inventory. The component and worksheet read the same data. Each field identifies whether it is required at its stage, conditional, a founder decision or recommended; its intended information audience; and the relevant official sources.

The inventory covers names, articles, incorporators, office/directors, paid share issuance, significant control, federal filing evidence, BC Form 33 and BN supplement, corporate organization, founder/IP decisions, operational registrations and maintenance. It distinguishes authorized shares from issued ownership and actual certificates from planned/submitted filings.

Source review for this pack: **2026-11-07**. This date does not reverify other pathway guides. Official online screens can request additional administrative information, and current fees/filing instructions must be checked at submission.

## Privacy and evidence boundaries

The guide is static: it adds no personal-data collection, database columns, filing submission or readiness score. Worksheet generation uses the working company name and existing pathway metadata, then blank prompts. It does not serialize role-holder records, dates of birth, residential addresses, tax accounts, notes or portal credentials. Both restricted and mixed fields use restricted-record references.

Audience labels describe how information is used, not permissions enforced by this feature. The existing significant-control register's read permissions can include Director and Viewer roles, and masking a date of birth in the UI is not server-side redaction. Review access before storing private answers. Keep private questionnaires and identity documents out of public repositories and generic document packets.

Existing setup completion signals are presence indicators, not legal verification. A NUANS reference does not prove name approval, and one director/class/controller record does not establish complete formation data. This change explains those limits; it does not replace the existing evaluators or certify an application.

## Key distinctions retained

- A word name uses the custom federal incorporation flow. Direct online incorporation includes name assessment; registered-intermediary and other filing routes may require a separate NUANS report.
- Resident-Canadian director qualification uses the CBCA definition. Three founders do not automatically create a three-person board.
- Equal thirds in ordinary voting/economic shares normally means all three holders are ISCs. Citizenship and tax residence support multiple countries.
- The internal ISC update deadline and the federal filing deadline have separate anchors.
- A federal corporation registering under its corporate name skips BC name reservation. The BC head-office definition includes a federal registered office, relevant to whether a BC attorney is required.
- Federal annual returns, BC annual reports, annual shareholder actions and CRA tax returns are separate duties.
- The planned October 2026 BC professional-services PST expansion is paused according to the current official notice; older body text and search snippets must not override its update banner. Existing software/PST rules require separate analysis.

## Verification

Run the focused suite with:

```sh
npm run test:federal-bc-incorporation
```

It checks pathway isolation, collapsed rendering, complete source-linked export, uniqueness/reference integrity, exclusion of synthetic private values and federal-versus-Ontario ISC wording. Existing preparation/evidence regression can also be run with:

```sh
node --import tsx scripts/check-incorporation-preparation.ts
```

Keep substantive legal review separate from these software checks. Tests establish rendering/export behavior, not the legal adequacy of a founder's completed application.
