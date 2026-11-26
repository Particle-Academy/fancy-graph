import { seeded } from "../random";
import type { IndexedGraph } from "../types";
import { BarnesHutTree } from "./barnes-hut";
import type { GraphLayoutStepper, LayoutEnv } from "./contract";

export interface ForceLayoutOptions {
  /** Many-body strength; negative repels. Default -30. */
  charge?: number;
  /** Rest length of a link. Default 30. */
  linkDistance?: number;
  /** Multiplier on the per-link strength (1 / the smaller endpoint's link count). Default 1. */
  linkStrength?: number;
  /** Barnes-Hut accuracy: 0 is exact, larger is faster. Default 0.9. */
  theta?: number;
  /** Ticks until the layout settles. Default 300. */
  iterations?: number;
  /** Fraction of velocity lost per tick. Default 0.4. */
  velocityDecay?: number;
  /** Keep the centre of mass at the origin. Default true. */
  center?: boolean;
  /** Ticks per frame. Default 1. */
  ticksPerFrame?: number;
  /** Seed for the starting arrangement and for separating coincident nodes. Default 1. */
  seed?: number;
  /** Force 2 or 3 dimensions regardless of the view. */
  dimensions?: 2 | 3;
  /** Pull toward the centre of the node's group, so groups form visible clusters. 0 (default) is off; 0.1 to 0.3 is typical. */
  groupPull?: number;
  /** The group key per node. Defaults to `node.group`. */
  groupOf?: (index: number, graph: IndexedGraph) => string | undefined;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * A force-directed layout (velocity Verlet with alpha cooling, the model d3-force
 * popularised), written by hand: Barnes-Hut repulsion, link springs and
 * centring, in 2D or 3D.
 */
export function forceLayout(options: ForceLayoutOptions = {}): GraphLayoutStepper & { readonly alpha: number; reheat(alpha?: number): void } {
  const o = {
    charge: options.charge ?? -30,
    linkDistance: options.linkDistance ?? 30,
    linkStrength: options.linkStrength ?? 1,
    theta: options.theta ?? 0.9,
    iterations: Math.max(1, options.iterations ?? 300),
    velocityDecay: options.velocityDecay ?? 0.4,
    center: options.center ?? true,
    ticksPerFrame: Math.max(1, Math.floor(options.ticksPerFrame ?? 1)),
    seed: options.seed ?? 1,
    groupPull: Math.max(0, options.groupPull ?? 0),
  };
  const alphaMin = 0.001;
  const alphaDecay = 1 - Math.pow(alphaMin, 1 / o.iterations);
  let graph: IndexedGraph;
  let dims: 2 | 3 = 2;
  let n = 0;
  let v = new Float64Array(0);
  let pinned = new Uint8Array(0);
  let count = new Float64Array(0);
  let tree: BarnesHutTree;
  let alpha = 1;
  let ticks = 0;
  let groupIdx = new Int32Array(0);
  let groupCount = 0;
  let groupSum = new Float64Array(0);
  let rand = seeded(o.seed);
  const jiggle = () => (rand() - 0.5) * 1e-6;

  function tick(p: Float32Array) {
    alpha += (0 - alpha) * alphaDecay;
    ticks++;

    // Links.
    for (const l of graph.links) {
      const a = l.a, b = l.b;
      let x = p[b * 3] + v[b * 3] - p[a * 3] - v[a * 3] || jiggle();
      let y = p[b * 3 + 1] + v[b * 3 + 1] - p[a * 3 + 1] - v[a * 3 + 1] || jiggle();
      let z = dims === 3 ? p[b * 3 + 2] + v[b * 3 + 2] - p[a * 3 + 2] - v[a * 3 + 2] || jiggle() : 0;
      let len = Math.sqrt(x * x + y * y + z * z);
      const strength = (o.linkStrength / Math.min(count[a], count[b])) * alpha;
      len = ((len - o.linkDistance) / len) * strength;
      x *= len;
      y *= len;
      z *= len;
      const bias = count[a] / (count[a] + count[b]);
      v[b * 3] -= x * bias;
      v[b * 3 + 1] -= y * bias;
      v[b * 3 + 2] -= z * bias;
      v[a * 3] += x * (1 - bias);
      v[a * 3 + 1] += y * (1 - bias);
      v[a * 3 + 2] += z * (1 - bias);
    }

    // Many-body, Barnes-Hut.
    tree.build(p, n);
    const theta2 = o.theta * o.theta;
    const k = tree.arity;
    const stack = new Int32Array(Math.max(64, tree.count));
    for (let i = 0; i < n; i++) {
      const px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
      let fx = 0, fy = 0, fz = 0;
      let sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const c = stack[--sp];
        const m = tree.mass[c];
        if (m === 0) continue;
        if (tree.leaf[c]) {
          for (let b = tree.body[c]; b >= 0; b = tree.next[b]) {
            if (b === i) continue;
            let dx = p[b * 3] - px, dy = p[b * 3 + 1] - py, dz = dims === 3 ? p[b * 3 + 2] - pz : 0;
            let d2 = dx * dx + dy * dy + dz * dz;
            if (d2 === 0) {
              dx = jiggle();
              dy = jiggle();
              if (dims === 3) dz = jiggle();
              d2 = dx * dx + dy * dy + dz * dz;
            }
            if (d2 < 1) d2 = Math.sqrt(d2);
            const f = (o.charge * alpha) / d2;
            fx += dx * f;
            fy += dy * f;
            fz += dz * f;
          }
          continue;
        }
        const dx = tree.mx[c] / m - px, dy = tree.my[c] / m - py, dz = dims === 3 ? tree.mz[c] / m - pz : 0;
        let d2 = dx * dx + dy * dy + dz * dz;
        const w = tree.half[c] * 2;
        if (d2 > 0 && (w * w) / d2 < theta2) {
          if (d2 < 1) d2 = Math.sqrt(d2);
          const f = (o.charge * alpha * m) / d2;
          fx += dx * f;
          fy += dy * f;
          fz += dz * f;
          continue;
        }
        if (sp + k > stack.length) continue;
        for (let q = 0; q < k; q++) {
          const ch = tree.child[c * k + q];
          if (ch >= 0) stack[sp++] = ch;
        }
      }
      v[i * 3] += fx;
      v[i * 3 + 1] += fy;
      v[i * 3 + 2] += fz;
    }

    // Group pull: toward the group's centroid.
    if (o.groupPull > 0 && groupCount) {
      groupSum.fill(0);
      for (let i = 0; i < n; i++) {
        const k = groupIdx[i];
        if (k < 0) continue;
        groupSum[k * 4] += p[i * 3];
        groupSum[k * 4 + 1] += p[i * 3 + 1];
        groupSum[k * 4 + 2] += p[i * 3 + 2];
        groupSum[k * 4 + 3]++;
      }
      const s = o.groupPull * alpha;
      for (let i = 0; i < n; i++) {
        const k = groupIdx[i];
        if (k < 0 || groupSum[k * 4 + 3] < 2) continue;
        const c = groupSum[k * 4 + 3];
        v[i * 3] += (groupSum[k * 4] / c - p[i * 3]) * s;
        v[i * 3 + 1] += (groupSum[k * 4 + 1] / c - p[i * 3 + 1]) * s;
        if (dims === 3) v[i * 3 + 2] += (groupSum[k * 4 + 2] / c - p[i * 3 + 2]) * s;
      }
    }

    // Integrate.
    for (let i = 0; i < n; i++) {
      if (pinned[i]) {
        v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
        continue;
      }
      for (let d = 0; d < 3; d++) {
        v[i * 3 + d] *= 1 - o.velocityDecay;
        p[i * 3 + d] += v[i * 3 + d];
      }
      if (dims === 2) p[i * 3 + 2] = 0;
    }

    if (o.center && n) {
      let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < n; i++) {
        sx += p[i * 3];
        sy += p[i * 3 + 1];
        sz += p[i * 3 + 2];
      }
      sx /= n;
      sy /= n;
      sz = dims === 3 ? sz / n : 0;
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        p[i * 3] -= sx;
        p[i * 3 + 1] -= sy;
        p[i * 3 + 2] -= sz;
      }
    }
  }

  const layout = {
    name: "force",
    get alpha() {
      return alpha;
    },
    reheat(a = 1) {
      alpha = a;
      ticks = 0;
    },
    init(g: IndexedGraph, p: Float32Array, env: LayoutEnv) {
      graph = g;
      dims = options.dimensions ?? env.dimensions;
      n = g.nodes.length;
      v = new Float64Array(n * 3);
      pinned = new Uint8Array(n);
      count = new Float64Array(n);
      for (const l of g.links) {
        count[l.a]++;
        count[l.b]++;
      }
      tree = new BarnesHutTree(dims);
      const keys = new Map<string, number>();
      groupIdx = new Int32Array(n).fill(-1);
      if (o.groupPull > 0)
        for (let i = 0; i < n; i++) {
          const k = options.groupOf ? options.groupOf(i, g) : g.nodes[i].group;
          if (k === undefined || k === "") continue;
          if (!keys.has(k)) keys.set(k, keys.size);
          groupIdx[i] = keys.get(k)!;
        }
      groupCount = keys.size;
      groupSum = new Float64Array(groupCount * 4);
      alpha = 1;
      ticks = 0;
      rand = seeded(o.seed);
      const spin = rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const node = g.nodes[i];
        pinned[i] = node.fixed ? 1 : 0;
        if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
          p[i * 3] = node.x!;
          p[i * 3 + 1] = node.y!;
          p[i * 3 + 2] = dims === 3 && Number.isFinite(node.z) ? node.z! : 0;
          continue;
        }
        if (dims === 2) {
          const r = 10 * Math.sqrt(0.5 + i);
          const a = i * GOLDEN + spin;
          p[i * 3] = r * Math.cos(a);
          p[i * 3 + 1] = r * Math.sin(a);
          p[i * 3 + 2] = 0;
        } else {
          const r = 10 * Math.cbrt(0.5 + i);
          const y = 1 - (2 * (i + 0.5)) / Math.max(1, n);
          const ring = Math.sqrt(Math.max(0, 1 - y * y));
          const a = i * GOLDEN + spin;
          p[i * 3] = r * ring * Math.cos(a);
          p[i * 3 + 1] = r * y;
          p[i * 3 + 2] = r * ring * Math.sin(a);
        }
      }
    },
    step(p: Float32Array) {
      if (alpha < alphaMin || ticks >= o.iterations) return false;
      for (let t = 0; t < o.ticksPerFrame && ticks < o.iterations; t++) tick(p);
      return alpha >= alphaMin && ticks < o.iterations;
    },
  };
  return layout;
}
