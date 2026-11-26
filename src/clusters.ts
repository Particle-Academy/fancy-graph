import type { GraphCluster, IndexedGraph } from "./types";

/**
 * Clusters by a key per node (the group, by default): centre is the members'
 * median position, radius reaches `coverage` of the members (85% by default, so
 * one far outlier cannot inflate the hull) plus `padding`. Cheap enough to
 * recompute every frame for moving layouts.
 */
export function groupClusters(graph: IndexedGraph, positions: Float32Array, key: (index: number) => string | undefined = (i) => graph.nodes[i].group, padding = 12, coverage = 0.85): GraphCluster[] {
  const members = new Map<string, number[]>();
  for (let i = 0; i < graph.nodes.length; i++) {
    const k = key(i);
    if (k === undefined || k === "") continue;
    const list = members.get(k);
    if (list) list.push(i);
    else members.set(k, [i]);
  }
  const out: GraphCluster[] = [];
  for (const [id, list] of members) {
    // Per-axis median: a far outlier moves neither the centre nor (below) the radius.
    const median = (axis: number) => {
      const v = list.map((i) => positions[i * 3 + axis]).sort((a, b) => a - b);
      const m = v.length >> 1;
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const cx = median(0), cy = median(1), cz = median(2);
    const d = list.map((i) => Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz)).sort((a, b) => a - b);
    const r = d[Math.min(d.length - 1, Math.floor(Math.max(0, Math.min(1, coverage)) * (d.length - 1)))] ?? 0;
    out.push({ id, label: id, center: [cx, cy, cz], radius: r + padding, members: list });
  }
  return out;
}
