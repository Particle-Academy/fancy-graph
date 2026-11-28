import type { IndexedGraph } from "./types";

/** Node draw states. Renderers receive one of these per node, per frame. */
export const NODE_NORMAL = 0;
/** Selected, hovered, or a search match. */
export const NODE_ACTIVE = 1;
/** A neighbour of the focus (the selection, else the hover). */
export const NODE_NEIGHBOR = 2;
/** Everything else while something is focused or searched. */
export const NODE_DIMMED = 3;
export type NodeState = typeof NODE_NORMAL | typeof NODE_ACTIVE | typeof NODE_NEIGHBOR | typeof NODE_DIMMED;

export const LINK_NORMAL = 0;
/** Touches the focus. */
export const LINK_ACTIVE = 1;
export const LINK_DIMMED = 2;
export type LinkState = typeof LINK_NORMAL | typeof LINK_ACTIVE | typeof LINK_DIMMED;

export interface FocusInput {
  /** Node index, or -1 / undefined for none. */
  selected?: number;
  hovered?: number;
  matches?: ReadonlySet<number> | null;
  /** The keyboard / gamepad focus. Drawn as its own ring; drives dimming only in neighbourhood mode. */
  focused?: number;
  /** Dim everything but the focused node and its neighbours. */
  neighborhood?: boolean;
}

const idx = (v: number | undefined) => (typeof v === "number" && v >= 0 ? v : -1);

/** The node that drives neighbour highlighting: the focused node in neighbourhood mode, else the selection, else the hover. */
export function focusOf(f: FocusInput): number {
  if (f.neighborhood && idx(f.focused) >= 0) return idx(f.focused);
  const s = idx(f.selected);
  return s >= 0 ? s : idx(f.hovered);
}

export function computeNodeStates(graph: IndexedGraph, f: FocusInput, out?: Uint8Array): Uint8Array {
  const n = graph.nodes.length;
  const states = out && out.length === n ? out : new Uint8Array(n);
  const selected = idx(f.selected);
  const hovered = idx(f.hovered);
  const focus = focusOf(f);
  const matches = f.matches && f.matches.size ? f.matches : null;
  if (!matches && focus < 0) {
    states.fill(NODE_NORMAL);
    return states;
  }
  states.fill(NODE_DIMMED);
  // A view's synthetic centre (the cosmos's galaxy cores) is never someone's neighbour; a centre's own members still are.
  if (!matches) for (const j of graph.neighbors[focus] ?? []) if (graph.nodes[j]?.synthetic !== true) states[j] = NODE_NEIGHBOR;
  if (matches) for (const j of matches) if (j >= 0 && j < n) states[j] = NODE_ACTIVE;
  if (selected >= 0 && selected < n) states[selected] = NODE_ACTIVE;
  if (hovered >= 0 && hovered < n) states[hovered] = NODE_ACTIVE;
  if (f.neighborhood && focus >= 0 && focus < n) states[focus] = NODE_ACTIVE;
  return states;
}

export function computeLinkStates(graph: IndexedGraph, f: FocusInput, out?: Uint8Array): Uint8Array {
  const m = graph.links.length;
  const states = out && out.length === m ? out : new Uint8Array(m);
  const focus = focusOf(f);
  const matches = f.matches && f.matches.size ? f.matches : null;
  if (focus < 0 && !matches) {
    states.fill(LINK_NORMAL);
    return states;
  }
  states.fill(LINK_DIMMED);
  if (focus >= 0) for (const li of graph.incident[focus] ?? []) states[li] = LINK_ACTIVE;
  return states;
}

export interface SearchOptions {
  /** Most results returned. Defaults to 500. */
  limit?: number;
  /** Text searched per node. Defaults to the label, then the id. */
  text?: (index: number) => string;
}

/**
 * Case-insensitive substring search over labels and ids. Best-connected first,
 * so "Enter to fly" lands on the node most likely meant. Synthetic nodes (a
 * view's own, such as the cosmos's galaxy cores) are never results: search
 * reports the input.
 */
export function searchNodes(graph: IndexedGraph, query: string, opts: SearchOptions = {}): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = opts.limit ?? 500;
  const hits: number[] = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    if (node.synthetic === true) continue;
    const text = opts.text ? opts.text(i) : `${node.label ?? ""}\u0000${node.id}`;
    if (text.toLowerCase().includes(q)) hits.push(i);
  }
  hits.sort((a, b) => graph.degree[b] - graph.degree[a] || a - b);
  return hits.slice(0, limit);
}

export interface PickOptions {
  /** Minimum reach in px. */
  minReach: number;
  /**
   * `"depth"` (3D, default): of the nodes under the pointer, the nearest to the
   * camera wins; a node only within `minReach` (a near miss) counts only when
   * nothing is directly under it, and then the nearest on screen wins.
   * `"nearest"` (2D): nearest centre wins.
   */
  mode?: "depth" | "nearest";
}

/**
 * Picks against a projected screen buffer: 4 floats per node — x, y, radius
 * (px) and depth, where depth 0 means "not visible". Returns -1 for a miss.
 */
export function pickScreen(screen: Float32Array, x: number, y: number, opts: PickOptions): number {
  const byDepth = (opts.mode ?? "depth") === "depth";
  let best = -1;
  let bestScore = Infinity;
  // Depth mode: in a crowd, a tiny body a few px off but in front must not steal a click aimed dead at another.
  let near = -1;
  let nearD2 = Infinity;
  const n = screen.length >> 2;
  for (let i = 0; i < n; i++) {
    const depth = screen[i * 4 + 3];
    if (depth <= 0) continue;
    const dx = screen[i * 4] - x;
    const dy = screen[i * 4 + 1] - y;
    const hit = screen[i * 4 + 2] + 2;
    const reach = Math.max(opts.minReach, hit);
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    if (byDepth && d2 > hit * hit) {
      if (d2 <= nearD2) {
        nearD2 = d2;
        near = i;
      }
      continue;
    }
    const score = byDepth ? depth : d2;
    if (score <= bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? best : near;
}

export interface NeighborLink {
  /** The node at the other end. */
  id: string;
  index: number;
  link: IndexedGraph["links"][number];
  /** "out" when this node is the link's source. */
  direction: "out" | "in";
  /** Set when the link or the node at the other end is a view's own (a cosmos gravity link to a galaxy core), not the input's. */
  synthetic?: true;
}

/** Whether a link is a view's own: marked `synthetic`, or touching a synthetic node. */
export function isSyntheticLink(graph: IndexedGraph, link: IndexedGraph["links"][number]): boolean {
  return link.link.synthetic === true || graph.nodes[link.a]?.synthetic === true || graph.nodes[link.b]?.synthetic === true;
}

/**
 * A node's links in a stable order, each with the node at the other end: the
 * input's links first, in input order, then any synthetic ones (a cosmos
 * gravity link to its galaxy core), marked `synthetic: true`. Those are kept,
 * last and flagged, so a consumer sees every link; `next` / `previous` focus
 * stepping skips them (see `stepLinks`).
 */
export function neighborLinks(graph: IndexedGraph, index: number): NeighborLink[] {
  const real: NeighborLink[] = [];
  const made: NeighborLink[] = [];
  for (const li of graph.incident[index] ?? []) {
    const l = graph.links[li];
    const other = l.a === index ? l.b : l.a;
    const entry: NeighborLink = { id: graph.nodes[other].id, index: other, link: l, direction: l.a === index ? "out" : "in" };
    if (isSyntheticLink(graph, l)) made.push({ ...entry, synthetic: true });
    else real.push(entry);
  }
  return made.length ? real.concat(made) : real;
}

/** A node's neighbours that are input nodes (no synthetic centre): the ones labelled and highlighted with it. */
export function inputNeighbors(graph: IndexedGraph, index: number): number[] {
  const all = graph.neighbors[index] ?? [];
  return all.some((j) => graph.nodes[j]?.synthetic === true) ? all.filter((j) => graph.nodes[j]?.synthetic !== true) : all;
}

export type ScreenDirection = "up" | "down" | "left" | "right";
export type StepDirection = ScreenDirection | "next" | "previous";

const DIRS: Record<ScreenDirection, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * The linked node to move to from a node in a screen direction, using a
 * projected screen buffer (4 floats per node, depth 0 = hidden). Candidates
 * must lie within 60 degrees of the direction; the nearest, weighted toward
 * the straightest, wins. -1 when there is none.
 */
export function stepInDirection(graph: IndexedGraph, from: number, dir: ScreenDirection, screen: Float32Array): number {
  const [ux, uy] = DIRS[dir];
  const fx = screen[from * 4], fy = screen[from * 4 + 1];
  let best = -1;
  let bestScore = Infinity;
  // Input neighbours first; a synthetic centre only when no input neighbour lies that way.
  let synthetic = false;
  for (const j of graph.neighbors[from] ?? []) {
    if (screen[j * 4 + 3] <= 0) continue;
    const s = graph.nodes[j]?.synthetic === true;
    if (s && !synthetic && best >= 0) continue;
    const dx = screen[j * 4] - fx, dy = screen[j * 4 + 1] - fy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const cos = (dx * ux + dy * uy) / d;
    if (cos < 0.5) continue;
    const score = d * (1 + 2 * (1 - cos));
    const promote = synthetic && !s;
    if (promote || score < bestScore || (score === bestScore && j < best)) {
      bestScore = score;
      best = j;
      synthetic = s;
    }
  }
  return best;
}

/**
 * The links `next` / `previous` focus stepping walks from an anchor: a real
 * node's input links only, never a synthetic one (a cosmos core stays
 * reachable by click, breadcrumbs or a direct focus). A synthetic anchor (a
 * core) walks all of its links, which are its members.
 */
export function stepLinks(graph: IndexedGraph, anchor: number): NeighborLink[] {
  const links = neighborLinks(graph, anchor);
  return graph.nodes[anchor]?.synthetic === true ? links : links.filter((l) => l.synthetic !== true);
}

/** The next (delta 1) or previous (-1) of an anchor's `stepLinks` after position (-1 = none yet). */
export function cycleNeighbor(graph: IndexedGraph, anchor: number, position: number, delta: 1 | -1): { position: number; index: number } | null {
  const links = stepLinks(graph, anchor);
  if (!links.length) return null;
  const p = position < 0 ? (delta > 0 ? 0 : links.length - 1) : (((position + delta) % links.length) + links.length) % links.length;
  return { position: p, index: links[p].index };
}

/**
 * Whether a node wears the selection / hover ring. Selection, hover and search
 * matches do; the focus alone never does (it has its own dashed ring), even in
 * neighbourhood mode where its state is ACTIVE.
 */
export function hasHighlightRing(index: number, f: FocusInput): boolean {
  return index >= 0 && (index === f.selected || index === f.hovered || !!f.matches?.has(index));
}
