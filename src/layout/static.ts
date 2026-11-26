import type { IndexedGraph } from "../types";
import type { GraphLayoutFunction } from "./contract";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function bestConnected(g: IndexedGraph): number {
  let best = 0;
  for (let i = 1; i < g.nodes.length; i++) if (g.degree[i] > g.degree[best]) best = i;
  return best;
}

export interface RadialLayoutOptions {
  /** Id of the centre node. Defaults to the best-connected node. */
  root?: string;
  /** Distance between rings. Default 80. */
  ringGap?: number;
}

/**
 * Rings by distance from a root (breadth-first). Each subtree gets an angular
 * wedge proportional to its size, so branches stay together. Nodes unreachable
 * from the root sit on one more ring outside. In 3D the rings are spherical
 * shells and each depth is spread over its shell.
 */
export function radialLayout(options: RadialLayoutOptions = {}): GraphLayoutFunction {
  const gap = options.ringGap ?? 80;
  return (g, p, env) => {
    const n = g.nodes.length;
    if (!n) return;
    const root = options.root !== undefined && g.index.has(options.root) ? g.index.get(options.root)! : bestConnected(g);
    const depth = new Int32Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1);
    const order: number[] = [root];
    depth[root] = 0;
    for (let h = 0; h < order.length; h++) {
      const u = order[h];
      const next = [...g.neighbors[u]].sort((a, b) => a - b);
      for (const w of next)
        if (depth[w] < 0) {
          depth[w] = depth[u] + 1;
          parent[w] = u;
          order.push(w);
        }
    }
    let maxDepth = 0;
    for (const u of order) maxDepth = Math.max(maxDepth, depth[u]);
    const outer: number[] = [];
    for (let i = 0; i < n; i++) if (depth[i] < 0) outer.push(i);

    if (env.dimensions === 3) {
      const byDepth = new Map<number, number[]>();
      for (const u of order) byDepth.set(depth[u], [...(byDepth.get(depth[u]) ?? []), u]);
      if (outer.length) byDepth.set(maxDepth + 1, outer);
      for (const [d, list] of byDepth) {
        const r = d * gap;
        list.forEach((u, k) => {
          if (d === 0) {
            p.set([0, 0, 0], u * 3);
            return;
          }
          const y = 1 - (2 * (k + 0.5)) / list.length;
          const ring = Math.sqrt(Math.max(0, 1 - y * y));
          const a = k * GOLDEN;
          p[u * 3] = r * ring * Math.cos(a);
          p[u * 3 + 1] = r * y;
          p[u * 3 + 2] = r * ring * Math.sin(a);
        });
      }
      return;
    }

    // Subtree sizes, leaves first.
    const children: number[][] = Array.from({ length: n }, () => []);
    for (const u of order) if (parent[u] >= 0) children[parent[u]].push(u);
    const size = new Float64Array(n);
    for (let h = order.length - 1; h >= 0; h--) {
      const u = order[h];
      size[u] = 1 + children[u].reduce((s, c) => s + size[c], 0);
    }
    const start = new Float64Array(n);
    const span = new Float64Array(n);
    span[root] = Math.PI * 2;
    for (const u of order) {
      let a = start[u];
      for (const c of children[u]) {
        start[c] = a;
        span[c] = (span[u] * size[c]) / Math.max(1, size[u] - 1);
        a += span[c];
      }
      const r = depth[u] * gap;
      const mid = start[u] + span[u] / 2;
      p[u * 3] = u === root ? 0 : r * Math.cos(mid);
      p[u * 3 + 1] = u === root ? 0 : r * Math.sin(mid);
      p[u * 3 + 2] = 0;
    }
    const r = (maxDepth + 1) * gap;
    outer.forEach((u, k) => {
      const a = (k / outer.length) * Math.PI * 2;
      p[u * 3] = r * Math.cos(a);
      p[u * 3 + 1] = r * Math.sin(a);
      p[u * 3 + 2] = 0;
    });
  };
}

export interface HierarchyLayoutOptions {
  /** `"down"` (default): roots on top. `"right"`: roots on the left. */
  direction?: "down" | "right";
  /** Distance between layers. Default 80. */
  layerGap?: number;
  /** Minimum distance between neighbours in a layer. Default 40. */
  nodeGap?: number;
  /** Barycentre sweeps to reduce crossings. Default 4. */
  sweeps?: number;
}

/**
 * Layered (Sugiyama-style) placement for directed graphs: links point
 * source → target. Roots are nodes nothing points at (or, in a cycle, the
 * best-connected node); a node's layer is its breadth-first depth from the
 * roots, so cycles cannot loop. Each layer is then ordered by the mean position
 * of its parents to keep children under them, and spaced by `nodeGap`.
 */
export function hierarchyLayout(options: HierarchyLayoutOptions = {}): GraphLayoutFunction {
  const layerGap = options.layerGap ?? 80;
  const nodeGap = options.nodeGap ?? 40;
  const sweeps = options.sweeps ?? 4;
  const right = options.direction === "right";
  return (g, p) => {
    const n = g.nodes.length;
    if (!n) return;
    const out: number[][] = Array.from({ length: n }, () => []);
    const indeg = new Int32Array(n);
    for (const l of g.links) {
      out[l.a].push(l.b);
      indeg[l.b]++;
    }
    const layer = new Int32Array(n).fill(-1);
    const queue: number[] = [];
    const seed = (i: number) => {
      layer[i] = 0;
      queue.push(i);
    };
    for (let i = 0; i < n; i++) if (indeg[i] === 0) seed(i);
    for (;;) {
      for (let h = 0; h < queue.length; h++) {
        const u = queue[h];
        for (const w of out[u])
          if (layer[w] < 0) {
            layer[w] = layer[u] + 1;
            queue.push(w);
          }
      }
      // Anything left is in a cycle with no entry: start from its best-connected node.
      let rest = -1;
      for (let i = 0; i < n; i++) if (layer[i] < 0 && (rest < 0 || g.degree[i] > g.degree[rest])) rest = i;
      if (rest < 0) break;
      seed(rest);
    }

    const layers: number[][] = [];
    for (const u of queue) (layers[layer[u]] ??= []).push(u);
    const pos = new Float64Array(n);
    for (const list of layers) list.forEach((u, k) => (pos[u] = k));
    const parents: number[][] = Array.from({ length: n }, () => []);
    for (const l of g.links) if (layer[l.a] < layer[l.b]) parents[l.b].push(l.a);
    for (let s = 0; s < sweeps; s++)
      for (let d = 1; d < layers.length; d++) {
        const list = layers[d];
        const bary = new Map<number, number>();
        for (const u of list) bary.set(u, parents[u].length ? parents[u].reduce((a, q) => a + pos[q], 0) / parents[u].length : pos[u]);
        list.sort((a, b) => bary.get(a)! - bary.get(b)! || a - b);
        list.forEach((u, k) => (pos[u] = k));
      }

    for (let d = 0; d < layers.length; d++) {
      const list = layers[d];
      const width = (list.length - 1) * nodeGap;
      list.forEach((u, k) => {
        const along = k * nodeGap - width / 2;
        const across = d * layerGap;
        p[u * 3] = right ? across : along;
        p[u * 3 + 1] = right ? along : across;
        p[u * 3 + 2] = 0;
      });
    }
  };
}
