# Guided organization setup

The web app and local desktop renderer use the same organization setup at `/app/society/new`. A hosted account without an existing membership can create its first workspace through the verified-account creation gate; the verified creator becomes the initial Owner. A local device uses its existing trusted workspace boundary.

The guided flow asks whether the operator has used Societyer before, offers backup restore, distinguishes an existing organization from incorporation preparation, and requires an explicit choice of actual or planned governing Act. These choices come from the central pathway registry. BC societies, BC business companies and federal CBCA companies have existing preparation guides. Ontario's OBCA preparation remains marked for review. Other existing organizations can record manual legal details without gaining unsupported preparation guidance.

The profile collects a legal or working name, existing incorporation number/date where known, official email, fiscal year end, registered office and mailing addresses. The governance questions distinguish society membership classes and voting rights from company share classes and shareholder records, ask about existing documents, people to add, purposes, operating regions and the records/privacy contact. Optional information can be gathered later.

An existing organization starts with incorporation evidence pending. A new preparation workspace has `formationStatus=preparing`, `organizationStatus=pre_incorporation` and a pending home registration. Setup cannot create a verified certificate. The workspace's formation state reflects the supplied evidence status, rather than inferring incorporation from its active/archive status.

Bounded, versioned initial answers are validated through the same shared code in the native and local creation paths, stored on the organization and onboarding workflow, and included in the people/governance task descriptions. They describe plans or records to review. They do not fabricate members, directors, issued securities or access grants.

The onboarding workflow opens a concrete setup checklist linking to the profile, locations, documents, the appropriate society or company registers, workspace access, formation/filing pathway and tasks. These links work without launching a workflow runner. Original workflow canvas controls remain available below. Official filing channels and preparation requirements are linked from the preparation guide; external registry submission and later certificate verification are separate actions.

## Backup restore

JSON backup restore is restricted to local storage and never uploads arbitrary identity or tenant records into a hosted workspace. The hosted wizard links to local setup explicitly. Before replacement, the operator sees the organization names, record count and attachment-reference count, then confirms replacing device records. The existing importer strips imported hosted authentication bindings and quarantines imported pathway executions.

Setup rejects malformed tables, duplicate record IDs, empty organization snapshots, invalid attachment references, unsupported snapshot kinds, files larger than 100 MB, more than 200,000 records, and more than 50,000 attachment references. These bounds protect interactive device setup. Larger migrations require separate administrator tools.

A JSON snapshot carries records and attachment references, including inline content where present. It does not copy external or desktop filesystem bytes. Restoring physical desktop files requires the corresponding file backup or native archive. The confirmation and upload instructions state this distinction.

## Verification

`npx tsx scripts/check-guided-onboarding.ts` checks persisted initial values, legal evidence boundaries, malformed/oversized answers, real fiscal/date validation, invalid-create atomicity, restore validation and snapshot round trips. `npm run test:create-workspace-onboarding` retains the existing jurisdiction-specific onboarding checks.

`npx playwright test -c playwright.guided-setup.config.ts --workers=1` exercises public UI creation and second-device restore at 320, 390, 768 and 1440 pixels. The suite inspects real stored records after creation and reload, checks separate society/company destinations, and verifies invalid backups never reach destructive confirmation. Hosted first-account creation and packaged desktop mode switching are separate runtime qualifications; browser-local tests do not establish either of those by themselves.

The final qualification passed 16 distinct browser cases: 12 organization/create/location/formation/real-export-and-restore cases, plus four focused malformed-backup preservation cases after that fixture was strengthened to retain a real nonempty workspace. The sanitized result is `artifacts/interface/guided-organization-setup.json`. Tests read persisted IndexedDB directly without constructing another data-client instance; restore uses bytes downloaded through the actual Settings backup button.

This work also fixed a shared address-entry defect: entering a street number before a street name discarded the number. The structured text editor now retains partially entered fields, and its street parser recognizes number-only fragments. The creation tests preserve the number in actual stored addresses and exercise the generic organization-location drawer with country-first input. `npx tsx scripts/check-structured-address.ts` additionally verifies partial numbers, street ranges, clearing and serialization.

The shared address text codec preserves empty positional slots: a country without a street/city, a province or postal code without a city, or a unit without a street does not move into another field after reload. Native creation keeps these positions. Guided records seed structured location rows through the same codec; missing details remain marked for review. Older free-text address backfills retain their original review behavior. Structured rows remain authoritative after creation, and profile saves retain the guided codec in their text mirror while displaying readable summaries. The address check includes real native Convex handlers under a verified creator, its resulting Owner binding, sparse-field row seeding, and unchanged legacy backfill behavior.
