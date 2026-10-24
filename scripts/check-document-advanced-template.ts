import assert from "node:assert/strict";
import { cleanDocumentAdvanced, cleanDocumentDesign, DEFAULT_DOCUMENT_DESIGN, DOCUMENT_COLUMN_KEYS, resolveDocumentAdvanced } from "../shared/documentDesign";
import { DOCUMENT_TEMPLATE_PRESETS } from "../shared/documentTemplatePresets";

const legacy = JSON.parse(JSON.stringify(DEFAULT_DOCUMENT_DESIGN));
delete legacy.advanced;
delete legacy.titles.quote;
delete legacy.titles.statement;
legacy.table.columns = legacy.table.columns.slice(0, 9);
const before = JSON.stringify(legacy);
const normalized = cleanDocumentDesign(legacy);
assert.equal(JSON.stringify(legacy), before, "normalizing does not mutate old snapshots");
assert.equal(normalized.table.columns.length, DOCUMENT_COLUMN_KEYS.length);
assert.ok(normalized.table.columns.slice(9).every((column) => !column.visible), "new item fields remain hidden in old snapshots");
assert.equal(normalized.titles.quote, "Quote");
assert.equal(normalized.titles.statement, "Customer statement");
const design = resolveDocumentAdvanced(normalized);
assert.equal(design.page.customSize, false);
assert.equal(design.rich.headerHtml, "");
assert.equal(design.visibility.finalTotal, true);

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=";
design.page = { customSize: true, width: 700, height: 900, firstHeaderHeight: 100, pageNumber: { position: "custom", alignment: "center", x: 350, y: 25 } };
design.logo = { height: 70, preserveAspectRatio: false };
design.addresses.billing = { format: "{{name}}\n{{address}}\n{{email}}", placement: "absolute", x: 50, y: 150, width: 200 };
design.backgrounds.header = { color: "#001122", image, opacity: 0.25, position: "top_right", fit: "cover" };
design.typography.organizationName = { fontFamily: "open_sans", fontSize: 14, color: "#112233" };
design.typography.terms = { fontFamily: "liberation_serif", fontSize: 8, color: "#334455" };
design.rich.headerHtml = "<p><strong>Service</strong> terms <a href=\"https://example.test/terms\">read</a></p>";
design.terms = { enabled: true, html: "<p>Warranty: <em>90 days</em></p>", placement: "end" };
design.bank = { enabled: true, fields: [{ label: "Account", value: "123-456" }], placement: "after_totals" };
design.onlinePayment = { enabled: true, url: "https://example.test/pay", label: "Pay securely", showQr: true, placement: "before_items" };
design.paymentStub.enabled = true;
design.paymentStub.firstPageOnly = false;
design.taxSummary.enabled = true;
design.amountWords.enabled = true;
design.baseCurrency.enabled = true;
design.signature.image = image;
design.receiverSignature = { ...design.receiverSignature, enabled: true, name: "Recipient", image, placement: "absolute", x: 350, y: 650 };
design.appendices = [{ title: "Warranty", html: "<p>Retain this document.</p>", image }];
design.annexures.enabled = true;
const complete = cleanDocumentDesign({ ...normalized, advanced: design });
assert.deepEqual(cleanDocumentDesign(JSON.parse(JSON.stringify(complete))), complete, "all advanced controls survive JSON roundtrip");
assert.equal(resolveDocumentAdvanced(complete).backgrounds.header.opacity, 0.25);
assert.equal(resolveDocumentAdvanced(complete).onlinePayment.url, "https://example.test/pay");
assert.equal(resolveDocumentAdvanced(complete).receiverSignature.image, image);

for (const invalid of [
  { page: { width: Number.NaN } }, { page: { width: 20 } }, { page: { firstHeaderHeight: 501 } },
  { page: { pageNumber: { position: "screen" } } }, { logo: { height: -1 } },
  { addresses: { billing: { format: "{{password}}" } } }, { addresses: { shipping: { placement: "sticky" } } },
  { backgrounds: { body: { image: "https://example.test/image.png" } } },
  { backgrounds: { body: { image: "data:image/svg+xml;base64,PHN2Zz4=" } } },
  { backgrounds: { header: { opacity: 1.1 } } }, { colors: { border: "red" } },
  { typography: { balance: { fontFamily: "https://fonts.test/remote" } } },
  { visibility: { finalTotal: "false" } }, { stamp: { rotation: 91 } },
  { rich: { headerHtml: "<script>alert(1)</script>" } },
  { rich: { footerHtml: "<p onclick=\"run()\">No</p>" } },
  { rich: { headerHtml: "<img src=\"https://example.test/tracker.png\">" } },
  { onlinePayment: { url: "javascript:alert(1)" } },
  { onlinePayment: { url: "https://example.test/\" onclick=\"run()" } },
  { terms: { placement: "random" } }, { signature: { width: 0 } },
  { receiverSignature: { enabled: "yes" } },
  { bank: { fields: Array.from({ length: 21 }, () => ({ label: "A", value: "B" })) } },
  { appendices: Array.from({ length: 13 }, () => ({ title: "A", html: "", image: "" })) },
  { appendices: [{ title: "A", html: "<p style=\"color:red\">No</p>", image: "" }] },
  { unrecognizedSetting: true },
]) assert.throws(() => cleanDocumentAdvanced(invalid), undefined, `reject invalid advanced settings: ${JSON.stringify(invalid).slice(0, 100)}`);

assert.equal(DOCUMENT_TEMPLATE_PRESETS.length, 12);
for (const preset of DOCUMENT_TEMPLATE_PRESETS) {
  const config = preset.config;
  const resolved = cleanDocumentDesign(config.design, config);
  assert.equal(resolved.advanced?.typography.title.fontSize, resolved.typography.header.fontSize, `${preset.name}: preset title inherits its original style`);
  assert.equal(resolved.advanced?.typography.itemDescription.fontFamily, resolved.typography.table.fontFamily, `${preset.name}: preset table font preserved`);
}
console.log("Advanced document design checks passed: additive old snapshots, 16 columns, six document kinds, 12 preserved presets, all controls roundtrip, passive artwork and rich-content validation.");
