# Jurisdiction Guide Packs

Jurisdiction guide packs are source-backed legal guide content for Societyer. They are not legal advice and they are not yet executable compliance rules.

Each pack is a strict JSON file validated by `src/lib/jurisdictionGuideSchema.ts`. Malformed packs fail both app import and `npm run test:jurisdiction-guides`.

## File Naming

Name each pack after its jurisdiction code in lowercase:

- `ca-bc.json`
- `ca-fed-cbca.json`
- `ca-on-obca.json`

The filename must match `jurisdiction.code`.

## Required Pack Metadata

Every pack must include:

- `schemaVersion`: currently `2.0.0`
- `packId`: stable identifier for the pack
- `status`: `draft`, `reviewed`, `accepted`, or `deprecated`
- `version`: pack version, usually tied to source currency or review date
- `reviewedAt`: `YYYY-MM-DD`
- `maintainers`: people or teams responsible for the pack
- `legalDisclaimer`: non-advice warning shown/retained with the pack
- `jurisdiction`: code, country, optional subdivision, and display name
- `entityTypes`: Societyer entity-type values this pack applies to
- `sources`: official source catalog
- `rules`: guide rules

## Source Requirements

Prefer primary official sources: statute, regulation, registry guidance, official policy, or point-in-time archive.

Each source needs:

- `sourceId`: stable local identifier
- `type`: source category
- `title`
- `publisher`
- `canonicalUrl`
- `retrievedAt`: `YYYY-MM-DD`
- `currentTo` when the source publishes a currency date
- `pointInTimeUrl` when available

## Rule Requirements

Each rule needs:

- `ruleId`: stable unique identifier
- `stableKey`: topic-like stable key for future computable rules
- `status`: `draft`, `reviewed`, `accepted`, `deprecated`, or `historical`
- `ruleType`
- `topics`
- `applicability`
- `validity.effectiveFrom`: `YYYY-MM-DD`
- `authority.sourceId`
- `authority.sections`
- `provenance.verifiedAt`
- `provenance.verificationMethod`
- `content.summary`
- `content.tooltip`
- `content.displayCitation`

Use `validity.effectiveTo` for historical rules. It is exclusive and must be after `effectiveFrom`.

## Computable Rules

These packs currently drive source-backed guide display. If a rule includes values that may later be calculated, add optional `parameters` with stable keys, units, and operators. Do not add executable logic to these JSON files yet.

Future executable compliance logic should live in a separate layer, likely `jurisdictionRulePacks` or `complianceRulePacks`, and consume guide-pack citations by reference.

## Adding A Pack

1. Add a JSON file in this directory.
2. Register it in `src/lib/jurisdictionGuidePackRegistry.ts`.
3. Run `npm run test:jurisdiction-guides`.
4. Add or update behavior checks when the pack should affect UI output.

## Open Decisions

- Who can mark legal content as `reviewed` or `accepted`.
- Whether mature packs should require a second reviewer.
- Whether to generate JSON Schema from Zod for editor autocomplete.
- How to migrate from guide-only content to computable compliance knowledge.
