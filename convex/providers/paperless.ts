import { providers } from "./env";

export type PaperlessUploadResult = {
  taskId: string;
  documentId?: number;
  documentUrl?: string;
  demo: boolean;
};

export type PaperlessDownloadedDocument = {
  blob: Blob;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  documentUrl?: string;
  metadata?: any;
  demo: boolean;
};

export type PaperlessDocumentSummary = {
  id: number;
  title?: string;
  content?: string;
  created?: string;
  created_date?: string;
  added?: string;
  modified?: string;
  original_file_name?: string;
  original_filename?: string;
  archived_file_name?: string;
  archive_filename?: string;
  document_type?: number | null;
  tags?: number[];
};

export type PaperlessConnectionTest = {
  ok: boolean;
  provider: "paperlessngx" | "demo";
  demo: boolean;
  baseUrl?: string;
  apiVersion?: string;
  serverVersion?: string;
  documentCount?: number;
  error?: string;
};

function env(name: string): string | undefined {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

function paperlessBaseUrl() {
  const raw = env("PAPERLESS_NGX_URL")?.trim();
  if (!raw) throw new Error("Live Paperless-ngx requires PAPERLESS_NGX_URL.");
  return raw.replace(/\/+$/, "");
}

function paperlessToken() {
  const token = env("PAPERLESS_NGX_TOKEN")?.trim();
  if (!token) throw new Error("Live Paperless-ngx requires PAPERLESS_NGX_TOKEN.");
  return token;
}

function liveHeaders(extra?: HeadersInit) {
  return {
    Authorization: `Token ${paperlessToken()}`,
    Accept: "application/json",
    ...extra,
  };
}

function buildUrl(path: string) {
  return `${paperlessBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function paperlessFetch(path: string, init?: RequestInit) {
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: liveHeaders(init?.headers),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Paperless-ngx ${response.status}: ${body || response.statusText}`,
    );
  }
  return response;
}

export function paperlessRuntimeStatus() {
  const provider = providers.paperless();
  return {
    provider: provider.id,
    live: provider.live,
    configured: provider.live,
    baseUrl: env("PAPERLESS_NGX_URL")?.replace(/\/+$/, ""),
  };
}

export async function testPaperlessConnection(): Promise<PaperlessConnectionTest> {
  const provider = providers.paperless();
  if (provider.id === "demo") {
    return {
      ok: true,
      provider: "demo",
      demo: true,
      baseUrl: "demo://paperless-ngx",
      apiVersion: "demo",
      serverVersion: "demo",
      documentCount: 3,
    };
  }

  try {
    const response = await paperlessFetch("/api/documents/?page_size=1");
    const data = await parseResponse(response);
    return {
      ok: true,
      provider: "paperlessngx",
      demo: false,
      baseUrl: paperlessBaseUrl(),
      apiVersion: response.headers.get("x-api-version") ?? undefined,
      serverVersion: response.headers.get("x-version") ?? undefined,
      documentCount: typeof data?.count === "number" ? data.count : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      provider: "paperlessngx",
      demo: false,
      baseUrl: env("PAPERLESS_NGX_URL")?.replace(/\/+$/, ""),
      error: error?.message ?? "Paperless-ngx connection failed.",
    };
  }
}

export async function listPaperlessDocuments(args: {
  maxDocuments?: number;
  pageSize?: number;
  query?: string;
} = {}): Promise<PaperlessDocumentSummary[]> {
  const provider = providers.paperless();
  if (provider.id === "demo") {
    return [
      {
        id: 1001,
        title: "Demo Board Meeting Minutes",
        content: "Meeting Minutes\nDate: 2024-01-15\nPresent: Ada Lovelace, Grace Hopper\nMotion: Approve the budget. Moved by Ada Lovelace. Seconded by Grace Hopper. Carried.",
        created: "2024-01-15",
        original_file_name: "Demo Board Meeting Minutes.pdf",
        archived_file_name: "2024-01-15 Demo Board Meeting Minutes.pdf",
      },
      {
        id: 1002,
        title: "Demo AGM Minutes",
        content: "Annual General Meeting Minutes\nDate: 2024-03-20\nPresent: Ada Lovelace, Grace Hopper\nQuorum met.\nMotion: Elect the board slate. Carried.",
        created: "2024-03-20",
        original_file_name: "Demo AGM Minutes.pdf",
        archived_file_name: "2024-03-20 Demo AGM Minutes.pdf",
      },
    ];
  }

  const pageSize = Math.max(1, Math.min(args.pageSize ?? 100, 100));
  const maxDocuments = Math.max(1, args.maxDocuments ?? 500);
  const params = new URLSearchParams({
    page_size: String(pageSize),
    ordering: "created",
  });
  if (args.query?.trim()) params.set("query", args.query.trim());

  let path: string | null = `/api/documents/?${params.toString()}`;
  const docs: PaperlessDocumentSummary[] = [];
  while (path && docs.length < maxDocuments) {
    const response = await paperlessFetch(path);
    const data = await parseResponse(response);
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    docs.push(...results.slice(0, maxDocuments - docs.length));
    path = data?.next ? pathFromPaperlessUrl(String(data.next)) : null;
  }
  return docs;
}

export function paperlessDocumentUrl(documentId: number) {
  if (providers.paperless().id === "demo") return `demo://paperless/${documentId}`;
  return `${paperlessBaseUrl()}/documents/${documentId}/details`;
}

export async function downloadPaperlessDocument(
  documentId: number,
  original = false,
): Promise<PaperlessDownloadedDocument> {
  const provider = providers.paperless();
  if (provider.id === "demo") {
    const fileName = `paperless-${documentId}.txt`;
    const blob = new Blob(
      [`Demo Paperless source document ${documentId}\n\nSet PAPERLESS_NGX_URL and PAPERLESS_NGX_TOKEN to pull the live file.`],
      { type: "text/plain" },
    );
    return {
      blob,
      fileName,
      mimeType: "text/plain",
      sizeBytes: blob.size,
      documentUrl: paperlessDocumentUrl(documentId),
      metadata: {
        id: documentId,
        title: `Paperless source ${documentId}`,
        content: "Demo Paperless source document.",
      },
      demo: true,
    };
  }

  const detailResponse = await paperlessFetch(`/api/documents/${documentId}/`);
  const metadata = await parseResponse(detailResponse);
  const response = await paperlessFetch(
    `/api/documents/${documentId}/download/${original ? "?original=true" : ""}`,
    { headers: { Accept: "*/*" } },
  );
  const blob = await response.blob();
  const mimeType = response.headers.get("content-type") ?? metadata?.mime_type ?? undefined;
  const sizeBytes = Number(response.headers.get("content-length")) || blob.size || undefined;
  return {
    blob,
    fileName:
      filenameFromDisposition(response.headers.get("content-disposition")) ??
      metadata?.archived_file_name ??
      metadata?.archive_filename ??
      metadata?.original_file_name ??
      metadata?.original_filename ??
      `paperless-${documentId}`,
    mimeType,
    sizeBytes,
    documentUrl: paperlessDocumentUrl(documentId),
    metadata,
    demo: false,
  };
}

export async function uploadDocumentToPaperless(args: {
  blob: Blob;
  fileName: string;
  title: string;
  createdISO?: string;
  tags: string[];
  autoCreateTags: boolean;
}): Promise<PaperlessUploadResult> {
  const provider = providers.paperless();
  if (provider.id === "demo") {
    const documentId = Math.floor(Date.now() % 900000) + 1000;
    return {
      taskId: `demo-paperless-task-${documentId}`,
      documentId,
      documentUrl: paperlessDocumentUrl(documentId),
      demo: true,
    };
  }

  const form = new FormData();
  form.append("document", args.blob, args.fileName);
  form.append("title", args.title);
  if (args.createdISO) form.append("created", args.createdISO.slice(0, 10));

  const tagIds = args.autoCreateTags
    ? await ensurePaperlessTags(args.tags)
    : args.tags.map((tag) => Number(tag)).filter(Number.isFinite);
  for (const tagId of tagIds) form.append("tags", String(tagId));

  const response = await paperlessFetch("/api/documents/post_document/", {
    method: "POST",
    body: form,
  });
  const data = await parseResponse(response);
  return {
    taskId: normalizeTaskId(data),
    demo: false,
  };
}

export async function getPaperlessTask(taskId: string) {
  if (providers.paperless().id === "demo") {
    const documentId = Number(taskId.match(/(\d+)$/)?.[1] ?? 1001);
    return {
      status: "complete",
      documentId,
      documentUrl: paperlessDocumentUrl(documentId),
      raw: null,
    };
  }

  const response = await paperlessFetch(
    `/api/tasks/?task_id=${encodeURIComponent(taskId)}`,
  );
  const data = await parseResponse(response);
  const task = Array.isArray(data?.results)
    ? data.results[0]
    : Array.isArray(data)
      ? data[0]
      : data;
  const documentId = extractDocumentId(task);
  return {
    status: normalizeTaskStatus(task),
    documentId,
    documentUrl: documentId ? paperlessDocumentUrl(documentId) : undefined,
    raw: task,
  };
}

async function ensurePaperlessTags(names: string[]) {
  const normalized = uniqueTags(names);
  if (normalized.length === 0) return [];

  const existing = await listPaperlessTags();
  const byName = new Map(
    existing.map((tag: any) => [String(tag.name ?? "").toLowerCase(), tag]),
  );
  const ids: number[] = [];

  for (const name of normalized) {
    const key = name.toLowerCase();
    const existingTag = byName.get(key);
    if (existingTag?.id != null) {
      ids.push(Number(existingTag.id));
      continue;
    }

    const response = await paperlessFetch("/api/tags/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: "#537188" }),
    });
    const created = await parseResponse(response);
    if (created?.id == null) {
      throw new Error(`Paperless-ngx did not return an id for tag "${name}".`);
    }
    ids.push(Number(created.id));
    byName.set(key, created);
  }

  return ids;
}

async function listPaperlessTags() {
  const response = await paperlessFetch("/api/tags/?page_size=200");
  const data = await parseResponse(response);
  return Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
}

function pathFromPaperlessUrl(value: string) {
  if (!value.startsWith("http://") && !value.startsWith("https://")) return value;
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function normalizeTaskId(data: any) {
  if (typeof data === "string") return data;
  const value = data?.task_id ?? data?.taskId ?? data?.uuid ?? data?.id ?? data;
  return String(value);
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i)?.[1];
  return plain ? plain.trim() : null;
}

function extractDocumentId(task: any): number | undefined {
  const candidates = [
    task?.related_document,
    task?.document_id,
    task?.documentId,
    task?.result?.document_id,
    task?.result?.document,
  ];
  for (const candidate of candidates) {
    const value =
      typeof candidate === "object" && candidate !== null ? candidate.id : candidate;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function normalizeTaskStatus(task: any) {
  const raw = String(task?.status ?? task?.state ?? "").toLowerCase();
  if (["success", "succeeded", "complete", "completed"].includes(raw)) return "complete";
  if (["failure", "failed", "error"].includes(raw)) return "failed";
  if (["started", "running", "processing", "progress"].includes(raw)) return "processing";
  return raw || "queued";
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = tag
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w .:/-]/g, "")
      .slice(0, 80);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
