/**
 * INJECTED CAPABILITY CONTRACT.
 *
 * Generalizes `convex/providers/*` (email, sms, llm, storage, ...). Today those
 * providers are static ES imports that self-resolve from `process.env`. That
 * works on hosted Convex but gives the local runtimes no seam: an offline
 * workspace cannot decline to send email, it can only silently no-op (which is
 * exactly the weakness the static parity ledger papers over).
 *
 * Here, capabilities are an INJECTED object on `ctx.capabilities`. A runtime
 * supplies the capabilities it actually has; everything else is a throwing stub
 * that surfaces a structured CAPABILITY_UNAVAILABLE error instead of a silent
 * null. This is what replaces the parity ledger's "NOOP / PENDING" buckets with
 * an explicit, per-runtime capability matrix.
 *
 * Domain-agnostic: the capability KEYS are generic ("email", "storage", ...);
 * concrete providers (Resend, Wave, Paperless) live per-app behind these.
 */

export type CapabilityKey =
  | "email"
  | "sms"
  | "storage"
  | "llm"
  | "transcription"
  | "accounting"
  | "billing"
  | "paperless"
  | "scheduler"
  | "http";

export interface CapabilityErrorShape {
  code: "CAPABILITY_UNAVAILABLE";
  capability: CapabilityKey;
  reason: string;
}

export class CapabilityUnavailableError extends Error {
  readonly code = "CAPABILITY_UNAVAILABLE" as const;
  readonly capability: CapabilityKey;
  readonly reason: string;

  constructor(capability: CapabilityKey, reason: string) {
    super(`CAPABILITY_UNAVAILABLE: ${capability} — ${reason}`);
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
    this.reason = reason;
  }

  toJSON(): CapabilityErrorShape {
    return { code: this.code, capability: this.capability, reason: this.reason };
  }
}

export function isCapabilityUnavailable(value: unknown): value is CapabilityErrorShape {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { code?: unknown }).code === "CAPABILITY_UNAVAILABLE"
  );
}

/** Narrow, plain-data capability surfaces. Implementations return data or throw. */
export interface EmailCapability {
  sendEmail(input: { to: string; subject: string; html?: string; text?: string; tag?: string }): Promise<{ id: string; accepted: boolean }>;
}
export interface SmsCapability {
  sendSms(input: { to: string; body: string; tag?: string }): Promise<{ id: string; accepted: boolean }>;
}
export interface StorageCapability {
  createUploadUrl(input: { contentType?: string }): Promise<{ uploadUrl: string; storageKey: string }>;
  getDownloadUrl(input: { storageKey: string }): Promise<{ url: string }>;
}
export interface LlmCapability {
  complete(input: { prompt: string; system?: string; maxTokens?: number }): Promise<{ text: string }>;
}

/**
 * The full capability bag. Every member is OPTIONAL at the type level; a runtime
 * builds the bag via `makeCapabilities`, which fills absent members with stubs
 * that throw CapabilityUnavailableError. Callers therefore always get a callable
 * surface and a loud, structured failure — never a silent missing method.
 */
export interface PortableCapabilities {
  has(capability: CapabilityKey): boolean;
  email: EmailCapability;
  sms: SmsCapability;
  storage: StorageCapability;
  llm: LlmCapability;
}

type CapabilityImplementations = Partial<{
  email: EmailCapability;
  sms: SmsCapability;
  storage: StorageCapability;
  llm: LlmCapability;
}>;

function unavailable(capability: CapabilityKey, reason: string): never {
  throw new CapabilityUnavailableError(capability, reason);
}

/**
 * Build a capability bag from whatever a runtime can provide. Absent
 * capabilities become throwing stubs. `reasonFor` lets a runtime explain WHY a
 * capability is missing (e.g. "no delivery service connected to this workspace").
 */
export function makeCapabilities(
  provided: CapabilityImplementations,
  reasonFor: (capability: CapabilityKey) => string = () =>
    "This capability is not available in the current runtime.",
): PortableCapabilities {
  const present = new Set<CapabilityKey>();
  for (const key of Object.keys(provided) as CapabilityKey[]) {
    if (provided[key as keyof CapabilityImplementations]) present.add(key);
  }

  return {
    has: (capability) => present.has(capability),
    email:
      provided.email ?? {
        sendEmail: () => unavailable("email", reasonFor("email")),
      },
    sms:
      provided.sms ?? {
        sendSms: () => unavailable("sms", reasonFor("sms")),
      },
    storage:
      provided.storage ?? {
        createUploadUrl: () => unavailable("storage", reasonFor("storage")),
        getDownloadUrl: () => unavailable("storage", reasonFor("storage")),
      },
    llm:
      provided.llm ?? {
        complete: () => unavailable("llm", reasonFor("llm")),
      },
  };
}
