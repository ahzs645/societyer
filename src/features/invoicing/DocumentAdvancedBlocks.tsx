import QRCode from "qrcode";
import { View, Text, QrCode, Link, Table, Row, Cell, type Style } from "@formepdf/react";
import type { DocumentBlockPlacement } from "../../../shared/invoiceCommerce";
import type { documentPresentation } from "./documentPresentation";
import { documentCssFont, documentPdfFontFamily } from "./documentPresentation";
import { DocumentRichContent, DocumentRichPdf } from "./DocumentRichContent";
import type { FontRegistration } from "@formepdf/react";
export type DocumentPresentation = ReturnType<typeof documentPresentation>;
function qrArtwork(value: string) {
  const code = QRCode.create(value, { errorCorrectionLevel: "M" }), size = code.modules.size;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (code.modules.get(y, x)) path += `M${x + 3} ${y + 3}h1v1h-1z`;
  return { size: size + 6, path };
}
export function DocumentPaymentQr({ value }: { value: string }) { const { size, path } = qrArtwork(value); return <svg role="img" aria-label="Payment QR code" viewBox={`0 0 ${size} ${size}`} width="112" height="112"><rect width={size} height={size} fill="white" /><path d={path} fill="black" /></svg>; }
export function DocumentAdvancedBlocks({ data, placement }: { data: DocumentPresentation; placement: DocumentBlockPlacement }) {
  const { advanced: a, design, extras, totals } = data;
  const style = (key: keyof typeof a.typography) => { const type = a.typography[key]; return { fontFamily: documentCssFont(type.fontFamily, data.config.brand?.font), fontSize: `${type.fontSize}pt`, color: type.color }; };
  const bank = extras.bankDetails ?? a.bank.fields;
  return <>
    {a.terms.enabled && a.terms.placement === placement && <section className="document-preview__notes" style={style("terms")}><strong>{a.labels.terms}</strong>{a.terms.html && <DocumentRichContent html={a.terms.html} />}{extras.termsAndConditions && <p>{extras.termsAndConditions}</p>}</section>}
    {a.bank.enabled && a.bank.placement === placement && <section className="document-preview__notes" style={style("payment")}><strong>{a.labels.bank}</strong><dl>{bank.map((row, i) => <div key={i}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></section>}
    {a.onlinePayment.enabled && a.onlinePayment.placement === placement && data.paymentUrl && <section className="document-preview__notes" style={style("payment")}><strong>{a.labels.onlinePayment}</strong><p><a href={data.paymentUrl}>{a.onlinePayment.label}</a></p>{a.onlinePayment.showQr && <DocumentPaymentQr value={data.paymentUrl} />}</section>}

    {a.taxSummary.enabled && a.taxSummary.placement === placement && <section className="document-preview__notes" style={style("payment")}><strong>{a.labels.taxSummary}</strong><table className="document-preview__table"><thead><tr><th>{design.labels.tax}</th>{a.taxSummary.showTaxableBase && <th>{a.labels.taxableAmount}</th>}{a.taxSummary.showTaxAmount && <th>{a.labels.taxAmount}</th>}</tr></thead><tbody>{totals.taxes.map((row) => <tr key={`${row.label}-${row.ratePercent}`}><td>{row.label} {row.ratePercent}%</td>{a.taxSummary.showTaxableBase && <td>{data.money(row.baseCents)}</td>}{a.taxSummary.showTaxAmount && <td>{data.money(row.cents)}</td>}</tr>)}</tbody></table></section>}
    {a.amountWords.enabled && data.amountWords && a.amountWords.placement === placement && <section className="document-preview__notes" style={style("payment")}><strong>{a.labels.amountWords}</strong><p>{data.amountWords}</p></section>}
  </>;
}
export function DocumentAdvancedPdfBlocks({ data, placement, fonts, width }: { data: DocumentPresentation; placement: DocumentBlockPlacement; fonts?: FontRegistration[]; width: number }) {
  const { advanced: a, design, extras, totals } = data;
  const style = (key: keyof typeof a.typography): Style => ({ ...a.typography[key], fontFamily: documentPdfFontFamily(a.typography[key].fontFamily, fonts) });
  const payment = style("payment"), section: Style = { marginBottom: 16 }, title = (text: string, type = payment) => <Text style={{ ...type, fontWeight: 700, marginBottom: 4 }}>{text}</Text>;
  const bank = extras.bankDetails ?? a.bank.fields;

  return <>
    {a.terms.enabled && a.terms.placement === placement && <View style={section}>{title(a.labels.terms, style("terms"))}{a.terms.html && <DocumentRichPdf html={a.terms.html} style={style("terms")} width={width} />}{extras.termsAndConditions && <Text style={style("terms")}>{extras.termsAndConditions}</Text>}</View>}
    {a.bank.enabled && a.bank.placement === placement && <View style={section}>{title(a.labels.bank)}{bank.map((row, i) => <View key={i} wrap={false} style={{ flexDirection: "row", marginBottom: 3 }}><Text style={{ ...payment, width: width * 0.35 }}>{row.label}</Text><Text style={{ ...payment, width: width * 0.65 }}>{row.value}</Text></View>)}</View>}
    {a.onlinePayment.enabled && a.onlinePayment.placement === placement && data.paymentUrl && <View wrap={false} style={section}>{title(a.labels.onlinePayment)}<Text style={payment}><Link href={data.paymentUrl}>{a.onlinePayment.label}</Link></Text>{a.onlinePayment.showQr && <QrCode data={data.paymentUrl} size={84} />}</View>}

    {a.taxSummary.enabled && a.taxSummary.placement === placement && <View style={section}>{title(a.labels.taxSummary)}<Table columns={Array.from({ length: 1 + Number(a.taxSummary.showTaxableBase) + Number(a.taxSummary.showTaxAmount) }, () => ({ width: { fixed: width / (1 + Number(a.taxSummary.showTaxableBase) + Number(a.taxSummary.showTaxAmount)) } }))}><Row header><Cell style={{ padding: 5, backgroundColor: a.colors.tableHeaderBackground }}><Text style={{ ...payment, color: a.typography.columnHeader.color }}>{design.labels.tax}</Text></Cell>{a.taxSummary.showTaxableBase && <Cell style={{ padding: 5, backgroundColor: a.colors.tableHeaderBackground }}><Text style={{ ...payment, color: a.typography.columnHeader.color }}>{a.labels.taxableAmount}</Text></Cell>}{a.taxSummary.showTaxAmount && <Cell style={{ padding: 5, backgroundColor: a.colors.tableHeaderBackground }}><Text style={{ ...payment, color: a.typography.columnHeader.color }}>{a.labels.taxAmount}</Text></Cell>}</Row>{totals.taxes.map((row) => <Row key={`${row.label}-${row.ratePercent}`}><Cell style={{ padding: 5 }}><Text style={payment}>{`${row.label} ${row.ratePercent}%`}</Text></Cell>{a.taxSummary.showTaxableBase && <Cell style={{ padding: 5 }}><Text style={payment}>{data.money(row.baseCents)}</Text></Cell>}{a.taxSummary.showTaxAmount && <Cell style={{ padding: 5 }}><Text style={payment}>{data.money(row.cents)}</Text></Cell>}</Row>)}</Table></View>}
    {a.amountWords.enabled && data.amountWords && a.amountWords.placement === placement && <View style={section}>{title(a.labels.amountWords)}<Text style={payment}>{data.amountWords}</Text></View>}
  </>;
}
