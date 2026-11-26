import { resolveLimits, type GraphLimits } from "./limits";
import type { GraphData, GraphNode, IndexedGraph, IndexedLink } from "./types";

/**
 * Validates plain JSON into an indexed graph. Input is never trusted: ids must
 * be strings, weights must be finite, links must join two different existing
 * nodes, and both counts are capped by `limits`.
 */
export function normalizeGraph(data: GraphData, limitOverrides?: Partial<GraphLimits>): IndexedGraph {
  const limits = resolveLimits(limitOverrides);
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  let duplicateNodes = 0;
  let overNodes = 0;
  for (const n of Array.isArray(data?.nodes) ? data.nodes : []) {
    if (!n || typeof n.id !== "string") continue;
    if (index.has(n.id)) {
      duplicateNodes++;
      continue;
    }
    if (nodes.length >= limits.maxNodes) {
      overNodes++;
      continue;
    }
    index.set(n.id, nodes.length);
    nodes.push(n);
  }

  let invalidLinks = 0;
  const valid: IndexedLink[] = [];
  for (const l of Array.isArray(data?.links) ? data.links : []) {
    const a = l && typeof l.source === "string" ? index.get(l.source) : undefined;
    const b = l && typeof l.target === "string" ? index.get(l.target) : undefined;
    if (a === undefined || b === undefined || a === b) {
      invalidLinks++;
      continue;
    }
    const w = typeof l.weight === "number" && Number.isFinite(l.weight) && l.weight > 0 ? l.weight : 1;
    valid.push({ index: valid.length, a, b, weight: w, link: l });
  }

  let links = valid;
  if (valid.length > limits.maxLinks) {
    // Strongest first; Array.prototype.sort is stable, so ties keep input order.
    links = [...valid].sort((x, y) => y.weight - x.weight).slice(0, limits.maxLinks);
    links.forEach((l, i) => (l.index = i));
  }

  const n = nodes.length;
  const degree = new Float64Array(n);
  const neighborSets: Set<number>[] = Array.from({ length: n }, () => new Set());
  const incident: number[][] = Array.from({ length: n }, () => []);
  for (const l of links) {
    degree[l.a] += l.weight;
    degree[l.b] += l.weight;
    neighborSets[l.a].add(l.b);
    neighborSets[l.b].add(l.a);
    incident[l.a].push(l.index);
    incident[l.b].push(l.index);
  }

  return {
    nodes,
    links,
    index,
    degree,
    neighbors: neighborSets.map((s) => [...s]),
    incident,
    dropped: { nodes: overNodes, links: valid.length - links.length, invalidLinks, duplicateNodes },
  };
}
