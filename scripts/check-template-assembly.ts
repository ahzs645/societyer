import assert from "node:assert/strict";
import { renderTemplate, resolvePath, type TemplateValues } from "../shared/templateAssembly";

// --- resolvePath ----------------------------------------------------------
{
  const ctx: TemplateValues = { org: { shortName: "Acme", nested: { deep: 7 } }, dir: { count: 3 } };
  assert.equal(resolvePath(ctx, "org.shortName"), "Acme");
  assert.equal(resolvePath(ctx, "dir.count"), 3);
  assert.equal(resolvePath(ctx, "org.nested.deep"), 7);
  assert.equal(resolvePath(ctx, "org.missing"), undefined);
  assert.equal(resolvePath(ctx, "missing.deep.path"), undefined);
  assert.equal(resolvePath(ctx, ""), undefined);
  // indexing into a non-object segment yields undefined, not a throw.
  assert.equal(resolvePath(ctx, "dir.count.nope"), undefined);
}

// --- token interpolation (incl. nested path & missing -> "") --------------
{
  const ctx: TemplateValues = { org: { shortName: "Acme" }, n: 0, blank: null };
  assert.equal(renderTemplate("Hello {org.shortName}!", ctx), "Hello Acme!");
  assert.equal(renderTemplate("[{missing}]", ctx), "[]");
  assert.equal(renderTemplate("[{org.missing}]", ctx), "[]");
  assert.equal(renderTemplate("[{blank}]", ctx), "[]"); // null -> ""
  assert.equal(renderTemplate("[{n}]", ctx), "[0]"); // 0 stringifies, not skipped
  // literal brace escapes
  assert.equal(renderTemplate("{{not a token}}", ctx), "{not a token}");
}

// --- {#if} true / false / {#else} ----------------------------------------
{
  assert.equal(renderTemplate("{#if a}yes{/if}", { a: true }), "yes");
  assert.equal(renderTemplate("{#if a}yes{/if}", { a: false }), "");
  assert.equal(renderTemplate("{#if a}yes{#else}no{/if}", { a: true }), "yes");
  assert.equal(renderTemplate("{#if a}yes{#else}no{/if}", { a: false }), "no");
  // falsy variants
  assert.equal(renderTemplate("{#if a}y{#else}n{/if}", { a: 0 }), "n");
  assert.equal(renderTemplate("{#if a}y{#else}n{/if}", { a: "" }), "n");
  assert.equal(renderTemplate("{#if a}y{#else}n{/if}", { a: [] }), "n");
  assert.equal(renderTemplate("{#if a}y{#else}n{/if}", {}), "n"); // undefined
  // truthy variants
  assert.equal(renderTemplate("{#if a}y{#else}n{/if}", { a: [1] }), "y");
  assert.equal(renderTemplate("{#if a}y{#else}n{/if}", { a: "x" }), "y");
}

// --- {#each} over array of objects with {this.field} ----------------------
{
  const ctx: TemplateValues = { people: [{ name: "Avery" }, { name: "Morgan" }] };
  assert.equal(renderTemplate("{#each people}- {this.name}\n{/each}", ctx), "- Avery\n- Morgan\n");
  // {@index} and {this} and {.field} shorthand
  assert.equal(
    renderTemplate("{#each people}{@index}:{.name};{/each}", ctx),
    "0:Avery;1:Morgan;",
  );
  // non-array path -> empty
  assert.equal(renderTemplate("{#each nope}x{/each}", ctx), "");
  // primitive items via {this}
  assert.equal(renderTemplate("{#each xs}{this},{/each}", { xs: ["a", "b"] }), "a,b,");
}

// --- NESTED: {#each}{#if this.field}*{/if}{this.name}{/each} ---------------
{
  const ctx: TemplateValues = {
    directors: [
      { name: "Avery", isChair: true },
      { name: "Morgan", isChair: false },
      { name: "Riley", isChair: false },
    ],
  };
  assert.equal(
    renderTemplate("{#each directors}{#if this.isChair}*{/if}{this.name} {/each}", ctx),
    "*Avery Morgan Riley ",
  );
}

// --- realistic legal sentence: sole vs multiple ---------------------------
{
  const tmpl =
    "The undersigned being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName} hereby adopt{dir.verbS} this resolution.";

  const sole: TemplateValues = {
    dir: { isSole: true, isMultiple: false, verbS: "s" },
    org: { shortName: "Acme Society" },
  };
  assert.equal(
    renderTemplate(tmpl, sole),
    "The undersigned being the sole director of Acme Society hereby adopts this resolution.",
  );

  const multiple: TemplateValues = {
    dir: { isSole: false, isMultiple: true, verbS: "" },
    org: { shortName: "Acme Society" },
  };
  assert.equal(
    renderTemplate(tmpl, multiple),
    "The undersigned being all the directors of Acme Society hereby adopt this resolution.",
  );
}

// --- deeper nesting: each > if/else > interpolation -----------------------
{
  const ctx: TemplateValues = {
    items: [
      { label: "A", on: true },
      { label: "B", on: false },
    ],
  };
  assert.equal(
    renderTemplate("{#each items}{this.label}={#if this.on}ON{#else}OFF{/if};{/each}", ctx),
    "A=ON;B=OFF;",
  );
}

console.log("OK template-assembly");
