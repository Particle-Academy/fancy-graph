// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  clampCamera2D,
  fitCamera2D,
  LabelLayer,
  labelCandidates,
  chooseLabelSpot,
  lerpCamera2D,
  orbitPosition,
  placeLabels,
  screenToWorld2D,
  worldToScreen2D,
  zoomAt2D,
  resolveLimits,
} from "../src/core";

describe("labelCandidates", () => {
  const screen = (n: number) => {
    const s = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) s.set([10 + i, 10, 5 + i, 100], i * 4);
    return s;
  };
  const base = (n: number, asked: number[]) => ({ screen: screen(n), states: new Uint8Array(n), selected: -1, hovered: -1, matches: null, width: 2000, height: 100, labelMinPx: 1, text: (i: number) => (asked.push(i), `n${i}`) });

  it("a limit keeps the highest-priority unforced candidates, forced ones always, and asks text only for those", () => {
    const asked: number[] = [];
    const out = labelCandidates({ ...base(500, asked), hovered: 3, limit: 10 });
    expect(out.filter((c) => !c.forced).map((c) => c.index).sort((a, b) => a - b)).toEqual([490, 491, 492, 493, 494, 495, 496, 497, 498, 499]);
    expect(out.some((c) => c.index === 3 && c.forced)).toBe(true);
    expect(asked.sort((a, b) => a - b)).toEqual([3, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499]);
  });

  it("semantic reach: Infinity always competes, a negative never does, the rest by their projected reach", () => {
    const reach = new Float32Array([Infinity, -1, 30, 5]);
    const out = labelCandidates({ ...base(4, []), reach, reachMinPx: 22 });
    expect(out.map((c) => c.index).sort()).toEqual([0, 2]);
  });
});

describe("chooseLabelSpot", () => {
  const box = (x: number, y: number, w: number) => ({ index: 0, text: "x", x, y, w, h: 14 });

  it("takes the first spot clear of names already placed and of node labels, on screen", () => {
    const spots: [number, number][] = [[100, 100], [300, 100], [500, 100], [700, 100]];
    // 100 sits on a node label, 300 is too near a placed name, 500 is clear.
    expect(chooseLabelSpot(spots, [{ x: 330, y: 100 }], [box(80, 92, 60)], 40, 1000, 600, 64)).toEqual([500, 100]);
  });

  it("none clear: null, never a name on top of another", () => {
    expect(chooseLabelSpot([[100, 100]], [{ x: 110, y: 100 }], [], 40, 1000, 600, 64)).toBeNull();
    expect(chooseLabelSpot([[5, 100]], [], [], 40, 1000, 600, 64)).toBeNull();
  });
});

describe("placeLabels", () => {
  const c = (index: number, x: number, y: number, priority: number, text = "label", forced = false) => ({ index, x, y, radius: 4, text, priority, forced });

  it("places by priority and rejects overlapping labels", () => {
    const placed = placeLabels([c(0, 10, 10, 1), c(1, 12, 11, 5), c(2, 300, 10, 2)], { maxLabels: 10, width: 800, height: 600 });
    expect(placed.map((p) => p.index)).toEqual([1, 2]);
  });

  it("always places forced labels even when they overlap", () => {
    const placed = placeLabels([c(0, 10, 10, 9), c(1, 12, 11, 1, "x", true)], { maxLabels: 10, width: 800, height: 600 });
    expect(placed.map((p) => p.index).sort()).toEqual([0, 1]);
  });

  it("stops at maxLabels", () => {
    const many = Array.from({ length: 50 }, (_, i) => c(i, i * 100, 10, i));
    expect(placeLabels(many, { maxLabels: 5, width: 10000, height: 600 })).toHaveLength(5);
  });

  it("skips labels outside the viewport", () => {
    expect(placeLabels([c(0, -500, 10, 1)], { maxLabels: 5, width: 800, height: 600 })).toEqual([]);
  });
});

describe("LabelLayer", () => {
  it("writes labels as text, never HTML, with stable handles", () => {
    const root = document.createElement("div");
    const layer = new LabelLayer(root, { pool: 4 });
    layer.render([{ index: 0, id: "evil", text: '<img src=x onerror="alert(1)">', x: 5, y: 6, w: 10, h: 14, state: "active" }]);
    const el = root.querySelector('[data-fancy-graph-label="evil"]') as HTMLElement;
    expect(el.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(root.querySelector("img")).toBeNull();
    expect(el.dataset.fancyGraphLabelState).toBe("active");
    expect(el.style.display).toBe("block");
  });

  it("pools elements and hides the unused ones", () => {
    const root = document.createElement("div");
    const layer = new LabelLayer(root, { pool: 3 });
    layer.render([{ index: 0, id: "a", text: "a", x: 0, y: 0, w: 5, h: 14 }, { index: 1, id: "b", text: "b", x: 0, y: 20, w: 5, h: 14 }]);
    layer.render([{ index: 0, id: "a", text: "a", x: 0, y: 0, w: 5, h: 14 }]);
    const visible = [...root.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none");
    expect(visible).toHaveLength(1);
    expect(root.children.length).toBe(3);
    layer.dispose();
    expect(root.children.length).toBe(0);
  });

  it("renders cluster labels separately", () => {
    const root = document.createElement("div");
    const layer = new LabelLayer(root, { pool: 2 });
    layer.renderClusters([{ id: "g1", text: "Galaxy", x: 1, y: 2, color: "#ff0000" }]);
    const el = root.querySelector('[data-fancy-graph-cluster-label="g1"]') as HTMLElement;
    expect(el.textContent).toBe("Galaxy");
  });
});

describe("2D camera", () => {
  const limits = resolveLimits();
  it("round-trips world and screen coordinates", () => {
    const cam = { x: 10, y: -5, zoom: 2 };
    const [sx, sy] = worldToScreen2D(cam, 800, 600, 30, 15);
    expect([sx, sy]).toEqual([440, 340]);
    expect(screenToWorld2D(cam, 800, 600, sx, sy)).toEqual([30, 15]);
  });

  it("zooms about the cursor so the point under it stays put", () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const before = screenToWorld2D(cam, 800, 600, 100, 100);
    const next = zoomAt2D(cam, 800, 600, 100, 100, 2, limits);
    const after = screenToWorld2D(next, 800, 600, 100, 100);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(next.zoom).toBe(2);
  });

  it("clamps zoom to the configured limits", () => {
    expect(clampCamera2D({ x: 0, y: 0, zoom: 1e9 }, resolveLimits({ maxZoom: 8 })).zoom).toBe(8);
  });

  it("fits a set of positions into the viewport", () => {
    const p = new Float32Array([-100, -50, 0, 100, 50, 0]);
    const cam = fitCamera2D(p, null, 400, 400, 0, limits);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.zoom).toBeCloseTo(2);
  });

  it("interpolates cameras with zoom in log space", () => {
    const mid = lerpCamera2D({ x: 0, y: 0, zoom: 1 }, { x: 10, y: 10, zoom: 4 }, 0.5);
    expect(mid.x).toBe(5);
    expect(mid.zoom).toBeCloseTo(2);
  });
});

describe("3D orbit camera", () => {
  it("places the eye at distance from the target along yaw and pitch", () => {
    const p = orbitPosition({ target: [1, 2, 3], distance: 10, yaw: 0, pitch: 0 });
    expect(p[0]).toBeCloseTo(1);
    expect(p[1]).toBeCloseTo(2);
    expect(p[2]).toBeCloseTo(13);
    const up = orbitPosition({ target: [0, 0, 0], distance: 10, yaw: 0, pitch: Math.PI / 2 });
    expect(up[1]).toBeCloseTo(10);
  });
});
