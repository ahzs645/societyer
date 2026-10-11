# Jurisdiction Guide Packs

Jurisdiction guide packs are source-backed legal guide content for Societyer. They are guidance for the recorded entity. Current guides reference the same framework-free legal-source registry used by compliance profiles. Privacy guidance is resolved separately from actual operating locations and activities.

Each pack is a strict JSON file validated by `src/lib/jurisdictionGuideSchema.ts`. Malformed packs fail both app import and `npm run test:jurisdiction-guides`.

## File Naming

Name each pack after its jurisdiction code in lowercase:

- `ca-bc.json`
- `ca-fed-cbca.json`
- `ca-on-obca.json`

The filename follows the pack ID. Separate Acts can share a province: `ca-bc.json` is the Societies Act and `ca-bc-bca.json` is the Business Corporations Act. Resolve by the governing Act and entity type before selecting a pack.

## Required Pack Metadata

Every pack must include:

- `schemaVersion`: `2.1.0` (historical `2.0.0` packs remain readable)
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
- Either a verified `validity.effectiveFrom`, or `validity.currentAsOf` for a review of current wording; never use a consolidation date as an effective date
- `authority.sourceId`
- `authority.sections`
- `provenance.verifiedAt`
- `provenance.verificationMethod`
- `content.summary`
- `content.tooltip`
- `content.displayCitation`

Use `validity.effectiveTo` for historical rules. It is exclusive and must be after a verified `effectiveFrom`. A `currentAsOf` snapshot is not shown for a meeting earlier than that review date: the current wording does not prove the historical rule.

Use `authority.registrySourceIds` for current rules already researched in `shared/legalSources.ts`. The adapter resolves their summaries, caveats, citations, actual consolidation dates and review dates from that registry, so amendments do not require parallel copy edits. Proposed sources are rejected. The JSON content remains a readable snapshot, and its citation records are preserved for export.

## Computable Rules

These packs currently drive source-backed guide display. If a rule includes values that may later be calculated, add optional `parameters` with stable keys, units, and operators. Do not add executable logic to these JSON files yet.

Executable core profiles live in `shared/legalGovernanceProfiles.ts` and cite `shared/legalSources.ts`. Guide rules consume the same source IDs. New governing Acts need a profile and an explicit entity mapping; a province match alone does not authorize a guide.

Privacy has a separate activity-based registry in `shared/privacyRuleProfiles.ts`. `getPrivacyLegalGuideRules` returns guidance only for laws assessed as applicable. Unresolved provincial, commercial, federal-work, nonprofit and sector facts remain conditional in the Privacy assessment UI, instead of being inserted into the incorporation guide pack.

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
