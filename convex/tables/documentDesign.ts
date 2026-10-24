import { v } from "convex/values";
import { DOCUMENT_ADVANCED_LABEL_KEYS, DOCUMENT_LABEL_KEYS } from "../../shared/documentDesign";

export const documentFontValidator = v.union(v.literal("brand"), v.literal("sans"), v.literal("serif"), v.literal("mono"), v.literal("inter"), v.literal("inter_display"), v.literal("space_mono"), v.literal("noto_serif"), v.literal("open_sans"), v.literal("liberation_serif"));
export const documentTypographyValidator = v.object({ fontFamily: documentFontValidator, fontSize: v.number(), color: v.string() });
const placement = v.union(v.literal("before_items"), v.literal("after_items"), v.literal("after_totals"), v.literal("end"));
const positioning = v.union(v.literal("flow"), v.literal("absolute"));
const address = v.object({ format: v.string(), placement: positioning, x: v.number(), y: v.number(), width: v.number() });
const background = v.object({ color: v.string(), image: v.string(), opacity: v.number(), position: v.union(v.literal("top_left"), v.literal("top_center"), v.literal("top_right"), v.literal("center"), v.literal("bottom_left"), v.literal("bottom_center"), v.literal("bottom_right")), fit: v.union(v.literal("contain"), v.literal("cover"), v.literal("stretch")) });
const signatureFields = { image: v.string(), placement: positioning, x: v.number(), y: v.number(), width: v.number(), height: v.number() };
export const advancedDocumentDesignValidator = v.object({
  page: v.object({ customSize: v.boolean(), width: v.number(), height: v.number(), firstHeaderHeight: v.number(), pageNumber: v.object({ position: v.union(v.literal("footer"), v.literal("custom")), alignment: v.union(v.literal("left"), v.literal("center"), v.literal("right")), x: v.number(), y: v.number() }) }),
  logo: v.object({ height: v.number(), preserveAspectRatio: v.boolean() }),
  addresses: v.object({ organization: address, billing: address, shipping: address }),
  backgrounds: v.object({ body: background, header: background, footer: background }),
  colors: v.object({ border: v.string(), sectionBackground: v.string(), tableHeaderBackground: v.string(), rowBackground: v.string(), alternateRowBackground: v.string(), totalsBackground: v.string(), balanceBackground: v.string() }),
  typography: v.object({ organizationName: documentTypographyValidator, organizationAddress: documentTypographyValidator, customerName: documentTypographyValidator, customerAddress: documentTypographyValidator, labels: documentTypographyValidator, title: documentTypographyValidator, documentNumber: documentTypographyValidator, itemDescription: documentTypographyValidator, columnHeader: documentTypographyValidator, balance: documentTypographyValidator, notes: documentTypographyValidator, terms: documentTypographyValidator, signature: documentTypographyValidator, payment: documentTypographyValidator }),
  visibility: v.object({ organizationName: v.boolean(), organizationAddress: v.boolean(), title: v.boolean(), documentNumber: v.boolean(), billTo: v.boolean(), finalTotal: v.boolean(), headerBalance: v.boolean(), statusStamp: v.boolean() }),
  labels: v.object(Object.fromEntries(DOCUMENT_ADVANCED_LABEL_KEYS.map((key) => [key, v.string()]))),
  stamp: v.object({ text: v.string(), color: v.string(), rotation: v.number(), placement: v.union(v.literal("header"), v.literal("customer"), v.literal("totals")) }),
  rich: v.object({ headerHtml: v.string(), continuationHeaderHtml: v.string(), footerHtml: v.string(), continuationFooterHtml: v.string() }),
  terms: v.object({ enabled: v.boolean(), html: v.string(), placement }),
  bank: v.object({ enabled: v.boolean(), fields: v.array(v.object({ label: v.string(), value: v.string() })), placement }),
  onlinePayment: v.object({ enabled: v.boolean(), url: v.string(), label: v.string(), showQr: v.boolean(), placement }),
  paymentStub: v.object({ enabled: v.boolean(), firstPageOnly: v.boolean(), instructions: v.string(), placement }),
  taxSummary: v.object({ enabled: v.boolean(), showTaxableBase: v.boolean(), showTaxAmount: v.boolean(), placement }),
  amountWords: v.object({ enabled: v.boolean(), placement }),
  baseCurrency: v.object({ enabled: v.boolean(), showRate: v.boolean() }),
  adjustments: v.object({ showShipping: v.boolean(), showCredits: v.boolean(), showWriteOff: v.boolean(), showWithholding: v.boolean() }),
  signature: v.object(signatureFields),
  receiverSignature: v.object({ ...signatureFields, enabled: v.boolean(), label: v.string(), name: v.string() }),
  annexures: v.object({ enabled: v.boolean(), title: v.string(), showAttachments: v.boolean(), showBatches: v.boolean(), showSerials: v.boolean() }),
  appendices: v.array(v.object({ title: v.string(), html: v.string(), image: v.string() })),
});

export const documentColumnKeyValidator = v.union(v.literal("number"), v.literal("sku"), v.literal("item"), v.literal("description"), v.literal("quantity"), v.literal("unit"), v.literal("rate"), v.literal("tax"), v.literal("amount"), v.literal("image"), v.literal("manufacturer"), v.literal("partNumber"), v.literal("upc"), v.literal("ean"), v.literal("isbn"), v.literal("customField"));
/** Advanced fields are additive to stored v1 designs; the portable cleaner supplies defaults. */
export const documentDesignValidator = v.object({
  version: v.literal(1), advanced: v.optional(advancedDocumentDesignValidator),
  page: v.object({ orientation: v.union(v.literal("portrait"), v.literal("landscape")), margins: v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() }) }),
  logo: v.object({ width: v.number(), alignment: v.union(v.literal("left"), v.literal("center"), v.literal("right")) }),
  typography: v.object({ body: documentTypographyValidator, header: documentTypographyValidator, customer: documentTypographyValidator, table: documentTypographyValidator, totals: documentTypographyValidator, footer: documentTypographyValidator }),
  labels: v.object(Object.fromEntries(DOCUMENT_LABEL_KEYS.map((key) => [key, v.string()]))),
  fields: v.object({ organization: v.boolean(), customerEmail: v.boolean(), issueDate: v.boolean(), dueDate: v.boolean(), terms: v.boolean(), reference: v.boolean(), shipTo: v.boolean(), notes: v.boolean(), taxRegistration: v.boolean() }),
  table: v.object({ columns: v.array(v.object({ key: documentColumnKeyValidator, label: v.string(), width: v.number(), visible: v.boolean() })), striped: v.boolean(), rowPadding: v.number() }),
  header: v.object({ text: v.string(), continuationText: v.string(), repeat: v.boolean() }),
  footer: v.object({ text: v.string(), continuationText: v.string(), repeat: v.boolean(), pageNumbers: v.boolean(), pageNumberFormat: v.union(v.literal("number"), v.literal("page_of_total")) }),
  titles: v.object({ invoice: v.string(), receipt: v.string(), work_order: v.string(), report: v.string(), quote: v.optional(v.string()), statement: v.optional(v.string()) }),
  sections: v.array(v.union(v.literal("header"), v.literal("customer"), v.literal("items"), v.literal("totals"), v.literal("notes"), v.literal("paymentInstructions"), v.literal("signature"))),
  signature: v.object({ enabled: v.boolean(), label: v.string(), name: v.string() }),
  totals: v.object({ showSubtotal: v.boolean(), showDiscount: v.boolean(), showTax: v.boolean(), showPaid: v.boolean(), showBalance: v.boolean() }),
});
