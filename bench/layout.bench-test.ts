/**
 * Layout cost, measured in Node (not part of `npm test`; run `npm run bench`).
 * Frame cost is measured in a browser by bench/browser/run.mjs; this is the
 * other half: what a layout step costs at the sizes CC-fancy-0062 named.
 * Writes bench/results/layout-times.json.
 */
import { describe, it } from "vitest";
import { createLayoutRunner, forceLayout, normalizeGraph, resolveLimits, type GraphLayout } from "../src/core";
import { cosmosData } from "../examples/cosmos/data";
import { cosmosLayout } from "../examples/cosmos/layout";

const stats = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
  return { samples: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), p50: q(0.5), p95: q(0.95), max: q(1 - 1e-9) };
};

function measure(label: string, make: () => GraphLayout, nodes: number, links: number, dims: 2 | 3, steps: number) {
  const data = cosmosData(nodes, links, 1);
  const graph = normalizeGraph(data, { maxLinks: 60000 });
  const t0 = performance.now();
  const r = createLayoutRunner(make(), graph, { dimensions: dims, reducedMotion: false, limits: resolveLimits() });
  const init = performance.now() - t0;
  const ms: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = performance.now();
    r.tick(1 / 60);
    ms.push(performance.now() - a);
  }
  return { label, nodes: graph.nodes.length, links: graph.links.length, dimensions: dims, initMs: +init.toFixed(2), stepMs: stats(ms) };
}

describe("layout benchmark", () => {
  it("measures and records", async () => {
    const results = [
      measure("force, 650 nodes (2D)", () => forceLayout({ seed: 1 }), 650, 900, 2, 120),
      measure("force, 4,000 nodes / 6,000 links (2D)", () => forceLayout({ seed: 1 }), 4000, 6000, 2, 60),
      measure("force, 4,000 nodes / 6,000 links (3D)", () => forceLayout({ seed: 1 }), 4000, 6000, 3, 60),
      measure("cosmos, 650 nodes (orbits, per frame)", () => cosmosLayout(), 650, 900, 3, 300),
      measure("cosmos, 4,000 nodes / 6,000 links (orbits, per frame)", () => cosmosLayout(), 4000, 6000, 3, 300),
    ];
    const fs = (await import("node:fs" as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
    fs.mkdirSync("bench/results", { recursive: true });
    const out = { measuredAt: new Date().toISOString(), runtime: `node ${(globalThis as { process?: { version?: string } }).process?.version ?? "?"}`, results };
    fs.writeFileSync("bench/results/layout-times.json", JSON.stringify(out, null, 2) + "\n");
    for (const r of results) console.log(JSON.stringify(r));
  });
});
