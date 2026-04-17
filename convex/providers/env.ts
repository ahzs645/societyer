// Runtime config for third-party adapters. In demo mode every adapter returns
// deterministic fake data so nothing requires real credentials. Live adapters
// are stubs that expect env vars — they don't call out over the network from
// this codebase today, but the shape is ready for drop-in implementation.

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
