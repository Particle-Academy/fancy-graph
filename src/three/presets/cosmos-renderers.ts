/**
 * The cosmos look (0.4.0), the `cosmos` 3D preset's renderers, built only
 * through the public 3D plug points: a seeded sky and galaxy dust behind,
 * galaxy discs and cores, orbit rings, light links as glowing arcs (along the
 * arms inside a galaxy), constellation figures, comet tails drawn on the GPU,
 * and every body (star, core, planet, moon, asteroid, comet) as one instanced
 * shader whose surface, atmosphere and rings come from the node's data. An
 * image texture is used only when the host's data names one. Colours come from
 * the theme unless a node's look sets its own.
 */
import { colorFor, parseColor } from "../../color";
import { LINK_ACTIVE, LINK_DIMMED, NODE_ACTIVE, NODE_DIMMED } from "../../interaction";
import { seeded, hash01 } from "../../random";
import type { GraphCluster, GraphNode, Vec3 } from "../../types";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import type { GraphLayerSpec } from "../../layers";
import { createInstancedLayer, createLayerMaterial, createPointsLayer, ringState } from "../layers";
import type { GraphLayer3D, GraphRenderers3D, LayerContext3D, LayerFrame3D } from "../types";
import { COMET, CORE, cometTailPoints, liveVector, MOON, PLANET, spiralPoint, STAR, writeLightArc, type CosmosGalaxy, type CosmosLayoutOptions, type CosmosMeta } from "./cosmos-layout";

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), w.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), w.x), w.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.1 + vec2(11.7, 5.3); a *= .5; } return s; }
float h31(vec3 p){ p = fract(p * vec3(.1031, .11369, .13787)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 w = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), w.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), w.x), w.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), w.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), w.x), w.y), w.z); }
float fbm3(vec3 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++) { s += a * vn3(p); p = p * 2.03 + vec3(7.1, 3.7, 1.3); a *= .5; } return s; }
`;

/*
 * iData: x = kind (0 star, 1 planet, 2 asteroid, 3 moon, 4 core, 5 comet), y = seed, z = state (0 normal, 1 highlight, 2 dimmed), w = focused.
 * iSkin: x = skin (0 none, 1 gas, 2 rocky, 3 ice, 4 cratered, 5 lava, 6 ocean), y = atmosphere thickness, z = atmosphere glow, w = ring opacity.
 * iRing: x = inner, y = outer (radii), z = tilt, w = heat (an arrival's glow).
 */
const BODY_VS = /* glsl */ `
in vec3 position; in vec3 iPos; in float iSize; in vec3 iColor; in vec3 iColor2; in vec3 iLight; in vec4 iData; in vec4 iSkin; in vec3 iAtmo; in vec4 iRing; in vec3 iRingColor;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uViewport;
out vec2 vUv; out vec3 vLight; out float vPx;
flat out vec3 vColor; flat out vec3 vColor2; flat out vec4 vData; flat out vec4 vSkin; flat out vec3 vAtmo; flat out vec4 vRing; flat out vec3 vRingColor; flat out float vReach; flat out float vHalo;
void main(){
  vec4 p = viewMatrix * vec4(iPos, 1.);
  float pxPerWorld = projectionMatrix[1][1] * uViewport.y * .5 / max(1., -p.z);
  float kind = iData.x;
  bool star = kind < .5, core = kind > 3.5 && kind < 4.5;
  float minPx = star || core ? 3. : kind > 2.5 && kind < 3.5 ? 1.2 : kind > 1.5 && kind < 2.5 ? 1.3 : 2.;
  float r = max(iSize, minPx / pxPerWorld);
  float halo = iSkin.w > 0. ? iRing.y + .2 : 1.6;
  float reach = star ? 4.4 : core ? 3.2 : max(max(1.8, 1. + iSkin.y * 1.8 + iSkin.z * .3), iSkin.w > 0. ? iRing.y + .15 : 0.);
  if (iData.z > .5 && iData.z < 1.5) reach = max(reach, halo + .15);
  if (iData.w > .5) reach = max(reach, halo + .55);
  if (iRing.w > 0.) reach = max(reach, 2.6);
  vPx = r * pxPerWorld;
  vUv = position.xy * reach;
  vReach = reach; vHalo = halo;
  vLight = normalize((viewMatrix * vec4(iLight, 1.)).xyz - p.xyz + vec3(1e-4));
  p.xy += vUv * r;
  vColor = iColor; vColor2 = iColor2; vData = iData; vSkin = iSkin; vAtmo = iAtmo; vRing = iRing; vRingColor = iRingColor;
  gl_Position = projectionMatrix * p;
}`;

const BODY_FS = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vLight; in float vPx;
flat in vec3 vColor; flat in vec3 vColor2; flat in vec4 vData; flat in vec4 vSkin; flat in vec3 vAtmo; flat in vec4 vRing; flat in vec3 vRingColor; flat in float vReach; flat in float vHalo;
uniform float uTime; out vec4 o;
#ifdef TEXTURED
uniform sampler2D uMap;
#endif
${NOISE}
vec3 surface(float skin, vec3 p, float seed, out vec3 glow){
  glow = vec3(0.);
  vec3 c = vColor;
#ifdef TEXTURED
  c = texture(uMap, vec2(atan(p.x, p.z) / 6.2832 + .5, .5 - asin(clamp(p.y, -1., 1.)) / 3.1416)).rgb;
#else
  if (skin < 1.5) {
    float lat = p.y;
    float b = fbm3(vec3(p.x * 1.3, lat * (5. + fract(seed * 7.) * 5.), p.z * 1.3) + seed * 13.) + .22 * sin(lat * (10. + seed * 8.) + seed * 9.);
    c = mix(vColor * .32, mix(vColor2, vec3(1.), .08), smoothstep(.3, .78, b));
  } else if (skin < 2.5) {
    float m = fbm3(p * 2.6 + seed * 11.);
    c = mix(vColor * .36, vColor2 * .9, smoothstep(.35, .7, m)) * (.72 + .5 * fbm3(p * 9. + seed * 3.));
  } else if (skin < 3.5) {
    float m = fbm3(p * 3. + seed * 5.);
    float crack = smoothstep(.035, .0, abs(fbm3(p * 5.5 + seed * 9.) - .5));
    c = mix(vColor2, vColor, m * .6) * 1.04 - crack * .22 * vColor;
  } else if (skin < 4.5) {
    vec3 base = mix(vColor * .42, vColor2 * .78, fbm3(p * 3. + seed));
    float cr = vn3(p * 7. + seed * 21.);
    float rim = smoothstep(.7, .76, cr) * (1. - smoothstep(.76, .84, cr));
    float pit = smoothstep(.76, .9, cr);
    c = base * (1. - pit * .38) + rim * .16;
  } else if (skin < 5.5) {
    float cr = abs(fbm3(p * 4. + seed * 7.) - .5);
    glow = mix(vColor2, vec3(1., .55, .15), .5) * smoothstep(.07, .0, cr) * 1.4;
    c = vColor * .16;
  } else {
    float land = smoothstep(.5, .56, fbm3(p * 2.2 + seed * 17.));
    vec3 sea = mix(vColor * .55, vColor2 * .85, land);
    float clouds = smoothstep(.55, .78, fbm3(p * 3.5 + vec3(uTime * .02) + seed * 3.));
    c = mix(sea, vec3(.95), clouds * .7);
  }
#endif
  return c;
}
void main(){
  float d = length(vUv), kind = vData.x, seed = vData.y, state = vData.z, heat = vRing.w;
  vec3 c = vec3(0.); float a = 0.;
  if (kind < .5) {
    // Star: a mottled disc, a wide corona and four faint spikes. The corona has alpha 0, so it only adds light.
    float disc = smoothstep(1., .88, d);
    float boil = fbm(vUv * 3. + seed * 31. + uTime * .04);
    vec3 surf = mix(vColor, vec3(1.), .5 + .35 * boil);
    float corona = pow(max(0., 1. - d / 4.4), 2.4) * .8 + pow(max(0., 1. - d / 2.), 3.) * .6;
    float spikes = pow(max(0., 1. - abs(vUv.x) * 3.), 8.) * max(0., 1. - abs(vUv.y) / 4.4) + pow(max(0., 1. - abs(vUv.y) * 3.), 8.) * max(0., 1. - abs(vUv.x) / 4.4);
    c = surf * disc + (mix(vColor, vec3(1.), .3) * corona + vColor * spikes * .25) * (1. - disc);
    a = disc;
  } else if (kind > 3.5 && kind < 4.5) {
    // A galaxy's core as a node: a bright, smooth nucleus (the cores layer draws the bulge around it).
    float nuc = exp(-d * d * 2.2);
    c = mix(vColor, vec3(1., .95, .86), .72) * nuc * .9 + vColor * pow(max(0., 1. - d / 3.2), 2.) * .18;
    a = 0.;
  } else {
    float edge = 1.;
    if (kind > 1.5 && kind < 2.5) edge = .8 + .2 * vnoise(vec2(atan(vUv.y, vUv.x) * 1.7 + seed * 40., seed * 7.));
    // Rings: the far half first (behind the body), the near half over it.
    float ringBack = 0., ringFront = 0.;
    if (vSkin.w > 0.) {
      float sn = sin(seed * 6.283), cs = cos(seed * 6.283);
      vec2 q = mat2(cs, -sn, sn, cs) * vUv;
      float squash = clamp(abs(sin(vRing.z + .33)), .12, 1.);
      float rr = length(vec2(q.x, q.y / squash));
      float band = smoothstep(vRing.x - .04, vRing.x + .04, rr) * smoothstep(vRing.y + .04, vRing.y - .08, rr) * (.55 + .45 * vnoise(vec2(rr * 14., seed * 17.)));
      band *= vSkin.w;
      if (q.y < 0.) ringFront = band; else ringBack = band;
    }
    c = vRingColor * ringBack * .85; a = ringBack * .85;
    if (d < edge) {
      float dn = d / edge;
      vec3 n = vec3(vUv / edge, sqrt(max(0., 1. - dn * dn)));
      // The surface turns: rotate the sphere point about its axis, tipped by the seed.
      float spin = uTime * (.05 + seed * .08) + seed * 40.;
      float tip = (fract(seed * 13.) - .5) * .6;
      vec3 p = vec3(n.x * cos(spin) - n.z * sin(spin), n.y, n.x * sin(spin) + n.z * cos(spin));
      p = vec3(p.x, p.y * cos(tip) - p.z * sin(tip), p.y * sin(tip) + p.z * cos(tip));
      vec3 glow;
      vec3 albedo = surface(vSkin.x, p, seed, glow);
      float lit = max(0., dot(n, vLight));
      float amb = kind > 1.5 && kind < 2.5 ? .22 : .08;
      vec3 body = albedo * (amb + (1. - amb) * smoothstep(-.1, .85, lit)) + glow;
      if (vSkin.y > 0.) body += vAtmo * pow(1. - n.z, 2.2) * (.25 + .75 * lit) * (.45 + vSkin.z * .45);
      // Small on screen: a flat dot, so far planets stay legible.
      body = mix(body, mix(vColor, vec3(1.), .2) * .95, smoothstep(7., 3., vPx));
      float cover = smoothstep(1., .94, dn);
      c = mix(c, body, cover); a = mix(a, 1., cover);
    } else if (vSkin.y > 0.) {
      float x = (d - edge) / (edge * vSkin.y * 1.8 + 1e-3);
      c += vAtmo * pow(max(0., 1. - x), 2.5) * vSkin.z * .55;
    }
    c = mix(c, vRingColor * .9, ringFront * .85); a = max(a, ringFront * .85);
    if (heat > 0.) c += mix(vColor, vec3(1.), .45) * pow(max(0., 1. - d / vReach), 2.) * heat * .55;
  }
  if (state > .5 && state < 1.5) { float ring = smoothstep(.07, 0., abs(d - vHalo)); c += vec3(ring); a = max(a, ring); }
  if (state > 1.5) { c *= .13; a *= .13; }
  if (vData.w > .5) {
    float dash = step(.5, fract(atan(vUv.y, vUv.x) * 2.546));
    float ring = smoothstep(.07, 0., abs(d - vHalo - .4)) * dash;
    c = mix(c, vec3(.23, .51, .96), ring); a = max(a, ring);
  }
  o = vec4(c, a);
}`;

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
  /** The light links (the `links` layer). */
  light?: CosmosLightOptions;
  /** The comet tails (the `comets` layer). */
  tails?: CosmosCometOptions;
}

export interface CosmosCoreOptions {
  /** Light multiplier. Default 1. */
  brightness?: number;
  /** Smallest on-screen core radius, px, so a far galaxy keeps its core. Default 5. */
  minPx?: number;
}

export interface CosmosLightOptions {
  /** Segments per arc. Default 10. */
  segments?: number;
  /** Line width, CSS px: normal and focused (the glow). Default 1.1 and 2.8. */
  width?: number;
  focusWidth?: number;
}

export interface CosmosCometOptions {
  /** Particles per tail (4 to 128). Default 40. */
  particles?: number;
}

/** A galaxy takes its members' colour, so it follows the theme's per-type colours. */
const memberColor = (colors: Float32Array, members: number[]): [number, number, number] => {
  const i = members[0] ?? -1;
  return i >= 0 && i * 3 + 2 < colors.length ? [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]] : [0.58, 0.64, 0.72];
};
const metaOf = (f: { meta: unknown }) => f.meta as CosmosMeta;
const mix3 = (a: ArrayLike<number>, b: ArrayLike<number>, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const NaN3: [number, number, number] = [Number.NaN, Number.NaN, Number.NaN];
const parseOr = (css: string | null) => (css ? parseColor(css) : NaN3);

/** Per-body look colours parsed once (NaN where the look leaves it to the theme). */
interface LookCache {
  primary: Float32Array;
  secondary: Float32Array;
  atmo: Float32Array;
  ring: Float32Array;
}
function lookCache(meta: CosmosMeta | undefined): LookCache {
  const bodies = meta?.bodies ?? [];
  const n = bodies.length;
  const c: LookCache = { primary: new Float32Array(n * 3), secondary: new Float32Array(n * 3), atmo: new Float32Array(n * 3), ring: new Float32Array(n * 3) };
  bodies.forEach((b, i) => {
    c.primary.set(parseOr(b.look.colors[0]), i * 3);
    c.secondary.set(parseOr(b.look.colors[1]), i * 3);
    c.atmo.set(parseOr(b.look.atmosphere?.color ?? null), i * 3);
    c.ring.set(parseOr(b.look.rings?.color ?? null), i * 3);
  });
  return c;
}
/** Writes the look's own colour, else `base` mixed toward `toward` by `t`, at `out[at..]`. No allocation. */
function put3(out: Float32Array, at: number, own: Float32Array, i: number, base: ArrayLike<number>, b0: number, toward: readonly number[], t: number) {
  if (!Number.isNaN(own[i * 3])) {
    out[at] = own[i * 3];
    out[at + 1] = own[i * 3 + 1];
    out[at + 2] = own[i * 3 + 2];
    return;
  }
  out[at] = base[b0] + (toward[0] - base[b0]) * t;
  out[at + 1] = base[b0 + 1] + (toward[1] - base[b0 + 1]) * t;
  out[at + 2] = base[b0 + 2] + (toward[2] - base[b0 + 2]) * t;
}
const WHITE = [1, 1, 1] as const, SKY = [0.6, 0.8, 1] as const, DUST = [0.95, 0.9, 0.82] as const;

const BODY_ATTRS = [
  { name: "iPos", size: 3 },
  { name: "iSize", size: 1 },
  { name: "iColor", size: 3 },
  { name: "iColor2", size: 3 },
  { name: "iLight", size: 3 },
  { name: "iData", size: 4 },
  { name: "iSkin", size: 4 },
  { name: "iAtmo", size: 3 },
  { name: "iRing", size: 4 },
  { name: "iRingColor", size: 3 },
] as const;

function writeBody(out: Float32Array, at: number, i: number, f: LayerFrame3D, cache: LookCache) {
  const m = metaOf(f);
  const b = m.bodies[i];
  const p = f.positions;
  const light = b.system >= 0 ? b.system : i;
  const st = ringState(i, f);
  out[at] = p[i * 3];
  out[at + 1] = p[i * 3 + 1];
  out[at + 2] = p[i * 3 + 2];
  out[at + 3] = f.sizes[i];
  // The primary colour (the look's, else the theme's), then the others derived from it.
  put3(out, at + 4, cache.primary, i, f.colors, i * 3, WHITE, 0);
  put3(out, at + 7, cache.secondary, i, out, at + 4, WHITE, b.look.skin === 3 ? 0.65 : 0.45);
  put3(out, at + 21, cache.atmo, i, out, at + 4, SKY, 0.5);
  put3(out, at + 28, cache.ring, i, out, at + 4, DUST, 0.5);
  out[at + 10] = p[light * 3];
  out[at + 11] = p[light * 3 + 1];
  out[at + 12] = p[light * 3 + 2];
  out[at + 13] = b.kind;
  out[at + 14] = b.seed;
  out[at + 15] = st === NODE_ACTIVE ? 1 : st === NODE_DIMMED ? 2 : 0;
  out[at + 16] = i === f.focused ? 1 : 0;
  out[at + 17] = b.look.skin;
  out[at + 18] = b.look.atmosphere?.thickness ?? 0;
  out[at + 19] = b.look.atmosphere?.glow ?? 0;
  out[at + 20] = b.look.rings?.opacity ?? 0;
  out[at + 24] = b.look.rings?.inner ?? 0;
  out[at + 25] = b.look.rings?.outer ?? 0;
  out[at + 26] = b.look.rings?.tilt ?? 0;
  out[at + 27] = b.kind === COMET ? 0 : b.tail;
}

export function cosmosRenderers(options: CosmosRenderOptions & Pick<CosmosLayoutOptions, "constellations"> = {}): GraphRenderers3D {
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

  // Bodies with a host-supplied texture are drawn by the textured layer once their image has loaded; until then, by their skin.
  const textures = cosmosTextures();
  let cache: LookCache | null = null;
  const plain = createInstancedLayer({
    name: "cosmos-bodies",
    vertexShader: BODY_VS,
    fragmentShader: BODY_FS,
    blending: "premultiplied",
    attributes: [...BODY_ATTRS],
    include: (i) => !textures.covers(i),
    write(out, at, i, f) {
      writeBody(out, at, i, f, cache!);
    },
  });
  const bodies: GraphLayer3D = {
    mount(c) {
      cache = lookCache(c.meta as CosmosMeta | undefined);
      plain.mount(c);
      textures.mount(c);
    },
    update(f) {
      plain.update(f);
      textures.update(f);
    },
    dispose() {
      plain.dispose();
      textures.dispose();
      cache = null;
    },
  };

  return {
    background: [sky, dust],
    cluster: [galaxies, cores, cosmosOrbits(options.orbits)],
    // The constellations layer only when the lens asks for constellations, so the declared layers and the drawn ones agree.
    link: [cosmosLight(options.light), ...(options.constellations ? [cosmosConstellations()] : []), cosmosCometTails(options.tails)],
    node: bodies,
  };
}

/**
 * Bodies whose look names a texture: one instanced mesh per image (the layout
 * already capped them at `limits.maxTextures`), the body shader sampling it
 * as an equirectangular map. Images load from the host's URLs only, with
 * anonymous CORS; the kit ships none.
 */
export function cosmosTextures(): GraphLayer3D & { covers(index: number): boolean } {
  let ctx: LayerContext3D | null = null;
  let byUrl = new Map<string, { layer: ReturnType<typeof createInstancedLayer>; texture: THREE.Texture | null; loaded: boolean }>();
  let urlOf: (string | null)[] = [];
  let cache: LookCache | null = null;
  return {
    covers: (i) => {
      const u = urlOf[i];
      return !!u && !!byUrl.get(u)?.loaded;
    },
    mount(c) {
      ctx = c;
      const meta = c.meta as CosmosMeta | undefined;
      cache = lookCache(meta);
      urlOf = (meta?.bodies ?? []).map((b) => b.look.texture);
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      for (const url of [...new Set(urlOf.filter((u): u is string => !!u))].sort()) {
        const entry = { layer: null as unknown as ReturnType<typeof createInstancedLayer>, texture: null as THREE.Texture | null, loaded: false };
        const uniforms = { uMap: { value: null as THREE.Texture | null } };
        entry.layer = createInstancedLayer({
          name: "cosmos-bodies-textured",
          vertexShader: BODY_VS,
          fragmentShader: "#define TEXTURED\n" + BODY_FS,
          blending: "premultiplied",
          uniforms,
          attributes: [...BODY_ATTRS],
          include: (i) => entry.loaded && urlOf[i] === url,
          write(out, at, i, f) {
            writeBody(out, at, i, f, cache!);
          },
        });
        entry.layer.mount(c);
        entry.texture = loader.load(
          url,
          (tex) => {
            tex.generateMipmaps = false;
            tex.minFilter = THREE.LinearFilter;
            tex.wrapS = THREE.RepeatWrapping;
            tex.needsUpdate = true;
            uniforms.uMap.value = tex;
            entry.loaded = true;
          },
          undefined,
          () => {
            entry.loaded = false;
          },
        );
        byUrl.set(url, entry);
      }
    },
    update(f) {
      for (const e of byUrl.values()) e.layer.update(f);
    },
    dispose() {
      for (const e of byUrl.values()) {
        e.layer.dispose();
        e.texture?.dispose();
      }
      byUrl = new Map();
      urlOf = [];
      ctx = null;
      void ctx;
    },
  };
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

// ----------------------------------------------------------------- ribbons

/*
 * A glowing line segment of any width: one instanced quad per segment, the two
 * ends projected and widened in screen space. Per instance: the ends, a colour
 * with its alpha, and (width px, dash px; 0 is solid). Light, additive.
 */
const RIBBON_VS = /* glsl */ `
in vec3 position; in vec3 iA; in vec3 iB; in vec4 iColor; in vec2 iStyle;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uViewport;
out vec4 vColor; out float vAcross; out float vAlong; flat out float vDash;
void main(){
  vec4 ca = projectionMatrix * viewMatrix * vec4(iA, 1.), cb = projectionMatrix * viewMatrix * vec4(iB, 1.);
  vColor = iColor; vDash = iStyle.y; vAcross = 0.; vAlong = 0.;
  if (ca.w < .01 && cb.w < .01) { gl_Position = vec4(2., 2., 2., 1.); return; }
  ca.w = max(ca.w, .01); cb.w = max(cb.w, .01);
  vec2 sa = ca.xy / ca.w * uViewport * .5, sb = cb.xy / cb.w * uViewport * .5;
  vec2 d = sb - sa; float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1., 0.), nrm = vec2(-dir.y, dir.x);
  vec4 c = mix(ca, cb, position.x);
  float w = iStyle.x * .5 + 1.;
  c.xy += (nrm * position.y * w + dir * (position.x * 2. - 1.) * min(w * .5, L * .5)) * 2. / uViewport * c.w;
  vAcross = position.y * w / max(iStyle.x * .5, .5);
  vAlong = position.x * L;
  gl_Position = c;
}`;
const RIBBON_FS = /* glsl */ `
precision mediump float; in vec4 vColor; in float vAcross; in float vAlong; flat in float vDash; out vec4 o;
void main(){
  if (vDash > 0. && fract(vAlong / vDash) > .55) discard;
  float x = abs(vAcross);
  float core = 1. - smoothstep(.55, 1.15, x);
  float glow = exp(-x * x * 1.1) * .45;
  o = vec4(vColor.rgb * vColor.a * (core + glow), 0.);
}`;

const RIBBON_STRIDE = 12;
function ribbonGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A growable set of ribbon segments, rewritten each frame. */
class Ribbons {
  readonly mesh: THREE.Mesh;
  private geo = ribbonGeometry();
  private mat = createLayerMaterial({ vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, blending: "premultiplied" });
  private buffer: THREE.InstancedInterleavedBuffer | null = null;
  private count = 0;
  constructor(name: string, capacity: number, renderOrder: number) {
    this.allocate(Math.max(16, capacity));
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }
  private allocate(cap: number) {
    const old = this.buffer;
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * RIBBON_STRIDE), RIBBON_STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    if (old) buf.array.set((old.array as Float32Array).subarray(0, Math.min(old.array.length, buf.array.length)));
    this.buffer = buf;
    this.geo.setAttribute("iA", new THREE.InterleavedBufferAttribute(buf, 3, 0));
    this.geo.setAttribute("iB", new THREE.InterleavedBufferAttribute(buf, 3, 3));
    this.geo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(buf, 4, 6));
    this.geo.setAttribute("iStyle", new THREE.InterleavedBufferAttribute(buf, 2, 10));
  }
  begin(f: LayerFrame3D) {
    this.count = 0;
    this.mat.uniforms.uTime.value = f.time;
    this.mat.uniforms.uViewport.value.set(f.width, f.height);
    this.mat.uniforms.uPixelRatio.value = f.pixelRatio;
  }
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, alpha: number, width: number, dash: number) {
    if (this.count >= this.buffer!.count) this.allocate(this.buffer!.count * 2);
    const o = this.buffer!.array as Float32Array;
    const at = this.count * RIBBON_STRIDE;
    o[at] = ax;
    o[at + 1] = ay;
    o[at + 2] = az;
    o[at + 3] = bx;
    o[at + 4] = by;
    o[at + 5] = bz;
    o[at + 6] = r;
    o[at + 7] = g;
    o[at + 8] = b;
    o[at + 9] = alpha;
    o[at + 10] = width;
    o[at + 11] = dash;
    this.count++;
  }
  end() {
    this.geo.instanceCount = this.count;
    this.buffer!.needsUpdate = true;
  }
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Light: every associative link (never a gravity one, which is the orbit) as a
 * soft glowing arc; between two bodies of one galaxy it runs along the arm.
 * The focus's links are wider and brighter; the rest stay faint, or hidden in
 * `"focus"` mode until something is focused.
 */
export function cosmosLight(options: CosmosLightOptions = {}): GraphLayer3D {
  const S = Math.max(1, Math.min(64, Math.floor(options.segments ?? 10)));
  const width = options.width ?? 1.1;
  const focusWidth = options.focusWidth ?? 2.8;
  let ribbons: Ribbons | null = null;
  let bulge = new Float32Array(0);
  const pts = new Float64Array((S + 1) * 3);
  const arc = { center: [0, 0, 0] as Vec3, u: [0, 0, 0] as Vec3, v: [0, 0, 0] as Vec3, normal: [0, 0, 0] as Vec3, radius: 1, twist: 0 };
  return {
    layer: "links",
    mount(c) {
      ribbons = new Ribbons("cosmos-light", Math.min(4096, Math.max(16, c.graph.links.length * S)), c.renderOrder);
      c.group.add(ribbons.mesh);
      bulge = new Float32Array(c.graph.links.length);
      for (const l of c.graph.links) {
        const h = hash01(`${c.graph.nodes[l.a].id}>${c.graph.nodes[l.b].id}`);
        bulge[l.index] = (0.09 + 0.08 * h) * (hash01(`${l.index}~${h}`) < 0.5 ? -1 : 1);
      }
    },
    update(f) {
      if (!ribbons) return;
      ribbons.begin(f);
      const m = metaOf(f);
      if (f.linkVisibility !== "none" && m.gravity) {
        const p = f.positions;
        // "focus": the sky stays clean until you ask, so only the focus's own light, and none with nothing focused.
        // Walking just its links keeps that mode cheap however big the graph.
        const focusOnly = f.linkVisibility === "focus";
        const list = !focusOnly ? null : f.focus >= 0 ? (f.graph.incident[f.focus] ?? []) : [];
        const count = list ? list.length : f.graph.links.length;
        for (let k = 0; k < count; k++) {
          const l = list ? f.graph.links[list[k]] : f.graph.links[k];
          if (m.gravity[l.index] !== 0 || l.link.synthetic) continue;
          const state = f.linkStates[l.index];
          if (focusOnly && state !== LINK_ACTIVE) continue;
          if (state === LINK_DIMMED) continue;
          const ba = m.bodies[l.a], bb = m.bodies[l.b];
          const same = ba.galaxy >= 0 && ba.galaxy === bb.galaxy && ba.kind !== COMET && bb.kind !== COMET;
          const active = state === LINK_ACTIVE;
          const alpha = active ? 0.9 : same ? Math.min(0.2, 0.06 + Math.log2(1 + l.weight) * 0.035) : 0.07;
          let g: typeof arc | null = null;
          if (same) {
            const gal = m.galaxies[ba.galaxy];
            arc.center = gal.center;
            arc.u = gal.u;
            arc.v = gal.v;
            arc.normal = gal.normal;
            arc.radius = gal.radius;
            arc.twist = gal.twist;
            g = arc;
          }
          writeLightArc(pts, p.subarray(l.a * 3, l.a * 3 + 3), p.subarray(l.b * 3, l.b * 3 + 3), g, m.axis, bulge[l.index], S);
          const ca = [f.colors[l.a * 3], f.colors[l.a * 3 + 1], f.colors[l.a * 3 + 2]], cb = [f.colors[l.b * 3], f.colors[l.b * 3 + 1], f.colors[l.b * 3 + 2]];
          const w = active ? focusWidth : width;
          for (let k = 0; k < S; k++) {
            const t = (k + 0.5) / S;
            const col = mix3(ca, cb, t);
            const lift = active ? 0.25 : 0;
            ribbons.add(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], pts[k * 3 + 3], pts[k * 3 + 4], pts[k * 3 + 5], col[0] + (1 - col[0]) * lift, col[1] + (1 - col[1]) * lift, col[2] + (1 - col[2]) * lift, alpha, w, 0);
          }
        }
      }
      ribbons.end();
    },
    dispose() {
      ribbons?.dispose();
      ribbons = null;
    },
  };
}

/**
 * Constellations: each a faint dashed figure (its minimum spanning tree) over
 * the sky, joining members across any distance. Every constellation is its own
 * mesh, shown while its `constellation:<id>` layer is; the selected one is
 * solid and bright. Labels are the engine's (`data-fancy-graph-constellation-label`).
 */
export function cosmosConstellations(): GraphLayer3D {
  let sets: { id: string; ribbons: Ribbons; color: [number, number, number]; edges: [number, number][] }[] = [];
  return {
    layer: "constellations",
    mount(c) {
      const list = (c.meta as CosmosMeta | undefined)?.constellations ?? [];
      sets = list.map((k) => {
        const ribbons = new Ribbons(`cosmos-constellation-${k.id}`, Math.max(16, k.edges.length), c.renderOrder);
        c.group.add(ribbons.mesh);
        return { id: k.id, ribbons, color: parseColor(k.color ?? colorFor(k.id)), edges: k.edges };
      });
    },
    update(f) {
      const p = f.positions;
      for (const s of sets) {
        const shown = f.layers?.[`constellation:${s.id}`] !== false;
        s.ribbons.mesh.visible = shown;
        s.ribbons.begin(f);
        if (shown) {
          const selected = f.constellation === s.id;
          const dim = f.constellation !== null && f.constellation !== undefined && !selected;
          for (const [a, b] of s.edges)
            s.ribbons.add(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2], s.color[0], s.color[1], s.color[2], selected ? 0.8 : dim ? 0.05 : 0.17, selected ? 2.2 : 1.1, selected ? 0 : 7);
        }
        s.ribbons.end();
      }
    },
    dispose() {
      for (const s of sets) s.ribbons.dispose();
      sets = [];
    },
  };
}

// ------------------------------------------------------------------ comets

/*
 * A comet tail: a fixed set of particles in the GEOMETRY (each knows only how
 * far along the tail it sits and its own jitter), instanced once per comet. Per
 * comet the CPU writes the head and two samples of its real path behind it;
 * the vertex shader puts each particle on the curve through those three, so
 * the per-frame cost is per comet, not per particle.
 */
const TAIL_VS = /* glsl */ `
in vec3 position; in vec2 aP; in vec3 iHead; in vec3 iMid; in vec3 iEnd; in vec3 iColor; in vec4 iStyle;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uViewport; uniform float uTime;
out vec2 vUv; out vec3 vColor; out float vFade;
void main(){
  float s = fract(aP.x + uTime * .07 * (.6 + fract(aP.y * 5.3)));
  vec3 p = iHead * (2. * s * s - 3. * s + 1.) + iMid * (-4. * s * s + 4. * s) + iEnd * (2. * s * s - s);
  float L = length(iEnd - iHead);
  vec3 j = vec3(fract(sin(aP.y * 91.7) * 4375.85), fract(sin(aP.y * 47.3 + 1.) * 2317.1), fract(sin(aP.y * 13.1 + 2.) * 9187.3)) - .5;
  p += j * L * .16 * s;
  vec4 v = viewMatrix * vec4(p, 1.);
  float pxPerWorld = projectionMatrix[1][1] * uViewport.y * .5 / max(1., -v.z);
  float size = max(mix(iStyle.x, iStyle.x * .3, s) * (.6 + .8 * fract(aP.y * 3.7)), 1.8 / pxPerWorld);
  v.xy += position.xy * size;
  vUv = position.xy; vColor = iColor;
  vFade = pow(1. - s, 1.3) * iStyle.y * 1.8;
  gl_Position = projectionMatrix * v;
}`;
const TAIL_FS = /* glsl */ `
precision mediump float; in vec2 vUv; in vec3 vColor; in float vFade; out vec4 o;
void main(){ float d = length(vUv); if (d > 1.) discard; o = vec4(vColor * vFade * pow(1. - d, 1.8), 0.); }`;

function tailGeometry(particles: number) {
  const g = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array(particles * 12), ap = new Float32Array(particles * 8), idx: number[] = [];
  const rand = seeded(0.6161);
  for (let k = 0; k < particles; k++) {
    const s = k / particles, jit = rand() * 100;
    pos.set([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], k * 12);
    for (let v = 0; v < 4; v++) ap.set([s, jit], k * 8 + v * 2);
    idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aP", new THREE.BufferAttribute(ap, 2));
  g.setIndex(idx);
  return g;
}

/** Comet tails, in their own `comets` layer. Tails follow pause and reduced motion (they stop streaming; they stay drawn). */
export function cosmosCometTails(options: CosmosCometOptions = {}): GraphLayer3D {
  const particles = Math.max(4, Math.min(128, Math.floor(options.particles ?? 40)));
  const STRIDE = 16;
  let mesh: THREE.Mesh | null = null;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let buffer: THREE.InstancedInterleavedBuffer | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let comets: number[] = [];
  let maxTail = 400;
  return {
    layer: "comets",
    mount(c) {
      const meta = c.meta as CosmosMeta | undefined;
      comets = (meta?.comets ?? []).map((x) => x.index);
      maxTail = c.limits?.maxCometTail ?? 400;
      geo = tailGeometry(particles);
      buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(1, comets.length) * STRIDE), STRIDE, 1);
      buffer.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iHead", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
      geo.setAttribute("iMid", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
      geo.setAttribute("iEnd", new THREE.InterleavedBufferAttribute(buffer, 3, 6));
      geo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(buffer, 3, 9));
      geo.setAttribute("iStyle", new THREE.InterleavedBufferAttribute(buffer, 4, 12));
      geo.instanceCount = 0;
      mat = createLayerMaterial({ vertexShader: TAIL_VS, fragmentShader: TAIL_FS, blending: "premultiplied" });
      mesh = new THREE.Mesh(geo, mat);
      mesh.name = "cosmos-comet-tails";
      mesh.frustumCulled = false;
      mesh.renderOrder = c.renderOrder;
      c.group.add(mesh);
    },
    update(f) {
      if (!mesh || !buffer || !mat || !geo) return;
      mat.uniforms.uTime.value = f.time;
      mat.uniforms.uViewport.value.set(f.width, f.height);
      mat.uniforms.uPixelRatio.value = f.pixelRatio;
      const m = metaOf(f);
      const out = buffer.array as Float32Array;
      const p = f.positions;
      let w = 0;
      for (const i of comets) {
        const b = m.bodies[i];
        if (!b) continue;
        const [h, mid, end] = cometTailPoints(m, i, f.time, maxTail);
        const at = w * STRIDE;
        // The live head (a lens change may be gliding it), the path's shape behind it.
        const hx = p[i * 3], hy = p[i * 3 + 1], hz = p[i * 3 + 2];
        out[at] = hx;
        out[at + 1] = hy;
        out[at + 2] = hz;
        out[at + 3] = hx + mid[0] - h[0];
        out[at + 4] = hy + mid[1] - h[1];
        out[at + 5] = hz + mid[2] - h[2];
        out[at + 6] = hx + end[0] - h[0];
        out[at + 7] = hy + end[1] - h[1];
        out[at + 8] = hz + end[2] - h[2];
        const base = [f.colors[i * 3], f.colors[i * 3 + 1], f.colors[i * 3 + 2]];
        out.set(mix3(base, b.kind === COMET ? [0.75, 0.88, 1] : [1, 1, 1], b.kind === COMET ? 0.6 : 0.35), at + 9);
        const st = f.states[i];
        out[at + 12] = f.sizes[i] * 1.3;
        out[at + 13] = Math.max(0.2, b.tail) * (st === NODE_DIMMED ? 0.15 : st === NODE_ACTIVE ? 1.4 : 1);
        out[at + 14] = st;
        out[at + 15] = b.seed;
        w++;
      }
      geo.instanceCount = w;
      buffer.needsUpdate = true;
    },
    dispose() {
      if (mesh) mesh.parent?.remove(mesh);
      geo?.dispose();
      mat?.dispose();
      mesh = null;
      geo = null;
      mat = null;
      buffer = null;
    },
  };
}

// ------------------------------------------------------------------ orbits

const ORBIT_VS = /* glsl */ `
in vec3 position; in vec3 iC; in vec3 iU; in vec3 iV; in vec4 iColor; uniform mat4 viewMatrix, projectionMatrix; out vec4 vColor;
void main(){ vColor = iColor; gl_Position = projectionMatrix * viewMatrix * vec4(iC + iU * position.x + iV * position.y, 1.); }`;
const ORBIT_FS = /* glsl */ `
precision mediump float; in vec4 vColor; out vec4 o; void main(){ o = vec4(vColor.rgb * vColor.a, 0.); }`;

export interface CosmosOrbitOptions {
  /** Line segments per orbit ring. Default 64. */
  segments?: number;
  /** Ring opacity: normal, highlighted (the selection's, its neighbours'), dimmed. */
  alpha?: { normal?: number; active?: number; dimmed?: number };
}

/**
 * The orbit paths: one ring per orbiting body round what it orbits (planets
 * round stars, moons round their moving planets), in the body's colour,
 * brighter for the highlighted. One instanced line set: a unit circle in the
 * geometry, each ring's centre, axes (its radius folded in) and colour per
 * instance. Tagged `layer: "orbits"`; the cosmos declares it hidden by default.
 */
export function cosmosOrbits(options: CosmosOrbitOptions = {}): GraphLayer3D {
  const seg = Math.max(8, Math.min(256, Math.floor(options.segments ?? 64)));
  const aNormal = options.alpha?.normal ?? 0.12;
  const aActive = options.alpha?.active ?? 0.5;
  const aDimmed = options.alpha?.dimmed ?? 0.03;
  const STRIDE = 13;
  let lines: THREE.LineSegments | null = null;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let buffer: THREE.InstancedInterleavedBuffer | null = null;
  let mat: ReturnType<typeof createLayerMaterial> | null = null;
  let owners: number[] = [];
  return {
    layer: "orbits",
    mount(c) {
      const meta = c.meta as CosmosMeta | undefined;
      owners = [];
      (meta?.bodies ?? []).forEach((b, i) => {
        if (b.parent >= 0 && !b.pinned && b.kind !== COMET && b.orbitRadius > 0) owners.push(i);
      });
      geo = new THREE.InstancedBufferGeometry();
      const pos = new Float32Array(seg * 6);
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        pos.set([Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0], k * 6);
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(1, owners.length) * STRIDE), STRIDE, 1);
      buffer.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iC", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
      geo.setAttribute("iU", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
      geo.setAttribute("iV", new THREE.InterleavedBufferAttribute(buffer, 3, 6));
      geo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(buffer, 4, 9));
      geo.instanceCount = 0;
      mat = createLayerMaterial({ vertexShader: ORBIT_VS, fragmentShader: ORBIT_FS, blending: "premultiplied" });
      lines = new THREE.LineSegments(geo, mat);
      lines.name = "cosmos-orbits";
      lines.frustumCulled = false;
      lines.renderOrder = c.renderOrder;
      c.group.add(lines);
    },
    update(f) {
      if (!geo || !buffer) return;
      const m = metaOf(f);
      const out = buffer.array as Float32Array;
      const p = f.positions;
      let w = 0;
      for (const i of owners) {
        const b = m.bodies[i];
        if (!b) continue;
        const u = liveVector(m, b, b.orbitU), v = liveVector(m, b, b.orbitV);
        const at = w * STRIDE, r = b.orbitRadius, q = b.parent;
        out[at] = p[q * 3];
        out[at + 1] = p[q * 3 + 1];
        out[at + 2] = p[q * 3 + 2];
        out[at + 3] = u[0] * r;
        out[at + 4] = u[1] * r;
        out[at + 5] = u[2] * r;
        out[at + 6] = v[0] * r;
        out[at + 7] = v[1] * r;
        out[at + 8] = v[2] * r;
        out[at + 9] = f.colors[i * 3];
        out[at + 10] = f.colors[i * 3 + 1];
        out[at + 11] = f.colors[i * 3 + 2];
        const st = f.states[i];
        out[at + 12] = st === NODE_ACTIVE ? aActive : st === NODE_DIMMED ? aDimmed : aNormal;
        w++;
      }
      geo.instanceCount = w;
      buffer.needsUpdate = true;
    },
    dispose() {
      if (lines) lines.parent?.remove(lines);
      geo?.dispose();
      mat?.dispose();
      lines = null;
      geo = null;
      mat = null;
      buffer = null;
      owners = [];
    },
  };
}

/** The layers the cosmos draws. Orbit paths start hidden; constellations appear when the lens asks for them. */
export function cosmosLayers(options: Pick<CosmosLayoutOptions, "constellations"> = {}): GraphLayerSpec[] {
  return [
    { id: "background", label: "Sky" },
    { id: "clusters", label: "Galaxies" },
    { id: "cores", label: "Galactic cores" },
    { id: "orbits", label: "Orbit paths", visible: false },
    { id: "links", label: "Light" },
    ...(options.constellations ? [{ id: "constellations", label: "Constellations" }] : []),
    { id: "comets", label: "Comet tails" },
    { id: "labels", label: "Labels" },
  ];
}

const bodyOf = (meta: unknown, i: number) => (meta as CosmosMeta | undefined)?.bodies?.[i];

/** The cosmos defaults beside its layout and look: sizes, scales and paths from the layout, galaxy names, links for the focus only. */
export const cosmosDefaults = {
  nodeSize: (_n: GraphNode, i: number, meta: unknown) => bodyOf(meta, i)?.size ?? 2,
  clusterLabel: (c: GraphCluster) => c.label ?? c.id,
  homeYaw: 0.75,
  homePitch: 0.55,
  linkVisibility: "focus" as const,
  /** Seconds a lens or sort change takes, bodies flying from their old orbits to their new ones. */
  transition: 1.2,
  /**
   * Semantic zoom: what a label names, in world units. A free star with
   * planets is always a candidate; a star in a galaxy names its system; a
   * planet or moon its orbit's gap; a core is named by its galaxy's label.
   */
  labelReach(i: number, meta: unknown): number {
    const b = bodyOf(meta, i);
    if (!b) return 0;
    const boost = b.tail > 0 ? 2 : 1;
    if (b.kind === CORE) return -1;
    if (b.kind === COMET) return Infinity;
    if (b.kind === STAR) return b.galaxy < 0 && b.extent > b.size * 1.6 ? Infinity : b.galaxy >= 0 ? b.extent : b.size * 5 * boost;
    if (b.kind === PLANET || b.kind === MOON) return (b.pinned ? b.size * 4 : b.spacing) * boost;
    return b.size * 4 * boost;
  },
  /** What selecting a body frames: a star its system, a core its galaxy, a planet its moons. */
  frameRadius(i: number, meta: unknown): number | null {
    const m = meta as CosmosMeta | undefined;
    const b = m?.bodies?.[i];
    if (!b) return null;
    if (b.kind === CORE && b.galaxy >= 0) return m!.galaxies[b.galaxy].radius * 1.25;
    if (b.extent > b.size * 1.5 && b.kind !== COMET) return b.extent;
    return null;
  },
  /** The breadcrumb path to a body: its galaxy's core, its star, its planet, itself. */
  path(i: number, meta: unknown): number[] {
    const m = meta as CosmosMeta | undefined;
    if (!m?.bodies?.[i]) return [i];
    const chain: number[] = [];
    let j = i;
    for (let guard = 0; j >= 0 && guard < 64; guard++) {
      chain.unshift(j);
      const b = m.bodies[j];
      if (b.kind === CORE) break;
      j = b.parent;
    }
    const root = m.bodies[chain[0]];
    if (root.kind !== CORE && root.galaxy >= 0 && m.galaxies[root.galaxy]) chain.unshift(m.galaxies[root.galaxy].core);
    return chain;
  },
  /** One layer per constellation, under the `constellations` switch. */
  layersFor(meta: unknown): GraphLayerSpec[] {
    return ((meta as CosmosMeta | undefined)?.constellations ?? []).map((c) => ({ id: `constellation:${c.id}`, label: c.label }));
  },
};
