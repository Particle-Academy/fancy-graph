import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { normalizeGraph, type GraphCluster } from "../src/core";
import { createInstancedLayer, createPointsLayer, linkLayer3D, nodeLayer3D, type LayerFrame3D } from "../src/three/index";

const graph = normalizeGraph({
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }],
});

function frame(over: Partial<LayerFrame3D> = {}): LayerFrame3D {
  const n = graph.nodes.length;
  return {
    graph,
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]),
    order: new Uint32Array([2, 0, 1]),
    states: new Uint8Array(n),
    linkStates: new Uint8Array(graph.links.length),
    sizes: new Float32Array([1, 2, 3]),
    colors: new Float32Array(n * 3).fill(0.5),
    clusters: [],
    time: 1,
    dt: 0.016,
    width: 800,
    height: 600,
    pixelRatio: 1,
    camera: new THREE.PerspectiveCamera(),
    meta: null,
    focus: -1,
    focused: -1,
    selected: -1,
    hovered: -1,
    matches: null,
    linkVisibility: "all",
    ...over,
  };
}

const ctx = (group = new THREE.Group()) => ({ group, renderOrder: 3, graph, meta: null, clusters: [] as GraphCluster[], camera: new THREE.PerspectiveCamera() });

const VS = "in vec3 position; in vec3 iPos; in float iSize; void main(){ gl_Position = vec4(iPos + position * iSize, 1.); }";
const FS = "precision highp float; out vec4 o; void main(){ o = vec4(1.); }";

describe("createInstancedLayer", () => {
  it("mounts a custom instanced RawShaderMaterial (GLSL 3) with premultiplied blending", () => {
    const c = ctx();
    const layer = createInstancedLayer({ vertexShader: VS, fragmentShader: FS, attributes: [{ name: "iPos", size: 3 }, { name: "iSize", size: 1 }], blending: "premultiplied", write: () => {} });
    layer.mount(c);
    const mesh = c.group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.RawShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.RawShaderMaterial);
    expect(mat.glslVersion).toBe(THREE.GLSL3);
    expect(mat.blending).toBe(THREE.CustomBlending);
    expect(mat.blendSrc).toBe(THREE.OneFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mesh.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(mesh.renderOrder).toBe(3);
    expect(mesh.frustumCulled).toBe(false);
  });

  it("supports additive blending", () => {
    const c = ctx();
    createInstancedLayer({ vertexShader: VS, fragmentShader: FS, attributes: [{ name: "iPos", size: 3 }], blending: "additive", write: () => {} }).mount(c);
    expect(((c.group.children[0] as THREE.Mesh).material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
  });

  it("writes every instance from per-frame positions, back to front", () => {
    const c = ctx();
    const layer = createInstancedLayer({
      vertexShader: VS,
      fragmentShader: FS,
      attributes: [{ name: "iPos", size: 3 }, { name: "iSize", size: 1 }],
      write(out, at, i, f) {
        out[at] = f.positions[i * 3];
        out[at + 1] = f.positions[i * 3 + 1];
        out[at + 2] = f.positions[i * 3 + 2];
        out[at + 3] = f.sizes[i];
      },
    });
    layer.mount(c);
    layer.update(frame());
    const geo = (c.group.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    const buf = (geo.getAttribute("iPos") as THREE.InterleavedBufferAttribute).data;
    expect(geo.instanceCount).toBe(3);
    // order [2, 0, 1]: farthest first.
    expect([...buf.array].slice(0, 12)).toEqual([20, 0, 0, 3, 0, 0, 0, 1, 10, 0, 0, 2]);
    const v = buf.version;
    const moved = frame({ positions: new Float32Array([1, 1, 1, 10, 0, 0, 20, 0, 0]) });
    layer.update(moved);
    expect(buf.version).toBeGreaterThan(v);
    expect([...buf.array].slice(4, 7)).toEqual([1, 1, 1]);
  });

  it("keeps the caller's order when sort is none", () => {
    const c = ctx();
    const seen: number[] = [];
    const layer = createInstancedLayer({ vertexShader: VS, fragmentShader: FS, attributes: [{ name: "iPos", size: 3 }], sort: "none", write: (_o, _a, i) => seen.push(i) });
    layer.mount(c);
    layer.update(frame());
    expect(seen).toEqual([0, 1, 2]);
  });

  it("can draw one instance per cluster", () => {
    const c = ctx();
    const clusters: GraphCluster[] = [{ id: "x", center: [1, 2, 3], radius: 5, members: [] }, { id: "y", center: [0, 0, 0], radius: 1, members: [] }];
    const layer = createInstancedLayer({ source: "clusters", vertexShader: VS, fragmentShader: FS, attributes: [{ name: "iPos", size: 3 }], write: (o, at, i, f) => o.set(f.clusters[i].center, at) });
    layer.mount({ ...c, clusters });
    layer.update(frame({ clusters }));
    const geo = (c.group.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    expect(geo.instanceCount).toBe(2);
  });

  it("updates uniforms each frame and disposes what it made", () => {
    const c = ctx();
    const uTime = { value: 0 };
    const layer = createInstancedLayer({ vertexShader: VS, fragmentShader: FS, uniforms: { uTime }, attributes: [{ name: "iPos", size: 3 }], beforeFrame: (u, f) => { u.uTime.value = f.time; }, write: () => {} });
    layer.mount(c);
    layer.update(frame({ time: 4.5 }));
    expect(uTime.value).toBe(4.5);
    layer.dispose();
    expect(c.group.children).toHaveLength(0);
  });
});

describe("default layers", () => {
  it("nodeLayer3D draws one instanced impostor per node", () => {
    const c = ctx();
    const layer = nodeLayer3D();
    layer.mount(c);
    layer.update(frame());
    const geo = (c.group.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    expect(geo.instanceCount).toBe(3);
    expect(((c.group.children[0] as THREE.Mesh).material as THREE.RawShaderMaterial).glslVersion).toBe(THREE.GLSL3);
  });

  it("linkLayer3D draws line segments and hides unfocused links in focus mode", () => {
    const c = ctx();
    const layer = linkLayer3D();
    layer.mount(c);
    layer.update(frame());
    const lines = c.group.children[0] as THREE.LineSegments;
    expect(lines).toBeInstanceOf(THREE.LineSegments);
    expect(lines.geometry.drawRange.count).toBe(4);
    layer.update(frame({ linkVisibility: "focus", focus: 0, linkStates: new Uint8Array([1, 2]) }));
    expect(lines.geometry.drawRange.count).toBe(2);
    layer.update(frame({ linkVisibility: "none" }));
    expect(lines.geometry.drawRange.count).toBe(0);
  });

  it("createPointsLayer makes a static background of points", () => {
    const c = ctx();
    const layer = createPointsLayer({ positions: new Float32Array([0, 0, 1, 0, 1, 0]), attributes: { aSize: { size: 1, array: new Float32Array([1, 2]) } }, vertexShader: VS, fragmentShader: FS, blending: "additive" });
    layer.mount(c);
    const pts = c.group.children[0] as THREE.Points;
    expect(pts).toBeInstanceOf(THREE.Points);
    expect(pts.geometry.getAttribute("aSize").count).toBe(2);
  });
});
