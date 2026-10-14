# Contributing to Societyer

Thanks for being here. Societyer started as a tool for **BC Societies Act** compliance and
is growing into a federal-first, multi-jurisdiction workspace for keeping a corporation or
society in good standing. Contributions of all sizes are welcome — a one-line fix is worth
filing, and a new jurisdiction rule pack is worth a lot.

A few ground rules up front:

- **This is not legal advice, and neither are the rule packs.** Every compliance rule must
  cite the statute, regulation, or government guidance it comes from, and citations must be
  checked against the *current* Act — not a stale copy or memory.
- **Never commit real corporate or personal data** in code, fixtures, tests, or screenshots.
- **Keep PRs focused.** One logical change per PR lands far faster than a sweeping one.

---

## Getting set up

The full local setup (self-hosted Convex via Docker, env vars, admin key) lives in the
[README](./README.md). The short version:

```bash
npm install
npm run dev        # Vite dev server; "View demo" runs fully in-browser (Dexie), no backend
```

The in-browser **demo** seeds from the real source schema, so most changes can be exercised
without standing up Convex at all.

### Project layout (the parts you'll touch most)

| Path | What lives here |
| --- | --- |
| `src/` | React app (Vite + TypeScript). No CSS framework — tokens in `src/theme/tokens.css`. |
| `convex/` | Convex functions + `schema.ts`. Server-side data and queries. |
| `src/lib/staticConvex.ts` | The Dexie/local adapter that powers the demo and desktop build. |
| `shared/` | Code shared across app, Convex, and scripts — domain logic, jurisdiction config. |
| `src/lib/compliance/` | The compliance engine, rule-pack schema, and the rule packs themselves. |
| `scripts/` | `tsx`-based verification gates (run via `npm run test:*`). |

---

## Verification gates

Societyer has no single "test" command — it has a set of focused gate scripts. Run the ones
relevant to your change; CI and reviewers expect them green.

```bash
# Typecheck (always)
npx tsc -b                                  # app — expect 0 errors
npx tsc -p convex/tsconfig.json --noEmit    # convex — expect 0 errors

# Domain / jurisdiction
npm run test:organization-domain            # org kind, director rules, jurisdiction helpers
npm run test:jurisdiction-modules           # jurisdiction modules reference valid packs & cover both paths

# Compliance
npm run test:compliance-rules               # validates rule packs + recomputes obligation fixtures

# Offline/desktop parity (if you added a useMutation/useAction call)
npm run test:static-parity                  # every frontend write is handled or classified in the static mirror

# Broader smoke (if you touched UI/flows)
npm run test:smoke                          # Playwright

# Styles and interface (if you touched src/styles, components, pages or routes)
npx sass --no-source-map src/styles/index.scss > /dev/null   # compiles; token() names are validated
npm run test:css-vars                       # no undefined CSS custom properties; the allowlist stays empty
npm run test:interface-route-coverage       # every route has a fixture and a read scope (catch-alls are declared fallbacks)
npm run test:record-table-acceptance        # RecordTable inventory and the shared record-open behaviour

# Finance workflows (if you touched transaction rules, approvals, reconciliation or invoices)
npm run test:transaction-rules              # categorisation rules, approvals and statement reconciliation helpers
npm run test:nl-filter                      # natural-language table filter parser (if present)
npm run test:invoices                       # invoices (if present)
npm run test:xlsx                           # Excel export writer (src/lib/xlsx): package structure, typed cells, dates, formats

# Legal rules, evidence and corporate records (if you touched shared/ legal, packet or register code)
npm run test:legal                          # every legal and evidence check (scripts/run-legal-checks.mjs)
npm run test:legal:after-utc-midnight       # the same checks with the clock just after 00:00 UTC

# Portable functions (if you added or changed a shared/functions or Convex endpoint)
npm run manifest:portable && npm run test:portable-manifest
npx tsx scripts/stage2/function-inventory.ts --write && npm run test:stage2-enforced

# Entity-specific copy (if you changed UI text)
ENTITY_SWEEP_STRICT=1 npm run test:entity-sweep   # no society-only copy in corporation workspaces, or the reverse
```

> **Dates:** use the organization's local date (`organizationToday`, `resolutionCalendarDate`),
> never `new Date().toISOString().slice(0, 10)`. The after-midnight run catches checks or code
> that use the UTC date. `stage2-tenancy-report.md` is rewritten by the tenancy checks; restore it
> with `git checkout -- stage2-tenancy-report.md` unless you mean to change it.

The legal-governance and portable-conformance workflows in `.github/workflows/` run these on
every pull request. Feature guides: [corporate records](./docs/corporate-records.md),
[tasks](./docs/tasks.md), [legal research and profiles](./docs/legal-research/README.md),
[entity copy audit](./docs/entity-copy-audit.md),
[portable functions](./docs/portable-functions-architecture.md) and the
[design system](./docs/design-system.md) (tokens, `<Money>`, StatTile, tables, charts,
feedback primitives and UI conventions).

> **Static-mirror parity:** the offline/desktop runtime is served by the static mirror
> (`src/lib/staticConvex.ts`). Any mutation/action the frontend calls must be handled there
> (an explicit case or a generic CRUD verb) or classified in `src/lib/staticConvexParity.ts`
> as an intentional offline no-op or a known-pending gap — otherwise the write silently
> vanishes offline. `npm run test:static-parity` enforces this; pending gaps throw in dev.

If you add behaviour, add or extend the matching gate — they're plain `tsx` scripts with
`node:assert`, easy to copy.

---

## Adding a jurisdiction or entity type

Incorporation preparation uses the shared [pathway registry and pipeline
framework](./docs/pathway-framework.md). Add a versioned entry in
`shared/pathways/registry.ts` with eligibility, setup copy, preparation/flow data,
owned packet keys, collection inputs and graph steps. Existing selectors and
packet gates derive from that registration; avoid new entity switches in pages.
Use `review_required` for unresolved routes. Preparation approval does not adopt
legal instruments or establish government acceptance, and the official-portal
submission route remains manual unless a trusted server adapter is registered
and tested.

Run `npx tsx scripts/check-pathway-registry.ts` for selector drift, classification,
packet ownership, graph dependency and extension checks, plus the applicable
pipeline authorization and incorporation preparation gates. Preserve versioned
run and evidence snapshots when changing a pathway. The framework guide documents
the exported APIs and the separate adapter boundary.

This is the most valuable kind of contribution, and it's deliberately a **data** change more
than a code change. Societyer distinguishes the home incorporation context
from each extra-provincial registration. A jurisdiction module can serve both
contexts, but its rules must explicitly identify their applicability and correct
event anchors. Do not infer business commencement from a registration date or
apply home incorporation duties to a registration without checking the source.

To add a jurisdiction (worked example: a new province "XX"):

1. **Write the rule pack** — `src/lib/compliance/rulePacks/ca-xx.json`.
   - Follow the schema in `src/lib/compliance/rulePackSchema.ts`. Validation is strict.
   - Every non-deprecated rule needs an `appliesTo` block and at least one cited `sourceId`.
   - Use `appliesTo.contextKinds` to target `home` vs `extra_provincial`. A rule that applies
     to both a home incorporation and an extra-provincial registration can list both.
2. **Register the pack** — add the import to `src/lib/compliance/registry.ts`.
3. **Add the jurisdiction module** — a new entry in `JURISDICTION_WORKSPACE_CONFIGS`
   (`shared/jurisdictionWorkspace.ts`): defaults, registry copy, filing kinds, the
   `compliancePackIds` it owns, and display copy.
4. **Add director governance rules** — a row in `shared/directorRules.ts` keyed by
   `<jurisdiction>:<kind>` (e.g. minimum directors, residency requirement). This is what the
   Directors workspace reads; there are no jurisdiction `if`-branches in the UI.
5. **Map any jurisdiction aliases** — if the registry uses alternate codes, add them to the
   canonicaliser in `shared/organizationDomain.ts`.
6. **Run the gates**:
   ```bash
   npm run test:compliance-rules
   npm run test:jurisdiction-modules
   npm run test:organization-domain
   ```

A PR that is *just* a well-cited JSON pack plus a director-rules row is genuinely welcome —
maintainers can help with any remaining wiring.

> Not a lawyer? That's fine. What we need is accurate citations and honest `caveat` notes.
> Mark rules `"status": "draft"` until a reviewer with the relevant background signs off.

---

## Commits & pull requests

- Write commit messages in the imperative mood ("Add Ontario annual-return rule"), with a
  short body explaining *why* when it isn't obvious.
- Open a PR against `main`. Fill in the PR template, including the verification output.
- Expect review questions — they're about the code, not about you. Small, friendly PRs build
  the kind of contributor base that keeps a project alive.

## License

This repository does not yet carry a `LICENSE` file. Until one is added, please confirm with
the maintainers how your contribution may be used before relying on it. If you have a
preference, say so in your issue or PR — settling licensing early is on the project's TODO.

---

Questions, or want to sanity-check a jurisdiction before you start? Open a discussion or a
"Jurisdiction / entity-type support" issue. Thanks again for contributing.
