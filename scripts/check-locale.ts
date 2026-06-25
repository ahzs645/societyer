import assert from "node:assert/strict";

import { formatLongDate, resolveLocale } from "../shared/locale";
import { buildRenderContext } from "../shared/renderContext";

// resolveLocale: French variants → fr, everything else → en.
assert.equal(resolveLocale("French"), "fr");
assert.equal(resolveLocale("fr"), "fr");
assert.equal(resolveLocale("Français"), "fr");
assert.equal(resolveLocale("English"), "en");
assert.equal(resolveLocale("Default"), "en");
assert.equal(resolveLocale(""), "en");
assert.equal(resolveLocale(undefined), "en");

// formatLongDate: locale-specific long dates.
assert.equal(formatLongDate("2026-06-25"), "June 25, 2026", "en default");
assert.equal(formatLongDate("2026-06-25", "en"), "June 25, 2026");
assert.equal(formatLongDate("2026-06-25", "fr"), "25 juin 2026");
assert.equal(formatLongDate("2026-12-09", "fr"), "9 décembre 2026");
assert.equal(formatLongDate("not-a-date", "fr"), "not-a-date", "passthrough");

// buildRenderContext threads the locale into date.long; en is unchanged.
const org = { entityType: "corporation", legalName: "Acme Inc." };
assert.equal(buildRenderContext({ org, asOf: "2026-06-25" }).date.long, "June 25, 2026");
assert.equal(buildRenderContext({ org, asOf: "2026-06-25", locale: "fr" }).date.long, "25 juin 2026");

console.log("OK locale");
