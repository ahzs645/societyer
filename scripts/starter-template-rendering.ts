export type StarterTemplateSectionLike = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type StarterTemplateLike = {
  key: string;
  name: string;
  policyNumber: string;
  templateType?: "policy" | "document";
  sourceFile?: string;
  sourceSha256?: string;
  includeBoardAcceptance?: boolean;
  sections: StarterTemplateSectionLike[];
};

export type StarterTemplateSampleData = {
  note: string;
  values: Record<string, string>;
  directors: Array<Record<string, string>>;
};

export type StarterTemplateBlock = {
  kind: "title" | "heading" | "paragraph" | "listItem" | "small" | "preformatted";
  text: string;
};

const WORD_STOP_LIST = new Set([
  "about",
  "above",
  "after",
  "again",
  "also",
  "been",
  "below",
  "between",
  "board",
  "corporation",
  "date",
  "directors",
  "each",
  "effective",
  "from",
  "have",
  "into",
  "must",
  "name",
  "only",
  "organization",
  "policy",
  "review",
  "shall",
  "that",
  "their",
  "there",
  "this",
  "under",
  "where",
  "which",
  "will",
  "with",
  "your",
]);

export function starterSampleData(template: Pick<StarterTemplateLike, "name" | "policyNumber">): StarterTemplateSampleData {
  return {
    note: "Dummy data for export preview and PDF/source comparison only. Do not treat these values as imported organization facts.",
    values: {
      CorporationName: "Sample Community Society",
      PolicyName: template.name,
      PolicyNumber: template.policyNumber,
      PolicyEffectiveDate: "2026-01-01",
      EffectiveDate: "2026-01-01",
      ReviewDate: "2027-01-01",
      NonBudgetedApprovalLimit: "$1,000",
      ComplaintAcknowledgementDays: "5",
      PrivacyOfficerName: "Privacy Officer",
      PrivacyOfficerEmail: "privacy@example.org",
      MotionText: "the attached policy be approved and added to the society records",
      MovedBy: "Avery Chen",
      SecondedBy: "Morgan Patel",
      Outcome: "Carried",
    },
    directors: [
      { SignerTag: "Chair", "Director-Name": "Avery Chen" },
      { SignerTag: "Treasurer", "Director-Name": "Morgan Patel" },
    ],
  };
}

export function renderStarterTemplateSampleHtml(
  template: StarterTemplateLike,
  html: string,
  sampleData = starterSampleData(template),
) {
  let rendered = html;
  rendered = rendered.replace(/\{#SoleVotDir\}[\s\S]*?\{\/SoleVotDir\}/g, "");
  rendered = rendered.replace(/\{#MultiVotDir\}([\s\S]*?)\{\/MultiVotDir\}/g, "$1");
  rendered = rendered.replace(/\{#VotingDirectors\}([\s\S]*?)\{\/VotingDirectors\}/g, (_match, inner: string) =>
    sampleData.directors.map((director) => replacePlaceholders(inner, { ...sampleData.values, ...director })).join("<br />\n"),
  );
  return replacePlaceholders(rendered, sampleData.values);
}

export function exactSourceTextToHtml(sourceText: string) {
  return `<pre class="source-pdf-template">${escapeHtml(sourceText)}</pre>`;
}

export function renderExactSourceSampleText(sourceText: string, sampleData: StarterTemplateSampleData) {
  let rendered = sourceText;
  rendered = rendered.replace(/\{#SoleVotDir\}[\s\S]*?\{\/SoleVotDir\}/g, "");
  rendered = rendered.replace(/\{#MultiVotDir\}([\s\S]*?)\{\/MultiVotDir\}/g, "$1");
  rendered = rendered.replace(/\{#VotingDirectors\}([\s\S]*?)\{\/VotingDirectors\}/g, (_match, inner: string) =>
    sampleData.directors.map((director) => replacePlaceholders(inner, { ...sampleData.values, ...director })).join("\n"),
  );
  return replacePlaceholders(rendered, sampleData.values);
}

export function sourceTextToBlocks(sourceText: string) {
  return [{ kind: "preformatted", text: sourceText }] satisfies StarterTemplateBlock[];
}

export function renderStarterTemplateBlocks(template: StarterTemplateLike, sampleData = starterSampleData(template)) {
  const blocks: StarterTemplateBlock[] = [
    { kind: "title", text: sampleData.values.PolicyName },
    { kind: "paragraph", text: `Organization: ${sampleData.values.CorporationName}` },
    { kind: "paragraph", text: `Policy number: ${sampleData.values.PolicyNumber}` },
    { kind: "paragraph", text: `Effective date: ${sampleData.values.PolicyEffectiveDate}` },
    {
      kind: "paragraph",
      text: "This is a Societyer starter template remade from imported source material. Review it for your jurisdiction, bylaws, funder requirements, charity status, and actual operations before adoption.",
    },
  ];

  for (const section of template.sections) {
    blocks.push({ kind: "heading", text: section.heading });
    for (const paragraph of section.paragraphs ?? []) {
      blocks.push({ kind: "paragraph", text: fillText(paragraph, sampleData) });
    }
    for (const bullet of section.bullets ?? []) {
      blocks.push({ kind: "listItem", text: fillText(bullet, sampleData) });
    }
  }

  blocks.push({ kind: "heading", text: "Monitoring" });
  blocks.push({
    kind: "paragraph",
    text: `This ${template.templateType === "document" ? "template" : "policy"} will be reviewed on or around ${sampleData.values.ReviewDate} and whenever legal, operational, funding, or governance requirements materially change.`,
  });

  if (template.includeBoardAcceptance !== false) {
    blocks.push({ kind: "heading", text: "Board Acceptance" });
    blocks.push({
      kind: "paragraph",
      text: `This policy was approved by resolution of the board of directors of ${sampleData.values.CorporationName} on ${sampleData.values.EffectiveDate}.`,
    });
    blocks.push({ kind: "paragraph", text: "Approved by counterpart signatures of the voting directors." });
    for (const director of sampleData.directors) {
      blocks.push({ kind: "paragraph", text: `${director.SignerTag}\n_________________________________________\n${director["Director-Name"]}` });
    }
  }

  if (template.sourceFile || template.sourceSha256) {
    blocks.push({ kind: "small", text: `Source: ${template.sourceFile ?? "unknown"}; SHA-256 ${template.sourceSha256 ?? "unknown"}` });
  }

  return blocks;
}

export function blocksToPlainText(blocks: StarterTemplateBlock[]) {
  if (blocks.every((block) => block.kind === "preformatted")) {
    return blocks.map((block) => block.text).join("\n");
  }
  return blocks.map((block) => block.text).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function compareTemplateText(originalText: string, renderedText: string) {
  const sourceKeywords = keywordSet(originalText);
  const renderedKeywords = keywordSet(renderedText);
  const sharedKeywords = [...sourceKeywords].filter((word) => renderedKeywords.has(word));
  const sourceOnlyKeywords = [...sourceKeywords].filter((word) => !renderedKeywords.has(word)).sort().slice(0, 40);
  const renderedOnlyKeywords = [...renderedKeywords].filter((word) => !sourceKeywords.has(word)).sort().slice(0, 40);
  const sourceKeywordCoverage = sourceKeywords.size ? sharedKeywords.length / sourceKeywords.size : 1;
  const renderedKeywordOverlap = renderedKeywords.size ? sharedKeywords.length / renderedKeywords.size : 1;

  return {
    method: "Normalized keyword overlap between extracted source PDF text and the dummy-filled remade template. This flags drift only; it is not a legal-equivalence review.",
    originalWordCount: wordCount(originalText),
    renderedSampleWordCount: wordCount(renderedText),
    sourceKeywordCount: sourceKeywords.size,
    renderedKeywordCount: renderedKeywords.size,
    sharedKeywordCount: sharedKeywords.length,
    sourceKeywordCoverage: round(sourceKeywordCoverage),
    renderedKeywordOverlap: round(renderedKeywordOverlap),
    status: sourceKeywordCoverage >= 0.75 ? "good_overlap" : sourceKeywordCoverage >= 0.45 ? "partial_overlap" : "low_overlap_review_required",
    sourceOnlyKeywords,
    renderedOnlyKeywords,
  };
}

export function compareExactTemplateText(originalText: string, templateText: string) {
  const normalizedOriginal = normalizeForExactComparison(originalText);
  const normalizedTemplate = normalizeForExactComparison(templateText);
  const exactTextMatch = normalizedOriginal === normalizedTemplate;
  return {
    method: "Normalized text equality between extracted source PDF text and the generated canonical template text.",
    exactTextMatch,
    originalCharacterCount: normalizedOriginal.length,
    templateCharacterCount: normalizedTemplate.length,
    originalLineCount: normalizedOriginal ? normalizedOriginal.split("\n").length : 0,
    templateLineCount: normalizedTemplate ? normalizedTemplate.split("\n").length : 0,
    status: exactTextMatch ? "exact_text_match" : "text_mismatch_review_required",
  };
}

function fillText(value: string, sampleData: StarterTemplateSampleData) {
  return replacePlaceholders(value, sampleData.values);
}

function replacePlaceholders(input: string, values: Record<string, string>) {
  return input.replace(/\{([A-Za-z0-9_-]+)\}/g, (_match, key: string) => values[key] ?? `[${key}]`);
}

function normalizeForExactComparison(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function keywordSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/\{[#/]?[a-z0-9_-]+\}/gi, " ")
      .match(/[a-z][a-z'-]{2,}/g)
      ?.map((word) => word.replace(/^'+|'+$/g, ""))
      .filter((word) => word.length >= 4 && !WORD_STOP_LIST.has(word)) ?? [],
  );
}

function wordCount(value: string) {
  return value.match(/[A-Za-z0-9]+/g)?.length ?? 0;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
