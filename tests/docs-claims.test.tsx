import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphView, neighborLinks, normalizeGraph } from "../src/index";

/** Claims AGENTS.md makes, held here so the guide cannot drift from the code. */
describe("AGENTS.md claims", () => {
  it("the one-line triple mapping produces a graph, with type as group and predicate as kind", () => {
    const nodes = [
      { id: "ada", label: "Ada Lovelace", type: "person", summary: "Wrote the first program." },
      { id: "engine", label: "Analytical Engine", type: "machine", summary: "Babbage's design." },
    ];
    const edges = [{ subject: "ada", predicate: "wrote_for", object: "engine" }];
    // The exact line from AGENTS.md:
    const data = { nodes: nodes.map((n) => ({ id: n.id, label: n.label, group: n.type, data: { summary: n.summary } })), links: edges.map((e) => ({ source: e.subject, target: e.object, kind: e.predicate })) };
    const g = normalizeGraph(data);
    expect(g.nodes.map((n) => n.group)).toEqual(["person", "machine"]);
    expect(neighborLinks(g, 0)).toEqual([expect.objectContaining({ id: "engine", direction: "out", link: expect.objectContaining({ link: expect.objectContaining({ kind: "wrote_for" }) }) })]);
    expect(g.nodes[0].data).toEqual({ summary: "Wrote the first program." });
  });

  it("the 2D view renders its markup on the server (it draws only in the browser)", () => {
    const html = renderToStaticMarkup(<GraphView data={{ nodes: [{ id: "a" }], links: [] }} width={200} height={100} />);
    expect(html).toMatch(/data-fancy-graph=""/);
    expect(html).toMatch(/data-fancy-graph-renderer="2d"/);
    expect(html).toMatch(/<canvas[^>]*data-fancy-graph-canvas=""/);
  });
});
