import { defineConfig } from "vite";
import { fileURLToPath } from "url";

const schemas = fileURLToPath(
  new URL("../../packages/schemas/src/index.ts", import.meta.url)
);
const analysis = fileURLToPath(
  new URL("../../packages/analysis/src/index.ts", import.meta.url)
);

const alias = {
  "@signaltap/schemas": schemas,
  "@signaltap/analysis": analysis,
};

// Background service worker build (self-contained IIFE).
export default defineConfig({
  resolve: { alias },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("src/background.ts", import.meta.url)),
      formats: ["iife"],
      name: "SignalTapBackground",
      fileName: () => "background.js",
    },
  },
});
