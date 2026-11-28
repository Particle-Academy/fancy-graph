/**
 * 0.4.1: the cosmos is galactic out of the box (owner, 2026-11-28: "just a big
 * solar system view, no galaxies or clusters", and "it doesn't matter what I
 * group it by"). With two or more node groups the default lens forms one
 * spiral galaxy per group; systems in a galaxy stay small
 * (`limits.maxPlanetsPerSystem`, and `hubShare` of the galaxy), the overflow
 * becoming stars of their own on the arms; `galaxies: false` gives back the
 * 0.4.0 sky exactly; orbit-path rings are faint and drawn only near the focus.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { createLayoutRunner, normalizeGraph, resolveLimits, type GraphData, type GraphLimits } from "../src/core";
import { autoGalaxyField, COMET, CORE, cosmosLayout, prepareCosmos, STAR, type CosmosLayoutOptions, type CosmosMeta } from "../src/three/presets/cosmos-layout";
import { COSMOS_ORBIT_DEFAULTS, cosmosLayers, cosmosOrbits, orbitFade, orbitSystemWeights } from "../src/three/presets/cosmos-renderers";
import { cosmosData } from "../examples/cosmos/data";
import { kitGrouped } from "../examples/cosmos/kit";
import type { LayerFrame3D } from "../src/three/types";

function run(data: GraphData, opts: CosmosLayoutOptions = {}, limits?: Partial<GraphLimits>) {
  const g = normalizeGraph(prepareCosmos(data, opts), limits);
  const r = createLayoutRunner(cosmosLayout(opts), g, { dimensions: 3, reducedMotion: false, limits: resolveLimits(limits) });
  return { g, r, m: r.meta as CosmosMeta };
}
/** Bodies orbiting in each system (planets and moons; never comets), by the system's root. */
function systemSizes(m: CosmosMeta): Map<number, number> {
  const out = new Map<number, number>();
  m.bodies.forEach((b, i) => {
    if (b.kind === CORE || b.kind === COMET || b.system === i) return;
    out.set(b.system, (out.get(b.system) ?? 0) + 1);
  });
  return out;
}
const largest = (m: CosmosMeta) => Math.max(0, ...systemSizes(m).values());

/**
 * The 0.4.0 sky, fingerprinted with the 0.4.0 code (de74f7d) before this change:
 * every node's kind, parent, galaxy and position (to 0.01) at t = 0 and t = 7.3.
 */
function fingerprint(data: GraphData, opts: CosmosLayoutOptions) {
  const { g, r, m } = run(data, opts);
  r.seek(0);
  const p0 = Array.from(r.positions, (x) => Math.round(x * 100));
  r.seek(7.3);
  const p1 = Array.from(r.positions, (x) => Math.round(x * 100));
  const s = g.nodes
    .map((n, i) => `${n.id}|${m.bodies[i].kind}|${m.bodies[i].parent >= 0 ? g.nodes[m.bodies[i].parent].id : "-"}|${m.bodies[i].galaxy}|${p0.slice(i * 3, i * 3 + 3)}|${p1.slice(i * 3, i * 3 + 3)}`)
    .join("\n");
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619) >>> 0;
  return { nodes: g.nodes.length, galaxies: m.galaxies.length, hash: h.toString(16) };
}

describe("galaxies by group, out of the box", () => {
  it("a 150-node grouped graph forms one spiral galaxy per group, each of several systems", () => {
    const { m } = run(kitGrouped(150, "family"));
    expect(m.galaxies.map((g) => g.key).sort()).toEqual(["commerce", "documents", "engines", "surfaces", "tooling"]);
    for (const g of m.galaxies) {
      // Spiral, with a core node at the centre.
      expect(g.arms).toBeGreaterThanOrEqual(2);
      expect(m.bodies[g.core].kind).toBe(CORE);
      expect(g.systems.length, g.key).toBeGreaterThanOrEqual(4);
    }
    // Every real node is in a galaxy.
    m.bodies.forEach((b, i) => {
      if (!m.ids[i].startsWith("cosmos:")) expect(b.galaxy, m.ids[i]).toBeGreaterThanOrEqual(0);
    });
  });

  it("one group, or none, forms no galaxies", () => {
    const one = kitGrouped(60);
    expect(run({ nodes: one.nodes.map((n) => ({ ...n, group: "package" })), links: one.links }).m.galaxies).toEqual([]);
    expect(autoGalaxyField([{ id: "a" }, { id: "b" }])).toBeNull();
    expect(autoGalaxyField([{ id: "a", group: "x" }, { id: "b", group: "y" }])).toBe("group");
    expect(autoGalaxyField([{ id: "a", data: { type: "x" } }, { id: "b", data: { type: "y" } }])).toBe("type");
  });

  it("regrouping the same nodes re-forms the galaxies: other membership, other places", () => {
    const a = run(kitGrouped(150, "family"));
    const b = run(kitGrouped(150, "language"));
    expect(b.m.galaxies.map((g) => g.key).sort()).toEqual(["php", "python", "typescript"]);
    const galaxyOf = (x: typeof a, id: string) => x.m.galaxies[x.m.bodies[x.g.index.get(id)!].galaxy]?.key;
    const ids = a.g.nodes.filter((n) => !n.synthetic).map((n) => n.id);
    // Membership follows the group.
    for (const id of ids) {
      expect(galaxyOf(a, id)).toBe(String(a.g.nodes[a.g.index.get(id)!].group));
      expect(galaxyOf(b, id)).toBe(String(b.g.nodes[b.g.index.get(id)!].group));
    }
    // And the sky is a different sky: nearly every body has moved.
    const moved = ids.filter((id) => {
      const i = a.g.index.get(id)!, j = b.g.index.get(id)!;
      return Math.hypot(a.r.positions[i * 3] - b.r.positions[j * 3], a.r.positions[i * 3 + 1] - b.r.positions[j * 3 + 1], a.r.positions[i * 3 + 2] - b.r.positions[j * 3 + 2]) > 20;
    });
    expect(moved.length).toBeGreaterThan(ids.length * 0.9);
  });

  it("not under a gravity relation, whose groups name body kinds (star, planet, moon): it already says what orbits what", () => {
    const data: GraphData = {
      nodes: [{ id: "sun", group: "star" }, { id: "earth", group: "planet" }, { id: "mars", group: "planet" }, { id: "moon", group: "moon" }],
      links: [{ source: "earth", target: "sun", kind: "orbits" }, { source: "mars", target: "sun", kind: "orbits" }, { source: "moon", target: "earth", kind: "orbits" }],
    };
    const { m, g } = run(data, { systems: { by: { relation: "orbits" } } });
    expect(m.galaxies).toEqual([]);
    expect(g.nodes.some((n) => n.synthetic)).toBe(false);
    // Asked for, it still forms them.
    expect(run(data, { systems: { by: { relation: "orbits" } }, galaxies: { by: { field: "group" } } }).g.nodes.filter((n) => n.synthetic)).toHaveLength(3);
  });

  it("an explicit galaxies lens wins over the groups", () => {
    const { m } = run(kitGrouped(150, "family"), { galaxies: { by: { field: "language" } } });
    expect(m.galaxies.map((g) => g.key).sort()).toEqual(["php", "python", "typescript"]);
  });

  it("is deterministic whatever the input order", () => {
    const data = kitGrouped(150, "family");
    const rev = { nodes: [...data.nodes].reverse(), links: [...data.links].reverse() };
    const x = run(data), y = run(rev);
    for (const n of data.nodes) {
      const i = x.g.index.get(n.id)!, j = y.g.index.get(n.id)!;
      for (let k = 0; k < 3; k++) expect(y.r.positions[j * 3 + k]).toBeCloseTo(x.r.positions[i * 3 + k], 3);
    }
  });
});

describe("systems stay small in a galaxy", () => {
  it("no system exceeds limits.maxPlanetsPerSystem (default 12), hubs or a field", () => {
    expect(resolveLimits().maxPlanetsPerSystem).toBe(12);
    for (const opts of [{}, { systems: { by: { field: "language" } } }, { systems: { by: { field: "language" } }, galaxies: { by: { field: "family" } } }] as CosmosLayoutOptions[]) {
      const { m } = run(kitGrouped(150, "family"), opts);
      expect(largest(m), JSON.stringify(opts)).toBeLessThanOrEqual(12);
      expect(largest(m), JSON.stringify(opts)).toBeGreaterThan(0);
    }
  });

  it("the cap is a limit: a smaller one makes smaller systems", () => {
    const { m } = run(kitGrouped(150, "family"), { systems: { by: { field: "language" } } }, { maxPlanetsPerSystem: 4 });
    expect(largest(m)).toBeLessThanOrEqual(4);
  });

  it("the overflow becomes further stars on the same galaxy's arms, not more rings round one star", () => {
    // By language, typescript alone has ~90 packages: 0.4.0 made one star with ~90 rings.
    const { m, g } = run(kitGrouped(150, "language"), { systems: { by: { field: "language" } } });
    const ts = m.galaxies.find((x) => x.key === "typescript")!;
    expect(ts.systems.length).toBeGreaterThan(5);
    for (const s of ts.systems) expect(m.bodies[s].galaxy).toBe(m.galaxies.indexOf(ts));
    const tsStar = g.index.get("cosmos:system:typescript")!;
    expect(systemSizes(m).get(tsStar) ?? 0).toBeLessThanOrEqual(12);
    // The best-connected stay with the star.
    const kept = m.bodies.map((b, i) => (b.parent === tsStar && b.kind !== COMET ? i : -1)).filter((i) => i >= 0);
    expect(kept.length).toBe(12);
    const freed = ts.systems.filter((s) => s !== tsStar && !g.nodes[s].synthetic);
    expect(Math.min(...kept.map((i) => m.lightDegree[i]))).toBeGreaterThanOrEqual(Math.max(...freed.map((i) => m.lightDegree[i])) - 1e-9);
  });

  it("hubs take a modest share of their galaxy: a galaxy is several systems", () => {
    const { m } = run(kitGrouped(150, "family"));
    for (const gal of m.galaxies) {
      const members = gal.members.length - 1;
      const sizes = gal.systems.map((s) => systemSizes(m).get(s) ?? 0);
      expect(Math.max(...sizes), gal.key).toBeLessThanOrEqual(Math.max(3, Math.ceil(members * 0.2)));
      expect(gal.systems.filter((s) => m.bodies[s].kind === STAR).length, gal.key).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("`galaxies: false` restores the 0.4.0 sky exactly", () => {
  // Fingerprints taken from the 0.4.0 code (de74f7d), lens `{}`, before 0.4.1 changed the default.
  const grouped = () => kitGrouped(150, "family");
  for (const off of [false, "none", null] as const) {
    it(`galaxies: ${JSON.stringify(off)}`, () => {
      expect(fingerprint(grouped(), { galaxies: off })).toEqual({ nodes: 150, galaxies: 0, hash: "aac522c2" });
      expect(fingerprint(grouped(), { galaxies: off, systems: { by: { field: "language" } } })).toEqual({ nodes: 153, galaxies: 0, hash: "e35940fb" });
      expect(fingerprint(cosmosData(120, 160, 3), { galaxies: off })).toEqual({ nodes: 120, galaxies: 0, hash: "c045660" });
    });
  }

  it("prepare adds no galaxy centres when they are off", () => {
    expect(prepareCosmos(grouped(), { galaxies: false }).nodes.filter((n) => n.synthetic)).toEqual([]);
    expect(prepareCosmos(grouped(), {}).nodes.filter((n) => n.synthetic).map((n) => n.id)).toContain("cosmos:galaxy:tooling");
  });
});

describe("orbit paths: subtle by default", () => {
  it("are on, faint: alpha 0.07 normal, 0.3 highlighted, 0.02 dimmed", () => {
    expect(cosmosLayers().find((l) => l.id === "orbits")!.visible).not.toBe(false);
    expect(COSMOS_ORBIT_DEFAULTS).toMatchObject({ normal: 0.07, active: 0.3, dimmed: 0.02, nearest: 3 });
  });

  it("only the focused system and the three nearest the camera draw, fainter with rank", () => {
    const { m, r } = run(kitGrouped(150, "family"));
    const systems = [...systemSizes(m).keys()].sort((a, b) => a - b);
    const p = r.positions;
    // Stand right beside one system.
    const s0 = systems[5];
    const cam = [p[s0 * 3] + 1, p[s0 * 3 + 1], p[s0 * 3 + 2]];
    const none = { selected: -1, focused: -1, hovered: -1 };
    const w = orbitSystemWeights(m, p, cam, none, systems, 3);
    expect(w.size).toBe(3);
    expect(w.get(s0)).toBeCloseTo(0.75);
    expect([...w.values()].sort()).toEqual([0.25, 0.5, 0.75]);
    // The selection's system is full strength wherever the camera is, on top of the nearest three.
    const far = systems[systems.length - 1];
    const planet = m.bodies.findIndex((b, i) => b.system === far && i !== far);
    const w2 = orbitSystemWeights(m, p, cam, { ...none, selected: planet }, systems, 3);
    expect(w2.get(far)).toBe(1);
    expect(w2.size).toBe(4);
    // nearest: 0 draws only the focus.
    expect([...orbitSystemWeights(m, p, cam, { ...none, focused: planet }, systems, 0).keys()]).toEqual([far]);
  });

  it("fade out with distance: nothing when a ring is a few pixels, full when it is large", () => {
    expect(orbitFade(10, 10000, 700, 50, [12, 80])).toBe(0);
    expect(orbitFade(100, 100, 700, 50, [12, 80])).toBe(1);
    const mid = orbitFade(10, 150, 700, 50, [12, 80]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("the layer draws rings only for those systems, each alpha = state alpha x weight x fade", () => {
    const { m, r, g } = run(kitGrouped(150, "family"));
    const group = new THREE.Group();
    const layer = cosmosOrbits();
    layer.mount({ group, meta: m, renderOrder: 0 } as unknown as Parameters<typeof layer.mount>[0]);
    const p = r.positions;
    const systems = [...systemSizes(m).keys()].sort((a, b) => a - b);
    const s0 = systems[0];
    const camera = new THREE.PerspectiveCamera(50, 1000 / 700, 0.5, 60000);
    camera.position.set(p[s0 * 3], p[s0 * 3 + 1], p[s0 * 3 + 2] + 120);
    camera.updateMatrixWorld();
    const n = g.nodes.length;
    const frame = { positions: p, states: new Uint8Array(n), colors: new Float32Array(n * 3).fill(1), camera, height: 700, width: 1000, selected: -1, focused: -1, hovered: -1, meta: m } as unknown as LayerFrame3D;
    layer.update!(frame);
    const lines = group.getObjectByName("cosmos-orbits") as THREE.LineSegments;
    const geo = lines.geometry as THREE.InstancedBufferGeometry;
    const total = m.bodies.filter((b) => b.parent >= 0 && !b.pinned && b.kind !== COMET && b.orbitRadius > 0).length;
    expect(geo.instanceCount).toBeGreaterThan(0);
    expect(geo.instanceCount).toBeLessThan(total / 4);
    const color = geo.getAttribute("iColor") as THREE.InterleavedBufferAttribute;
    for (let k = 0; k < geo.instanceCount; k++) {
      expect(color.getW(k)).toBeGreaterThan(0);
      expect(color.getW(k)).toBeLessThanOrEqual(COSMOS_ORBIT_DEFAULTS.normal + 1e-6);
    }
    layer.dispose();
  });
});
