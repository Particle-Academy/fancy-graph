import * as THREE from "@particle-academy/fancy-3d-three/three";
import { hasHighlightRing, LINK_ACTIVE, LINK_DIMMED, NODE_ACTIVE, NODE_NORMAL } from "../interaction";
import type { IndexedLink } from "../types";
import type { GraphLayer3D, LayerContext3D, LayerFrame3D } from "./types";

export type Blending3D = "additive" | "premultiplied" | "normal";

/** Kit uniforms every layer material receives, updated each frame. */
export interface KitUniforms {
  uTime: THREE.IUniform<number>;
  /** Viewport in CSS px. */
  uViewport: THREE.IUniform<THREE.Vector2>;
  uPixelRatio: THREE.IUniform<number>;
}

function applyBlending(m: THREE.Material, blending: Blending3D) {
  if (blending === "additive") m.blending = THREE.AdditiveBlending;
  else if (blending === "normal") m.blending = THREE.NormalBlending;
  else {
    // Premultiplied: rgb already carries alpha, so a=0 adds light and a=1 covers.
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }
}

function kitUniforms(): KitUniforms {
  return { uTime: { value: 0 }, uViewport: { value: new THREE.Vector2(1, 1) }, uPixelRatio: { value: 1 } };
}

function updateKit(u: KitUniforms, f: LayerFrame3D) {
  u.uTime.value = f.time;
  u.uViewport.value.set(f.width, f.height);
  u.uPixelRatio.value = f.pixelRatio;
}

export interface ShaderMaterialSpec {
  vertexShader: string;
  fragmentShader: string;
  uniforms?: Record<string, THREE.IUniform>;
  /** Default `"premultiplied"`. */
  blending?: Blending3D;
  /** Default false: these layers sort themselves back to front instead. */
  depthTest?: boolean;
  depthWrite?: boolean;
}

/** A GLSL 3 RawShaderMaterial with the kit uniforms merged in. */
export function createLayerMaterial(spec: ShaderMaterialSpec): THREE.RawShaderMaterial & { uniforms: Record<string, THREE.IUniform> & KitUniforms } {
  const uniforms = { ...kitUniforms(), ...(spec.uniforms ?? {}) };
  const m = new THREE.RawShaderMaterial({
    vertexShader: spec.vertexShader,
    fragmentShader: spec.fragmentShader,
    uniforms,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: spec.depthTest ?? false,
    depthWrite: spec.depthWrite ?? false,
  });
  applyBlending(m, spec.blending ?? "premultiplied");
  return m as THREE.RawShaderMaterial & { uniforms: Record<string, THREE.IUniform> & KitUniforms };
}

/** A unit quad, -1..1, for instanced impostors. */
export function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export interface InstancedLayerSpec extends ShaderMaterialSpec {
  name?: string;
  /** Per-instance attributes, interleaved in this order. */
  attributes: Array<{ name: string; size: 1 | 2 | 3 | 4 }>;
  /** One instance per node (default) or per cluster. */
  source?: "nodes" | "clusters";
  /** Nodes only. `"back-to-front"` (default) uses the kit's depth order; `"none"` keeps index order. */
  sort?: "back-to-front" | "none";
  /** The instance geometry. Defaults to a unit quad. Must be an InstancedBufferGeometry. */
  geometry?: () => THREE.InstancedBufferGeometry;
  /** Write one instance's attributes at `out[at...]` for node (or cluster) `index`. Called every frame. */
  write(out: Float32Array, at: number, index: number, frame: LayerFrame3D): void;
  /** Skip an instance this frame. */
  include?(index: number, frame: LayerFrame3D): boolean;
  /** Update your own uniforms per frame. */
  beforeFrame?(uniforms: Record<string, THREE.IUniform>, frame: LayerFrame3D): void;
}

/**
 * The building block for custom 3D looks: an instanced mesh with your own
 * GLSL 3 shaders, additive or premultiplied blending, instances written
 * back to front, and fresh per-frame data, so a layout can move every node
 * every frame. This is how the cosmos draws stars, planets and galaxy discs.
 */
export function createInstancedLayer(spec: InstancedLayerSpec): GraphLayer3D & { readonly mesh: THREE.Mesh | null } {
  const stride = spec.attributes.reduce((s, a) => s + a.size, 0);
  let mesh: THREE.Mesh | null = null;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let buffer: THREE.InstancedInterleavedBuffer | null = null;
  let ctx: LayerContext3D | null = null;

  const allocate = (count: number) => {
    buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(1, count) * stride), stride, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    let offset = 0;
    for (const a of spec.attributes) {
      geo!.setAttribute(a.name, new THREE.InterleavedBufferAttribute(buffer, a.size, offset));
      offset += a.size;
    }
  };

  return {
    get mesh() {
      return mesh;
    },
    mount(c) {
      ctx = c;
      geo = spec.geometry ? spec.geometry() : quadGeometry();
      mat = createLayerMaterial(spec);
      const count = spec.source === "clusters" ? c.clusters.length : c.graph.nodes.length;
      allocate(count);
      geo.instanceCount = 0;
      mesh = new THREE.Mesh(geo, mat);
      mesh.name = spec.name ?? "fancy-graph-instanced";
      mesh.frustumCulled = false;
      mesh.renderOrder = c.renderOrder;
      c.group.add(mesh);
    },
    update(f) {
      if (!geo || !mat || !buffer) return;
      updateKit(mat.uniforms, f);
      spec.beforeFrame?.(mat.uniforms, f);
      const clusters = spec.source === "clusters";
      const count = clusters ? f.clusters.length : f.graph.nodes.length;
      if (buffer.count < count) allocate(count);
      const out = buffer.array as Float32Array;
      let w = 0;
      for (let s = 0; s < count; s++) {
        const i = clusters || spec.sort === "none" ? s : f.order[s];
        if (spec.include && !spec.include(i, f)) continue;
        spec.write(out, w * stride, i, f);
        w++;
      }
      geo.instanceCount = w;
      buffer.needsUpdate = true;
    },
    dispose() {
      if (mesh && ctx) ctx.group.remove(mesh);
      geo?.dispose();
      mat?.dispose();
      mesh = null;
      geo = null;
      mat = null;
      buffer = null;
    },
  };
}

export interface PointsLayerSpec extends ShaderMaterialSpec {
  name?: string;
  /** 3 floats per point. */
  positions: Float32Array;
  attributes?: Record<string, { size: 1 | 2 | 3 | 4; array: Float32Array }>;
  beforeFrame?(uniforms: Record<string, THREE.IUniform>, frame: LayerFrame3D): void;
}

/** Static points with your own shader: a star field, dust, a grid. Built once, never rewritten. */
export function createPointsLayer(spec: PointsLayerSpec | ((ctx: LayerContext3D) => PointsLayerSpec)): GraphLayer3D & { readonly points: THREE.Points | null } {
  let pts: THREE.Points | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let s: PointsLayerSpec | null = null;
  let ctx: LayerContext3D | null = null;
  return {
    get points() {
      return pts;
    },
    mount(c) {
      ctx = c;
      s = typeof spec === "function" ? spec(c) : spec;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(s.positions, 3));
      for (const [name, a] of Object.entries(s.attributes ?? {})) geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.size));
      mat = createLayerMaterial(s);
      pts = new THREE.Points(geo, mat);
      pts.name = s.name ?? "fancy-graph-points";
      pts.frustumCulled = false;
      pts.renderOrder = c.renderOrder;
      c.group.add(pts);
    },
    update(f) {
      if (!mat || !s) return;
      updateKit(mat.uniforms, f);
      s.beforeFrame?.(mat.uniforms, f);
    },
    dispose() {
      if (pts && ctx) ctx.group.remove(pts);
      pts?.geometry.dispose();
      mat?.dispose();
      pts = null;
      mat = null;
    },
  };
}

const NODE_VS = /* glsl */ `
in vec3 position; in vec3 iPos; in float iSize; in vec3 iColor; in float iState; in float iFocus;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uViewport; uniform float uMinPx, uHalo;
out vec2 vUv; out vec3 vColor; flat out float vState; flat out float vFocus;
void main(){
  vec4 p = viewMatrix * vec4(iPos, 1.);
  float pxPerWorld = projectionMatrix[1][1] * uViewport.y * .5 / max(1e-3, -p.z);
  float r = max(iSize, uMinPx / pxPerWorld);
  vUv = position.xy * uHalo;
  p.xy += vUv * r;
  vColor = iColor; vState = iState; vFocus = iFocus;
  gl_Position = projectionMatrix * p;
}`;

const NODE_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vColor; flat in float vState; flat in float vFocus; uniform float uHalo; uniform vec3 uFocusColor; out vec4 o;
void main(){
  float d = length(vUv);
  if (d > uHalo) discard;
  vec3 n = vec3(vUv, sqrt(max(0., 1. - d * d)));
  float lit = .3 + .7 * max(0., dot(n, normalize(vec3(-.4, .5, .75))));
  float body = smoothstep(1., .93, d);
  float glow = pow(max(0., 1. - d / uHalo), 2.4) * .5;
  vec3 c = vColor * lit * body + vColor * glow * (1. - body);
  float a = body;
  if (vState > .5 && vState < 1.5) { float ring = smoothstep(.09, 0., abs(d - 1.32)); c += vec3(ring); a = max(a, ring); }
  if (vState > 2.5) { c *= .14; a *= .14; }
  if (vFocus > .5) {
    // Focus: a dashed ring in the focus colour, outside the selection ring.
    float dash = step(.5, fract(atan(vUv.y, vUv.x) * 2.546));
    float ring = smoothstep(.08, 0., abs(d - 1.62)) * dash;
    c = mix(c, uFocusColor, ring); a = max(a, ring);
  }
  o = vec4(c, a);
}`;

/**
 * The node state a shader should draw: an ACTIVE node that is only the focus
 * (neighbourhood mode) is drawn NORMAL, so the selection ring stays the
 * selection's and the focus keeps its own dashed ring. Use it in custom layers.
 */
export function ringState(index: number, f: Pick<LayerFrame3D, "states" | "selected" | "hovered" | "matches">): number {
  const st = f.states[index];
  return st === NODE_ACTIVE && !hasHighlightRing(index, f) ? NODE_NORMAL : st;
}

export interface NodeLayer3DOptions {
  /** Minimum on-screen radius, px. Default 1.6. */
  minPx?: number;
  /** Halo size as a multiple of the radius. Default 1.8. */
  halo?: number;
  /** Focus ring colour, 0..1 rgb. Default blue. */
  focusColor?: [number, number, number];
  blending?: Blending3D;
}

/** The default node look: lit impostor spheres with a soft halo, a ring when active, dimmed otherwise. */
export function nodeLayer3D(opts: NodeLayer3DOptions = {}): GraphLayer3D {
  return createInstancedLayer({
    name: "fancy-graph-nodes",
    vertexShader: NODE_VS,
    fragmentShader: NODE_FS,
    uniforms: { uMinPx: { value: opts.minPx ?? 1.6 }, uHalo: { value: opts.halo ?? 1.8 }, uFocusColor: { value: new THREE.Vector3(...(opts.focusColor ?? [0.23, 0.51, 0.96])) } },
    blending: opts.blending ?? "premultiplied",
    attributes: [{ name: "iPos", size: 3 }, { name: "iSize", size: 1 }, { name: "iColor", size: 3 }, { name: "iState", size: 1 }, { name: "iFocus", size: 1 }],
    write(out, at, i, f) {
      out[at] = f.positions[i * 3];
      out[at + 1] = f.positions[i * 3 + 1];
      out[at + 2] = f.positions[i * 3 + 2];
      out[at + 3] = f.sizes[i];
      out[at + 4] = f.colors[i * 3];
      out[at + 5] = f.colors[i * 3 + 1];
      out[at + 6] = f.colors[i * 3 + 2];
      out[at + 7] = ringState(i, f);
      out[at + 8] = i === f.focused ? 1 : 0;
    },
  });
}

const LINE_VS = /* glsl */ `
in vec3 position; in vec4 aColor; uniform mat4 viewMatrix, projectionMatrix; out vec4 vColor;
void main(){ vColor = aColor; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;
const LINE_FS = /* glsl */ `
precision mediump float; in vec4 vColor; out vec4 o; void main(){ o = vec4(vColor.rgb * vColor.a, 0.); }`;

export interface LinkLayer3DOptions {
  /** Per-link colour (0..1 rgb). Defaults to each endpoint's node colour. */
  color?: (link: IndexedLink, frame: LayerFrame3D) => [number, number, number] | null;
  /** Per-link opacity. Defaults: active 0.85, normal 0.22, dimmed 0.04. */
  alpha?: (link: IndexedLink, state: number, frame: LayerFrame3D) => number;
  blending?: Blending3D;
}

/** The default links: one LineSegments, rewritten from live positions each frame, additive light. */
export function linkLayer3D(opts: LinkLayer3DOptions = {}): GraphLayer3D {
  let lines: THREE.LineSegments | null = null;
  let buffer: THREE.InterleavedBuffer | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let ctx: LayerContext3D | null = null;
  return {
    mount(c) {
      ctx = c;
      buffer = new THREE.InterleavedBuffer(new Float32Array(Math.max(1, c.graph.links.length) * 14), 7);
      buffer.setUsage(THREE.DynamicDrawUsage);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
      geo.setAttribute("aColor", new THREE.InterleavedBufferAttribute(buffer, 4, 3));
      geo.setDrawRange(0, 0);
      mat = createLayerMaterial({ vertexShader: LINE_VS, fragmentShader: LINE_FS, blending: opts.blending ?? "premultiplied" });
      lines = new THREE.LineSegments(geo, mat);
      lines.name = "fancy-graph-links";
      lines.frustumCulled = false;
      lines.renderOrder = c.renderOrder;
      c.group.add(lines);
    },
    update(f) {
      if (!lines || !buffer || !mat) return;
      updateKit(mat.uniforms, f);
      let v = 0;
      if (f.linkVisibility !== "none") {
        const data = buffer.array as Float32Array;
        const anyFocus = f.focus >= 0 || (f.matches?.size ?? 0) > 0;
        for (const l of f.graph.links) {
          const state = f.linkStates[l.index];
          if (f.linkVisibility === "focus" && anyFocus && state !== LINK_ACTIVE) continue;
          const alpha = opts.alpha ? opts.alpha(l, state, f) : state === LINK_ACTIVE ? 0.85 : state === LINK_DIMMED ? 0.04 : 0.22;
          if (alpha <= 0) continue;
          const own = opts.color?.(l, f) ?? null;
          for (let e = 0; e < 2; e++) {
            const i = e ? l.b : l.a;
            const at = v * 7;
            data[at] = f.positions[i * 3];
            data[at + 1] = f.positions[i * 3 + 1];
            data[at + 2] = f.positions[i * 3 + 2];
            data[at + 3] = own ? own[0] : f.colors[i * 3];
            data[at + 4] = own ? own[1] : f.colors[i * 3 + 1];
            data[at + 5] = own ? own[2] : f.colors[i * 3 + 2];
            data[at + 6] = alpha;
            v++;
          }
        }
        buffer.needsUpdate = true;
      }
      lines.geometry.setDrawRange(0, v);
    },
    dispose() {
      if (lines && ctx) ctx.group.remove(lines);
      lines?.geometry.dispose();
      mat?.dispose();
      lines = null;
      buffer = null;
      mat = null;
    },
  };
}
