import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core.ts",
    worker: "src/worker.ts",
    three: "src/three/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // `three` and fancy-3d-three are OPTIONAL peers, only the `./three` entry may
  // import them; tests/entry-isolation.test.ts holds the core entries to that.
  external: ["react", "react-dom", /^three(\/.*)?$/, /^@particle-academy\//],
  treeshake: true,
});
