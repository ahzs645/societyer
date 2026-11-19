import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { DEFAULT_FAVICON_TAG, instanceFaviconMarkup } from "../shared/instanceFavicon";

const symbols = {
  VITE_WORKSPACE_SYMBOL_BRAND_ID: "ddcnorth",
  VITE_WORKSPACE_SYMBOL_LIGHT: "/ddcnorth/symbol-midnight.svg",
  VITE_WORKSPACE_SYMBOL_DARK: "/ddcnorth/symbol-white.svg",
};
const scoped = { ...symbols, VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN: "https://portal.ddcnorth.com" };
const markup = instanceFaviconMarkup(scoped);
assert.match(markup, /id="societyer-favicon"[^>]*href="\/favicon.svg"/, "The shared HTML starts with a neutral icon");

type Icon = { rel: string; type: string; href: string; media?: string };
function loadHead(html: string, origin: string) {
  const icons: Icon[] = [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }];
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, "A scoped build must choose its icon at runtime");
  runInNewContext(script, {
    window: { location: { origin } },
    document: {
      getElementById: (id: string) => id === "societyer-favicon" ? icons[0] : null,
      createElement: (tag: string) => { assert.equal(tag, "link"); return {}; },
      head: { appendChild: (icon: Icon) => icons.push(icon) },
    },
  });
  return icons;
}

const ddcIcons = loadHead(markup, scoped.VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN);
assert.deepEqual(ddcIcons.map(icon => ({ ...icon })), [
  { rel: "icon", type: "image/svg+xml", href: symbols.VITE_WORKSPACE_SYMBOL_LIGHT },
  { rel: "icon", type: "image/svg+xml", href: symbols.VITE_WORKSPACE_SYMBOL_DARK, media: "(prefers-color-scheme: dark)" },
], "The matching domain receives the exact light/dark compact artwork");

for (const origin of [
  "https://portal.1stform.ca",
  "https://societyer-firstform.pages.dev",
  "https://unmapped.example.test",
  "https://portal.ddcnorth.com.example.test",
  "http://portal.ddcnorth.com",
  "https://portal.ddcnorth.com:8443",
  "null",
]) {
  assert.deepEqual(loadHead(markup, origin), [
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  ], `${origin} must not inherit another domain's icon`);
}

const fallbackDark = loadHead(instanceFaviconMarkup({ ...scoped, VITE_WORKSPACE_SYMBOL_DARK: undefined }), scoped.VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN);
assert.equal(fallbackDark[1].href, symbols.VITE_WORKSPACE_SYMBOL_LIGHT, "Missing dark artwork uses the supplied light symbol");
assert.equal(instanceFaviconMarkup({}), DEFAULT_FAVICON_TAG, "Local and desktop builds remain neutral");
assert.equal(instanceFaviconMarkup({ ...scoped, VITE_WORKSPACE_SYMBOL_LIGHT: "https://external.example.test/icon.svg" }), DEFAULT_FAVICON_TAG);
assert.equal(instanceFaviconMarkup({ ...scoped, VITE_WORKSPACE_SYMBOL_LIGHT: "//external-host/icon.svg" }), DEFAULT_FAVICON_TAG, "Protocol-relative URLs are not local artwork");
const untrustedDark = loadHead(instanceFaviconMarkup({ ...scoped, VITE_WORKSPACE_SYMBOL_DARK: "//external-host/icon.svg" }), scoped.VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN);
assert.equal(untrustedDark[1].href, symbols.VITE_WORKSPACE_SYMBOL_LIGHT, "Protocol-relative dark artwork falls back to the local light symbol");
for (const origin of ["not-an-origin", "https://portal.ddcnorth.com/path", "https://user@portal.ddcnorth.com", "javascript:alert(1)"]) {
  assert.equal(instanceFaviconMarkup({ ...scoped, VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN: origin }), DEFAULT_FAVICON_TAG, "Invalid origin configuration fails neutral");
}
const legacy = instanceFaviconMarkup(symbols);
assert.ok(!legacy.includes("<script>"), "A legacy single-instance build keeps static icons");
assert.match(legacy, /href="\/ddcnorth\/symbol-midnight.svg"/);
assert.match(legacy, /href="\/ddcnorth\/symbol-white.svg" media="\(prefers-color-scheme: dark\)"/);
console.log("Domain favicon: exact-origin light/dark icons, neutral shared defaults and legacy builds passed.");
