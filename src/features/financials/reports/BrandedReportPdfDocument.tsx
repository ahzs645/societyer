import { Document, Page, View, Text, Table, Row, Cell, Svg, Image, type FontRegistration, type Style } from "@formepdf/react";
import { cleanInvoiceTemplate, resolveDocumentDesign, resolveDocumentAdvanced, type InvoiceTemplate } from "../../../../shared/invoiceCommerce";
import { sizedBrandSvg } from "../../invoicing/InvoicePdfDocument";
import { cleanDocumentImage } from "../../../../shared/documentRichContent";
import { documentPdfFontFamily, documentAddressLines } from "../../invoicing/documentPresentation";
import { invoiceBrandPdfSvg } from "../../../../shared/invoiceBranding";
import type { InvoiceOrganization } from "../../invoicing/types";
import type { BrandedReportChart, BrandedReportColumn, BrandedReportData, BrandedReportRow, BrandedReportSection, BrandedReportBlock } from "./brandedReportTypes";

export type BrandedReportPdfProps = { report: BrandedReportData; template?: Partial<InvoiceTemplate>; organization: InvoiceOrganization & { logoUrl?: string | null; logoAspectRatio?: number }; fonts?: FontRegistration[]; includeGraphs?: boolean };
function columnsForPage(section: BrandedReportSection): BrandedReportSection[] {
  // Keep every period legible: continue wide statements with the account column repeated.
  if (section.columns.length <= 7 || !section.columns.slice(1).every((column) => column.align === "right")) return [section];
  const sections: BrandedReportSection[] = [];
  for (let start = 1; start < section.columns.length; start += 6) {
    const indices = [0, ...section.columns.slice(start, start + 6).map((_, i) => start + i)];
    sections.push({ ...section, title: `${section.title} · columns ${start}–${Math.min(start + 5, section.columns.length - 1)}`, columns: indices.map((i) => section.columns[i]), rows: section.rows.map((row) => ({ ...row, cells: indices.map((i) => row.cells[i] ?? "") })) });
  }
  return sections;
}
function ReportTableBlock({ columns, rows, font, color, padding, stripe, accent, width, title, description, titleStyle, colors, headerStyle }: { columns: BrandedReportColumn[]; rows: BrandedReportRow[]; font: Style; color: string; padding: number; stripe: boolean; accent: string; width: number; title?: string; description?: string; titleStyle?: Style; colors: { border: string; sectionBackground: string; tableHeaderBackground: string; rowBackground: string; alternateRowBackground: string }; headerStyle: Style }) {
  const total = columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
  const base: Style = { ...font, padding, borderBottomWidth: 0.4, borderColor: colors.border };
  return <Table columns={columns.map((column) => ({ width: { fixed: width * (column.width ?? 1) / total } }))}>
    {title && <Row header><Cell colSpan={columns.length} style={{ ...titleStyle, fontWeight: 700, paddingBottom: 8 }}><Text>{title}</Text></Cell></Row>}
    {description && <Row header><Cell colSpan={columns.length} style={{ ...font, paddingBottom: 8 }}><Text>{description}</Text></Cell></Row>}
    <Row header>{columns.map((column) => <Cell key={column.key} style={{ ...base, backgroundColor: colors.tableHeaderBackground, ...headerStyle, textAlign: column.align ?? "left" }}><Text>{column.label}</Text></Cell>)}</Row>
    {rows.length ? rows.map((row, rowIndex) => <Row key={row.key} style={{ backgroundColor: row.kind === "section" ? colors.sectionBackground : stripe && rowIndex % 2 ? colors.alternateRowBackground : colors.rowBackground }}>{columns.map((column, index) => <Cell key={column.key} style={{ ...base, color, textAlign: column.align ?? "left", paddingLeft: index === 0 ? padding + Math.min(row.depth ?? 0, 8) * 9 : padding, fontWeight: row.kind && row.kind !== "data" && row.kind !== "note" ? 700 : 400, ...(row.kind === "total" ? { borderTopWidth: 1, borderColor: accent } : {}) }}><Text>{row.cells[index] ?? ""}</Text></Cell>)}</Row>) : <Row><Cell colSpan={columns.length} style={base}><Text>No matching rows for these filters.</Text></Cell></Row>}
  </Table>;
}
function chartArtwork(chart: BrandedReportChart, width: number) {
  const height = 150;
  if (chart.kind === "svg" && chart.svg) return { width, height: width * chart.svg.height / chart.svg.width, content: chart.svg.content, viewBox: `0 0 ${chart.svg.width} ${chart.svg.height}` };
  const series = chart.series ?? [], labels = chart.labels ?? [], values = series.flatMap((item) => item.values.map((value) => typeof value === "number" ? value * (item.plotSign ?? 1) : null)).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const min = values.reduce((a, b) => Math.min(a, b), 0), max = values.reduce((a, b) => Math.max(a, b), 0), span = max - min || 1;
  const y = (value: number) => 10 + (max - value) / span * (height - 20);
  const zero = y(0), count = Math.max(labels.length, ...series.map((item) => item.values.length), 1);
  const escape = (color: string) => /^#[0-9a-f]{6}$/i.test(color) ? color : "#245c46";
  let content = `<path d="M0 ${zero}H${width}" fill="none" stroke="#b8bdc4" stroke-width="0.6"/>`;
  if (chart.kind === "bars") {
    const group = width / count, bar = Math.max(0.4, group * 0.8 / Math.max(1, series.length));
    series.forEach((item, si) => item.values.forEach((value, i) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const plotted = value * (item.plotSign ?? 1);
      if (!plotted) return;
      const top = Math.min(zero, y(plotted)), size = Math.max(0.25, Math.abs(zero - y(plotted)));
      content += `<path d="M${i * group + group * 0.1 + si * bar} ${top}h${bar * 0.92}v${size}h${-bar * 0.92}Z" fill="${escape(item.color)}"/>`;
    }));
  } else series.forEach((item) => {
    let open = false;
    const points = item.values.map((value, i) => {
      if (typeof value !== "number" || !Number.isFinite(value)) { open = false; return ""; }
      const x = count === 1 ? width / 2 : i / (count - 1) * width, plottedY = y(value * (item.plotSign ?? 1));
      const segment = !open ? `M${x} ${plottedY}` : chart.curve === "step" ? `H${x}V${plottedY}` : `L${x} ${plottedY}`;
      open = true; return segment;
    }).join(" ");
    content += `<path d="${points}" fill="none" stroke="${escape(item.color)}" stroke-width="1.8"/>`;
    if (count === 1 && typeof item.values[0] === "number") content += `<circle cx="${width / 2}" cy="${y(item.values[0] * (item.plotSign ?? 1))}" r="2.5" fill="${escape(item.color)}"/>`;
  });
  return { width, height, content, viewBox: `0 0 ${width} ${height}` };
}
/** Searchable tables accompany the native vector graphs; both consume the same report payload. */
export function BrandedReportPdfDocument({ report, template, organization, fonts, includeGraphs = true }: BrandedReportPdfProps) {
  const config = cleanInvoiceTemplate(template), design = resolveDocumentDesign(config), advanced = resolveDocumentAdvanced(design);
  const baseSize = advanced.page.customSize ? { width: advanced.page.width, height: advanced.page.height } : config.paperSize === "a4" ? { width: 595.276, height: 841.89 } : { width: 612, height: 792 };
  const size = design.page.orientation === "landscape" ? { width: baseSize.height, height: baseSize.width } : baseSize;
  const width = size.width - design.page.margins.left - design.page.margins.right;
  const style = (key: keyof typeof design.typography): Style => { const value = design.typography[key]; return { fontFamily: documentPdfFontFamily(value.fontFamily, fonts), fontSize: value.fontSize, color: value.color }; };
  const tableStyle = style("table");
  const aspectRatio = config.brand ? config.brand.logoWidth / config.brand.logoHeight : organization.logoAspectRatio;
  const requestedWidth = Math.min(design.logo.width, width), naturalHeight = aspectRatio ? requestedWidth / aspectRatio : advanced.logo.height || requestedWidth * 0.4;
  const logoHeight = advanced.logo.height > 0 ? advanced.logo.height : naturalHeight;
  const logoWidth = advanced.logo.preserveAspectRatio && advanced.logo.height > 0 && aspectRatio ? Math.min(requestedWidth, advanced.logo.height * aspectRatio) : requestedWidth;
  const drawnHeight = advanced.logo.preserveAspectRatio && aspectRatio ? logoWidth / aspectRatio : logoHeight;
  const signature = (receiver = false) => {
    const block = receiver ? advanced.receiverSignature : advanced.signature;
    if (block.placement !== "flow" || (receiver ? !advanced.receiverSignature.enabled : !design.signature.enabled)) return null;
    const label = receiver ? advanced.receiverSignature.label : design.signature.label, name = receiver ? advanced.receiverSignature.name : design.signature.name;
    return <View wrap={false} style={{ marginTop: 24, width: block.width, paddingTop: 6 }}>{block.image && <Image src={cleanDocumentImage(block.image)} width={block.width} height={block.height} />}<Text style={{ ...advanced.typography.signature, fontFamily: documentPdfFontFamily(advanced.typography.signature.fontFamily, fonts), borderBottomWidth: .6, borderColor: advanced.colors.border, paddingBottom: 6 }}>{name || " "}</Text><Text style={{ ...advanced.typography.signature, fontFamily: documentPdfFontFamily(advanced.typography.signature.fontFamily, fonts) }}>{label}</Text></View>;
  };
  const sections = [...(report.columns ? [{ title: report.title, columns: report.columns, rows: report.rows ?? [] }] : []), ...(report.sections ?? [])].flatMap(columnsForPage);
  const renderTable = (columns: BrandedReportColumn[], rows: BrandedReportRow[], title?: string, description?: string) => <ReportTableBlock columns={columns} rows={rows} font={tableStyle} color={design.typography.table.color} padding={design.table.rowPadding} stripe={design.table.striped} accent={config.accentColor} width={width} title={title} description={description} titleStyle={style("totals")} colors={advanced.colors} headerStyle={{ ...advanced.typography.columnHeader, fontFamily: documentPdfFontFamily(advanced.typography.columnHeader.fontFamily, fonts) }} />;
  const money = (value: number, chart: BrandedReportChart) => chart.valueUnit === "number" ? new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value) : new Intl.NumberFormat("en-CA", { style: "currency", currency: report.currency }).format(value / 100);
  const blocks: BrandedReportBlock[] = report.blocks ? report.blocks.flatMap<BrandedReportBlock>((block) => block.kind === "chart" ? [block] : columnsForPage(block.section).map((section) => ({ kind: "table" as const, section }))) : [...(report.charts ?? []).map((chart) => ({ kind: "chart" as const, chart })), ...sections.map((section) => ({ kind: "table" as const, section }))];
  const title = design.titles.report === "Financial report" ? report.title : `${design.titles.report} · ${report.title}`;
  const renderChart = (chart: BrandedReportChart, chartIndex: number) => {
        const artwork = chartArtwork(chart, width);
        const labels = chart.labels ?? [], series = chart.series ?? [];
        return <View key={`${chart.title}-${chartIndex}`} style={{ marginBottom: 20 }}>
          <View wrap={false}>
            <Text style={{ ...style("totals"), fontWeight: 700, marginBottom: 5 }}>{chart.title}</Text>
            {chart.description && <Text style={{ fontSize: 8, marginBottom: 6 }}>{chart.description}</Text>}
            <View style={{ position: "relative", width: artwork.width, height: artwork.height }}>
              <Svg {...artwork} />
              {chart.svg?.annotations?.map((annotation, index) => <Text key={index} style={{ position: "absolute", left: annotation.x * width / chart.svg!.width, top: annotation.y * width / chart.svg!.width, width: annotation.width * width / chart.svg!.width, fontSize: 8, textAlign: annotation.align ?? "left", color: design.typography.body.color }}>{annotation.text}</Text>)}
            </View>
            {labels.length > 0 && <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}><Text style={{ fontSize: 7 }}>{labels[0]}</Text>{labels.length > 2 && <Text style={{ fontSize: 7 }}>{labels[Math.floor(labels.length / 2)]}</Text>}{labels.length > 1 && <Text style={{ fontSize: 7 }}>{labels[labels.length - 1]}</Text>}</View>}
            {series.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6, marginBottom: 8 }}>{series.map((item) => <Text key={item.label} style={{ fontSize: 8, color: item.color, marginRight: 14 }}>{item.label} ({chart.valueUnit === "number" ? "value" : report.currency})</Text>)}</View>}
          </View>
          {labels.length > 0 && series.length > 0 && renderTable([{ key: "period", label: "Period", width: 1.5 }, ...series.map((item, i) => ({ key: `series-${i}`, label: item.label, align: "right" as const }))], labels.map((label, index) => ({ key: `${chartIndex}-${index}`, cells: [label, ...series.map((item) => item.values[index] === null || item.values[index] === undefined ? "Unknown" : money(item.values[index]!, chart))] })))}
        </View>;
  };
  return <Document title={title} author={organization.name} creator="Societyer · pdfcn / Forme" lang="en-CA" fonts={fonts} style={style("body")}>
    <Page size={size} margin={design.page.margins}>
      <View wrap={false} style={{ marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: advanced.colors.border, minHeight: advanced.page.firstHeaderHeight || undefined }}>
        {config.showLogo && !config.brand && organization.logoUrl && <View style={{ alignItems: design.logo.alignment === "right" ? "flex-end" : design.logo.alignment === "center" ? "center" : "flex-start", marginBottom: 14 }}><Image src={organization.logoUrl} width={logoWidth} height={aspectRatio || !advanced.logo.preserveAspectRatio ? drawnHeight : undefined} alt={`${organization.name ?? "Organization"} logo`} /></View>}
        {config.showLogo && config.brand && <View style={{ alignItems: design.logo.alignment === "right" ? "flex-end" : design.logo.alignment === "center" ? "center" : "flex-start", marginBottom: 14 }}><View style={{ padding: config.logoVariant === "reverse" ? 8 : 0, backgroundColor: config.logoVariant === "reverse" ? config.brand.primary : undefined }}><Svg width={logoWidth} height={drawnHeight} viewBox={`0 0 ${logoWidth} ${drawnHeight}`} content={sizedBrandSvg(config.brand, config.logoVariant, logoWidth, drawnHeight)} /></View></View>}
        {config.showLogo && config.brand?.descriptor && <Text style={{ fontFamily: fonts?.some((font) => font.family === "InvoiceLabel") ? "InvoiceLabel" : documentPdfFontFamily("mono", fonts), fontSize: 8, marginBottom: 12 }}>{config.brand.descriptor}</Text>}
        {design.fields.organization && advanced.addresses.organization.placement === "flow" && advanced.visibility.organizationName && <Text style={{ fontFamily: documentPdfFontFamily(advanced.typography.organizationName.fontFamily, fonts), fontSize: advanced.typography.organizationName.fontSize, color: advanced.typography.organizationName.color, marginBottom: 6 }}>{organization.name ?? "Organization"}</Text>}
        {design.fields.organization && advanced.addresses.organization.placement === "flow" && advanced.visibility.organizationAddress && organization.address && <Text style={{ fontFamily: documentPdfFontFamily(advanced.typography.organizationAddress.fontFamily, fonts), fontSize: advanced.typography.organizationAddress.fontSize, color: advanced.typography.organizationAddress.color, marginBottom: 6 }}>{documentAddressLines(advanced.addresses.organization, { ...organization, name: "", taxNumber: organization.gstNumber })}</Text>}
        {advanced.visibility.title && <Text style={{ fontFamily: documentPdfFontFamily(advanced.typography.title.fontFamily, fonts), fontSize: advanced.typography.title.fontSize, color: advanced.typography.title.color, marginBottom: 8 }}>{title}</Text>}
        {report.subtitle && <Text style={{ marginBottom: 6 }}>{report.subtitle}</Text>}
        {report.filterSummary.map((text, index) => <Text key={index} style={{ ...style("customer"), marginBottom: 3 }}>{text}</Text>)}
      </View>
      {report.warnings?.map((warning, index) => <Text key={index} style={{ fontSize: 9, color: "#8c411a", marginBottom: 8 }}>{warning}</Text>)}
      {blocks.map((block, index) => block.kind === "chart" ? includeGraphs ? renderChart(block.chart, index) : null : <View key={`${block.section.title}-${index}`} style={{ marginBottom: 18 }}>{renderTable(block.section.columns, block.section.rows, block.section.title, block.section.description)}</View>)}
      {!blocks.length && <Text>No matching rows for these filters.</Text>}
      {signature()}{signature(true)}
    </Page>
  </Document>;
}
