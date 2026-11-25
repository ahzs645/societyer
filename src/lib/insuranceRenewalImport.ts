import { openZip, readZipEntryBytes, crc32 } from "./zipStream";
import { hashBytes } from "./workspaceArchive";
import { finalizeBlocks, type DraftBlock } from "../../shared/intake/blocks";
import { linesFromItems } from "../../shared/intake/extract/pdf";
import { extractInsurance } from "../../shared/intake/extractors/insurance";
import { linesOf } from "../../shared/intake/extractors/toolkit";
import {
  declarationFields,
  invoiceFields,
  linkRenewalSources,
  type RenewalSource,
} from "../../shared/intake/insuranceRenewal";

export type RenewalFile = RenewalSource & { file: File; selected: boolean };
const maxBytes = 128 * 1024 * 1024;

export async function readRenewalPackage(
  archive: File,
  progress: (name: string) => void,
) {
  const entries = [...(await openZip(archive)).values()].filter(
    (e) =>
      !e.dir &&
      /\.pdf$/i.test(e.name) &&
      !/(^|\/)__MACOSX\/|(^|\/)\._/.test(e.name),
  );
  if (!entries.length)
    throw new Error("Choose a ZIP containing PDF originals.");
  if (
    entries.length > 100 ||
    entries.reduce((sum, e) => sum + e.size, 0) > maxBytes
  )
    throw new Error("Choose up to 100 PDFs totalling at most 128 MB.");
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const sources: RenewalFile[] = [];
  for (const entry of entries) {
    const name = entry.name.split("/").pop()!;
    progress(name);
    const bytes = await readZipEntryBytes(archive, entry);
    if (crc32(bytes) !== entry.crc)
      throw new Error(`The ZIP checksum failed for ${name}.`);
    const id = `local:sha256:${await hashBytes(bytes)}`;
    if (sources.some((doc) => doc.id === id)) continue;
    const file = new File([bytes as BlobPart], name, {
      type: "application/pdf",
    });
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true })
      .promise;
    const blocks: DraftBlock[] = [],
      pages: string[] = [];
    const columns = new Map<number, "limit" | "deductible">();
    try {
      for (let page = 1; page <= doc.numPages; page++) {
        const pdfPage = await doc.getPage(page);
        const content = await pdfPage.getTextContent();
        const items = content.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  str: item.str,
                  x: item.transform[4],
                  y: item.transform[5],
                  w: item.width,
                  h: item.height,
                },
              ]
            : [],
        );
        const lines = linesFromItems(items);
        const header = lines.find((line) =>
          /^coverage\s+form\s+deductible\s+limit/i.test(line.text),
        );
        const deductible = header?.items.find((item) =>
          /deductible/i.test(item.str),
        );
        const limit = header?.items.find((item) => /limit/i.test(item.str));
        if (deductible && limit && limit.x > deductible.x) {
          const boundary = (deductible.x + deductible.w + limit.x) / 2;
          for (const [index, line] of lines.entries()) {
            const cells = line.text.split("\t");
            if (cells.length !== 2) continue;
            const amount = line.items.find(
              (item) =>
                item.str.trim() === cells[1] && /^\$?[\d,.]+$/.test(cells[1]),
            );
            if (amount)
              columns.set(
                blocks.length + index,
                amount.x + amount.w / 2 > boundary ? "limit" : "deductible",
              );
          }
        }
        blocks.push(
          ...lines.map((l) => ({
            kind: "paragraph" as const,
            page,
            text: l.text,
          })),
        );
        const normalized = lines
          .map((l) => l.text)
          .join("")
          .replace(/\s/g, "");
        pages.push(
          normalized
            ? await hashBytes(new TextEncoder().encode(normalized))
            : "",
        );
        pdfPage.cleanup();
      }
    } finally {
      await doc.destroy();
    }
    const extract = {
      ...finalizeBlocks(blocks),
      method: "pdfjs-text" as const,
      methodVersion: "1",
      warnings: [],
    };
    const lines = linesOf(extract).map((line) => ({
      ...line,
      amountColumn: columns.get(line.blockIndex),
    }));
    const invoice = invoiceFields(lines, id);
    const record = extractInsurance({
      extract,
      fileName: name,
      fileId: id,
      docClass: "insurance",
    }).record as any;
    const proposed = declarationFields(lines, id, record);
    const isPolicy =
      !invoice &&
      ["policy", "renewal"].includes(record.documentType?.value) &&
      lines.some(
        (l) =>
          l.page === 1 &&
          /declarat\s*ions?|declaration pages|policy period/i.test(l.text),
      ) &&
      proposed.policyNumber;
    sources.push({
      id,
      name,
      file,
      pages,
      lines,
      invoice,
      policy: isPolicy ? proposed : undefined,
      role: invoice ? "Invoice" : isPolicy ? "Declaration" : "Other",
      links: [],
      selected: false,
    });
  }
  linkRenewalSources(sources);
  sources.forEach((source) => {
    source.selected = source.links.length > 0;
  });
  return sources;
}

export function renewalBundle(
  sources: RenewalFile[],
  currency: string,
  organizationName: string,
) {
  const docs = sources.filter((s) => s.selected);
  const policies = docs.filter((d) => d.policy);
  return {
    metadata: { name: "Insurance renewal", organizationName },
    documentMap: docs.map((d) => ({
      externalId: d.id,
      externalSystem: "local",
      sha256: d.id.slice("local:sha256:".length),
      fileName: d.name,
      title: d.name,
      category: "Insurance",
      mimeType: d.file.type,
      fileSizeBytes: d.file.size,
      sourceExternalIds: [d.id],
    })),
    insurancePolicies: policies.map((d) => {
      const linked = docs.filter(
        (s) => s.id === d.id || s.links.includes(d.id),
      );
      const invoices = linked.filter(
        (s) =>
          s.invoice &&
          s.links.filter((id) => policies.some((p) => p.id === id)).length ===
            1,
      );
      const customerNumbers = [
        ...new Set(
          linked
            .flatMap((s) => [
              s.invoice?.brokerCustomerNumber,
              s.lines
                .find((l) => /customer number:/i.test(l.text))
                ?.text.match(/customer number:\s*([^\t]+)/i)?.[1],
            ])
            .filter(Boolean),
        ),
      ];
      return {
        ...d.policy,
        declarationExternalId: d.id,
        policySeriesKey:
          d.policy!.policySeriesKey ||
          [d.policy!.kind, d.policy!.insurer, d.policy!.policyNumber]
            .map((value) =>
              String(value || "")
                .trim()
                .toLowerCase(),
            )
            .join("|"),
        currency: d.policy!.currency || currency,
        sourceExternalIds: linked.map((s) => s.id),
        brokerCustomerNumber:
          customerNumbers.length === 1 ? customerNumbers[0] : undefined,
        invoiceObservations: invoices.map(
          (s): Record<string, any> => ({
            ...s.invoice,
            currency: s.invoice!.currency || currency,
            sourceExternalId: s.id,
          }),
        ),
      };
    }),
  };
}

/** Reattach reviewed facts only to the exact declaration bytes and the same policy term. */
export function applyReviewedPolicyFields(
  sources: RenewalFile[],
  bundle: any,
): RenewalFile[] {
  if (
    !Array.isArray(bundle?.insurancePolicies) ||
    !bundle.insurancePolicies.length
  )
    throw new Error("Choose an insurance field bundle.");
  const matched = new Set<string>();
  const updates = new Map<string, Record<string, unknown>>();
  for (const policy of bundle.insurancePolicies) {
    const declarations = sources.filter(
      (d) =>
        d.policy &&
        policy.sourceExternalIds?.includes(d.id) &&
        policy.policyNumber === d.policy.policyNumber &&
        policy.startDate === d.policy.startDate &&
        policy.endDate === d.policy.endDate,
    );
    if (declarations.length !== 1 || matched.has(declarations[0].id))
      throw new Error(
        "Each reviewed policy must match one declaration, policy number and term in this ZIP.",
      );
    if (
      !Array.isArray(policy.sourceExternalIds) ||
      policy.sourceExternalIds.some(
        (id: string) => !sources.some((s) => s.id === id),
      )
    )
      throw new Error("A referenced original is missing from this ZIP.");
    const id = declarations[0].id;
    matched.add(id);
    const fields: Record<string, unknown> = {};
    for (const key of [
      "kind",
      "insurer",
      "broker",
      "namedInsured",
      "currency",
      "coverholder",
      "brokerCustomerNumber",
      "billingMethod",
      "declaredOperations",
      "grossReceiptsCents",
      "minimumRetainedPremiumPercent",
      "premiumCents",
      "policyFeeCents",
      "totalCostCents",
      "policySeriesKey",
      "policyTermLabel",
      "coverageSummary",
      "coveredParties",
      "coverageItems",
      "coveredLocations",
      "policyDefinitions",
      "policyExclusions",
      "claimsMadeTerms",
      "additionalInsureds",
      "complianceChecks",
      "sensitivity",
      "notes",
    ]) {
      if (policy[key] != null) fields[key] = policy[key];
    }
    updates.set(id, fields);
  }
  return sources.map((s) => {
    const fields = updates.get(s.id);
    const links = [
      ...new Set([
        ...s.links,
        ...bundle.insurancePolicies
          .filter((p: any) => p.sourceExternalIds.includes(s.id))
          .flatMap((p: any) =>
            [...matched].filter((id) => p.sourceExternalIds.includes(id)),
          ),
      ]),
    ] as string[];
    return {
      ...s,
      policy: fields ? { ...s.policy, ...fields } : s.policy,
      links,
      selected: s.selected || links.length > 0,
    };
  });
}
