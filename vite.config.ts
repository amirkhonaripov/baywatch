import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE: GitHub Pages sub-path, e.g. "/seen/". Defaults to "./" so the build also works from any folder.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  plugins: [react()],
  build: { target: "es2020", sourcemap: false, chunkSizeWarningLimit: 1400 },
  server: { host: true, port: 5173, fs: { allow: [".."] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as any);
