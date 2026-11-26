// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView, type GraphViewHandle, type GraphViewProps } from "../src/index";
import type { GraphData, IndexedGraph } from "../src/core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no canvas. A recording stub stands in, so the tests see what was drawn.
function stubContext() {
  const calls: string[] = [];
  const ctx = new Proxy(
    { canvas: null as unknown },
    {
      get(target, key) {
        if (key in target) return (target as Record<string | symbol, unknown>)[key];
        if (typeof key === "symbol") return undefined;
        return (...args: unknown[]) => {
          calls.push(`${key}(${args.map((a) => (typeof a === "number" ? Math.round(a) : typeof a)).join(",")})`);
        };
      },
      set(target, key, value) {
        (target as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
}

let stub = stubContext();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  stub = stubContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => stub.ctx as unknown as CanvasRenderingContext2D);
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

// A fixed grid so screen positions are predictable.
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

function pointer(type: string, x: number, y: number, extra: Partial<PointerEventInit> = {}) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra });
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
const key = (k: string) =>
  act(() => {
    canvas().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

describe("<GraphView> (2D)", () => {
  it("renders stable handles and an accessible canvas", () => {
    mount();
    expect(rootEl().dataset.fancyGraphRenderer).toBe("2d");
    expect(rootEl().dataset.fancyGraphNodeCount).toBe("4");
    expect(rootEl().dataset.fancyGraphLinkCount).toBe("2");
    expect(canvas().tabIndex).toBe(0);
    expect(canvas().getAttribute("role")).toBe("img");
    expect(canvas().getAttribute("aria-label")).toMatch(/4 nodes/);
  });

  it("draws nodes and links through the canvas", () => {
    mount();
    expect(stub.calls.some((c) => c.startsWith("arc("))).toBe(true);
    expect(stub.calls.some((c) => c.startsWith("lineTo("))).toBe(true);
  });

  it("selection is controlled: a click asks, the prop decides", () => {
    const onSelectedChange = vi.fn();
    const ref = mount({ selected: null, onSelectedChange });
    const p = ref.current!.screenPosition("b")!;
    click(p.x, p.y);
    expect(onSelectedChange).toHaveBeenCalledWith("b", expect.objectContaining({ source: "user" }));
    expect(rootEl().dataset.fancyGraphSelected).toBe("");
    act(() => root.render(<GraphView ref={ref} data={data} layout={grid} reducedMotion width={400} height={400} selected="b" onSelectedChange={onSelectedChange} />));
    expect(rootEl().dataset.fancyGraphSelected).toBe("b");
  });

  it("works uncontrolled from defaultSelected", () => {
    const ref = mount({ defaultSelected: "c" });
    expect(rootEl().dataset.fancyGraphSelected).toBe("c");
    const p = ref.current!.screenPosition("a")!;
    click(p.x, p.y);
    expect(rootEl().dataset.fancyGraphSelected).toBe("a");
  });

  it("clicking empty space clears the selection, and so does Escape", () => {
    const onSelectedChange = vi.fn();
    mount({ selected: "a", onSelectedChange });
    click(395, 5);
    expect(onSelectedChange).toHaveBeenLastCalledWith(null, expect.anything());
    onSelectedChange.mockClear();
    key("Escape");
    expect(onSelectedChange).toHaveBeenLastCalledWith(null, expect.anything());
  });

  it("reports hover", () => {
    const onHoveredChange = vi.fn();
    const ref = mount({ onHoveredChange });
    const p = ref.current!.screenPosition("d")!;
    pointer("pointermove", p.x, p.y);
    expect(onHoveredChange).toHaveBeenCalledWith("d", expect.anything());
    expect(rootEl().dataset.fancyGraphHovered).toBe("d");
  });

  it("searches, reports the matches and labels them", () => {
    const onSearchResults = vi.fn();
    mount({ search: "ta", onSearchResults });
    expect(onSearchResults).toHaveBeenLastCalledWith(["b", "d"]);
    const labels = [...container.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel);
    expect(labels).toEqual(expect.arrayContaining(["b", "d"]));
  });

  it("labels are always text, and truncated to the configured length", () => {
    mount({ data: { nodes: [{ id: "x", label: '<img src=x onerror="alert(1)"> and much more text' }], links: [] }, selected: "x", limits: { maxLabelLength: 12 } });
    const el = container.querySelector('[data-fancy-graph-label="x"]') as HTMLElement;
    expect(el.textContent).toBe("<img src=x …");
    expect(container.querySelector("img")).toBeNull();
  });

  it("calls pluggable node, link, cluster and background renderers", () => {
    const node = vi.fn();
    const link = vi.fn();
    const cluster = vi.fn();
    const background = vi.fn();
    mount({ renderers: { node, link, cluster, background }, clusters: "group", selected: "a" });
    expect(background).toHaveBeenCalledWith(stub.ctx, expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
    expect(node).toHaveBeenCalledTimes(4);
    const states = Object.fromEntries(node.mock.calls.map(([, d]) => [d.node.id, d.state]));
    expect(states).toEqual({ a: 1, b: 2, c: 3, d: 3 });
    expect(link).toHaveBeenCalledTimes(2);
    expect(cluster.mock.calls.map(([, d]) => d.cluster.id).sort()).toEqual(["g1", "g2"]);
  });

  it("flies to a node through the handle, instantly under reduced motion, and reports the camera", () => {
    const onCameraChange = vi.fn();
    const ref = mount({ onCameraChange });
    act(() => {
      ref.current!.flyTo("d", { zoom: 3 });
      ref.current!.renderFrame();
    });
    expect(ref.current!.getCamera()).toEqual({ x: 100, y: 100, zoom: 3 });
    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 100, y: 100, zoom: 3 });
    const p = ref.current!.screenPosition("d")!;
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(200);
  });

  it("keeps the focused node in view", () => {
    const ref = mount({ focused: "c" });
    act(() => {
      ref.current!.renderFrame();
    });
    const cam = ref.current!.getCamera();
    expect([cam.x, cam.y]).toEqual([-100, 100]);
  });

  it("pans with a drag and zooms with the wheel and the keyboard", () => {
    const ref = mount();
    const start = ref.current!.getCamera();
    pointer("pointerdown", 300, 20);
    pointer("pointermove", 340, 20);
    pointer("pointerup", 340, 20);
    expect(ref.current!.getCamera().x).toBeLessThan(start.x);
    const z = ref.current!.getCamera().zoom;
    act(() => {
      canvas().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
    });
    expect(ref.current!.getCamera().zoom).toBeGreaterThan(z);
    const z2 = ref.current!.getCamera().zoom;
    key("-");
    expect(ref.current!.getCamera().zoom).toBeLessThan(z2);
  });

  it("caps nodes at limits.maxNodes", () => {
    mount({ limits: { maxNodes: 2 } });
    expect(rootEl().dataset.fancyGraphNodeCount).toBe("2");
  });

  it("emits activity events tagged with their source", () => {
    const onActivity = vi.fn();
    const ref = mount({ onActivity });
    const p = ref.current!.screenPosition("a")!;
    click(p.x, p.y);
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "select", id: "a", source: "user" }));
    act(() => {
      ref.current!.select("c", { source: "agent" });
    });
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "select", id: "c", source: "agent" }));
  });

  it("hides links when linkVisibility is none", () => {
    const link = vi.fn();
    mount({ renderers: { link }, linkVisibility: "none" });
    expect(link).not.toHaveBeenCalled();
  });

  it("reports state for agents and tooling", () => {
    const ref = mount({ selected: "a", search: "gam" });
    expect(ref.current!.getState()).toMatchObject({ selected: "a", matches: ["c"], nodeCount: 4, linkCount: 2 });
  });
});
