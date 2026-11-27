/**
 * The cosmos look, the `cosmos` 3D preset's renderers, built only through the
 * public 3D plug points: a seeded sky and galaxy dust as background layers,
 * galaxy discs as a cluster layer, links tinted by galaxy, and stars, planets
 * and asteroids as one instanced custom shader with premultiplied blending
 * (cores cover, glows add light). Colours come from the theme.
 */
import { LINK_ACTIVE, LINK_DIMMED, NODE_ACTIVE, NODE_DIMMED } from "../../interaction";
import { seeded } from "../../random";
import type { GraphCluster, GraphNode } from "../../types";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import type { GraphLayerSpec } from "../../layers";
import { createInstancedLayer, createLayerMaterial, createPointsLayer, linkLayer3D, ringState } from "../layers";
import type { GraphLayer3D, GraphRenderers3D, LayerContext3D, LayerFrame3D } from "../types";
import { spiralPoint, type CosmosMeta } from "./cosmos-layout";

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), w.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), w.x), w.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.1 + vec2(11.7, 5.3); a *= .5; } return s; }
`;

// iData: x = kind (0 star, 1 planet, 2 asteroid), y = seed, z = state (0 normal, 1 highlight, 2 dimmed), w = ringed + 2 * focused.
const BODY_VS = /* glsl */ `
in vec3 position; in vec3 iPos; in float iSize; in vec3 iColor; in vec3 iLight; in vec4 iData;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uViewport;
out vec2 vUv; out vec3 vColor; out vec3 vLight; out float vPx; flat out vec4 vData;
void main(){
  vec4 p = viewMatrix * vec4(iPos, 1.);
  float pxPerWorld = projectionMatrix[1][1] * uViewport.y * .5 / max(1., -p.z);
  float kind = iData.x;
  float r = max(iSize, (kind < .5 ? 3. : kind < 1.5 ? 2. : 1.3) / pxPerWorld);
  float reach = kind < .5 ? 4.4 : (mod(iData.w, 2.) > .5 || iData.w > 1.5) ? 2.5 : 1.8;
  vPx = r * pxPerWorld;
  vUv = position.xy * reach;
  vLight = normalize((viewMatrix * vec4(iLight, 1.)).xyz - p.xyz + vec3(1e-4));
  p.xy += vUv * r;
  vColor = iColor; vData = iData;
  gl_Position = projectionMatrix * p;
}`;

const BODY_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vColor; in vec3 vLight; in float vPx; flat in vec4 vData;
uniform float uTime; out vec4 o;
${NOISE}
void main(){
  float d = length(vUv), kind = vData.x, seed = vData.y, state = vData.z;
  vec3 c = vec3(0.); float a = 0.;
  if (kind < .5) {
    // Star: a mottled disc, a wide corona and four faint spikes. The corona has alpha 0, so it only adds light.
    float disc = smoothstep(1., .88, d);
    float boil = fbm(vUv * 3. + seed * 31. + uTime * .04);
    vec3 surface = mix(vColor, vec3(1.), .5 + .35 * boil);
    float corona = pow(max(0., 1. - d / 4.4), 2.4) * .8 + pow(max(0., 1. - d / 2.), 3.) * .6;
    float spikes = pow(max(0., 1. - abs(vUv.x) * 3.), 8.) * max(0., 1. - abs(vUv.y) / 4.4) + pow(max(0., 1. - abs(vUv.y) * 3.), 8.) * max(0., 1. - abs(vUv.x) / 4.4);
    c = surface * disc + (mix(vColor, vec3(1.), .3) * corona + vColor * spikes * .25) * (1. - disc);
    a = disc;
  } else {
    float edge = 1.;
    if (kind > 1.5) edge = .8 + .2 * vnoise(vec2(atan(vUv.y, vUv.x) * 1.7 + seed * 40., seed * 7.));
    float sn = sin(seed * 6.283), cs = cos(seed * 6.283);
    vec2 q = mat2(cs, -sn, sn, cs) * vUv;
    if (mod(vData.w, 2.) > .5) {
      float rr = length(vec2(q.x, q.y / .32));
      float band = smoothstep(1.3, 1.4, rr) * smoothstep(2.3, 2.1, rr) * (.5 + .5 * vnoise(vec2(rr * 14., seed * 17.)));
      if (band > 0. && (q.y < 0. || d > edge)) { c = mix(vColor, vec3(.95, .9, .82), .5) * band * .7; a = band * .7; }
    }
    if (d < edge) {
      float dn = d / edge;
      vec3 n = vec3(vUv / edge, sqrt(max(0., 1. - dn * dn)));
      float lon = atan(n.x, n.z) + uTime * (.06 + seed * .1), lat = asin(clamp(n.y, -1., 1.));
      vec3 albedo;
      if (kind > 1.5) albedo = mix(vec3(.32, .3, .28), vColor * .5, .3) * (.6 + .8 * fbm(vUv * 5. + seed * 23.));
      else {
        float bands = fbm(vec2(lon * 1.5 + seed * 41., lat * (fract(seed * 7.) > .5 ? 6.5 : 2.4)));
        albedo = mix(vColor * .32, mix(vColor, vec3(1.), .35), smoothstep(.3, .7, bands));
      }
      float lit = max(0., dot(n, vLight));
      float amb = kind > 1.5 ? .25 : .08;
      vec3 body = albedo * (amb + (1. - amb) * smoothstep(-.1, .85, lit));
      if (kind < 1.5) body += vColor * pow(1. - n.z, 2.5) * (.2 + .9 * lit);
      // Small on screen: draw a flat dot so far planets stay legible.
      body = mix(body, mix(vColor, vec3(1.), .2) * .95, smoothstep(7., 3., vPx));
      float cover = smoothstep(1., .94, dn);
      c = mix(c, body, cover); a = mix(a, 1., cover);
    } else if (kind < 1.5) {
      c += vColor * pow(max(0., 1. - (d - 1.) / .5), 3.) * .35;
    }
  }
  if (state > .5 && state < 1.5) { float ring = smoothstep(.07, 0., abs(d - 1.6)); c += vec3(ring); a = max(a, ring); }
  if (state > 1.5) { c *= .13; a *= .13; }
  if (vData.w > 1.5) {
    float dash = step(.5, fract(atan(vUv.y, vUv.x) * 2.546));
    float ring = smoothstep(.07, 0., abs(d - 2.)) * dash;
    c = mix(c, vec3(.23, .51, .96), ring); a = max(a, ring);
  }
  o = vec4(c, a);
}`;

const DISC_VS = /* glsl */ `
in vec3 position; in vec3 iCenter; in vec3 iU; in vec3 iV; in vec3 iColor; in vec3 iMisc;
uniform mat4 viewMatrix, projectionMatrix;
out vec2 vUv; out vec3 vColor; flat out vec3 vMisc;
void main(){
  vUv = position.xy; vColor = iColor; vMisc = iMisc;
  vec3 w = iCenter + (iU * position.x + iV * position.y) * iMisc.x * 1.25;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

const DISC_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vColor; flat in vec3 vMisc; out vec4 o;
${NOISE}
void main(){
  float r = length(vUv);
  if (r > 1.) discard;
  float arms = vMisc.y, seed = vMisc.z;
  float th = atan(vUv.y, vUv.x) - seed * 6.283 - 4.2 * sqrt(r / .8);
  float arm = pow(.5 + .5 * cos(th * arms), 2.2);
  float gas = fbm(vUv * 5.5 + seed * 29.);
  float fade = pow(1. - r, 1.7);
  float core = exp(-r * r * 90.);
  vec3 tint = mix(vColor, vec3(.5, .56, 1.), .28);
  o = vec4(tint * (arm * (.3 + gas) * .44 + gas * .08) * fade + mix(vColor, vec3(1., .95, .86), .7) * core * .55, 0.);
}`;

const POINT_VS = /* glsl */ `
in vec3 position; in vec3 aColor; in float aSize;
uniform mat4 viewMatrix, projectionMatrix; uniform float uPixelRatio, uTime, uSky;
out vec3 vColor;
void main(){
  float twinkle = .72 + .28 * sin(uTime * (.4 + aSize) + position.x * 37.);
  vColor = aColor * (uSky > .5 ? twinkle : 1.);
  if (uSky > .5) {
    // At infinity: rotate with the camera, never translate, and sit on the far plane.
    gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.)).xyww;
    gl_PointSize = aSize * uPixelRatio;
  } else {
    vec4 p = viewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * p;
    gl_PointSize = clamp(aSize * 420. / -p.z, 1., 3.2) * uPixelRatio;
  }
}`;
const POINT_FS = /* glsl */ `
precision mediump float; in vec3 vColor; out vec4 o;
void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard; o = vec4(vColor * pow(1. - d, 1.6), 0.); }`;

export interface CosmosRenderOptions {
  /** Stars in the sky. Default 6500. */
  skyStars?: number;
  /** The orbit-path rings (the `orbits` layer). */
  orbits?: CosmosOrbitOptions;
}

/** A galaxy takes its members' colour, so it follows the theme's per-type colours. */
const memberColor = (colors: Float32Array, members: number[]): [number, number, number] => {
  const i = members[0] ?? -1;
  return i >= 0 && i * 3 + 2 < colors.length ? [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]] : [0.58, 0.64, 0.72];
};
const metaOf = (f: { meta: unknown }) => f.meta as CosmosMeta;

export function cosmosRenderers(options: CosmosRenderOptions = {}): GraphRenderers3D {
  const skyCount = options.skyStars ?? 6500;

  const sky = createPointsLayer(() => {
    const rand = seeded(0.4242);
    const pos = new Float32Array(skyCount * 3), col = new Float32Array(skyCount * 3), size = new Float32Array(skyCount);
    for (let i = 0; i < skyCount; i++) {
      const y = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - y * y), tint = rand(), lum = 0.2 + Math.pow(rand(), 3) * 0.8;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      col.set([lum * (tint < 0.3 ? 0.75 : 1), lum * 0.92, lum * (tint > 0.7 ? 0.72 : 1)], i * 3);
      size[i] = 1 + Math.pow(rand(), 4) * 2.6;
    }
    return { name: "cosmos-sky", positions: pos, attributes: { aColor: { size: 3, array: col }, aSize: { size: 1, array: size } }, vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: { uSky: { value: 1 } } };
  });

  const dust = createPointsLayer((ctx) => {
    const { galaxies } = ctx.meta as CosmosMeta;
    const per = galaxies.map((g) => Math.min(3400, 900 + g.members.length * 12));
    const total = per.reduce((s, k) => s + k, 0);
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3), size = new Float32Array(total);
    let w = 0;
    galaxies.forEach((g, gi) => {
      const rand = seeded(g.seed + 0.25);
      const c = memberColor(ctx.colors, g.members);
      for (let j = 0; j < per[gi]; j++, w++) {
        const f = Math.pow(rand(), 1.15);
        pos.set(spiralPoint(g, f, Math.floor(rand() * g.arms), rand, 0.34), w * 3);
        const lum = (0.1 + rand() * 0.42) * (1.2 - f * 0.75), white = rand() * 0.75;
        col.set([(c[0] * (1 - white) + white) * lum, (c[1] * (1 - white) + white) * lum, (c[2] * (1 - white) + white) * lum], w * 3);
        size[w] = 0.8 + rand() * 1.5;
      }
    });
    return { name: "cosmos-dust", positions: pos, attributes: { aColor: { size: 3, array: col }, aSize: { size: 1, array: size } }, vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: { uSky: { value: 0 } } };
  });

  const galaxies = createInstancedLayer({
    name: "cosmos-galaxies",
    source: "clusters",
    vertexShader: DISC_VS,
    fragmentShader: DISC_FS,
    attributes: [{ name: "iCenter", size: 3 }, { name: "iU", size: 3 }, { name: "iV", size: 3 }, { name: "iColor", size: 3 }, { name: "iMisc", size: 3 }],
    write(out, at, i, f: LayerFrame3D) {
      const g = metaOf(f).galaxies[i];
      const c = memberColor(f.colors, g.members);
      out.set(g.center, at);
      out.set(g.u, at + 3);
      out.set(g.v, at + 6);
      out.set(c, at + 9);
      out[at + 12] = g.radius;
      out[at + 13] = g.arms;
      out[at + 14] = g.seed;
    },
  });

  const bodies = createInstancedLayer({
    name: "cosmos-bodies",
    vertexShader: BODY_VS,
    fragmentShader: BODY_FS,
    blending: "premultiplied",
    attributes: [{ name: "iPos", size: 3 }, { name: "iSize", size: 1 }, { name: "iColor", size: 3 }, { name: "iLight", size: 3 }, { name: "iData", size: 4 }],
    write(out, at, i, f) {
      const b = metaOf(f).bodies[i];
      const p = f.positions;
      const light = b.parent >= 0 ? b.parent : i;
      const st = ringState(i, f);
      out[at] = p[i * 3];
      out[at + 1] = p[i * 3 + 1];
      out[at + 2] = p[i * 3 + 2];
      out[at + 3] = b.size;
      out[at + 4] = f.colors[i * 3];
      out[at + 5] = f.colors[i * 3 + 1];
      out[at + 6] = f.colors[i * 3 + 2];
      out[at + 7] = p[light * 3];
      out[at + 8] = p[light * 3 + 1];
      out[at + 9] = p[light * 3 + 2];
      out[at + 10] = b.kind;
      out[at + 11] = b.seed;
      out[at + 12] = st === NODE_ACTIVE ? 1 : st === NODE_DIMMED ? 2 : 0;
      out[at + 13] = (b.ringed ? 1 : 0) + (i === f.focused ? 2 : 0);
    },
  });

  const links = linkLayer3D({
    alpha(l, state, f) {
      if (state === LINK_ACTIVE) return 0.85;
      if (state === LINK_DIMMED) return 0;
      const { bodies: bs } = metaOf(f);
      return bs[l.a].galaxy !== bs[l.b].galaxy ? 0.035 : Math.min(0.2, 0.07 + Math.log2(1 + l.weight) * 0.03);
    },
  });

  return { background: [sky, dust], cluster: [galaxies, cosmosOrbits(options.orbits)], link: links, node: bodies };
}

const ORBIT_VS = /* glsl */ `
in vec3 position; in vec4 aColor; uniform mat4 viewMatrix, projectionMatrix; out vec4 vColor;
void main(){ vColor = aColor; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;
const ORBIT_FS = /* glsl */ `
precision mediump float; in vec4 vColor; out vec4 o; void main(){ o = vec4(vColor.rgb * vColor.a, 0.); }`;

export interface CosmosOrbitOptions {
  /** Line segments per orbit ring. Default 48. */
  segments?: number;
  /** Ring opacity: normal, highlighted (the selection's, its neighbours'), dimmed. */
  alpha?: { normal?: number; active?: number; dimmed?: number };
}

/**
 * The cosmos's orbit paths: one faint ring per planet and asteroid around the
 * star it circles, in the body's own colour, brighter for the highlighted
 * bodies. Tagged `layer: "orbits"`, so `layers={{ orbits: true }}` shows it;
 * the cosmos preset declares it hidden by default. Stars sit still, so the
 * rings are built once and only their opacity changes.
 */
export function cosmosOrbits(options: CosmosOrbitOptions = {}): GraphLayer3D {
  const seg = Math.max(8, Math.min(256, Math.floor(options.segments ?? 48)));
  const aNormal = options.alpha?.normal ?? 0.12;
  const aActive = options.alpha?.active ?? 0.5;
  const aDimmed = options.alpha?.dimmed ?? 0.03;
  let lines: THREE.LineSegments | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let ctx: LayerContext3D | null = null;
  let owners: number[] = [];
  let key = "";
  return {
    layer: "orbits",
    mount(c) {
      ctx = c;
      const bodies = (c.meta as CosmosMeta | undefined)?.bodies ?? [];
      owners = [];
      bodies.forEach((b, i) => {
        if (b.parent >= 0 && bodies[b.parent]) owners.push(i);
      });
      const verts = Math.max(1, owners.length * seg * 2);
      const pos = new Float32Array(verts * 3);
      const col = new Float32Array(verts * 4);
      let v = 0;
      for (const i of owners) {
        const b = bodies[i];
        const o = bodies[b.parent].home;
        for (let k = 0; k < seg; k++) {
          for (const step of [k, k + 1]) {
            const a = (step / seg) * Math.PI * 2;
            const x = Math.cos(a) * b.orbitRadius, y = Math.sin(a) * b.orbitRadius;
            pos[v * 3] = o[0] + b.orbitU[0] * x + b.orbitV[0] * y;
            pos[v * 3 + 1] = o[1] + b.orbitU[1] * x + b.orbitV[1] * y;
            pos[v * 3 + 2] = o[2] + b.orbitU[2] * x + b.orbitV[2] * y;
            col[v * 4] = c.colors[i * 3] ?? 0.6;
            col[v * 4 + 1] = c.colors[i * 3 + 1] ?? 0.6;
            col[v * 4 + 2] = c.colors[i * 3 + 2] ?? 0.6;
            col[v * 4 + 3] = aNormal;
            v++;
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const colour = new THREE.BufferAttribute(col, 4);
      colour.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aColor", colour);
      geo.setDrawRange(0, v);
      mat = createLayerMaterial({ vertexShader: ORBIT_VS, fragmentShader: ORBIT_FS, blending: "premultiplied" });
      lines = new THREE.LineSegments(geo, mat);
      lines.name = "cosmos-orbits";
      lines.frustumCulled = false;
      lines.renderOrder = c.renderOrder;
      c.group.add(lines);
      key = "";
    },
    update(f) {
      if (!lines) return;
      const next = `${f.selected},${f.hovered},${f.focused},${f.matches?.size ?? 0},${f.focus}`;
      if (next === key) return;
      key = next;
      const attr = lines.geometry.getAttribute("aColor") as THREE.BufferAttribute;
      const col = attr.array as Float32Array;
      const per = seg * 2;
      owners.forEach((i, r) => {
        const st = f.states[i];
        const a = st === NODE_ACTIVE ? aActive : st === NODE_DIMMED ? aDimmed : aNormal;
        for (let k = 0; k < per; k++) col[(r * per + k) * 4 + 3] = a;
      });
      attr.needsUpdate = true;
    },
    dispose() {
      if (lines && ctx) ctx.group.remove(lines);
      lines?.geometry.dispose();
      mat?.dispose();
      lines = null;
      mat = null;
    },
  };
}

/** The layers the cosmos draws. Orbit paths start hidden, so the default look is the one 0.1.0 shipped. */
export function cosmosLayers(): GraphLayerSpec[] {
  return [
    { id: "background", label: "Sky" },
    { id: "clusters", label: "Galaxies" },
    { id: "orbits", label: "Orbit paths", visible: false },
    { id: "links", label: "Links" },
    { id: "labels", label: "Labels" },
  ];
}

/** The cosmos defaults beside its layout and look: body sizes from the layout, galaxy labels with counts, links shown for the focus only. */
export const cosmosDefaults = {
  nodeSize: (_n: GraphNode, i: number, meta: unknown) => (meta as CosmosMeta).bodies?.[i]?.size ?? 2,
  clusterLabel: (c: GraphCluster) => `${c.label ?? c.id} · ${c.members.length}`,
  homeYaw: 0.75,
  homePitch: 0.55,
  linkVisibility: "focus" as const,
};
