import svgpath from "svgpath";
import { Fragment, type ReactNode } from "react";
import { invoiceBrandPdfSvg } from "../../../shared/invoiceBranding";
import { Document, Page, View, Table, Row, Cell, Image, Svg, Text as NativeText, Strong, type FontRegistration, type Style } from "@formepdf/react";
import { PdfcnThemeProvider } from "../../components/pdf/theme-provider";
import { Text } from "../../components/pdf/text/text";
import { professionalTheme } from "../../lib/pdf-themes/professional";
import type { DocumentSectionKey } from "../../../shared/invoiceCommerce";
import { cleanDocumentImage, documentImageDimensions } from "../../../shared/documentRichContent";
import type { InvoiceDocumentData } from "./InvoiceDocument";
import type { InvoiceOrganization } from "./types";
import { documentPdfFontFamily, documentPresentation, numericDocumentColumn, documentAddressLines } from "./documentPresentation";
import { DocumentAdvancedPdfBlocks } from "./DocumentAdvancedBlocks";
import { DocumentArtworkPdf } from "./DocumentArtworkPdf";
import { DocumentRichPdf } from "./DocumentRichContent";

export type InvoicePdfProps = { invoice: InvoiceDocumentData; organization: InvoiceOrganization & { logoUrl?: string | null; logoAspectRatio?: number }; paymentInstructions?: string; fonts?: FontRegistration[] };

export function sizedBrandSvg(brand: NonNullable<InvoicePdfProps["invoice"]["documentTemplate"]>["brand"], variant: "primary" | "black" | "reverse" | undefined, width: number, height: number) {
  if (!brand) return "";
  const scaleY = height / (width * brand.logoHeight / brand.logoWidth);
  const source = invoiceBrandPdfSvg(brand, variant, width);
  if (Math.abs(scaleY - 1) < 0.00001) return source;
  return source.replace(/\bd="([^"]+)"/g, (_match, path: string) => `d="${svgpath(path).scale(1, scaleY).round(6).toString()}"`).replace(/<circle\b([^>]*)\/>/g, (_match, attributes: string) => {
    const attribute = (name: string) => Number(attributes.match(new RegExp(`${name}="([^"]+)"`))?.[1] || 0);
    const x = attribute("cx"), y = attribute("cy") * scaleY, rx = attribute("r"), ry = rx * scaleY, k = 0.552284749831;
    const fill = attributes.match(/fill="([^"]+)"/)?.[1] || brand.primary;
    return `<path fill="${fill}" d="M${x + rx} ${y}C${x + rx} ${y + k * ry} ${x + k * rx} ${y + ry} ${x} ${y + ry}C${x - k * rx} ${y + ry} ${x - rx} ${y + k * ry} ${x - rx} ${y}C${x - rx} ${y - k * ry} ${x - k * rx} ${y - ry} ${x} ${y - ry}C${x + k * rx} ${y - ry} ${x + rx} ${y - k * ry} ${x + rx} ${y}Z"/>`;
  });
}
export function documentPaymentStubHeight(data: ReturnType<typeof documentPresentation>) {
  if (!data.paymentStubDetails) return 0;
  const width = data.page.width - data.design.page.margins.left - data.design.page.margins.right;
  const size = data.advanced.typography.payment.fontSize;
  const lines = Math.max(1, Math.ceil(data.advanced.paymentStub.instructions.length / Math.max(20, width / (size * 0.55))));
  return 24 + (3 + lines) * size * 1.3;
}
/** Native Forme tables retain column widths and repeat their heading on every physical page. */
function InvoicePdfContent({ invoice, organization, paymentInstructions, fonts }: InvoicePdfProps) {
  const data = documentPresentation(invoice), { config, design, advanced: a, extras, kind, title, columns, cellValue, summary, metadata, page } = data;
  const margin = { ...design.page.margins, bottom: design.page.margins.bottom + documentPaymentStubHeight(data) };
  const extraPageMargin = { ...design.page.margins, bottom: design.page.margins.bottom + (a.paymentStub.firstPageOnly ? 0 : documentPaymentStubHeight(data)) };
  const contentWidth = page.width - margin.left - margin.right;
  if (contentWidth < 48 || page.height - margin.top - margin.bottom < 64) throw new Error("The page size, margins and payment stub leave too little room for document content.");
  const typeStyle = (section: keyof typeof design.typography): Style => ({ ...design.typography[section], fontFamily: documentPdfFontFamily(design.typography[section].fontFamily, fonts) });
  const element = (key: keyof typeof a.typography): Style => ({ ...a.typography[key], fontFamily: documentPdfFontFamily(a.typography[key].fontFamily, fonts) });
  const body = typeStyle("body"), header = typeStyle("header"), customer = typeStyle("customer"), table = typeStyle("table"), total = typeStyle("totals");
  const text = (value: string, style: Style = body) => <Text noMargin style={{ ...style }}>{value}</Text>;
  const block: Style = { marginBottom: 16 };
  const paragraphSection = (label: string, value: string, type: Style) => <View style={block}><NativeText style={{ ...type, minOrphanLines: 2, minWidowLines: 2 }}><Strong style={{ ...element("labels"), fontWeight: 700 }}>{label}</Strong>{"\n"}{value}</NativeText></View>;
  const requestedWidth = Math.min(design.logo.width, contentWidth), aspectRatio = config.brand ? config.brand.logoWidth / config.brand.logoHeight : organization.logoAspectRatio, naturalHeight = aspectRatio ? requestedWidth / aspectRatio : a.logo.height || requestedWidth * 0.4;
  const logoHeight = a.logo.height > 0 ? a.logo.height : naturalHeight;
  const logoWidth = a.logo.preserveAspectRatio && a.logo.height > 0 && aspectRatio ? Math.min(requestedWidth, a.logo.height * aspectRatio) : requestedWidth;
  const drawnHeight = a.logo.preserveAspectRatio && aspectRatio ? logoWidth / aspectRatio : logoHeight;
  const stackedHeader = logoWidth + 170 > contentWidth;
  const estimatedHeaderHeight = Math.max(a.page.firstHeaderHeight, drawnHeight + 20, a.typography.title.fontSize + metadata.length * (a.typography.labels.fontSize + 3) + 20);
  const address = (key: "organization" | "billing" | "shipping") => {
    const settings = a.addresses[key], org = key === "organization";
    const source = org ? { name: a.visibility.organizationName ? organization.name || "Your organization" : "", address: a.visibility.organizationAddress ? organization.address : "", email: a.visibility.organizationAddress ? organization.email : "", registrationNumber: a.visibility.organizationAddress ? organization.registrationNumber : "", taxNumber: organization.gstNumber } : key === "billing" ? { name: invoice.billToName || "—", address: invoice.billToAddress, email: design.fields.customerEmail ? invoice.billToEmail : "" } : { name: invoice.shipToName, address: invoice.shipToAddress };
    const lines = documentAddressLines(settings, source).split("\n");
    const nameStyle = element(org ? "organizationName" : "customerName"), addressStyle = element(org ? "organizationAddress" : "customerAddress");
    const style: Style = settings.placement === "absolute" ? { position: "absolute", left: settings.x - margin.left, top: settings.y - margin.top, width: Math.min(settings.width, page.width - settings.x) } : { flex: 1, paddingRight: 14 };
    return <View key={key} style={style}>{!org && (key !== "billing" || a.visibility.billTo) && text(key === "billing" ? design.labels.billTo : design.labels.shipTo, { ...element("labels"), fontWeight: 700 })}{lines.map((line, index) => <Fragment key={index}>{text(line, line.includes(source.name || "\u0000") ? { ...nameStyle, fontWeight: 700 } : addressStyle)}</Fragment>)}</View>;
  };
  const stamp = (where: typeof a.stamp.placement) => a.visibility.statusStamp && kind === "invoice" && invoice.status && where === a.stamp.placement ? <View bookmark="Societyer status stamp" wrap={false} style={{ width: Math.min(contentWidth, Math.max(90, (a.stamp.text || invoice.status).length * Number(body.fontSize || 10) * 0.75 + 16)), height: Number(body.fontSize || 10) * 1.5 + 10, marginVertical: 8 }} /> : null;
  const signature = (receiver = false) => {
    const placement = receiver ? a.receiverSignature : a.signature;
    if (receiver ? !a.receiverSignature.enabled : !design.signature.enabled) return null;
    const name = receiver ? a.receiverSignature.name : design.signature.name, label = receiver ? a.receiverSignature.label : design.signature.label;
    const style: Style = placement.placement === "absolute" ? { position: "absolute", left: placement.x - margin.left, top: placement.y - margin.top, width: placement.width } : { ...block, marginTop: 20, width: placement.width };
    return <View wrap={false} style={style}>{placement.image && <Image src={cleanDocumentImage(placement.image)} width={placement.width} height={placement.height} />}{text(name || " ", { ...element("signature"), paddingBottom: 6, borderBottomWidth: 0.5, borderColor: a.colors.border, minHeight: placement.image ? 0 : 20 })}{text(label, element("signature"))}</View>;
  };
  const picture = (source: string, maxWidth: number, maxHeight: number) => { const data = cleanDocumentImage(source), size = documentImageDimensions(data), scale = Math.min(Math.max(1, maxWidth) / size.width, maxHeight / size.height); return <Image src={data} width={size.width * scale} height={size.height * scale} />; };
  const customTable = invoice.documentTable;
  const customWidths = customTable?.columns.reduce((sum, column) => sum + (column.width || 1), 0) || 1;
  const sections: Record<DocumentSectionKey, ReactNode> = {
    header: <View style={{ ...block, borderBottomWidth: 1, borderColor: a.colors.border, backgroundColor: a.backgrounds.header.color, minHeight: a.page.firstHeaderHeight || undefined, paddingBottom: config.layout === "compact" ? 8 : 14, position: "relative", ...(config.layout === "modern" ? { padding: 10, borderTopWidth: 3 } : {}) }}><DocumentArtworkPdf background={a.backgrounds.header} width={contentWidth} height={estimatedHeaderHeight} /><View wrap={false} style={{ flexDirection: stackedHeader ? "column" : "row" }}>
      <View style={{ flex: 1, ...(stackedHeader ? { marginBottom: 12, width: "100%" } : {}), alignItems: design.logo.alignment === "center" ? "center" : design.logo.alignment === "right" ? "flex-end" : "flex-start", paddingRight: 12 }}>
        {config.showLogo && config.brand && <View style={{ padding: config.logoVariant === "reverse" ? 6 : 0, backgroundColor: config.logoVariant === "reverse" ? config.brand.primary : undefined }}><Svg width={logoWidth} height={drawnHeight} viewBox={`0 0 ${logoWidth} ${drawnHeight}`} content={sizedBrandSvg(config.brand, config.logoVariant, logoWidth, drawnHeight)} /></View>}
        {config.showLogo && !config.brand && organization.logoUrl && <Image src={organization.logoUrl} width={logoWidth} {...(aspectRatio || a.logo.height > 0 ? { height: drawnHeight } : {})} />}
        {config.showLogo && config.brand?.descriptor && text(config.brand.descriptor, { ...body, fontFamily: config.brand.font === "inter" ? documentPdfFontFamily("space_mono", fonts) : body.fontFamily, fontSize: 8, marginTop: 6 })}
      </View>
      <View style={{ width: stackedHeader ? "100%" : Math.max(130, contentWidth * 0.36), alignItems: "flex-end" }}>
        {a.visibility.title && text(title, element("title"))}
        {metadata.map((item, index) => <View key={index} style={{ flexDirection: "row", width: "100%", justifyContent: "space-between", marginTop: 3, ...(item.balance ? { backgroundColor: a.colors.balanceBackground, padding: 4 } : {}) }}>{text(item.label, element("labels"))}{text(item.value, { ...element(item.balance ? "balance" : item.number ? "documentNumber" : "labels"), textAlign: "right" })}</View>)}
      </View>
    </View>{stamp("header")}</View>,
    customer: <View style={{ ...block, backgroundColor: a.colors.sectionBackground }}><View style={{ flexDirection: "row" }}>{design.fields.organization && a.addresses.organization.placement === "flow" && address("organization")}{a.addresses.billing.placement === "flow" && address("billing")}{design.fields.shipTo && (invoice.shipToName || invoice.shipToAddress) && a.addresses.shipping.placement === "flow" && address("shipping")}</View>
      {invoice.documentDetails?.map((item, index) => <View key={index} style={{ flexDirection: "row", marginTop: 5 }}><View style={{ width: contentWidth * 0.3 }}>{text(item.label, { ...element("labels"), fontWeight: 700 })}</View><View style={{ flex: 1 }}>{text(item.value, customer)}</View></View>)}{stamp("customer")}</View>,
    items: <>{!customTable && data.taxModeLabel && text(data.taxModeLabel, { ...element("labels"), marginBottom: 5 })}{customTable ? <Table columns={customTable.columns.map((column) => ({ width: { fixed: contentWidth * (column.width || 1) / customWidths } }))} style={block}><Row header>{customTable.columns.map((column, i) => <Cell key={i} style={{ padding: design.table.rowPadding, backgroundColor: a.colors.tableHeaderBackground }}>{text(column.label, element("columnHeader"))}</Cell>)}</Row>{customTable.rows.map((row, index) => <Row key={index} style={{ backgroundColor: design.table.striped && index % 2 ? a.colors.alternateRowBackground : a.colors.rowBackground }}>{row.map((value, i) => <Cell key={i} style={{ padding: design.table.rowPadding, borderBottomWidth: 0.5, borderColor: a.colors.border }}>{text(value, { ...table, textAlign: customTable.columns[i]?.align || "left" })}</Cell>)}</Row>)}</Table> : <Table columns={columns.map((column) => ({ width: { fixed: contentWidth * column.width / columns.reduce((sum, c) => sum + c.width, 0) } }))} style={block}>
      <Row header style={{ backgroundColor: a.colors.tableHeaderBackground }}>{columns.map((column) => <Cell key={column.key} style={{ padding: design.table.rowPadding }}>{text(`${column.label}${column.key === "rate" ? ` (${invoice.currency})` : ""}`, { ...element("columnHeader"), fontWeight: 700, textAlign: numericDocumentColumn(column.key) ? "right" : "left" })}</Cell>)}</Row>
      {invoice.lines.map((line, index) => <Row key={line.key} style={{ backgroundColor: design.table.striped && index % 2 ? a.colors.alternateRowBackground : a.colors.rowBackground }}>{columns.map((column) => <Cell key={column.key} style={{ padding: design.table.rowPadding, borderBottomWidth: 0.5, borderColor: a.colors.border }}>{column.key === "image" && line.imageUrl ? picture(line.imageUrl, Math.min(58, contentWidth * column.width / columns.reduce((sum, c) => sum + c.width, 0) - design.table.rowPadding * 2), 42) : text(cellValue(column.key, line, index), { ...(column.key === "description" ? element("itemDescription") : table), textAlign: numericDocumentColumn(column.key) ? "right" : "left" })}</Cell>)}</Row>)}
      {!invoice.lines.length && <Row><Cell colSpan={columns.length} style={{ padding: design.table.rowPadding }}>{text("No line items yet.", table)}</Cell></Row>}
    </Table>}</>,
    totals: <View style={block}><View wrap={false} style={{ flexDirection: "row", justifyContent: "flex-end" }}><View style={{ width: Math.min(320, contentWidth * 0.68), backgroundColor: a.colors.totalsBackground }}>{summary.map((item, index) => <View key={index} style={{ paddingVertical: 4, backgroundColor: item.balance ? a.colors.balanceBackground : undefined, ...(item.strong ? { borderTopWidth: 0.5, borderColor: a.colors.border } : {}) }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}>{text(item.label, { ...(item.balance ? element("balance") : total), fontWeight: item.strong ? 700 : 400 })}{text(item.value, { ...(item.balance ? element("balance") : total), fontWeight: item.strong ? 700 : 400, textAlign: "right" })}</View>{item.base && text(`${a.labels.baseCurrency}: ${item.base}`, { ...total, fontSize: Math.max(6, Number(total.fontSize || 10) - 1), textAlign: "right" })}</View>)}{a.baseCurrency.enabled && a.baseCurrency.showRate && invoice.money?.fx && text(`1 ${invoice.currency} = ${invoice.money.fx.rateMicros / 1000000} ${invoice.money.fx.baseCurrency} · ${invoice.money.fx.asOfDate} · ${invoice.money.fx.source}`, { ...element("balance"), fontSize: 8, marginTop: 5 })}</View></View>{stamp("totals")}</View>,
    notes: design.fields.notes && invoice.memo ? paragraphSection(design.labels.notes, invoice.memo, element("notes")) : null,
    paymentInstructions: kind === "invoice" && config.showPaymentInstructions && paymentInstructions ? paragraphSection(design.labels.paymentInstructions, paymentInstructions, element("payment")) : null,
    signature: <>{a.signature.placement === "flow" && signature()}{a.receiverSignature.placement === "flow" && signature(true)}</>,
  };
  const extra = (placement: "before_items" | "after_items" | "after_totals" | "end") => <DocumentAdvancedPdfBlocks data={data} placement={placement} fonts={fonts} width={contentWidth} />;
  const annexures = [...extras.annexures || [], ...(data.inventoryRows.length ? [{ title: a.annexures.title, columns: [design.labels.item, design.labels.sku, "Batch", "Serial numbers"], rows: data.inventoryRows.map((row) => [row.item, row.sku, row.batch, row.serials]) }] : [])];
  return <Document title={`${title} ${invoice.number}`} author={organization.name} creator="Societyer · pdfcn / Forme" lang="en-CA" fonts={fonts} style={body}>
    <Page size={page} margin={margin}>
      {design.sections.map((key) => <Fragment key={key}>{key === "items" && extra("before_items")}{sections[key]}{key === "items" && extra("after_items")}{key === "totals" && extra("after_totals")}</Fragment>)}{extra("end")}
      {design.fields.taxRegistration && organization.gstNumber && text(`GST/HST registration no. ${organization.gstNumber}`, typeStyle("footer"))}

    </Page>
    {a.annexures.enabled && annexures.map((annexure, index) => <Page key={`annex-${index}`} size={page} margin={extraPageMargin}>{text(annexure.title, { ...header, marginBottom: 15 })}<Table columns={annexure.columns.map(() => ({ width: { fixed: contentWidth / annexure.columns.length } }))}><Row header>{annexure.columns.map((label, i) => <Cell key={i} style={{ padding: 5, backgroundColor: a.colors.tableHeaderBackground }}>{text(label, element("columnHeader"))}</Cell>)}</Row>{annexure.rows.map((row, i) => <Row key={i}>{row.map((value, j) => <Cell key={j} style={{ padding: 5, borderBottomWidth: 0.4, borderColor: a.colors.border }}>{text(value, table)}</Cell>)}</Row>)}</Table></Page>)}
    {a.appendices.map((appendix, index) => <Page key={`appendix-${index}`} size={page} margin={extraPageMargin}>{text(appendix.title, { ...header, marginBottom: 15 })}{appendix.html && <DocumentRichPdf html={appendix.html} style={body} width={contentWidth} />}{appendix.image && picture(appendix.image, contentWidth, page.height - extraPageMargin.top - extraPageMargin.bottom - 50)}</Page>)}
    {a.annexures.enabled && a.annexures.showAttachments && extras.attachments?.filter((attachment) => attachment.mimeType !== "application/pdf").map((attachment, index) => <Page key={`attachment-${index}`} size={page} margin={extraPageMargin}>{text(attachment.name, { ...header, marginBottom: 15 })}{picture(attachment.dataUrl, contentWidth, page.height - extraPageMargin.top - extraPageMargin.bottom - 50)}</Page>)}
  </Document>;
}
export function InvoicePdfDocument(props: InvoicePdfProps) {
  const { config, design } = documentPresentation(props.invoice), family = documentPdfFontFamily(design.typography.body.fontFamily, props.fonts);
  const theme = { ...professionalTheme, colors: { ...professionalTheme.colors, primary: config.accentColor }, typography: { ...professionalTheme.typography, body: { ...professionalTheme.typography.body, fontFamily: family }, heading: { ...professionalTheme.typography.heading, fontFamily: family } } };
  return <PdfcnThemeProvider theme={theme}><InvoicePdfContent {...props} /></PdfcnThemeProvider>;
}
