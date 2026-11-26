import { defineConfig } from "vitest/config";

// Not part of `npm test`: the layout benchmark measures, it does not assert a
// speed, and a timing on a shared CI runner is noise. Run with `npm run bench`.
export default defineConfig({
  test: {
    include: ["bench/**/*.bench-test.ts"],
    environment: "node",
    testTimeout: 600_000,
  },
});
