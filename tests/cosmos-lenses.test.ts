/**
 * The cosmos redesign, 0.4.0 (.ai/plans/fancy-graph-cosmos-design.md, approved
 * 2026-11-28): gravity places, light only draws; every centre is a node;
 * systems always orbit; galaxies are optional and free systems are spread by
 * their light links; `sort` reorders without regrouping.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayoutRunner, DEFAULT_LIMITS, normalizeGraph, resolveLimits, type GraphData, type GraphLimits } from "../src/core";
import { ASTEROID, CORE, cosmosLayout, MOON, PLANET, prepareCosmos, STAR, type CosmosLayoutOptions, type CosmosMeta } from "../src/three/presets/cosmos-layout";
import { cosmosPreset } from "../src/three/presets/presets3d";
import { cosmosData } from "../examples/cosmos/data";
import { KIT_NOW, kitData, relationData } from "../examples/cosmos/kit";

const env = (limits?: Partial<GraphLimits>, reducedMotion = false) => ({ dimensions: 3 as const, reducedMotion, limits: resolveLimits(limits) });
function run(data: GraphData, opts: CosmosLayoutOptions = {}, limits?: Partial<GraphLimits>) {
  const g = normalizeGraph(prepareCosmos(data, opts), limits);
  const r = createLayoutRunner(cosmosLayout(opts), g, env(limits));
  return { g, r, m: r.meta as CosmosMeta, at: (id: string) => at(r.positions, g.index.get(id)!) };
}
const at = (p: Float32Array, i: number): [number, number, number] => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const byField = (field: string) => ({ by: { field } });
const byRelation = (relation: string | string[]) => ({ by: { relation } });

afterEach(() => vi.restoreAllMocks());

describe("every centre is a node: the preset's prepare step", () => {
  it("systems by a field make one synthetic star per value, marked synthetic, joined to its members by synthetic links", () => {
    const data = kitData(30);
    const out = prepareCosmos(data, { systems: byField("language") });
    const stars = out.nodes.filter((n) => n.synthetic);
    expect(stars.map((n) => n.id).sort()).toEqual(["cosmos:system:php", "cosmos:system:python", "cosmos:system:typescript"]);
    expect(stars.find((n) => n.id === "cosmos:system:php")!.label).toBe("php");
    const tied = out.links.filter((l) => l.synthetic && l.target === "cosmos:system:php").map((l) => l.source);
    const php = data.nodes.filter((n) => ([] as unknown[]).concat(n.data!.language).includes("php")).map((n) => n.id);
    expect(tied.sort()).toEqual(php.sort());
    // The input is never mutated, and real nodes keep their order after the centres.
    expect(data.nodes.some((n) => n.synthetic)).toBe(false);
    expect(out.nodes.filter((n) => !n.synthetic).map((n) => n.id)).toEqual(data.nodes.map((n) => n.id));
  });

  it("a synthetic id never collides with a real one", () => {
    const data = kitData(10);
    data.nodes.push({ id: "cosmos:system:php", label: "a real node" });
    const out = prepareCosmos(data, { systems: byField("language") });
    const ids = out.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.nodes.find((n) => n.id === "cosmos:system:php")!.synthetic).toBeUndefined();
  });

  it("synthetic centres count against maxNodes and maxLinks, and are kept ahead of real nodes", () => {
    const data = kitData(30);
    const g = normalizeGraph(prepareCosmos(data, { systems: byField("language") }), { maxNodes: 10 });
    expect(g.nodes).toHaveLength(10);
    expect(g.nodes.filter((n) => n.synthetic)).toHaveLength(3);
    expect(g.dropped.nodes).toBe(23);
  });

  it("no lens that needs a centre, no synthetic nodes", () => {
    const data = kitData(20);
    expect(prepareCosmos(data, {}).nodes).toHaveLength(20);
    expect(prepareCosmos(data, { systems: byRelation("written-in") }).nodes).toHaveLength(20);
  });

  it("synthetic gravity links stay out of degree ranking", () => {
    const { g, m } = run(kitData(30), { systems: byField("language") });
    g.nodes.forEach((n, i) => {
      const real = g.incident[i].filter((li) => !g.links[li].link.synthetic).reduce((s, li) => s + g.links[li].weight, 0);
      expect(m.lightDegree[i], n.id).toBe(real);
    });
    expect(m.lightDegree[g.index.get("cosmos:system:typescript")!]).toBe(0);
  });

  it("the preset exposes the same step, so the view runs it before normalising", () => {
    const p = cosmosPreset({ galaxies: byField("type") });
    expect(typeof p.prepare).toBe("function");
    const out = p.prepare!({ nodes: [{ id: "a", group: "agent" }], links: [] });
    expect(out.nodes.map((n) => n.id)).toEqual(["cosmos:galaxy:agent", "a"]);
  });
});

describe("gravity: systems always orbit", () => {
  it("systems by relation: the target is the star, sources are planets, and their own sources are moons", () => {
    const { g, m } = run(relationData(), { systems: byRelation(["written-in", "part-of"]) });
    const kind = (id: string) => m.bodies[g.index.get(id)!].kind;
    const parent = (id: string) => g.nodes[m.bodies[g.index.get(id)!].parent]?.id;
    expect(kind("typescript")).toBe(STAR);
    expect(kind("p1")).toBe(PLANET);
    expect(parent("p1")).toBe("typescript");
    expect(kind("p0-m1")).toBe(MOON);
    expect(parent("p0-m1")).toBe("p0");
  });

  it("planets keep their orbit radius about their star, and moons about their moving planet, at every moment", () => {
    const { r, m, g } = run(relationData(), { systems: byRelation(["written-in", "part-of"]) });
    const start = Float32Array.from(r.positions);
    let moved = 0;
    for (const t of [3, 17, 90]) {
      while (r.time < t) r.tick(0.5);
      m.bodies.forEach((b, i) => {
        if (b.parent < 0 || b.pinned || b.kind === COMET_KIND) return;
        expect(dist(at(r.positions, i), at(r.positions, b.parent)), `${g.nodes[i].id} round its parent`).toBeCloseTo(b.orbitRadius, 1);
        if (dist(at(r.positions, i), at(start, i)) > 1) moved++;
      });
    }
    expect(moved).toBeGreaterThan(20);
  });

  it("systems by field orbit the value's synthetic star", () => {
    const { g, m } = run(kitData(30), { systems: byField("language"), comets: false });
    const php = g.index.get("cosmos:system:php")!;
    expect(m.bodies[php].kind).toBe(STAR);
    expect(m.bodies[php].synthetic).toBe(true);
    const planets = m.bodies.map((b, i) => (b.parent === php ? i : -1)).filter((i) => i >= 0);
    expect(planets.length).toBeGreaterThan(3);
    for (const i of planets) expect(([] as unknown[]).concat(g.nodes[i].data!.language)[0]).toBe("php");
  });

  it("no systems lens at all: every node is a lone star, and the sky is a starfield shaped by its links", () => {
    const { m } = run(cosmosData(80, 100, 2), { systems: { by: "none" }, galaxies: false });
    expect(m.bodies.every((b) => b.kind === STAR && b.parent < 0)).toBe(true);
    expect(m.galaxies).toHaveLength(0);
  });

  it("by default the best-connected nodes are stars (hubs) and unlinked nodes are rogue asteroids in open space", () => {
    const data: GraphData = { nodes: ["hub", "x", "y", "z", "lonely"].map((id) => ({ id })), links: [{ source: "hub", target: "x", weight: 3 }, { source: "hub", target: "y" }, { source: "z", target: "x" }] };
    const { m } = run(data);
    expect(m.bodies.map((b) => b.kind)).toEqual([STAR, PLANET, PLANET, MOON, ASTEROID]);
    expect(m.bodies[4].parent).toBe(-1);
    expect(m.galaxies).toHaveLength(0);
  });

  it("a gravity cycle is cut, never followed forever", () => {
    const data: GraphData = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], links: [{ source: "a", target: "b", kind: "in" }, { source: "b", target: "c", kind: "in" }, { source: "c", target: "a", kind: "in" }] };
    const { m } = run(data, { systems: byRelation("in") });
    expect(m.bodies.filter((b) => b.parent < 0)).toHaveLength(1);
    expect(m.bodies[0].parent).toBe(-1);
  });

  it("orbits nest no deeper than limits.maxOrbitDepth", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}` }));
    const links = Array.from({ length: 7 }, (_, i) => ({ source: `n${i + 1}`, target: `n${i}`, kind: "in" }));
    const { m } = run({ nodes, links }, { systems: byRelation("in") }, { maxOrbitDepth: 3 });
    expect(Math.max(...m.bodies.map((b) => b.depth))).toBe(2);
  });
});

describe("galaxies are optional", () => {
  it("with galaxies off there are no galaxies, and free systems are spread by their light links", () => {
    const data = cosmosData(300, 420, 5);
    const { r, m } = run(data, { galaxies: false });
    expect(r.clusters()).toEqual([]);
    const roots = m.bodies.map((b, i) => (b.parent < 0 && b.kind !== CORE ? i : -1)).filter((i) => i >= 0);
    // Light between systems: the number of links joining two systems.
    const sys = m.bodies.map((b) => b.system);
    const g = normalizeGraph(prepareCosmos(data, { galaxies: false }));
    const linked = new Set<string>();
    for (const l of g.links) {
      const a = sys[l.a], b = sys[l.b];
      if (a !== b) linked.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
    let near = 0, nearN = 0, far = 0, farN = 0;
    for (let x = 0; x < roots.length; x++)
      for (let y = x + 1; y < roots.length; y++) {
        const a = roots[x], b = roots[y];
        const d = dist(at(r.positions, a), at(r.positions, b));
        // No two free systems overlap.
        expect(d, `${a}/${b}`).toBeGreaterThanOrEqual(m.bodies[a].extent + m.bodies[b].extent - 1e-3);
        if (linked.has(a < b ? `${a}:${b}` : `${b}:${a}`)) (near += d), nearN++;
        else (far += d), farN++;
      }
    expect(nearN).toBeGreaterThan(5);
    expect(near / nearN).toBeLessThan((far / farN) * 0.75);
  });

  it("0.3.0's galaxy per type is `galaxies: { by: { field: \"type\" } }`: one galaxy per type, with the type's id", () => {
    const data = cosmosData(300, 420, 1);
    const { r, m, g } = run(data, { galaxies: byField("type") });
    const types = [...new Set(data.nodes.map((n) => n.group))].sort();
    expect(r.clusters()!.map((c) => c.id).sort()).toEqual(types);
    // Every core is a node: a synthetic one per type, drawn as a CORE body on the galaxy's live centre.
    r.tick(5);
    for (const gal of m.galaxies) {
      const core = gal.core;
      expect(g.nodes[core].id).toBe(`cosmos:galaxy:${gal.key}`);
      expect(m.bodies[core].kind).toBe(CORE);
      expect(dist(at(r.positions, core), gal.center)).toBeLessThan(1e-3);
    }
    // Every real node of a type is in that type's galaxy.
    for (const n of data.nodes) expect(m.galaxies[m.bodies[g.index.get(n.id)!].galaxy].key).toBe(n.group);
  });

  it("galaxies by relation: the core is the real node, and its systems sit on the arms clear of it", () => {
    const { g, m, r } = run(relationData(), { systems: byRelation(["written-in", "part-of"]), galaxies: byRelation("member-of") });
    const langs = m.galaxies.find((x) => x.key === "languages")!;
    expect(g.nodes[langs.core].id).toBe("languages");
    expect(g.nodes[langs.core].synthetic).toBeUndefined();
    expect(m.bodies[langs.core].kind).toBe(CORE);
    for (const id of ["typescript", "php", "python"]) {
      const i = g.index.get(id)!;
      expect(m.bodies[i].galaxy).toBe(m.galaxies.indexOf(langs));
      expect(dist(at(r.positions, i), langs.center)).toBeGreaterThan(langs.coreRadius * 1.5);
    }
    // A package is in its language's galaxy through its star.
    expect(m.bodies[g.index.get("p3")!].galaxy).toBe(m.galaxies.indexOf(langs));
  });

  it("galaxies and free systems never overlap", () => {
    const { r, m } = run(kitData(60), { systems: byField("language"), galaxies: byField("family") });
    const roots = m.bodies.map((b, i) => (b.parent < 0 && b.galaxy < 0 && b.kind !== CORE ? i : -1)).filter((i) => i >= 0);
    for (const gal of m.galaxies) {
      for (const other of m.galaxies) if (other !== gal) expect(dist(gal.restCenter, other.restCenter)).toBeGreaterThanOrEqual(gal.radius + other.radius);
      for (const i of roots) expect(dist(at(r.positions, i), gal.center)).toBeGreaterThanOrEqual(gal.radius);
    }
  });
});

describe("sort reorders, never regroups", () => {
  const opts: CosmosLayoutOptions = { systems: byField("language"), comets: false };
  const planetsOf = (m: CosmosMeta, star: number) => m.bodies.map((b, i) => ({ b, i })).filter((x) => x.b.parent === star).sort((x, y) => x.b.orbitRadius - y.b.orbitRadius).map((x) => x.i);

  it("by degree (the default): inner orbits are the best-connected", () => {
    const { g, m } = run(kitData(40), opts);
    const star = g.index.get("cosmos:system:typescript")!;
    const order = planetsOf(m, star).map((i) => m.lightDegree[i]);
    expect(order.length).toBeGreaterThan(4);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });

  it("by a field, ascending: oldest release on the inner orbit", () => {
    const { g, m } = run(kitData(40), { ...opts, sort: { by: { field: "releasedAt" }, dir: "asc" } });
    const star = g.index.get("cosmos:system:typescript")!;
    const dates = planetsOf(m, star).map((i) => String(g.nodes[i].data!.releasedAt));
    expect(dates).toEqual([...dates].sort());
  });

  it("orders systems along a galaxy's arms", () => {
    const { g, m, r } = run(relationData(), { systems: byRelation("written-in"), galaxies: byRelation("member-of"), sort: { by: "label", dir: "asc" } });
    const langs = m.galaxies.find((x) => x.key === "languages")!;
    const d = (id: string) => dist(at(r.positions, g.index.get(id)!), langs.center);
    expect(d("php")).toBeLessThan(d("python"));
    expect(d("python")).toBeLessThan(d("typescript"));
  });

  it("changing the sort moves nobody to another system or galaxy", () => {
    const data = kitData(50);
    const a = run(data, { ...opts, galaxies: byField("family") }).m;
    const b = run(data, { ...opts, galaxies: byField("family"), sort: { by: "label", dir: "desc" } }).m;
    expect(b.bodies.map((x) => [x.parent, x.galaxy])).toEqual(a.bodies.map((x) => [x.parent, x.galaxy]));
    expect(b.bodies.map((x) => x.orbitRadius)).not.toEqual(a.bodies.map((x) => x.orbitRadius));
  });
});

describe("determinism and placement", () => {
  const lenses: CosmosLayoutOptions = { systems: byField("language"), galaxies: byField("family"), comets: ["multi-membership", { field: "releasedAt", within: "14d", now: KIT_NOW }] };

  it("the same data gives the same sky, whatever the input order", () => {
    const data = kitData(60);
    const a = run(data, lenses);
    const b = run({ nodes: [...data.nodes].reverse(), links: [...data.links].reverse() }, lenses);
    for (let k = 0; k < 12; k++) {
      a.r.tick(0.5);
      b.r.tick(0.5);
    }
    for (const n of data.nodes) expect(dist(a.at(n.id), b.at(n.id)), n.id).toBeLessThan(1e-2);
  });

  it("`node.cosmos.galaxy` still pins its galaxy's core, and `offset` a node in its galaxy's disc", () => {
    const data = cosmosData(120, 160, 2);
    const first = (type: string) => data.nodes.findIndex((n) => n.group === type);
    data.nodes[first("problem")] = { ...data.nodes[first("problem")], cosmos: { galaxy: [3000, -200, 300] } };
    const agent = first("agent") + 5;
    data.nodes[agent] = { ...data.nodes[agent], cosmos: { offset: [30, 40] } };
    const { r, m, at: pos } = run(data, { galaxies: byField("type") });
    const problem = m.galaxies.find((x) => x.key === "problem")!;
    expect(problem.pinned).toBe(true);
    r.tick(20);
    expect(problem.center).toEqual([3000, -200, 300]);
    const ag = m.galaxies.find((x) => x.key === "agent")!;
    for (const t of [21, 60]) {
      while (r.time < t) r.tick(0.5);
      expect(dist(pos(data.nodes[agent].id), ag.center)).toBeCloseTo(50, 2);
    }
  });

  it("an offset with neither a galaxy nor a star to be relative to is reported, never thrown", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { m } = run({ nodes: [{ id: "a", cosmos: { offset: [10, 10] } }], links: [] });
    expect(m.placementIssues).toEqual([expect.objectContaining({ id: "a", field: "cosmos.offset" })]);
  });
});

describe("limits", () => {
  it("every new cosmos limit has a default and is configurable", () => {
    const keys: (keyof GraphLimits)[] = ["maxOrbitDepth", "maxSpreadTicks", "maxComets", "maxCometStops", "maxCometTail", "maxConstellations", "maxConstellationMembers", "maxTextures", "zoomLabelPx"];
    for (const k of keys) {
      expect(DEFAULT_LIMITS[k], k).toBeGreaterThan(0);
      expect(resolveLimits({ [k]: 7 })[k]).toBe(7);
    }
  });
});

const COMET_KIND = 5;
