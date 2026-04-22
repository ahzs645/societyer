# Architecture Modularization Backlog

This backlog tracks focused modularization work for the largest Societyer files. The goal is incremental extraction with unchanged behavior, not a broad rewrite.

## Access-Control Hardening

- [ ] Add shared Convex helpers for meeting-material authorization in `convex/lib/access/materialAccess.ts`.
- [ ] Add shared Convex helpers for document authorization in `convex/lib/access/documentAccess.ts`.
- [ ] Wire document queries, file URL/download actions, meeting package queries, and document review queries through the shared helpers before treating fine-grained access grants as a security boundary.
- [ ] Add focused tests or script checks for board, member, attendee, committee, restricted, and explicit-grant access cases.

## Frontend Monoliths

- [ ] Split `src/pages/MeetingDetail.tsx` into a route container plus feature modules for meeting package, material access, join details, transcript/minutes editing, export helpers, and source documents.
- [ ] Split `src/pages/Financials.tsx` into financial dashboard, Wave cache explorer, Wave resource/detail views, account detail views, provider controls, operating subscriptions, and table column helpers.
- [ ] Split `src/pages/Grants.tsx` into grant list/detail/edit pages, dossier panels, requirement editors, grant parsing/sanitizing helpers, and evidence grouping helpers.

## Static Runtime

- [ ] Split `src/lib/staticConvex.ts` into domain fixtures, static query handlers, static mutation/action handlers, and shared lookup utilities.
- [ ] Keep static data files small enough that feature teams can edit one domain without touching unrelated fixtures.

## Convex Backend Monoliths

- [ ] Organize `convex/schema.ts` with reusable validators and domain sections for large repeated shapes while keeping Convex's single schema export intact.
- [ ] Split `convex/importSessions.ts` into discovery, extraction, transposition, import-session persistence, and Paperless-specific adapters.
- [ ] Split `convex/paperless.ts` into connection health, document sync, source pull, discovery, and OCR/import helpers.

## Working Rules

- Extract by dependency direction: pure helpers first, then presentational components, then stateful feature panels.
- Keep route files as orchestration shells: data loading, high-level state, mutations/actions, and navigation.
- Prefer small behavior-preserving PR-sized slices over multi-file rewrites.
- Do not enforce new access rules until the shared helpers are wired into all relevant read/download paths.
