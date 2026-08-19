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

// Content script build (self-contained IIFE so it can be injected as a
// classic script via chrome.scripting.executeScript).
export default defineConfig({
  resolve: { alias },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("src/content.ts", import.meta.url)),
      formats: ["iife"],
      name: "SignalTapContent",
      fileName: () => "content.js",
    },
  },
});
