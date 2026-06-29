// Re-export shim: the pure accounting core helpers now live under shared/ so
// portable handlers (shared/functions/*) can validate/balance journal lines
// without importing upward into convex/. Existing convex importers keep this
// path.
export * from "../../shared/accountingCore";
