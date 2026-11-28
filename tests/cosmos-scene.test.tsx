// @vitest-environment jsdom
/**
 * The cosmos redesign in the 3D view: lens switches and sorts animate, light
 * links are arcs that follow the arms, labels follow the zoom, selection flies
 * and frames, breadcrumbs climb back out, constellations select, comets carry a
 * GPU tail, and each node's look comes from its data.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphData } from "../src/core";
import { GraphSceneOnStage, lightArcPoints, type GraphScene3DHandle, type GraphSceneOnStageProps, type StageLike } from "../src/three/index";
import { CORE, MOON, PLANET, STAR, type CosmosLenses, type CosmosMeta } from "../src/three/presets/cosmos-layout";
import { cosmosData } from "../examples/cosmos/data";
import { KIT_NOW, kitData, kitGrouped, relationData } from "../examples/cosmos/kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeStage(w = 1000, h = 700) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 60000);
  camera.position.set(0, 0, 3000);
  const canvas = document.createElement("canvas");
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
  return { stage, scene, camera, target, frame: () => { controls.update(); camera.updateMatrixWorld(); subs.forEach((cb) => cb()); } };
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
  vi.restoreAllMocks();
});

type S = ReturnType<typeof fakeStage>;
function mount(props: Partial<GraphSceneOnStageProps> & { data: GraphData }, s: S = fakeStage()) {
  const ref = createRef<GraphScene3DHandle>();
  const render = (p: Partial<GraphSceneOnStageProps> & { data: GraphData }) => act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} preset="cosmos" {...p} />));
  render(props);
  act(() => s.frame());
  return { ...s, ref, render, frames: (k: number) => { for (let i = 0; i < k; i++) act(() => s.frame()); } };
}
const metaOf = (ref: { current: GraphScene3DHandle | null }) => ref.current!.getMeta() as CosmosMeta;
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const shownLabels = (s: S) => [...s.stage.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").map((e) => e.dataset.fancyGraphLabel!);
const kitLenses: CosmosLenses = { systems: { by: { field: "language" } }, galaxies: { by: { field: "family" } } };

describe("the `cosmos` prop: lenses as JSON", () => {
  it("configures the preset in place, and `getState` reports it", () => {
    const s = mount({ data: cosmosData(120, 160, 1), cosmos: { galaxies: { by: { field: "type" } } }, reducedMotion: true });
    expect(s.ref.current!.getClusters().map((c) => c.id)).toContain("agent");
    s.render({ data: cosmosData(120, 160, 1), cosmos: { galaxies: false }, reducedMotion: true });
    s.frames(1);
    expect(s.ref.current!.getClusters()).toEqual([]);
  });
});

describe("lens switches and sorts animate", () => {
  const data = kitData(40);
  const sorted = (dir: "asc" | "desc"): CosmosLenses => ({ systems: { by: { field: "language" } }, sort: { by: "label", dir }, comets: false });

  it("bodies fly from their old orbit to their new one", () => {
    const s = mount({ data, cosmos: sorted("asc"), paused: true });
    const id = data.nodes[2].id;
    const before = s.ref.current!.positionOf(id)!;
    s.render({ data, cosmos: sorted("desc"), paused: true });
    s.frames(1);
    const early = s.ref.current!.positionOf(id)!;
    s.frames(400);
    const after = s.ref.current!.positionOf(id)!;
    expect(dist(before, after)).toBeGreaterThan(5);
    // Mid-flight: not yet there, already left.
    expect(dist(early, after)).toBeGreaterThan(1);
    expect(dist(early, before)).toBeLessThan(dist(before, after));
    // Landed exactly on the new orbit.
    const m = metaOf(s.ref);
    const i = m.index.get(id)!;
    const star = s.ref.current!.positionOf(String(m.ids[m.bodies[i].parent]))!;
    expect(dist(after, star)).toBeCloseTo(m.bodies[i].orbitRadius, 1);
  });

  it("regrouping the data (node.group) re-forms the default galaxies, and the bodies fly there", () => {
    const s = mount({ data: kitGrouped(150, "family"), paused: true });
    expect(s.ref.current!.getClusters().map((c) => c.id).sort()).toEqual(["commerce", "documents", "engines", "surfaces", "tooling"]);
    const id = "pkg-30";
    const before = s.ref.current!.positionOf(id)!;
    s.render({ data: kitGrouped(150, "language"), paused: true });
    s.frames(1);
    const early = s.ref.current!.positionOf(id)!;
    s.frames(400);
    const after = s.ref.current!.positionOf(id)!;
    expect(s.ref.current!.getClusters().map((c) => c.id).sort()).toEqual(["php", "python", "typescript"]);
    expect(dist(before, after)).toBeGreaterThan(20);
    expect(dist(early, after)).toBeGreaterThan(1);
    expect(dist(early, before)).toBeLessThan(dist(before, after));
  });

  it("under reduced motion the change is immediate", () => {
    const s = mount({ data, cosmos: sorted("asc"), reducedMotion: true });
    const id = data.nodes[2].id;
    s.render({ data, cosmos: sorted("desc"), reducedMotion: true });
    s.frames(1);
    const m = metaOf(s.ref);
    const i = m.index.get(id)!;
    const star = s.ref.current!.positionOf(String(m.ids[m.bodies[i].parent]))!;
    expect(dist(s.ref.current!.positionOf(id)!, star)).toBeCloseTo(m.bodies[i].orbitRadius, 1);
  });
});

describe("light: curved arcs that follow the arms and glow on focus", () => {
  it("an arc bows away from the straight line between its ends", () => {
    const pts = lightArcPoints([0, 0, 0], [100, 0, 0], null, [0, 0, 1], 0.2, 8);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual([0, 0, 0]);
    expect(pts[8].map((x) => +x.toFixed(6))).toEqual([100, 0, 0]);
    expect(Math.abs(pts[4][1])).toBeGreaterThan(8);
    expect(pts[4][2]).toBeCloseTo(0, 6);
  });

  it("inside a galaxy, a link between two points on one arm runs along the arm (theta - twist * sqrt(f) stays constant)", () => {
    const gal = { center: [10, 20, 30] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], radius: 400, twist: 3.1 };
    const onArm = (f: number) => {
      const r = gal.radius * (0.06 + 0.94 * Math.sqrt(f));
      const th = 0.7 + gal.twist * Math.sqrt(f);
      return [gal.center[0] + Math.cos(th) * r, gal.center[1] + Math.sin(th) * r, gal.center[2]] as [number, number, number];
    };
    const pts = lightArcPoints(onArm(0.15), onArm(0.8), gal, [0, 0, 1], 0.2, 16);
    for (const p of pts) {
      const x = p[0] - gal.center[0], y = p[1] - gal.center[1];
      const sf = Math.min(1, Math.max(0, (Math.hypot(x, y) / gal.radius - 0.06) / 0.94));
      const phi = Math.atan2(y, x) - gal.twist * sf;
      expect(Math.cos(phi - 0.7)).toBeCloseTo(1, 5);
    }
  });

  it("the sky stays clean until you ask: in \"focus\" mode, no light until something is focused, then only its own", () => {
    const data = relationData();
    const s = mount({ data, cosmos: { systems: { by: { relation: ["written-in", "part-of"] } } }, reducedMotion: true, flyOnSelect: false });
    s.frames(1);
    const geo = (s.scene.getObjectsByProperty("name", "cosmos-light")[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    expect(geo.instanceCount).toBe(0);
    act(() => s.ref.current!.select("p1"));
    s.frames(1);
    const own = data.links.filter((l) => (l.source === "p1" || l.target === "p1") && l.kind !== "written-in" && l.kind !== "part-of").length;
    expect(own).toBeGreaterThan(0);
    expect(geo.instanceCount).toBe(own * 10);
  });

  it("the light layer draws only light (never gravity), as arcs, brighter for the focus", () => {
    const data = relationData();
    const s = mount({ data, cosmos: { systems: { by: { relation: ["written-in", "part-of"] } }, galaxies: false }, reducedMotion: true, linkVisibility: "all" });
    s.frames(1);
    const mesh = s.scene.getObjectsByProperty("name", "cosmos-light")[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const geo = mesh.geometry as THREE.InstancedBufferGeometry;
    const light = data.links.filter((l) => l.kind !== "written-in" && l.kind !== "part-of").length;
    const segments = geo.instanceCount;
    expect(segments % light).toBe(0);
    expect(segments / light).toBeGreaterThanOrEqual(4);
    const width = geo.getAttribute("iStyle") as THREE.InterleavedBufferAttribute;
    const normal = width.getX(0);
    act(() => {
      s.ref.current!.select("p1");
    });
    s.frames(1);
    const lit: number[] = [];
    for (let k = 0; k < geo.instanceCount; k++) lit.push((geo.getAttribute("iStyle") as THREE.InterleavedBufferAttribute).getX(k));
    expect(Math.max(...lit)).toBeGreaterThan(normal * 1.5);
  });
});

describe("semantic zoom labels, on by default", () => {
  it("from far, galaxy names and no planet names; close to a system, its planets are named", () => {
    const s = mount({ data: kitData(60), cosmos: kitLenses, reducedMotion: true, flyOnSelect: false });
    s.frames(2);
    const m = metaOf(s.ref);
    const kindOf = (id: string) => m.bodies[m.index.get(id)!].kind;
    expect(s.stage.overlayRoot.querySelectorAll("[data-fancy-graph-cluster-label]").length).toBeGreaterThan(0);
    expect(shownLabels(s).filter((id) => kindOf(id) === PLANET || kindOf(id) === MOON)).toEqual([]);
    const star = m.ids[m.bodies.findIndex((b) => b.kind === STAR && b.galaxy >= 0)];
    act(() => {
      s.ref.current!.flyTo(String(star), { distance: 140 });
    });
    s.frames(60);
    expect(shownLabels(s).filter((id) => kindOf(id) === PLANET).length).toBeGreaterThan(0);
  });

  it("`labels: \"size\"` gives back plain size-ranked labels: only what is big on screen", () => {
    const data = cosmosData(300, 420, 1);
    const semantic = mount({ data, reducedMotion: true });
    semantic.frames(2);
    const named = shownLabels(semantic);
    // Semantic: free stars with planets are named from far, however small they are drawn.
    expect(named.length).toBeGreaterThan(3);
    act(() => root.unmount());
    root = createRoot(container);
    const s = mount({ data, cosmos: { labels: "size" }, reducedMotion: true });
    s.frames(2);
    const shown = shownLabels(s);
    expect(shown.length).toBeLessThan(named.length);
    for (const id of shown) expect(s.ref.current!.screenPosition(id)!.radius).toBeGreaterThanOrEqual(3.5);
  });
});

describe("flight: selection frames the body's scale, and breadcrumbs climb back out", () => {
  const lenses: CosmosLenses = { systems: { by: { relation: ["written-in", "part-of"] } }, galaxies: { by: { relation: "member-of" } } };

  it("selecting a star frames its whole system; selecting a core frames its galaxy", () => {
    const s = mount({ data: relationData(), cosmos: lenses, reducedMotion: true });
    const m = metaOf(s.ref);
    const fit = (r: number) => {
      const fov = THREE.MathUtils.degToRad(s.camera.fov);
      const aspect = Math.max(0.2, Math.min(1, s.camera.aspect));
      return (r / Math.sin(Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2)) * 1.05;
    };
    act(() => s.ref.current!.select("typescript"));
    s.frames(3);
    const ts = m.bodies[m.index.get("typescript")!];
    expect(s.ref.current!.getCamera().distance / fit(ts.extent)).toBeCloseTo(1, 1);
    act(() => s.ref.current!.select("languages"));
    s.frames(3);
    const gal = m.galaxies.find((g) => g.key === "languages")!;
    expect(s.ref.current!.getCamera().distance / fit(gal.radius * 1.25)).toBeCloseTo(1, 1);
  });

  it("breadcrumbs: universe > galaxy > star > planet > moon, through the handle, a prop and a handle on the root", () => {
    const onBreadcrumbsChange = vi.fn();
    const s = mount({ data: relationData(), cosmos: lenses, reducedMotion: true, onBreadcrumbsChange });
    act(() => s.ref.current!.select("p0-m1"));
    s.frames(1);
    const crumbs = s.ref.current!.getBreadcrumbs();
    expect(crumbs.map((c) => c.id)).toEqual([null, "languages", "typescript", "p0", "p0-m1"]);
    expect(crumbs[0].label).toBe("Universe");
    expect(onBreadcrumbsChange).toHaveBeenLastCalledWith(crumbs);
    const rootEl = s.stage.canvas.parentElement;
    void rootEl;
    // Climb out: selecting a crumb flies there.
    act(() => s.ref.current!.select("typescript"));
    s.frames(1);
    expect(s.ref.current!.getBreadcrumbs().map((c) => c.id)).toEqual([null, "languages", "typescript"]);
    act(() => s.ref.current!.select(null));
    s.frames(1);
    expect(s.ref.current!.getBreadcrumbs().map((c) => c.id)).toEqual([null]);
  });
});

describe("constellations: their own layer, selection and handles", () => {
  const lenses: CosmosLenses = { systems: { by: { field: "language" } }, comets: false, constellations: [{ id: "ai", label: "AI", match: { field: "features", value: "ai" } }, { id: "3d", label: "3D", match: { field: "features", value: "3d" } }] };

  it("each constellation is a layer, under one `constellations` switch", () => {
    const s = mount({ data: kitData(60), cosmos: lenses, reducedMotion: true });
    const ids = s.ref.current!.getLayers().map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["constellations", "constellation:ai", "constellation:3d"]));
    const fig = (id: string) => s.scene.getObjectsByProperty("name", `cosmos-constellation-${id}`)[0];
    /** Drawn: the figure and every group above it visible. */
    const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
    expect(shown(fig("ai"))).toBe(true);
    act(() => {
      s.ref.current!.setLayer("constellation:ai", false);
    });
    s.frames(1);
    expect(shown(fig("ai"))).toBe(false);
    expect(shown(fig("3d"))).toBe(true);
    act(() => {
      s.ref.current!.setLayer("constellations", false);
    });
    s.frames(1);
    expect(shown(fig("3d"))).toBe(false);
  });

  it("labels carry their own handle and select their constellation when clicked; the selection is controlled", () => {
    const onSelectedConstellationChange = vi.fn();
    const s = mount({ data: kitData(60), cosmos: lenses, reducedMotion: true, onSelectedConstellationChange });
    s.frames(2);
    const label = s.stage.overlayRoot.querySelector<HTMLElement>('[data-fancy-graph-constellation-label="ai"]')!;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("AI");
    act(() => label.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectedConstellationChange).toHaveBeenCalledWith("ai", expect.objectContaining({ source: "user" }));
    expect(s.ref.current!.getConstellations().map((c) => c.id)).toEqual(["ai", "3d"]);

    s.render({ data: kitData(60), cosmos: lenses, reducedMotion: true, selectedConstellation: "ai" });
    s.frames(2);
    const rootAttr = s.stage.overlayRoot.closest("[data-fancy-graph]") ?? null;
    void rootAttr;
    expect(s.ref.current!.getState().constellation).toBe("ai");
    const ai = s.ref.current!.getConstellations().find((c) => c.id === "ai")!;
    // Its members are highlighted and labelled, like search matches.
    expect(shownLabels(s).some((id) => ai.members.includes(id))).toBe(true);
  });

  it("names never pile up: each label sits at its own member, apart from the others", () => {
    const s = mount({ data: kitData(120), cosmos: { systems: { by: { field: "language" } }, comets: false, constellations: { by: { field: "features" } } }, reducedMotion: true });
    s.frames(2);
    const at = [...s.stage.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-constellation-label]")]
      .filter((e) => e.style.display !== "none")
      .map((e) => /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(e.style.transform)!.slice(1).map(Number));
    expect(at.length).toBe(5);
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1])).toBeGreaterThan(48);
    // Nor on a node's label: each name's middle is clear of every node label's box.
    const boxes = [...s.stage.overlayRoot.querySelectorAll<HTMLElement>("[data-fancy-graph-label]")]
      .filter((e) => e.style.display !== "none")
      .map((e) => [.../translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(e.style.transform)!.slice(1).map(Number), (e.textContent ?? "").length * 6.2]);
    expect(boxes.length).toBeGreaterThan(0);
    for (const [x, y] of at) for (const [bx, by, bw] of boxes) expect(x > bx - 4 && x < bx + bw + 4 && y > by - 6 && y < by + 20, `${x},${y} in ${bx},${by}`).toBe(false);
  });

  it("the handle selects one for an agent", () => {
    const onSelectedConstellationChange = vi.fn();
    const s = mount({ data: kitData(60), cosmos: lenses, reducedMotion: true, onSelectedConstellationChange });
    act(() => s.ref.current!.selectConstellation("3d", { source: "agent" }));
    expect(onSelectedConstellationChange).toHaveBeenCalledWith("3d", { source: "agent" });
    expect(s.ref.current!.selectConstellation("nope")).toBe(false);
  });
});

describe("comets on the GPU", () => {
  it("one instance per comet; the tail's particles live in the geometry, so per-frame CPU work is per comet", () => {
    const data = kitData(60);
    const s = mount({ data, cosmos: { systems: { by: { field: "language" } }, comets: ["multi-membership", { field: "releasedAt", within: "14d", now: KIT_NOW }] } });
    s.frames(3);
    const tails = s.scene.getObjectsByProperty("name", "cosmos-comet-tails")[0] as THREE.Mesh;
    const geo = tails.geometry as THREE.InstancedBufferGeometry;
    const m = metaOf(s.ref);
    expect(m.comets.length).toBeGreaterThan(3);
    expect(geo.instanceCount).toBe(m.comets.length);
    const particles = geo.getIndex()!.count / 6;
    expect(particles).toBeGreaterThanOrEqual(24);
    const attr = geo.getAttribute("iHead") as THREE.InterleavedBufferAttribute;
    expect(attr.data.array.length).toBe(m.comets.length * attr.data.stride);
    expect(tails.parent!.name).toBe("fancy-graph-layer-comets");
  });
});

describe("data-driven node visuals", () => {
  const bodyAttr = (s: S, name: string) => {
    const mesh = s.scene.getObjectsByProperty("name", "cosmos-bodies")[0] as THREE.Mesh;
    return (mesh.geometry as THREE.InstancedBufferGeometry).getAttribute(name) as THREE.InterleavedBufferAttribute;
  };
  /** The instance slot a node was written to this frame (bodies are drawn back to front). */
  const slotOf = (s: S, ref: { current: GraphScene3DHandle | null }, id: string) => {
    const p = ref.current!.positionOf(id)!;
    const pos = bodyAttr(s, "iPos");
    for (let k = 0; k < (pos.data as THREE.InstancedInterleavedBuffer).count; k++) if (Math.abs(pos.getX(k) - p[0]) < 1e-3 && Math.abs(pos.getY(k) - p[1]) < 1e-3 && Math.abs(pos.getZ(k) - p[2]) < 1e-3) return k;
    return -1;
  };

  it("skin, size, atmosphere and rings come from the node's fields, over the preset's defaults", () => {
    const data: GraphData = {
      nodes: [
        { id: "sun", label: "Sun" },
        { id: "ice", label: "Ice world", size: 9, cosmos: { skin: { type: "ice", colors: ["#88ccff", "#ffffff"] }, atmosphere: { color: "#ff0000", thickness: 0.4, glow: 1.5 }, rings: { color: "#00ff00", inner: 1.5, outer: 2.6, opacity: 0.8 } } },
        { id: "plain", label: "Plain" },
      ],
      links: [{ source: "ice", target: "sun", kind: "orbits" }, { source: "plain", target: "sun", kind: "orbits" }],
    };
    const s = mount({ data, cosmos: { systems: { by: { relation: "orbits" } } }, reducedMotion: true });
    s.frames(1);
    const k = slotOf(s, s.ref, "ice");
    expect(k).toBeGreaterThanOrEqual(0);
    expect(bodyAttr(s, "iSize").getX(k)).toBe(9);
    const skin = bodyAttr(s, "iSkin");
    expect(skin.getX(k)).toBe(3); // ice
    expect(skin.getY(k)).toBeCloseTo(0.4); // atmosphere thickness
    expect(skin.getZ(k)).toBeCloseTo(1.5); // glow
    expect(skin.getW(k)).toBeCloseTo(0.8); // ring opacity
    const atmo = bodyAttr(s, "iAtmo");
    expect([atmo.getX(k), atmo.getY(k), atmo.getZ(k)]).toEqual([1, 0, 0]);
    const ring = bodyAttr(s, "iRing");
    expect(ring.getX(k)).toBeCloseTo(1.5, 5);
    expect(ring.getY(k)).toBeCloseTo(2.6, 5);
    const second = bodyAttr(s, "iColor2");
    expect([second.getX(k), second.getY(k), second.getZ(k)]).toEqual([1, 1, 1]);
    // No fields: the preset's default look for its kind, never nothing.
    const p = slotOf(s, s.ref, "plain");
    expect(skin.getX(p)).toBeGreaterThan(0);
  });

  it("a bad look value is ignored and reported, never thrown", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const data: GraphData = { nodes: [{ id: "a", cosmos: { skin: "plasma" as never, texture: "javascript:alert(1)" } as never }], links: [] };
    const s = mount({ data, reducedMotion: true });
    const issues = metaOf(s.ref).lookIssues.map((x) => x.field).sort();
    expect(issues).toEqual(["cosmos.skin", "cosmos.texture"]);
  });

  it("image textures only from a URL the host supplied, one textured layer per image, capped by limits.maxTextures", () => {
    const tex = (i: number) => ({ id: `t${i}`, cosmos: { texture: `https://example.org/planet-${i}.jpg` } });
    const data: GraphData = { nodes: [{ id: "sun" }, ...Array.from({ length: 5 }, (_, i) => tex(i))], links: Array.from({ length: 5 }, (_, i) => ({ source: `t${i}`, target: "sun", kind: "orbits" })) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(function () {
      return new THREE.Texture();
    });
    const s = mount({ data, cosmos: { systems: { by: { relation: "orbits" } } }, reducedMotion: true, limits: { maxTextures: 3 } });
    s.frames(1);
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.map((c) => c[0]).sort()).toEqual(["https://example.org/planet-0.jpg", "https://example.org/planet-1.jpg", "https://example.org/planet-2.jpg"]);
    expect(metaOf(s.ref).lookIssues.filter((x) => x.field === "cosmos.texture")).toHaveLength(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/maxTextures/);
  });

  it("a core and a star are their own body kinds, so each gets a selection ring", () => {
    const s = mount({ data: relationData(), cosmos: { systems: { by: { relation: "written-in" } }, galaxies: { by: { relation: "member-of" } } }, reducedMotion: true });
    const m = metaOf(s.ref);
    expect(m.bodies[m.index.get("languages")!].kind).toBe(CORE);
    act(() => s.ref.current!.select("languages"));
    s.frames(1);
    const k = slotOf(s, s.ref, "languages");
    const data4 = bodyAttr(s, "iData");
    expect(data4.getX(k)).toBe(CORE);
    expect(data4.getZ(k)).toBe(1);
  });
});
