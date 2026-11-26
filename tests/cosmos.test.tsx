// @vitest-environment jsdom
/**
 * The first acceptance case (CC-fancy-0062): beachhead's Cosmos view, rebuilt
 * entirely through fancy-graph's plug points. The domain mapping and the look
 * live in examples/cosmos/, exactly where they would live in the consumer's
 * app; this file proves the kit gives them everything they need.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayoutRunner, normalizeGraph, resolveLimits } from "../src/core";
import { GraphSceneOnStage, type GraphScene3DHandle, type StageLike } from "../src/three/index";
import { ASTEROID, cosmosLayout, PLANET, STAR, type CosmosMeta } from "../examples/cosmos/layout";
import { cosmosRenderers } from "../examples/cosmos/renderers";
import { cosmosData } from "../examples/cosmos/data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const env3 = { dimensions: 3 as const, reducedMotion: false, limits: resolveLimits() };
const node = (id: string, group = "agent") => ({ id, label: id, group });

describe("cosmosLayout through the layout contract", () => {
  it("makes one galaxy cluster per node type and keeps every node", () => {
    const g = normalizeGraph({ nodes: [node("a"), node("b"), node("c", "problem"), node("d", "solution")], links: [{ source: "a", target: "b" }] });
    const r = createLayoutRunner(cosmosLayout(), g, env3);
    expect(r.clusters()!.map((c) => c.id).sort()).toEqual(["agent", "problem", "solution"]);
    expect((r.meta as CosmosMeta).bodies).toHaveLength(4);
  });

  it("makes the best-connected node a star, linked nodes planets and unlinked nodes asteroids", () => {
    const g = normalizeGraph({ nodes: ["hub", "x", "y", "lonely"].map((id) => node(id)), links: [{ source: "hub", target: "x", weight: 3 }, { source: "hub", target: "y", weight: 2 }] });
    const m = createLayoutRunner(cosmosLayout(), g, env3).meta as CosmosMeta;
    expect(m.bodies.map((b) => b.kind)).toEqual([STAR, PLANET, PLANET, ASTEROID]);
    expect(m.bodies[1].parent).toBe(0);
  });

  it("moves orbiters every frame while keeping them at their orbit radius", () => {
    const g = normalizeGraph({ nodes: Array.from({ length: 30 }, (_, i) => node(`n${i}`)), links: Array.from({ length: 29 }, (_, i) => ({ source: "n0", target: `n${i + 1}` })) });
    const r = createLayoutRunner(cosmosLayout(), g, env3);
    expect(r.animated).toBe(true);
    const m = r.meta as CosmosMeta;
    r.tick(0.1);
    const before = Float32Array.from(r.positions);
    r.tick(2);
    let moved = 0;
    m.bodies.forEach((b, i) => {
      if (b.parent < 0) return;
      const p = m.bodies[b.parent].home;
      const d = Math.hypot(r.positions[i * 3] - p[0], r.positions[i * 3 + 1] - p[1], r.positions[i * 3 + 2] - p[2]);
      expect(d).toBeCloseTo(b.orbitRadius, 1);
      if (Math.abs(r.positions[i * 3] - before[i * 3]) > 1e-3) moved++;
    });
    expect(moved).toBeGreaterThan(0);
  });

  it("colours each galaxy cluster from the app's palette, so labels match the discs", () => {
    const g = normalizeGraph({ nodes: [node("a"), node("p", "problem")], links: [] });
    const cs = createLayoutRunner(cosmosLayout({ colors: { agent: "#112233" } }), g, env3).clusters()!;
    expect(cs.find((c) => c.id === "agent")!.color).toBe("#112233");
    expect(cs.find((c) => c.id === "problem")!.color).toBeUndefined();
  });

  it("is identical on every build", () => {
    const { nodes, links } = cosmosData(200, 300, 7);
    const a = createLayoutRunner(cosmosLayout(), normalizeGraph({ nodes, links }), env3);
    const b = createLayoutRunner(cosmosLayout(), normalizeGraph({ nodes, links }), env3);
    a.tick(1);
    b.tick(1);
    expect([...a.positions]).toEqual([...b.positions]);
  });

  it("keeps galaxies from overlapping", () => {
    const { nodes, links } = cosmosData(650, 900, 1);
    const cs = createLayoutRunner(cosmosLayout(), normalizeGraph({ nodes, links }), env3).clusters()!;
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        const d = Math.hypot(cs[i].center[0] - cs[j].center[0], cs[i].center[1] - cs[j].center[1], cs[i].center[2] - cs[j].center[2]);
        expect(d).toBeGreaterThan(cs[i].radius + cs[j].radius);
      }
  });
});

describe("the cosmos look through pluggable 3D layers", () => {
  function fakeStage() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 60000);
    camera.position.set(0, 0, 3000);
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 1000 });
    Object.defineProperty(canvas, "clientHeight", { value: 700 });
    const subs = new Set<() => void>();
    const target = new THREE.Vector3();
    const controls = { target, update: () => camera.lookAt(target) };
    const stage: StageLike = {
      scene, camera, canvas, overlayRoot: document.createElement("div"),
      renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
      controls: controls as unknown as StageLike["controls"],
      onFrame: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    };
    return { stage, scene, frame: () => { controls.update(); camera.updateMatrixWorld(); subs.forEach((cb) => cb()); }, target };
  }

  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));

  it("draws stars, planets and asteroids with a custom instanced shader, galaxies as cluster discs, and a sky behind them", () => {
    const s = fakeStage();
    const { nodes, links } = cosmosData(650, 900, 1);
    act(() => root.render(<GraphSceneOnStage stage={s.stage} data={{ nodes, links }} layout={cosmosLayout()} renderers={cosmosRenderers()} />));
    act(() => s.frame());
    const meshes: THREE.Object3D[] = [];
    s.scene.traverse((o) => meshes.push(o));
    const bodies = meshes.find((o) => o.name === "cosmos-bodies") as THREE.Mesh;
    const discs = meshes.find((o) => o.name === "cosmos-galaxies") as THREE.Mesh;
    const sky = meshes.find((o) => o.name === "cosmos-sky") as THREE.Points;
    expect(bodies).toBeDefined();
    expect((bodies.material as THREE.RawShaderMaterial).blending).toBe(THREE.CustomBlending);
    expect((bodies.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(650);
    expect((discs.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(new Set(nodes.map((n) => n.group)).size);
    expect(sky).toBeInstanceOf(THREE.Points);
    expect(sky.renderOrder).toBeLessThan(bodies.renderOrder);
  });

  it("flies to a galaxy, selects and follows a world, and labels galaxies", () => {
    const s = fakeStage();
    const { nodes, links } = cosmosData(120, 160, 2);
    const ref = createRef<GraphScene3DHandle>();
    const onSelectedChange = vi.fn();
    act(() => root.render(<GraphSceneOnStage ref={ref} stage={s.stage} data={{ nodes, links }} layout={cosmosLayout()} renderers={cosmosRenderers()} reducedMotion onSelectedChange={onSelectedChange} clusterLabel={(c) => `${c.label} · ${c.members.length}`} />));
    act(() => s.frame());
    const galaxy = ref.current!.getClusters()[0];
    act(() => {
      ref.current!.flyToCluster(galaxy.id);
      s.frame();
    });
    expect(s.target.x).toBeCloseTo(galaxy.center[0], 0);
    act(() => s.frame());
    const label = s.stage.overlayRoot.querySelector(`[data-fancy-graph-cluster-label="${galaxy.id}"]`);
    expect(label?.textContent).toMatch(/·/);
    act(() => {
      ref.current!.select(nodes[0].id, { source: "agent" });
      s.frame();
    });
    expect(onSelectedChange).toHaveBeenCalledWith(nodes[0].id, expect.objectContaining({ source: "agent" }));
  });
});
