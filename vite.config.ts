import { defineConfig } from "vite";

// base './' so the build works under a GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  test: { include: ["src/**/*.test.ts"] },
});
