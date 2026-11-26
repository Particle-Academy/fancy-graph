import { defineConfig } from "tsup";

// Bundles the harness (and everything it imports, React and three included)
// into one classic script, so run.mjs can open it from file:// with no server.
export default defineConfig({
  entry: { harness: "bench/browser/main.tsx" },
  outDir: "bench/browser/dist",
  format: ["iife"],
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: false,
  clean: true,
  minify: true,
  noExternal: [/.*/],
  define: { "process.env.NODE_ENV": '"production"' },
});
