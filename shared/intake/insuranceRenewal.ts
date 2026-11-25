import { findDates } from "./parse";
import type { Line } from "./extractors/toolkit";
import { limitBases } from "../insuranceRegister";

export type RenewalSource = {
  id: string;
  name: string;
  lines: Line[];
  pages: string[];
  role:
    | "Declaration"
    | "Invoice"
    | "Supporting document"
    | "Combined copy"
    | "Other";
  policy?: Record<string, any>;
  invoice?: Record<string, any>;
  links: string[];
};

const firstDay = (text: string) =>
  findDates(text).find((d) => d.precision === "day")?.iso;
const cents = (text?: string) => {
  const amount = text?.match(/^(?:\$\s*)?(\d+(?:,\d{3})*(?:\.\d{2})?)$/)?.[1];
  return amount
    ? Math.round(Number(amount.replace(/,/g, "")) * 100)
    : undefined;
};
function basis(label: string) {
  if (/each person\b/i.test(label)) return "Per person";
  return [...limitBases]
    .sort((a, b) => b.length - a.length)
    .find((value) => label.toLowerCase().includes(value.toLowerCase()));
}

/** Read the deductible/limit schedule only under its printed column headings. */
type ScheduleLine = Line & { amountColumn?: "limit" | "deductible" };
function coverageSchedule(lines: ScheduleLine[], id: string) {
  const items: Record<string, any>[] = [];
  let page: number | undefined,
    form: string | undefined,
    parent: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (/^coverage\s+form\s+deductible\s+limit/i.test(line.text)) {
      page = line.page;
      continue;
    }
    if (!page || line.page !== page) continue;
    const [label, ...values] = line.text.split("\t");
    if (values.length === 1 && /^[A-Z]+\d+-\d+$/i.test(values[0])) {
      form = values[0];
      parent = label;
      continue;
    }
    if (
      !/^(?:coverage|section) [a-z] [-–]/i.test(label) ||
      !values.length ||
      values.some((v) => cents(v) == null)
    )
      continue;
    const continuation: string[] = [];
    for (const next of lines.slice(index + 1, index + 4)) {
      if (
        next.page !== page ||
        next.text.includes("\t") ||
        /^(?:coverage|section|rating|insured copy)\b/i.test(next.text)
      )
        break;
      continuation.push(next.text);
    }
    const wording = [label, ...continuation].join(" ");
    const isDeductible =
      line.amountColumn === "deductible" || /deductible/i.test(wording);
    const hasLimit = values.length === 2 || line.amountColumn === "limit";
    items.push({
      label: wording,
      coverageType: parent,
      formNumber: form,
      coverageCode: /commercial general liability/i.test(parent ?? "")
        ? "CGL"
        : /non-owned automobile/i.test(parent ?? "")
          ? "NonOwnedAuto"
          : undefined,
      limitBasis: basis(wording),
      limitCents: hasLimit && !isDeductible ? cents(values.at(-1)) : undefined,
      deductibleCents:
        values.length > 1 || isDeductible ? cents(values[0]) : undefined,
      citationId: `p. ${page}`,
      sourceExternalIds: [id],
    });
  }
  return items;
}

/** Extract a proposal from one declarations document. All amounts are stored in integer cents. */
export function declarationFields(lines: Line[], id: string, record: any) {
  const field = (re: RegExp) =>
    lines.map((l) => l.text.match(re)?.[1]?.trim()).find(Boolean);
  const coverageItems = coverageSchedule(lines, id);
  const management = lines.find((l) =>
    /^limit of liability:\s*\$[\d,.]+\s+per claim and aggregate/i.test(l.text),
  );
  if (management)
    coverageItems.push({
      label: "Management liability",
      coverageCode: "ManagementLiability",
      limitBasis: "Per claim and aggregate",
      limitCents: cents(management.text.match(/\$[\d,.]+/)?.[0]),
      sourceExternalIds: [id],
      citationId: `p. ${management.page}`,
    });
  if (!coverageItems.length) {
    for (const c of record.coverages ?? []) {
      if (!c.type?.value || c.limit?.value?.amountCents == null) continue;
      coverageItems.push({
        label: c.type.value,
        limitCents: c.limit.value.amountCents,
        limitBasis: basis(c.type.value),
        deductibleCents: c.deductible?.value?.amountCents,
        sourceExternalIds: [id],
        citationId: c.type.locators?.[0]?.page
          ? `p. ${c.type.locators[0].page}`
          : undefined,
      });
    }
  }
  const retained = field(/premium:.*minimum retained\s+([\d.]+)%/i);
  const coverholderIndex = lines.findIndex((l) =>
    /approved coverholder.*:\s*$/i.test(l.text),
  );
  const retentionLine = lines.find((l) =>
    /^retention for claims:/i.test(l.text),
  );
  const insured = record.insured?.value;
  const termStart = record.termStart?.value?.iso,
    termEnd = record.termEnd?.value?.iso;
  const mapped: Record<string, string> = {
    directors_officers: "DirectorsOfficers",
    general_liability: "GeneralLiability",
    errors_omissions: "ProfessionalLiability",
    property: "PropertyCasualty",
    cyber: "CyberLiability",
  };
  return {
    policyNumber: record.policyNumber?.value ?? "",
    insurer: record.insurer?.value ?? "",
    broker: field(/^broker:\s*(.+)/i) ?? record.broker?.value,
    kind: mapped[record.kind?.value] || "Other",
    namedInsured: insured,
    startDate: termStart,
    endDate: termEnd,
    renewalDate: termEnd,
    premiumCents: record.premium?.value?.amountCents,
    policyFeeCents: record.fees?.value?.amountCents,
    versionType:
      record.documentType?.value === "renewal" ? "Renewal" : undefined,
    status: "NeedsReview",
    coverholder:
      coverholderIndex < 0
        ? undefined
        : lines[coverholderIndex + 1]?.text.replace(/LI MI TED/i, "LIMITED"),
    minimumRetainedPremiumPercent: retained ? Number(retained) : undefined,
    declaredOperations: field(/^insured.s business operations\s+(.+)/i),
    billingMethod: field(/^billing method\s+(.+)/i),
    grossReceiptsCents: cents(
      field(/^amount of revenue \(receipts\).*?(\$[\d,.]+)\s*$/i),
    ),
    coveredParties: insured
      ? [
          {
            name: insured,
            partyType: "Named insured",
            citationId: "p. 1",
            sourceExternalIds: [id],
          },
        ]
      : [],
    coverageItems,
    claimsMadeTerms: retentionLine
      ? {
          retentionCents: cents(retentionLine.text.match(/\$[\d,.]+/)?.[0]),
          territory: field(/territory:\s*(.+)$/i),
          defenseCostsInsideLimit: lines.some((l) =>
            /^costs:\s*inclusive to limit/i.test(l.text),
          )
            ? true
            : undefined,
          notes: field(/^(applies only to .+?)(?:\s+territory:|$)/i),
          citationId: `p. ${retentionLine.page}`,
          sourceExternalIds: [id],
        }
      : undefined,
  };
}

export function invoiceFields(lines: Line[], id: string) {
  const page = lines.filter((line) => line.page === 1).map((line) => line.text);
  const invoice = page.findIndex((t) => /^invoice number\b/i.test(t));
  if (invoice < 0) return;
  const reference =
    page[invoice].replace(/^invoice number\s*:?\s*/i, "") ||
    page[invoice + 1]?.match(/^[\w-]+$/)?.[0];
  const account = page.findIndex((t) => /account number.*date/i.test(t));
  const dated =
    account < 0
      ? undefined
      : page
          .slice(account + 1, account + 5)
          .find((t) => /\t/.test(t) && firstDay(t));
  const balance = page.findIndex((t) => /balance due on.*amount due/i.test(t));
  const total = page
    .find((t) => /^total invoice balance:/i.test(t))
    ?.match(/\$[\d,.]+/)?.[0];
  const item = page.findIndex((t) => /^item #.*description/i.test(t));
  return {
    id,
    kind: "invoice",
    reference,
    itemNumber: item < 0 ? undefined : page[item + 1]?.match(/^(\d+)\s/)?.[1],
    observedDate: dated && firstDay(dated),
    brokerCustomerNumber: dated?.split("\t")[0],
    dueDate: balance < 0 ? undefined : firstDay(page[balance + 1] || ""),
    amountCents: cents(total),
    sourceReference: "Invoice, p. 1",
    reviewStatus: "pending",
  };
}

/** A compilation is redundant only when its entire page sequence can be covered by smaller originals. */
export function linkRenewalSources(sources: RenewalSource[]) {
  for (const source of sources) {
    const originals = sources.filter(
      (s) => s.pages.length && s.pages.length < source.pages.length,
    );
    const ends = new Set([0]);
    for (let start = 0; start < source.pages.length; start++) {
      if (!ends.has(start)) continue;
      for (const doc of originals)
        if (doc.pages.every((p, i) => p && p === source.pages[start + i]))
          ends.add(start + doc.pages.length);
    }
    if (source.pages.length && ends.has(source.pages.length)) {
      source.role = "Combined copy";
      source.policy = undefined;
    }
  }
  const declarations = sources.filter((s) => s.role === "Declaration");
  for (const source of sources) {
    if (source.role === "Combined copy") continue;
    if (source.role === "Declaration") {
      source.links = [source.id];
      continue;
    }
    const numbers = new Set(
      source.lines
        .filter((l) => /policy (?:number|no\.)/i.test(l.text))
        .flatMap((l) => l.text.toUpperCase().split(/[^A-Z0-9-]+/)),
    );
    source.links = declarations
      .filter((s) => numbers.has(s.policy?.policyNumber?.toUpperCase()))
      .map((s) => s.id);
    if (
      !source.links.length &&
      /notice/i.test(source.name) &&
      /D&O/i.test(source.name)
    ) {
      const candidates = declarations.filter(
        (s) => s.policy?.kind === "DirectorsOfficers",
      );
      if (candidates.length === 1) source.links = [candidates[0].id];
    }
    if (source.links.length && source.role === "Other")
      source.role = "Supporting document";
  }
}
