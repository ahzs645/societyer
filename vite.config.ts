import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const base = process.env.VITE_BASE_PATH ?? "/";
const stableAssetNames = process.env.VITE_STABLE_ASSET_NAMES === "1";
const frozenQualification = process.env.SOCIETYER_FROZEN_QUALIFICATION === "1";
const apiServerTarget = `http://127.0.0.1:${process.env.AUTH_SERVER_PORT ?? "8787"}`;
const output = {
  manualChunks(id: string) {
    if (!id.includes("node_modules")) return;
    // Match the package itself, not @clerk/react or better-auth's /react/
    // adapter: grouping those with React would eagerly load optional providers.
    if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) return "react-vendor";
    if (id.includes("/react-router") || id.includes("/@remix-run/")) return "router-vendor";
    if (id.includes("/convex/")) return "convex-vendor";
    if (id.includes("/lucide-react/")) return "icons-vendor";
  },
  ...(stableAssetNames
    ? {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      }
    : {}),
};
const build = {
  target: "esnext" as const,
  manifest: true,
  chunkSizeWarningLimit: 1000,
  rollupOptions: { output },
};

export default defineConfig({
  base,
  plugins: [react()],
  // PowerSync uses its own worker and WASM loader. Pre-bundling that loader
  // rewrites its worker URL and can leave SQLite initialization waiting forever.
  optimizeDeps: {
    exclude: ["@powersync/web"],
    // The rich editor is lazy-loaded. Pre-bundle every Milkdown entry it uses
    // in the first optimizer pass: a late re-optimization can load the shared
    // @milkdown/ctx chunk twice (old and new `?v=` URLs), and two ctx copies
    // fail with `MilkdownError: Context "nodes" not found`.
    include: [
      "@milkdown/crepe",
      "@milkdown/kit/core",
      "@milkdown/kit/utils",
      "@milkdown/kit/prose/commands",
      "@milkdown/kit/prose/state",
      // AI intake worker and review viewer: a late re-optimization reloads the
      // page in the middle of an extraction run.
      "pdfjs-dist",
      "pdfjs-dist/legacy/build/pdf.mjs",
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      "@kenjiuno/msgreader",
      "@ai-sdk/openai",
      "docx-preview",
    ],
  },
  worker: { format: "es" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // AI intake reads Outlook .msg files in the browser; iconv-lite needs Node's Buffer.
      "iconv-lite": path.resolve(__dirname, "./src/lib/iconvLiteBrowser.ts"),
    },
  },
  server: {
    port: 5173,
    // Qualification observes one source snapshot; backend/codegen or traces
    // must not invalidate an authenticated browser in the middle of a test.
    hmr: frozenQualification ? false : undefined,
    watch: frozenQualification ? null : { ignored: ["**/tmp/**", "**/artifacts/**"] },
    proxy: {
      "/api": {
        target: apiServerTarget,
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: { api: "modern-compiler" },
    },
  },
  build,
});
