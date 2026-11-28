/**
 * Comets (approved 2026-11-28): travellers, nodes with more than one
 * membership, swing on an eccentric loop through each of their systems;
 * arrivals, nodes with a recent time field, carry a tail whose length follows
 * recency. Constellations: named sets drawn over the sky, placement untouched.
 */
import { describe, expect, it, vi } from "vitest";
import { createLayoutRunner, normalizeGraph, resolveLimits, type GraphData, type GraphLimits } from "../src/core";
import { COMET, cometTailPoints, cosmosLayout, PLANET, prepareCosmos, type CosmosLayoutOptions, type CosmosMeta } from "../src/three/presets/cosmos-layout";
import { KIT_NOW, kitData } from "../examples/cosmos/kit";

const env = (limits?: Partial<GraphLimits>, reducedMotion = false) => ({ dimensions: 3 as const, reducedMotion, limits: resolveLimits(limits) });
function run(data: GraphData, opts: CosmosLayoutOptions = {}, limits?: Partial<GraphLimits>, reducedMotion = false) {
  const g = normalizeGraph(prepareCosmos(data, opts), limits);
  const r = createLayoutRunner(cosmosLayout(opts), g, env(limits, reducedMotion));
  return { g, r, m: r.meta as CosmosMeta };
}
const at = (p: Float32Array, i: number): [number, number, number] => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lang = { systems: { by: { field: "language" } } } as const;
const polyglot = (data: GraphData) => data.nodes.filter((n) => Array.isArray(n.data?.language)).map((n) => n.id);

describe("travellers: a node with several memberships becomes a comet", () => {
  it("is on by default, and its loop passes close by each of its systems' stars in turn", () => {
    const data = kitData(60);
    const { g, r, m } = run(data, lang);
    const ids = polyglot(data);
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) {
      const i = g.index.get(id)!;
      const b = m.bodies[i];
      expect(b.kind, id).toBe(COMET);
      const stops = m.comets.find((c) => c.index === i)!.stops;
      expect(stops.map((s) => g.nodes[s].id).sort()).toEqual((data.nodes.find((n) => n.id === id)!.data!.language as string[]).map((l) => `cosmos:system:${l}`).sort());
      const period = m.comets.find((c) => c.index === i)!.period;
      expect(period).toBeGreaterThan(5);
      // Sample a whole period: near each stop at some moment, and far from home at another.
      const closest = stops.map(() => Infinity);
      let farHome = 0;
      const p = new Float32Array(3);
      for (let k = 0; k <= 400; k++) {
        m.positionAt(i, (period * k) / 400, p);
        stops.forEach((s, j) => {
          const q = new Float32Array(3);
          m.positionAt(s, (period * k) / 400, q);
          const d = dist(p, q);
          closest[j] = Math.min(closest[j], d);
          if (j === 0) farHome = Math.max(farHome, d);
        });
      }
      stops.forEach((s, j) => expect(closest[j], `${id} near ${g.nodes[s].id}`).toBeLessThan(m.bodies[s].extent + 40));
      // Eccentric: its farthest point from home is many times its closest.
      expect(farHome / closest[0]).toBeGreaterThan(3);
    }
    void r;
  });

  it("its live position is the one positionAt gives, so tails and the view agree", () => {
    const data = kitData(60);
    const { g, r, m } = run(data, lang);
    const i = g.index.get(polyglot(data)[0])!;
    r.tick(0.5);
    r.tick(7.25);
    const p = new Float32Array(3);
    m.positionAt(i, r.time, p);
    expect(dist(p, at(r.positions, i))).toBeLessThan(1e-3);
  });

  it("with comets off, the first membership wins and the node is an ordinary planet", () => {
    const data = kitData(60);
    const { g, m } = run(data, { ...lang, comets: false });
    for (const id of polyglot(data)) {
      const b = m.bodies[g.index.get(id)!];
      expect(b.kind).toBe(PLANET);
      expect(g.nodes[b.parent].id).toBe(`cosmos:system:${(data.nodes.find((n) => n.id === id)!.data!.language as string[])[0]}`);
    }
    expect(m.comets).toHaveLength(0);
  });

  it("no more than limits.maxComets, and no more than limits.maxCometStops stops each", () => {
    const data = kitData(60);
    const { m } = run(data, lang, { maxComets: 2 });
    expect(m.comets).toHaveLength(2);
    const nodes = [{ id: "c", data: { language: ["a", "b", "c", "d", "e"] } }, { id: "x", data: { language: "a" } }];
    const capped = run({ nodes, links: [] }, lang, { maxCometStops: 3 }).m;
    expect(capped.comets[0].stops).toHaveLength(3);
  });

  it("stays still while paused and under reduced motion", () => {
    const data = kitData(60);
    const { r } = run(data, lang, undefined, true);
    const before = Float32Array.from(r.positions);
    r.tick(3);
    expect([...r.positions]).toEqual([...before]);
  });
});

describe("arrivals: a recent time field gives a tail, by recency", () => {
  const arrivals: CosmosLayoutOptions = { ...lang, comets: { field: "releasedAt", within: "14d", now: KIT_NOW } };

  it("tails only what is inside the window, longer for newer", () => {
    const data = kitData(60);
    const { g, m } = run(data, arrivals);
    const now = Date.parse(KIT_NOW);
    let tailed = 0;
    for (const n of data.nodes) {
      const age = now - Date.parse(String(n.data!.releasedAt));
      const b = m.bodies[g.index.get(n.id)!];
      if (age > 14 * 86400000) expect(b.tail, n.id).toBe(0);
      else {
        expect(b.tail, n.id).toBeGreaterThan(0);
        tailed++;
      }
    }
    expect(tailed).toBeGreaterThan(2);
    const sorted = data.nodes.map((n) => ({ age: now - Date.parse(String(n.data!.releasedAt)), tail: m.bodies[g.index.get(n.id)!].tail })).filter((x) => x.tail > 0).sort((a, b) => a.age - b.age);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k].tail).toBeLessThanOrEqual(sorted[k - 1].tail);
    // Travellers are off when the lens lists only arrivals.
    expect(m.comets.every((c) => c.stops.length === 0)).toBe(true);
  });

  it("both kinds at once", () => {
    const data = kitData(60);
    const { m } = run(data, { ...lang, comets: ["multi-membership", { field: "releasedAt", within: "14d", now: KIT_NOW }] });
    expect(m.comets.some((c) => c.stops.length > 1)).toBe(true);
    expect(m.comets.some((c) => c.stops.length === 0)).toBe(true);
  });

  it("the tail trails the body along its real path and is never longer than limits.maxCometTail", () => {
    const data = kitData(60);
    const { m } = run(data, { ...lang, comets: ["multi-membership", { field: "releasedAt", within: "14d", now: KIT_NOW }] }, { maxCometTail: 30 });
    for (const c of m.comets) {
      const [head, mid, end] = cometTailPoints(m, c.index, 12, 30);
      const p = new Float32Array(3);
      m.positionAt(c.index, 12, p);
      expect(dist(head, p)).toBeLessThan(1e-3);
      expect(dist(head, end)).toBeLessThanOrEqual(30 + 1e-3);
      // The middle sample is on the path, behind the head.
      expect(dist(head, mid)).toBeGreaterThan(0);
    }
  });

  it("a bad window or time is ignored, never thrown", () => {
    const data = kitData(10);
    data.nodes[0].data!.releasedAt = "not a date";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let m!: CosmosMeta;
    expect(() => (m = run(data, { ...lang, comets: { field: "releasedAt", within: "fortnight" } }).m)).not.toThrow();
    expect(m.lensIssues).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/fortnight/);
    warn.mockRestore();
  });
});

describe("constellations: an overlay that never moves anything", () => {
  const data = kitData(60);
  const base: CosmosLayoutOptions = { ...lang, comets: false };

  it("match by field value, relation or linkedTo", () => {
    const { g, m } = run(data, { ...base, constellations: [{ id: "ai", label: "AI", match: { field: "features", value: "ai" } }, { id: "peers", match: { relation: "peer" } }, { id: "near-0", match: { linkedTo: "pkg-0" } }] });
    const ids = (k: string) => m.constellations.find((c) => c.id === k)!.members.map((i) => g.nodes[i].id).sort();
    expect(ids("ai")).toEqual(data.nodes.filter((n) => (n.data!.features as string[]).includes("ai")).map((n) => n.id).sort());
    const peers = new Set<string>();
    for (const l of data.links) if (l.kind === "peer") peers.add(l.source).add(l.target);
    expect(ids("peers")).toEqual([...peers].sort());
    const near = new Set(["pkg-0"]);
    for (const l of data.links) if (l.source === "pkg-0" || l.target === "pkg-0") near.add(l.source === "pkg-0" ? l.target : l.source);
    expect(ids("near-0")).toEqual([...near].sort());
    expect(m.constellations.find((c) => c.id === "ai")!.label).toBe("AI");
  });

  it("one per value with `{ by: { field } }`", () => {
    const { m } = run(data, { ...base, constellations: { by: { field: "features" } } });
    expect(m.constellations.map((c) => c.id).sort()).toEqual(["3d", "ai", "documents", "payments", "search"]);
  });

  it("the figure is a minimum spanning tree over the members' resting places, the same on every build", () => {
    const { r, m } = run(data, { ...base, constellations: [{ id: "ai", match: { field: "features", value: "ai" } }] });
    const c = m.constellations[0];
    expect(c.edges).toHaveLength(c.members.length - 1);
    // Connected: every member reached from the first.
    const seen = new Set([c.members[0]]);
    for (let k = 0; k < c.members.length; k++) for (const [a, b] of c.edges) if (seen.has(a) || seen.has(b)) seen.add(a).add(b);
    expect(seen.size).toBe(c.members.length);
    // No shorter than optimal: any other spanning tree (a star from the first member) is at least as long.
    const rest = c.rest;
    const len = (a: number, b: number) => dist(rest[a], rest[b]);
    const mst = c.edges.reduce((s, [a, b]) => s + len(a, b), 0);
    const star = c.members.slice(1).reduce((s, b) => s + len(c.members[0], b), 0);
    expect(mst).toBeLessThanOrEqual(star + 1e-6);
    void r;
    const again = run(data, { ...base, constellations: [{ id: "ai", match: { field: "features", value: "ai" } }] }).m.constellations[0];
    expect(again.edges).toEqual(c.edges);
  });

  it("placement never changes", () => {
    const plain = run(data, base);
    const drawn = run(data, { ...base, constellations: { by: { field: "features" } } });
    expect([...drawn.r.positions]).toEqual([...plain.r.positions]);
  });

  it("caps constellations and their members by limits", () => {
    const { m } = run(data, { ...base, constellations: { by: { field: "features" } } }, { maxConstellations: 2, maxConstellationMembers: 4 });
    expect(m.constellations).toHaveLength(2);
    for (const c of m.constellations) expect(c.members.length).toBeLessThanOrEqual(4);
  });
});
