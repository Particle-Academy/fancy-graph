// @vitest-environment jsdom
/**
 * The cosmos's synthetic centres (`cosmos:galaxy:*`, `cosmos:system:*`) are a
 * view's own nodes, not the consumer's. Lab run 1563 (0.4.1) found them leaking
 * into the public surface once galaxies formed by default: root counts, the
 * order of `neighbors()`, `stepFocus("next")`, neighbourhood labels. Every
 * input-facing count and list reports the INPUT; synthetic entries are left
 * out, listed last, or marked `synthetic: true`.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView, type GraphViewHandle } from "../src/index";
import { computeNodeStates, NODE_DIMMED, NODE_NEIGHBOR, normalizeGraph, searchNodes, type GraphData } from "../src/core";
import { freshCycle, stepFocusIndex } from "../src/react/navigation";
import { GraphSceneOnStage, prepareCosmos, type GraphScene3DHandle, type GraphSceneOnStageProps, type StageLike } from "../src/three/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 40 nodes in two groups (so the cosmos forms two galaxies by default) and 45 links. n4's links, in input order: n1, n13, n14, n15. */
function labData(): GraphData {
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, group: i % 2 ? "person" : "event" }));
  const links: GraphData["links"] = [];
  for (let i = 16; i < 39; i++) links.push({ source: `n${i}`, target: `n${i + 1}` });
  links.push({ source: "n4", target: "n1" }, { source: "n13", target: "n4" }, { source: "n4", target: "n14" }, { source: "n4", target: "n15" });
  for (let i = 16; i < 34; i++) links.push({ source: `n${i}`, target: `n${i + 2}` });
  return { nodes, links };
}
const DATA = labData();

function fakeStage(w = 1000, h = 700) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 60000);
  camera.position.set(0, 0, 3000);
  const host = document.createElement("div");
  host.setAttribute("data-fancy-graph", "");
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  Object.defineProperty(canvas, "clientWidth", { value: w });
  Object.defineProperty(canvas, "clientHeight", { value: h });
  const subs = new Set<() => void>();
  const target = new THREE.Vector3();
  const controls = { target, update: () => camera.lookAt(target) };
  const stage: StageLike = {
    scene, camera, canvas, overlayRoot: document.createElement("div"),
    renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
    controls: controls as unknown as StageLike["controls"],
    onFrame: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
  return { stage, host, frame: () => { controls.update(); camera.updateMatrixWorld(); subs.forEach((cb) => cb()); } };
}

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

function mount3D(props: Partial<GraphSceneOnStageProps> = {}) {
  const s = fakeStage();
  const ref = createRef<GraphScene3DHandle>();
  act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} preset="cosmos" data={DATA} reducedMotion paused {...props} />));
  act(() => s.frame());
  return { ...s, ref, frames: (k: number) => { for (let i = 0; i < k; i++) act(() => s.frame()); } };
}
const shownLabels = (s: ReturnType<typeof fakeStage>) =>
  [...s.stage.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel!);

describe("the cosmos's synthetic centres stay out of the input-facing surface", () => {
  it("the fixture does form synthetic galaxies (otherwise every test below proves nothing)", () => {
    const g = normalizeGraph(prepareCosmos(DATA));
    expect(g.nodes.length).toBe(42);
    expect(g.links.length).toBe(85);
  });

  it("root counts report the input; synthetic counts are separate", () => {
    const s = mount3D();
    const ds = s.host.dataset;
    expect(ds.fancyGraphNodeCount).toBe("40");
    expect(ds.fancyGraphLinkCount).toBe("45");
    expect(ds.fancyGraphSyntheticNodeCount).toBe("2");
    expect(ds.fancyGraphSyntheticLinkCount).toBe("40");
    expect(s.stage.canvas.getAttribute("aria-label")).toContain("40 nodes, 45 links");
  });

  it("getState reports the input counts, and the synthetic ones beside them", () => {
    const s = mount3D();
    expect(s.ref.current!.getState()).toMatchObject({ nodeCount: 40, linkCount: 45, syntheticNodeCount: 2, syntheticLinkCount: 40 });
  });

  it("neighbors() lists the input links first, in input order, and the gravity link to the core last, marked", () => {
    const s = mount3D();
    const ns = s.ref.current!.neighbors("n4");
    expect(ns.map((n) => n.id)).toEqual(["n1", "n13", "n14", "n15", "cosmos:galaxy:event"]);
    expect(ns.map((n) => n.synthetic === true)).toEqual([false, false, false, false, true]);
  });

  it("stepFocus('next') from n4 reaches its first real link, n1, and the core only after the real ones", () => {
    const s = mount3D({ defaultFocused: "n4" });
    const seq: (string | null)[] = [];
    for (let k = 0; k < 5; k++)
      act(() => {
        seq.push(s.ref.current!.stepFocus("next"));
        s.frame();
      });
    expect(seq).toEqual(["n1", "n13", "n14", "n15", "cosmos:galaxy:event"]);
  });

  it("stepFocus with nothing focused lands on the best-connected INPUT node, never a core", () => {
    const s = mount3D();
    let id: string | null = null;
    act(() => {
      id = s.ref.current!.stepFocus("next");
    });
    expect(id).not.toBeNull();
    expect(id!.startsWith("cosmos:")).toBe(false);
  });

  it("neighbourhood mode labels the focus and its real neighbours, never the synthetic core", () => {
    const s = mount3D({ focused: "n4", neighborhood: true, limits: { labelMinPx: 0.01 } });
    s.frames(2);
    const shown = shownLabels(s);
    expect(shown).toContain("n4");
    expect(shown.filter((id) => id.startsWith("cosmos:"))).toEqual([]);
    for (const id of shown) expect(["n4", "n1", "n13", "n14", "n15"]).toContain(id);
  });

  it("search reports input nodes only", () => {
    const onSearchResults = vi.fn();
    const s = mount3D({ search: "event", onSearchResults });
    // "event" is the core's label; no input node matches it.
    expect(s.ref.current!.getState().matches).toEqual([]);
    expect(s.host.dataset.fancyGraphMatches).toBe("0");
    expect(onSearchResults).toHaveBeenLastCalledWith([]);
  });

  it("selecting or focusing a core is allowed, and marked synthetic in the callback and the activity event", () => {
    const onSelectedChange = vi.fn();
    const onFocusedChange = vi.fn();
    const onActivity = vi.fn();
    const s = mount3D({ onSelectedChange, onFocusedChange, onActivity });
    act(() => s.ref.current!.select("cosmos:galaxy:event"));
    expect(onSelectedChange).toHaveBeenLastCalledWith("cosmos:galaxy:event", { source: "api", synthetic: true });
    expect(onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ type: "select", id: "cosmos:galaxy:event", synthetic: true }));
    act(() => s.ref.current!.focus("cosmos:galaxy:event"));
    expect(onFocusedChange).toHaveBeenLastCalledWith("cosmos:galaxy:event", { source: "api", synthetic: true });
    // A real node carries no mark at all, so existing exact matches keep passing.
    act(() => s.ref.current!.select("n4"));
    expect(onSelectedChange).toHaveBeenLastCalledWith("n4", { source: "api" });
    expect(onActivity.mock.calls.at(-1)![0]).not.toHaveProperty("synthetic");
  });
});

describe("the headless core treats synthetic nodes the same way", () => {
  const g = normalizeGraph(prepareCosmos(DATA));
  const at = (id: string) => g.index.get(id)!;

  it("a synthetic core is never a neighbour of the focus in the node states", () => {
    const st = computeNodeStates(g, { selected: at("n4") });
    expect(st[at("n1")]).toBe(NODE_NEIGHBOR);
    expect(st[at("cosmos:galaxy:event")]).toBe(NODE_DIMMED);
  });

  it("but selecting a core still highlights its members", () => {
    const st = computeNodeStates(g, { selected: at("cosmos:galaxy:event") });
    expect(st[at("n4")]).toBe(NODE_NEIGHBOR);
  });

  it("searchNodes skips synthetic nodes", () => {
    expect(searchNodes(g, "event")).toEqual([]);
    expect(searchNodes(g, "Node 4").map((i) => g.nodes[i].id)).toEqual(["n4"]);
  });

  it("stepFocusIndex starts on the best-connected input node", () => {
    const i = stepFocusIndex(g, freshCycle(), -1, -1, "next", new Float32Array(0));
    expect(g.nodes[i].synthetic).not.toBe(true);
  });
});

describe("2D: a consumer passing prepared data gets input counts too", () => {
  it("counts the input on the root and in getState", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D,
    );
    const ref = createRef<GraphViewHandle>();
    act(() => root.render(<GraphView ref={ref} data={prepareCosmos(DATA)} reducedMotion width={400} height={300} />));
    const el = container.querySelector<HTMLElement>("[data-fancy-graph]")!;
    expect(el.dataset.fancyGraphNodeCount).toBe("40");
    expect(el.dataset.fancyGraphLinkCount).toBe("45");
    expect(el.dataset.fancyGraphSyntheticNodeCount).toBe("2");
    expect(el.dataset.fancyGraphSyntheticLinkCount).toBe("40");
    expect(ref.current!.getState()).toMatchObject({ nodeCount: 40, linkCount: 45, syntheticNodeCount: 2, syntheticLinkCount: 40 });
    expect(ref.current!.neighbors("n4").map((n) => n.id)).toEqual(["n1", "n13", "n14", "n15", "cosmos:galaxy:event"]);
  });
});
