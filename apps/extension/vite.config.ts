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

// Side panel app build.
export default defineConfig({
  resolve: { alias },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: fileURLToPath(new URL("sidepanel.html", import.meta.url)),
      },
    },
  },
});
