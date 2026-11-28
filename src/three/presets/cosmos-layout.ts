/**
 * The cosmos layout, the `cosmos` 3D preset's physics: each node type becomes a
 * galaxy with a bright core; within a galaxy the best-connected nodes are stars
 * on spiral arms, the other linked nodes are planets orbiting the star they
 * share the most weight with, and unlinked nodes are asteroids.
 *
 * Each galaxy's shape (arm count, twist, size, tilt, bulge, warmth, arm spread)
 * is derived from its type id and its members: how many there are and how they
 * link, inside the galaxy and out of it. Nothing is random at run time, so the
 * same graph is the same universe on every load and a different graph looks
 * different.
 *
 * Motion is a hierarchy: planets and asteroids orbit their stars, every system
 * turns about its galaxy's core, and galaxies orbit the graph centre (the
 * origin). A node's optional `cosmos` field pins its galaxy's core or its own
 * place in the disc. Built only on the public layout contract: an app could
 * write it itself.
 */
import type { LayoutEnv, GraphLayoutStepper } from "../../layout/contract";
import { hash01, seeded } from "../../random";
import type { GraphCluster, GraphNode, IndexedGraph, Vec3 } from "../../types";

export const STAR = 0;
export const PLANET = 1;
export const ASTEROID = 2;
export type BodyKind = typeof STAR | typeof PLANET | typeof ASTEROID;

/**
 * One node's body. `home`, `orbitU` and `orbitV` are in the galaxy's REST
 * frame (where everything sits at time 0); live positions are the layout's
 * output, the rest frame turned and carried with its galaxy.
 */
export interface CosmosBody {
  kind: BodyKind;
  galaxy: number;
  size: number;
  seed: number;
  ringed: boolean;
  /** Where a star (or a pinned body) sits at rest. Unused for orbiters. */
  home: Vec3;
  /** The star an orbiter circles (or, pinned, the star that lights it), or -1 for a star. */
  parent: number;
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  orbitU: Vec3;
  orbitV: Vec3;
  /** Placed by its `cosmos.offset`: it turns with its galaxy and orbits nothing. */
  pinned: boolean;
}

export interface CosmosGalaxy {
  type: string;
  /** Live: the core's position now. Mutated in place every step. */
  center: Vec3;
  normal: Vec3;
  /** Live: the disc's in-plane axes now (they turn as the galaxy spins). */
  u: Vec3;
  v: Vec3;
  radius: number;
  arms: number;
  twist: number;
  seed: number;
  members: number[];
  /** The bright central bulge's radius, world units. */
  coreRadius: number;
  /** 0 cool (blue, young) to 1 warm (gold, old): tints the core and the disc. */
  warmth: number;
  /** How loose the arms are: dust and stars scatter this far off the spiral. */
  scatter: number;
  /** Relative dust density, from how well the members link. */
  density: number;
  /** Links with both ends in this galaxy. */
  links: number;
  /** The frame at time 0. */
  restCenter: Vec3;
  restU: Vec3;
  restV: Vec3;
  /** Pinned by a member's `cosmos.galaxy`: it stays put instead of orbiting the centre. */
  pinned: boolean;
  /** Radians per second about the graph centre (0 for a pinned galaxy or one at the centre). */
  orbitSpeed: number;
  /** Radians per second about its own core; negative, so the arms trail. */
  spinSpeed: number;
}

export interface CosmosPlacementIssue {
  id: string;
  field: "cosmos" | "cosmos.galaxy" | "cosmos.offset";
  reason: string;
}

export interface CosmosMeta {
  bodies: CosmosBody[];
  galaxies: CosmosGalaxy[];
  /** The axis galaxies orbit the centre about (the home view direction). */
  axis: Vec3;
  /** Bad `cosmos` values that were ignored, sorted by node id. */
  placementIssues: CosmosPlacementIssue[];
}

export interface CosmosLayoutOptions {
  /** Most planets per star before another star is made. Default 14. */
  maxOrbiters?: number;
  /** The home view direction the galaxies roughly face. Match GraphScene's homeYaw / homePitch. */
  homeYaw?: number;
  homePitch?: number;
  /** CSS colour per node type, carried on each galaxy cluster (its label uses it). */
  colors?: Record<string, string>;
  /** How fast galaxies orbit the graph centre, radians per second. Default 0.004 (about 26 minutes a turn). 0 stops it. */
  galaxyOrbitSpeed?: number;
  /** How fast a galaxy turns about its core, as its rim's speed in world units per second. Default 6. 0 stops it. */
  spinSpeed?: number;
}

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finiteOr = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
/** Two unit vectors spanning the plane with normal `n`. */
function plane(n: V): { u: V; v: V } {
  const ref: V = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(ref, n));
  return { u, v: cross(n, u) };
}

/** A point on a galaxy's spiral, `f` from core (0) to rim (1), on its live frame. Shared with the dust layer. */
export function spiralPoint(g: Pick<CosmosGalaxy, "center" | "u" | "v" | "normal" | "radius" | "arms" | "twist" | "seed">, f: number, arm: number, rand: () => number, scatter = 0.1): V {
  const r = g.radius * (0.06 + 0.94 * Math.sqrt(f));
  const angle = (arm / g.arms) * Math.PI * 2 + g.twist * Math.sqrt(f) + g.seed * Math.PI * 2 + (rand() - 0.5) * scatter * 5;
  const spread = 1 + (rand() - 0.5) * scatter;
  const lift = (rand() - 0.5) * g.radius * 0.1 * (1.15 - f);
  return add(add(add(g.center, scale(g.u, Math.cos(angle) * r * spread)), scale(g.v, Math.sin(angle) * r * spread)), scale(g.normal, lift));
}

// The bundler replaces `process.env.NODE_ENV`; with no bundler and no `process`, it is dev.
declare const process: { env: Record<string, string | undefined> };
function devMode(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/** Reads a placement vector: `lengths` numbers, finite, within `max`. A string is the reason it was refused. */
function readVec(v: unknown, lengths: number[], max: number): V | string {
  if (!Array.isArray(v)) return "must be an array of numbers";
  if (!lengths.includes(v.length)) return `must have ${lengths.join(" or ")} numbers, got ${v.length}`;
  for (const x of v) if (typeof x !== "number" || !Number.isFinite(x)) return "must hold finite numbers only";
  if (v.some((x: number) => Math.abs(x) > max)) return `is past limits.maxPlacement (${max})`;
  return [v[0], v[1], v[2] ?? 0];
}

interface Placement {
  galaxy?: V;
  offset?: V;
}
function readPlacement(node: GraphNode, max: number, issues: CosmosPlacementIssue[]): Placement {
  const raw = (node as { cosmos?: unknown }).cosmos;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({ id: node.id, field: "cosmos", reason: "must be an object like { galaxy: [x, y, z] } or { offset: [x, y] }" });
    return {};
  }
  const out: Placement = {};
  const { galaxy, offset } = raw as { galaxy?: unknown; offset?: unknown };
  if (galaxy !== undefined) {
    const g = readVec(galaxy, [3], max);
    if (typeof g === "string") issues.push({ id: node.id, field: "cosmos.galaxy", reason: g });
    else out.galaxy = g;
  }
  if (offset !== undefined) {
    const o = readVec(offset, [2, 3], max);
    if (typeof o === "string") issues.push({ id: node.id, field: "cosmos.offset", reason: o });
    else out.offset = o;
  }
  return out;
}

export function cosmosLayout(options: CosmosLayoutOptions = {}): GraphLayoutStepper & { meta: CosmosMeta } {
  const maxOrbiters = Math.max(1, Math.floor(finiteOr(options.maxOrbiters, 14)));
  const yaw = finiteOr(options.homeYaw, 0.75);
  const pitch = finiteOr(options.homePitch, 0.55);
  const galaxyOrbitSpeed = finiteOr(options.galaxyOrbitSpeed, 0.004);
  const rimSpeed = finiteOr(options.spinSpeed, 6);
  const meta: CosmosMeta = { bodies: [], galaxies: [], axis: [0, 0, 1], placementIssues: [] };

  /** Moves every galaxy's live frame to time `t`. */
  const frames = (t: number) => {
    const A = meta.axis;
    for (const g of meta.galaxies) {
      const phi = g.orbitSpeed * t;
      const c = g.restCenter;
      if (phi === 0) g.center.splice(0, 3, c[0], c[1], c[2]);
      else {
        // Rodrigues: the rest centre turned by phi about the axis through the origin.
        const cs = Math.cos(phi), sn = Math.sin(phi), ax = cross(A, c), k = dot(A, c) * (1 - cs);
        g.center.splice(0, 3, c[0] * cs + ax[0] * sn + A[0] * k, c[1] * cs + ax[1] * sn + A[1] * k, c[2] * cs + ax[2] * sn + A[2] * k);
      }
      const th = g.spinSpeed * t;
      const cs = Math.cos(th), sn = Math.sin(th), u0 = g.restU, v0 = g.restV;
      g.u.splice(0, 3, u0[0] * cs + v0[0] * sn, u0[1] * cs + v0[1] * sn, u0[2] * cs + v0[2] * sn);
      g.v.splice(0, 3, v0[0] * cs - u0[0] * sn, v0[1] * cs - u0[1] * sn, v0[2] * cs - u0[2] * sn);
    }
  };

  const place = (i: number, t: number, out: Float32Array) => {
    const bodies = meta.bodies;
    const b = bodies[i];
    let x: number, y: number, z: number;
    if (b.parent < 0 || b.pinned) [x, y, z] = b.home;
    else {
      const c = bodies[b.parent].home;
      const a = b.orbitPhase + b.orbitSpeed * t;
      const ox = Math.cos(a) * b.orbitRadius, oy = Math.sin(a) * b.orbitRadius;
      x = c[0] + b.orbitU[0] * ox + b.orbitV[0] * oy;
      y = c[1] + b.orbitU[1] * ox + b.orbitV[1] * oy;
      z = c[2] + b.orbitU[2] * ox + b.orbitV[2] * oy;
    }
    // From the rest frame to the galaxy's live frame.
    const g = meta.galaxies[b.galaxy];
    const r = g.restCenter;
    const q: V = [x - r[0], y - r[1], z - r[2]];
    const lu = dot(q, g.restU), lv = dot(q, g.restV), ln = dot(q, g.normal);
    out[i * 3] = g.center[0] + g.u[0] * lu + g.v[0] * lv + g.normal[0] * ln;
    out[i * 3 + 1] = g.center[1] + g.u[1] * lu + g.v[1] * lv + g.normal[1] * ln;
    out[i * 3 + 2] = g.center[2] + g.u[2] * lu + g.v[2] * lv + g.normal[2] * ln;
  };

  return {
    name: "cosmos",
    animated: true,
    meta,
    init(graph: IndexedGraph, out: Float32Array, env?: LayoutEnv) {
      const n = graph.nodes.length;
      const maxPlacement = finiteOr(env?.limits?.maxPlacement, 100000);
      const issues: CosmosPlacementIssue[] = [];
      const placements = graph.nodes.map((node) => readPlacement(node, maxPlacement, issues));

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
      const inside = new Map<string, number>(), outside = new Map<string, number>();
      for (const l of graph.links) {
        const ta = typeOf(l.a), tb = typeOf(l.b);
        if (ta === tb) inside.set(ta, (inside.get(ta) ?? 0) + 1);
        else {
          outside.set(ta, (outside.get(ta) ?? 0) + 1);
          outside.set(tb, (outside.get(tb) ?? 0) + 1);
        }
      }
      // Biggest first, then by name, so the arrangement never depends on input order.
      const types = [...byType.keys()].sort((a, b) => byType.get(b)!.length - byType.get(a)!.length || a.localeCompare(b));

      // A galaxy's pin: the first valid `cosmos.galaxy` among its members in id order; a different one later is reported.
      const pins = types.map((t) => {
        let pin: V | null = null;
        const ids = [...byType.get(t)!].sort((x, y) => graph.nodes[x].id.localeCompare(graph.nodes[y].id));
        for (const i of ids) {
          const g = placements[i].galaxy;
          if (!g) continue;
          if (!pin) pin = g;
          else if (g.some((x, k) => x !== pin![k])) {
            issues.push({ id: graph.nodes[i].id, field: "cosmos.galaxy", reason: `conflicts with an earlier member's [${pin.join(", ")}]; the first in id order wins` });
          }
        }
        return pin;
      });
      issues.sort((a, b) => a.id.localeCompare(b.id) || a.field.localeCompare(b.field));
      meta.placementIssues = issues;
      if (issues.length && devMode()) {
        const list = issues.slice(0, 8).map((x) => `"${x.id}" ${x.field} ${x.reason}`).join("; ");
        console.warn(`fancy-graph cosmos: ignored ${issues.length} bad placement value(s), the procedural layout placed those instead: ${list}${issues.length > 8 ? "; ..." : ""}`);
      }

      // The procedural shape of each galaxy: a stable stream from its type id, scaled by its structure.
      const shapes = types.map((type) => {
        const m = byType.get(type)!.length;
        const L = inside.get(type) ?? 0, X = outside.get(type) ?? 0;
        const avgDeg = m > 0 ? (2 * L) / m : 0;
        const cohesion = L + X > 0 ? L / (L + X) : 0.5;
        const linkiness = Math.min(1, avgDeg / 4);
        const seed = hash01(type);
        const rand = seeded(seed);
        const [r1, r2, r3, r4, r5, r6, r7] = [rand(), rand(), rand(), rand(), rand(), rand(), rand()];
        const radius = (150 + 34 * Math.sqrt(m)) * (0.9 + 0.2 * r4);
        return {
          seed,
          rand,
          links: L,
          radius,
          arms: m < 4 ? 2 : clamp(Math.floor(2 + r1 * 2.99 + Math.min(2, avgDeg / 3)), 2, 6),
          twist: 2.4 + r2 * 1.6 + cohesion * 1.6,
          scatter: 0.2 + (1 - cohesion) * 0.25 + r3 * 0.08,
          tilt: 0.35 + r5 * 0.7,
          coreRadius: radius * (0.05 + 0.05 * linkiness + 0.02 * r6),
          warmth: clamp(0.2 + 0.55 * r7 + 0.25 * Math.min(1, Math.log10(1 + m) / 3), 0, 1),
          density: 0.6 + 0.8 * linkiness,
        };
      });

      // The home view's frame: galaxies sit in the plane facing it, the biggest free one in the middle and the rest on a ring.
      const toCamera: V = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
      const right: V = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up = cross(toCamera, right);
      meta.axis = unit(toCamera);
      const free = types.map((_, gi) => gi).filter((gi) => !pins[gi]);
      const ringCount = free.length - 1;
      const first = free.length ? shapes[free[0]].radius : 0;
      const widest = free.slice(1).reduce((w, gi) => Math.max(w, shapes[gi].radius), 0);
      const ring = ringCount > 0 ? Math.max(first + widest, ringCount > 1 ? (widest * 1.08) / Math.sin(Math.PI / ringCount) : 0) * 1.12 : 0;

      meta.galaxies = types.map((type, gi) => {
        const s = shapes[gi];
        const k = free.indexOf(gi);
        let center: V;
        if (pins[gi]) center = [...pins[gi]!];
        else {
          const a = ((k - 1) / Math.max(1, ringCount)) * Math.PI * 2 + 0.4;
          const sx = k === 0 ? 0 : Math.cos(a) * ring;
          const sy = k === 0 ? 0 : Math.sin(a) * ring * 0.92;
          const depth = k === 0 ? 0 : (k % 2 ? 0.34 : -0.34) * ring;
          center = add(add(scale(right, sx), scale(up, sy)), scale(toCamera, depth));
        }
        const normal = unit([toCamera[0] + (s.rand() - 0.5) * s.tilt, toCamera[1] + (s.rand() - 0.5) * s.tilt, toCamera[2] + (s.rand() - 0.5) * s.tilt]);
        const { u, v } = plane(normal);
        const atCentre = Math.hypot(center[0], center[1], center[2]) < 1e-6;
        return {
          type,
          center: [...center],
          normal,
          u: [...u],
          v: [...v],
          radius: s.radius,
          arms: s.arms,
          twist: s.twist,
          seed: s.seed,
          members: byType.get(type)!,
          coreRadius: s.coreRadius,
          warmth: s.warmth,
          scatter: s.scatter,
          density: s.density,
          links: s.links,
          restCenter: center,
          restU: u,
          restV: v,
          pinned: !!pins[gi],
          orbitSpeed: pins[gi] || atCentre ? 0 : galaxyOrbitSpeed,
          spinSpeed: -rimSpeed / s.radius,
        };
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
        pinned: false,
      }));

      const pinAt = (g: CosmosGalaxy, o: V): V => add(add(add(g.restCenter, scale(g.restU, o[0])), scale(g.restV, o[1])), scale(g.normal, o[2]));

      meta.galaxies.forEach((g, gi) => {
        const ranked = [...g.members].sort((x, y) => graph.degree[y] - graph.degree[x] || graph.nodes[x].id.localeCompare(graph.nodes[y].id));
        const starCount = Math.max(1, Math.ceil(ranked.length / (maxOrbiters * 0.6)));
        const stars = ranked.slice(0, starCount);
        stars.forEach((s, j) => {
          const b = bodies[s];
          b.kind = STAR;
          b.size = 8 + Math.min(15, Math.sqrt(graph.degree[s]) * 2);
          // Out on the arms, clear of the core: the core is its own body, not a star.
          const offset = placements[s].offset;
          b.pinned = !!offset;
          b.home = offset ? pinAt(g, offset) : spiralPoint(g, 0.2 + (0.8 * (j + 0.5)) / stars.length, j % g.arms, seeded(b.seed), 0.12);
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
          b.kind = graph.degree[m] > 0 ? PLANET : ASTEROID;
          b.size = b.kind === PLANET ? 3 + Math.min(6, Math.sqrt(graph.degree[m]) * 1.1) : 1.5 + rand() * 1.1;
          b.ringed = b.kind === PLANET && rand() < 0.22;
          b.parent = host;
          b.galaxy = gi;
          const offset = placements[m].offset;
          if (offset) {
            b.pinned = true;
            b.home = pinAt(g, offset);
            continue;
          }
          const slot = load.get(host)!;
          load.set(host, slot + 1);
          b.orbitRadius = bodies[host].size * 2.1 + 12 + slot * 8.5 + rand() * 3;
          b.orbitPhase = rand() * Math.PI * 2;
          b.orbitSpeed = ((rand() < 0.08 ? -1 : 1) * 9) / b.orbitRadius;
          const tilt = (rand() - 0.5) * 0.38;
          const o = plane(unit(add(g.normal, scale(g.restU, tilt))));
          b.orbitU = o.u;
          b.orbitV = o.v;
        }
      });
      meta.bodies = bodies;
      frames(0);
      for (let i = 0; i < n; i++) place(i, 0, out);
    },
    step(out, frame) {
      frames(frame.time);
      for (let i = 0; i < meta.bodies.length; i++) place(i, frame.time, out);
      return true;
    },
    clusters(): GraphCluster[] {
      return meta.galaxies.map((g) => ({
        id: g.type,
        label: g.type,
        center: [g.center[0], g.center[1], g.center[2]],
        radius: g.radius,
        members: g.members,
        normal: g.normal,
        color: options.colors?.[g.type],
        data: { arms: g.arms, twist: g.twist, seed: g.seed, coreRadius: g.coreRadius, warmth: g.warmth, pinned: g.pinned },
      }));
    },
  };
}

/** The rest-frame point `p` in its galaxy's local frame: [along u, along v, along the normal], from the core. */
export function galaxyLocal(g: CosmosGalaxy, p: Vec3): Vec3 {
  const q = sub(p, g.restCenter);
  return [dot(q, g.restU), dot(q, g.restV), dot(q, g.normal)];
}
