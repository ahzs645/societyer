/**
 * The host the review plugin talks to (contract §2): plugin-site's read-only
 * `execute()` answered from the local snapshot. Reads route to the catalog
 * worker and the snapshot's document blobs; everything else is refused.
 * DOM side effects (navigation, previews, downloads) are injected so the
 * policy here can be checked on its own.
 */
import type { CatalogDocument, CatalogMethod } from "./readOnlyCatalog";
import type { ReviewAppearance } from "./theme";

export const READ_ONLY_MESSAGE = "This is a read-only published copy. Open the plugin inside Zoer to run actions or edit data.";

export type HostCapabilities = {
  version: 1;
  surface: "zoer" | "societyer" | "site";
  collection: boolean;
  writes: boolean;
  ai: boolean;
  sourceLabel?: string;
};
/**
 * `location` is plugin-relative ("/opportunities/x?tab=docs"); `baseUrl` is the
 * module route's absolute URL and `hrefBase` its path (basename included, no
 * trailing slash), so `${hrefBase}${location}` is a link that opens the same view.
 */
export type NavigationState = { version: 1; location: string; baseUrl: string; hrefBase: string };
export type OverlayState = { open: boolean; insets: { top: number; right: number; bottom: number; left: number } };

export type ReviewHost = {
  request(method: string, input?: unknown): Promise<unknown>;
  subscribe(listener: (event: string, result: unknown) => void): () => void;
};

export type ReviewHostDependencies = {
  sourceLabel: string;
  catalog: (method: CatalogMethod, input: unknown) => Promise<unknown>;
  /** Verified bytes of the snapshot blob with this content address. */
  readDocument: (sha256: string) => Promise<Uint8Array>;
  navigation: { read(): NavigationState; write(location: string, mode: "push" | "replace"): NavigationState };
  appearance: () => ReviewAppearance;
  overlay: (open: boolean) => OverlayState;
  /** A URL the plugin can show the PDF from (an object URL in the browser). */
  previewUrl: (bytes: Uint8Array) => string;
  download: (bytes: Uint8Array, fileName: string) => void;
};

export type ReviewHostController = ReviewHost & { publish(event: "navigation" | "appearance" | "overlay", result: unknown): void };

const MAX_PENDING = 8;
const CATALOG_METHODS: Readonly<Record<string, CatalogMethod>> = {
  "catalog.query": "query",
  "catalog.read": "read",
  "catalog.workspace": "workspace",
  "catalog.history": "history",
  "catalog.record": "record",
  "catalog.state": "state",
};

const asInput = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** A plugin-relative location: a path from "/", bounded, never protocol-relative. */
export function validatePluginLocation(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 2000 || /[\x00-\x1f\\]/.test(value)) throw new Error("Invalid navigation target.");
  return value;
}

export function downloadFileName(value: unknown): string {
  const name = String(value || "document").replace(/[/\\\x00-\x1f]/g, "_").trim().slice(0, 180);
  return name || "document";
}

const isPdf = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

export function createReviewHost(deps: ReviewHostDependencies): ReviewHostController {
  const listeners = new Set<(event: string, result: unknown) => void>();
  let pending = 0;

  const documentBytes = async (input: Record<string, unknown>) => {
    const document = await deps.catalog("document", { id: input.id, sha256: input.sha256 }) as CatalogDocument | null;
    if (!document?.content) throw new Error("Downloaded document not found");
    return { document, bytes: await deps.readDocument(document.content) };
  };

  async function execute(method: string, input: unknown): Promise<unknown> {
    const args = asInput(input);
    if (method === "host.capabilities") {
      return { version: 1, surface: "societyer", collection: false, writes: false, ai: false, sourceLabel: deps.sourceLabel } satisfies HostCapabilities;
    }
    if (method === "navigation.read") return deps.navigation.read();
    if (method === "navigation.write") return deps.navigation.write(validatePluginLocation(args.location), args.mode === "replace" ? "replace" : "push");
    if (method === "appearance") return deps.appearance();
    if (method === "overlay") {
      const result = deps.overlay(args.open === true);
      publish("overlay", result);
      return result;
    }
    // A published copy has no workflow runtime: no runs, artifacts or schedules.
    if (method === "state") return { runs: [], runsTruncated: false, artifacts: [], capabilities: { readOnly: true } };
    if (method === "schedules.read") return { schedules: [] };
    if (method === "models") return { models: [], activeModelProfileId: null };
    const catalogMethod = Object.prototype.hasOwnProperty.call(CATALOG_METHODS, method) ? CATALOG_METHODS[method] : undefined;
    if (catalogMethod) return deps.catalog(catalogMethod, input);
    if (method === "catalog.preview") {
      const { bytes } = await documentBytes(args);
      if (!isPdf(bytes)) throw new Error("Only PDF files can be previewed.");
      return { url: deps.previewUrl(bytes), mediaType: "application/pdf" };
    }
    if (method === "catalog.download") {
      const { document, bytes } = await documentBytes(args);
      deps.download(bytes, downloadFileName(args.name || document.name));
      return { downloaded: true };
    }
    throw new Error(READ_ONLY_MESSAGE);
  }

  function publish(event: "navigation" | "appearance" | "overlay", result: unknown) {
    for (const listener of [...listeners]) {
      try { listener(event, result); } catch { /* A plugin listener's failure is the plugin's to report. */ }
    }
  }

  return {
    async request(method, input) {
      if (typeof method !== "string") throw new Error(READ_ONLY_MESSAGE);
      if (pending >= MAX_PENDING) throw new Error("Workspace request limit reached.");
      pending++;
      try {
        return await execute(method, input);
      } finally {
        pending--;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish,
  };
}
