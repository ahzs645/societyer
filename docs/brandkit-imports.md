# Brandkit imports for document templates

In **Invoices → Templates → Branding**, use **Import Brandkit profile** to select `source/consumer-profile.json` from a [Brandkit](https://projects.ahmadjalil.com/brandkit/) download. Review the live preview and **Preview PDF**, then save the template. Applying a profile changes the selected document template's artwork and presentation colors. Legal names, addresses, tax registration, customer details, payment instructions and invoice amounts continue to come from workspace records. Each invoice keeps its saved template snapshot, so selecting a different brand for a reusable template does not restyle an already issued invoice.

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
