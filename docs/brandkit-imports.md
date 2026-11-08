# Workspace and document Brandkit

## Workspace identity

Open **Settings → Workspace → Workspace Brandkit** (also available through **Select workspace → Workspace branding**). An owner or administrator can:

1. **Import Brandkit** from a ZIP or JSON profile, or choose **Use document template brand** to copy the brand already saved in the default document template.
2. Review the light and dark previews with the actual workspace name. Importing only opens a preview; **Cancel brand preview** leaves the saved identity in place.
3. Choose **Use brand accent in the interface** to apply readable brand shades to actions, links and focus indicators.
4. Select **Apply workspace brand** to save the workspace's presentation profile.

The saved profile appears in the expanded sidebar, rail, mobile workspace button and navigation drawer, workspace picker, dashboard identity banner and portfolio. Browser page titles include the actual workspace name. New document designs use the workspace Brandkit when one is configured; otherwise they retain the existing default-template brand behaviour.

The logo component contains the complete artwork at its original aspect ratio. It uses the supplied primary variant for light appearance and reverse variant for dark appearance. The profile has no compact-mark field: Societyer does not crop a wordmark, extract a crest or invent a symbol for a small slot. Missing or failed images fall back to an uploaded workspace logo and then the workspace's initial. Imported font metadata does not replace interface fonts or trigger remote font downloads.

Branded workspace controls show the full wordmark without a second visible workspace-name line; the name remains in the control's accessible label and workspace picker. An instance can supply separate compact SVG artwork for a matching brand ID using `VITE_WORKSPACE_SYMBOL_BRAND_ID`, `VITE_WORKSPACE_SYMBOL_LIGHT` and `VITE_WORKSPACE_SYMBOL_DARK`. The DDC North build pins the approved six-dot micro symbols from design-system release `build-2-c10f81e799bc` for compact controls and its light/dark browser favicons. Other brands and deployments retain their own artwork and favicon.

Interface accent shades are derived from the actual light/dark surfaces and checked for at least 4.5:1 foreground contrast. Success, warning, danger, money and chart semantics retain their own tokens. Turning off the accent switch keeps the logo while restoring the application palette. Changing workspace, clearing the brand or leaving the workspace shell also restores the appropriate palette.

Workspace branding is a separate, permission-checked presentation snapshot (`societies.workspaceBrand` and `workspaceBrandUseAccent`). It is available through the same portable mutation in hosted, local and desktop runtimes. Its normalized payload is limited to 250,000 bytes. It never changes organization/legal names, registrations, contact details, uploaded logo pointers, document-template defaults or issued documents. **Remove workspace brand** restores the uploaded-logo/initial fallback and offers Undo; **Export workspace brand** downloads a profile that can be imported again. An unfinished import is discarded when switching workspaces.

## Document templates

Open **Invoices → Setup → Templates → Import Brandkit** and choose a [Brandkit](https://projects.ahmadjalil.com/brandkit/) ZIP or JSON profile. The designer opens the workspace's default template with the imported artwork and colors. Review the preview and save the template to apply it to that reusable design. Inside a template, **Import Brandkit profile** applies the same upload to that design. **Use workspace Brandkit** applies the saved workspace brand, or the default template's brand when no workspace brand is configured, to the design you're editing. The gallery and **New template** use that same precedence for starting designs.

The ZIP importer uses the portable profile when included. Brandkit packs such as First Form's can supply `brand.json` and the vector artwork listed in `brandkit-pack.json`. The importer reads only those entries and uses the pack's palette to resolve the logo colors. Legal and payment details come from workspace records. Issued invoices retain their saved design.

## Portable profile

Societyer accepts `schema: "brandkit/consumer-profile/1"`, with `id`, `name`, `version`, optional `sourceUrl`, resolved six-digit hex `colours`, source `typography`, and `logos.primary`, `logos.black`, and `logos.reverse`. Each logo contains an outlined `svg` and a matching `[0, 0, width, height]` `viewBox`. All three variants must share dimensions. Optional descriptive `provenance.source` and `provenance.status` are retained with the saved brand.

Primary artwork keeps every supplied color. Black and reverse artwork use the supplied variants, including stroke colors; Societyer does not recolor a multicolor primary logo to synthesize them. The import supports paths, circles, ellipses, polygons and nested groups with bounded translation, scaling, rotation or matrix transforms. It flattens these to passive paths shared by the HTML and PDF renderers. Compound-path holes and stroke widths are retained. Live text, scripts, event handlers, CSS, external references, definitions, clipping, filters and other unsupported SVG features are rejected. Stroked artwork with a nonuniform or skewed transform is rejected rather than rendered with a different stroke shape. The file picker accepts JSON files up to 2 MB; each logo has a 200 KB limit and bounded geometry.

The seven supplied export fixtures cover ddcnorth, First Form, Over the Edge, SparkLab, Northwind, BC Province 1977 and BC Hydro 1983. This includes circle symbols, drawn path marks, lettering-only marks, composed signatures, multicolor artwork and historic crest geometry. Historical provenance in a profile describes the source; it does not certify an identity as current or grant rights to use it.

## Document fonts

Logo lettering arrives as vector outlines, so its appearance does not depend on installed fonts. Body text uses Societyer's bundled document faces. The designer shows the actual face and identifies a fallback when it differs from the source profile.

| Source body face in the supplied profiles | Document body face |
| --- | --- |
| Inter (ddcnorth, Northwind) | Inter |
| Sora (First Form) | Inter fallback |
| Helvetica Neue (Over the Edge) | Inter fallback |
| TeX Gyre Heros (BC Province 1977) | Inter fallback |
| Source Serif 4 (SparkLab) | Noto Serif fallback |
| TeX Gyre Termes (BC Hydro 1983) | Noto Serif fallback |

Heading and label family names are retained as source metadata. They do not override document typography settings. Use the document's Typography controls to choose among bundled families and weights. Font files are not fetched from the profile's source URL or fallback stack.

## Existing brands and saved documents

The original raw `brand.json` importer remains available for circle symbols with outlined wordmark variants, including the bundled ddcnorth brand. Other raw Brandkit geometries should be exported through `consumer-profile.json`; the importer explains this when a raw file is unsupported. Existing Societyer snapshots without the portable profile marker keep their previous logo markup, monochrome variant behavior and font selection. There is no workspace migration or automatic update of saved documents.

## Verification

Run `npm run test:brandkit`. It exercises all seven real profiles and three variants per profile, compares normalized HTML and generated PDF artwork with the exported SVG, checks rejection of active or unsupported input, verifies font fallback labels and save/load stability, and checks that updating a reusable template preserves a sent invoice and organization facts. `npm run test:invoices` retains the existing invoice and legacy logo checks.

`npm run test:workspace-branding` checks workspace permissions, hosted/local persistence, active-SVG and payload rejection, preservation of existing records, exact logo variants, contrast across light/dark palettes and workspace titles. `npm run test:workspace-branding-ui` exercises the Settings preview/apply/cancel/reload flow, workspace switching and phone layout with synthetic local data.
