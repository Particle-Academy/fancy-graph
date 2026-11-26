import { describe, expect, it, vi } from "vitest";
import {
  createLayoutRunner,
  forceLayout,
  groupClusters,
  hierarchyLayout,
  normalizeGraph,
  radialLayout,
  resolveLimits,
  type GraphLayoutStepper,
  type IndexedGraph,
} from "../src/core";

const env = (over: Partial<{ dimensions: 2 | 3; reducedMotion: boolean }> = {}) => ({ dimensions: 2 as 2 | 3, reducedMotion: false, limits: resolveLimits(), ...over });

const chain = (n: number): IndexedGraph =>
  normalizeGraph({ nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })), links: Array.from({ length: n - 1 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })) });

const tree = () =>
  normalizeGraph({
    nodes: ["root", "a", "b", "a1", "a2", "b1"].map((id) => ({ id })),
    links: [{ source: "root", target: "a" }, { source: "root", target: "b" }, { source: "a", target: "a1" }, { source: "a", target: "a2" }, { source: "b", target: "b1" }],
  });

const at = (p: Float32Array, i: number) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
const dist = (p: Float32Array, i: number, j: number) => Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
const finite = (p: Float32Array) => [...p].every(Number.isFinite);

describe("the layout contract", () => {
  it("runs a plain function once and is settled", () => {
    const fn = vi.fn((g: IndexedGraph, out: Float32Array) => {
      for (let i = 0; i < g.nodes.length; i++) out[i * 3] = i * 10;
    });
    const r = createLayoutRunner(fn, chain(3), env());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.settled).toBe(true);
    expect(at(r.positions, 2)).toEqual([20, 0, 0]);
    expect(r.tick(0.016)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("steps a stepper until it reports it has settled", () => {
    let left = 3;
    const stepper: GraphLayoutStepper = { init: vi.fn(), step: vi.fn(() => --left > 0) };
    const r = createLayoutRunner(stepper, chain(2), env());
    expect(r.settled).toBe(false);
    expect(r.tick(0.016)).toBe(true);
    r.tick(0.016);
    r.tick(0.016);
    expect(r.settled).toBe(true);
    expect(r.tick(0.016)).toBe(false);
    expect(stepper.step).toHaveBeenCalledTimes(3);
  });

  it("gives an animated layout per-frame positions and the elapsed time", () => {
    const stepper: GraphLayoutStepper = {
      animated: true,
      init() {},
      step(out, frame) {
        out[0] = frame.time;
        return true;
      },
    };
    const r = createLayoutRunner(stepper, chain(1), env());
    r.tick(0.5);
    r.tick(0.25);
    expect(r.positions[0]).toBeCloseTo(0.75);
    expect(r.animated).toBe(true);
  });

  it("freezes an animated layout's clock while paused", () => {
    const stepper: GraphLayoutStepper = { animated: true, init() {}, step: (out, f) => { out[0] = f.time; return true; } };
    const r = createLayoutRunner(stepper, chain(1), env());
    r.tick(1);
    r.setPaused(true);
    r.tick(1);
    expect(r.positions[0]).toBeCloseTo(1);
  });

  it("under reduced motion settles a physics layout before the first frame and never animates time", () => {
    let calls = 0;
    const settling: GraphLayoutStepper = { init() {}, step: () => ++calls < 50 };
    const r = createLayoutRunner(settling, chain(2), env({ reducedMotion: true }));
    expect(calls).toBe(50);
    expect(r.settled).toBe(true);

    const orbit: GraphLayoutStepper = { animated: true, init() {}, step: (out, f) => { out[0] = f.time; return true; } };
    const o = createLayoutRunner(orbit, chain(1), env({ reducedMotion: true }));
    o.tick(5);
    expect(o.positions[0]).toBe(0);
  });

  it("bounds the settle loop by limits.maxSettleTicks", () => {
    const never: GraphLayoutStepper = { init() {}, step: vi.fn(() => true) };
    createLayoutRunner(never, chain(2), { ...env({ reducedMotion: true }), limits: resolveLimits({ maxSettleTicks: 7 }) });
    expect(never.step).toHaveBeenCalledTimes(7);
  });

  it("re-applies fixed nodes after every step", () => {
    const g = normalizeGraph({ nodes: [{ id: "a", x: 5, y: 6, fixed: true }, { id: "b" }], links: [] });
    const r = createLayoutRunner((_g, out) => out.fill(99), g, env());
    expect(at(r.positions, 0)).toEqual([5, 6, 0]);
    expect(at(r.positions, 1)).toEqual([99, 99, 99]);
  });

  it("exposes a layout's clusters and meta", () => {
    const stepper: GraphLayoutStepper = {
      init() {},
      meta: { kind: "cosmos" },
      clusters: () => [{ id: "g", center: [0, 0, 0], radius: 10, members: [0] }],
    };
    const r = createLayoutRunner(stepper, chain(1), env());
    expect(r.meta).toEqual({ kind: "cosmos" });
    expect(r.clusters()?.[0].id).toBe("g");
  });

  it("disposes the layout", () => {
    const dispose = vi.fn();
    createLayoutRunner({ init() {}, dispose }, chain(1), env()).dispose();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("forceLayout", () => {
  it("settles a chain with linked nodes closer than unlinked ones", () => {
    const g = chain(12);
    const r = createLayoutRunner(forceLayout({ seed: 1 }), g, env({ reducedMotion: true }));
    expect(r.settled).toBe(true);
    expect(finite(r.positions)).toBe(true);
    expect(dist(r.positions, 0, 1)).toBeLessThan(dist(r.positions, 0, 11));
  });

  it("is deterministic for the same seed", () => {
    const a = createLayoutRunner(forceLayout({ seed: 3 }), chain(20), env({ reducedMotion: true })).positions;
    const b = createLayoutRunner(forceLayout({ seed: 3 }), chain(20), env({ reducedMotion: true })).positions;
    expect([...a]).toEqual([...b]);
  });

  it("keeps z at zero in 2D and spreads into z in 3D", () => {
    const flat = createLayoutRunner(forceLayout({ seed: 2 }), chain(15), env({ reducedMotion: true })).positions;
    expect([...flat].filter((_, i) => i % 3 === 2).every((z) => z === 0)).toBe(true);
    const deep = createLayoutRunner(forceLayout({ seed: 2 }), chain(15), env({ dimensions: 3, reducedMotion: true })).positions;
    expect([...deep].filter((_, i) => i % 3 === 2).some((z) => Math.abs(z) > 0.5)).toBe(true);
  });

  it("pushes coincident nodes apart instead of producing NaN", () => {
    const g = normalizeGraph({ nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0 })), links: [] });
    const p = createLayoutRunner(forceLayout({ seed: 1 }), g, env({ reducedMotion: true })).positions;
    expect(finite(p)).toBe(true);
    expect(dist(p, 0, 1)).toBeGreaterThan(1);
  });

  it("matches brute-force repulsion when theta is 0 (Barnes-Hut is exact at theta 0)", () => {
    const g = normalizeGraph({ nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` })), links: [] });
    const exact = createLayoutRunner(forceLayout({ seed: 5, theta: 0, iterations: 5 }), g, env());
    const approx = createLayoutRunner(forceLayout({ seed: 5, theta: 0.9, iterations: 5 }), g, env());
    for (let i = 0; i < 3; i++) {
      exact.tick(0.016);
      approx.tick(0.016);
    }
    const err = [...exact.positions].reduce((m, v, i) => Math.max(m, Math.abs(v - approx.positions[i])), 0);
    // Not equal (it is an approximation) but close.
    expect(err).toBeGreaterThan(0);
    expect(err).toBeLessThan(5);
  });

  it("honours seeded positions", () => {
    const g = normalizeGraph({ nodes: [{ id: "a", x: 500, y: 500 }, { id: "b", x: 510, y: 500 }], links: [{ source: "a", target: "b" }] });
    const r = createLayoutRunner(forceLayout({ seed: 1, center: false }), g, env());
    expect(r.positions[0]).toBeCloseTo(500, 0);
  });

  it("pulls a group's members together with groupPull", () => {
    // Two groups, interleaved, no links: without a pull they mix; with one they separate.
    const g = normalizeGraph({ nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, group: i % 2 ? "odd" : "even" })), links: [] });
    const spread = (p: Float32Array) => {
      const c = [0, 1].map((k) => {
        let x = 0, y = 0;
        for (let i = k; i < 40; i += 2) {
          x += p[i * 3];
          y += p[i * 3 + 1];
        }
        return [x / 20, y / 20];
      });
      let within = 0;
      for (let i = 0; i < 40; i++) within += Math.hypot(p[i * 3] - c[i % 2][0], p[i * 3 + 1] - c[i % 2][1]);
      return within / 40 / Math.max(1e-6, Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1]));
    };
    const loose = createLayoutRunner(forceLayout({ seed: 4 }), g, env({ reducedMotion: true })).positions;
    const pulled = createLayoutRunner(forceLayout({ seed: 4, groupPull: 0.3 }), g, env({ reducedMotion: true })).positions;
    expect(spread(pulled)).toBeLessThan(spread(loose) / 2);
  });

  it("stops after its iteration budget", () => {
    const r = createLayoutRunner(forceLayout({ iterations: 10 }), chain(5), env());
    for (let i = 0; i < 10; i++) r.tick(0.016);
    expect(r.settled).toBe(true);
  });
});

describe("radialLayout", () => {
  it("puts the root at the centre and each depth on its own ring", () => {
    const g = tree();
    const p = createLayoutRunner(radialLayout({ root: "root", ringGap: 100 }), g, env()).positions;
    expect(at(p, 0)).toEqual([0, 0, 0]);
    const r = (i: number) => Math.hypot(p[i * 3], p[i * 3 + 1]);
    expect(r(1)).toBeCloseTo(100);
    expect(r(2)).toBeCloseTo(100);
    expect(r(3)).toBeCloseTo(200);
    expect(r(5)).toBeCloseTo(200);
  });

  it("defaults the root to the best-connected node and places disconnected nodes on an outer ring", () => {
    const g = normalizeGraph({ nodes: ["hub", "x", "y", "lonely"].map((id) => ({ id })), links: [{ source: "hub", target: "x" }, { source: "hub", target: "y" }] });
    const p = createLayoutRunner(radialLayout({ ringGap: 50 }), g, env()).positions;
    expect(at(p, 0)).toEqual([0, 0, 0]);
    expect(Math.hypot(p[9], p[10])).toBeCloseTo(100);
  });

  it("uses spherical shells in 3D", () => {
    const p = createLayoutRunner(radialLayout({ root: "root", ringGap: 100 }), tree(), env({ dimensions: 3 })).positions;
    expect(Math.hypot(...at(p, 3))).toBeCloseTo(200);
    expect(finite(p)).toBe(true);
  });
});

describe("hierarchyLayout", () => {
  it("assigns layers by depth from the roots, top to bottom", () => {
    const p = createLayoutRunner(hierarchyLayout({ layerGap: 80, nodeGap: 40 }), tree(), env()).positions;
    expect(p[1]).toBe(0); // root y
    expect(p[1 * 3 + 1]).toBe(80);
    expect(p[3 * 3 + 1]).toBe(160);
  });

  it("keeps a layer free of overlaps", () => {
    const p = createLayoutRunner(hierarchyLayout({ layerGap: 80, nodeGap: 40 }), tree(), env()).positions;
    const xs = [3, 4, 5].map((i) => p[i * 3]).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(40);
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(40);
  });

  it("orders children under their parents (barycentre)", () => {
    const p = createLayoutRunner(hierarchyLayout({ layerGap: 80, nodeGap: 40 }), tree(), env()).positions;
    // a1, a2 sit under a; b1 under b. a is left of b, so a's children are left of b1.
    const ax = p[1 * 3], bx = p[2 * 3];
    expect(Math.sign(bx - ax)).toBe(Math.sign(p[5 * 3] - Math.max(p[3 * 3], p[4 * 3])));
  });

  it("survives cycles", () => {
    const g = normalizeGraph({ nodes: ["a", "b", "c"].map((id) => ({ id })), links: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" }] });
    const p = createLayoutRunner(hierarchyLayout(), g, env()).positions;
    expect(finite(p)).toBe(true);
    expect(new Set([p[1], p[4], p[7]]).size).toBe(3);
  });

  it("lays out left to right when asked", () => {
    const p = createLayoutRunner(hierarchyLayout({ direction: "right", layerGap: 80 }), tree(), env()).positions;
    expect(p[1 * 3]).toBe(80);
  });
});

describe("force gravity and hull radius", () => {
  it("gravity keeps unlinked nodes from drifting far from the rest", () => {
    const g = normalizeGraph({ nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` })), links: Array.from({ length: 20 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })) });
    const far = (p: Float32Array) => Math.max(...Array.from({ length: 30 }, (_, i) => Math.hypot(p[i * 3], p[i * 3 + 1])));
    const loose = far(createLayoutRunner(forceLayout({ seed: 2 }), g, env({ reducedMotion: true })).positions);
    const held = far(createLayoutRunner(forceLayout({ seed: 2, gravity: 0.08 }), g, env({ reducedMotion: true })).positions);
    expect(held).toBeLessThan(loose * 0.8);
  });

  it("a group's hull is not inflated by one far outlier", () => {
    const g = normalizeGraph({ nodes: Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, group: "g" })), links: [] });
    const p = new Float32Array(30);
    for (let i = 0; i < 9; i++) p.set([Math.cos(i) * 10, Math.sin(i) * 10, 0], i * 3);
    p.set([1000, 0, 0], 27);
    expect(groupClusters(g, p)[0].radius).toBeLessThan(100);
  });
});
