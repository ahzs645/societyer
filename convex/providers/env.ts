// Runtime config for third-party adapters. In demo mode every adapter returns
// deterministic fake data so nothing requires real credentials. Live adapters
// expect env vars and may call their provider APIs from Convex actions.

export type Provider<T extends string> = { id: T; live: boolean };

function env(name: string): string | undefined {
  // Convex functions inherit process.env from the deployment settings.
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

export const providers = {
  storage(): Provider<"rustfs" | "demo"> {
    const live =
      !!env("RUSTFS_ENDPOINT") &&
      !!env("RUSTFS_ACCESS_KEY") &&
      !!env("RUSTFS_SECRET_KEY");
    return { id: live ? "rustfs" : "demo", live };
  },
  paperless(): Provider<"paperlessngx" | "demo"> {
    const live = !!env("PAPERLESS_NGX_URL") && !!env("PAPERLESS_NGX_TOKEN");
    return { id: live ? "paperlessngx" : "demo", live };
  },
  transcription(): Provider<"whisper" | "demo"> {
    const live = !!env("OPENAI_API_KEY") || !!env("WHISPER_ENDPOINT");
    return { id: live ? "whisper" : "demo", live };
  },
  llm(): Provider<"anthropic" | "openai" | "demo"> {
    if (env("ANTHROPIC_API_KEY")) return { id: "anthropic", live: true };
    if (env("OPENAI_API_KEY")) return { id: "openai", live: true };
    return { id: "demo", live: false };
  },
  email(): Provider<"resend" | "demo"> {
    const live = !!env("RESEND_API_KEY");
    return { id: live ? "resend" : "demo", live };
  },
  accounting(): Provider<"wave" | "demo"> {
    const live = !!env("WAVE_ACCESS_TOKEN") && !!env("WAVE_BUSINESS_ID");
    return { id: live ? "wave" : "demo", live };
  },
  billing(): Provider<"stripe" | "demo"> {
    const live = !!env("STRIPE_SECRET_KEY");
    return { id: live ? "stripe" : "demo", live };
  },
};

// Used by seeded society to decide whether anything should hit live APIs.
// This project's seeded fictional society is hard-wired to demo.
export function isSocietyDemo(societyDemoMode: boolean | undefined): boolean {
  return societyDemoMode !== false;
}

// ---------------------------------------------------------------------------
// Native file storage switch
// ---------------------------------------------------------------------------
// Some deployments must never store files in Convex's native object storage —
// either to run a smaller instance, or because the operator does not want
// document management at all and needs a hard guarantee that users cannot
// smuggle a file into Convex. When SOCIETYER_DISABLE_NATIVE_FILE_STORAGE is
// set, every native upload path throws. External document connectors (e.g.
// Paperless) stay available as read-only sources, but nothing is copied into
// Convex. This is the server-side enforcement layer; the client also hides the
// upload affordances, but the throw here is what makes it un-bypassable.
export function isNativeFileStorageDisabled(): boolean {
  const flag = (env("SOCIETYER_DISABLE_NATIVE_FILE_STORAGE") ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

export const NATIVE_FILE_STORAGE_DISABLED_MESSAGE =
  "Native file storage is disabled on this deployment. Use a document connector (e.g. Paperless) as the source instead of uploading into Convex.";

export function assertNativeFileStorageEnabled(): void {
  if (isNativeFileStorageDisabled()) {
    throw new Error(NATIVE_FILE_STORAGE_DISABLED_MESSAGE);
  }
}
