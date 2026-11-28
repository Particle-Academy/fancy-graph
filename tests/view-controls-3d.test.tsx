// @vitest-environment jsdom
/**
 * Deselect, layer visibility and the controls slot on the 3D view, and the
 * cosmos preset's orbit paths. Owner report 2026-11-27, using the cosmos.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphData, IndexedGraph } from "../src/core";
import { cosmosOrbits, GraphSceneOnStage, type GraphControlsProps, type GraphLayer3D, type GraphScene3DHandle, type GraphSceneOnStageProps, type LayerFrame3D, type StageLike } from "../src/three/index";
import { cosmosData } from "../examples/cosmos/data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeStage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 500);
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 800 });
  Object.defineProperty(canvas, "clientHeight", { value: 800 });
  const overlayRoot = document.createElement("div");
  document.body.appendChild(overlayRoot);
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
    controls: controls as unknown as StageLike["controls"],
  };
  const frame = () => {
    controls.update();
    camera.updateMatrixWorld();
    subs.forEach((cb) => cb());
  };
  return { stage, frame, canvas, overlayRoot, scene, camera, target };
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

function mount(props: Partial<GraphSceneOnStageProps> = {}) {
  const s = fakeStage();
  const ref = createRef<GraphScene3DHandle>();
  const render = (p: Partial<GraphSceneOnStageProps>) => act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} layout={line} reducedMotion {...props} {...p} />));
  render({});
  act(() => s.frame());
  return { ...s, ref, render };
}
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  act(() => {
    canvas.dispatchEvent(e);
  });
}

/** A recording layer, tagged with a layer id. */
function probe(layer?: string) {
  const frames: LayerFrame3D[] = [];
  let group: THREE.Group | null = null;
  const l: GraphLayer3D = {
    layer,
    mount: (c) => {
      group = c.group;
    },
    update: (f) => {
      frames.push(f);
    },
    dispose: () => {},
  };
  return { l, frames, group: () => group! };
}

describe("deselect (3D)", () => {
  it("clicking the selected node again clears the selection (it used to be ignored)", () => {
    const onSelectedChange = vi.fn();
    const s = mount({ selected: "b", onSelectedChange, flyOnSelect: false });
    const p = s.ref.current!.screenPosition("b")!;
    pointer(s.canvas, "pointerdown", p.x, p.y);
    pointer(s.canvas, "pointerup", p.x, p.y);
    expect(onSelectedChange).toHaveBeenCalledWith(null, expect.objectContaining({ source: "user" }));
  });

  it("clearing the selection releases a follow of that node", () => {
    let t = 0;
    const moving = { animated: true, init() {}, step(out: Float32Array) { t += 1; out.set([t * 10, 0, 0, 0, 0, 0, 0, 0, 0]); return true; } };
    const s = mount({ layout: moving, reducedMotion: false, defaultSelected: "a" });
    act(() => {
      for (let i = 0; i < 30; i++) s.frame();
    });
    act(() => s.ref.current!.clearSelection());
    const before = s.target.x;
    act(() => {
      for (let i = 0; i < 30; i++) s.frame();
    });
    expect(s.target.x).toBeCloseTo(before, 3);
  });
});

describe("layer visibility (3D)", () => {
  it("a hidden layer is not drawn and not fed frames; the slot sets its default id", () => {
    const bg = probe();
    const s = mount({ renderers: { background: bg.l }, layers: { background: false } });
    act(() => s.frame());
    expect(bg.group().visible).toBe(false);
    expect(bg.frames).toHaveLength(0);
    s.render({ renderers: { background: bg.l }, layers: { background: true } });
    act(() => s.frame());
    expect(bg.group().visible).toBe(true);
    expect(bg.frames.length).toBeGreaterThan(0);
  });

  it("each layer gets its own group, so hiding one never hides another", () => {
    const a = probe("orbits");
    const b = probe();
    const s = mount({ renderers: { cluster: [b.l, a.l] }, layers: { orbits: false } });
    act(() => s.frame());
    expect(a.group()).not.toBe(b.group());
    expect(a.group().visible).toBe(false);
    expect(b.group().visible).toBe(true);
  });

  it("links: false hides the link slot and tells layers linkVisibility none", () => {
    const link = probe();
    const node = probe();
    const s = mount({ renderers: { link: link.l, node: node.l }, layers: { links: false } });
    act(() => s.frame());
    expect(link.group().visible).toBe(false);
    expect(node.frames.at(-1)!.linkVisibility).toBe("none");
  });

  it("labels: false hides node labels, even the selection's", () => {
    const s = mount({ selected: "b", flyOnSelect: false, layers: { labels: false } });
    act(() => s.frame());
    const shown = [...s.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((el) => el.style.display !== "none");
    expect(shown).toHaveLength(0);
  });

  it("getLayers / setLayer / getState on the 3D handle, with stable handles on the root", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-fancy-graph", "");
    const s = fakeStage();
    wrap.appendChild(s.canvas);
    document.body.appendChild(wrap);
    const ref = createRef<GraphScene3DHandle>();
    act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} preset="cosmos" reducedMotion />));
    expect(ref.current!.getLayers().map((l) => [l.id, l.visible])).toEqual([
      ["background", true],
      ["clusters", true],
      ["cores", true],
      ["orbits", false],
      ["links", true],
      ["labels", true],
    ]);
    expect(ref.current!.getState().linkVisibility).toBe("focus");
    expect(ref.current!.getState().animated).toBe(true);
    act(() => {
      ref.current!.setLayer("orbits", true);
    });
    expect(ref.current!.getState().layers.orbits).toBe(true);
    expect(wrap.dataset.fancyGraphLayers).toBe("background clusters cores orbits links labels");
    expect(wrap.dataset.fancyGraphLinkVisibility).toBe("focus");
    wrap.remove();
  });
});

describe("cosmos orbit paths", () => {
  it("draws one closed ring per orbiter around its star, in the layer tagged `orbits`, one set per galaxy", () => {
    const { nodes, links } = cosmosData(120, 160, 3);
    const s = mount({ data: { nodes, links }, preset: "cosmos", layout: undefined, layers: { orbits: true } });
    act(() => s.frame());
    const lines = s.scene.getObjectsByProperty("name", "cosmos-orbits") as THREE.LineSegments[];
    const galaxies = s.ref.current!.getClusters();
    expect(lines).toHaveLength(galaxies.length);
    const orbiters = s.ref.current!.getClusters().reduce((k, c) => k + c.members.length, 0) - galaxies.length;
    const verts = lines.reduce((k, l) => k + l.geometry.drawRange.count, 0);
    expect(verts).toBeGreaterThan(0);
    expect(verts).toBeLessThanOrEqual(orbiters * 48 * 2);
    for (const l of lines) expect(l.parent!.visible).toBe(true);
  });

  it("is hidden by default, and a factory exists for custom cosmos looks", () => {
    const { nodes, links } = cosmosData(60, 80, 3);
    const s = mount({ data: { nodes, links }, preset: "cosmos", layout: undefined });
    act(() => s.frame());
    const seg = s.scene.getObjectsByProperty("name", "cosmos-orbits")[0];
    expect(seg.parent!.visible).toBe(false);
    expect(cosmosOrbits().layer).toBe("orbits");
  });
});

describe("the controls slot (3D)", () => {
  it("portals the component into the stage overlay, wired to the view", () => {
    let last: GraphControlsProps | null = null;
    const Controls = (p: GraphControlsProps) => {
      last = p;
      return <span data-testid="mine" />;
    };
    const s = mount({ controls: Controls, defaultSelected: "a", flyOnSelect: false });
    expect(s.overlayRoot.querySelector("[data-fancy-graph-controls-root] [data-testid=mine]")).not.toBeNull();
    expect(last!.selectedLabel).toBe("Alpha");
    act(() => last!.onClearSelection());
    expect(s.ref.current!.getState().selected).toBeNull();
    act(() => last!.onPausedChange(true));
    expect(s.ref.current!.getState().paused).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    expect(s.overlayRoot.querySelector("[data-fancy-graph-controls-root]")).toBeNull();
  });
});
