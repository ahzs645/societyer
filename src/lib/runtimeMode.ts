export type RuntimeMode =
  | "convex-cloud"
  | "convex-self-hosted"
  | "local-indexeddb"
  | "electron-local";

export type DocumentStorageProvider =
  | "convex-storage"
  | "rustfs-s3"
  | "local-filesystem"
  | "demo";

export type RuntimeCapabilities = {
  localData: boolean;
  nativeFiles: boolean;
  liveCollaboration: boolean;
  serverActions: boolean;
};

export function getRuntimeMode(): RuntimeMode {
  const configured = import.meta.env.VITE_RUNTIME_MODE as RuntimeMode | undefined;
  if (configured && isRuntimeMode(configured)) return configured;

  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!convexUrl) return "convex-self-hosted";
  if (isLocalConvexUrl(convexUrl)) return "convex-self-hosted";
  return "convex-cloud";
}

export function getDocumentStorageProvider(): DocumentStorageProvider {
  const configured = import.meta.env.VITE_DOCUMENT_STORAGE_PROVIDER as DocumentStorageProvider | undefined;
  if (configured && isDocumentStorageProvider(configured)) return configured;

  const runtimeMode = getRuntimeMode();
  if (runtimeMode === "electron-local") return "local-filesystem";
  if (runtimeMode === "local-indexeddb") return "demo";
  return "rustfs-s3";
}

export function runtimeCapabilities(mode: RuntimeMode): RuntimeCapabilities {
  switch (mode) {
    case "electron-local":
      return {
        localData: true,
        nativeFiles: true,
        liveCollaboration: false,
        serverActions: false,
      };
    case "local-indexeddb":
      return {
        localData: true,
        nativeFiles: false,
        liveCollaboration: false,
        serverActions: false,
      };
    case "convex-cloud":
      return {
        localData: false,
        nativeFiles: false,
        liveCollaboration: true,
        serverActions: true,
      };
    case "convex-self-hosted":
      return {
        localData: false,
        nativeFiles: false,
        liveCollaboration: true,
        serverActions: true,
      };
  }
}

export function isLocalRuntimeMode(mode = getRuntimeMode()) {
  return mode === "local-indexeddb" || mode === "electron-local";
}

function isRuntimeMode(value: string): value is RuntimeMode {
  return (
    value === "convex-cloud" ||
    value === "convex-self-hosted" ||
    value === "local-indexeddb" ||
    value === "electron-local"
  );
}

function isDocumentStorageProvider(value: string): value is DocumentStorageProvider {
  return (
    value === "convex-storage" ||
    value === "rustfs-s3" ||
    value === "local-filesystem" ||
    value === "demo"
  );
}

function isLocalConvexUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname.endsWith(".local") ||
      url.hostname.endsWith(".home")
    );
  } catch {
    return false;
  }
}
