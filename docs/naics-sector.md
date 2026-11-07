# Organization industry sector

The organization profile (`/app/society`) offers the 20 sectors from
[NAICS Canada 2022 Version 1.0](https://www23.statcan.gc.ca/imdb/p3VD.pl?Function=getVD&TVD=1369825).
Titles and codes follow Statistics Canada; descriptions, examples, activity
groups and search terms are app guidance. The chooser is optional and requires
the user to confirm a sector and save the organization profile.

## Saved contract

`societies.naicsSector` is either absent (legacy/unselected), `null` (cleared), or:

```json
{ "code": "54", "version": "2022 Version 1.0" }
```

The code is a sector string, including the combined ranges `31-33`, `44-45`
and `48-49`. The catalog and lookup/search helpers live in
`shared/naicsCanada2022.ts`. Hosted writes validate the same code/version
contract as local writes. The selection travels with ordinary workspace backups.

`naicsCode` remains a separate, unchanged legacy field for an existing code.
Prefix lookup is a browsing aid; it does not verify a detailed code or identify
its edition. Selecting or clearing a sector never overwrites the existing code.
The profile shows a notice when their sector prefixes differ.

## Future use

Read the confirmed `naicsSector` and its version when tailoring content or
filtering tools. Derive its title from the matching edition's catalog. Handle
absent/null as unknown; do not infer a confirmed choice from free text, charity
status or a detailed code. This feature does not currently change grants,
compliance, privacy assessments, or eligibility rules based on sector.

Checks: `npm run test:naics-sector` and `npm run test:naics-sector-ui`.
