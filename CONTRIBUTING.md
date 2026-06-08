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

# Broader smoke (if you touched UI/flows)
npm run test:smoke                          # Playwright
```

If you add behaviour, add or extend the matching gate — they're plain `tsx` scripts with
`node:assert`, easy to copy.

---

## Adding a jurisdiction or entity type

This is the most valuable kind of contribution, and it's deliberately a **data** change more
than a code change. Societyer treats a federal corporation as the base rule set and layers
provinces/territories on top as modules. Because an **extra-provincial registration** of a
federal corporation generally carries the same registry-maintenance obligations as a **direct
provincial incorporation**, one province module is meant to serve both paths.

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
