# Backlog from advisor call (Lucas) — 2026-06-07

Distilled action items from the call. Status reflects what already exists in the repo
as of this date, so we don't rebuild things that are done.

Legend — **Status:** ✅ already built · 🟡 partial · 🔲 gap
**Effort:** S / M / L · **Value:** ★ (low) → ★★★ (high)

---

## A. Architecture — "federal-first, provinces/entity-types as modules"

The central idea: make a **federal corporation the base rule set**, with provinces and
entity types (society / corporation) layered on top like class inheritance
(Ontario extends Federal, BC extends Federal). Both are subsets of "organization."

- **A1 — Federal/provincial/entity rule packs.** ✅ Done. `ca-fed-cbca.json`,
  `ca-on-obca.json`, `ca-bc-company.json`, `ca-bc-extra-provincial-company.json`,
  `ca-bc.json` (societies). JSON-driven, filtered by jurisdiction + entity type via
  `engine.ts` + per-rule `appliesTo` blocks.
- **A2 — Extra-provincial context.** ✅ Done. `contextKinds: ["extra_provincial"]`,
  `organizationRegistrations` table (home / extra_provincial / branch / business_name).
- **A3 — Legislation references in UI.** ✅ Done. Each rule carries `authority` + `sources`
  with statute citation + URL.
- **A4 — Province module serves BOTH paths.** 🔲 Gap · M · ★★★
  Lucas's sharpest point: *extra-provincial registration needs the same things as a direct
  provincial incorporation.* Today `ca-bc-company.json` and `ca-bc-extra-provincial-company.json`
  are separate and likely duplicate obligations. Add a composition/inheritance layer so a
  province defines its obligations **once**, consumed by both "incorporate provincially" and
  "extra-provincially register a federal corp." First step: audit the two BC packs for
  duplicated `obligationKey`s.
- **A5 — Remove BC hardcoding (the literal "make federal the base" cleanup).** 🔲 Gap · M · ★★
  `"CA-BC"` is a fallback default in `localDexieRowStore.ts`, `staticConvex.ts`,
  `convex/society.ts`. The min-3-directors / BC-residency rule is hardcoded in
  `shared/directorCompliance.ts` instead of in a rule pack — move it into the packs.
- **A6 — Provincial → federal "upgrade" / continuance.** 🔲 Gap · M · ★ (edge case)
  Convert a provincial corp to federal (name must be free in NUANS). Rare path; defer.

## B. Onboarding & document generation

- **B1 — Post-incorporation "next steps" guided flow.** 🟡 Partial · M · ★★★
  The hardest thing for new incorporators ("Vault/ISED just incorporated me — now what?":
  minute book, appoint directors, issue shares, change HQ address, get HST/BN). Building
  blocks exist in `corporationDocumentPackets.ts` (organize-corporation, appoint-director,
  issue-shares, isc-register-update, extra-provincial-registration-evidence). Missing: the
  guided **sequence** that walks a new corp through them.
- **B2 — Quick-action document issuance.** 🟡 Partial · M · ★★
  "Create a shareholder resolution / appointment / annual ISC declaration" as one-click
  document generation. Packet generation (`corporationPacketDocx.ts`) exists; wire up
  quick-actions + (optional) LawDepot-style templates.
- **B3 — Annual ISC filing helper.** 🟡 Partial · S · ★★
  Federal corps file ISC (significant control, >25–30% interest) yearly. `isc-register-update`
  packet exists; add the recurring obligation + reminder + declaration doc.

## C. Government accounts & registry connectors

- **C1 — Government-account tracking.** 🔲 Gap · M · ★★★ (Lucas + you both wanted this)
  New `governmentAccounts` table to track GCKey / ISED Corporations Canada / CRA accounts,
  web access codes, and representative roles, with linkage + filing reminders. Nothing tracks
  this today.
- **C2 — Registry connectors (BC + federal).** 🟡 Partial · L · ★★
  BC Registry import exists (`server/api-gateway/bc-registry.ts`, browser-connector via
  Playwright for the no-API BC societies site). Federal grants pull is API-based. Generalize
  into per-jurisdiction registry adapters (`registryAdapters/{bc,federal,ontario}.ts`).
  Note Lucas's caution: capturing OAuth/session to hit undocumented gov APIs is sensitive;
  keep it local-run + transparent for trust.

## D. Packaging & data layer

- **D1 — PWA install button.** ✅ Done. `public/manifest.webmanifest` + `sw.js` exist.
  (Lucas suggested PWA over forcing Electron — already covered. Could surface an explicit
  "Install" button if not present.)
- **D2 — Adapter so we're not Convex-locked.** ✅ Done. Dexie/Convex adapter split in place;
  schema-driven, demo seeds from the real source.
- **D3 — SQLite-over-Postgres-protocol for desktop bundling.** 🔲 Gap · M · ★ (defer)
  Lucas's idea: ship a bundled SQLite file behind the Postgres protocol so the same
  ORM/queries work on hosted (Postgres) and desktop. The adapter layer already abstracts
  this; low priority.

## E. Tax / finance (scope-creep watch)

- **E1 — Depreciation / CCA tracking for T2.** 🔲 Gap · L · ★ (defer)
  Tie inventory + receipts + purchase date → CCA classes to auto-compute capital cost
  allowance for T2 filings. Lucas's own advice was to avoid scope creep before product-market
  fit — park this.

## F. Project health & long-term survival (Lucas's parting advice)

- **F1 — Contributor infrastructure.** 🔲 Gap · S · ★★★
  No `CONTRIBUTING.md`, no issue/PR templates (`.github/` only has workflows). Add them to
  make the project contributable — directly serves the "long-term survival / get maintainers"
  goal. Cheap, high leverage.
- **F2 — Marketing / traction.** (non-code) · ★★
  GitHub stars are this project's product-market-fit signal. Fuzzy-search discovery, README
  polish, entrepreneurship-club / meetup focus-testing, student labor for QA.
- **F3 — Avoid scope creep.** (principle) Find fit before adding breadth; guard the context
  window / model quality as the codebase grows.
- **F4 — Engineering growth (personal).** (non-code) Consider a non-JS backend for *future*
  projects to attract strong devs who don't do front-end; become a polyglot.

---

## Suggested first moves (highest value / reasonable effort)

1. **A4** — province-module composition (the one architectural change with teeth).
2. **C1** — government-account tracking (wanted by both parties; self-contained new feature).
3. **F1** — contributor infrastructure (S effort, ★★★ for project survival).
4. **A5** — federal-first cleanup (pairs naturally with A4).
