import {
  makeCapabilities,
  type CapabilityKey,
  type PortableCapabilities,
} from "../../shared/portable/capabilities";

export interface LocalCapabilityOptions {
  /** Human label for the runtime, used in CAPABILITY_UNAVAILABLE messages. */
  runtimeLabel?: string;
  /** Capabilities the host can actually provide (e.g. native storage on Electron). */
  provided?: Parameters<typeof makeCapabilities>[0];
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
    options.provided ?? {},
    (capability: CapabilityKey) => `This ${label} workspace has no ${capability} service connected.`,
  );
}
