// @vitest-environment jsdom
/**
 * The optional view-controls overlay (`/controls`), built from react-fancy.
 * Every control has a stable `data-fancy-graph-control` handle.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphViewControls } from "../src/controls/index";
import { GraphView, type GraphControlsProps } from "../src/index";
import type { GraphData, IndexedGraph } from "../src/core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const base = (over: Partial<GraphControlsProps> = {}): GraphControlsProps => ({
  selected: null,
  selectedLabel: null,
  onClearSelection: vi.fn(),
  layers: [
    { id: "links", label: "Links", visible: true },
    { id: "orbits", label: "Orbit paths", visible: false },
  ],
  onLayerChange: vi.fn(),
  linkVisibility: "focus",
  onLinkVisibilityChange: vi.fn(),
  animated: false,
  paused: false,
  onPausedChange: vi.fn(),
  ...over,
});
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const press = (el: Element) => act(() => (el as HTMLElement).click());

describe("<GraphViewControls>", () => {
  it("is a react-fancy surface with a stable root handle and a panel toggle", () => {
    act(() => root.render(<GraphViewControls {...base()} />));
    expect(q("[data-fancy-graph-controls]")).not.toBeNull();
    const toggle = q('[data-fancy-graph-control="panel"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(q('[data-fancy-graph-control="layer"]')).toBeNull();
    press(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('[data-fancy-graph-control="layer"]')).toHaveLength(2);
  });

  it("offers clear-selection only while something is selected, and names it", () => {
    const p = base();
    act(() => root.render(<GraphViewControls {...p} />));
    expect(q('[data-fancy-graph-control="clear-selection"]')).toBeNull();
    const sel = base({ selected: "b", selectedLabel: "Beta" });
    act(() => root.render(<GraphViewControls {...sel} />));
    const btn = q('[data-fancy-graph-control="clear-selection"]')!;
    expect(btn.getAttribute("aria-label")).toBe("Clear selection: Beta");
    press(btn);
    expect(sel.onClearSelection).toHaveBeenCalled();
  });

  it("each layer is a react-fancy Switch that asks through onLayerChange", () => {
    const p = base();
    act(() => root.render(<GraphViewControls {...p} defaultOpen />));
    const orbits = q('[data-fancy-graph-layer="orbits"] [role="switch"]')!;
    expect(orbits.getAttribute("aria-checked")).toBe("false");
    press(orbits);
    expect(p.onLayerChange).toHaveBeenCalledWith("orbits", true);
    press(q('[data-fancy-graph-layer="links"] [role="switch"]')!);
    expect(p.onLayerChange).toHaveBeenCalledWith("links", false);
  });

  it("chooses all links or the selection's only, while links are on", () => {
    const p = base();
    act(() => root.render(<GraphViewControls {...p} defaultOpen />));
    const mode = q('[data-fancy-graph-control="link-visibility"]')!;
    expect(mode).not.toBeNull();
    const all = [...mode.querySelectorAll("button")].find((b) => b.textContent === "All")!;
    press(all);
    expect(p.onLinkVisibilityChange).toHaveBeenCalledWith("all");
    const off = base({ layers: [{ id: "links", label: "Links", visible: false }] });
    act(() => root.render(<GraphViewControls {...off} defaultOpen />));
    expect(q('[data-fancy-graph-control="link-visibility"]')).toBeNull();
  });

  it("offers motion only for an animated layout", () => {
    act(() => root.render(<GraphViewControls {...base()} defaultOpen />));
    expect(q('[data-fancy-graph-control="motion"]')).toBeNull();
    const p = base({ animated: true });
    act(() => root.render(<GraphViewControls {...p} defaultOpen />));
    const sw = q('[data-fancy-graph-control="motion"] [role="switch"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    press(sw);
    expect(p.onPausedChange).toHaveBeenCalledWith(true);
  });

  it("every visible string can be replaced", () => {
    act(() => root.render(<GraphViewControls {...base({ selected: "b", selectedLabel: "Beta" })} labels={{ panel: "Ansicht", clearSelection: "Auswahl aufheben" }} />));
    expect(q('[data-fancy-graph-control="panel"]')!.textContent).toContain("Ansicht");
    expect(q('[data-fancy-graph-control="clear-selection"]')!.textContent).toContain("Auswahl aufheben");
  });

  it("drives a real <GraphView> end to end", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const data: GraphData = { nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], links: [{ source: "a", target: "b" }] };
    const grid = (_g: IndexedGraph, out: Float32Array) => out.set([-50, 0, 0, 50, 0, 0]);
    act(() => root.render(<GraphView data={data} layout={grid} reducedMotion width={300} height={300} defaultSelected="b" controls={GraphViewControls} />));
    const graph = q("[data-fancy-graph]")!;
    expect(graph.dataset.fancyGraphSelected).toBe("b");
    press(q('[data-fancy-graph-control="clear-selection"]')!);
    expect(graph.dataset.fancyGraphSelected).toBe("");
    press(q('[data-fancy-graph-control="panel"]')!);
    press(q('[data-fancy-graph-layer="labels"] [role="switch"]')!);
    expect(graph.dataset.fancyGraphLayers).toBe("links");
  });
});
