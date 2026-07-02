// Minute book "spine" export. Builds a printable HTML index (open for
// print-to-PDF) and a CSV index of every minute book item and connected
// record bundle. Reuses shared helpers: escapeHtml (src/lib/html.ts) and
// rowsToCsv (src/lib/csv.ts) so it matches the rest of the app's exports.
import { escapeHtml } from "../../../lib/html";
import { rowsToCsv } from "../../../lib/csv";
import { formatDate } from "../../../lib/format";
import { optionLabel } from "../../../lib/orgHubOptions";

type LinkRef = { kind?: string; label?: string; href?: string; count?: number };
type BundleRow = {
  key?: string;
  type?: string;
  title?: string;
  date?: string;
  status?: string;
  href?: string;
  links?: LinkRef[];
  counts?: Record<string, number>;
  gaps?: Array<{ key?: string; label?: string; severity?: string }>;
};

type ItemRow = {
  _id?: string;
  title?: string;
  recordType?: string;
  effectiveDate?: string;
  status?: string;
  archivedAtISO?: string;
  documentIds?: string[];
  meetingId?: string;
  minutesId?: string;
  filingId?: string;
  policyId?: string;
  workflowPackageId?: string;
  writtenResolutionId?: string;
  notes?: string;
};

type SocietyInfo = {
  name?: string;
  incorporationNumber?: string | null;
};

export type MinuteBookExportInput = {
  society?: SocietyInfo;
  items: ItemRow[];
  recordBundles: BundleRow[];
  maps: {
    documents: Map<string, any>;
    meetings: Map<string, any>;
    minutes: Map<string, any>;
    filings: Map<string, any>;
    policies: Map<string, any>;
    workflowPackages: Map<string, any>;
    writtenResolutions: Map<string, any>;
  };
};

function labelize(value?: string) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function actionableGaps(gaps: BundleRow["gaps"] = []) {
  return gaps.filter((gap) => gap?.severity === "warn" || gap?.severity === "danger");
}

/** Plain-text summary of the entity references linked to a manual record. */
function itemLinks(row: ItemRow, maps: MinuteBookExportInput["maps"]): string[] {
  const parts: string[] = [];
  for (const documentId of row.documentIds ?? []) {
    const doc = maps.documents.get(documentId);
    if (doc) parts.push(`Document: ${doc.title ?? documentId}`);
  }
  const meeting = row.meetingId ? maps.meetings.get(row.meetingId) : null;
  if (meeting) parts.push(`Meeting: ${meeting.title ?? row.meetingId}`);
  const minutes = row.minutesId ? maps.minutes.get(row.minutesId) : null;
  if (minutes) parts.push(`Minutes: ${minutes.heldAt ?? row.minutesId}`);
  const filing = row.filingId ? maps.filings.get(row.filingId) : null;
  if (filing) parts.push(`Filing: ${filing.kind ?? row.filingId}`);
  const policy = row.policyId ? maps.policies.get(row.policyId) : null;
  if (policy) parts.push(`Policy: ${policy.policyName ?? row.policyId}`);
  const workflowPackage = row.workflowPackageId ? maps.workflowPackages.get(row.workflowPackageId) : null;
  if (workflowPackage) parts.push(`Workflow package: ${workflowPackage.packageName ?? row.workflowPackageId}`);
  const writtenResolution = row.writtenResolutionId ? maps.writtenResolutions.get(row.writtenResolutionId) : null;
  if (writtenResolution) parts.push(`Written resolution: ${writtenResolution.title ?? row.writtenResolutionId}`);
  return parts;
}

/** Plain-text summary of the evidence linked to a connected record bundle. */
function bundleLinks(row: BundleRow): string[] {
  return (row.links ?? [])
    .filter(Boolean)
    .map((link) => `${labelize(link.kind) || "Link"}: ${link.label ?? ""}`.trim());
}

const HTML_STYLES = `
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.45; margin: 32px; color: #18212f; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { margin: 28px 0 8px; font-size: 16px; border-bottom: 1px solid #d8dee8; padding-bottom: 4px; }
  .meta { color: #596275; margin-bottom: 4px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; table-layout: fixed; }
  th, td { border: 1px solid #d8dee8; padding: 6px 8px; text-align: left; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
  th { background: #f3f5f9; font-weight: 600; }
  .status { white-space: nowrap; }
  .empty { color: #8a93a6; font-style: italic; }
  ul.links { margin: 0; padding-left: 16px; }
  ul.links li { margin: 2px 0; }
  @media print { body { margin: 12mm; } h2 { page-break-after: avoid; } tr { page-break-inside: avoid; } }
`;

function itemRowsHtml(items: ItemRow[], maps: MinuteBookExportInput["maps"]): string {
  if (!items.length) return `<tr><td colspan="5" class="empty">No manual minute book records.</td></tr>`;
  return items
    .map((row) => {
      const links = itemLinks(row, maps);
      const linksHtml = links.length
        ? `<ul class="links">${links.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<span class="empty">Not linked</span>`;
      return `<tr>
        <td>${escapeHtml(row.title ?? "Untitled record")}</td>
        <td>${escapeHtml(optionLabel("minuteBookRecordTypes", row.recordType) || labelize(row.recordType))}</td>
        <td class="status">${escapeHtml(row.effectiveDate ? formatDate(row.effectiveDate) : "—")}</td>
        <td class="status">${escapeHtml(optionLabel("minuteBookStatuses", row.status) || labelize(row.status) || "—")}</td>
        <td>${linksHtml}</td>
      </tr>`;
    })
    .join("");
}

function bundleRowsHtml(bundles: BundleRow[]): string {
  if (!bundles.length) return `<tr><td colspan="5" class="empty">No connected record bundles.</td></tr>`;
  return bundles
    .map((row) => {
      const links = bundleLinks(row);
      const linksHtml = links.length
        ? `<ul class="links">${links.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<span class="empty">No linked evidence</span>`;
      const gaps = actionableGaps(row.gaps);
      const gapsHtml = gaps.length
        ? escapeHtml(gaps.map((g) => g.label).filter(Boolean).join(", "))
        : `<span class="empty">No gaps</span>`;
      return `<tr>
        <td>${escapeHtml(row.title ?? "Untitled")}</td>
        <td class="status">${escapeHtml(labelize(row.type) || "—")}</td>
        <td class="status">${escapeHtml(row.date ? formatDate(row.date) : "—")}</td>
        <td class="status">${escapeHtml(row.status ?? "—")}</td>
        <td>${linksHtml}<div>${gapsHtml}</div></td>
      </tr>`;
    })
    .join("");
}

export function renderMinuteBookHtml(input: MinuteBookExportInput): string {
  const { society, items, recordBundles, maps } = input;
  const generated = new Date();
  const header = society?.name ? escapeHtml(society.name) : "Minute book";
  const incorporation = society?.incorporationNumber
    ? `<div class="meta">Incorporation number: ${escapeHtml(society.incorporationNumber)}</div>`
    : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${header} — minute book index</title>
    <style>${HTML_STYLES}</style>
  </head>
  <body>
    <h1>${header} — minute book index</h1>
    ${incorporation}
    <div class="meta">Generated ${escapeHtml(formatDate(generated.toISOString()))} · ${items.length} manual record(s) · ${recordBundles.length} connected record(s)</div>

    <h2>Record spine</h2>
    <table>
      <colgroup><col style="width:26%"><col style="width:18%"><col style="width:12%"><col style="width:14%"><col style="width:30%"></colgroup>
      <thead><tr><th>Title</th><th>Record type</th><th>Effective</th><th>Status</th><th>Linked references</th></tr></thead>
      <tbody>${itemRowsHtml(items, maps)}</tbody>
    </table>

    <h2>Connected records</h2>
    <table>
      <colgroup><col style="width:26%"><col style="width:14%"><col style="width:12%"><col style="width:14%"><col style="width:34%"></colgroup>
      <thead><tr><th>Record</th><th>Type</th><th>Date</th><th>Status</th><th>Connected evidence / gaps</th></tr></thead>
      <tbody>${bundleRowsHtml(recordBundles)}</tbody>
    </table>
  </body>
</html>`;
}

export function buildMinuteBookCsv(input: MinuteBookExportInput): string {
  const { items, recordBundles, maps } = input;
  const rows: unknown[][] = [
    ["Section", "Title", "Record type", "Effective date", "Status", "Linked references"],
  ];
  for (const row of items) {
    rows.push([
      "Record spine",
      row.title ?? "Untitled record",
      optionLabel("minuteBookRecordTypes", row.recordType) || labelize(row.recordType),
      row.effectiveDate ? formatDate(row.effectiveDate) : "",
      optionLabel("minuteBookStatuses", row.status) || labelize(row.status),
      itemLinks(row, maps).join("; "),
    ]);
  }
  for (const row of recordBundles) {
    const gaps = actionableGaps(row.gaps).map((g) => g.label).filter(Boolean);
    const references = [...bundleLinks(row), ...(gaps.length ? [`Gaps: ${gaps.join(", ")}`] : [])];
    rows.push([
      "Connected record",
      row.title ?? "Untitled",
      labelize(row.type),
      row.date ? formatDate(row.date) : "",
      row.status ?? "",
      references.join("; "),
    ]);
  }
  return rowsToCsv(rows);
}

function safeFileBase(society?: SocietyInfo): string {
  const base = (society?.name || "minute-book").replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "");
  return base || "minute-book";
}

function triggerDownload(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Download the minute book index as a printable HTML document (print-to-PDF). */
export function downloadMinuteBookHtml(input: MinuteBookExportInput) {
  const date = new Date().toLocaleDateString("en-CA");
  triggerDownload(`${safeFileBase(input.society)}-minute-book-${date}.html`, renderMinuteBookHtml(input), "text/html;charset=utf-8");
}

/** Download the minute book index as a CSV register. */
export function downloadMinuteBookCsv(input: MinuteBookExportInput) {
  const date = new Date().toLocaleDateString("en-CA");
  triggerDownload(`${safeFileBase(input.society)}-minute-book-${date}.csv`, buildMinuteBookCsv(input), "text/csv;charset=utf-8");
}
