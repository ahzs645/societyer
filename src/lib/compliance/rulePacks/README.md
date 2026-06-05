# Compliance Rule Packs

Executable compliance rule packs are strict JSON inputs for the Societyer
compliance engine. They complement, but do not replace, the human-readable
jurisdiction guide packs.

Each pack should include:

- a stable `packId`, `jurisdictionCode`, `version`, and `schemaVersion`
- applicability rules for entity type, home jurisdiction, and registration type
- source guide rule ids or an explicit source-gap marker
- effective dates, verified dates, citations, and operational caveats
- obligations with filing defaults and required evidence checklists

Run `npm run test:compliance-rules` after editing packs.
