import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, normalizeGraph, resolveLimits, truncateLabel } from "../src/core";

const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));

describe("normalizeGraph", () => {
  it("indexes nodes and resolves links to indices", () => {
    const g = normalizeGraph({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], links: [{ source: "a", target: "b" }, { source: "b", target: "c", weight: 2 }] });
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(g.index.get("c")).toBe(2);
    expect(g.links.map((l) => [l.a, l.b, l.weight])).toEqual([[0, 1, 1], [1, 2, 2]]);
    expect([...g.degree]).toEqual([1, 3, 2]);
    expect(g.neighbors[1].sort()).toEqual([0, 2]);
  });

  it("drops links to missing nodes and self-links, and counts them", () => {
    const g = normalizeGraph({ nodes: [{ id: "a" }, { id: "b" }], links: [{ source: "a", target: "gone" }, { source: "a", target: "a" }, { source: "a", target: "b" }] });
    expect(g.links).toHaveLength(1);
    expect(g.dropped.invalidLinks).toBe(2);
  });

  it("keeps the first of duplicate node ids", () => {
    const g = normalizeGraph({ nodes: [{ id: "a", label: "first" }, { id: "a", label: "second" }], links: [] });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].label).toBe("first");
    expect(g.dropped.duplicateNodes).toBe(1);
  });

  it("caps nodes and links at the configured limits, keeping the strongest links", () => {
    const links = [];
    for (let i = 0; i < 36; i++) links.push({ source: "n0", target: `n${i + 1}`, weight: i === 7 ? 99 : 1 });
    const g = normalizeGraph({ nodes: nodes(40), links }, { maxNodes: 35, maxLinks: 10 });
    expect(g.nodes).toHaveLength(35);
    expect(g.dropped.nodes).toBe(5);
    expect(g.links).toHaveLength(10);
    expect(g.links[0].weight).toBe(99);
    // Links to capped-away nodes are invalid, not "over the link cap".
    expect(g.dropped.invalidLinks).toBe(2);
    expect(g.dropped.links).toBe(36 - 2 - 10);
  });

  it("refuses non-string ids and non-finite weights instead of trusting input", () => {
    const g = normalizeGraph({
      nodes: [{ id: "a" }, { id: 5 as unknown as string }, { id: "b" }],
      links: [{ source: "a", target: "b", weight: Number.NaN }],
    });
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(g.links[0].weight).toBe(1);
  });

  it("handles an empty graph", () => {
    const g = normalizeGraph({ nodes: [], links: [] });
    expect(g.nodes).toEqual([]);
    expect(g.links).toEqual([]);
  });
});

describe("limits", () => {
  it("merges overrides onto the defaults, and every default is a finite positive number", () => {
    for (const [k, v] of Object.entries(DEFAULT_LIMITS)) expect(Number.isFinite(v) && v > 0, k).toBe(true);
    const l = resolveLimits({ maxLabels: 3 });
    expect(l.maxLabels).toBe(3);
    expect(l.maxNodes).toBe(DEFAULT_LIMITS.maxNodes);
  });

  it("ignores a non-finite or negative override rather than disabling the limit", () => {
    const l = resolveLimits({ maxNodes: Number.POSITIVE_INFINITY, maxLinks: -1 });
    expect(l.maxNodes).toBe(DEFAULT_LIMITS.maxNodes);
    expect(l.maxLinks).toBe(DEFAULT_LIMITS.maxLinks);
  });

  it("truncates labels to the configured length with an ellipsis", () => {
    expect(truncateLabel("short", 10)).toBe("short");
    expect(truncateLabel("a very long label indeed", 10)).toBe("a very lo…");
    expect(truncateLabel("a very long label indeed", 10)).toHaveLength(10);
  });
});
