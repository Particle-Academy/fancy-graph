// @vitest-environment jsdom
/**
 * Gamepad-only control (a second consumer): focus that steps along links by
 * screen direction or cycles them, an analog camera API that does not fight the
 * built-in controls, a focus ring distinct from selection, a neighbourhood mode,
 * and labels that always show the focus and its neighbours.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView, type GraphViewHandle, type GraphViewProps } from "../src/index";
import type { GraphData, IndexedGraph } from "../src/core";
import { GraphSceneOnStage, nodeLayer3D, type GraphLayer3D, type GraphScene3DHandle, type GraphSceneOnStageProps, type LayerFrame3D, type StageLike } from "../src/three/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// a - b, b - c, b - d. Screen: a left of b, c right of b, d below b.
const data: GraphData = {
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }, { id: "d", label: "Delta" }, { id: "e", label: "Epsilon" }],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "b", target: "d" }],
};
const cross = (_g: IndexedGraph, out: Float32Array) => {
  out.set([-100, 0, 0, 0, 0, 0, 100, 0, 0, 0, 100, 0, 150, 150, 0]);
};

let container: HTMLDivElement;
let root: Root;
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : (...a: unknown[]) => calls.push(`${String(k)}(${a.map((v) => (Array.isArray(v) ? `[${v.join(",")}]` : typeof v === "number" ? Math.round(v) : typeof v)).join(",")})`)),
    set: (t, k, v) => ((t[k] = v), true),
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

const labelsShown = () => [...container.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel).sort();

describe("gamepad control, 2D", () => {
  function mount(props: Partial<GraphViewProps> = {}) {
    const ref = createRef<GraphViewHandle>();
    act(() => root.render(<GraphView ref={ref} data={data} layout={cross} reducedMotion width={600} height={600} {...props} />));
    act(() => {
      ref.current!.renderFrame();
    });
    return ref;
  }

  it("lists a node's links in a stable order", () => {
    const ref = mount();
    expect(ref.current!.neighbors("b").map((n) => [n.id, n.direction])).toEqual([["a", "in"], ["c", "out"], ["d", "out"]]);
    expect(ref.current!.neighbors("nope")).toEqual([]);
  });

  it("steps focus along links by screen direction, starting from the best-connected node", () => {
    const onFocusedChange = vi.fn();
    const ref = mount({ onFocusedChange });
    let id: string | null = null;
    act(() => {
      id = ref.current!.stepFocus("right");
    });
    expect(id).toBe("b");
    act(() => {
      ref.current!.renderFrame();
      id = ref.current!.stepFocus("left");
    });
    expect(id).toBe("a");
    expect(onFocusedChange).toHaveBeenLastCalledWith("a", expect.objectContaining({ source: "api" }));
    act(() => {
      ref.current!.renderFrame();
      id = ref.current!.stepFocus("up");
    });
    // Nothing linked above a: focus stays.
    expect(id).toBe("a");
    expect(container.querySelector("[data-fancy-graph]")!.getAttribute("data-fancy-graph-focused")).toBe("a");
  });

  it("cycles the anchor's links with next and previous, wrapping", () => {
    const ref = mount({ defaultFocused: "b" });
    const seq: (string | null)[] = [];
    for (const dir of ["next", "next", "next", "next", "previous"] as const)
      act(() => {
        seq.push(ref.current!.stepFocus(dir));
        ref.current!.renderFrame();
      });
    expect(seq).toEqual(["a", "c", "d", "a", "d"]);
  });

  it("steps twice in one tick (a repeating button) without losing the first step", () => {
    const ref = mount({ defaultFocused: "b" });
    let seq: (string | null)[] = [];
    act(() => {
      seq = [ref.current!.stepFocus("next"), ref.current!.stepFocus("next"), ref.current!.stepFocus("next")];
    });
    expect(seq).toEqual(["a", "c", "d"]);
    expect(container.querySelector("[data-fancy-graph]")!.getAttribute("data-fancy-graph-focused")).toBe("d");
  });

  it("keeps the focused node in view", () => {
    const ref = mount({ focused: "d" });
    act(() => {
      ref.current!.renderFrame();
    });
    const cam = ref.current!.getCamera();
    expect([cam.x, cam.y]).toEqual([0, 100]);
  });

  it("draws a dashed focus ring, distinct from the solid selection ring, and tells custom renderers", () => {
    mount({ focused: "a", selected: "c" });
    const dash = calls.findIndex((c) => c.startsWith("setLineDash([") && c !== "setLineDash([])");
    expect(dash).toBeGreaterThanOrEqual(0);
    const node = vi.fn();
    mount({ focused: "a", renderers: { node } });
    const byId = Object.fromEntries(node.mock.calls.map(([, d]) => [d.node.id, d.focused]));
    expect(byId).toMatchObject({ a: true, b: false });
  });

  it("neighbourhood mode dims everything but the focus and its neighbours, and labels only them", () => {
    const node = vi.fn();
    mount({ focused: "a", neighborhood: true, renderers: { node }, limits: { labelMinPx: 0.01 } });
    const states = Object.fromEntries(node.mock.calls.map(([, d]) => [d.node.id, d.state]));
    expect(states).toEqual({ a: 1, b: 2, c: 3, d: 3, e: 3 });
    expect(labelsShown()).toEqual(["a", "b"]);
  });

  it("always labels the focus and its neighbours, even past maxLabels", () => {
    mount({ focused: "b", limits: { maxLabels: 1 } });
    expect(labelsShown()).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
  });

  it("pans and zooms on demand, and a pan releases the follow instead of fighting it", () => {
    const onCameraChange = vi.fn();
    const ref = mount({ focused: "c", onCameraChange });
    const before = ref.current!.getCamera();
    act(() => {
      ref.current!.pan(40, -20);
      ref.current!.renderFrame();
    });
    const after = ref.current!.getCamera();
    expect(after.x).toBeCloseTo(before.x + 40 / before.zoom);
    expect(after.y).toBeCloseTo(before.y - 20 / before.zoom);
    expect(onCameraChange).toHaveBeenCalled();
    act(() => {
      ref.current!.zoom(2);
      ref.current!.renderFrame();
    });
    expect(ref.current!.getCamera().zoom).toBeCloseTo(before.zoom * 2);
    // 2D has no rotation.
    expect(ref.current!.orbit(0.2, 0)).toBe(false);
  });
});

describe("gamepad control, 3D", () => {
  function fakeStage() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 800 });
    Object.defineProperty(canvas, "clientHeight", { value: 800 });
    const subs = new Set<() => void>();
    const target = new THREE.Vector3();
    const controls = { target, update: () => camera.lookAt(target) };
    const stage: StageLike = {
      scene, camera, canvas, overlayRoot: document.createElement("div"),
      renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
      controls: controls as unknown as StageLike["controls"],
      onFrame: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    };
    const frame = () => {
      controls.update();
      camera.updateMatrixWorld();
      subs.forEach((cb) => cb());
    };
    return { stage, camera, target, frame };
  }

  function mount(props: Partial<GraphSceneOnStageProps> = {}) {
    const s = fakeStage();
    const ref = createRef<GraphScene3DHandle>();
    // Home view from +z, so world +x is screen right and world +y is screen up.
    act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} layout={cross} reducedMotion homeYaw={0} homePitch={0} {...props} />));
    act(() => s.frame());
    return { ...s, ref };
  }
  const distance = (s: { camera: THREE.PerspectiveCamera; target: THREE.Vector3 }) => s.camera.position.distanceTo(s.target);

  it("orbits about the target without changing distance, and the controls' next update keeps it", () => {
    const s = mount();
    const d0 = distance(s);
    const yaw0 = s.ref.current!.getCamera().yaw;
    act(() => {
      s.ref.current!.orbit(0.3, 0.1);
      s.frame();
      s.frame();
    });
    const cam = s.ref.current!.getCamera();
    expect(cam.yaw).toBeCloseTo(yaw0 + 0.3, 3);
    expect(cam.pitch).toBeCloseTo(0.1, 3);
    expect(distance(s)).toBeCloseTo(d0, 3);
  });

  it("pans the target and the eye together along the screen axes", () => {
    const s = mount();
    const t0 = s.target.clone();
    const d0 = distance(s);
    act(() => {
      s.ref.current!.pan(100, 0);
      s.frame();
    });
    expect(s.target.x).toBeGreaterThan(t0.x);
    expect(s.target.y).toBeCloseTo(t0.y, 3);
    expect(distance(s)).toBeCloseTo(d0, 3);
  });

  it("zooms by a factor", () => {
    const s = mount();
    const d0 = distance(s);
    act(() => {
      s.ref.current!.zoom(2);
      s.frame();
    });
    expect(distance(s)).toBeCloseTo(d0 / 2, 3);
  });

  it("keeps following the focus while orbiting, and a pan releases it", () => {
    const s = mount({ focused: "c" });
    act(() => {
      s.frame();
      s.ref.current!.orbit(0.5, 0);
      s.frame();
    });
    expect(s.target.x).toBeCloseTo(100, 3);
    act(() => {
      s.ref.current!.pan(200, 0);
      s.frame();
      s.frame();
    });
    expect(s.target.x).toBeGreaterThan(110);
  });

  it("steps focus by screen direction using the projection", () => {
    const s = mount({ defaultFocused: "b" });
    let id: string | null = null;
    act(() => {
      id = s.ref.current!.stepFocus("right");
      s.frame();
    });
    expect(id).toBe("c");
    act(() => {
      s.ref.current!.stepFocus("left");
      s.frame();
    });
    act(() => {
      id = s.ref.current!.stepFocus("down");
    });
    // Back on b. d sits at world +y, which is screen UP from this camera, so nothing is below: focus stays.
    expect(id).toBe("b");
    act(() => {
      id = s.ref.current!.stepFocus("up");
    });
    expect(id).toBe("d");
  });

  it("steps twice in one tick in 3D too", () => {
    const s = mount({ defaultFocused: "b" });
    let seq: (string | null)[] = [];
    act(() => {
      seq = [s.ref.current!.stepFocus("next"), s.ref.current!.stepFocus("next")];
    });
    expect(seq).toEqual(["a", "c"]);
  });

  it("hands layers the focused node, and the default node layer marks it apart from the selection", () => {
    let seen = -2;
    const spy: GraphLayer3D = { mount() {}, update: (f: LayerFrame3D) => { seen = f.focused; }, dispose() {} };
    const s = mount({ focused: "a", selected: "c", renderers: { link: spy } });
    act(() => s.frame());
    expect(seen).toBe(0);

    const layer = nodeLayer3D();
    const group = new THREE.Group();
    const g = { nodes: data.nodes, links: [], index: new Map(), degree: new Float64Array(5), neighbors: [], incident: [], dropped: { nodes: 0, links: 0, invalidLinks: 0, duplicateNodes: 0 } };
    layer.mount({ group, renderOrder: 3, graph: g, meta: null, clusters: [], camera: s.camera });
    layer.update({
      graph: g, positions: new Float32Array(15), order: new Uint32Array([0, 1, 2, 3, 4]), states: new Uint8Array([0, 0, 1, 0, 0]), linkStates: new Uint8Array(0),
      sizes: new Float32Array(5).fill(1), colors: new Float32Array(15), clusters: [], time: 0, dt: 0, width: 800, height: 800, pixelRatio: 1,
      camera: s.camera, meta: null, focus: -1, focused: 0, selected: 2, hovered: -1, matches: null, linkVisibility: "all",
    });
    const geo = (group.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    const focus = geo.getAttribute("iFocus") as THREE.InterleavedBufferAttribute;
    expect([0, 1, 2, 3, 4].map((k) => focus.getX(k))).toEqual([1, 0, 0, 0, 0]);

    // Neighbourhood mode makes the focused node ACTIVE; it still must not wear the selection ring.
    layer.update({
      graph: g, positions: new Float32Array(15), order: new Uint32Array([0, 1, 2, 3, 4]), states: new Uint8Array([1, 2, 3, 3, 3]), linkStates: new Uint8Array(0),
      sizes: new Float32Array(5).fill(1), colors: new Float32Array(15), clusters: [], time: 0, dt: 0, width: 800, height: 800, pixelRatio: 1,
      camera: s.camera, meta: null, focus: 0, focused: 0, selected: -1, hovered: -1, matches: null, linkVisibility: "all",
    });
    const state = geo.getAttribute("iState") as THREE.InterleavedBufferAttribute;
    expect([0, 1, 2].map((k) => state.getX(k))).toEqual([0, 2, 3]);
  });

  it("labels the focus and its neighbours in 3D too", () => {
    const s = mount({ focused: "b", limits: { maxLabels: 1 } });
    act(() => s.frame());
    const shown = [...s.stage.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel).sort();
    expect(shown).toEqual(["a", "b", "c", "d"]);
  });
});
