# Societyer Local Workflows

Repo-local Codex plugin for AI-assisted Societyer workflows.

The document-intake skill does not bypass Societyer's review workflow. It teaches
an AI to:

- inspect source documents and identify supported Societyer sections;
- produce `/app/imports` review bundles rather than writing final records directly;
- distinguish native transposition targets from page fields that are manual-only today;
- preserve provenance through `sourceExternalIds`, `sourceDocumentIds`, `confidence`, and restricted-data notes.

Skills:

- `skills/document-intake/SKILL.md`
- `skills/societyer-browser-connectors/SKILL.md`

Document intake references:

- `skills/document-intake/references/group-routing.md`
- `skills/document-intake/references/page-field-support.md`
- `skills/document-intake/references/transposition-catalog.json`

Browser connector references:

- `skills/societyer-browser-connectors/references/api-cookbook.md`
