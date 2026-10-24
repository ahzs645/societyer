import { invoiceBrandLogo } from "../../../shared/invoiceBranding";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { InvoiceTemplate, DocumentSectionKey } from "../../../shared/invoiceCommerce";
import type { DocumentExtras, DocumentCustomTable, DocumentSummaryRow } from "../../../shared/documentExtras";
import type { InvoiceMoneyOptions } from "../../../shared/invoiceMoney";
import type { InvoiceLine } from "../../../shared/invoicing";
import type { InvoiceOrganization, InvoicePaymentView } from "./types";
import { documentCssFont, documentPresentation, numericDocumentColumn, documentAddressLines, documentBackgroundCss } from "./documentPresentation";
import { cleanDocumentImage } from "../../../shared/documentRichContent";
import { DocumentRichContent } from "./DocumentRichContent";
import { DocumentAdvancedBlocks } from "./DocumentAdvancedBlocks";
import "./documentPreview.css";

export type InvoiceDocumentData = {
  documentTemplate?: InvoiceTemplate;
  documentKind?: "invoice" | "receipt" | "work_order" | "quote" | "statement";
  documentExtras?: DocumentExtras;
  documentTable?: DocumentCustomTable;
  documentSummary?: DocumentSummaryRow[];
  /** Numeric statement amounts accompany formatted rows; never infer money from display text. */
  documentFinancials?: { totalCents: number; balanceCents?: number };
  money?: InvoiceMoneyOptions;
  documentDetails?: Array<{ label: string; value: string }>;
  shipToName?: string;
  shipToAddress?: string;
  number: string;
  issueDate: string;
  dueDate: string;
  terms: string;
  reference?: string;
  currency: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
  lines: Array<InvoiceLine & { sku?: string }>;
  discount?: { kind: "percent" | "amount"; value: number };
  memo?: string;
  payments?: InvoicePaymentView[];
  status?: string;
};
export type InvoiceDocumentProps = {
  invoice: InvoiceDocumentData;
  organization: InvoiceOrganization & { logoUrl?: string | null };
  paymentInstructions?: string;
};

/** The flowing HTML preview shares its normalized data, settings and blocks with the PDF. */
export function InvoiceDocument({ invoice, organization, paymentInstructions }: InvoiceDocumentProps) {
  const data = documentPresentation(invoice), { config, design, advanced: a, extras, kind, title, columns, cellValue, summary, metadata, page } = data;
  const brand = config.brand;
  const logo = brand ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(invoiceBrandLogo(brand, config.logoVariant))}` : organization.logoUrl;
  const typography = (section: keyof typeof design.typography): CSSProperties => { const type = design.typography[section]; return { fontFamily: documentCssFont(type.fontFamily, brand?.font), fontSize: `${type.fontSize}pt`, color: type.color }; };
  const element = (key: keyof typeof a.typography): CSSProperties => { const type = a.typography[key]; return { fontFamily: documentCssFont(type.fontFamily, brand?.font), fontSize: `${type.fontSize}pt`, color: type.color }; };
  const address = (key: "organization" | "billing" | "shipping") => {
    const settings = a.addresses[key], org = key === "organization";
    const source = org ? { name: a.visibility.organizationName ? organization.name || "Your organization" : "", address: a.visibility.organizationAddress ? organization.address : "", email: a.visibility.organizationAddress ? organization.email : "", registrationNumber: a.visibility.organizationAddress ? organization.registrationNumber : "", taxNumber: organization.gstNumber } : key === "billing" ? { name: invoice.billToName || "—", address: invoice.billToAddress, email: design.fields.customerEmail ? invoice.billToEmail : "" } : { name: invoice.shipToName, address: invoice.shipToAddress };
    return <div key={key} className="document-preview__address" style={settings.placement === "absolute" ? { position: "absolute", left: `${settings.x}pt`, top: `${settings.y}pt`, width: `${Math.min(settings.width, page.width - settings.x)}pt`, zIndex: 2 } : undefined}>
      {!org && (key !== "billing" || a.visibility.billTo) && <strong style={element("labels")}>{key === "billing" ? design.labels.billTo : design.labels.shipTo}</strong>}
      {documentAddressLines(settings, source).split("\n").map((line, index) => <p key={index} style={element(line.includes(source.name || "\u0000") ? org ? "organizationName" : "customerName" : org ? "organizationAddress" : "customerAddress")}>{line}</p>)}
    </div>;
  };
  const stamp = (where: typeof a.stamp.placement) => a.visibility.statusStamp && kind === "invoice" && invoice.status && where === a.stamp.placement ? <div className="document-preview__status" style={{ color: a.stamp.color, borderColor: a.stamp.color, transform: `rotate(${a.stamp.rotation}deg)` }}>{a.stamp.text || invoice.status.toUpperCase()}</div> : null;
  const signature = (receiver = false) => {
    const settings = receiver ? a.receiverSignature : a.signature;
    if (receiver ? !a.receiverSignature.enabled : !design.signature.enabled) return null;
    return <section className="document-preview__signature" style={{ ...element("signature"), width: `${settings.width}pt`, ...(settings.placement === "absolute" ? { position: "absolute", left: `${settings.x}pt`, top: `${settings.y}pt`, zIndex: 2, margin: 0 } : {}) }}>
      {settings.image && <img src={cleanDocumentImage(settings.image)} alt={receiver ? "Receiver signature" : "Authorized signature"} style={{ width: `${settings.width}pt`, height: `${settings.height}pt`, objectFit: "contain" }} />}
      <div style={{ borderColor: a.colors.border }}>{(receiver ? a.receiverSignature.name : design.signature.name) || "\u00a0"}</div><strong>{receiver ? a.receiverSignature.label : design.signature.label}</strong>
    </section>;
  };
  const cellStyle = (key: typeof columns[number]["key"]): CSSProperties => ({ padding: `${design.table.rowPadding}pt`, textAlign: numericDocumentColumn(key) ? "right" : "left", borderColor: a.colors.border, ...(key === "description" ? element("itemDescription") : {}) });
  const sections: Record<DocumentSectionKey, ReactNode> = {
    header: <header className="document-preview__header" style={{ ...typography("header"), borderColor: a.colors.border, minHeight: a.page.firstHeaderHeight ? `${a.page.firstHeaderHeight}pt` : undefined, backgroundColor: a.backgrounds.header.color }}>
      <div aria-hidden="true" className="document-preview__artwork" style={{ ...documentBackgroundCss(a.backgrounds.header), opacity: a.backgrounds.header.opacity }} />
      <div className="document-preview__logo-area" style={{ minWidth: `${Math.min(design.logo.width, page.width - design.page.margins.left - design.page.margins.right)}pt`, alignItems: design.logo.alignment === "center" ? "center" : design.logo.alignment === "right" ? "flex-end" : "flex-start" }}>
        {config.showLogo && logo && <img src={logo} alt={`${brand?.name || organization.name || "Organization"} logo`} style={{ width: `${design.logo.width}pt`, ...(a.logo.height > 0 ? { height: `${a.logo.height}pt`, objectFit: a.logo.preserveAspectRatio ? "contain" : "fill" } : {}), ...(config.logoVariant === "reverse" ? { background: brand?.primary || config.accentColor, padding: "6pt" } : {}) }} />}
        {config.showLogo && brand?.descriptor && <div style={{ fontSize: "8pt", fontFamily: brand.font === "inter" ? documentCssFont("space_mono") : undefined }}>{brand.descriptor}</div>}
      </div>
      <div className="document-preview__heading">{a.visibility.title && <h1 style={element("title")}>{title}</h1>}<dl>{metadata.map((item, index) => <div key={index} style={item.balance ? { backgroundColor: a.colors.balanceBackground, padding: 4 } : {}}><dt style={element("labels")}>{item.label}</dt><dd style={element(item.balance ? "balance" : item.number ? "documentNumber" : "labels")}>{item.value}</dd></div>)}</dl></div>{stamp("header")}
    </header>,
    customer: <section className="document-preview__parties" style={{ ...typography("customer"), backgroundColor: a.colors.sectionBackground }}>
      {design.fields.organization && a.addresses.organization.placement === "flow" && address("organization")}{a.addresses.billing.placement === "flow" && address("billing")}{design.fields.shipTo && (invoice.shipToName || invoice.shipToAddress) && a.addresses.shipping.placement === "flow" && address("shipping")}
      {invoice.documentDetails?.length ? <dl className="document-preview__details">{invoice.documentDetails.map((item, index) => <div key={index}><dt style={element("labels")}>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}{stamp("customer")}
    </section>,
    items: invoice.documentTable ? <table className="document-preview__table" style={typography("table")}><thead><tr>{invoice.documentTable.columns.map((column, i) => <th scope="col" key={i} style={{ ...element("columnHeader"), textAlign: column.align || "left", background: a.colors.tableHeaderBackground, width: `${(column.width || 1) / invoice.documentTable!.columns.reduce((sum, c) => sum + (c.width || 1), 0) * 100}%` }}>{column.label}</th>)}</tr></thead><tbody>{invoice.documentTable.rows.map((row, i) => <tr key={i} style={{ background: design.table.striped && i % 2 ? a.colors.alternateRowBackground : a.colors.rowBackground }}>{row.map((value, j) => <td key={j} style={{ padding: `${design.table.rowPadding}pt`, textAlign: invoice.documentTable!.columns[j]?.align || "left" }}>{value}</td>)}</tr>)}</tbody></table> : <table className="document-preview__table" style={typography("table")}>
      <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${column.width / columns.reduce((sum, c) => sum + c.width, 0) * 100}%` }} />)}</colgroup>
      <thead><tr>{columns.map((column) => <th scope="col" key={column.key} style={{ ...cellStyle(column.key), ...element("columnHeader"), background: a.colors.tableHeaderBackground }}>{column.label}{column.key === "rate" ? ` (${invoice.currency})` : ""}</th>)}</tr></thead>
      <tbody>{invoice.lines.map((line, index) => <tr key={line.key} style={{ background: design.table.striped && index % 2 ? a.colors.alternateRowBackground : a.colors.rowBackground }}>{columns.map((column) => <td key={column.key} style={cellStyle(column.key)}>{column.key === "image" && line.imageUrl ? <img src={cleanDocumentImage(line.imageUrl)} alt={`${line.item} item`} style={{ maxWidth: "100%", height: "42pt", objectFit: "contain" }} /> : cellValue(column.key, line, index)}</td>)}</tr>)}{!invoice.lines.length && <tr><td colSpan={columns.length}>No line items yet.</td></tr>}</tbody>
    </table>,
    totals: <section className="document-preview__totals" style={typography("totals")}><dl style={{ backgroundColor: a.colors.totalsBackground }}>{summary.map((item, index) => <div key={index} className={item.strong ? "document-preview__total" : undefined} style={{ ...(item.balance ? { ...element("balance"), backgroundColor: a.colors.balanceBackground } : {}), borderColor: a.colors.border }}><dt>{item.label}</dt><dd>{item.value}{item.base && <small>{a.labels.baseCurrency}: {item.base}</small>}</dd></div>)}{a.baseCurrency.enabled && a.baseCurrency.showRate && invoice.money?.fx && <p style={{ fontSize: "8pt" }}>1 {invoice.currency} = {invoice.money.fx.rateMicros / 1000000} {invoice.money.fx.baseCurrency} · {invoice.money.fx.asOfDate} · {invoice.money.fx.source}</p>}</dl>{stamp("totals")}</section>,
    notes: design.fields.notes && invoice.memo ? <section className="document-preview__notes" style={element("notes")}><strong style={element("labels")}>{design.labels.notes}</strong><p>{invoice.memo}</p></section> : null,
    paymentInstructions: kind === "invoice" && config.showPaymentInstructions && paymentInstructions ? <section className="document-preview__notes" style={element("payment")}><strong style={element("labels")}>{design.labels.paymentInstructions}</strong><p>{paymentInstructions}</p></section> : null,
    signature: <>{a.signature.placement === "flow" && signature()}{a.receiverSignature.placement === "flow" && signature(true)}</>,
  };
  const margin = design.page.margins, advancedBlock = (placement: "before_items" | "after_items" | "after_totals" | "end") => <DocumentAdvancedBlocks data={data} placement={placement} />;
  return <article className={`invoice-doc document-preview document-preview--${config.layout}`} aria-label={`${title} ${invoice.number}`} data-document-kind={kind} style={{ ...typography("body"), "--invoice-accent": config.accentColor, background: a.backgrounds.body.color, boxSizing: "border-box", width: `${page.width}pt`, minHeight: `${page.height}pt`, maxWidth: "100%", padding: `${margin.top}pt ${margin.right}pt ${margin.bottom}pt ${margin.left}pt` } as CSSProperties}>
    <div aria-hidden="true" className="document-preview__artwork" style={{ ...documentBackgroundCss(a.backgrounds.body), opacity: a.backgrounds.body.opacity }} />
    {design.header.text && <div className="document-preview__band" style={typography("header")}>{design.header.text}</div>}{a.rich.headerHtml && <DocumentRichContent html={a.rich.headerHtml} />}
    {design.sections.map((key) => <div key={key} data-document-section={key}>{key === "items" && advancedBlock("before_items")}{key === "items" && data.taxModeLabel && <p style={element("labels")}>{data.taxModeLabel}</p>}{sections[key]}{key === "items" && advancedBlock("after_items")}{key === "totals" && advancedBlock("after_totals")}</div>)}{advancedBlock("end")}
    {design.fields.taxRegistration && organization.gstNumber && <div className="document-preview__tax" style={typography("footer")}>GST/HST registration no. {organization.gstNumber}</div>}
    {data.paymentStubDetails && <section className="document-preview__stub" style={element("payment")}><strong>{a.labels.paymentStub}</strong><p>{invoice.number} · {invoice.billToName}</p><p>{data.paymentStubDetails.totalLabel}: {data.paymentStubDetails.total}{data.paymentStubDetails.showBalance && <> · {data.paymentStubDetails.balanceLabel}: {data.paymentStubDetails.balance}</>}</p><p>{a.paymentStub.instructions}</p></section>}
    <footer className="document-preview__footer" style={{ ...typography("footer"), backgroundColor: a.backgrounds.footer.color }}><div aria-hidden="true" className="document-preview__artwork" style={{ ...documentBackgroundCss(a.backgrounds.footer), opacity: a.backgrounds.footer.opacity }} />{design.footer.text && <p>{design.footer.text}</p>}{a.rich.footerHtml && <DocumentRichContent html={a.rich.footerHtml} />}{design.footer.pageNumbers && <span style={{ textAlign: a.page.pageNumber.alignment }}>{design.footer.pageNumberFormat === "page_of_total" ? "Page 1" : "1"}</span>}</footer>
    {design.fields.organization && a.addresses.organization.placement === "absolute" && address("organization")}{a.addresses.billing.placement === "absolute" && address("billing")}{design.fields.shipTo && a.addresses.shipping.placement === "absolute" && address("shipping")}{a.signature.placement === "absolute" && signature()}{a.receiverSignature.placement === "absolute" && signature(true)}
    {a.annexures.enabled && (extras.annexures || []).map((annex, index) => <section className="document-preview__appendix" key={`annex-${index}`}><h2>{annex.title}</h2><table className="document-preview__table"><thead><tr>{annex.columns.map((column, i) => <th key={i}>{column}</th>)}</tr></thead><tbody>{annex.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></section>)}
    {a.annexures.enabled && data.inventoryRows.length > 0 && <section className="document-preview__appendix"><h2>{a.annexures.title}</h2><table className="document-preview__table"><thead><tr><th>{design.labels.item}</th><th>{design.labels.sku}</th><th>Batch</th><th>Serial numbers</th></tr></thead><tbody>{data.inventoryRows.map((row, i) => <tr key={i}><td>{row.item}</td><td>{row.sku}</td><td>{row.batch}</td><td>{row.serials}</td></tr>)}</tbody></table></section>}
    {a.appendices.map((appendix, index) => <section className="document-preview__appendix" key={`appendix-${index}`}><h2>{appendix.title}</h2>{appendix.html && <DocumentRichContent html={appendix.html} />}{appendix.image && <img src={cleanDocumentImage(appendix.image)} alt={appendix.title} style={{ maxWidth: "100%" }} />}</section>)}
    {a.annexures.enabled && a.annexures.showAttachments && extras.attachments?.map((attachment, index) => <section className="document-preview__appendix" key={`attachment-${index}`}><h2>{attachment.name}</h2>{attachment.mimeType === "application/pdf" ? <a href={attachment.dataUrl} download={attachment.name}>Download attached PDF</a> : <img src={cleanDocumentImage(attachment.dataUrl)} alt={attachment.name} style={{ maxWidth: "100%" }} />}</section>)}
  </article>;
}
/** Browser printing uses paged-media margin boxes; the PDF download is the exact preview. */
export function InvoicePrintPortal(props: InvoiceDocumentProps) {
  if (typeof document === "undefined") return null;
  const { design, config } = documentPresentation(props.invoice);
  const cssText = (value: string) => JSON.stringify(value).replace(/\\n/g, "\\A ");
  const margin = design.page.margins;
  const pageNumber = design.footer.pageNumbers ? design.footer.pageNumberFormat === "page_of_total" ? '\"Page \" counter(page) \" of \" counter(pages)' : "counter(page)" : "none";
  const headerStyle = `font-family:${documentCssFont(design.typography.header.fontFamily, config.brand?.font)};font-size:${design.typography.header.fontSize}pt;color:${design.typography.header.color};white-space:pre-wrap;`;
  const footerStyle = `font-family:${documentCssFont(design.typography.footer.fontFamily, config.brand?.font)};font-size:${design.typography.footer.fontSize}pt;color:${design.typography.footer.color};white-space:pre-wrap;`;
  const printCss = `@media print {
    @page { size:${config.paperSize === "a4" ? "A4" : "Letter"} ${design.page.orientation}; margin:${margin.top}pt ${margin.right}pt ${margin.bottom}pt ${margin.left}pt;
      @top-left {content:${design.header.repeat ? cssText(design.header.continuationText || design.header.text) : "none"};${headerStyle}}
      @bottom-left {content:${design.footer.repeat ? cssText(design.footer.continuationText || design.footer.text) : "none"};${footerStyle}}
      @bottom-right {content:${pageNumber};${footerStyle}}
    }
    @page :first { @top-left {content:${cssText(design.header.text)};} @bottom-left {content:${cssText(design.footer.text)};} }
    .invoice-print-portal .document-preview {padding:0 !important;width:auto !important;min-height:0 !important;}
    .invoice-print-portal .document-preview__band,.invoice-print-portal .document-preview__footer {display:none !important;}
  }`;
  return createPortal(<div className={`invoice-print-portal invoice-print-portal--${config.paperSize}`} aria-hidden="true"><style>{printCss}</style><InvoiceDocument {...props} /></div>, document.body);
}
