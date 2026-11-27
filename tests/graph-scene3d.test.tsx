// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphData, IndexedGraph } from "../src/core";
import { GraphSceneOnStage, GraphView3D, type GraphLayer3D, type GraphScene3DHandle, type GraphSceneOnStageProps, type StageLike } from "../src/three/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A stand-in for fancy-3d-three's <Stage> context. `withControls` mimics the
 * new additive `controls` handle; without it, it behaves like 0.2.1, whose
 * OrbitControls only reveals its target through `camera.lookAt(target)`.
 */
function fakeStage(withControls: boolean) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 500);
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 800 });
  Object.defineProperty(canvas, "clientHeight", { value: 800 });
  const overlayRoot = document.createElement("div");
  const subs = new Set<() => void>();
  const target = new THREE.Vector3();
  const controls = { target, update: () => camera.lookAt(target), enabled: true, minDistance: 0, maxDistance: Infinity };
  const stage: StageLike = {
    scene,
    camera,
    canvas,
    overlayRoot,
    renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
    onFrame(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    ...(withControls ? { controls: controls as unknown as StageLike["controls"] } : {}),
  };
  const frame = () => {
    controls.update(); // what OrbitControls.update() does every frame
    camera.updateMatrixWorld();
    subs.forEach((cb) => cb());
  };
  return { stage, frame, target, camera, canvas, overlayRoot, scene };
}

const data: GraphData = {
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
  links: [{ source: "a", target: "b" }],
};
const line = (_g: IndexedGraph, out: Float32Array) => {
  out.set([-100, 0, 0, 0, 0, 0, 100, 0, 0]);
};

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
});

function mount(withControls: boolean, props: Partial<GraphSceneOnStageProps> = {}) {
  const s = fakeStage(withControls);
  const ref = createRef<GraphScene3DHandle>();
  act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} layout={line} reducedMotion {...props} />));
  act(() => s.frame());
  return { ...s, ref };
}

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  act(() => {
    canvas.dispatchEvent(e);
  });
}

describe.each([
  ["with the Stage `controls` handle", true],
  ["on fancy-3d-three 0.2.1 (no controls handle)", false],
])("<GraphSceneOnStage> %s", (_name, withControls) => {
  it("flies the orbit target to a node and keeps the camera looking at it", () => {
    const s = mount(withControls);
    act(() => {
      s.ref.current!.flyTo("c", { distance: 50 });
      s.frame();
    });
    expect(s.target.x).toBeCloseTo(100);
    expect(s.camera.position.distanceTo(s.target)).toBeCloseTo(50, 0);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(s.camera.quaternion);
    const toTarget = s.target.clone().sub(s.camera.position).normalize();
    expect(forward.dot(toTarget)).toBeCloseTo(1, 3);
  });

  it("picks a node under the pointer and asks to select it", () => {
    const onSelectedChange = vi.fn();
    const s = mount(withControls, { onSelectedChange });
    const p = s.ref.current!.screenPosition("b")!;
    pointer(s.canvas, "pointerdown", p.x, p.y);
    pointer(s.canvas, "pointerup", p.x, p.y);
    expect(onSelectedChange).toHaveBeenCalledWith("b", expect.objectContaining({ source: "user" }));
  });

  it("fit(ids) frames each node's drawn radius, not only its centre", () => {
    // a and b sit 100 apart with radius 80: the drawn sphere is 130, the centres' only 50.
    const s = mount(withControls, { nodeSize: () => 80 });
    act(() => {
      s.ref.current!.fit(["a", "b"]);
      for (let i = 0; i < 240; i++) s.frame();
    });
    expect(s.target.x).toBeCloseTo(-50, 0);
    const half = THREE.MathUtils.degToRad(s.camera.fov) / 2;
    expect(s.camera.position.distanceTo(s.target)).toBeGreaterThanOrEqual(130 / Math.sin(half));
  });

  it("follows the selected node while it moves", () => {
    let t = 0;
    const moving = { animated: true, init() {}, step(out: Float32Array) { t += 1; out.set([t * 10, 0, 0, 0, 0, 0, 0, 0, 0]); return true; } };
    const s = mount(withControls, { layout: moving, reducedMotion: false, selected: "a" });
    act(() => {
      s.ref.current!.follow("a");
      for (let i = 0; i < 120; i++) s.frame();
    });
    expect(Math.abs(s.target.x - t * 10)).toBeLessThan(15);
  });

  it("removes everything it added when unmounted", () => {
    const s = mount(withControls);
    const lookAt = s.camera.lookAt;
    expect(s.scene.children.length).toBeGreaterThan(0);
    act(() => root.unmount());
    root = createRoot(container);
    expect(s.scene.children).toHaveLength(0);
    expect(s.overlayRoot.querySelectorAll("[data-fancy-graph-label]").length).toBe(0);
    expect(s.camera.lookAt).toBe(withControls ? lookAt : THREE.PerspectiveCamera.prototype.lookAt);
  });
});

describe("<GraphSceneOnStage> layers and labels", () => {
  it("mounts pluggable layers in order and feeds them per-frame, back-to-front data", () => {
    const calls: string[] = [];
    let order: number[] = [];
    const layer = (name: string): GraphLayer3D => ({
      mount: (c) => calls.push(`${name}:mount:${c.renderOrder}`),
      update: (f) => {
        calls.push(`${name}:update`);
        if (name === "node") order = [...f.order];
      },
      dispose: () => calls.push(`${name}:dispose`),
    });
    const s = mount(true, { renderers: { background: layer("bg"), cluster: layer("cluster"), link: layer("link"), node: layer("node") } });
    expect(calls.filter((c) => c.includes("mount"))).toEqual(["bg:mount:0", "cluster:mount:1", "link:mount:2", "node:mount:3"]);
    expect(calls).toContain("node:update");
    // Camera on +z looking at the origin from (0,0,500) after fitting: all equidistant on x, so check it is a permutation.
    expect([...order].sort()).toEqual([0, 1, 2]);
    s.camera.position.set(-1000, 0, 0);
    s.camera.lookAt(0, 0, 0);
    act(() => s.frame());
    // From -x, node c (x = 100) is farthest, so it is drawn first.
    expect(order[0]).toBe(2);
  });

  it("labels the selection in the stage overlay, as text", () => {
    const s = mount(true, { selected: "b", data: { nodes: [{ id: "a" }, { id: "b", label: "<b>bold</b>" }, { id: "c" }], links: [] } });
    act(() => s.frame());
    const el = s.overlayRoot.querySelector('[data-fancy-graph-label="b"]') as HTMLElement;
    expect(el.textContent).toBe("<b>bold</b>");
    expect(s.overlayRoot.querySelector("b")).toBeNull();
  });
});

describe("<GraphView3D>", () => {
  it("renders stable handles around a fancy-3d-three Stage", () => {
    const html = renderToStaticMarkup(<GraphView3D data={data} />);
    expect(html).toMatch(/data-fancy-graph=""/);
    expect(html).toMatch(/data-fancy-graph-renderer="3d"/);
    expect(html).toMatch(/data-fancy-3d-stage=""/);
  });
});
