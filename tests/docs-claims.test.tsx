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

declare global {
  interface ImportMeta {
    glob(pattern: string, options?: { query?: "?raw"; import?: "default"; eager?: boolean }): Record<string, unknown>;
  }
}

describe("view-controls styling docs", () => {
  const raw = (glob: Record<string, unknown>) => String(Object.values(glob)[0]);
  const readme = raw(import.meta.glob("../README.md", { query: "?raw", import: "default", eager: true }));
  const agents = raw(import.meta.glob("../AGENTS.md", { query: "?raw", import: "default", eager: true }));
  const source = raw(import.meta.glob("../src/controls/GraphViewControls.tsx", { query: "?raw", import: "default", eager: true }));

  it("the overlay writes no class names of its own, so react-fancy's @source is the one a host needs", () => {
    // Every class the overlay shows comes from react-fancy's dist. If this
    // fails, the overlay started writing Tailwind classes: the docs must then
    // ask for a @source on this package's dist too.
    const classNames = source.match(/className=/g) ?? [];
    const passthrough = source.match(/className=\{className\}/g) ?? [];
    expect(classNames.length).toBe(passthrough.length);
    expect(source).not.toMatch(/\bcn\(|clsx\(/);
  });

  it("README and AGENTS.md give the @source line and the accent", () => {
    for (const [name, doc] of [["README", readme], ["AGENTS", agents]] as const) {
      expect(doc, name).toContain('@source "../node_modules/@particle-academy/react-fancy/dist/**/*.js";');
      expect(doc, name).toContain('color="teal"');
      expect(doc, name).toContain("--color-brand");
    }
  });
});

describe("preset docs", () => {
  const shots = Object.keys(import.meta.glob("../docs/presets/*.png"));
  const readme = String(Object.values(import.meta.glob("../README.md", { query: "?raw", import: "default", eager: true }))[0]);

  it("every built-in preset has a committed screenshot, named and shown in the README", async () => {
    const { GRAPH_PRESETS_2D } = await import("../src/index");
    const { GRAPH_PRESETS_3D } = await import("../src/three/index");
    const expected = [...Object.keys(GRAPH_PRESETS_2D).map((id) => `2d-${id}`), ...Object.keys(GRAPH_PRESETS_3D).map((id) => `3d-${id}`)];
    for (const name of expected) {
      expect(shots, name).toContain(`../docs/presets/${name}.png`);
      expect(readme, name).toContain(`docs/presets/${name}.png`);
    }
  });
});
