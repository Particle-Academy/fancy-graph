import type { GraphCluster, IndexedGraph } from "./types";

/**
 * Clusters by a key per node (the group, by default): centre is the members'
 * mean position, radius reaches the farthest member plus `padding`. O(n), so
 * it can be recomputed every frame for moving layouts.
 */
export function groupClusters(graph: IndexedGraph, positions: Float32Array, key: (index: number) => string | undefined = (i) => graph.nodes[i].group, padding = 12): GraphCluster[] {
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
    let cx = 0, cy = 0, cz = 0;
    for (const i of list) {
      cx += positions[i * 3];
      cy += positions[i * 3 + 1];
      cz += positions[i * 3 + 2];
    }
    cx /= list.length;
    cy /= list.length;
    cz /= list.length;
    let r = 0;
    for (const i of list) r = Math.max(r, Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz));
    out.push({ id, label: id, center: [cx, cy, cz], radius: r + padding, members: list });
  }
  return out;
}
