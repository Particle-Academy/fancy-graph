// @vitest-environment jsdom
/**
 * A preset changes IN PLACE on a mounted view, in both directions between
 * every pair, without a remount (no `key={preset}`). Until 0.2.2 a 3D switch
 * into the cosmos threw `Cannot read properties of undefined (reading
 * 'bodies')`: the new preset's options (its renderers and its `nodeSize`) were
 * applied while the engine still held the old preset's layout, whose meta has
 * no bodies.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPH_PRESETS_2D, GraphView, type GraphData, type GraphViewHandle } from "../src/index";
import { GRAPH_PRESETS_3D, GraphSceneOnStage, type GraphScene3DHandle, type GraphSceneOnStageProps, type StageLike } from "../src/three/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: GraphData = {
  nodes: [
    { id: "root", label: "Root", group: "agent" },
    { id: "a1", label: "Alpha one", group: "agent" },
    { id: "a2", label: "Alpha two", group: "agent" },
    { id: "p1", label: "Problem one", group: "problem" },
    { id: "p2", label: "Problem two", group: "problem" },
    { id: "s1", label: "Solution one", group: "solution" },
  ],
  links: [
    { source: "root", target: "a1" },
    { source: "root", target: "a2" },
    { source: "root", target: "p1" },
    { source: "p1", target: "p2" },
    { source: "p2", target: "s1" },
  ],
};

const pairs = (ids: string[]) => ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b] as const));

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
  vi.restoreAllMocks();
});

function fakeStage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000);
  // Inside a [data-fancy-graph] root, as GraphView3D mounts it, so the preset id is readable.
  const host = document.createElement("div");
  host.setAttribute("data-fancy-graph", "");
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  Object.defineProperty(canvas, "clientWidth", { value: 800 });
  Object.defineProperty(canvas, "clientHeight", { value: 800 });
  const subs = new Set<() => void>();
  const target = new THREE.Vector3();
  const controls = { target, update: () => camera.lookAt(target) };
  const stage: StageLike = {
    scene, camera, canvas, overlayRoot: document.createElement("div"),
    renderer: { getPixelRatio: () => 1, setClearColor: () => {} } as unknown as THREE.WebGLRenderer,
    controls: controls as unknown as StageLike["controls"],
    onFrame: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
  return { stage, host, frame: () => { controls.update(); camera.updateMatrixWorld(); subs.forEach((cb) => cb()); } };
}

type S = ReturnType<typeof fakeStage>;
const layerNames = (s: S) => {
  const names: string[] = [];
  s.stage.scene.traverse((o) => {
    if (o.name.startsWith("fancy-graph-layer-")) names.push(o.name);
  });
  return names.sort();
};
const positions = (ref: { current: { positionOf(id: string): number[] | null } | null }) => data.nodes.map((n) => ref.current!.positionOf(n.id));

describe("3D: a preset switches in place", () => {
  const render3D = (s: S, ref: React.Ref<GraphScene3DHandle>, preset: string, extra: Partial<GraphSceneOnStageProps> = {}) =>
    root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} reducedMotion preset={preset as keyof typeof GRAPH_PRESETS_3D} {...extra} />);

  /** What the preset looks like when it is mounted fresh: its layer groups, positions and clusters. */
  function fresh(preset: string) {
    const s = fakeStage();
    const ref = createRef<GraphScene3DHandle>();
    const r = createRoot(document.createElement("div"));
    act(() => r.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={data} reducedMotion preset={preset as keyof typeof GRAPH_PRESETS_3D} />));
    act(() => s.frame());
    act(() => s.frame());
    const out = { layers: layerNames(s), positions: positions(ref), clusters: ref.current!.getClusters().map((c) => c.id).sort() };
    act(() => r.unmount());
    s.host.remove();
    return out;
  }

  it.each(pairs(Object.keys(GRAPH_PRESETS_3D)))("%s to %s", (from, to) => {
    const s = fakeStage();
    const ref = createRef<GraphScene3DHandle>();
    act(() => render3D(s, ref, from));
    act(() => s.frame());
    expect(s.host.dataset.fancyGraphPreset).toBe(from);

    expect(() => {
      act(() => render3D(s, ref, to));
      act(() => s.frame());
      act(() => s.frame());
    }).not.toThrow();

    const want = fresh(to);
    expect(s.host.dataset.fancyGraphPreset).toBe(to);
    // The new preset's layers, and only those: nothing of the old one left in the scene.
    expect(layerNames(s)).toEqual(want.layers);
    // The new preset's layout: the same positions and clusters a fresh mount gets.
    expect(positions(ref)).toEqual(want.positions);
    expect(ref.current!.getClusters().map((c) => c.id).sort()).toEqual(want.clusters);
    // Its layers in the controls' list too.
    expect(ref.current!.getLayers().map((l) => l.id).sort()).toEqual((GRAPH_PRESETS_3D[to as keyof typeof GRAPH_PRESETS_3D].layers ?? []).map((l) => l.id).sort());
    s.host.remove();
  });

  it("round-trips through every preset and back with the selection kept", () => {
    const s = fakeStage();
    const ref = createRef<GraphScene3DHandle>();
    const ids = Object.keys(GRAPH_PRESETS_3D);
    act(() => render3D(s, ref, ids[0], { defaultSelected: "p1" }));
    act(() => s.frame());
    for (const id of [...ids.slice(1), ...ids.slice().reverse(), ids[1]]) {
      expect(() => {
        act(() => render3D(s, ref, id, { defaultSelected: "p1" }));
        act(() => s.frame());
      }).not.toThrow();
      expect(s.host.dataset.fancyGraphPreset).toBe(id);
      expect(ref.current!.getState().selected).toBe("p1");
    }
    s.host.remove();
  });
});

describe("2D: a preset switches in place", () => {
  beforeEach(() => {
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : () => undefined),
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  });

  const render2D = (ref: React.Ref<GraphViewHandle>, preset: string) =>
    root.render(<GraphView ref={ref} data={data} reducedMotion width={600} height={600} preset={preset as keyof typeof GRAPH_PRESETS_2D} />);

  function fresh(preset: string) {
    const ref = createRef<GraphViewHandle>();
    const el = document.createElement("div");
    const r = createRoot(el);
    act(() => r.render(<GraphView ref={ref} data={data} reducedMotion width={600} height={600} preset={preset as keyof typeof GRAPH_PRESETS_2D} />));
    act(() => {
      ref.current!.renderFrame();
    });
    const out = { positions: positions(ref), clusters: ref.current!.getClusters().map((c) => c.id).sort() };
    act(() => r.unmount());
    return out;
  }

  it.each(pairs(Object.keys(GRAPH_PRESETS_2D)))("%s to %s", (from, to) => {
    const ref = createRef<GraphViewHandle>();
    act(() => render2D(ref, from));
    act(() => {
      ref.current!.renderFrame();
    });
    const el = () => container.querySelector("[data-fancy-graph]") as HTMLElement;
    expect(el().dataset.fancyGraphPreset).toBe(from);

    expect(() => {
      act(() => render2D(ref, to));
      act(() => {
        ref.current!.renderFrame();
        ref.current!.renderFrame();
      });
    }).not.toThrow();

    const want = fresh(to);
    expect(el().dataset.fancyGraphPreset).toBe(to);
    expect(positions(ref)).toEqual(want.positions);
    expect(ref.current!.getClusters().map((c) => c.id).sort()).toEqual(want.clusters);
    expect(ref.current!.getLayers().map((l) => l.id).sort()).toEqual((GRAPH_PRESETS_2D[to as keyof typeof GRAPH_PRESETS_2D].layers ?? []).map((l) => l.id).sort());
  });
});
