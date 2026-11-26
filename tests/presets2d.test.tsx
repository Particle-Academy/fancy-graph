// @vitest-environment jsdom
/**
 * Built-in 2D view presets (owner, 2026-11-26): ready to use as-is, each a
 * layout plus renderers plus defaults, overridable piece by piece, themeable
 * light and dark with per-type colours, and working with every interaction.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DARK_THEME,
  GRAPH_PRESETS_2D,
  GraphView,
  LIGHT_THEME,
  clusteredPreset,
  resolveTheme,
  type GraphData,
  type GraphViewHandle,
  type GraphViewProps,
  type IndexedGraph,
} from "../src/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Two types, a hub per type, a bridge between them. Directed links make a tree under "root".
const data: GraphData = {
  nodes: [
    { id: "root", label: "Root", group: "agent" },
    { id: "a1", label: "Alpha one", group: "agent" },
    { id: "a2", label: "Alpha two", group: "agent" },
    { id: "a3", label: "Alpha three", group: "agent" },
    { id: "p1", label: "Problem one", group: "problem" },
    { id: "p2", label: "Problem two", group: "problem" },
    { id: "p3", label: "Problem three", group: "problem" },
  ],
  links: [
    { source: "root", target: "a1" },
    { source: "root", target: "a2" },
    { source: "a1", target: "a3" },
    { source: "root", target: "p1" },
    { source: "p1", target: "p2" },
    { source: "p1", target: "p3" },
  ],
};

let container: HTMLDivElement;
let root: Root;
let fills: string[] = [];
beforeEach(() => {
  fills = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : () => undefined),
    set: (t, k, v) => {
      if (k === "fillStyle") fills.push(String(v));
      t[k] = v;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function mount(props: Partial<GraphViewProps> = {}) {
  const ref = createRef<GraphViewHandle>();
  act(() => root.render(<GraphView ref={ref} data={data} reducedMotion width={600} height={600} {...props} />));
  act(() => {
    ref.current!.renderFrame();
  });
  return ref;
}
const rootEl = () => container.querySelector("[data-fancy-graph]") as HTMLElement;
const dist = (a: number[] | null, b: number[] | null) => Math.hypot(a![0] - b![0], a![1] - b![1]);

describe("2D presets", () => {
  it("ships network (the default), radial, hierarchy and clustered, each documented", () => {
    expect(Object.keys(GRAPH_PRESETS_2D).sort()).toEqual(["clustered", "hierarchy", "network", "radial"]);
    for (const p of Object.values(GRAPH_PRESETS_2D)) {
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(20);
    }
    mount();
    expect(rootEl().dataset.fancyGraphPreset).toBe("network");
  });

  describe.each(Object.keys(GRAPH_PRESETS_2D))("%s", (id) => {
    it("renders and takes every interaction: pick, select, labels, stepFocus, camera, neighbourhood", () => {
      const node = vi.fn();
      const onSelectedChange = vi.fn();
      // followFocused off: the fitted camera keeps every node on screen, so every state is drawn and readable.
      const ref = mount({ preset: id as keyof typeof GRAPH_PRESETS_2D, renderers: { node }, onSelectedChange, neighborhood: true, followFocused: false });
      expect(rootEl().dataset.fancyGraphPreset).toBe(id);
      expect(rootEl().dataset.fancyGraphNodeCount).toBe("7");
      // A piecewise override: our node renderer replaced the preset's, everything else stayed.
      expect(node).toHaveBeenCalled();

      // Pick through the real input path.
      const p = ref.current!.screenPosition("p1")!;
      const at = (type: string) => {
        const e = new MouseEvent(type, { clientX: p.x, clientY: p.y, bubbles: true, button: 0 });
        Object.defineProperty(e, "pointerType", { value: "mouse" });
        act(() => {
          (container.querySelector("[data-fancy-graph-canvas]") as HTMLCanvasElement).dispatchEvent(e);
        });
      };
      at("pointerdown");
      at("pointerup");
      expect(onSelectedChange).toHaveBeenCalledWith("p1", expect.objectContaining({ source: "user" }));

      // Focus steps along links, and neighbourhood mode dims everything else.
      act(() => {
        ref.current!.focus("p1");
        ref.current!.renderFrame();
      });
      node.mockClear();
      act(() => {
        ref.current!.renderFrame();
      });
      const states = Object.fromEntries(node.mock.calls.map(([, d]) => [d.node.id, d.state]));
      expect(states.p1).toBe(1);
      expect(states.p2).toBe(2);
      expect(states.a2).toBe(3);
      let next: string | null = null;
      act(() => {
        next = ref.current!.stepFocus("next");
        ref.current!.renderFrame();
      });
      expect(["root", "p2", "p3"]).toContain(next);

      // Labels: the focus and its neighbours, as text.
      const shown = [...container.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel);
      expect(shown).toContain(next);

      // Camera API.
      const z = ref.current!.getCamera().zoom;
      act(() => {
        ref.current!.zoom(1.5);
        ref.current!.pan(10, 0);
        ref.current!.renderFrame();
      });
      expect(ref.current!.getCamera().zoom).toBeCloseTo(z * 1.5);
    });
  });

  it("radial centres the layout on the focused node, else the selection, and re-centres when it moves", () => {
    const ref = mount({ preset: "radial", selected: "p1" });
    expect(ref.current!.positionOf("p1")).toEqual([0, 0, 0]);
    act(() => root.render(<GraphView ref={ref} data={data} reducedMotion width={600} height={600} preset="radial" selected="a1" />));
    act(() => {
      ref.current!.renderFrame();
    });
    expect(ref.current!.positionOf("a1")).toEqual([0, 0, 0]);
    // Rings: a direct neighbour is closer than a node two links away.
    expect(dist(ref.current!.positionOf("root"), [0, 0])).toBeLessThan(dist(ref.current!.positionOf("p2"), [0, 0]));
  });

  it("hierarchy puts parents above their children", () => {
    const ref = mount({ preset: "hierarchy" });
    const y = (id: string) => ref.current!.positionOf(id)![1];
    expect(y("root")).toBeLessThan(y("a1"));
    expect(y("a1")).toBeLessThan(y("a3"));
  });

  it("clustered groups nodes by type into labelled hulls", () => {
    const ref = mount({ preset: "clustered" });
    expect(ref.current!.getClusters().map((c) => c.id).sort()).toEqual(["agent", "problem"]);
    const labels = [...container.querySelectorAll<HTMLElement>("[data-fancy-graph-cluster-label]")].map((e) => e.textContent);
    expect(labels.join(" ")).toMatch(/agent/i);
    // Members sit closer to their own group than to the other group's centre.
    const [ca, cp] = ["agent", "problem"].map((g) => ref.current!.getClusters().find((c) => c.id === g)!.center);
    expect(dist(ref.current!.positionOf("a2"), ca)).toBeLessThan(dist(ref.current!.positionOf("a2"), cp));
    expect(dist(ref.current!.positionOf("p3"), cp)).toBeLessThan(dist(ref.current!.positionOf("p3"), ca));
  });

  it("a preset can be configured by its factory, and an explicit layout still wins", () => {
    const fixed = (g: IndexedGraph, out: Float32Array) => g.nodes.forEach((_, i) => out.set([i * 10, 0, 0], i * 3));
    const ref = mount({ preset: clusteredPreset({ groupPull: 0.5 }), layout: fixed });
    expect(ref.current!.positionOf("a1")).toEqual([10, 0, 0]);
    expect(ref.current!.getClusters().length).toBe(2);
  });
});

describe("theme", () => {
  it("resolves light and dark from kit-level defaults, and auto from a dark ancestor", () => {
    expect(resolveTheme("light", null).background).toBe(LIGHT_THEME.background);
    expect(resolveTheme("dark", null).background).toBe(DARK_THEME.background);
    expect(LIGHT_THEME.background).not.toBe(DARK_THEME.background);
    const dark = document.createElement("div");
    dark.className = "dark";
    const inner = document.createElement("div");
    dark.appendChild(inner);
    document.body.appendChild(dark);
    expect(resolveTheme("auto", inner).mode).toBe("dark");
    dark.remove();
  });

  it("paints the background, labels and per-type colours from the theme", () => {
    mount({ theme: { base: "dark", typeColors: { agent: "#ff0000" } } });
    expect(rootEl().dataset.fancyGraphTheme).toBe("dark");
    expect(fills).toContain(DARK_THEME.background);
    expect(fills).toContain("#ff0000");
    expect(rootEl().style.getPropertyValue("--fancy-graph-label")).toBe(DARK_THEME.label);
  });

  it("takes a type colour from a CSS variable, so kit tokens can drive it", () => {
    container.style.setProperty("--fancy-graph-type-problem", "#00ff00");
    mount({ theme: "light" });
    expect(fills).toContain("#00ff00");
    expect(fills).toContain(LIGHT_THEME.background);
  });

  it("an explicit nodeColor or node.color still wins over the theme", () => {
    mount({ theme: { base: "light", typeColors: { agent: "#ff0000" } }, nodeColor: () => "#123456" });
    expect(fills).toContain("#123456");
    expect(fills).not.toContain("#ff0000");
  });
});

describe("preset polish (found in the gallery screenshots)", () => {
  it("a cluster hull and its label take the type's theme colour, not a palette guess", () => {
    mount({ preset: "clustered", theme: { base: "light", typeColors: { agent: "#ff0000", problem: "#00ff00" } } });
    const label = container.querySelector<HTMLElement>('[data-fancy-graph-cluster-label="agent"]')!;
    expect(label.style.color).toBe("rgb(255, 0, 0)");
    expect(fills).toContain("#00ff00");
  });

  it("a cluster label stays inside the view even when its hull reaches the top edge", () => {
    const ref = mount({ preset: "clustered", width: 300, height: 300 });
    act(() => {
      ref.current!.pan(0, 400);
      ref.current!.renderFrame();
    });
    for (const el of container.querySelectorAll<HTMLElement>("[data-fancy-graph-cluster-label]")) {
      if (el.style.display === "none") continue;
      const y = Number(/translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(el.style.transform)?.[1]);
      expect(y).toBeGreaterThanOrEqual(14);
    }
  });
});
