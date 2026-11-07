import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.js"),
      name: "RagMcpWidget",
      fileName: (format) => {
        if (format === "iife") return "widget.js";
        return `widget.${format}.js`;
      },
      formats: ["iife", "es", "umd"],
    },
    rollupOptions: {
      output: {
        extend: true,
        exports: "named",
      },
    },
    minify: "esbuild",
    sourcemap: false,
  },
});
