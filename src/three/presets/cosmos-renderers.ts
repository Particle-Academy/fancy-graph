/**
 * The cosmos look, the `cosmos` 3D preset's renderers, built only through the
 * public 3D plug points: a seeded sky and galaxy dust as background layers,
 * galaxy discs and galactic cores as cluster layers, links tinted by galaxy,
 * and stars, planets and asteroids as one instanced custom shader with
 * premultiplied blending (solid bodies cover, glows add light). Galaxies move
 * (they turn and orbit), so dust and orbit rings are built once in each
 * galaxy's own frame and carried by a model matrix. Colours come from the theme.
 */
import { LINK_ACTIVE, LINK_DIMMED, NODE_ACTIVE, NODE_DIMMED } from "../../interaction";
import { seeded } from "../../random";
import type { GraphCluster, GraphNode, Vec3 } from "../../types";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import type { GraphLayerSpec } from "../../layers";
import { createInstancedLayer, createLayerMaterial, createPointsLayer, linkLayer3D, ringState } from "../layers";
import type { GraphLayer3D, GraphRenderers3D, LayerContext3D, LayerFrame3D } from "../types";
import { galaxyLocal, spiralPoint, type CosmosGalaxy, type CosmosMeta } from "./cosmos-layout";

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

// iMisc: x = radius, y = arms, z = seed. iShape: x = twist, y = warmth, z = scatter.
const DISC_VS = /* glsl */ `
in vec3 position; in vec3 iCenter; in vec3 iU; in vec3 iV; in vec3 iColor; in vec3 iMisc; in vec3 iShape;
uniform mat4 viewMatrix, projectionMatrix;
out vec2 vUv; out vec3 vColor; flat out vec3 vMisc; flat out vec3 vShape;
void main(){
  vUv = position.xy; vColor = iColor; vMisc = iMisc; vShape = iShape;
  vec3 w = iCenter + (iU * position.x + iV * position.y) * iMisc.x * 1.25;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

const DISC_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vColor; flat in vec3 vMisc; flat in vec3 vShape; out vec4 o;
${NOISE}
void main(){
  float r = length(vUv);
  if (r > 1.) discard;
  float arms = vMisc.y, seed = vMisc.z, twist = vShape.x, warmth = vShape.y, scatter = vShape.z;
  // The same spiral the stars and dust sit on (spiralPoint): uv radius 1 is 1.25 galaxy radii.
  float sf = clamp((r * 1.25 - .06) / .94, 0., 1.);
  float th = atan(vUv.y, vUv.x) - seed * 6.283 - twist * sf;
  float arm = pow(.5 + .5 * cos(th * arms), mix(3.2, 1.4, clamp((scatter - .2) / .35, 0., 1.)));
  // The arms converge to a point at the centre; melt them into the bulge there, so the core is round, not a pinwheel.
  arm = mix(.35, arm, smoothstep(.04, .2, r));
  float gas = fbm(vUv * 5.5 + seed * 29.);
  float fade = pow(1. - r, 1.7);
  float bulge = exp(-r * r * 60.);
  vec3 tint = mix(vColor, mix(vec3(.5, .56, 1.), vec3(1., .8, .55), warmth), .28);
  o = vec4(tint * (arm * (.3 + gas) * .44 + gas * .08) * fade + mix(vColor, vec3(1., .93, .8), .7) * bulge * .3, 0.);
}`;

// A galaxy's core: a smooth, bright bulge, flattened into its disc's plane, never mottled or spiked like a star.
// iShape: x = core radius, y = warmth, z = seed.
const CORE_VS = /* glsl */ `
in vec3 position; in vec3 iCenter; in vec3 iNormal; in vec3 iColor; in vec3 iShape;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uViewport; uniform float uMinPx, uReach;
out vec2 vUv; out vec3 vColor; flat out float vWarmth;
void main(){
  vec4 p = viewMatrix * vec4(iCenter, 1.);
  float pxPerWorld = projectionMatrix[1][1] * uViewport.y * .5 / max(1., -p.z);
  float r = max(iShape.x, uMinPx / pxPerWorld);
  vec3 n = normalize(mat3(viewMatrix) * iNormal);
  vec2 minor = length(n.xy) > 1e-4 ? normalize(n.xy) : vec2(0., 1.);
  // (major, minor) must stay right-handed, or the quad's winding flips and front-face culling drops it.
  vec2 major = vec2(minor.y, -minor.x);
  float squash = max(.45, abs(n.z));
  vUv = position.xy * uReach;
  p.xy += (major * vUv.x + minor * vUv.y * squash) * r;
  vColor = iColor; vWarmth = iShape.y;
  gl_Position = projectionMatrix * p;
}`;

const CORE_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vColor; flat in float vWarmth; uniform float uReach, uBrightness; out vec4 o;
void main(){
  float d = length(vUv);
  if (d > uReach) discard;
  vec3 warm = mix(vec3(1., .95, .86), vec3(1., .78, .5), vWarmth);
  float nucleus = exp(-d * d * 3.);
  float bulge = exp(-d * d * .7);
  float halo = pow(max(0., 1. - d / uReach), 2.2);
  vec3 c = warm * nucleus * 1.5 + mix(vColor, warm, .6) * bulge * .8 + vColor * halo * .3;
  // The bright middle covers what is behind it (a body); the bulge and halo only add light.
  float a = smoothstep(.6, .15, d) * .85;
  o = vec4(min(c * uBrightness, vec3(1.)), a);
}`;

const POINT_VS = /* glsl */ `
in vec3 position; in vec3 aColor; in float aSize;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix; uniform float uPixelRatio, uTime, uSky;
out vec3 vColor;
void main(){
  float twinkle = .72 + .28 * sin(uTime * (.4 + aSize) + position.x * 37.);
  vColor = aColor * (uSky > .5 ? twinkle : 1.);
  if (uSky > .5) {
    // At infinity: rotate with the camera, never translate, and sit on the far plane.
    gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.)).xyww;
    gl_PointSize = aSize * uPixelRatio;
  } else {
    // Dust is built in its galaxy's own frame; the model matrix carries it as the galaxy turns and orbits.
    vec4 p = viewMatrix * modelMatrix * vec4(position, 1.);
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
  /** The galactic cores (the `cores` layer). */
  cores?: CosmosCoreOptions;
  /** Most dust points per galaxy. Default 3400. */
  maxDustPerGalaxy?: number;
}

export interface CosmosCoreOptions {
  /** Light multiplier. Default 1. */
  brightness?: number;
  /** Smallest on-screen core radius, px, so a far galaxy keeps its core. Default 5. */
  minPx?: number;
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

  const dust = cosmosDust(Math.max(0, Math.floor(options.maxDustPerGalaxy ?? 3400)));

  const galaxies = createInstancedLayer({
    name: "cosmos-galaxies",
    source: "clusters",
    vertexShader: DISC_VS,
    fragmentShader: DISC_FS,
    attributes: [{ name: "iCenter", size: 3 }, { name: "iU", size: 3 }, { name: "iV", size: 3 }, { name: "iColor", size: 3 }, { name: "iMisc", size: 3 }, { name: "iShape", size: 3 }],
    include: (i, f) => !!metaOf(f).galaxies?.[i],
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
      out[at + 15] = g.twist;
      out[at + 16] = g.warmth;
      out[at + 17] = g.scatter;
    },
  });

  const cores = Object.assign(
    createInstancedLayer({
      name: "cosmos-cores",
      source: "clusters",
      vertexShader: CORE_VS,
      fragmentShader: CORE_FS,
      uniforms: { uMinPx: { value: options.cores?.minPx ?? 5 }, uReach: { value: 3 }, uBrightness: { value: options.cores?.brightness ?? 1 } },
      attributes: [{ name: "iCenter", size: 3 }, { name: "iNormal", size: 3 }, { name: "iColor", size: 3 }, { name: "iShape", size: 3 }],
      include: (i, f) => !!metaOf(f).galaxies?.[i],
      write(out, at, i, f: LayerFrame3D) {
        const g = metaOf(f).galaxies[i];
        out.set(g.center, at);
        out.set(g.normal, at + 3);
        out.set(memberColor(f.colors, g.members), at + 6);
        out[at + 9] = g.coreRadius;
        out[at + 10] = g.warmth;
        out[at + 11] = g.seed;
      },
    }),
    { layer: "cores" },
  );

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

  return { background: [sky, dust], cluster: [galaxies, cores, cosmosOrbits(options.orbits)], link: links, node: bodies };
}

/** Places `obj` on galaxy `g`'s live frame: its local x, y, z are the disc's u, v and normal, from the core. */
function onGalaxy(obj: THREE.Object3D, g: CosmosGalaxy, tmp: { u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3 }) {
  tmp.u.set(g.u[0], g.u[1], g.u[2]);
  tmp.v.set(g.v[0], g.v[1], g.v[2]);
  tmp.n.set(g.normal[0], g.normal[1], g.normal[2]);
  obj.matrix.makeBasis(tmp.u, tmp.v, tmp.n).setPosition(g.center[0], g.center[1], g.center[2]);
  obj.matrixWorldNeedsUpdate = true;
}
const frameTmp = () => ({ u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3() });

/**
 * Galaxy dust: one point cloud per galaxy, built once in that galaxy's own
 * frame and carried by its model matrix, so the dust turns and travels with
 * its galaxy at no per-point cost. Density follows the galaxy's `density`.
 */
export function cosmosDust(maxPerGalaxy = 3400): GraphLayer3D {
  let ctx: LayerContext3D | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let clouds: THREE.Points[] = [];
  const tmp = frameTmp();
  return {
    layer: "background",
    mount(c) {
      ctx = c;
      const galaxies = (c.meta as CosmosMeta | undefined)?.galaxies ?? [];
      mat = createLayerMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: { uSky: { value: 0 } } });
      clouds = galaxies.map((g) => {
        const count = Math.min(maxPerGalaxy, Math.round((900 + g.members.length * 12) * g.density));
        const local = { ...g, center: [0, 0, 0] as Vec3, u: [1, 0, 0] as Vec3, v: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
        const rand = seeded(g.seed + 0.25);
        const col0 = memberColor(c.colors, g.members);
        const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
        for (let j = 0; j < count; j++) {
          const f = Math.pow(rand(), 1.15);
          pos.set(spiralPoint(local, f, Math.floor(rand() * g.arms), rand, g.scatter + 0.1), j * 3);
          const lum = (0.1 + rand() * 0.42) * (1.2 - f * 0.75), white = rand() * 0.75;
          col.set([(col0[0] * (1 - white) + white) * lum, (col0[1] * (1 - white) + white) * lum, (col0[2] * (1 - white) + white) * lum], j * 3);
          size[j] = 0.8 + rand() * 1.5;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
        geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
        const pts = new THREE.Points(geo, mat!);
        pts.name = "cosmos-dust";
        pts.frustumCulled = false;
        pts.matrixAutoUpdate = false;
        pts.renderOrder = c.renderOrder;
        onGalaxy(pts, g, tmp);
        c.group.add(pts);
        return pts;
      });
    },
    update(f) {
      if (!mat) return;
      mat.uniforms.uTime.value = f.time;
      mat.uniforms.uViewport.value.set(f.width, f.height);
      mat.uniforms.uPixelRatio.value = f.pixelRatio;
      const galaxies = metaOf(f).galaxies ?? [];
      clouds.forEach((pts, i) => galaxies[i] && onGalaxy(pts, galaxies[i], tmp));
    },
    dispose() {
      for (const pts of clouds) {
        ctx?.group.remove(pts);
        pts.geometry.dispose();
      }
      mat?.dispose();
      clouds = [];
      mat = null;
    },
  };
}

const ORBIT_VS = /* glsl */ `
in vec3 position; in vec4 aColor; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec4 vColor;
void main(){ vColor = aColor; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`;
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
 * the cosmos preset declares it hidden by default. The rings are built once per
 * galaxy, in its own frame; each frame moves only the galaxy's model matrix,
 * and opacity changes only when the highlight does.
 */
export function cosmosOrbits(options: CosmosOrbitOptions = {}): GraphLayer3D {
  const seg = Math.max(8, Math.min(256, Math.floor(options.segments ?? 48)));
  const aNormal = options.alpha?.normal ?? 0.12;
  const aActive = options.alpha?.active ?? 0.5;
  const aDimmed = options.alpha?.dimmed ?? 0.03;
  let sets: { lines: THREE.LineSegments; owners: number[] }[] = [];
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let ctx: LayerContext3D | null = null;
  let key = "";
  const tmp = frameTmp();
  return {
    layer: "orbits",
    mount(c) {
      ctx = c;
      const meta = c.meta as CosmosMeta | undefined;
      const bodies = meta?.bodies ?? [];
      const galaxies = meta?.galaxies ?? [];
      mat = createLayerMaterial({ vertexShader: ORBIT_VS, fragmentShader: ORBIT_FS, blending: "premultiplied" });
      // One line set per galaxy, built in its rest frame's local coordinates and carried by its model matrix.
      sets = galaxies.map((g, gi) => {
        const owners: number[] = [];
        bodies.forEach((b, i) => {
          if (b.galaxy === gi && b.parent >= 0 && !b.pinned && bodies[b.parent]) owners.push(i);
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
              const p: Vec3 = [o[0] + b.orbitU[0] * x + b.orbitV[0] * y, o[1] + b.orbitU[1] * x + b.orbitV[1] * y, o[2] + b.orbitU[2] * x + b.orbitV[2] * y];
              pos.set(galaxyLocal(g, p), v * 3);
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
        const lines = new THREE.LineSegments(geo, mat!);
        lines.name = "cosmos-orbits";
        lines.frustumCulled = false;
        lines.matrixAutoUpdate = false;
        lines.renderOrder = c.renderOrder;
        onGalaxy(lines, g, tmp);
        c.group.add(lines);
        return { lines, owners };
      });
      key = "";
    },
    update(f) {
      if (!mat) return;
      const galaxies = metaOf(f).galaxies ?? [];
      sets.forEach((s, i) => galaxies[i] && onGalaxy(s.lines, galaxies[i], tmp));
      const next = `${f.selected},${f.hovered},${f.focused},${f.matches?.size ?? 0},${f.focus}`;
      if (next === key) return;
      key = next;
      const per = seg * 2;
      for (const { lines, owners } of sets) {
        const attr = lines.geometry.getAttribute("aColor") as THREE.BufferAttribute;
        const col = attr.array as Float32Array;
        owners.forEach((i, r) => {
          const st = f.states[i];
          const a = st === NODE_ACTIVE ? aActive : st === NODE_DIMMED ? aDimmed : aNormal;
          for (let k = 0; k < per; k++) col[(r * per + k) * 4 + 3] = a;
        });
        attr.needsUpdate = true;
      }
    },
    dispose() {
      for (const { lines } of sets) {
        ctx?.group.remove(lines);
        lines.geometry.dispose();
      }
      mat?.dispose();
      sets = [];
      mat = null;
    },
  };
}

/** The layers the cosmos draws. Orbit paths start hidden. */
export function cosmosLayers(): GraphLayerSpec[] {
  return [
    { id: "background", label: "Sky" },
    { id: "clusters", label: "Galaxies" },
    { id: "cores", label: "Galactic cores" },
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
