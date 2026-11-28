/**
 * The cosmos layout, the `cosmos` 3D preset's physics (0.4.0). A knowledge
 * graph has hierarchical relations and associative ones; the cosmos treats
 * them differently. GRAVITY (the `systems` and `galaxies` lenses) decides what
 * orbits what, and is the only thing that places a body. LIGHT (every other
 * link) is drawn between bodies and moves nothing, except that it spreads free
 * systems so related ones sit near each other.
 *
 * - A system is a star (a real node, or a synthetic one per field value from
 *   `prepareCosmos`) with planets, and moons round the planets. Systems always
 *   orbit.
 * - A galaxy is optional: a core (again a node) with systems on its arms.
 * - A node with several memberships is a comet (a traveller) on an eccentric
 *   loop through each of its systems; a node with a recent time field carries
 *   a tail (an arrival).
 * - Constellations are named sets drawn over the sky; placement never changes.
 *
 * Nothing is random at run time: the same graph is the same sky on every load,
 * whatever its input order. A node's optional `cosmos` field still pins its
 * galaxy or its own place, and now also sets its look (skin, atmosphere,
 * rings, a host-supplied texture). Built only on the public layout contract.
 */
import { DEFAULT_LIMITS, type GraphLimits } from "../../limits";
import { normalizeGraph } from "../../graph";
import { createLayoutRunner, type LayoutEnv, type GraphLayoutStepper } from "../../layout/contract";
import { forceLayout } from "../../layout/force";
import { hash01, seeded } from "../../random";
import type { GraphCluster, GraphCosmosLook, GraphData, GraphLink, GraphNode, IndexedGraph, Vec3 } from "../../types";

export const STAR = 0;
export const PLANET = 1;
export const ASTEROID = 2;
export const MOON = 3;
/** A galaxy's core: a node at the galaxy's centre. */
export const CORE = 4;
export const COMET = 5;
export type BodyKind = typeof STAR | typeof PLANET | typeof ASTEROID | typeof MOON | typeof CORE | typeof COMET;

// ------------------------------------------------------------------- lenses

/** How bodies group: by links of a relation (`kind`), or by a node field's value. */
export type CosmosGrouping = { relation: string | string[] } | { field: string };

export interface CosmosSystemsLens {
  /**
   * `{ relation }`: a link of that kind makes its SOURCE orbit its TARGET (the
   * star); a source of a planet is a moon. `{ field }`: one star per value,
   * made by `prepareCosmos` (an array value is several memberships). `"hubs"`
   * (the default): the best-connected nodes are stars and their neighbours
   * orbit them. `"none"`: every node is a lone star.
   */
  by: CosmosGrouping | "hubs" | "none";
}

export interface CosmosGalaxiesLens {
  /** `{ relation }`: a system's star (source) belongs to the galaxy whose core is the target. `{ field }`: one core per value. */
  by: CosmosGrouping;
}

/**
 * The fields the default lens forms galaxies by, in order: the first with two
 * or more distinct values over the real nodes wins. `group` reads
 * `data.group`, else `node.group`; `type` reads `data.type`, else `node.group`.
 */
export const AUTO_GALAXY_FIELDS = ["group", "type"] as const;

/**
 * The field the default lens (no `galaxies` given) forms galaxies by: the
 * first of `AUTO_GALAXY_FIELDS` with two or more distinct values over the real
 * (non-synthetic) nodes, else null (no galaxies).
 */
export function autoGalaxyField(nodes: readonly GraphNode[]): string | null {
  for (const field of AUTO_GALAXY_FIELDS) {
    const values = new Set<string>();
    for (const n of nodes) {
      if (!n || typeof n.id !== "string" || n.synthetic) continue;
      for (const v of fieldValues(readField(n, field))) values.add(v);
      if (values.size >= 2) return field;
    }
  }
  return null;
}

/** True when the lens turns galaxies off: `false`, `null`, `"none"` or `{ by: "none" }`. */
const galaxiesOff = (g: CosmosLenses["galaxies"]) => g === false || g === null || g === "none" || (typeof g === "object" && (g as { by?: unknown }).by === "none");

export type CosmosSortKey = "degree" | "label" | "id" | { field: string };

export interface CosmosSortLens {
  /** Orbit order (inner first) and order along a galaxy's arms. Default `"degree"`. */
  by: CosmosSortKey;
  /** Default `"desc"` for degree, `"asc"` otherwise. */
  dir?: "asc" | "desc";
}

export type CosmosConstellationMatch =
  | { relation: string | string[] }
  | { field: string; value?: string | number | boolean }
  | { linkedTo: string };

export interface CosmosConstellationSpec {
  id: string;
  label?: string;
  /** `#rrggbb`. Default: a stable palette colour for the id. */
  color?: string;
  match: CosmosConstellationMatch;
}

/**
 * `"multi-membership"`: travellers. `{ field, within, now? }`: arrivals, the
 * nodes whose time field (an ISO date or epoch ms) is within `within`
 * (`"14d"`, `"12h"`, `"2w"`, ms) of `now` (default: when the layout starts).
 */
export type CosmosCometLens = "multi-membership" | { field: string; within: string | number; now?: string | number };

/** Everything the cosmos can be told, as JSON. The `cosmos` prop on `<GraphView3D>` takes exactly this. */
export interface CosmosLenses {
  systems?: CosmosSystemsLens | null;
  /**
   * Absent (the default): when the nodes have two or more groups (`node.group`
   * or a `type` field), one spiral galaxy per group, so regrouping the data
   * re-forms the galaxies. Not with `systems: { by: { relation } }`, whose
   * hierarchy already says what orbits what. `false` / `"none"` / `null`: no
   * galaxies (0.4.0's default sky).
   */
  galaxies?: CosmosGalaxiesLens | false | "none" | null;
  sort?: CosmosSortLens | null;
  constellations?: CosmosConstellationSpec[] | { by: { field: string } } | null;
  /** Default `"multi-membership"`. `false` or `[]` turns comets off: the first membership wins and the rest are light. */
  comets?: CosmosCometLens | CosmosCometLens[] | false | null;
  /** `"semantic"` (default): labels appear by scale as you zoom. `"size"`: every label competes by its size on screen. */
  labels?: "semantic" | "size";
}

export type CosmosLookKind = "star" | "planet" | "moon" | "asteroid" | "comet";

export interface CosmosLayoutOptions extends CosmosLenses {
  /** Most planets per star in `"hubs"` systems before another star is made. Default 14. */
  maxOrbiters?: number;
  /**
   * In a galaxy, the largest share of its members one `"hubs"` system may
   * hold (at least 3), so a galaxy is several systems rather than one big
   * one. Default 0.2. Every system in a galaxy is also capped by
   * `limits.maxPlanetsPerSystem`.
   */
  hubShare?: number;
  /** The home view direction the sky faces. Match GraphScene's homeYaw / homePitch. */
  homeYaw?: number;
  homePitch?: number;
  /** CSS colour per galaxy key, carried on each galaxy cluster (its label uses it). */
  colors?: Record<string, string>;
  /** How fast the universe (galaxies and free systems) turns about its centre, radians per second. Default 0.004. 0 stops it. */
  galaxyOrbitSpeed?: number;
  /** How fast a galaxy turns about its core, as its rim's speed in world units per second. Default 6. 0 stops it. */
  spinSpeed?: number;
  /** A traveller's mean speed along its loop, world units per second. Default 16. */
  cometSpeed?: number;
  /** Default looks per body kind, under each node's own `cosmos` fields. */
  looks?: Partial<Record<CosmosLookKind, GraphCosmosLook>>;
}

const LENS_KEYS = ["systems", "galaxies", "sort", "constellations", "comets", "labels"] as const;
/** The options with the lenses replaced by `lenses` (the `cosmos` prop): speeds and looks stay. */
export function withLenses(options: CosmosLayoutOptions, lenses: CosmosLenses): CosmosLayoutOptions {
  const out: CosmosLayoutOptions = { ...options };
  for (const k of LENS_KEYS) delete out[k];
  return { ...out, ...lenses };
}

// --------------------------------------------------------------- the model

/** A resolved look: what the body shader draws. Colours are CSS (`#rrggbb`) or null for the theme's. */
export interface CosmosLook {
  /** 0 none (stars, cores), 1 gas, 2 rocky, 3 ice, 4 cratered, 5 lava, 6 ocean. */
  skin: number;
  colors: [string | null, string | null];
  texture: string | null;
  atmosphere: { color: string | null; thickness: number; glow: number } | null;
  rings: { color: string | null; inner: number; outer: number; tilt: number; opacity: number } | null;
}

export const SKINS: Readonly<Record<string, number>> = Object.freeze({ gas: 1, rocky: 2, ice: 3, cratered: 4, lava: 5, ocean: 6 });

/**
 * One node's body. `home`, `orbitU` and `orbitV` are in its frame's REST pose
 * (time 0): its galaxy's, or the universe's for a free body. Live positions
 * are the layout's output.
 */
export interface CosmosBody {
  kind: BodyKind;
  /** Its galaxy, or -1 in open space. */
  galaxy: number;
  /** The root of its system (its star, or itself); a comet's home star. */
  system: number;
  size: number;
  seed: number;
  ringed: boolean;
  /** Where a root (or a pinned body) sits at rest. */
  home: Vec3;
  /** What it orbits (or, pinned, what it is placed against), or -1. A comet's home star. */
  parent: number;
  /** 0 for a star, 1 a planet, 2 a moon... */
  depth: number;
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  orbitU: Vec3;
  orbitV: Vec3;
  /** Placed by its `cosmos.offset`. */
  pinned: boolean;
  /** Made by the preset (a centre for a field value). */
  synthetic: boolean;
  /** How far its system (it and everything orbiting it) reaches, world units. */
  extent: number;
  /** The gap between its orbit and the one inside it: how big its orbit must be on screen to read its label. */
  spacing: number;
  /** Comet tail strength, 0 (none) to 1. */
  tail: number;
  look: CosmosLook;
}

export interface CosmosGalaxy {
  /** The cluster id: a field value, or the core node's id. */
  key: string;
  /** Kept for 0.3.0 readers: the same as `key`. */
  type: string;
  /** The core node's index. */
  core: number;
  /** Root bodies (stars, rogues) in it, in sort order. */
  systems: number[];
  /** Live: the core's position now. Mutated in place every step. */
  center: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  radius: number;
  arms: number;
  twist: number;
  seed: number;
  /** Every node in it, the core included. */
  members: number[];
  coreRadius: number;
  warmth: number;
  scatter: number;
  density: number;
  links: number;
  restCenter: Vec3;
  restU: Vec3;
  restV: Vec3;
  pinned: boolean;
  orbitSpeed: number;
  spinSpeed: number;
}

export interface CosmosPlacementIssue {
  id: string;
  field: "cosmos" | "cosmos.galaxy" | "cosmos.offset" | "cosmos.skin" | "cosmos.texture" | "cosmos.atmosphere" | "cosmos.rings";
  reason: string;
}

export interface CosmosComet {
  index: number;
  /** Stars a traveller visits, home first. Empty for an arrival. */
  stops: number[];
  /** Seconds for one loop (travellers). */
  period: number;
  phase: number;
}

export interface CosmosConstellation {
  id: string;
  label: string;
  color: string | null;
  /** Node indices, by id. */
  members: number[];
  /** The figure: a minimum spanning tree over the members' resting places. */
  edges: [number, number][];
  /** Each member's resting place (time 0), by node index. */
  rest: Record<number, Vec3>;
}

export interface CosmosMeta {
  bodies: CosmosBody[];
  galaxies: CosmosGalaxy[];
  /** The axis the universe turns about (the home view direction). */
  axis: Vec3;
  /** Live: the universe's turn now, radians. */
  universeAngle: number;
  ids: string[];
  /** Each node's label (else its id). */
  names: string[];
  index: Map<string, number>;
  /** Link weight per node over LIGHT links only (no gravity, nothing synthetic). Ranks by degree. */
  lightDegree: Float64Array;
  /** Per link: 0 light, 1 system gravity, 2 galaxy gravity, 3 other synthetic. Light links are the ones drawn. */
  gravity: Uint8Array;
  comets: CosmosComet[];
  constellations: CosmosConstellation[];
  placementIssues: CosmosPlacementIssue[];
  lookIssues: CosmosPlacementIssue[];
  /** Lens values that were ignored (a bad comet window), as text. */
  lensIssues: string[];
  /** Placement order: every body after what it depends on. */
  order: number[];
  labels: "semantic" | "size";
  /** A body's position at any animated time, the same the layout writes at that time. */
  positionAt(i: number, t: number, out: Float32Array | number[]): void;
}

// ------------------------------------------------------------------ vectors

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => scale(a, 1 / (len(a) || 1));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finiteOr = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function plane(n: V): { u: V; v: V } {
  const ref: V = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(ref, n));
  return { u, v: cross(n, u) };
}
/** `v` turned by `phi` about the unit axis `a` (Rodrigues). */
function rotate(v: V, a: V, phi: number): V {
  if (phi === 0) return [v[0], v[1], v[2]];
  const cs = Math.cos(phi), sn = Math.sin(phi), ax = cross(a, v), k = dot(a, v) * (1 - cs);
  return [v[0] * cs + ax[0] * sn + a[0] * k, v[1] * cs + ax[1] * sn + a[1] * k, v[2] * cs + ax[2] * sn + a[2] * k];
}

/** A point on a galaxy's spiral, `f` from core (0) to rim (1), on its live frame. Shared with the dust layer. */
export function spiralPoint(g: Pick<CosmosGalaxy, "center" | "u" | "v" | "normal" | "radius" | "arms" | "twist" | "seed">, f: number, arm: number, rand: () => number, scatter = 0.1): V {
  const r = g.radius * (0.06 + 0.94 * Math.sqrt(f));
  const angle = (arm / g.arms) * Math.PI * 2 + g.twist * Math.sqrt(f) + g.seed * Math.PI * 2 + (rand() - 0.5) * scatter * 5;
  const spread = 1 + (rand() - 0.5) * scatter;
  const lift = (rand() - 0.5) * g.radius * 0.1 * (1.15 - f);
  return add(add(add(g.center, scale(g.u, Math.cos(angle) * r * spread)), scale(g.v, Math.sin(angle) * r * spread)), scale(g.normal, lift));
}

/** The rest-frame point `p` in its galaxy's local frame: [along u, along v, along the normal], from the core. */
export function galaxyLocal(g: CosmosGalaxy, p: Vec3): Vec3 {
  const q = sub(p, g.restCenter);
  return [dot(q, g.restU), dot(q, g.restV), dot(q, g.normal)];
}

// ----------------------------------------------------------------- reading

/** A node field: `data[field]` first; `type` / `group` read `node.group`; `label` / `id` the node's own. */
export function readField(node: GraphNode, field: string): unknown {
  const d = node.data;
  if (d && typeof d === "object" && Object.prototype.hasOwnProperty.call(d, field)) return d[field];
  if (field === "type" || field === "group") return node.group;
  if (field === "label") return node.label;
  if (field === "id") return node.id;
  return undefined;
}

/** A field's values as strings, in order, without repeats: an array is several, empty is none. */
export function fieldValues(v: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : [v]) {
    const s = typeof x === "string" ? x : typeof x === "number" && Number.isFinite(x) ? String(x) : typeof x === "boolean" ? String(x) : "";
    if (s !== "" && !out.includes(s)) out.push(s);
  }
  return out;
}

const relationsOf = (lens: { by: unknown } | null | undefined): string[] | null => {
  const by = lens?.by as { relation?: unknown } | undefined;
  if (!by || typeof by !== "object" || by.relation === undefined) return null;
  const list = Array.isArray(by.relation) ? by.relation : [by.relation];
  return list.filter((x): x is string => typeof x === "string" && x !== "");
};
const fieldOf = (lens: { by: unknown } | null | undefined): string | null => {
  const by = lens?.by as { field?: unknown } | undefined;
  return by && typeof by === "object" && typeof by.field === "string" && by.field !== "" ? by.field : null;
};

export const SYSTEM_PREFIX = "cosmos:system:";
export const GALAXY_PREFIX = "cosmos:galaxy:";
/** The `kind` of a synthetic gravity link to a system's star or a galaxy's core. */
export const SYSTEM_LINK = "cosmos:system";
export const GALAXY_LINK = "cosmos:galaxy";

/**
 * The cosmos preset's `prepare` step: for a `{ field }` systems or galaxies
 * lens, one synthetic centre node per value (`cosmos:system:<value>`,
 * `cosmos:galaxy:<value>`, labelled with the value, `synthetic: true`) and a
 * synthetic link from every member to it. The centres come first, so the
 * limits keep them; they count against `maxNodes` / `maxLinks` like any node.
 * The input is never mutated. Without a field lens the data is returned as is.
 */
export function prepareCosmos(data: GraphData, lenses: CosmosLenses = {}): GraphData {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const links = Array.isArray(data?.links) ? data.links : [];
  const sys = fieldOf(lenses.systems ?? undefined);
  // An explicit gravity relation already says what orbits what (its groups usually name body kinds: star, planet, moon), so groups do not cut across it.
  const auto = lenses.galaxies === undefined && !relationsOf(lenses.systems ?? undefined) ? autoGalaxyField(nodes) : null;
  const gal = galaxiesOff(lenses.galaxies) ? null : (fieldOf(lenses.galaxies as CosmosGalaxiesLens | undefined) ?? auto);
  if (!sys && !gal) return data;
  const taken = new Set<string>();
  for (const n of nodes) if (n && typeof n.id === "string") taken.add(n.id);
  const extraNodes: GraphNode[] = [];
  const extraLinks: GraphLink[] = [];
  const make = (prefix: string, kind: string, field: string, mark: boolean) => {
    const members = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const n of nodes) {
      if (!n || typeof n.id !== "string" || n.synthetic || seen.has(n.id)) continue;
      seen.add(n.id);
      for (const v of fieldValues(readField(n, field))) {
        if (!members.has(v)) members.set(v, []);
        members.get(v)!.push(n.id);
      }
    }
    for (const v of [...members.keys()].sort(cmp)) {
      let id = prefix + v;
      while (taken.has(id)) id += "~";
      taken.add(id);
      // A centre the default lens made says which field made it, so the layout reads the same field.
      extraNodes.push(mark ? { id, label: v, group: v, synthetic: true, data: { cosmosAutoField: field } } : { id, label: v, group: v, synthetic: true });
      for (const m of members.get(v)!) extraLinks.push({ source: m, target: id, kind, synthetic: true });
    }
  };
  if (gal) make(GALAXY_PREFIX, GALAXY_LINK, gal, lenses.galaxies === undefined);
  if (sys) make(SYSTEM_PREFIX, SYSTEM_LINK, sys, false);
  return { nodes: [...extraNodes, ...nodes], links: [...extraLinks, ...links] };
}

// The bundler replaces `process.env.NODE_ENV`; with no bundler and no `process`, it is dev.
declare const process: { env: Record<string, string | undefined> };
function devMode(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function readVec(v: unknown, lengths: number[], max: number): V | string {
  if (!Array.isArray(v)) return "must be an array of numbers";
  if (!lengths.includes(v.length)) return `must have ${lengths.join(" or ")} numbers, got ${v.length}`;
  for (const x of v) if (typeof x !== "number" || !Number.isFinite(x)) return "must hold finite numbers only";
  if (v.some((x: number) => Math.abs(x) > max)) return `is past limits.maxPlacement (${max})`;
  return [v[0], v[1], v[2] ?? 0];
}

interface Placement {
  galaxy?: V;
  offset?: V;
}
function readPlacement(node: GraphNode, max: number, issues: CosmosPlacementIssue[]): Placement {
  const raw = (node as { cosmos?: unknown }).cosmos;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({ id: node.id, field: "cosmos", reason: "must be an object like { galaxy: [x, y, z] } or { offset: [x, y] }" });
    return {};
  }
  const out: Placement = {};
  const { galaxy, offset } = raw as { galaxy?: unknown; offset?: unknown };
  if (galaxy !== undefined) {
    const g = readVec(galaxy, [3], max);
    if (typeof g === "string") issues.push({ id: node.id, field: "cosmos.galaxy", reason: g });
    else out.galaxy = g;
  }
  if (offset !== undefined) {
    const o = readVec(offset, [2, 3], max);
    if (typeof o === "string") issues.push({ id: node.id, field: "cosmos.offset", reason: o });
    else out.offset = o;
  }
  return out;
}

/** A URL a host may hand the cosmos for a texture: http(s), blob, a data IMAGE, or a relative path. Anything with another scheme is refused. */
export function safeTextureUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const t = u.trim();
  if (!t || t.length > 8192) return null;
  if (/^(https?:|blob:)/i.test(t) || /^data:image\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  return t;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const colorOr = (c: unknown, field: CosmosPlacementIssue["field"], id: string, issues: CosmosPlacementIssue[]): string | null => {
  if (c === undefined) return null;
  if (typeof c === "string" && HEX.test(c.trim())) return c.trim();
  issues.push({ id, field, reason: "colours must be #rgb or #rrggbb" });
  return null;
};
const numIn = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? clamp(x, lo, hi) : d);

function defaultLook(kind: BodyKind, seed: number): GraphCosmosLook {
  const r = seeded(seed + 0.77);
  const a = r(), b = r();
  if (kind === MOON) return { skin: "cratered" };
  if (kind === ASTEROID) return { skin: "rocky" };
  if (kind === COMET) return { skin: "ice", atmosphere: { thickness: 0.9, glow: 1.3 } };
  if (kind !== PLANET) return {};
  const skin = a < 0.42 ? "gas" : a < 0.7 ? "rocky" : a < 0.85 ? "ice" : "ocean";
  return {
    skin,
    atmosphere: skin === "gas" || skin === "ocean" ? { thickness: 0.14, glow: 0.7 } : skin === "ice" ? { thickness: 0.08, glow: 0.5 } : undefined,
    rings: skin === "gas" && b < 0.5 ? { inner: 1.35, outer: 2.25, opacity: 0.7 } : undefined,
  };
}

function resolveLook(node: GraphNode, kind: BodyKind, seed: number, preset: GraphCosmosLook | undefined, issues: CosmosPlacementIssue[]): CosmosLook {
  const raw = (node as { cosmos?: unknown }).cosmos;
  const own = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as GraphCosmosLook) : {};
  const base = { ...defaultLook(kind, seed), ...(preset ?? {}) };
  const id = node.id;
  const emissive = kind === STAR || kind === CORE;
  const out: CosmosLook = { skin: 0, colors: [null, null], texture: null, atmosphere: null, rings: null };

  const readSkin = (s: unknown, report: boolean) => {
    if (s === undefined) return false;
    const name = typeof s === "string" ? s : s && typeof s === "object" ? (s as { type?: unknown }).type : undefined;
    if (typeof name !== "string" || !(name in SKINS)) {
      if (report) issues.push({ id, field: "cosmos.skin", reason: `must be one of ${Object.keys(SKINS).join(", ")}` });
      return false;
    }
    out.skin = emissive ? 0 : SKINS[name];
    const colors = s && typeof s === "object" ? (s as { colors?: unknown }).colors : undefined;
    if (colors !== undefined) {
      if (!Array.isArray(colors) || colors.length > 2) issues.push({ id, field: "cosmos.skin", reason: "colors must be an array of one or two #rrggbb colours" });
      else out.colors = [colorOr(colors[0], "cosmos.skin", id, issues), colorOr(colors[1], "cosmos.skin", id, issues)];
    }
    return true;
  };
  if (!readSkin(own.skin, true)) readSkin(base.skin, false);
  if (emissive) out.skin = 0;

  if (own.texture !== undefined) {
    const url = safeTextureUrl(own.texture);
    if (url === null) issues.push({ id, field: "cosmos.texture", reason: "must be an http(s), blob, data:image or relative URL the host supplies" });
    else if (!emissive) out.texture = url;
  }

  const readAtmo = (a: unknown, report: boolean): CosmosLook["atmosphere"] | undefined => {
    if (a === undefined) return undefined;
    if (a === false) return null;
    if (a === true) return { color: null, thickness: 0.14, glow: 0.7 };
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      if (report) issues.push({ id, field: "cosmos.atmosphere", reason: "must be true, false or { color, thickness, glow }" });
      return undefined;
    }
    const o = a as { color?: unknown; thickness?: unknown; glow?: unknown };
    return { color: colorOr(o.color, "cosmos.atmosphere", id, issues), thickness: numIn(o.thickness, 0, 1, 0.14), glow: numIn(o.glow, 0, 2, 0.7) };
  };
  const atmo = readAtmo(own.atmosphere, true);
  out.atmosphere = atmo !== undefined ? atmo : (readAtmo(base.atmosphere, false) ?? null);

  const readRings = (r: unknown, report: boolean): CosmosLook["rings"] | undefined => {
    if (r === undefined) return undefined;
    if (r === false) return null;
    if (r === true) return { color: null, inner: 1.35, outer: 2.25, tilt: 0, opacity: 0.7 };
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      if (report) issues.push({ id, field: "cosmos.rings", reason: "must be true, false or { color, inner, outer, tilt, opacity }" });
      return undefined;
    }
    const o = r as { color?: unknown; inner?: unknown; outer?: unknown; tilt?: unknown; opacity?: unknown };
    const inner = numIn(o.inner, 1.05, 3.5, 1.35);
    return { color: colorOr(o.color, "cosmos.rings", id, issues), inner, outer: Math.max(inner + 0.05, numIn(o.outer, 1.1, 4, 2.25)), tilt: numIn(o.tilt, -1.5, 1.5, 0), opacity: numIn(o.opacity, 0, 1, 0.7) };
  };
  const rings = readRings(own.rings, true);
  out.rings = emissive ? null : rings !== undefined ? rings : (readRings(base.rings, false) ?? null);
  return out;
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i;
const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
function parseWindow(w: unknown): number | null {
  if (typeof w === "number") return Number.isFinite(w) && w > 0 ? w : null;
  if (typeof w !== "string") return null;
  const m = DURATION.exec(w.trim());
  return m ? +m[1] * UNIT[m[2].toLowerCase()] : null;
}
function parseTime(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// ------------------------------------------------------------------ layout

interface Frame {
  c: V;
  u: V;
  v: V;
  n: V;
}

/** Catmull-Rom on a closed loop of points. */
function catmull(p0: V, p1: V, p2: V, p3: V, s: number): V {
  const s2 = s * s, s3 = s2 * s;
  const out: V = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * s + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * s2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * s3);
  return out;
}

export function cosmosLayout(options: CosmosLayoutOptions = {}): GraphLayoutStepper & { meta: CosmosMeta } {
  const maxOrbiters = Math.max(1, Math.floor(finiteOr(options.maxOrbiters, 14)));
  const yaw = finiteOr(options.homeYaw, 0.75);
  const pitch = finiteOr(options.homePitch, 0.55);
  const universeSpeed = finiteOr(options.galaxyOrbitSpeed, 0.004);
  const rimSpeed = finiteOr(options.spinSpeed, 6);
  const cometSpeed = Math.max(0.1, finiteOr(options.cometSpeed, 16));
  const meta: CosmosMeta = {
    bodies: [],
    galaxies: [],
    axis: [0, 0, 1],
    universeAngle: 0,
    ids: [],
    names: [],
    index: new Map(),
    lightDegree: new Float64Array(0),
    gravity: new Uint8Array(0),
    comets: [],
    constellations: [],
    placementIssues: [],
    lookIssues: [],
    lensIssues: [],
    order: [],
    labels: options.labels === "size" ? "size" : "semantic",
    positionAt: () => {},
  };
  /** Comet path data, by node index. */
  const cometPaths = new Map<number, { stops: number[]; peri: number[]; cum: number[]; frac: number[]; period: number; phase: number }>();

  const frameAt = (g: CosmosGalaxy, t: number): Frame => {
    const c = g.orbitSpeed === 0 ? g.restCenter : rotate(g.restCenter, meta.axis, g.orbitSpeed * t);
    const th = g.spinSpeed * t, cs = Math.cos(th), sn = Math.sin(th), u0 = g.restU, v0 = g.restV;
    return {
      c,
      u: [u0[0] * cs + v0[0] * sn, u0[1] * cs + v0[1] * sn, u0[2] * cs + v0[2] * sn],
      v: [v0[0] * cs - u0[0] * sn, v0[1] * cs - u0[1] * sn, v0[2] * cs - u0[2] * sn],
      n: g.normal,
    };
  };
  /** A rest-frame vector of body `b`'s frame, turned to time `t` (`fr` is its galaxy's frame then). */
  const turn = (b: CosmosBody, q: V, fr: Frame | null, phiU: number): V => {
    if (b.galaxy >= 0 && fr) {
      const g = meta.galaxies[b.galaxy];
      const lu = dot(q, g.restU), lv = dot(q, g.restV), ln = dot(q, g.normal);
      return [fr.u[0] * lu + fr.v[0] * lv + fr.n[0] * ln, fr.u[1] * lu + fr.v[1] * lv + fr.n[1] * ln, fr.u[2] * lu + fr.v[2] * lv + fr.n[2] * ln];
    }
    return rotate(q, meta.axis, phiU);
  };
  /** A body's position at `t`, given its frame, the parent's position then and (a comet) its stops' positions then. */
  const placeOne = (i: number, t: number, fr: Frame | null, phiU: number, parentPos: V | null, stopPos: V[] | null): V => {
    const b = meta.bodies[i];
    if (b.kind === CORE && b.galaxy >= 0) return fr ? [...fr.c] : [...meta.galaxies[b.galaxy].restCenter];
    if (b.kind === COMET && stopPos && stopPos.length > 1) return cometAt(i, t, stopPos);
    if (b.parent < 0) {
      if (b.galaxy >= 0 && fr) {
        const g = meta.galaxies[b.galaxy];
        return add(fr.c, turn(b, sub(b.home, g.restCenter), fr, phiU));
      }
      return rotate(b.home, meta.axis, phiU);
    }
    if (b.pinned) {
      if (b.galaxy >= 0 && fr && pinnedToGalaxy.has(i)) {
        const g = meta.galaxies[b.galaxy];
        return add(fr.c, turn(b, sub(b.home, g.restCenter), fr, phiU));
      }
      return add(parentPos ?? [0, 0, 0], turn(b, b.home, fr, phiU));
    }
    const a = b.orbitPhase + b.orbitSpeed * t;
    const ox = Math.cos(a) * b.orbitRadius, oy = Math.sin(a) * b.orbitRadius;
    const local: V = [b.orbitU[0] * ox + b.orbitV[0] * oy, b.orbitU[1] * ox + b.orbitV[1] * oy, b.orbitU[2] * ox + b.orbitV[2] * oy];
    return add(parentPos ?? [0, 0, 0], turn(b, local, fr, phiU));
  };
  /** Bodies pinned by `cosmos.offset` relative to their galaxy's core (rest-frame home), rather than to their parent. */
  const pinnedToGalaxy = new Set<number>();

  const waypoints = (c: { stops: number[]; peri: number[] }, S: V[]): V[] => {
    const C = scale(S.reduce((s, p) => add(s, p), [0, 0, 0] as V), 1 / S.length);
    const out: V[] = [];
    S.forEach((p, j) => {
      let o = sub(p, C);
      if (len(o) < 1e-6) o = [1, 0, 0];
      o = unit(o);
      let tdir = cross(meta.axis, o);
      if (len(tdir) < 1e-6) tdir = plane(o).u;
      tdir = unit(tdir);
      const r = c.peri[j];
      for (const al of [-0.75, 0.75]) out.push(add(p, add(scale(o, Math.cos(al) * r), scale(tdir, Math.sin(al) * r))));
    });
    return out;
  };
  const cometAt = (i: number, t: number, S: V[]): V => {
    const c = cometPaths.get(i)!;
    const W = waypoints(c, S);
    const m = W.length;
    let u = (c.phase + t / c.period) % 1;
    if (u < 0) u += 1;
    let seg = 0;
    while (seg < m - 1 && u >= c.cum[seg + 1]) seg++;
    let l = (u - c.cum[seg]) / (c.frac[seg] || 1);
    // A transit between systems (odd segments) is fast near each end and slow far out: an eccentric orbit's feel.
    if (seg % 2 === 1) l = l + (0.6 * Math.sin(2 * Math.PI * l)) / (2 * Math.PI);
    return catmull(W[(seg - 1 + m) % m], W[seg], W[(seg + 1) % m], W[(seg + 2) % m], clamp(l, 0, 1));
  };

  const positionAt = (i: number, t: number, out: Float32Array | number[]) => {
    const memo = new Map<number, V>();
    const frames = new Map<number, Frame>();
    const phiU = universeSpeed * t;
    const frOf = (g: number) => {
      if (g < 0) return null;
      if (!frames.has(g)) frames.set(g, frameAt(meta.galaxies[g], t));
      return frames.get(g)!;
    };
    const pos = (j: number, guard: number): V => {
      const hit = memo.get(j);
      if (hit) return hit;
      const b = meta.bodies[j];
      const parent = b.parent >= 0 && guard < 64 && b.kind !== COMET ? pos(b.parent, guard + 1) : b.pinned && b.parent >= 0 ? pos(b.parent, guard + 1) : null;
      const stops = b.kind === COMET && cometPaths.has(j) ? cometPaths.get(j)!.stops.map((s) => pos(s, guard + 1)) : null;
      const p = placeOne(j, t, frOf(b.galaxy), phiU, parent, stops);
      memo.set(j, p);
      return p;
    };
    if (i < 0 || i >= meta.bodies.length) return;
    const p = pos(i, 0);
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
  };
  meta.positionAt = positionAt;

  const frames = (t: number) => {
    meta.universeAngle = universeSpeed * t;
    for (const g of meta.galaxies) {
      const f = frameAt(g, t);
      g.center.splice(0, 3, f.c[0], f.c[1], f.c[2]);
      g.u.splice(0, 3, f.u[0], f.u[1], f.u[2]);
      g.v.splice(0, 3, f.v[0], f.v[1], f.v[2]);
    }
  };
  const placeAll = (t: number, out: Float32Array) => {
    frames(t);
    const fr = meta.galaxies.map((g) => ({ c: g.center, u: g.u, v: g.v, n: g.normal }));
    const read = (j: number): V => [out[j * 3], out[j * 3 + 1], out[j * 3 + 2]];
    for (const i of meta.order) {
      const b = meta.bodies[i];
      const parent = b.parent >= 0 ? read(b.parent) : null;
      const stops = b.kind === COMET && cometPaths.has(i) ? cometPaths.get(i)!.stops.map(read) : null;
      const p = placeOne(i, t, b.galaxy >= 0 ? fr[b.galaxy] : null, meta.universeAngle, parent, stops);
      out[i * 3] = p[0];
      out[i * 3 + 1] = p[1];
      out[i * 3 + 2] = p[2];
    }
  };

  return {
    name: "cosmos",
    animated: true,
    meta,
    init(graph: IndexedGraph, out: Float32Array, env?: LayoutEnv) {
      const limits: GraphLimits = { ...DEFAULT_LIMITS, ...(env?.limits ?? {}) };
      const n = graph.nodes.length;
      const nodes = graph.nodes;
      const id = (i: number) => nodes[i].id;
      const byId = (a: number, b: number) => cmp(id(a), id(b));
      cometPaths.clear();
      pinnedToGalaxy.clear();
      meta.ids = nodes.map((x) => x.id);
      meta.names = nodes.map((x) => (typeof x.label === "string" && x.label ? x.label : x.id));
      meta.index = graph.index;
      meta.lensIssues = [];
      const placementIssues: CosmosPlacementIssue[] = [];
      const lookIssues: CosmosPlacementIssue[] = [];
      const placements = nodes.map((node) => readPlacement(node, finiteOr(limits.maxPlacement, 100000), placementIssues));
      const synthetic = nodes.map((x) => x.synthetic === true);

      // ---- 1. Which links are gravity.
      const sysMode = options.systems === null ? "none" : (options.systems?.by ?? "hubs");
      const sysRel = relationsOf(options.systems ?? undefined);
      const sysField = fieldOf(options.systems ?? undefined);
      const galLens = galaxiesOff(options.galaxies) ? undefined : (options.galaxies as CosmosGalaxiesLens | undefined);
      const galRel = relationsOf(galLens);
      // The default lens: the field `prepareCosmos` formed galaxies by, read off the centres it made.
      let autoField: string | null = null;
      if (options.galaxies === undefined)
        for (let i = 0; i < n && !autoField; i++) {
          const f = synthetic[i] && id(i).startsWith(GALAXY_PREFIX) ? nodes[i].data?.cosmosAutoField : undefined;
          if (typeof f === "string" && f) autoField = f;
        }
      const galField = fieldOf(galLens) ?? autoField;
      const gravity = new Uint8Array(graph.links.length);
      for (const l of graph.links) {
        const kind = l.link.kind;
        if (l.link.synthetic === true) gravity[l.index] = kind === SYSTEM_LINK && sysField ? 1 : kind === GALAXY_LINK && galField ? 2 : 3;
        else if (sysRel && typeof kind === "string" && sysRel.includes(kind)) gravity[l.index] = 1;
        else if (galRel && typeof kind === "string" && galRel.includes(kind)) gravity[l.index] = 2;
      }

      // ---- 2. Galaxy cores and each node's own galaxy.
      const isCore = new Uint8Array(n);
      const nodeCore = new Int32Array(n).fill(-1);
      const galLinks = graph.links.filter((l) => gravity[l.index] === 2);
      if (galField || galRel) {
        for (const l of galLinks) isCore[l.b] = 1;
        if (galField) for (let i = 0; i < n; i++) if (synthetic[i] && id(i).startsWith(GALAXY_PREFIX)) isCore[i] = 1;
        const cand: { core: number; rank: number }[][] = Array.from({ length: n }, () => []);
        for (const l of galLinks) if (!isCore[l.a] && !cand[l.a].some((c) => c.core === l.b)) cand[l.a].push({ core: l.b, rank: galRel ? galRel.indexOf(String(l.link.kind)) : 0 });
        for (let i = 0; i < n; i++) {
          if (isCore[i]) {
            nodeCore[i] = i;
            continue;
          }
          if (!cand[i].length) continue;
          // First membership by lens order: the field's own value order, or the relation's place in the lens.
          const order = galField ? fieldValues(readField(nodes[i], galField)) : [];
          const rankOf = (c: { core: number; rank: number }) => (galField ? order.indexOf(String(nodes[c.core].label)) : c.rank);
          cand[i].sort((a, b) => rankOf(a) - rankOf(b) || byId(a.core, b.core));
          nodeCore[i] = cand[i][0].core;
        }
      }

      // ---- 3. Gravity parents: candidates in lens order.
      const parents: number[][] = Array.from({ length: n }, () => []);
      const sysLinks = graph.links.filter((l) => gravity[l.index] === 1);
      const linkBetween = new Map<string, number>();
      for (const l of sysLinks) linkBetween.set(`${l.a}>${l.b}`, l.index);
      if (sysMode !== "none" && sysMode !== "hubs" && (sysRel || sysField)) {
        if (sysField) {
          const starOf = new Map<string, number>();
          for (let i = 0; i < n; i++) if (synthetic[i] && id(i).startsWith(SYSTEM_PREFIX)) starOf.set(String(nodes[i].label), i);
          for (let i = 0; i < n; i++) {
            if (synthetic[i] || isCore[i]) continue;
            for (const v of fieldValues(readField(nodes[i], sysField))) {
              const s = starOf.get(v);
              if (s !== undefined && linkBetween.has(`${i}>${s}`)) parents[i].push(s);
            }
          }
        } else {
          const byChild: { l: (typeof sysLinks)[number]; r: number }[][] = Array.from({ length: n }, () => []);
          for (const l of sysLinks) byChild[l.a].push({ l, r: sysRel!.indexOf(String(l.link.kind)) });
          for (let i = 0; i < n; i++) {
            if (isCore[i]) continue;
            const list = byChild[i].sort((x, y) => x.r - y.r || byId(x.l.b, y.l.b));
            for (const { l } of list) {
              if (isCore[l.b]) {
                // Orbiting a core: a lone star in that galaxy.
                if (nodeCore[i] < 0) nodeCore[i] = l.b;
                continue;
              }
              if (!parents[i].includes(l.b)) parents[i].push(l.b);
            }
          }
        }
      }

      // ---- 4. A forest: first parent wins; cycles are cut; depth is capped.
      const parent = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) if (parents[i].length) parent[i] = parents[i][0];
      const state = new Uint8Array(n);
      const ids = Array.from({ length: n }, (_, i) => i).sort(byId);
      for (const s of ids) {
        const path: number[] = [];
        let j = s;
        while (j >= 0 && state[j] === 0) {
          state[j] = 1;
          path.push(j);
          j = parent[j];
        }
        if (j >= 0 && state[j] === 1) {
          const cycle = path.slice(path.indexOf(j));
          parent[cycle.reduce((a, b) => (byId(a, b) <= 0 ? a : b))] = -1;
        }
        for (const p of path) state[p] = 2;
      }
      const rootOf = (i: number) => {
        let j = i, guard = 0;
        while (parent[j] >= 0 && guard++ < n) j = parent[j];
        return j;
      };

      // ---- 5. Travellers: several memberships in different systems.
      const cometLenses = options.comets === false || options.comets === null ? [] : options.comets === undefined ? ["multi-membership" as const] : Array.isArray(options.comets) ? options.comets : [options.comets];
      const travellersOn = cometLenses.includes("multi-membership");
      const travellers: { i: number; stops: number[] }[] = [];
      if (travellersOn)
        for (let i = 0; i < n; i++) {
          if (parents[i].length < 2) continue;
          const stops: number[] = [];
          for (const p of parents[i]) {
            const r = rootOf(p);
            if (r !== i && !stops.includes(r)) stops.push(r);
          }
          if (stops.length >= 2) travellers.push({ i, stops: stops.slice(0, Math.max(2, Math.floor(limits.maxCometStops))) });
        }
      travellers.sort((a, b) => b.stops.length - a.stops.length || byId(a.i, b.i));
      const cometCap = Math.max(0, Math.floor(limits.maxComets));
      const keptTravellers = travellers.slice(0, cometCap);
      const isTraveller = new Map(keptTravellers.map((t) => [t.i, t.stops]));
      // A membership that did not win (and is not a kept traveller's) is light.
      for (let i = 0; i < n; i++) {
        if (parents[i].length < 2 || isTraveller.has(i)) continue;
        for (const p of parents[i].slice(1)) {
          const li = linkBetween.get(`${i}>${p}`);
          if (li !== undefined) gravity[li] = graph.links[li].link.synthetic ? 3 : 0;
        }
      }
      for (const [i, stops] of isTraveller) parent[i] = stops[0];

      // ---- 6. Light degree: real, associative weight only.
      const lightDegree = new Float64Array(n);
      for (const l of graph.links)
        if (gravity[l.index] === 0 && !l.link.synthetic) {
          lightDegree[l.a] += l.weight;
          lightDegree[l.b] += l.weight;
        }
      for (let i = 0; i < n; i++) lightDegree[i] = Math.round(lightDegree[i] * 1e9) / 1e9;
      const lightAdj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
      for (const l of graph.links)
        if (gravity[l.index] === 0 && !l.link.synthetic) {
          lightAdj[l.a].set(l.b, (lightAdj[l.a].get(l.b) ?? 0) + l.weight);
          lightAdj[l.b].set(l.a, (lightAdj[l.b].get(l.a) ?? 0) + l.weight);
        }

      // ---- 7a. In galaxies, systems stay small: none holds more than limits.maxPlanetsPerSystem bodies (planets
      // and moons), and a hub no more than a modest share of its galaxy. Without galaxies, 0.4.0's sky stands.
      const galactic = !!(galField || galRel);
      const hubShare = clamp(finiteOr(options.hubShare, 0.2), 0.01, 1);
      const planetCap = Math.max(1, Math.floor(limits.maxPlanetsPerSystem));
      const galSize = new Map<number, number>();
      for (let i = 0; i < n; i++) if (!isCore[i] && !synthetic[i] && nodeCore[i] >= 0) galSize.set(nodeCore[i], (galSize.get(nodeCore[i]) ?? 0) + 1);
      const capOf = (i: number) => {
        const size = nodeCore[i] >= 0 ? (galSize.get(nodeCore[i]) ?? 0) : 0;
        return size ? Math.min(planetCap, Math.max(3, Math.ceil(hubShare * size))) : planetCap;
      };

      // ---- 7. Hubs: the best-connected are stars, their neighbours planets, the planets' neighbours moons.
      if (sysMode === "hubs") {
        const rank = Array.from({ length: n }, (_, i) => i).filter((i) => !isCore[i] && !synthetic[i]).sort((a, b) => lightDegree[b] - lightDegree[a] || byId(a, b));
        const role = new Int8Array(n).fill(-1); // 0 star, 1 planet, 2 moon, 3 rogue
        const load = new Map<number, number>();
        /** In galaxies: bodies in each star's system, planets and moons. */
        const sysLoad = new Map<number, number>();
        const rankOf = new Map(rank.map((x, k) => [x, k]));
        const strongest = (i: number, j: number) => {
          let best = -1, w = -1;
          for (const li of graph.incident[i]) {
            const l = graph.links[li];
            if ((l.a === j || l.b === j) && gravity[li] === 0 && l.weight > w) (best = li), (w = l.weight);
          }
          return best;
        };
        for (const i of rank) {
          if (lightDegree[i] === 0) {
            role[i] = 3;
            continue;
          }
          const pickBest = (want: number, cap: number) => {
            let host = -1, best = 0;
            for (const [j, w] of lightAdj[i]) {
              if (role[j] !== want || nodeCore[j] !== nodeCore[i] || (load.get(j) ?? 0) >= cap) continue;
              if (galactic) {
                const star = want === 0 ? j : parent[j];
                if ((sysLoad.get(star) ?? 0) >= capOf(star)) continue;
              }
              if (w > best || (w === best && host >= 0 && rankOf.get(j)! < rankOf.get(host)!)) (best = w), (host = j);
            }
            return host;
          };
          let host = pickBest(0, maxOrbiters);
          let as = 1;
          if (host < 0) {
            host = pickBest(1, 4);
            as = 2;
          }
          if (host < 0) {
            role[i] = 0;
            continue;
          }
          role[i] = as;
          parent[i] = host;
          load.set(host, (load.get(host) ?? 0) + 1);
          if (galactic) {
            const star = as === 1 ? host : parent[host];
            sysLoad.set(star, (sysLoad.get(star) ?? 0) + 1);
          }
          const li = strongest(i, host);
          if (li >= 0) gravity[li] = 1;
        }
      }

      // ---- 7b. In galaxies, any system past its cap (a field or relation star with a crowd) keeps its
      // best-connected bodies, inner orbits first; the rest become stars of their own on the same galaxy's arms.
      if (galactic) {
        const kids: number[][] = Array.from({ length: n }, () => []);
        for (let i = 0; i < n; i++) if (parent[i] >= 0 && !isTraveller.has(i)) kids[parent[i]].push(i);
        const order = (a: number, b: number) => lightDegree[b] - lightDegree[a] || byId(a, b);
        for (const k of kids) k.sort(order);
        const coreOfSystem = (r: number) => {
          if (nodeCore[r] >= 0) return nodeCore[r];
          const votes = new Map<number, number>();
          const stack = [...kids[r]];
          while (stack.length) {
            const j = stack.pop()!;
            if (nodeCore[j] >= 0) votes.set(nodeCore[j], (votes.get(nodeCore[j]) ?? 0) + 1);
            stack.push(...kids[j]);
          }
          let best = -1, bv = 0;
          for (const [c, v] of votes) if (v > bv || (v === bv && best >= 0 && byId(c, best) < 0)) (bv = v), (best = c);
          return best;
        };
        const queue = Array.from({ length: n }, (_, i) => i).filter((i) => parent[i] < 0 && !isCore[i] && !isTraveller.has(i) && kids[i].length).sort(byId);
        for (let q = 0; q < queue.length; q++) {
          const r = queue[q];
          const cap = sysMode === "hubs" ? capOf(r) : planetCap;
          const core = coreOfSystem(r);
          let kept = 0;
          let frontier = [r];
          while (frontier.length) {
            const next: number[] = [];
            for (const p of frontier)
              for (const c of kids[p]) {
                if (kept < cap) {
                  kept++;
                  next.push(c);
                  continue;
                }
                parent[c] = -1;
                if (nodeCore[c] < 0) nodeCore[c] = core;
                for (const li of graph.incident[c]) {
                  const l = graph.links[li];
                  if (gravity[li] === 1 && (l.a === p || l.b === p)) gravity[li] = l.link.synthetic ? 3 : 0;
                }
                if (kids[c].length) queue.push(c);
              }
            frontier = next;
          }
        }
      }

      // ---- 8. Depth, capped.
      const maxDepth = Math.max(2, Math.floor(limits.maxOrbitDepth));
      const depth = new Int32Array(n).fill(-1);
      const depthOf = (i: number): number => {
        if (depth[i] >= 0) return depth[i];
        const chain: number[] = [];
        let j = i;
        while (j >= 0 && depth[j] < 0 && chain.length <= n) {
          chain.push(j);
          j = isTraveller.has(j) ? -1 : parent[j];
        }
        let d = j >= 0 ? depth[j] : -1;
        for (let k = chain.length - 1; k >= 0; k--) depth[chain[k]] = ++d;
        return depth[i];
      };
      for (let i = 0; i < n; i++) depthOf(i);
      for (const [i] of isTraveller) depth[i] = 1;
      // Deeper than allowed: orbit the deepest allowed ancestor.
      const byDepth = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[a] - depth[b] || byId(a, b));
      for (const i of byDepth) {
        if (isTraveller.has(i) || parent[i] < 0) continue;
        depth[i] = depth[parent[i]] + 1;
        if (depth[i] > maxDepth - 1) {
          let j = parent[i];
          while (depth[j] > maxDepth - 2 && parent[j] >= 0) j = parent[j];
          parent[i] = j;
          depth[i] = depth[j] + 1;
        }
      }

      // ---- 9. Comets: kept travellers, then arrivals, up to maxComets.
      const tail = new Float64Array(n);
      for (const [i] of isTraveller) tail[i] = 1;
      const arrivals = cometLenses.filter((x): x is Exclude<CosmosCometLens, "multi-membership"> => typeof x === "object" && x !== null);
      const arrivalList: { i: number; tail: number; age: number }[] = [];
      for (const a of arrivals) {
        const within = parseWindow(a.within);
        const now = a.now !== undefined ? parseTime(a.now) : Date.now();
        if (within === null || now === null || typeof a.field !== "string") {
          meta.lensIssues.push(`comets: ${JSON.stringify(a)} needs a field, a window like "14d" and a valid now; ignored`);
          continue;
        }
        for (let i = 0; i < n; i++) {
          if (synthetic[i] || isCore[i] || isTraveller.has(i)) continue;
          const t = parseTime(readField(nodes[i], a.field));
          if (t === null) continue;
          const age = now - t;
          if (age > within) continue;
          arrivalList.push({ i, tail: age <= 0 ? 1 : clamp(1 - age / within, 0.15, 1), age });
        }
      }
      arrivalList.sort((x, y) => x.age - y.age || byId(x.i, y.i));
      const seenArrival = new Set<number>();
      let room = cometCap - keptTravellers.length;
      const keptArrivals: number[] = [];
      for (const a of arrivalList) {
        if (seenArrival.has(a.i) || room <= 0) continue;
        seenArrival.add(a.i);
        tail[a.i] = a.tail;
        keptArrivals.push(a.i);
        room--;
      }

      // ---- 10. Kinds.
      const children: number[][] = Array.from({ length: n }, () => []);
      for (let i = 0; i < n; i++) if (parent[i] >= 0 && !isTraveller.has(i)) children[parent[i]].push(i);
      const kindOf = (i: number): BodyKind => {
        if (isCore[i]) return CORE;
        if (isTraveller.has(i)) return COMET;
        if (parent[i] >= 0) return depth[i] >= 2 ? MOON : PLANET;
        if (synthetic[i] || children[i].length || sysMode === "none" || lightDegree[i] > 0) return STAR;
        return ASTEROID;
      };

      // ---- 11. Galaxies: each root's own core, else the most common among its system's members.
      const rootGalaxyCore = new Int32Array(n).fill(-1);
      const roots = Array.from({ length: n }, (_, i) => i).filter((i) => parent[i] < 0 && !isCore[i] && !isTraveller.has(i));
      const descendants = (r: number) => {
        const out: number[] = [];
        const stack = [...children[r]];
        while (stack.length) {
          const j = stack.pop()!;
          out.push(j);
          stack.push(...children[j]);
        }
        return out;
      };
      for (const r of roots) {
        if (nodeCore[r] >= 0) {
          rootGalaxyCore[r] = nodeCore[r];
          continue;
        }
        const votes = new Map<number, number>();
        for (const d of descendants(r)) if (nodeCore[d] >= 0) votes.set(nodeCore[d], (votes.get(nodeCore[d]) ?? 0) + 1);
        let best = -1, bv = 0;
        for (const [c, v] of votes) if (v > bv || (v === bv && best >= 0 && byId(c, best) < 0)) (bv = v), (best = c);
        rootGalaxyCore[r] = best;
      }
      const coreSystems = new Map<number, number[]>();
      for (const r of roots) if (rootGalaxyCore[r] >= 0) {
        if (!coreSystems.has(rootGalaxyCore[r])) coreSystems.set(rootGalaxyCore[r], []);
        coreSystems.get(rootGalaxyCore[r])!.push(r);
      }
      // A core with no systems is no galaxy: it floats as a lone star.
      const cores = Array.from({ length: n }, (_, i) => i).filter((i) => isCore[i] && coreSystems.has(i));
      for (let i = 0; i < n; i++) if (isCore[i] && !coreSystems.has(i)) {
        isCore[i] = 0;
        roots.push(i);
      }
      const galaxyKey = (c: number) => (galField && synthetic[c] ? String(nodes[c].label ?? id(c)) : id(c));

      // ---- 12. Sort.
      const sort = options.sort ?? { by: "degree" as const };
      const key = sort.by ?? "degree";
      const dir = sort.dir ?? (key === "degree" ? "desc" : "asc");
      const sign = dir === "desc" ? -1 : 1;
      const sortValue = (i: number): number | string | null => {
        if (key === "degree") return lightDegree[i];
        if (key === "label") return String(nodes[i].label ?? id(i));
        if (key === "id") return id(i);
        if (key && typeof key === "object" && typeof key.field === "string") {
          const v = readField(nodes[i], key.field);
          return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" ? v : null;
        }
        return lightDegree[i];
      };
      const bySort = (a: number, b: number) => {
        const x = sortValue(a), y = sortValue(b);
        if (x === null || y === null) return x === y ? byId(a, b) : x === null ? 1 : -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : cmp(String(x), String(y));
        return c !== 0 ? sign * Math.sign(c) : byId(a, b);
      };

      // ---- 13. Sizes, looks and extents.
      const kinds = Array.from({ length: n }, (_, i) => kindOf(i));
      const seeds = nodes.map((x) => hash01(x.id));
      const sizes = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const k = kinds[i];
        const own = nodes[i].size;
        if (typeof own === "number" && Number.isFinite(own) && own > 0) {
          sizes[i] = Math.min(own, finiteOr(limits.maxPlacement, 100000));
          continue;
        }
        const ld = lightDegree[i];
        const rand = seeded(seeds[i] + 0.5);
        sizes[i] =
          k === STAR ? (children[i].length ? 8 + Math.min(15, Math.sqrt(ld + children[i].length) * 2) : 3.5 + Math.min(8, Math.sqrt(ld) * 1.6))
          : k === PLANET ? 3 + Math.min(6, Math.sqrt(ld) * 1.1) + Math.min(2, children[i].length * 0.4)
          : k === MOON ? 1.3 + Math.min(2.4, Math.sqrt(ld) * 0.6)
          : k === COMET ? 2.4
          : k === CORE ? 6
          : 1.5 + rand() * 1.1;
      }
      const lookKey: Record<number, CosmosLookKind | undefined> = { [STAR]: "star", [PLANET]: "planet", [MOON]: "moon", [ASTEROID]: "asteroid", [COMET]: "comet" };
      const looks = nodes.map((node, i) => resolveLook(node, kinds[i], seeds[i], lookKey[kinds[i]] ? options.looks?.[lookKey[kinds[i]]!] : undefined, lookIssues));
      // Textures: the first maxTextures distinct images, in id order; the rest are reported.
      const maxTex = Math.max(0, Math.floor(limits.maxTextures));
      const textures = new Set<string>();
      for (const i of ids) {
        const url = looks[i].texture;
        if (!url) continue;
        if (textures.has(url)) continue;
        if (textures.size >= maxTex) {
          lookIssues.push({ id: id(i), field: "cosmos.texture", reason: `past limits.maxTextures (${maxTex}); drawn with its procedural skin` });
          looks[i].texture = null;
          continue;
        }
        textures.add(url);
      }
      for (const i of ids) if (looks[i].texture && !textures.has(looks[i].texture!)) looks[i].texture = null;

      const extent = new Float64Array(n);
      const spacing = new Float64Array(n);
      const orbitRadius = new Float64Array(n);
      const baseExtent = (i: number) => sizes[i] * Math.max(1 + (looks[i].atmosphere?.thickness ?? 0), looks[i].rings ? looks[i].rings!.outer : 1);
      const orbiting = (p: number) => children[p].filter((c) => !placements[c].offset).sort(bySort);
      const deepFirst = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[b] - depth[a] || byId(a, b));
      for (const p of deepFirst) {
        extent[p] = Math.max(extent[p], baseExtent(p));
        const kids = orbiting(p);
        if (!kids.length) continue;
        const big = depth[p] === 0;
        let r = sizes[p] * (big ? 2.1 : 1.7) + (big ? 10 : 3);
        for (const c of kids) {
          const ex = Math.max(extent[c], baseExtent(c));
          const before = r;
          r += ex;
          orbitRadius[c] = r + seeded(seeds[c] + 0.5)() * (big ? 3 : 1);
          spacing[c] = orbitRadius[c] - before + ex;
          r = orbitRadius[c] + ex + (big ? 6.5 : 2);
        }
        extent[p] = Math.max(extent[p], r);
      }

      // ---- 14. Bodies.
      const bodies: CosmosBody[] = Array.from({ length: n }, (_, i) => ({
        kind: kinds[i],
        galaxy: -1,
        system: i,
        size: sizes[i],
        seed: seeds[i],
        ringed: !!looks[i].rings,
        home: [0, 0, 0],
        parent: parent[i],
        depth: Math.max(0, depth[i]),
        orbitRadius: orbitRadius[i],
        orbitPhase: 0,
        orbitSpeed: 0,
        orbitU: [1, 0, 0],
        orbitV: [0, 1, 0],
        pinned: false,
        synthetic: synthetic[i],
        extent: extent[i],
        spacing: spacing[i],
        tail: tail[i],
        look: looks[i],
      }));
      for (let i = 0; i < n; i++) bodies[i].system = isTraveller.has(i) ? isTraveller.get(i)![0] : rootOf(i);
      meta.bodies = bodies;

      // ---- 15. Galaxy shapes.
      const toCamera: V = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
      const right: V = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up = cross(toCamera, right);
      meta.axis = unit(toCamera);
      const coreIndex = new Map<number, number>();
      const galaxyMembers = new Map<number, number[]>();
      for (const c of cores) galaxyMembers.set(c, [c]);
      for (let i = 0; i < n; i++) {
        if (isCore[i] && coreSystems.has(i)) continue;
        const r = bodies[i].system;
        const c = rootGalaxyCore[r];
        if (c >= 0 && galaxyMembers.has(c) && kinds[i] !== COMET) galaxyMembers.get(c)!.push(i);
      }
      const sortedCores = [...cores].sort((a, b) => galaxyMembers.get(b)!.length - galaxyMembers.get(a)!.length || cmp(galaxyKey(a), galaxyKey(b)));
      sortedCores.forEach((c, gi) => coreIndex.set(c, gi));
      for (const [c, list] of galaxyMembers) for (const i of list) bodies[i].galaxy = coreIndex.get(c)!;
      // A comet reports its home system's galaxy, but travels in open space.
      const inGal = (i: number) => bodies[i].galaxy;
      const inside = new Map<number, number>(), outside = new Map<number, number>();
      for (const l of graph.links) {
        if (gravity[l.index] !== 0 || l.link.synthetic) continue;
        const ga = inGal(l.a), gb = inGal(l.b);
        if (ga === gb) {
          if (ga >= 0) inside.set(ga, (inside.get(ga) ?? 0) + 1);
        } else {
          if (ga >= 0) outside.set(ga, (outside.get(ga) ?? 0) + 1);
          if (gb >= 0) outside.set(gb, (outside.get(gb) ?? 0) + 1);
        }
      }
      // A galaxy's pin: the first valid `cosmos.galaxy` among its members in id order.
      const pins = sortedCores.map((c) => {
        let pin: V | null = null;
        for (const i of [...galaxyMembers.get(c)!].sort(byId)) {
          const g = placements[i].galaxy;
          if (!g) continue;
          if (!pin) pin = g;
          else if (g.some((x, k) => x !== pin![k])) placementIssues.push({ id: id(i), field: "cosmos.galaxy", reason: `conflicts with an earlier member's [${pin.join(", ")}]; the first in id order wins` });
        }
        return pin;
      });
      meta.galaxies = sortedCores.map((c, gi) => {
        const keyStr = galaxyKey(c);
        const members = galaxyMembers.get(c)!;
        const m = members.length - 1;
        const L = inside.get(gi) ?? 0, X = outside.get(gi) ?? 0;
        const avgDeg = m > 0 ? (2 * L) / m : 0;
        const cohesion = L + X > 0 ? L / (L + X) : 0.5;
        const linkiness = Math.min(1, avgDeg / 4);
        const seed = hash01(keyStr);
        const rand = seeded(seed);
        const [r1, r2, r3, r4, r5, r6, r7] = [rand(), rand(), rand(), rand(), rand(), rand(), rand()];
        const sys = coreSystems.get(c)!;
        const sumSq = sys.reduce((s, r) => s + extent[r] * extent[r], 0);
        const radius = Math.max((150 + 34 * Math.sqrt(m)) * (0.9 + 0.2 * r4), 2.2 * Math.sqrt(sumSq));
        const normal = unit([toCamera[0] + (rand() - 0.5) * (0.35 + r5 * 0.7), toCamera[1] + (rand() - 0.5) * (0.35 + r5 * 0.7), toCamera[2] + (rand() - 0.5) * (0.35 + r5 * 0.7)]);
        const { u, v } = plane(normal);
        return {
          key: keyStr,
          type: keyStr,
          core: c,
          systems: [...sys].sort(bySort),
          center: [0, 0, 0] as V,
          normal,
          u: [...u] as V,
          v: [...v] as V,
          radius,
          arms: m < 4 ? 2 : clamp(Math.floor(2 + r1 * 2.99 + Math.min(2, avgDeg / 3)), 2, 6),
          twist: 2.4 + r2 * 1.6 + cohesion * 1.6,
          seed,
          members,
          coreRadius: radius * (0.05 + 0.05 * linkiness + 0.02 * r6),
          warmth: clamp(0.2 + 0.55 * r7 + 0.25 * Math.min(1, Math.log10(1 + m) / 3), 0, 1),
          scatter: 0.2 + (1 - cohesion) * 0.25 + r3 * 0.08,
          density: 0.6 + 0.8 * linkiness,
          links: L,
          restCenter: [0, 0, 0] as V,
          restU: u,
          restV: v,
          pinned: !!pins[gi],
          orbitSpeed: 0,
          spinSpeed: -rimSpeed / radius,
        };
      });
      for (const g of meta.galaxies) {
        bodies[g.core].size = clamp(g.coreRadius * 0.3, 5, 40);
        bodies[g.core].extent = g.radius * 1.25;
      }

      // ---- 16. The universe: galaxies and free roots, spread by their light links, never overlapping.
      type UB = { key: string; r: number; x: number; y: number; pinned: V | null; gal: number; root: number };
      const ub: UB[] = [];
      meta.galaxies.forEach((g, gi) => ub.push({ key: `g:${g.key}`, r: g.radius * 1.25, x: 0, y: 0, pinned: pins[gi], gal: gi, root: -1 }));
      const freeRoots = roots.filter((r) => rootGalaxyCore[r] < 0 || !coreIndex.has(rootGalaxyCore[r]));
      for (const r of freeRoots) ub.push({ key: `n:${id(r)}`, r: Math.max(extent[r], sizes[r]), x: 0, y: 0, pinned: null, gal: -1, root: r });
      ub.sort((a, b) => cmp(a.key, b.key));
      const ubOf = new Int32Array(n).fill(-1);
      ub.forEach((u, k) => {
        if (u.gal >= 0) for (const i of meta.galaxies[u.gal].members) ubOf[i] = k;
        else ubOf[u.root] = k;
      });
      for (let i = 0; i < n; i++) if (ubOf[i] < 0) ubOf[i] = ubOf[bodies[i].system] ?? -1;
      const ulinks = new Map<string, number>();
      for (const l of graph.links) {
        if (gravity[l.index] !== 0 || l.link.synthetic) continue;
        const a = ubOf[l.a], b = ubOf[l.b];
        if (a < 0 || b < 0 || a === b) continue;
        const k = a < b ? `${a}:${b}` : `${b}:${a}`;
        ulinks.set(k, (ulinks.get(k) ?? 0) + l.weight);
      }
      const uedges = [...ulinks.entries()].map(([k, w]) => {
        const [a, b] = k.split(":").map(Number);
        return { a, b, w };
      }).sort((x, y) => x.a - y.a || x.b - y.b);
      spread(ub, uedges, right, up, Math.max(1, Math.floor(limits.maxSpreadTicks)));
      for (const u of ub) {
        const depthOff = u.pinned ? 0 : (hash01(u.key + "#z") - 0.5) * Math.min(u.r * 1.2, 80);
        const p: V = u.pinned ? [...u.pinned] : add(add(scale(right, u.x), scale(up, u.y)), scale(toCamera, depthOff));
        if (u.gal >= 0) {
          const g = meta.galaxies[u.gal];
          g.restCenter = p;
          g.center = [...p];
          const atCentre = len(p) < 1e-6;
          g.orbitSpeed = g.pinned || atCentre ? 0 : universeSpeed;
        } else bodies[u.root].home = p;
      }

      // ---- 17. Homes on the arms, orbits, pins.
      const pinAt = (g: CosmosGalaxy, o: V): V => add(add(add(g.restCenter, scale(g.restU, o[0])), scale(g.restV, o[1])), scale(g.normal, o[2]));
      for (const g of meta.galaxies) {
        g.systems.forEach((s, j) => {
          const b = bodies[s];
          const off = placements[s].offset;
          if (off) {
            b.pinned = true;
            b.home = pinAt(g, off);
            return;
          }
          b.home = spiralPoint({ ...g, center: g.restCenter, u: g.restU, v: g.restV }, 0.2 + (0.8 * (j + 0.5)) / g.systems.length, j % g.arms, seeded(b.seed), 0.12);
        });
      }
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        if (b.kind === CORE || b.kind === COMET || b.parent < 0) {
          if (b.parent < 0 && placements[i].offset && b.galaxy < 0 && b.kind !== CORE) placementIssues.push({ id: id(i), field: "cosmos.offset", reason: "has no galaxy or star to be relative to; ignored" });
          continue;
        }
        const g = b.galaxy >= 0 ? meta.galaxies[b.galaxy] : null;
        const off = placements[i].offset;
        if (off) {
          b.pinned = true;
          if (g) {
            b.home = pinAt(g, off);
            pinnedToGalaxy.add(i);
          } else b.home = add(add(scale(right, off[0]), scale(up, off[1])), scale(toCamera, off[2]));
          continue;
        }
        const rand = seeded(b.seed + 0.5);
        rand();
        b.orbitPhase = rand() * Math.PI * 2;
        const v = b.depth >= 2 ? 4.5 : 9;
        b.orbitSpeed = ((rand() < 0.08 ? -1 : 1) * v) / Math.max(1, b.orbitRadius);
        const tilt = (rand() - 0.5) * (b.depth >= 2 ? 0.7 : 0.38);
        const N = g ? g.normal : meta.axis;
        const U = g ? g.restU : right;
        const o = plane(unit(add(N, scale(U, tilt))));
        b.orbitU = o.u;
        b.orbitV = o.v;
      }

      // ---- 18. Placement order: roots and cores, then by depth, comets after their stops.
      meta.order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
        const da = bodies[a].kind === CORE ? -1 : bodies[a].depth, db = bodies[b].kind === CORE ? -1 : bodies[b].depth;
        return da - db || byId(a, b);
      });

      // ---- 19. Traveller loops.
      meta.comets = [];
      frames(0);
      placeAll(0, out);
      for (const [i, stops] of isTraveller) {
        const peri = stops.map((s, j) => (j === 0 ? sizes[s] * 2.2 + 12 : Math.max(sizes[s] * 2.5 + 14, extent[s] * 0.6)));
        const S0 = stops.map((s): V => [out[s * 3], out[s * 3 + 1], out[s * 3 + 2]]);
        // Visit the stops in turn around their centre, home first, so the loop never crosses itself.
        const C = scale(S0.reduce((s, p) => add(s, p), [0, 0, 0] as V), 1 / S0.length);
        const ref = unit(sub(S0[0], C));
        const refT = unit(cross(meta.axis, ref));
        const ang = (p: V) => {
          const d = sub(p, C);
          let a = Math.atan2(dot(d, refT), dot(d, ref));
          if (a < 0) a += Math.PI * 2;
          return a;
        };
        const orderIdx = stops.map((_, j) => j).sort((x, y) => (x === 0 ? -1 : y === 0 ? 1 : ang(S0[x]) - ang(S0[y])));
        const st = orderIdx.map((j) => stops[j]);
        const pr = orderIdx.map((j) => peri[j]);
        const W = waypoints({ stops: st, peri: pr }, orderIdx.map((j) => S0[j]));
        const segs = W.map((w, k) => len(sub(W[(k + 1) % W.length], w)) + 1e-6);
        const total = segs.reduce((s, x) => s + x, 0);
        const frac = segs.map((x) => x / total);
        const cum: number[] = [];
        for (let k = 0, acc = 0; k < frac.length; acc += frac[k], k++) cum.push(acc);
        const period = Math.max(5.5, (total * 1.15) / cometSpeed);
        cometPaths.set(i, { stops: st, peri: pr, cum, frac, period, phase: seeded(seeds[i] + 0.9)() });
        meta.comets.push({ index: i, stops: st, period, phase: cometPaths.get(i)!.phase });
      }
      for (const i of keptArrivals) meta.comets.push({ index: i, stops: [], period: 0, phase: 0 });
      meta.comets.sort((a, b) => byId(a.index, b.index));

      meta.lightDegree = lightDegree;
      meta.gravity = gravity;
      placementIssues.sort((a, b) => cmp(a.id, b.id) || cmp(a.field, b.field));
      lookIssues.sort((a, b) => cmp(a.id, b.id) || cmp(a.field, b.field));
      meta.placementIssues = placementIssues;
      meta.lookIssues = lookIssues;
      const all = [...placementIssues, ...lookIssues];
      if ((all.length || meta.lensIssues.length) && devMode()) {
        const list = all.slice(0, 8).map((x) => `"${x.id}" ${x.field} ${x.reason}`).concat(meta.lensIssues).join("; ");
        console.warn(`fancy-graph cosmos: ignored ${all.length + meta.lensIssues.length} bad value(s), the layout's defaults stand in: ${list}${all.length > 8 ? "; ..." : ""}`);
      }

      // ---- 20. Constellations over the resting sky.
      placeAll(0, out);
      meta.constellations = resolveConstellations(graph, options.constellations, synthetic, lightDegree, out, limits);
    },
    step(out, frame) {
      placeAll(frame.time, out);
      return true;
    },
    clusters(): GraphCluster[] {
      return meta.galaxies.map((g) => ({
        id: g.key,
        label: meta.names[g.core] ?? g.key,
        center: [g.center[0], g.center[1], g.center[2]],
        radius: g.radius,
        members: g.members,
        normal: g.normal,
        color: options.colors?.[g.key],
        data: { core: meta.ids[g.core], arms: g.arms, twist: g.twist, seed: g.seed, coreRadius: g.coreRadius, warmth: g.warmth, pinned: g.pinned },
      }));
    },
  };
}

/**
 * Spreads universe bodies (galaxies and free systems) in the home view's plane:
 * springs along their light links pull related ones together, a weak pull
 * keeps the rest near, and collisions keep every pair apart by the sum of
 * their radii. Deterministic: a fixed start, a fixed number of steps, a fixed
 * order. Pinned bodies hold their place.
 */
function spread(ub: { key: string; r: number; x: number; y: number; pinned: V | null }[], edges: { a: number; b: number; w: number }[], right: V, up: V, ticks: number) {
  const k = ub.length;
  if (!k) return;
  const GAP = 6;
  // Structure: the kit's own force layout over the universe graph (one node per galaxy or free system,
  // its light links between them), in 2D, so linked bodies end up near each other.
  if (k > 1) {
    const g = normalizeGraph({ nodes: ub.map((u) => ({ id: u.key })), links: edges.map((e) => ({ source: ub[e.a].key, target: ub[e.b].key, weight: e.w })) }, { maxNodes: k + 1, maxLinks: edges.length + 1 });
    // Big universes take fewer steps: the cost of a step grows with the bodies.
    const steps = Math.max(30, Math.min(ticks, Math.round((ticks * 1500) / Math.max(1500, k))));
    const runner = createLayoutRunner(forceLayout({ dimensions: 2, seed: 1, iterations: steps, linkDistance: 30, charge: -30, gravity: 0.06 }), g, { dimensions: 2, reducedMotion: true, limits: { ...DEFAULT_LIMITS, maxSettleTicks: steps + 1 } });
    const p = runner.positions;
    // From force units to world units: a link becomes as long as the two bodies it joins need (the median over links).
    const ratios = edges.map((e) => {
      const d = Math.hypot(p[e.a * 3] - p[e.b * 3], p[e.a * 3 + 1] - p[e.b * 3 + 1]);
      return (ub[e.a].r + ub[e.b].r + GAP * 2) / Math.max(1e-6, d);
    }).sort((a, b) => a - b);
    const sizes = ub.map((u) => u.r).sort((a, b) => a - b);
    const scaleBy = ratios.length ? ratios[Math.floor(ratios.length / 2)] : (2 * (sizes[Math.floor(sizes.length / 2)] ?? 1) + GAP * 2) / 30;
    ub.forEach((u, i) => {
      u.x = p[i * 3] * scaleBy;
      u.y = p[i * 3 + 1] * scaleBy;
    });
    runner.dispose();
  }
  for (const u of ub)
    if (u.pinned) {
      u.x = dot(u.pinned, right);
      u.y = dot(u.pinned, up);
    }
  const mass = ub.map((u) => (u.pinned ? Infinity : Math.max(1, u.r * u.r)));
  const radii = ub.map((u) => u.r).sort((a, b) => a - b);
  // A covering grid: each body sits in every cell its box touches, so any overlapping pair shares a cell.
  const cell = 2 * ((radii[Math.floor(radii.length * 0.9)] ?? 1) + GAP);
  const grid = new Map<number, number[]>();
  const fill = () => {
    grid.clear();
    for (let i = 0; i < k; i++) {
      const u = ub[i], r = u.r + GAP / 2;
      const x0 = Math.floor((u.x - r) / cell), x1 = Math.floor((u.x + r) / cell), y0 = Math.floor((u.y - r) / cell), y1 = Math.floor((u.y + r) / cell);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = gx * 1000003 + gy;
          const list = grid.get(key);
          if (list) list.push(i);
          else grid.set(key, [i]);
        }
    }
  };
  let moved = 0;
  const push = (i: number, j: number) => {
    const a = ub[i], b = ub[j];
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = a.r + b.r + GAP;
    if (d >= min - 1e-6) return;
    const ma = mass[i], mb = mass[j];
    if (ma === Infinity && mb === Infinity) return;
    if (d < 1e-9) {
      // Coincident: separate along a direction from their keys.
      const ang = hash01(a.key + "|" + b.key) * Math.PI * 2;
      dx = Math.cos(ang);
      dy = Math.sin(ang);
      d = 1e-9;
    }
    const over = min - d + 1e-3;
    moved++;
    const fa = ma === Infinity ? 0 : mb === Infinity ? 1 : mb / (ma + mb);
    const ux = dx / d, uy = dy / d;
    a.x -= ux * over * fa;
    a.y -= uy * over * fa;
    b.x += ux * over * (1 - fa);
    b.y += uy * over * (1 - fa);
  };
  // Contacts: push touching pairs apart, a bounded number of passes.
  for (let pass = 0; pass < 40; pass++) {
    moved = 0;
    fill();
    for (const list of grid.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) push(list[x], list[y]);
    if (!moved) break;
  }
  // Whatever still touches: spread the free bodies uniformly about their centre, just enough that no pair does.
  if (moved) {
    let cx = 0, cy = 0, c = 0;
    for (let i = 0; i < k; i++)
      if (mass[i] !== Infinity) {
        cx += ub[i].x;
        cy += ub[i].y;
        c++;
      }
    cx /= c || 1;
    cy /= c || 1;
    let s = 1;
    fill();
    const checked = new Set<number>();
    for (const list of grid.values())
      for (let x = 0; x < list.length; x++)
        for (let y = x + 1; y < list.length; y++) {
          const i = Math.min(list[x], list[y]), j = Math.max(list[x], list[y]);
          const key = i * k + j;
          if (checked.has(key)) continue;
          checked.add(key);
          if (mass[i] === Infinity || mass[j] === Infinity) continue;
          const a = ub[i], b = ub[j];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const min = a.r + b.r + GAP;
          if (d < min) s = Math.max(s, (min + 1e-3) / Math.max(d, 1e-3));
        }
    if (s > 1)
      for (let i = 0; i < k; i++)
        if (mass[i] !== Infinity) {
          ub[i].x = cx + (ub[i].x - cx) * s;
          ub[i].y = cy + (ub[i].y - cy) * s;
        }
  }
  // Centre the free bodies on the origin when nothing is pinned.
  if (!ub.some((u) => u.pinned)) {
    let sx = 0, sy = 0, sm = 0;
    for (let i = 0; i < k; i++) {
      sx += ub[i].x * mass[i];
      sy += ub[i].y * mass[i];
      sm += mass[i];
    }
    const cx = sx / sm, cy = sy / sm;
    for (const u of ub) {
      u.x -= cx;
      u.y -= cy;
    }
  }
}

function resolveConstellations(graph: IndexedGraph, spec: CosmosLenses["constellations"], synthetic: boolean[], lightDegree: Float64Array, rest: Float32Array, limits: GraphLimits): CosmosConstellation[] {
  if (!spec) return [];
  const nodes = graph.nodes;
  const byId = (a: number, b: number) => cmp(nodes[a].id, nodes[b].id);
  let specs: CosmosConstellationSpec[];
  if (Array.isArray(spec)) specs = spec.filter((s) => s && typeof s.id === "string" && s.match && typeof s.match === "object");
  else if (spec && typeof spec === "object" && spec.by && typeof spec.by.field === "string") {
    const values = new Set<string>();
    nodes.forEach((n, i) => !synthetic[i] && fieldValues(readField(n, spec.by.field)).forEach((v) => values.add(v)));
    specs = [...values].sort(cmp).map((v) => ({ id: v, label: v, match: { field: spec.by.field, value: v } }));
  } else return [];
  specs = specs.slice(0, Math.max(0, Math.floor(limits.maxConstellations)));
  const cap = Math.max(1, Math.floor(limits.maxConstellationMembers));
  return specs.map((s) => {
    const set = new Set<number>();
    const m = s.match as { relation?: unknown; field?: unknown; value?: unknown; linkedTo?: unknown };
    if (m.relation !== undefined) {
      const kinds = (Array.isArray(m.relation) ? m.relation : [m.relation]).filter((x): x is string => typeof x === "string");
      for (const l of graph.links)
        if (!l.link.synthetic && typeof l.link.kind === "string" && kinds.includes(l.link.kind)) {
          if (!synthetic[l.a]) set.add(l.a);
          if (!synthetic[l.b]) set.add(l.b);
        }
    } else if (typeof m.field === "string") {
      const want = m.value === undefined ? null : String(m.value);
      nodes.forEach((n, i) => {
        if (synthetic[i]) return;
        const vs = fieldValues(readField(n, m.field as string));
        if (want === null ? vs.length > 0 : vs.includes(want)) set.add(i);
      });
    } else if (typeof m.linkedTo === "string") {
      const c = graph.index.get(m.linkedTo);
      if (c !== undefined) {
        set.add(c);
        for (const li of graph.incident[c]) {
          const l = graph.links[li];
          if (l.link.synthetic) continue;
          const o = l.a === c ? l.b : l.a;
          if (!synthetic[o]) set.add(o);
        }
      }
    }
    let members = [...set];
    if (members.length > cap) members = members.sort((a, b) => lightDegree[b] - lightDegree[a] || byId(a, b)).slice(0, cap);
    members.sort(byId);
    const restOf: Record<number, Vec3> = {};
    for (const i of members) restOf[i] = [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]];
    // Prim's minimum spanning tree; ties go to the earlier member (by id).
    const edges: [number, number][] = [];
    if (members.length > 1) {
      const inTree = new Uint8Array(members.length);
      const best = new Float64Array(members.length).fill(Infinity);
      const from = new Int32Array(members.length).fill(-1);
      inTree[0] = 1;
      const d = (x: number, y: number) => {
        const a = restOf[members[x]], b = restOf[members[y]];
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      };
      for (let j = 1; j < members.length; j++) {
        best[j] = d(0, j);
        from[j] = 0;
      }
      for (let step = 1; step < members.length; step++) {
        let pick = -1;
        for (let j = 0; j < members.length; j++) if (!inTree[j] && (pick < 0 || best[j] < best[pick])) pick = j;
        inTree[pick] = 1;
        edges.push([members[from[pick]], members[pick]]);
        for (let j = 0; j < members.length; j++)
          if (!inTree[j]) {
            const dj = d(pick, j);
            if (dj < best[j]) (best[j] = dj), (from[j] = pick);
          }
      }
    }
    return { id: s.id, label: typeof s.label === "string" && s.label ? s.label : s.id, color: typeof s.color === "string" && HEX.test(s.color) ? s.color : null, members, edges, rest: restOf };
  });
}

/**
 * The three samples a comet tail is drawn through: the body now, and where it
 * was half a tail and a whole tail ago, along its real path. A tail is a few
 * seconds of travel, scaled by the body's tail strength, and never longer
 * (head to end) than `maxTail` world units.
 */
export function cometTailPoints(meta: CosmosMeta, i: number, t: number, maxTail: number): [Vec3, Vec3, Vec3] {
  const b = meta.bodies[i];
  let tau = 8 * Math.max(0.2, b?.tail ?? 1);
  const p0 = new Float64Array(3), p1 = new Float64Array(3), p2 = new Float64Array(3);
  const sample = () => {
    meta.positionAt(i, t, p0 as unknown as number[]);
    meta.positionAt(i, t - tau / 2, p1 as unknown as number[]);
    meta.positionAt(i, t - tau, p2 as unknown as number[]);
  };
  sample();
  let chord = Math.hypot(p0[0] - p2[0], p0[1] - p2[1], p0[2] - p2[2]);
  if (chord > maxTail && chord > 0) {
    tau *= maxTail / chord;
    sample();
    chord = Math.hypot(p0[0] - p2[0], p0[1] - p2[1], p0[2] - p2[2]);
  }
  const h: Vec3 = [p0[0], p0[1], p0[2]];
  let m: Vec3 = [p1[0], p1[1], p1[2]];
  let e: Vec3 = [p2[0], p2[1], p2[2]];
  if (chord > maxTail && chord > 0) {
    const k = maxTail / chord;
    m = [h[0] + (m[0] - h[0]) * k, h[1] + (m[1] - h[1]) * k, h[2] + (m[2] - h[2]) * k];
    e = [h[0] + (e[0] - h[0]) * k, h[1] + (e[1] - h[1]) * k, h[2] + (e[2] - h[2]) * k];
  }
  return [h, m, e];
}

export interface ArcGalaxy {
  center: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  radius: number;
  twist: number;
}

/**
 * Writes a light link's path, `segments + 1` points (3 floats each) from `a`
 * to `b`, into `out`; no allocation, so the light layer can call it per link
 * per frame. See `lightArcPoints`.
 */
export function writeLightArc(out: Float64Array | Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, galaxy: ArcGalaxy | null, axis: ArrayLike<number>, bulge: number, segments: number): number {
  const S = Math.max(1, Math.floor(segments));
  const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
  out[S * 3] = bx;
  out[S * 3 + 1] = by;
  out[S * 3 + 2] = bz;
  if (galaxy) {
    const g = galaxy, c = g.center, u = g.u, v = g.v, nn = g.normal;
    const qa0 = ax - c[0], qa1 = ay - c[1], qa2 = az - c[2], qb0 = bx - c[0], qb1 = by - c[1], qb2 = bz - c[2];
    const xa = qa0 * u[0] + qa1 * u[1] + qa2 * u[2], ya = qa0 * v[0] + qa1 * v[1] + qa2 * v[2], za = qa0 * nn[0] + qa1 * nn[1] + qa2 * nn[2];
    const xb = qb0 * u[0] + qb1 * u[1] + qb2 * u[2], yb = qb0 * v[0] + qb1 * v[1] + qb2 * v[2], zb = qb0 * nn[0] + qb1 * nn[1] + qb2 * nn[2];
    const sqf = (r: number) => clamp((r / g.radius - 0.06) / 0.94, 0, 1);
    const ra = Math.hypot(xa, ya), rb = Math.hypot(xb, yb);
    const pa = Math.atan2(ya, xa) - g.twist * sqf(ra);
    let pb = Math.atan2(yb, xb) - g.twist * sqf(rb);
    while (pb - pa > Math.PI) pb -= Math.PI * 2;
    while (pb - pa < -Math.PI) pb += Math.PI * 2;
    for (let k = 1; k < S; k++) {
      const s = k / S;
      const r = ra + (rb - ra) * s;
      const th = pa + (pb - pa) * s + g.twist * sqf(r);
      const z = za + (zb - za) * s;
      const cx = Math.cos(th) * r, cy = Math.sin(th) * r;
      out[k * 3] = c[0] + u[0] * cx + v[0] * cy + nn[0] * z;
      out[k * 3 + 1] = c[1] + u[1] * cx + v[1] * cy + nn[1] * z;
      out[k * 3 + 2] = c[2] + u[2] * cx + v[2] * cy + nn[2] * z;
    }
    return S;
  }
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz);
  let px = dy * axis[2] - dz * axis[1], py = dz * axis[0] - dx * axis[2], pz = dx * axis[1] - dy * axis[0];
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-9 * (L || 1)) {
    // Along the axis: bow sideways instead.
    const q = plane(unit(L > 0 ? [dx, dy, dz] : [1, 0, 0])).u;
    [px, py, pz] = q;
    pl = 1;
  }
  const k2 = (bulge * L * 2) / pl;
  const mx = (ax + bx) / 2 + px * k2, my = (ay + by) / 2 + py * k2, mz = (az + bz) / 2 + pz * k2;
  for (let k = 1; k < S; k++) {
    const s = k / S, w0 = (1 - s) * (1 - s), w1 = 2 * s * (1 - s), w2 = s * s;
    out[k * 3] = ax * w0 + mx * w1 + bx * w2;
    out[k * 3 + 1] = ay * w0 + my * w1 + by * w2;
    out[k * 3 + 2] = az * w0 + mz * w1 + bz * w2;
  }
  return S;
}

/**
 * A light link's path, `segments + 1` points from `a` to `b`. Inside a galaxy
 * (`galaxy` given: its live frame) it runs along the arm: theta - twist *
 * sqrt(f) is interpolated, so two points on one arm are joined along that arm.
 * Otherwise it is a soft arc bowed by `bulge` (a fraction of the length) in the
 * plane facing `axis`.
 */
export function lightArcPoints(a: Vec3, b: Vec3, galaxy: ArcGalaxy | null, axis: Vec3, bulge: number, segments: number): Vec3[] {
  const S = Math.max(1, Math.floor(segments));
  const buf = new Float64Array((S + 1) * 3);
  writeLightArc(buf, a, b, galaxy, axis, bulge, S);
  return Array.from({ length: S + 1 }, (_, k): Vec3 => [buf[k * 3], buf[k * 3 + 1], buf[k * 3 + 2]]);
}

/** A rest-frame vector of body `b`'s frame, turned to now (its galaxy's live frame, or the universe's turn). Orbit rings use it. */
export function liveVector(meta: CosmosMeta, b: CosmosBody, q: Vec3): Vec3 {
  if (b.galaxy >= 0 && meta.galaxies[b.galaxy]) {
    const g = meta.galaxies[b.galaxy];
    const lu = dot(q, g.restU), lv = dot(q, g.restV), ln = dot(q, g.normal);
    return [g.u[0] * lu + g.v[0] * lv + g.normal[0] * ln, g.u[1] * lu + g.v[1] * lv + g.normal[1] * ln, g.u[2] * lu + g.v[2] * lv + g.normal[2] * ln];
  }
  return rotate(q, meta.axis, meta.universeAngle);
}
