/**
 * Document tools. Document access rules (restricted documents, meeting
 * material grants) apply in the wrapped queries, and so does the in-camera
 * rule: a connector never holds in-camera access (decision A5), so in-camera
 * material comes back as a placeholder with no text (`restricted: "in_camera"`).
 */
import { z } from "zod";
import { AgentToolError, READ_ANNOTATIONS, defineAgentTool } from "../types";
import { UNTRUSTED_NOTICE, asRows, idOf, isRow, label, limitInput, matchesQuery, page, untrustedTextSchema, type Row } from "../output";

const documentSummary = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  librarySection: z.string().optional(),
  reviewStatus: z.string().optional(),
  tags: z.array(z.string()),
  createdAt: z.string().optional(),
  /** In-camera material: listed so the model knows it exists, never its title, file or text. */
  restricted: z.literal("in_camera").optional(),
});

function summarizeDocument(row: Row): z.infer<typeof documentSummary> {
  return {
    id: idOf(row),
    title: label(row.title) ?? "Untitled document",
    category: label(row.category),
    fileName: label(row.fileName),
    mimeType: label(row.mimeType, 100),
    librarySection: label(row.librarySection),
    reviewStatus: label(row.reviewStatus),
    tags: Array.isArray(row.tags) ? row.tags.slice(0, 10).map((tag) => label(tag, 40)).filter((tag): tag is string => Boolean(tag)) : [],
    createdAt: label(row.createdAtISO),
    ...(row.inCameraWithheld === "in_camera" ? { restricted: "in_camera" as const } : {}),
  };
}

export const searchDocuments = defineAgentTool({
  name: "search_documents",
  title: "Search documents",
  description: "Find documents you can open by words in their title, file name, category or tags. Use get_document to read one.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "documents:listSummaries", kind: "query" }],
  requires: ["documents:read"],
  input: z.strictObject({
    query: z.string().trim().min(1).max(200),
    category: z.string().max(80).optional(),
    limit: limitInput(10, 25),
  }),
  async handler({ query, category, limit }, adapter) {
    const rows = asRows(await adapter.query("documents:listSummaries", { societyId: adapter.context.workspace.id }))
      .filter((row) => !category || String(row.category).toLowerCase() === category.toLowerCase())
      .filter((row) => matchesQuery(query, [row.title, row.fileName, row.category, row.tags]))
      .sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
    const { items, total, truncated } = page(rows, limit);
    return { total, truncated, documents: items.map(summarizeDocument) };
  },
  output: z.object({ total: z.number(), truncated: z.boolean(), documents: z.array(documentSummary) }),
});

const MAX_CHARS = 12_000;

export const getDocument = defineAgentTool({
  name: "get_document",
  title: "Get document",
  description: "Read a document's details and a slice of its extracted text. Page through long text with offset.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "documents:get", kind: "query" }],
  requires: ["documents:read"],
  input: z.strictObject({
    documentId: z.string().min(1).max(100),
    offset: z.number().int().min(0).max(50_000_000).default(0).describe("Character offset into the text."),
    maxChars: z.number().int().min(200).max(MAX_CHARS).default(4000),
  }),
  async handler({ documentId, offset, maxChars }, adapter) {
    const document = await adapter.query<unknown>("documents:get", { id: documentId });
    if (!isRow(document)) throw new AgentToolError("not_found", "Document not found, or your role can't open it.");
    const content = typeof document.content === "string" && document.inCameraWithheld === undefined ? document.content : "";
    const slice = content.slice(offset, offset + maxChars);
    const end = offset + slice.length;
    return {
      notice: UNTRUSTED_NOTICE,
      document: summarizeDocument(document),
      content: slice ? { untrusted: slice, ...(end < content.length || offset > 0 ? { truncated: true as const, totalChars: content.length } : {}) } : null,
      contentRange: { offset, end, totalChars: content.length, nextOffset: end < content.length ? end : null },
    };
  },
  output: z.object({
    notice: z.string(),
    document: documentSummary,
    content: untrustedTextSchema.nullable(),
    contentRange: z.object({ offset: z.number(), end: z.number(), totalChars: z.number(), nextOffset: z.number().nullable() }),
  }),
});
