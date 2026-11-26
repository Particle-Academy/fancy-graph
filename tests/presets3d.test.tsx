// @vitest-environment jsdom
/**
 * Built-in 3D view presets: cosmos (the reference example, now shipped), a 3D
 * force network (spheres and lines) and a layered view (by type or by a time
 * field). Each works with every interaction and follows the theme.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DARK_THEME, type GraphData } from "../src/index";
import { GRAPH_PRESETS_3D, GraphSceneOnStage, layeredPreset, type GraphScene3DHandle, type GraphSceneOnStageProps, type StageLike } from "../src/three/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: GraphData = {
  nodes: [
    { id: "root", label: "Root", group: "agent", data: { at: "2026-01-05" } },
    { id: "a1", label: "Alpha one", group: "agent", data: { at: "2026-02-10" } },
    { id: "a2", label: "Alpha two", group: "agent", data: { at: "2026-03-15" } },
    { id: "p1", label: "Problem one", group: "problem", data: { at: "2026-06-01" } },
    { id: "p2", label: "Problem two", group: "problem", data: { at: "2026-09-20" } },
    { id: "s1", label: "Solution one", group: "solution", data: { at: "2026-12-30" } },
  ],
  links: [
    { source: "root", target: "a1" },
    { source: "root", target: "a2" },
    { source: "root", target: "p1" },
    { source: "p1", target: "p2" },
    { source: "p2", target: "s1" },
  ],
};

function fakeStage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000);
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 800 });
  Object.defineProperty(canvas, "clientHeight", { value: 800 });
  const subs = new Set<() => void>();
  const target = new THREE.Vector3();
  const controls = { target, update: () => camera.lookAt(target) };
  const clear: string[] = [];
  const stage: StageLike = {
    scene, camera, canvas, overlayRoot: document.createElement("div"),
    renderer: { getPixelRatio: () => 1, setClearColor: (c: THREE.Color) => clear.push(`#${c.getHexString()}`) } as unknown as THREE.WebGLRenderer,
    controls: controls as unknown as StageLike["controls"],
    onFrame: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
  return { stage, camera, target, clear, frame: () => { controls.update(); camera.updateMatrixWorld(); subs.forEach((cb) => cb()); } };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

function mount(props: Partial<GraphSceneOnStageProps> = {}) {
  const s = fakeStage();
  const ref = createRef<GraphScene3DHandle>();
  act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} reducedMotion {...props} />));
  act(() => s.frame());
  return { ...s, ref };
}

describe("3D presets", () => {
  it("ships cosmos, network and layered, each documented", () => {
    expect(Object.keys(GRAPH_PRESETS_3D).sort()).toEqual(["cosmos", "layered", "network"]);
    for (const p of Object.values(GRAPH_PRESETS_3D)) expect(p.description.length).toBeGreaterThan(20);
  });

  describe.each(Object.keys(GRAPH_PRESETS_3D))("%s", (id) => {
    it("draws into the stage and takes every interaction", () => {
      const onSelectedChange = vi.fn();
      const s = mount({ preset: id as keyof typeof GRAPH_PRESETS_3D, onSelectedChange, neighborhood: true, homeYaw: 0, homePitch: 0.3 });
      const objects: THREE.Object3D[] = [];
      s.stage.scene.traverse((o) => objects.push(o));
      expect(objects.some((o) => (o as THREE.Mesh).isMesh)).toBe(true);

      // Pick and select.
      act(() => s.frame());
      const p = s.ref.current!.screenPosition("p1")!;
      expect(p).not.toBeNull();
      const fire = (type: string) => {
        const e = new MouseEvent(type, { clientX: p.x, clientY: p.y, bubbles: true, button: 0 });
        Object.defineProperty(e, "pointerType", { value: "mouse" });
        act(() => {
          s.stage.canvas.dispatchEvent(e);
        });
      };
      fire("pointerdown");
      fire("pointerup");
      expect(onSelectedChange).toHaveBeenCalledWith("p1", expect.anything());

      // Focus, stepFocus, labels.
      act(() => {
        s.ref.current!.focus("p1");
        s.frame();
      });
      let next: string | null = null;
      act(() => {
        next = s.ref.current!.stepFocus("next");
      });
      // The new focus renders first; then the frames that fly to it and label it.
      act(() => {
        s.frame();
        s.frame();
      });
      expect(["root", "p2"]).toContain(next);
      const shown = [...s.stage.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel);
      expect(shown).toContain(next);

      // Camera API.
      const before = s.ref.current!.getCamera();
      act(() => {
        s.ref.current!.orbit(0.2, 0);
        s.ref.current!.zoom(2);
        s.frame();
      });
      const after = s.ref.current!.getCamera();
      expect(after.distance).toBeCloseTo(before.distance / 2, 1);
    });
  });

  it("cosmos makes one galaxy per type", () => {
    const s = mount({ preset: "cosmos" });
    expect(s.ref.current!.getClusters().map((c) => c.id).sort()).toEqual(["agent", "problem", "solution"]);
  });

  it("layered puts each type on its own plane, in a stable order", () => {
    const s = mount({ preset: "layered" });
    const y = (id: string) => s.ref.current!.positionOf(id)![1];
    expect(y("a1")).toBeCloseTo(y("root"));
    expect(y("p1")).not.toBeCloseTo(y("root"));
    expect(s.ref.current!.getClusters().map((c) => c.id)).toEqual(["agent", "problem", "solution"]);
  });

  it("layered draws one translucent plane per layer", () => {
    const s = mount({ preset: "layered" });
    act(() => s.frame());
    let planes: THREE.Mesh | null = null;
    s.stage.scene.traverse((o) => {
      if (o.name === "fancy-graph-layer-planes") planes = o as THREE.Mesh;
    });
    expect(planes).not.toBeNull();
    expect((planes!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(3);
    // Seen from above, a plane's quad faces away after the xy to xz mapping: it must draw both sides.
    expect((planes!.material as THREE.Material).side).toBe(THREE.DoubleSide);
  });

  it("a flat layer's label sits just above its plane, not a whole radius above it", () => {
    const s = mount({ preset: "layered", homeYaw: 0, homePitch: 0.15 });
    act(() => s.frame());
    const label = s.stage.overlayRoot.querySelector<HTMLElement>('[data-fancy-graph-cluster-label="agent"]');
    expect(label).not.toBeNull();
    const labelY = Number(/translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(label!.style.transform)?.[1]);
    const members = ["root", "a1", "a2"].map((id) => s.ref.current!.screenPosition(id)!.y);
    // Nearly edge-on, the plane is a thin band: the label belongs within a few dozen px of it.
    expect(Math.min(...members) - labelY).toBeLessThan(60);
  });

  it("layered by a time field orders layers through time, oldest on top", () => {
    const s = mount({ preset: layeredPreset({ layerBy: { field: "at", buckets: 3 } }) });
    const y = (id: string) => s.ref.current!.positionOf(id)![1];
    expect(y("root")).toBeGreaterThan(y("p1"));
    expect(y("p1")).toBeGreaterThan(y("s1"));
    expect(s.ref.current!.getClusters()[0].label).toMatch(/2026-01/);
  });

  it("follows the theme: per-type colours and the stage clear colour", () => {
    const s = mount({ preset: "network", theme: { base: "dark", typeColors: { agent: "#ff0000" } } });
    expect(s.clear).toContain(DARK_THEME.background);
    let colors: Float32Array | null = null;
    const spy = { mount() {}, update: (f: { colors: Float32Array }) => { colors = f.colors; }, dispose() {} };
    act(() => root.render(<GraphSceneOnStage stage={s.stage} data={data} reducedMotion preset="network" theme={{ base: "dark", typeColors: { agent: "#ff0000" } }} renderers={{ background: spy }} />));
    act(() => s.frame());
    expect([...colors!.slice(0, 3)]).toEqual([1, 0, 0]);
  });
});
