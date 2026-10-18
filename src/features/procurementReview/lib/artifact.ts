/**
 * The review plugin is a separately built, self-contained ES module (contract
 * §4) copied into public/plugins/bc-bid-monitor/ by
 * scripts/sync-procurement-review.ts, which also writes artifactPin.ts. The
 * page loads exactly the pinned build: each file is fetched and checked
 * against its pinned sha256 before the module is imported.
 */
import type { ReviewHost } from "./bridge";
import { sha256Hex } from "./digest";

export type ReviewArtifactPin = {
  pluginId: "bc-bid-monitor";
  pluginVersion: string;
  commit?: string;
  builtAt?: string;
  sha256: { "index.js": string; "style.css": string };
};

export type ReviewArtifact = { mount(element: HTMLElement, host: ReviewHost): () => void };
export type LoadedReviewArtifact = { artifact: ReviewArtifact; styleUrl: string; pin: ReviewArtifactPin };

/** The bundle isn't installed on this build, or what's served isn't the pinned build. */
export class ArtifactUnavailableError extends Error {}

export const ARTIFACT_DIRECTORY = "plugins/bc-bid-monitor/";

export function artifactUrls(pin: ReviewArtifactPin, baseUrl: string) {
  const base = `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${ARTIFACT_DIRECTORY}`;
  // Versioned by content so a new pinned build is never served from an old cache entry.
  return {
    script: `${base}index.js?v=${pin.sha256["index.js"].slice(0, 16)}`,
    style: `${base}style.css?v=${pin.sha256["style.css"].slice(0, 16)}`,
  };
}

async function verifiedFetch(url: string, sha256: string, label: string) {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ArtifactUnavailableError(`The review plugin's ${label} couldn't be downloaded.`);
  }
  if (!response.ok) throw new ArtifactUnavailableError(`The review plugin's ${label} isn't installed on this deployment (${response.status}).`);
  // A missing file can come back as the app's index.html, so the checksum is the real test.
  if ((await sha256Hex(new Uint8Array(await response.arrayBuffer()))) !== sha256) {
    throw new ArtifactUnavailableError(`The review plugin's ${label} on this deployment doesn't match the pinned build. Run scripts/sync-procurement-review.ts and redeploy.`);
  }
}

let loading: Promise<LoadedReviewArtifact> | null = null;

export function loadReviewArtifact(pin: ReviewArtifactPin | null, baseUrl: string): Promise<LoadedReviewArtifact> {
  if (!pin) return Promise.reject(new ArtifactUnavailableError("The review plugin bundle isn't installed in this build of Societyer."));
  loading ??= (async () => {
    const urls = artifactUrls(pin, baseUrl);
    await Promise.all([verifiedFetch(urls.script, pin.sha256["index.js"], "script"), verifiedFetch(urls.style, pin.sha256["style.css"], "stylesheet")]);
    const module: unknown = await import(/* @vite-ignore */ urls.script);
    const mount = module && typeof module === "object" ? (module as Record<string, unknown>).mount : undefined;
    if (typeof mount !== "function") throw new ArtifactUnavailableError("The review plugin bundle doesn't export mount().");
    return { artifact: { mount: mount as ReviewArtifact["mount"] }, styleUrl: urls.style, pin };
  })();
  // A failed load can be retried (for example after a deploy finishes).
  loading.catch(() => { loading = null; });
  return loading;
}
