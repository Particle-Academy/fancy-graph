// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView, type GraphViewHandle, type GraphViewProps } from "../src/index";
import { DEFAULT_LIMITS, clampCamera2D, fitCamera2D, resolveLimits, type GraphData } from "../src/core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no canvas; a no-op context stands in.
function stubContext() {
  return new Proxy({ canvas: null as unknown }, {
    get(target, key) {
      if (key in target) return (target as Record<string | symbol, unknown>)[key];
      if (typeof key === "symbol") return undefined;
      return () => undefined;
    },
    set(target, key, value) {
      (target as Record<string | symbol, unknown>)[key] = value;
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

// The consumer's report: 7 nodes, 3 links, sizes 3-14 world units.
const reported: GraphData = {
  nodes: [
    { id: "a", label: "A", size: 14 },
    { id: "b", label: "B", size: 9 },
    { id: "c", label: "C", size: 6 },
    { id: "d", label: "D", size: 3 },
    { id: "e", label: "E", size: 12 },
    { id: "f", label: "F", size: 4 },
    { id: "g", label: "G", size: 8 },
  ],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "e", target: "f" }],
};

const W = 620, H = 480;

function mount(data: GraphData, props: Partial<GraphViewProps> = {}) {
  const ref = createRef<GraphViewHandle>();
  act(() => root.render(<GraphView ref={ref} data={data} preset="network" reducedMotion width={W} height={H} {...props} />));
  act(() => {
    ref.current!.renderFrame();
    ref.current!.renderFrame();
  });
  return ref;
}

/** Every node's drawn disc, in CSS px. */
function discs(ref: React.RefObject<GraphViewHandle | null>, data: GraphData) {
  return data.nodes.map((n) => ref.current!.screenPosition(n.id)!);
}

describe("fitting the 2D camera", () => {
  it("keeps every node of the reported 7-node graph fully inside the canvas, at a sane zoom", () => {
    const ref = mount(reported);
    // Literal bounds, so this fails on 0.2.2 for the geometry and not merely a missing field:
    // 0.2.2 zoomed to 4.2 here, drew node "a" 118 px across and ran node "e" 3 px past the bottom.
    expect(ref.current!.getCamera().zoom).toBeLessThanOrEqual(2);
    for (const d of discs(ref, reported)) {
      expect(d.x - d.radius).toBeGreaterThanOrEqual(0);
      expect(d.y - d.radius).toBeGreaterThanOrEqual(0);
      expect(d.x + d.radius).toBeLessThanOrEqual(W);
      expect(d.y + d.radius).toBeLessThanOrEqual(H);
      // The report: nodes about 130 px across. A fit never blows a node up like that.
      expect(d.radius * 2).toBeLessThanOrEqual(60);
    }
  });

  it("counts a preset's nodeSize as the drawn radius", () => {
    const ref = mount(reported, { nodeSize: () => 40, limits: { fitMaxZoom: 40 } });
    for (const d of discs(ref, reported)) {
      expect(d.x - d.radius).toBeGreaterThanOrEqual(0);
      expect(d.y - d.radius).toBeGreaterThanOrEqual(0);
      expect(d.x + d.radius).toBeLessThanOrEqual(W);
      expect(d.y + d.radius).toBeLessThanOrEqual(H);
    }
  });

  it("fits a single node inside the viewport, at no more than the fit ceiling", () => {
    const one: GraphData = { nodes: [{ id: "solo", size: 14 }], links: [] };
    const ref = mount(one);
    const d = ref.current!.screenPosition("solo")!;
    expect(ref.current!.getCamera().zoom).toBeLessThanOrEqual(DEFAULT_LIMITS.fitMaxZoom);
    expect(d.x - d.radius).toBeGreaterThanOrEqual(0);
    expect(d.y - d.radius).toBeGreaterThanOrEqual(0);
    expect(d.x + d.radius).toBeLessThanOrEqual(W);
    expect(d.y + d.radius).toBeLessThanOrEqual(H);
  });

  it("the fit ceiling is a configurable limit", () => {
    expect(DEFAULT_LIMITS.fitMaxZoom).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.fitMaxZoom).toBeLessThan(DEFAULT_LIMITS.maxZoom);
    expect(resolveLimits({ fitMaxZoom: 6 }).fitMaxZoom).toBe(6);
    // 20 world units across 400 px wants zoom 20.
    const p = new Float32Array([0, 0, 0, 20, 0, 0]);
    expect(fitCamera2D(p, null, 400, 400, 0, resolveLimits({ fitMaxZoom: 3 })).zoom).toBe(3);
    expect(fitCamera2D(p, null, 400, 400, 0, resolveLimits({ fitMaxZoom: 30 })).zoom).toBeCloseTo(20);
    // The ceiling is for fitting only: zooming by hand still reaches maxZoom.
    expect(clampCamera2D({ x: 0, y: 0, zoom: 35 }, resolveLimits()).zoom).toBe(35);
  });

  it("includes each node's radius in the box", () => {
    // Two nodes 100 apart, radius 50 each: the drawn extent is 200, not 100.
    const p = new Float32Array([-50, 0, 0, 50, 0, 0]);
    const cam = fitCamera2D(p, null, 400, 400, 0, resolveLimits(), new Float32Array([50, 50]));
    expect(cam.zoom).toBeCloseTo(2);
    expect(cam.x).toBeCloseTo(0);
  });

  it("leaves the fit of a large graph unchanged", () => {
    // 400 nodes spread over 4000 world units: the radius is a rounding error and the ceiling never binds.
    const n = 400;
    const p = new Float32Array(n * 3);
    const radii = new Float32Array(n).fill(6);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (i % 20) * 200 - 1900;
      p[i * 3 + 1] = Math.floor(i / 20) * 200 - 1900;
    }
    const before = fitCamera2D(p, null, W, H, 48, { minZoom: 0.01, maxZoom: 40 });
    const after = fitCamera2D(p, null, W, H, 48, resolveLimits(), radii);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.zoom / before.zoom).toBeGreaterThan(0.99);
    expect(after.zoom).toBeLessThanOrEqual(before.zoom);
  });
});
