// @vitest-environment jsdom
/**
 * Deselect, layer visibility and the controls slot on the 2D view. Owner report
 * 2026-11-27: in a dense view there was no practical way to unselect, and no
 * way to switch links (or anything else a preset draws) on or off.
 */
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView, type GraphControlsProps, type GraphViewHandle, type GraphViewProps } from "../src/index";
import type { GraphData, IndexedGraph } from "../src/core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubContext() {
  return new Proxy({ canvas: null as unknown } as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === "symbol") return undefined;
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => stubContext() as unknown as CanvasRenderingContext2D);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const data: GraphData = {
  nodes: [
    { id: "a", label: "Alpha", group: "g1" },
    { id: "b", label: "Beta", group: "g1" },
    { id: "c", label: "Gamma", group: "g2" },
    { id: "d", label: "Delta", group: "g2" },
  ],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }],
};
const grid = (g: IndexedGraph, out: Float32Array) => {
  g.nodes.forEach((_, i) => {
    out[i * 3] = (i % 2) * 200 - 100;
    out[i * 3 + 1] = Math.floor(i / 2) * 200 - 100;
  });
};

function mount(props: Partial<GraphViewProps> = {}) {
  const ref = createRef<GraphViewHandle>();
  act(() => root.render(<GraphView ref={ref} data={data} layout={grid} reducedMotion width={400} height={400} {...props} />));
  act(() => {
    ref.current!.renderFrame();
  });
  return ref;
}
const rootEl = () => container.querySelector("[data-fancy-graph]") as HTMLElement;
const canvas = () => container.querySelector("[data-fancy-graph-canvas]") as HTMLCanvasElement;
function pointer(type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  Object.defineProperty(e, "pointerId", { value: 1 });
  act(() => {
    canvas().dispatchEvent(e);
  });
}
const click = (x: number, y: number) => {
  pointer("pointerdown", x, y);
  pointer("pointerup", x, y);
};

describe("deselect (2D)", () => {
  it("clicking the selected node again clears the selection", () => {
    const onSelectedChange = vi.fn();
    const ref = mount({ selected: "b", onSelectedChange });
    const p = ref.current!.screenPosition("b")!;
    click(p.x, p.y);
    expect(onSelectedChange).toHaveBeenLastCalledWith(null, expect.objectContaining({ source: "user" }));
  });

  it("uncontrolled: select by click, then the same click toggles it off", () => {
    const ref = mount();
    const p = ref.current!.screenPosition("c")!;
    click(p.x, p.y);
    expect(rootEl().dataset.fancyGraphSelected).toBe("c");
    click(p.x, p.y);
    expect(rootEl().dataset.fancyGraphSelected).toBe("");
  });

  it("clearSelection() on the handle goes through the controlled path", () => {
    const onSelectedChange = vi.fn();
    const ref = mount({ selected: "a", onSelectedChange });
    act(() => ref.current!.clearSelection({ source: "agent" }));
    expect(onSelectedChange).toHaveBeenCalledWith(null, expect.objectContaining({ source: "agent" }));
  });
});

describe("layer visibility (2D)", () => {
  it("reports the preset's layers, their state, and stable handles", () => {
    const ref = mount({ preset: "clustered", layout: undefined });
    expect(ref.current!.getLayers()).toEqual([
      { id: "links", label: "Links", visible: true },
      { id: "labels", label: "Labels", visible: true },
      { id: "clusters", label: "Clusters", visible: true },
    ]);
    expect(ref.current!.getState().layers).toEqual({ links: true, labels: true, clusters: true });
    expect(rootEl().dataset.fancyGraphLayers).toBe("links labels clusters");
    expect(rootEl().dataset.fancyGraphLinkVisibility).toBe("all");
  });

  it("links: false draws no links, and the link renderer is never called", () => {
    const link = vi.fn();
    mount({ renderers: { link }, layers: { links: false } });
    expect(link).not.toHaveBeenCalled();
  });

  it("the renderers those layers gate are called while the layers are on (the control for the two tests below)", () => {
    const link = vi.fn();
    const cluster = vi.fn();
    const ref = mount({ renderers: { link, cluster }, clusters: "group", selected: "b" });
    act(() => {
      ref.current!.renderFrame();
    });
    expect(link).toHaveBeenCalled();
    expect(cluster).toHaveBeenCalled();
    expect([...container.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].some((el) => el.style.display === "block")).toBe(true);
  });

  it("clusters: false draws no cluster and no cluster label", () => {
    const cluster = vi.fn();
    const ref = mount({ renderers: { cluster }, clusters: "group", layers: { clusters: false } });
    act(() => {
      ref.current!.renderFrame();
    });
    expect(cluster).not.toHaveBeenCalled();
    expect([...container.querySelectorAll<HTMLElement>("[data-fancy-graph-cluster-label]")].filter((el) => el.style.display !== "none")).toHaveLength(0);
  });

  it("labels: false hides node labels, even the selection's", () => {
    const ref = mount({ selected: "b", layers: { labels: false } });
    act(() => {
      ref.current!.renderFrame();
    });
    const shown = [...container.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((el) => el.style.display !== "none");
    expect(shown).toHaveLength(0);
  });

  it("controlled: setLayer asks through onLayersChange with the full map, and the prop decides", () => {
    const onLayersChange = vi.fn();
    const onActivity = vi.fn();
    const ref = mount({ layers: {}, onLayersChange, onActivity });
    act(() => {
      expect(ref.current!.setLayer("links", false, { source: "agent" })).toBe(true);
    });
    expect(onLayersChange).toHaveBeenCalledWith({ links: false, labels: true }, expect.objectContaining({ source: "agent" }));
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "layer", id: "links", source: "agent" }));
    // Controlled with {}: nothing changes until the host passes it back.
    expect(ref.current!.getState().layers.links).toBe(true);
    expect(ref.current!.setLayer("nope", false)).toBe(false);
  });

  it("uncontrolled: defaultLayers, then setLayer updates the view", () => {
    const ref = mount({ defaultLayers: { labels: false } });
    expect(ref.current!.getState().layers).toEqual({ links: true, labels: false });
    act(() => {
      ref.current!.setLayer("labels", true);
    });
    expect(ref.current!.getState().layers.labels).toBe(true);
    expect(rootEl().dataset.fancyGraphLayers).toBe("links labels");
  });

  it("link visibility is controllable: onLinkVisibilityChange, defaultLinkVisibility, the preset's default", () => {
    const onLinkVisibilityChange = vi.fn();
    const ref = mount({ defaultLinkVisibility: "focus", onLinkVisibilityChange });
    expect(ref.current!.getState().linkVisibility).toBe("focus");
    act(() => ref.current!.setLinkVisibility("all", { source: "user" }));
    expect(onLinkVisibilityChange).toHaveBeenCalledWith("all", expect.objectContaining({ source: "user" }));
    expect(ref.current!.getState().linkVisibility).toBe("all");
    expect(rootEl().dataset.fancyGraphLinkVisibility).toBe("all");
  });

  it("paused is controllable too, for animated layouts", () => {
    const onPausedChange = vi.fn();
    const ref = mount({ onPausedChange });
    expect(ref.current!.getState().paused).toBe(false);
    act(() => ref.current!.setPaused(true));
    expect(onPausedChange).toHaveBeenCalledWith(true, expect.objectContaining({ source: "api" }));
    expect(ref.current!.getState().paused).toBe(true);
    expect(rootEl().dataset.fancyGraphPaused).toBe("true");
  });
});

describe("the controls slot (2D)", () => {
  it("renders nothing extra unless asked", () => {
    mount();
    expect(container.querySelector("[data-fancy-graph-controls-root]")).toBeNull();
  });

  it("renders the given component with the view's state, and its callbacks drive the view", () => {
    let last: GraphControlsProps | null = null;
    const Controls = (p: GraphControlsProps) => {
      last = p;
      return <div data-testid="mine">{p.selectedLabel ?? "none"}</div>;
    };
    function Host() {
      const [selected, setSelected] = useState<string | null>("b");
      return <GraphView data={data} layout={grid} reducedMotion width={400} height={400} selected={selected} onSelectedChange={setSelected} controls={Controls} />;
    }
    act(() => root.render(<Host />));
    expect(container.querySelector("[data-fancy-graph-controls-root] [data-testid=mine]")!.textContent).toBe("Beta");
    expect(last!.selected).toBe("b");
    expect(last!.layers.map((l) => l.id)).toEqual(["links", "labels"]);
    expect(last!.animated).toBe(false);
    act(() => last!.onClearSelection());
    expect(rootEl().dataset.fancyGraphSelected).toBe("");
    act(() => last!.onLayerChange("links", false));
    expect(last!.layers.find((l) => l.id === "links")!.visible).toBe(false);
    act(() => last!.onLinkVisibilityChange("focus"));
    expect(last!.linkVisibility).toBe("focus");
  });
});
