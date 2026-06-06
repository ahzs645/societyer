# Compliance Rule Packs

Executable compliance rule packs are strict JSON inputs for the Societyer
compliance engine. They complement, but do not replace, the human-readable
jurisdiction guide packs.

Each pack should include:

- a stable `packId`, `jurisdictionCode`, `version`, and `schemaVersion`
- first-class `sources` entries for official statutes, regulations, forms, policy, or government guidance
- rule-level `appliesTo` blocks for entity type, home jurisdiction, context kind, and registration type
- source guide rule ids plus executable rule `sourceIds`
- effective dates, verified dates, citations, and operational caveats
- obligations with filing defaults and required evidence checklists

## Applicability

Use `appliesTo` on every new rule. Pack-level `jurisdictionCode` and
`entityTypes` are only a coarse filter; rule-level applicability decides whether
an obligation appears for home facts, extra-provincial registrations, branches,
or business-name contexts.

Common patterns:

- federal home corporation:
  - `entityTypes: ["corporation__business_"]`
  - `contextKinds: ["home"]`
  - `homeJurisdictionCodes: ["CA-FED-CBCA"]`
- BC society:
  - `entityTypes: ["society"]`
  - `contextKinds: ["home"]`
  - `homeJurisdictionCodes: ["CA-BC"]`
- BC extra-provincial company:
  - `entityTypes: ["corporation__business_"]`
  - `contextKinds: ["extra_provincial"]`
  - `registrationTypes: ["extra_provincial"]`

Do not use a home-jurisdiction rule to represent an extra-provincial
registration rule. Create a separate rule with a registration context.

## Sources

Every executable rule should cite at least one `sources[].sourceId`. Prefer
official government or statutory sources:

- `statute`
- `regulation`
- `government_guidance`
- `form`
- `policy`
- `archive`

Use `draft` for legally uncertain rules. Move to `reviewed` only after source
review. Reserve `accepted` for rules that have explicit legal/product approval.

Promotion metadata is enforced:

- `reviewed` rules require `reviewedBy` and `reviewedAt`
- `accepted` rules require `reviewedBy`, `reviewedAt`, `acceptedBy`, `acceptedAt`, and `approvalReference`
- non-deprecated rules must declare `appliesTo`
- non-deprecated rules must cite at least one `authority.sourceIds` entry

Run `npm run test:compliance-rules` after editing packs.
