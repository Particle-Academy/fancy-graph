// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  clampCamera2D,
  fitCamera2D,
  LabelLayer,
  lerpCamera2D,
  orbitPosition,
  placeLabels,
  screenToWorld2D,
  worldToScreen2D,
  zoomAt2D,
  resolveLimits,
} from "../src/core";

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
