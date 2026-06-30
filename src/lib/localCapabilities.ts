import {
  makeCapabilities,
  CapabilityUnavailableError,
  type CapabilityKey,
  type PortableCapabilities,
  type StorageCapability,
} from "../../shared/portable/capabilities";

export interface LocalCapabilityOptions {
  /** Human label for the runtime, used in CAPABILITY_UNAVAILABLE messages. */
  runtimeLabel?: string;
  /** Capabilities the host can actually provide (e.g. native storage on Electron). */
  provided?: Parameters<typeof makeCapabilities>[0];
}

/**
 * Default local storage: read handlers resolve a blob reference to a URL only if
 * it is already a self-contained URL (a `data:`/`blob:`/`http(s):` value stored
 * inline) — a Convex `_storage` id has no local blob, so it resolves to null and
 * the handler falls back gracefully. Uploads aren't available offline (the
 * Electron host overrides this whole capability via `provided.storage` with a
 * native-filesystem implementation).
 */
function defaultLocalStorage(label: string): StorageCapability {
  return {
    async createUploadUrl() {
      throw new CapabilityUnavailableError("storage", `This ${label} workspace has no upload storage.`);
    },
    async getDownloadUrl({ storageKey }) {
      const isInlineUrl = /^(data:|blob:|https?:)/.test(String(storageKey ?? ""));
      return { url: isInlineUrl ? String(storageKey) : null };
    },
    async delete() {
      // Logos are stored inline (data: URLs) locally, so there is no separate
      // blob to delete — the record patch alone clears them. Electron overrides
      // this capability with a native-filesystem delete via `provided`.
    },
  };
}

/**
 * The capability policy for a LOCAL workspace (browser or Electron).
 *
 * Server-only services — email, SMS, AI, billing, URL-based storage — are not
 * wired locally, so a portable handler that reaches for one gets a structured
 * CAPABILITY_UNAVAILABLE naming the runtime, never a silent no-op (the weakness
 * the old static parity ledger papered over).
 *
 * This is the single seam where NATIVE desktop capabilities get wired as the
 * Electron host gains them (e.g. local OCR, a keychain, background jobs). Native
 * document files already flow through the dedicated `documentStorage` adapter +
 * Electron preload bridge, so they are not part of this URL-based surface.
 */
export function buildLocalCapabilities(options: LocalCapabilityOptions = {}): PortableCapabilities {
  const label = options.runtimeLabel ?? "local";
  return makeCapabilities(
    { storage: defaultLocalStorage(label), ...(options.provided ?? {}) },
    (capability: CapabilityKey) => `This ${label} workspace has no ${capability} service connected.`,
  );
}
