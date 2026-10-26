# Brandkit consumer-profile fixtures

These seven JSON files are actual `brandkit/consumer-profile/1` exports produced by the Brandkit engine with each brand's configured fonts loaded, on 2026-10-26. They cover every configured brand and retain the original export geometry, color variants, typography metadata and provenance.

Source repository: <https://github.com/ahzs645/brandkit>

Exporter and source snapshot: [`fc38be8c11a673455ecb99e85fd7a4460ae8ea4e`](https://github.com/ahzs645/brandkit/tree/fc38be8c11a673455ecb99e85fd7a4460ae8ea4e), introduced in [Brandkit PR #3](https://github.com/ahzs645/brandkit/pull/3).

The corresponding exporter is `src/engine/consumer.js`; a downloaded kit places its output at `source/consumer-profile.json`. `scripts/check-brandkit-profiles.tsx` checks import compatibility and compares the exported artwork directly against Societyer's HTML and PDF rendering. These fixture files are test inputs, not installed workspace brands or organization records.
