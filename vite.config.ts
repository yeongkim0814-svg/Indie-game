import { defineConfig } from "vite";

// base './' so the build works under a GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // Stable file names so the build can also be published as a multi-file Artifact.
    rollupOptions: { output: { entryFileNames: "assets/game.js", chunkFileNames: "assets/[name].js", assetFileNames: "assets/[name][extname]" } },
  },
  test: { include: ["src/**/*.test.ts"] },
});
