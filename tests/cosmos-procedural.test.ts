/**
 * The cosmos's galaxies, 0.3.0 (owner request 2026-11-27), as 0.4.0 keeps
 * them: a galaxy per type is now asked for with `galaxies: { by: { field:
 * "type" } }` (the migration of 0.3.0's default), and its core is a node.
 * A galactic core per galaxy,
 * galaxies shaped procedurally from the data (deterministically), a motion
 * hierarchy (planets round stars, systems round their galaxy's core, galaxies
 * round the graph centre), and an optional `cosmos` field on a node that pins
 * where its galaxy or the node itself sits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayoutRunner, normalizeGraph, resolveLimits, type GraphData, type GraphNode } from "../src/core";
import { cosmosLayout, prepareCosmos, STAR, type CosmosGalaxy, type CosmosLayoutOptions, type CosmosMeta } from "../src/three/presets/cosmos-layout";
import { cosmosLayers } from "../src/three/presets/cosmos-renderers";
import { cosmosData } from "../examples/cosmos/data";

const env = (reducedMotion = false) => ({ dimensions: 3 as const, reducedMotion, limits: resolveLimits() });
/** 0.3.0's galaxy per type, as 0.4.0 asks for it. */
const TYPE: CosmosLayoutOptions = { galaxies: { by: { field: "type" } } };
const prepared = (data: GraphData) => normalizeGraph(prepareCosmos(data, TYPE));
const run = (data: GraphData, opts: CosmosLayoutOptions = {}, reducedMotion = false) => createLayoutRunner(cosmosLayout({ ...TYPE, ...opts }), prepared(data), env(reducedMotion));
const metaOf = (r: { meta: unknown }) => r.meta as CosmosMeta;
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (p: Float32Array, i: number): [number, number, number] => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
const shape = (g: CosmosGalaxy) => ({ arms: g.arms, twist: +g.twist.toFixed(6), radius: +g.radius.toFixed(6), core: +g.coreRadius.toFixed(6), normal: g.normal.map((x) => +x.toFixed(6)), warmth: +g.warmth.toFixed(6), scatter: +g.scatter.toFixed(6) });

/** One type, `n` nodes, linked as a chain (sparse) or every node to the next three (dense). */
function oneType(type: string, n: number, dense: boolean): GraphData {
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: `${type}-${i}`, group: type }));
  const links = [];
  for (let i = 0; i < n; i++) for (let k = 1; k <= (dense ? 3 : 1); k++) if (i + k < n) links.push({ source: `${type}-${i}`, target: `${type}-${i + k}` });
  return { nodes, links };
}

afterEach(() => vi.restoreAllMocks());

describe("deterministic, procedural galaxies", () => {
  it("the same data gives the same universe, at the same moment, whatever the input order", () => {
    const { nodes, links } = cosmosData(240, 320, 4);
    const a = run({ nodes, links });
    const b = run({ nodes: [...nodes].reverse(), links: [...links].reverse() });
    for (let k = 0; k < 20; k++) {
      a.tick(0.25);
      b.tick(0.25);
    }
    expect(metaOf(a).galaxies.map(shape)).toEqual(metaOf(b).galaxies.map(shape));
    const ga = prepared({ nodes, links }), gb = prepared({ nodes: [...nodes].reverse(), links });
    for (const n of nodes) {
      const pa = at(a.positions, ga.index.get(n.id)!), pb = at(b.positions, gb.index.get(n.id)!);
      expect(dist(pa, pb), n.id).toBeLessThan(1e-3);
    }
  });

  it("shapes each galaxy from its members: different structure, different galaxy", () => {
    const sparse = metaOf(run(oneType("agent", 60, false))).galaxies[0];
    const dense = metaOf(run(oneType("agent", 60, true))).galaxies[0];
    const small = metaOf(run(oneType("agent", 12, false))).galaxies[0];
    expect(shape(sparse)).not.toEqual(shape(dense));
    expect(small.radius).toBeLessThan(sparse.radius);
    // A denser galaxy has the bigger bulge.
    expect(dense.coreRadius / dense.radius).toBeGreaterThan(sparse.coreRadius / sparse.radius);
  });

  it("different type ids with the same structure still get different-looking galaxies", () => {
    const looks = ["agent", "problem", "post", "concept", "solution"].map((t) => shape(metaOf(run(oneType(t, 40, false))).galaxies[0]));
    expect(new Set(looks.map((l) => JSON.stringify(l))).size).toBe(looks.length);
    for (const l of looks) {
      expect(l.arms).toBeGreaterThanOrEqual(2);
      expect(l.arms).toBeLessThanOrEqual(6);
    }
  });

  it("carries the procedural shape on each galaxy cluster, for apps and agents to read", () => {
    const r = run(cosmosData(120, 160, 2));
    const c = r.clusters()![0];
    expect(c.data).toEqual(expect.objectContaining({ arms: expect.any(Number), twist: expect.any(Number), coreRadius: expect.any(Number), seed: expect.any(Number) }));
  });
});

describe("a galactic core per galaxy", () => {
  it("every galaxy has a core, smaller than the galaxy, with no star sitting inside it", () => {
    const r = run(cosmosData(400, 560, 1));
    const m = metaOf(r);
    expect(m.galaxies.length).toBeGreaterThan(3);
    for (const g of m.galaxies) {
      expect(g.coreRadius).toBeGreaterThan(0);
      expect(g.coreRadius).toBeLessThan(g.radius * 0.25);
      for (const i of g.members) if (m.bodies[i].kind === STAR) expect(dist(at(r.positions, i), g.center), `star ${i}`).toBeGreaterThan(g.coreRadius * 1.5);
    }
  });

  it("a one-node galaxy is a body beside its core, not on top of it", () => {
    const data = { nodes: [{ id: "solo", group: "lonely" }], links: [] };
    const r = run(data);
    const g = metaOf(r).galaxies[0];
    // Index 0 is the galaxy's synthetic core; the node itself comes after it.
    expect(dist(at(r.positions, 0), g.center)).toBeLessThan(1e-6);
    expect(dist(at(r.positions, prepared(data).index.get("solo")!), g.center)).toBeGreaterThan(g.coreRadius * 1.5);
  });

  it("the preset lists a `cores` layer beside the others", () => {
    expect(cosmosLayers().map((l) => l.id)).toEqual(["background", "clusters", "cores", "orbits", "links", "comets", "labels"]);
  });
});

describe("the motion hierarchy", () => {
  const data = cosmosData(300, 420, 3);
  const g = prepared(data);

  it("systems orbit their galactic core and galaxies orbit the graph centre, each at a fixed distance", () => {
    const r = run(data);
    const m = metaOf(r);
    r.tick(0.01);
    const coreDist = new Map<number, number>();
    const starDist = new Map<number, number>();
    const firstCentre = m.galaxies.map((x) => [...x.center]);
    const firstStar = new Map<number, [number, number, number]>();
    m.galaxies.forEach((x, gi) => {
      coreDist.set(gi, Math.hypot(...x.center));
      for (const i of x.members)
        if (m.bodies[i].kind === STAR) {
          starDist.set(i, dist(at(r.positions, i), x.center));
          firstStar.set(i, at(r.positions, i));
        }
    });
    let galaxiesMoved = 0, starsMoved = 0;
    for (const t of [20, 60, 200]) {
      while (r.time < t) r.tick(0.5);
      m.galaxies.forEach((x, gi) => {
        expect(Math.hypot(...x.center), `galaxy ${x.type} to centre`).toBeCloseTo(coreDist.get(gi)!, 2);
        if (dist(x.center, firstCentre[gi]) > 1) galaxiesMoved++;
        for (const i of x.members) {
          const b = m.bodies[i];
          if (b.kind === STAR) {
            expect(dist(at(r.positions, i), x.center), `star ${g.nodes[i].id} to core`).toBeCloseTo(starDist.get(i)!, 2);
            if (dist(at(r.positions, i), firstStar.get(i)!) > 0.5) starsMoved++;
          } else if (!b.pinned && b.parent >= 0) {
            expect(dist(at(r.positions, i), at(r.positions, b.parent)), `planet ${g.nodes[i].id} to its star`).toBeCloseTo(b.orbitRadius, 1);
          }
        }
      });
    }
    // The biggest galaxy sits at the centre, so only the others travel; every star turns with its galaxy.
    expect(galaxiesMoved).toBeGreaterThan(0);
    expect(starsMoved).toBeGreaterThan(0);
  });

  it("stays still under reduced motion and while paused", () => {
    const still = run(data, {}, true);
    const before = Float32Array.from(still.positions);
    expect(still.tick(5)).toBe(false);
    expect([...still.positions]).toEqual([...before]);

    const paused = run(data);
    paused.tick(1);
    paused.setPaused(true);
    const held = Float32Array.from(paused.positions);
    const centres = metaOf(paused).galaxies.map((x) => [...x.center]);
    paused.tick(30);
    expect([...paused.positions]).toEqual([...held]);
    expect(metaOf(paused).galaxies.map((x) => [...x.center])).toEqual(centres);
  });

  it("the speeds are options, and zero stops that level only", () => {
    const r = run(data, { galaxyOrbitSpeed: 0, spinSpeed: 0 });
    const m = metaOf(r);
    r.tick(0.01);
    const centres = m.galaxies.map((x) => [...x.center]);
    const stars = m.bodies.map((b, i) => (b.kind === STAR ? at(r.positions, i) : null));
    r.tick(50);
    expect(m.galaxies.map((x) => [...x.center])).toEqual(centres);
    stars.forEach((p, i) => p && expect(dist(at(r.positions, i), p)).toBeLessThan(1e-3));
    // Planets still orbit their stars.
    const moving = m.bodies.some((b, i) => b.parent >= 0 && !b.pinned && b.orbitSpeed !== 0 && i >= 0);
    expect(moving).toBe(true);
  });
});

describe("the optional `cosmos` placement field", () => {
  const base = (): GraphData => ({
    nodes: [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, group: "agent" })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, group: "problem" })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, group: "solution" })),
    ],
    links: [...Array.from({ length: 19 }, (_, i) => ({ source: "a0", target: `a${i + 1}` })), ...Array.from({ length: 9 }, (_, i) => ({ source: "p0", target: `p${i + 1}` }))],
  });
  const galaxy = (r: { meta: unknown }, type: string) => metaOf(r).galaxies.find((x) => x.type === type)!;
  /** A node's index in the prepared graph (the synthetic cores come first). */
  const idx = (data: GraphData, id: string) => prepared(data).index.get(id)!;

  it("`cosmos.galaxy` pins a galaxy's core in world space, and a pinned galaxy does not travel", () => {
    const data = base();
    data.nodes[20] = { ...data.nodes[20], cosmos: { galaxy: [1500, -200, 300] } };
    const r = run(data);
    const g = galaxy(r, "problem");
    expect(g.pinned).toBe(true);
    expect(g.center).toEqual([1500, -200, 300]);
    r.tick(1);
    r.tick(40);
    expect(g.center).toEqual([1500, -200, 300]);
    // Its systems still turn about it.
    const star = g.members.find((i) => metaOf(r).bodies[i].kind === STAR)!;
    expect(dist(at(r.positions, star), g.center)).toBeGreaterThan(0);
  });

  it("`cosmos.offset` pins a node within its galaxy, relative to the core, in the disc's own plane", () => {
    const data = base();
    data.nodes[3] = { ...data.nodes[3], cosmos: { offset: [30, 40] } };
    data.nodes[0] = { ...data.nodes[0], cosmos: { offset: [0, -120, 25] } };
    const r = run(data);
    const g = galaxy(r, "agent");
    const m = metaOf(r);
    const a3 = idx(data, "a3"), a0 = idx(data, "a0");
    expect(m.bodies[a3].pinned).toBe(true);
    for (const t of [0.01, 10, 90]) {
      while (r.time < t) r.tick(0.5);
      expect(dist(at(r.positions, a3), g.center)).toBeCloseTo(50, 2);
      expect(dist(at(r.positions, a0), g.center)).toBeCloseTo(Math.hypot(120, 25), 2);
      // In the disc plane: no component along the galaxy's normal.
      const p = at(r.positions, a3);
      const off = [p[0] - g.center[0], p[1] - g.center[1], p[2] - g.center[2]];
      expect(off[0] * g.normal[0] + off[1] * g.normal[1] + off[2] * g.normal[2]).toBeCloseTo(0, 2);
    }
  });

  it("ignores bad values loudly (one dev warning listing them), never throws, and lays out as if they were absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clean = run(base());
    const bad = base();
    const junk: unknown[] = ["nope", { galaxy: [1, 2] }, { galaxy: ["1", 2, 3] }, { galaxy: [Number.NaN, 0, 0] }, { galaxy: [1e12, 0, 0] }, { offset: [1] }, { offset: [0, Infinity] }, { offset: "0,0" }, null, 42];
    junk.forEach((c, k) => (bad.nodes[k] = { ...bad.nodes[k], cosmos: c as GraphNode["cosmos"] }));
    let r!: ReturnType<typeof run>;
    expect(() => (r = run(bad))).not.toThrow();
    r.tick(3);
    clean.tick(3);
    expect([...r.positions]).toEqual([...clean.positions]);
    expect(metaOf(r).placementIssues.map((x) => x.id)).toEqual(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/cosmos/);
    expect(String(warn.mock.calls[0][0])).toMatch(/a0/);
  });

  it("the first valid `cosmos.galaxy` in id order wins; a conflicting one is reported", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = base();
    data.nodes[21] = { ...data.nodes[21], cosmos: { galaxy: [900, 0, 0] } };
    data.nodes[22] = { ...data.nodes[22], cosmos: { galaxy: [-900, 0, 0] } };
    const r = run(data);
    expect(galaxy(r, "problem").center).toEqual([900, 0, 0]);
    expect(metaOf(r).placementIssues).toEqual([expect.objectContaining({ id: "p2", field: "cosmos.galaxy" })]);
  });

  it("the magnitude ceiling is a limit, configurable through `limits.maxPlacement`", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = base();
    data.nodes[20] = { ...data.nodes[20], cosmos: { galaxy: [5000, 0, 0] } };
    const tight = createLayoutRunner(cosmosLayout(TYPE), prepared(data), { ...env(), limits: resolveLimits({ maxPlacement: 1000 }) });
    expect(galaxy(tight, "problem").pinned).toBe(false);
    expect(metaOf(tight).placementIssues).toHaveLength(1);
  });
});
