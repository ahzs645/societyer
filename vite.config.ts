import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // Relative asset URLs so the build works from any subpath
  // (root domain, GitHub Pages project page, S3 prefix, etc.).
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy:
      process.env.VITE_AUTH_MODE === "better-auth"
        ? {
            "/api/auth": {
              target: `http://127.0.0.1:${process.env.AUTH_SERVER_PORT ?? "8787"}`,
              changeOrigin: true,
            },
          }
        : undefined,
  },
  css: {
    preprocessorOptions: {
      scss: { api: "modern-compiler" },
    },
  },
});
