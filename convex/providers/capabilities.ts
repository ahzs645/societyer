/**
 * CONVEX capability bag.
 *
 * Generalizes the existing `convex/providers/*` adapters into the injected
 * `ctx.capabilities` surface (shared/portable/capabilities.ts). This is the
 * "static import + env-switch -> injected capability" refactor the audit calls
 * the highest-leverage change: handlers stop importing providers directly and
 * instead receive a capability bag, so the local runtimes can swap in demo /
 * native variants or fail loudly with CAPABILITY_UNAVAILABLE.
 *
 * Today this wires email, sms, and storage (the clearest cases). Absent
 * capabilities (e.g. llm.complete, whose provider exposes a domain-specific
 * `summarizeMinutes` instead of a generic completion) throw a structured
 * CAPABILITY_UNAVAILABLE — exactly the explicit signal that replaces the parity
 * ledger's silent NOOP bucket.
 */

import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { createUploadUrl, createDownloadUrl } from "./storage";
import { providers } from "./env";
import { makeCapabilities, type PortableCapabilities } from "../../shared/portable/capabilities";
import { mintEntityId } from "../../shared/portable/ids";

/** Build the capability bag a hosted-Convex handler runs with. */
export function buildConvexCapabilities(): PortableCapabilities {
  return makeCapabilities(
    {
      email: {
        async sendEmail(input) {
          const res = await sendEmail(input);
          return { id: String(res.id), accepted: Boolean(res.accepted) };
        },
      },
      sms: {
        async sendSms(input) {
          const res = await sendSms(input);
          return { id: String((res as { id?: unknown }).id ?? ""), accepted: Boolean((res as { accepted?: unknown }).accepted ?? true) };
        },
      },
      storage: {
        async createUploadUrl(input) {
          const key = mintEntityId("upload");
          const res = await createUploadUrl({ key, mimeType: input.contentType });
          return { uploadUrl: res.url, storageKey: res.key };
        },
        async getDownloadUrl(input) {
          const url = await createDownloadUrl({ provider: providers.storage().id, key: input.storageKey });
          return { url };
        },
      },
    },
    (capability) => `No ${capability} provider is wired into this Convex deployment.`,
  );
}
