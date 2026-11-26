/**
 * A synthetic knowledge graph shaped like the reference view: eight entity
 * types in uneven proportions, links mostly within a type, a few hubs. Seeded,
 * so every run and every benchmark sees the same graph.
 */
import { seeded, type GraphLink, type GraphNode } from "../../src/core";

export const COSMOS_TYPES: [string, number, string][] = [
  ["agent", 255, "#38bdf8"],
  ["problem", 98, "#f87171"],
  ["post", 88, "#a78bfa"],
  ["money_pattern", 79, "#fbbf24"],
  ["solution", 51, "#34d399"],
  ["submolt", 40, "#f472b6"],
  ["concept", 9, "#22d3ee"],
  ["organization", 4, "#fb923c"],
];

export const COSMOS_COLORS: Record<string, string> = Object.fromEntries(COSMOS_TYPES.map(([t, , c]) => [t, c]));

const WORDS = ["arc", "beam", "cinder", "drift", "ember", "flux", "glint", "halo", "ion", "jet", "kite", "lumen", "mote", "nova", "orbit", "pulse", "quill", "rift", "spark", "tide", "umbra", "vane", "wisp", "zenith"];

export function cosmosData(nodeCount: number, linkCount: number, seed = 1): { nodes: GraphNode[]; links: GraphLink[] } {
  const rand = seeded(seed / 97 + 0.123);
  const total = COSMOS_TYPES.reduce((s, [, w]) => s + w, 0);
  const nodes: GraphNode[] = [];
  const byType = new Map<string, number[]>();
  let made = 0;
  COSMOS_TYPES.forEach(([type, weight], k) => {
    const count = k === COSMOS_TYPES.length - 1 ? nodeCount - made : Math.max(1, Math.round((weight / total) * nodeCount));
    for (let i = 0; i < count && made < nodeCount; i++, made++) {
      const id = `${type}-${i}`;
      const name = `${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]} ${i}`;
      nodes.push({ id, label: name, group: type });
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(nodes.length - 1);
    }
  });
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  // Preferential attachment: early nodes in a type collect most links, which makes stars.
  const pick = (list: number[]) => list[Math.floor(Math.pow(rand(), 2.2) * list.length)];
  const everyone = nodes.map((_, i) => i);
  let guard = 0;
  while (links.length < linkCount && guard++ < linkCount * 20) {
    const a = Math.floor(rand() * nodes.length);
    const sameType = rand() < 0.82;
    const pool = sameType ? byType.get(nodes[a].group!)! : everyone;
    const b = pick(pool);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: nodes[a].id, target: nodes[b].id, weight: 1 + Math.floor(rand() * 3), kind: sameType ? "co" : "mentions" });
  }
  // A few unlinked nodes stay unlinked, so asteroids exist.
  return { nodes, links };
}
