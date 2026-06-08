<!--
Thanks for contributing to Societyer! Keep PRs focused — one logical change per PR is
much easier to review and land than a sweeping one.
-->

## What & why

<!-- What does this change, and what problem does it solve? Link any issue: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Jurisdiction / entity-type rule pack or data
- [ ] Refactor / tooling / docs
- [ ] Other:

## Checklist

- [ ] I kept the change focused (one logical change).
- [ ] No real corporate or personal data is included in code, tests, or fixtures.
- [ ] Relevant verification gates pass locally (see below).

## Verification

<!-- Paste the output (or name the scripts you ran). Run the ones relevant to your change. -->

```
# App + Convex typecheck
npx tsc -b
npx tsc -p convex/tsconfig.json --noEmit

# If you touched compliance rule packs / obligations:
npm run test:compliance-rules

# If you touched jurisdiction modules / workspace config:
npm run test:jurisdiction-modules

# If you touched org/domain or director logic:
npm run test:organization-domain
```

## For jurisdiction / rule-pack changes

- [ ] Every non-deprecated rule declares `appliesTo` and cites at least one `sourceId`.
- [ ] Each `source` has a real, dated URL (statute / regulation / government guidance / form).
- [ ] Statutory citations were checked against the **current** Act — not a stale copy.
- [ ] If the jurisdiction supports extra-provincial registration, the module covers both the `home` and `extra_provincial` paths (or the gap is called out).

## Notes for reviewers

<!-- Anything you're unsure about, deliberate trade-offs, follow-ups, screenshots. -->
