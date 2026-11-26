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
  // fancy-3d-three is an OPTIONAL peer, and only the `./three` entry may import
  // it; three.js itself arrives only through `@particle-academy/fancy-3d-three/three`.
  // tests/entry-isolation.test.ts holds both.
  external: ["react", "react-dom", /^@particle-academy\//],
  treeshake: true,
});
