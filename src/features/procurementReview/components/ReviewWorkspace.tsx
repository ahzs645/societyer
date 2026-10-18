import { useEffect, useRef, useState } from "react";
import { useHref, useLocation, useNavigate } from "react-router-dom";
import type { SnapshotManifest } from "../../../../shared/procurementReview/manifest";
import type { LoadedReviewArtifact } from "../lib/artifact";
import type { BlobReader } from "../lib/blobs";
import { createReviewHost, type NavigationState, type OverlayState, type ReviewHostController } from "../lib/bridge";
import type { CatalogClient } from "../lib/catalogClient";
import { appPathFor, hrefBaseFor, pluginLocationFor, REVIEW_BASE_PATH } from "../lib/navigation";
import { readSnapshotDocument } from "../lib/snapshot";
import { isDarkTheme, readAppearance } from "../lib/theme";

const PREVIEW_LIFETIME_MS = 10 * 60_000;

export function sourceLabel(manifest: SnapshotManifest): string {
  const published = new Date(manifest.publishedAt);
  return `Snapshot published ${published.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

function navigationStateFor(location: string, route: { baseUrl: string; hrefBase: string }): NavigationState {
  return { version: 1, location, baseUrl: route.baseUrl, hrefBase: route.hrefBase };
}

function saveBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Mounts the review plugin into its own element and answers it through the
 * read-only bridge. The plugin owns everything below the page's route.
 */
export function ReviewWorkspace({ artifact, manifest, catalog, read, onMountError }: {
  artifact: LoadedReviewArtifact;
  manifest: SnapshotManifest;
  catalog: CatalogClient;
  read: BlobReader;
  onMountError: (message: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const host = useRef<ReviewHostController | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const hrefBase = hrefBaseFor(useHref(REVIEW_BASE_PATH));
  const pluginLocation = pluginLocationFor(location.pathname, location.search);
  // Read by the bridge at call time, so it always sees the current route.
  const routeState = { pluginLocation, navigate, hrefBase, baseUrl: `${window.location.origin}${hrefBase}` };
  const current = useRef(routeState);
  current.current = routeState;
  const lastNotified = useRef(pluginLocation);
  const [styleReady, setStyleReady] = useState(false);

  // The plugin's stylesheet lives only as long as the plugin is on the page.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = artifact.styleUrl;
    link.dataset.procurementReview = "";
    const ready = () => setStyleReady(true);
    link.addEventListener("load", ready);
    link.addEventListener("error", ready);
    document.head.appendChild(link);
    return () => link.remove();
  }, [artifact.styleUrl]);

  useEffect(() => {
    const mountPoint = element.current;
    if (!mountPoint || !styleReady) return;
    const previews = new Set<string>();
    const navigationState = (location: string): NavigationState => navigationStateFor(location, current.current);
    const controller = createReviewHost({
      sourceLabel: sourceLabel(manifest),
      catalog: (method, input) => catalog.call(method, input),
      readDocument: (sha256) => readSnapshotDocument(manifest, read, sha256),
      navigation: {
        read: () => navigationState(current.current.pluginLocation),
        write: (target, mode) => {
          // Set before navigating so the route change isn't echoed back as a navigation event.
          lastNotified.current = target;
          current.current.navigate(appPathFor(target), { replace: mode === "replace" });
          return navigationState(target);
        },
      },
      appearance: () => readAppearance(mountPoint),
      overlay: (open): OverlayState => {
        const rect = mountPoint.getBoundingClientRect();
        return {
          open,
          insets: open ? {
            top: Math.max(0, Math.round(rect.top)), left: Math.max(0, Math.round(rect.left)),
            right: Math.max(0, Math.round(window.innerWidth - rect.right)), bottom: Math.max(0, Math.round(window.innerHeight - rect.bottom)),
          } : { top: 0, right: 0, bottom: 0, left: 0 },
        };
      },
      previewUrl: (bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        previews.add(url);
        setTimeout(() => { URL.revokeObjectURL(url); previews.delete(url); }, PREVIEW_LIFETIME_MS);
        return url;
      },
      download: saveBytes,
    });
    host.current = controller;

    let unmount: (() => void) | undefined;
    try {
      unmount = artifact.artifact.mount(mountPoint, controller);
    } catch (error) {
      onMountError(error instanceof Error ? error.message : "The review plugin couldn't start.");
    }
    // The plugin never asks for its appearance; it listens for it.
    controller.publish("appearance", readAppearance(mountPoint));
    let dark = isDarkTheme();
    const themeObserver = new MutationObserver(() => {
      if (isDarkTheme() === dark) return;
      dark = isDarkTheme();
      controller.publish("appearance", readAppearance(mountPoint));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      themeObserver.disconnect();
      host.current = null;
      try { unmount?.(); } catch { /* Unmounting a failed plugin must not break leaving the page. */ }
      for (const url of previews) URL.revokeObjectURL(url);
    };
  }, [artifact, catalog, manifest, read, styleReady, onMountError]);

  // Back/forward and links change the route under the plugin: tell it where it is now.
  useEffect(() => {
    if (pluginLocation === lastNotified.current) return;
    lastNotified.current = pluginLocation;
    host.current?.publish("navigation", navigationStateFor(pluginLocation, current.current));
  }, [pluginLocation]);

  return <div ref={element} className="procurement-review__host" data-procurement-review-host="" />;
}
