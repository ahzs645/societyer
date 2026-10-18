// Exported minutes keep the transcript's line structure: one paragraph per
// `Name: text` line with the speaker in bold, in the HTML every export starts
// from and in the Word XML that the preview, PDF and .docx are built from.
// Run: node --import tsx scripts/check-minutes-transcript-export.ts
import assert from "node:assert/strict";
import { MINUTES_EXPORT_STYLES, renderMinutesHtml, renderTranscriptLinesHtml } from "../src/features/meetings/lib/minutesRenderer";

const transcript = [
  "Mina Patel: Good evening everyone. I'm calling the meeting to order at seven oh two.",
  "Jordan Lee: Thanks. Before we start, I'd like to add the community garden lease.",
  "",
  "Devon Clarke: I move that we approve the draft budget as circulated.",
  "[0:42] Avery Santos: Seconded & noted <for the record>.",
  "The motion carries unanimously. Recorded at 7:30 pm.",
].join("\n");

const minutes = {
  heldAt: "2026-11-01T18:00:00Z",
  attendees: [],
  absent: [],
  quorumMet: false,
  discussion: "Budget discussion",
  motions: [],
  decisions: [],
  actionItems: [],
  draftTranscript: transcript,
};
const args = { society: { name: "Transcript fixture" }, meeting: { title: "Board meeting", type: "Board", scheduledAt: minutes.heldAt }, minutes };

// ---- HTML -----------------------------------------------------------------
const expectedLines = [
  '<strong>Mina Patel:</strong> Good evening everyone. I&#39;m calling the meeting to order at seven oh two.',
  "<strong>Jordan Lee:</strong> Thanks. Before we start, I&#39;d like to add the community garden lease.",
  "<strong>Devon Clarke:</strong> I move that we approve the draft budget as circulated.",
  "[0:42] <strong>Avery Santos:</strong> Seconded &amp; noted &lt;for the record&gt;.",
  "The motion carries unanimously. Recorded at 7:30 pm.",
];

function transcriptParagraphs(html: string): string[] {
  return [...html.matchAll(/<p class="minutes-transcript-line"[^>]*>([\s\S]*?)<\/p>/g)].map((match) => match[1]);
}

assert.deepEqual(transcriptParagraphs(renderTranscriptLinesHtml(transcript)), expectedLines, "one paragraph per non-empty line");

for (const { id: styleId } of MINUTES_EXPORT_STYLES) {
  const html = renderMinutesHtml({ ...args, styleId, options: { includeTranscript: true, includeGeneratedFooter: false } });
  assert.ok(html.includes("<h2>Transcript</h2>"), `${styleId}: transcript heading`);
  assert.deepEqual(transcriptParagraphs(html), expectedLines, `${styleId}: transcript lines`);
  assert.ok(!/white-space:\s*pre-wrap[^>]*>Mina Patel/.test(html), `${styleId}: no single pre-wrap transcript paragraph`);
  const without = renderMinutesHtml({ ...args, styleId, options: { includeTranscript: false } });
  assert.ok(!without.includes("minutes-transcript-line"), `${styleId}: transcript omitted when off`);
}

// Long transcripts stay linear: 5,000 lines render quickly.
const long = Array.from({ length: 5000 }, (_, index) => `Speaker ${index % 7}: Line ${index} of a long meeting.`).join("\n");
const started = performance.now();
const longHtml = renderTranscriptLinesHtml(long);
assert.equal(transcriptParagraphs(longHtml).length, 5000, "long transcript keeps every line");
assert.ok(performance.now() - started < 500, "long transcript renders in under 500 ms");

// ---- DOCX -----------------------------------------------------------------
// docx.ts walks a browser DOM. Node has none, so this installs a minimal one
// that covers what the transcript section uses (elements, text, attributes).
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeNode {
  childNodes: FakeNode[] = [];
  constructor(readonly nodeType: number) {}
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
}

class FakeText extends FakeNode {
  constructor(readonly data: string) {
    super(TEXT_NODE);
  }
  override get textContent(): string {
    return this.data;
  }
}

class FakeElement extends FakeNode {
  constructor(
    readonly tagName: string,
    private readonly attributes: Map<string, string>,
  ) {
    super(ELEMENT_NODE);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  querySelectorAll(tag: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeNode) => {
      for (const child of node.childNodes) {
        if (child instanceof FakeElement) {
          if (child.tagName.toLowerCase() === tag) found.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return found;
  }
}

const VOID_TAGS = new Set(["br", "hr", "img", "meta", "input"]);

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseHtml(html: string): FakeElement {
  const body = new FakeElement("BODY", new Map());
  const stack: FakeElement[] = [body];
  const tokens = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  for (const match of html.matchAll(tokens)) {
    const parent = stack[stack.length - 1];
    if (match[3] !== undefined) {
      parent.childNodes.push(new FakeText(decodeEntities(match[3])));
      continue;
    }
    const tag = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      if (tag !== "body" && stack.length > 1) stack.pop();
      continue;
    }
    if (tag === "body") continue;
    const attributes = new Map<string, string>();
    for (const attr of (match[2] ?? "").matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
      attributes.set(attr[1].toLowerCase(), decodeEntities(attr[2] ?? ""));
    }
    const element = new FakeElement(tag.toUpperCase(), attributes);
    parent.childNodes.push(element);
    if (!VOID_TAGS.has(tag)) stack.push(element);
  }
  return body;
}

Object.assign(globalThis, {
  Node: { TEXT_NODE, ELEMENT_NODE },
  HTMLElement: FakeElement,
  DOMParser: class {
    parseFromString(html: string): { body: FakeElement; querySelectorAll: (tag: string) => FakeElement[] } {
      const body = parseHtml(html);
      return { body, querySelectorAll: (tag: string) => body.querySelectorAll(tag) };
    }
  },
});

const { buildWordDocxBlob } = await import("../src/lib/docx");

async function documentXml(bodyHtml: string): Promise<string> {
  const blob = await buildWordDocxBlob({ bodyHtml });
  // Stored (uncompressed) zip: the document part is plain text inside the archive.
  const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  const start = text.indexOf("<w:document");
  const end = text.indexOf("</w:document>", start);
  assert.ok(start >= 0 && end > start, "word/document.xml present");
  return text.slice(start, end);
}

function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((match) => match[1]);
}

function paragraphText(paragraph: string): string {
  return [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join("");
}

const html = renderMinutesHtml({ ...args, styleId: "standard", options: { includeTranscript: true, includeGeneratedFooter: false } });
const section = html.slice(html.indexOf("<h2>Transcript</h2>"));
const xml = await documentXml(section);
const docxParagraphs = paragraphs(xml);
const lineParagraphs = docxParagraphs.slice(2); // heading, "Raw transcript retained…"
assert.equal(paragraphText(docxParagraphs[0]), "Transcript");
assert.deepEqual(
  lineParagraphs.map(paragraphText),
  [
    "Mina Patel: Good evening everyone. I&apos;m calling the meeting to order at seven oh two.",
    "Jordan Lee: Thanks. Before we start, I&apos;d like to add the community garden lease.",
    "Devon Clarke: I move that we approve the draft budget as circulated.",
    "[0:42] Avery Santos: Seconded &amp; noted &lt;for the record&gt;.",
    "The motion carries unanimously. Recorded at 7:30 pm.",
  ],
  "one Word paragraph per transcript line",
);
for (const paragraph of lineParagraphs.slice(0, 4)) {
  assert.match(paragraph, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">[^<]+:<\/w:t><\/w:r>/, "speaker name run is bold");
}
assert.ok(!/<w:b\/>/.test(lineParagraphs[4]), "line without a speaker has no bold run");

// <pre> and white-space: pre-wrap content keep their line breaks as <w:br/>.
const preXml = await documentXml("<pre>alpha\nbeta\ngamma</pre>");
assert.equal((paragraphs(preXml)[0].match(/<w:br\/>/g) ?? []).length, 2, "<pre> newlines become <w:br/>");
const preWrapXml = await documentXml('<p style="white-space: pre-wrap;">one\ntwo</p><p>three\nfour</p>');
const [preWrap, normal] = paragraphs(preWrapXml);
assert.equal((preWrap.match(/<w:br\/>/g) ?? []).length, 1, "pre-wrap newline becomes <w:br/>");
assert.ok(!normal.includes("<w:br/>") && paragraphText(normal) === "three four", "normal paragraphs still collapse whitespace");

console.log(`check-minutes-transcript-export: ${MINUTES_EXPORT_STYLES.length} styles, HTML and DOCX line structure OK`);
