/**
 * The cosmos layout, the `cosmos` 3D preset's physics: each node type becomes a
 * galaxy; within a galaxy the best-connected nodes are stars on spiral arms,
 * the other linked nodes are planets orbiting the star they share the most
 * weight with, and unlinked nodes are asteroids. Everything is seeded from ids,
 * so the universe is the same on every load, and orbiters move every frame.
 * Built only on the public layout contract: an app could write it itself.
 */
import type { GraphLayoutStepper } from "../../layout/contract";
import { hash01, seeded } from "../../random";
import type { GraphCluster, IndexedGraph, Vec3 } from "../../types";

export const STAR = 0;
export const PLANET = 1;
export const ASTEROID = 2;
export type BodyKind = typeof STAR | typeof PLANET | typeof ASTEROID;

export interface CosmosBody {
  kind: BodyKind;
  galaxy: number;
  size: number;
  seed: number;
  ringed: boolean;
  /** Where a star sits. Unused for orbiters. */
  home: Vec3;
  /** The star an orbiter circles, or -1 for a star. */
  parent: number;
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  orbitU: Vec3;
  orbitV: Vec3;
}

export interface CosmosGalaxy {
  type: string;
  center: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  radius: number;
  arms: number;
  twist: number;
  seed: number;
  members: number[];
}

export interface CosmosMeta {
  bodies: CosmosBody[];
  galaxies: CosmosGalaxy[];
}

export interface CosmosLayoutOptions {
  /** Most planets per star before another star is made. Default 14. */
  maxOrbiters?: number;
  /** The home view direction the galaxies roughly face. Match GraphScene's homeYaw / homePitch. */
  homeYaw?: number;
  homePitch?: number;
  /** CSS colour per node type, carried on each galaxy cluster (its label uses it). */
  colors?: Record<string, string>;
}

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
/** Two unit vectors spanning the plane with normal `n`. */
function plane(n: V): { u: V; v: V } {
  const ref: V = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(ref, n));
  return { u, v: cross(n, u) };
}

/** A point on a galaxy's spiral, `f` from core (0) to rim (1). Shared with the dust layer. */
export function spiralPoint(g: CosmosGalaxy, f: number, arm: number, rand: () => number, scatter = 0.1): V {
  const r = g.radius * (0.06 + 0.94 * Math.sqrt(f));
  const angle = (arm / g.arms) * Math.PI * 2 + g.twist * Math.sqrt(f) + g.seed * Math.PI * 2 + (rand() - 0.5) * scatter * 5;
  const spread = 1 + (rand() - 0.5) * scatter;
  const lift = (rand() - 0.5) * g.radius * 0.1 * (1.15 - f);
  return add(add(add(g.center, scale(g.u, Math.cos(angle) * r * spread)), scale(g.v, Math.sin(angle) * r * spread)), scale(g.normal, lift));
}

export function cosmosLayout(options: CosmosLayoutOptions = {}): GraphLayoutStepper & { meta: CosmosMeta } {
  const maxOrbiters = options.maxOrbiters ?? 14;
  const yaw = options.homeYaw ?? 0.75;
  const pitch = options.homePitch ?? 0.55;
  const meta: CosmosMeta = { bodies: [], galaxies: [] };

  const place = (bodies: CosmosBody[], i: number, t: number, out: Float32Array) => {
    const b = bodies[i];
    if (b.parent < 0) {
      out[i * 3] = b.home[0];
      out[i * 3 + 1] = b.home[1];
      out[i * 3 + 2] = b.home[2];
      return;
    }
    const c = bodies[b.parent].home;
    const a = b.orbitPhase + b.orbitSpeed * t;
    const x = Math.cos(a) * b.orbitRadius, y = Math.sin(a) * b.orbitRadius;
    out[i * 3] = c[0] + b.orbitU[0] * x + b.orbitV[0] * y;
    out[i * 3 + 1] = c[1] + b.orbitU[1] * x + b.orbitV[1] * y;
    out[i * 3 + 2] = c[2] + b.orbitU[2] * x + b.orbitV[2] * y;
  };

  return {
    name: "cosmos",
    animated: true,
    meta,
    init(graph: IndexedGraph, out: Float32Array) {
      const n = graph.nodes.length;
      const weightTo: Map<number, number>[] = Array.from({ length: n }, () => new Map());
      for (const l of graph.links) {
        weightTo[l.a].set(l.b, (weightTo[l.a].get(l.b) ?? 0) + l.weight);
        weightTo[l.b].set(l.a, (weightTo[l.b].get(l.a) ?? 0) + l.weight);
      }
      const typeOf = (i: number) => graph.nodes[i].group ?? "other";
      const byType = new Map<string, number[]>();
      for (let i = 0; i < n; i++) {
        const t = typeOf(i);
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(i);
      }
      // Biggest first, then by name, so the arrangement never depends on input order.
      const types = [...byType.keys()].sort((a, b) => byType.get(b)!.length - byType.get(a)!.length || a.localeCompare(b));
      const radii = types.map((t) => 150 + 34 * Math.sqrt(byType.get(t)!.length));

      // The home view's frame: galaxies sit in the plane facing it, the biggest in the middle and the rest on a ring.
      const toCamera: V = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
      const right: V = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up = cross(toCamera, right);
      const ringCount = types.length - 1;
      const second = radii[1] ?? 0;
      const ring = ringCount > 0 ? Math.max((radii[0] ?? 0) + second, ringCount > 1 ? (second * 1.08) / Math.sin(Math.PI / ringCount) : 0) * 1.12 : 0;

      meta.galaxies = types.map((type, gi) => {
        const seed = hash01(type);
        const rand = seeded(seed);
        const a = ((gi - 1) / Math.max(1, ringCount)) * Math.PI * 2 + 0.4;
        const sx = gi === 0 ? 0 : Math.cos(a) * ring;
        const sy = gi === 0 ? 0 : Math.sin(a) * ring * 0.92;
        const depth = gi === 0 ? 0 : (gi % 2 ? 0.34 : -0.34) * ring;
        const center = add(add(scale(right, sx), scale(up, sy)), scale(toCamera, depth));
        const normal = unit([toCamera[0] + (rand() - 0.5) * 0.8, toCamera[1] + (rand() - 0.5) * 0.8, toCamera[2] + (rand() - 0.5) * 0.8]);
        return { type, center, normal, ...plane(normal), radius: radii[gi], arms: 2 + Math.floor(rand() * 3), twist: 3.4 + rand() * 1.8, seed, members: byType.get(type)! };
      });

      const bodies: CosmosBody[] = Array.from({ length: n }, (_, i) => ({
        kind: ASTEROID,
        galaxy: types.indexOf(typeOf(i)),
        size: 1.8,
        seed: hash01(graph.nodes[i].id),
        ringed: false,
        home: [0, 0, 0],
        parent: -1,
        orbitRadius: 0,
        orbitPhase: 0,
        orbitSpeed: 0,
        orbitU: [1, 0, 0],
        orbitV: [0, 0, 1],
      }));

      meta.galaxies.forEach((g, gi) => {
        const ranked = [...g.members].sort((x, y) => graph.degree[y] - graph.degree[x] || graph.nodes[x].id.localeCompare(graph.nodes[y].id));
        const starCount = Math.max(1, Math.ceil(ranked.length / (maxOrbiters * 0.6)));
        const stars = ranked.slice(0, starCount);
        stars.forEach((s, j) => {
          const b = bodies[s];
          b.kind = STAR;
          b.size = 8 + Math.min(15, Math.sqrt(graph.degree[s]) * 2);
          b.home = stars.length === 1 ? [...g.center] : spiralPoint(g, (j + 0.15) / stars.length, j % g.arms, seeded(b.seed), 0.12);
        });
        const load = new Map<number, number>(stars.map((s) => [s, 0]));
        for (const m of ranked.slice(starCount)) {
          const b = bodies[m];
          const rand = seeded(b.seed + 0.5);
          // The linked star with the most shared weight and room left, else the emptiest star.
          let host = -1;
          let best = 0;
          for (const s of stars) {
            const w = weightTo[m].get(s) ?? 0;
            if (w > best && load.get(s)! < maxOrbiters) {
              best = w;
              host = s;
            }
          }
          if (host < 0) host = stars.reduce((x, y) => (load.get(y)! < load.get(x)! ? y : x), stars[0]);
          const slot = load.get(host)!;
          load.set(host, slot + 1);
          b.kind = graph.degree[m] > 0 ? PLANET : ASTEROID;
          b.size = b.kind === PLANET ? 3 + Math.min(6, Math.sqrt(graph.degree[m]) * 1.1) : 1.5 + rand() * 1.1;
          b.ringed = b.kind === PLANET && rand() < 0.22;
          b.parent = host;
          b.galaxy = gi;
          b.orbitRadius = bodies[host].size * 2.1 + 12 + slot * 8.5 + rand() * 3;
          b.orbitPhase = rand() * Math.PI * 2;
          b.orbitSpeed = ((rand() < 0.08 ? -1 : 1) * 9) / b.orbitRadius;
          const tilt = (rand() - 0.5) * 0.38;
          const o = plane(unit(add(g.normal, scale(g.u, tilt))));
          b.orbitU = o.u;
          b.orbitV = o.v;
        }
      });
      meta.bodies = bodies;
      for (let i = 0; i < n; i++) place(bodies, i, 0, out);
    },
    step(out, frame) {
      for (let i = 0; i < meta.bodies.length; i++) place(meta.bodies, i, frame.time, out);
      return true;
    },
    clusters(): GraphCluster[] {
      return meta.galaxies.map((g) => ({ id: g.type, label: g.type, center: g.center, radius: g.radius, members: g.members, normal: g.normal, color: options.colors?.[g.type], data: { arms: g.arms, seed: g.seed } }));
    },
  };
}
