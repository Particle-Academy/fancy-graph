import { describe, expect, it } from "vitest";
import {
  computeLinkStates,
  computeNodeStates,
  cycleNeighbor,
  hasHighlightRing,
  labelCandidates,
  neighborLinks,
  placeLabels,
  stepInDirection,
  LINK_ACTIVE,
  LINK_DIMMED,
  LINK_NORMAL,
  NODE_ACTIVE,
  NODE_DIMMED,
  NODE_NEIGHBOR,
  NODE_NORMAL,
  normalizeGraph,
  pickScreen,
  searchNodes,
} from "../src/core";

// a - b - c, d alone, and a heavily linked hub e with b and c.
const g = normalizeGraph({
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }, { id: "d", label: "Delta" }, { id: "e", label: "alphabet hub" }],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "e", target: "b" }, { source: "e", target: "c" }, { source: "e", target: "a" }],
});

describe("node and link states", () => {
  it("is all normal with nothing selected, hovered or matched", () => {
    expect([...computeNodeStates(g, {})]).toEqual([0, 0, 0, 0, 0].map(() => NODE_NORMAL));
    expect([...computeLinkStates(g, {})].every((s) => s === LINK_NORMAL)).toBe(true);
  });

  it("highlights the focus and its neighbours and dims the rest", () => {
    const s = computeNodeStates(g, { selected: 0 });
    expect(s[0]).toBe(NODE_ACTIVE);
    expect(s[1]).toBe(NODE_NEIGHBOR);
    expect(s[4]).toBe(NODE_NEIGHBOR);
    expect(s[2]).toBe(NODE_DIMMED);
    expect(s[3]).toBe(NODE_DIMMED);
    const l = computeLinkStates(g, { selected: 0 });
    expect(l[0]).toBe(LINK_ACTIVE); // a-b
    expect(l[1]).toBe(LINK_DIMMED); // b-c
  });

  it("prefers the selection over the hover as the focus, but marks both active", () => {
    const s = computeNodeStates(g, { selected: 3, hovered: 0 });
    expect(s[3]).toBe(NODE_ACTIVE);
    expect(s[0]).toBe(NODE_ACTIVE);
    expect(s[1]).toBe(NODE_DIMMED);
  });

  it("marks search matches active and dims everything else", () => {
    const s = computeNodeStates(g, { matches: new Set([2]) });
    expect([...s]).toEqual([NODE_DIMMED, NODE_DIMMED, NODE_ACTIVE, NODE_DIMMED, NODE_DIMMED]);
  });
});

describe("searchNodes", () => {
  it("matches labels case-insensitively, best connected first, within the limit", () => {
    expect(searchNodes(g, "ALPHA").map((i) => g.nodes[i].id)).toEqual(["e", "a"]);
    expect(searchNodes(g, "alpha", { limit: 1 }).map((i) => g.nodes[i].id)).toEqual(["e"]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchNodes(g, "   ")).toEqual([]);
  });

  it("matches ids too", () => {
    expect(searchNodes(g, "d").map((i) => g.nodes[i].id)).toContain("d");
  });
});

describe("pickScreen", () => {
  // x, y, radius, depth (0 = not visible)
  const screen = new Float32Array([10, 10, 5, 100, 12, 10, 5, 50, 200, 200, 3, 0]);
  it("picks the nearest-depth node within reach", () => {
    expect(pickScreen(screen, 11, 10, { minReach: 4 })).toBe(1);
  });
  it("never picks an invisible node", () => {
    expect(pickScreen(screen, 200, 200, { minReach: 4 })).toBe(-1);
  });
  it("uses the minimum reach for tiny nodes", () => {
    const tiny = new Float32Array([50, 50, 0.5, 1]);
    expect(pickScreen(tiny, 56, 50, { minReach: 7 })).toBe(0);
    expect(pickScreen(tiny, 60, 50, { minReach: 7 })).toBe(-1);
  });
  it("picks the closer centre in 2D mode, ignoring depth", () => {
    const flat = new Float32Array([10, 10, 6, 1, 14, 10, 6, 1]);
    expect(pickScreen(flat, 13, 10, { minReach: 4, mode: "nearest" })).toBe(1);
  });
});

describe("gamepad navigation", () => {
  // Screen layout: a (0,0)  b (100,0)  c (200,0); d above b, e below b. Screen y grows downward.
  const screen = new Float32Array([0, 0, 5, 1, 100, 0, 5, 1, 200, 0, 5, 1, 100, -100, 5, 1, 100, 100, 5, 1]);

  it("lists a node's links in a stable order: input link order", () => {
    expect(neighborLinks(g, 1).map((n) => [n.id, n.direction])).toEqual([["a", "in"], ["c", "out"], ["e", "in"]]);
    expect(neighborLinks(g, 3)).toEqual([]);
  });

  it("steps to the nearest linked node in a screen direction", () => {
    expect(stepInDirection(g, 1, "left", screen)).toBe(0);
    expect(stepInDirection(g, 1, "right", screen)).toBe(2);
    expect(stepInDirection(g, 1, "down", screen)).toBe(4);
    // d is above b but not linked to it.
    expect(stepInDirection(g, 1, "up", screen)).toBe(-1);
  });

  it("ignores neighbours that are off screen or behind the camera", () => {
    const hidden = Float32Array.from(screen);
    hidden[0 * 4 + 3] = 0;
    expect(stepInDirection(g, 1, "left", hidden)).toBe(-1);
  });

  it("cycles through an anchor's links, both ways, wrapping", () => {
    expect(cycleNeighbor(g, 1, -1, 1)).toEqual({ position: 0, index: 0 });
    expect(cycleNeighbor(g, 1, 0, 1)).toEqual({ position: 1, index: 2 });
    expect(cycleNeighbor(g, 1, 2, 1)).toEqual({ position: 0, index: 0 });
    expect(cycleNeighbor(g, 1, 0, -1)).toEqual({ position: 2, index: 4 });
    expect(cycleNeighbor(g, 3, -1, 1)).toBeNull();
  });

  it("neighbourhood mode dims everything but the focused node and its neighbours", () => {
    const s = computeNodeStates(g, { focused: 0, neighborhood: true });
    expect([...s]).toEqual([NODE_ACTIVE, NODE_NEIGHBOR, NODE_DIMMED, NODE_DIMMED, NODE_NEIGHBOR]);
    expect([...computeNodeStates(g, { focused: 0 })].every((v) => v === NODE_NORMAL)).toBe(true);
  });

  it("always labels the focused node and its neighbours, and culls the rest in neighbourhood mode", () => {
    const big = new Float32Array([10, 10, 20, 1, 200, 10, 20, 1, 400, 10, 20, 1, 600, 10, 20, 1, 800, 10, 20, 1]);
    const states = computeNodeStates(g, { focused: 0, neighborhood: true });
    const base = { screen: big, states, selected: -1, hovered: -1, matches: null, width: 1000, height: 600, labelMinPx: 3, text: (i: number) => g.nodes[i].id, focused: 0, focusNeighbors: g.neighbors[0] };
    const forced = labelCandidates({ ...base, cullOthers: true });
    expect(forced.map((c) => c.index).sort()).toEqual([0, 1, 4]);
    expect(forced.every((c) => c.forced)).toBe(true);
    const all = labelCandidates({ ...base, cullOthers: false, states: computeNodeStates(g, { focused: 0 }) });
    expect(all.map((c) => c.index).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the selection ring for selection, hover and matches, never for focus alone", () => {
    expect(hasHighlightRing(0, { focused: 0, neighborhood: true })).toBe(false);
    expect(hasHighlightRing(0, { focused: 0, selected: 0 })).toBe(true);
    expect(hasHighlightRing(2, { hovered: 2 })).toBe(true);
    expect(hasHighlightRing(3, { matches: new Set([3]) })).toBe(true);
    expect(hasHighlightRing(1, {})).toBe(false);
  });

  it("places forced labels beyond maxLabels, up to maxForced", () => {
    const c = (index: number, forced: boolean) => ({ index, x: index * 100, y: 10, radius: 4, text: "x", priority: forced ? 1e6 : 1, forced });
    const placed = placeLabels([c(0, true), c(1, true), c(2, true), c(3, false)], { maxLabels: 1, maxForced: 2, width: 1000, height: 100 });
    expect(placed.map((p) => p.index)).toEqual([0, 1]);
  });
});
