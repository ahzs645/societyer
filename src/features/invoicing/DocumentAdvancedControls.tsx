import { Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { Select } from "../../components/Select";
import {
  DOCUMENT_ADVANCED_LABEL_KEYS, DOCUMENT_BLOCK_PLACEMENTS, DOCUMENT_ELEMENT_TYPOGRAPHY_KEYS,
  resolveDocumentAdvanced, type AdvancedDocumentDesign, type DocumentDesign, type DocumentTypography,
} from "../../../shared/invoiceCommerce";
import { DesignNumber, DesignSection } from "./DocumentDesignControls";
import { DocumentHttpsLinkField, DocumentImageUpload, DocumentRichEditor } from "./DocumentArtworkFields";
import { DOCUMENT_FONT_OPTIONS } from "./documentFontOptions";
type Props = { design: DocumentDesign; update: (patch: Partial<DocumentDesign>) => void };
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
const placementOptions = DOCUMENT_BLOCK_PLACEMENTS.map((value) => ({ value, label: words(value) }));
const useValues = ({ design, update }: Props) => {
  const value = design.advanced ?? resolveDocumentAdvanced(design);
  return { value, patch: (patch: Partial<AdvancedDocumentDesign>) => update({ advanced: { ...value, ...patch } }) };
};
function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><input className="input document-designer__color" type="color" value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}

export function DocumentGeometryControls(props: Props) {
  const { value: advanced, patch } = useValues(props);
  const page = advanced.page, number = page.pageNumber;
  return <DesignSection id="geometry" title="Advanced geometry" hint="Custom dimensions and offsets are in points. Absolute block positions use the page's top-left corner; custom page numbers use the bottom-left.">
    <Checkbox label="Use custom page dimensions" checked={page.customSize} onChange={(customSize) => patch({ page: { ...page, customSize } })} />
    <div className="document-designer__grid"><DesignNumber label="Custom page width (pt)" value={page.width} min={144} max={2000} onChange={(width) => patch({ page: { ...page, width } })} /><DesignNumber label="Custom page height (pt)" value={page.height} min={144} max={2000} onChange={(height) => patch({ page: { ...page, height } })} /><DesignNumber label="Minimum first-page header height (pt)" value={page.firstHeaderHeight} min={0} max={500} onChange={(firstHeaderHeight) => patch({ page: { ...page, firstHeaderHeight } })} /><DesignNumber label="Logo height (pt, 0 = automatic)" value={advanced.logo.height} min={0} max={500} onChange={(height) => patch({ logo: { ...advanced.logo, height } })} /></div>
    <p className="muted">A header height of 0 fits its content automatically. Taller content always expands the header.</p>
    <Checkbox label="Preserve logo proportions" checked={advanced.logo.preserveAspectRatio} onChange={(preserveAspectRatio) => patch({ logo: { ...advanced.logo, preserveAspectRatio } })} />
    <div className="document-designer__grid"><Field label="Page number position"><Select value={number.position} options={[{ value: "footer", label: "Footer" }, { value: "custom", label: "Custom coordinates" }]} onChange={(position) => patch({ page: { ...page, pageNumber: { ...number, position: position as typeof number.position } } })} /></Field><Field label="Page number alignment"><Select value={number.alignment} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} onChange={(alignment) => patch({ page: { ...page, pageNumber: { ...number, alignment: alignment as typeof number.alignment } } })} /></Field><DesignNumber label="Page number X (pt)" value={number.x} min={0} max={2000} onChange={(x) => patch({ page: { ...page, pageNumber: { ...number, x } } })} /><DesignNumber label="Page number Y (pt)" value={number.y} min={0} max={2000} onChange={(y) => patch({ page: { ...page, pageNumber: { ...number, y } } })} /></div>
  </DesignSection>;
}

export function DocumentAddressControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="addresses" title="Address blocks" hint="Leave the format blank for the default. Tokens: {{name}}, {{address}}, {{email}}, {{registrationNumber}}, {{taxNumber}}.">{(["organization", "billing", "shipping"] as const).map((key) => {
    const block = value.addresses[key], change = (changes: Partial<typeof block>) => patch({ addresses: { ...value.addresses, [key]: { ...block, ...changes } } });
    return <fieldset className="document-designer__fieldset" key={key}><legend>{words(key)}</legend><Field label={`${words(key)} address format`}><textarea className="input textarea" value={block.format} maxLength={2000} onChange={(event) => change({ format: event.target.value })} /></Field><Field label={`${words(key)} address placement`}><Select value={block.placement} options={[{ value: "flow", label: "In content flow" }, { value: "absolute", label: "Absolute coordinates" }]} onChange={(placement) => change({ placement: placement as typeof block.placement })} /></Field><div className="document-designer__grid"><DesignNumber label={`${words(key)} address X (pt)`} value={block.x} min={0} max={2000} onChange={(x) => change({ x })} /><DesignNumber label={`${words(key)} address Y (pt)`} value={block.y} min={0} max={2000} onChange={(y) => change({ y })} /><DesignNumber label={`${words(key)} address width (pt)`} value={block.width} min={24} max={1000} onChange={(width) => change({ width })} /></div></fieldset>;
  })}</DesignSection>;
}

export function DocumentArtworkControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="artwork" title="Artwork & colors">
    {(["body", "header", "footer"] as const).map((key) => {
      const background = value.backgrounds[key], change = (changes: Partial<typeof background>) => patch({ backgrounds: { ...value.backgrounds, [key]: { ...background, ...changes } } });
      return <fieldset className="document-designer__fieldset" key={key}><legend>{words(key)} background</legend><Color label={`${words(key)} background color`} value={background.color} onChange={(color) => change({ color })} /><DocumentImageUpload label={`${words(key)} background image`} value={background.image} onChange={(image) => change({ image })} /><DesignNumber label={`${words(key)} image opacity`} value={background.opacity} min={0} max={1} step={0.05} onChange={(opacity) => change({ opacity })} /><div className="document-designer__grid"><Field label={`${words(key)} image position`}><Select value={background.position} options={["top_left", "top_center", "top_right", "center", "bottom_left", "bottom_center", "bottom_right"].map((position) => ({ value: position, label: words(position) }))} onChange={(position) => change({ position: position as typeof background.position })} /></Field><Field label={`${words(key)} image fit`}><Select value={background.fit} options={[{ value: "contain", label: "Fit inside" }, { value: "cover", label: "Fill and crop" }, { value: "stretch", label: "Stretch" }]} onChange={(fit) => change({ fit: fit as typeof background.fit })} /></Field></div></fieldset>;
    })}
    <div className="document-designer__grid">{Object.entries(value.colors).map(([key, color]) => <Color key={key} label={`${words(key)} color`} value={color} onChange={(next) => patch({ colors: { ...value.colors, [key]: next } })} />)}</div>
    <p className="muted">Header, column-header and balance text colors are set in Element typography.</p>
  </DesignSection>;
}

export function DocumentElementControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="elements" title="Element typography" hint="These settings refine individual names, labels, descriptions and document blocks.">{DOCUMENT_ELEMENT_TYPOGRAPHY_KEYS.map((key) => {
    const type = value.typography[key], change = (changes: Partial<DocumentTypography>) => patch({ typography: { ...value.typography, [key]: { ...type, ...changes } } });
    return <fieldset className="document-designer__fieldset" key={key}><legend>{words(key)}</legend><div className="document-designer__grid"><Field label={`${words(key)} element font`}><Select value={type.fontFamily} options={DOCUMENT_FONT_OPTIONS} onChange={(fontFamily) => change({ fontFamily: fontFamily as DocumentTypography["fontFamily"] })} /></Field><DesignNumber label={`${words(key)} element size (pt)`} value={type.fontSize} min={6} max={60} onChange={(fontSize) => change({ fontSize })} /><Color label={`${words(key)} element text color`} value={type.color} onChange={(color) => change({ color })} /></div></fieldset>;
  })}</DesignSection>;
}

export function DocumentVisibilityControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="visibility" title="Additional fields & stamps">
    <div className="document-designer__grid">{Object.entries(value.visibility).map(([key, checked]) => <Checkbox key={key} label={`Show ${words(key).toLowerCase()}`} checked={checked} onChange={(next) => patch({ visibility: { ...value.visibility, [key]: next } })} />)}</div>
    <Field label="Custom status stamp text" hint="Blank uses the document's current status."><input className="input" value={value.stamp.text} maxLength={80} onChange={(event) => patch({ stamp: { ...value.stamp, text: event.target.value } })} /></Field><div className="document-designer__grid"><Color label="Status stamp color" value={value.stamp.color} onChange={(color) => patch({ stamp: { ...value.stamp, color } })} /><DesignNumber label="Status stamp rotation" value={value.stamp.rotation} min={-90} max={90} onChange={(rotation) => patch({ stamp: { ...value.stamp, rotation } })} /><Field label="Status stamp placement"><Select value={value.stamp.placement} options={[{ value: "header", label: "Header" }, { value: "customer", label: "Customer" }, { value: "totals", label: "Totals" }]} onChange={(placement) => patch({ stamp: { ...value.stamp, placement: placement as typeof value.stamp.placement } })} /></Field></div>
    <div className="document-designer__grid">{DOCUMENT_ADVANCED_LABEL_KEYS.map((key) => <Field label={`${words(key)} block label`} key={key}><input className="input" value={value.labels[key]} maxLength={80} onChange={(event) => patch({ labels: { ...value.labels, [key]: event.target.value } })} /></Field>)}</div>
  </DesignSection>;
}

export function DocumentRichBandControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="rich" title="Rich headers & footers" hint="Rich content accompanies the corresponding plain-text band. The same first-page and continuation repeat settings apply.">{(["headerHtml", "continuationHeaderHtml", "footerHtml", "continuationFooterHtml"] as const).map((key) => <DocumentRichEditor key={key} label={`${words(key.replace(/Html$/, ""))} rich content`} value={value.rich[key]} onChange={(html) => patch({ rich: { ...value.rich, [key]: html } })} />)}</DesignSection>;
}

export function DocumentPaymentControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="payments" title="Terms, bank & payment blocks">
    <fieldset className="document-designer__fieldset"><legend>Terms & conditions</legend><Checkbox label="Show terms and conditions" checked={value.terms.enabled} onChange={(enabled) => patch({ terms: { ...value.terms, enabled } })} /><DocumentRichEditor label="Terms and conditions content" value={value.terms.html} onChange={(html) => patch({ terms: { ...value.terms, html } })} /><Field label="Terms block placement"><Select value={value.terms.placement} options={placementOptions} onChange={(placement) => patch({ terms: { ...value.terms, placement: placement as typeof value.terms.placement } })} /></Field></fieldset>
    <fieldset className="document-designer__fieldset"><legend>Bank details</legend><Checkbox label="Show bank details" checked={value.bank.enabled} onChange={(enabled) => patch({ bank: { ...value.bank, enabled } })} />{value.bank.fields.map((field, index) => <div className="document-designer__bank-row" key={index}><Field label={`Bank field ${index + 1} label`}><input className="input" value={field.label} maxLength={80} onChange={(event) => patch({ bank: { ...value.bank, fields: value.bank.fields.map((entry, at) => at === index ? { ...entry, label: event.target.value } : entry) } })} /></Field><Field label={`Bank field ${index + 1} value`}><input className="input" value={field.value} maxLength={500} onChange={(event) => patch({ bank: { ...value.bank, fields: value.bank.fields.map((entry, at) => at === index ? { ...entry, value: event.target.value } : entry) } })} /></Field><button type="button" className="btn btn--sm" aria-label={`Remove bank field ${index + 1}`} onClick={() => patch({ bank: { ...value.bank, fields: value.bank.fields.filter((_, at) => at !== index) } })}>Remove</button></div>)}<button type="button" className="btn btn--sm" disabled={value.bank.fields.length >= 20} onClick={() => patch({ bank: { ...value.bank, fields: [...value.bank.fields, { label: "Account name", value: "" }] } })}>Add bank field</button><Field label="Bank block placement"><Select value={value.bank.placement} options={placementOptions} onChange={(placement) => patch({ bank: { ...value.bank, placement: placement as typeof value.bank.placement } })} /></Field></fieldset>
    <fieldset className="document-designer__fieldset"><legend>Online payment</legend><Checkbox label="Show online payment block" checked={value.onlinePayment.enabled} onChange={(enabled) => patch({ onlinePayment: { ...value.onlinePayment, enabled } })} /><DocumentHttpsLinkField value={value.onlinePayment.url} onChange={(url) => patch({ onlinePayment: { ...value.onlinePayment, url } })} /><Field label="Online payment link text"><input className="input" value={value.onlinePayment.label} maxLength={80} onChange={(event) => patch({ onlinePayment: { ...value.onlinePayment, label: event.target.value } })} /></Field><Checkbox label="Show payment QR code" checked={value.onlinePayment.showQr} onChange={(showQr) => patch({ onlinePayment: { ...value.onlinePayment, showQr } })} /><Field label="Online payment placement"><Select value={value.onlinePayment.placement} options={placementOptions} onChange={(placement) => patch({ onlinePayment: { ...value.onlinePayment, placement: placement as typeof value.onlinePayment.placement } })} /></Field></fieldset>
    <fieldset className="document-designer__fieldset"><legend>Payment stub</legend><Checkbox label="Show payment stub" checked={value.paymentStub.enabled} onChange={(enabled) => patch({ paymentStub: { ...value.paymentStub, enabled } })} /><Checkbox label="Payment stub on first page only" checked={value.paymentStub.firstPageOnly} onChange={(firstPageOnly) => patch({ paymentStub: { ...value.paymentStub, firstPageOnly } })} /><Field label="Payment stub instructions"><textarea className="input textarea" value={value.paymentStub.instructions} maxLength={2000} onChange={(event) => patch({ paymentStub: { ...value.paymentStub, instructions: event.target.value } })} /></Field><p className="muted">The detachable stub appears at the page footer.</p></fieldset>
  </DesignSection>;
}

export function DocumentTaxDisplayControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="taxdisplay" title="Tax & currency display" hint="These controls format recorded invoice amounts. Currency conversion and adjustments come from the invoice's accounting data.">
    <Checkbox label="Show tax summary table" checked={value.taxSummary.enabled} onChange={(enabled) => patch({ taxSummary: { ...value.taxSummary, enabled } })} /><Checkbox label="Show tax summary taxable bases" checked={value.taxSummary.showTaxableBase} onChange={(showTaxableBase) => patch({ taxSummary: { ...value.taxSummary, showTaxableBase } })} /><Checkbox label="Show tax summary tax amounts" checked={value.taxSummary.showTaxAmount} onChange={(showTaxAmount) => patch({ taxSummary: { ...value.taxSummary, showTaxAmount } })} /><Field label="Tax summary placement"><Select value={value.taxSummary.placement} options={placementOptions} onChange={(placement) => patch({ taxSummary: { ...value.taxSummary, placement: placement as typeof value.taxSummary.placement } })} /></Field>
    <Checkbox label="Show amount in words" checked={value.amountWords.enabled} onChange={(enabled) => patch({ amountWords: { ...value.amountWords, enabled } })} /><Field label="Amount in words placement"><Select value={value.amountWords.placement} options={placementOptions} onChange={(placement) => patch({ amountWords: { ...value.amountWords, placement: placement as typeof value.amountWords.placement } })} /></Field><Checkbox label="Show parallel base-currency amounts" checked={value.baseCurrency.enabled} onChange={(enabled) => patch({ baseCurrency: { ...value.baseCurrency, enabled } })} /><Checkbox label="Show recorded exchange rate" checked={value.baseCurrency.showRate} onChange={(showRate) => patch({ baseCurrency: { ...value.baseCurrency, showRate } })} />
    {Object.entries(value.adjustments).map(([key, checked]) => <Checkbox key={key} label={words(key)} checked={checked} onChange={(next) => patch({ adjustments: { ...value.adjustments, [key]: next } })} />)}
  </DesignSection>;
}

export function DocumentSignatureControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="signatures" title="Signature artwork & placement">{(["signature", "receiverSignature"] as const).map((key) => {
    const signature = value[key], change = (changes: Partial<typeof signature>) => patch({ [key]: { ...signature, ...changes } });
    const prefix = key === "signature" ? "Authorized signature" : "Receiver signature";
    return <fieldset className="document-designer__fieldset" key={key}><legend>{prefix}</legend>{key === "receiverSignature" && <><Checkbox label="Show receiver signature" checked={value.receiverSignature.enabled} onChange={(enabled) => patch({ receiverSignature: { ...value.receiverSignature, enabled } })} /><Field label="Receiver signature label"><input className="input" value={value.receiverSignature.label} maxLength={80} onChange={(event) => patch({ receiverSignature: { ...value.receiverSignature, label: event.target.value } })} /></Field><Field label="Receiver signature name"><input className="input" value={value.receiverSignature.name} maxLength={200} onChange={(event) => patch({ receiverSignature: { ...value.receiverSignature, name: event.target.value } })} /></Field></>}<DocumentImageUpload label={`${prefix} image`} value={signature.image} onChange={(image) => change({ image })} /><Field label={`${prefix} placement`}><Select value={signature.placement} options={[{ value: "flow", label: "In content flow" }, { value: "absolute", label: "Absolute coordinates" }]} onChange={(placement) => change({ placement: placement as typeof signature.placement })} /></Field><div className="document-designer__grid"><DesignNumber label={`${prefix} X (pt)`} value={signature.x} min={0} max={2000} onChange={(x) => change({ x })} /><DesignNumber label={`${prefix} Y (pt)`} value={signature.y} min={0} max={2000} onChange={(y) => change({ y })} /><DesignNumber label={`${prefix} width (pt)`} value={signature.width} min={16} max={500} onChange={(width) => change({ width })} /><DesignNumber label={`${prefix} height (pt)`} value={signature.height} min={8} max={250} onChange={(height) => change({ height })} /></div></fieldset>;
  })}</DesignSection>;
}

export function DocumentAnnexControls(props: Props) {
  const { value, patch } = useValues(props);
  return <DesignSection id="annexures" title="Appendices & inventory annexures"><Checkbox label="Show attachments and inventory annexure" checked={value.annexures.enabled} onChange={(enabled) => patch({ annexures: { ...value.annexures, enabled } })} /><Field label="Inventory annexure title"><input className="input" value={value.annexures.title} maxLength={100} onChange={(event) => patch({ annexures: { ...value.annexures, title: event.target.value } })} /></Field><Checkbox label="Show document attachments" checked={value.annexures.showAttachments} onChange={(showAttachments) => patch({ annexures: { ...value.annexures, showAttachments } })} /><Checkbox label="Show inventory batch table" checked={value.annexures.showBatches} onChange={(showBatches) => patch({ annexures: { ...value.annexures, showBatches } })} /><Checkbox label="Show inventory serial table" checked={value.annexures.showSerials} onChange={(showSerials) => patch({ annexures: { ...value.annexures, showSerials } })} />
    {value.appendices.map((appendix, index) => {
      const change = (changes: Partial<typeof appendix>) => patch({ appendices: value.appendices.map((entry, at) => at === index ? { ...entry, ...changes } : entry) });
      return <fieldset className="document-designer__fieldset" key={index}><legend>Appendix {index + 1}</legend><Field label={`Appendix ${index + 1} title`}><input className="input" value={appendix.title} maxLength={100} onChange={(event) => change({ title: event.target.value })} /></Field><DocumentRichEditor label={`Appendix ${index + 1} content`} value={appendix.html} onChange={(html) => change({ html })} /><DocumentImageUpload label={`Appendix ${index + 1} image`} value={appendix.image} onChange={(image) => change({ image })} /><button type="button" className="btn btn--sm" onClick={() => patch({ appendices: value.appendices.filter((_, at) => at !== index) })}>Remove appendix {index + 1}</button></fieldset>;
    })}<button type="button" className="btn btn--sm" disabled={value.appendices.length >= 12} onClick={() => patch({ appendices: [...value.appendices, { title: `Appendix ${value.appendices.length + 1}`, html: "", image: "" }] })}>Add appendix</button>
  </DesignSection>;
}
