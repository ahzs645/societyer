import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
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

/** AI intake OCR runs offline: the tesseract.js worker, its WebAssembly cores, the English model
 * and pdf.js's image decoders are copied from node_modules into `assets/intake-ocr/` (served from
 * any `/intake-ocr/` path in dev). They load only when a run reads a scanned page, so they are
 * not part of the app's bundles. See src/features/intake/ocrHost.ts. */
const INTAKE_OCR_ASSETS: Record<string, string> = {
  "tesseract-worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "pdfjs/jbig2.wasm": "node_modules/pdfjs-dist/wasm/jbig2.wasm",
  "pdfjs/openjpeg.wasm": "node_modules/pdfjs-dist/wasm/openjpeg.wasm",
  "pdfjs/qcms_bg.wasm": "node_modules/pdfjs-dist/wasm/qcms_bg.wasm",
};
function intakeOcrAssets(): Plugin {
  const source = (name: string) => path.resolve(__dirname, INTAKE_OCR_ASSETS[name]);
  const contentType = (name: string) => (name.endsWith(".js") ? "text/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/gzip");
  return {
    name: "societyer-intake-ocr-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /\/intake-ocr\/([\w./-]+?)(?:\?.*)?$/.exec(request.url ?? "");
        const name = match?.[1];
        if (!name || !INTAKE_OCR_ASSETS[name]) return next();
        response.setHeader("Content-Type", contentType(name));
        fs.createReadStream(source(name)).pipe(response);
      });
    },
    generateBundle() {
      for (const name of Object.keys(INTAKE_OCR_ASSETS)) this.emitFile({ type: "asset", fileName: `assets/intake-ocr/${name}`, source: fs.readFileSync(source(name)) });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), intakeOcrAssets()],
  // Milkdown's Crepe toolbar ships Vue components. Without these compile-time
  // flags Vue's esm-bundler build warns on every editor mount. Options API stays
  // on (Vue's default, in case a toolbar component uses it); devtools are off.
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
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
      "pdfjs-dist/legacy/build/pdf.mjs",
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      "@kenjiuno/msgreader",
      // OCR in the intake worker (loaded only when a run reads a scanned page).
      "tesseract.js",
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
