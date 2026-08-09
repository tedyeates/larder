import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    // Next's postcss.config.mjs (Tailwind v4) isn't a Vite-compatible
    // plugin shape. Nothing under test needs CSS actually processed.
    postcss: { plugins: [] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", "e2e/**", ".next/**"],
  },
});
