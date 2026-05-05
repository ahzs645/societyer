import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const base = process.env.VITE_BASE_PATH ?? "/";
const stableAssetNames = process.env.VITE_STABLE_ASSET_NAMES === "1";
const apiServerTarget = `http://127.0.0.1:${process.env.AUTH_SERVER_PORT ?? "8787"}`;
const output = {
  manualChunks(id: string) {
    if (!id.includes("node_modules")) return;
    if (id.includes("/react/") || id.includes("/react-dom/")) return "react-vendor";
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
  rollupOptions: { output },
};

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
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
