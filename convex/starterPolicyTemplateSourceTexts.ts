// Re-export shim: the exact normalized source-text catalog (pure data) now lives
// under shared/ so portable handlers can read it without importing upward into
// convex/. Existing convex/script importers keep this path.
export * from "../shared/starterPolicyTemplateSourceTexts";
