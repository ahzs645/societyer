// Re-export shim: the starter policy/document template catalog (pure data + pure
// HTML/marker builders) now lives under shared/ so portable handlers
// (shared/functions/*) can read it without importing upward into convex/.
// Existing convex/script importers keep this path.
export * from "../shared/starterPolicyTemplates";
