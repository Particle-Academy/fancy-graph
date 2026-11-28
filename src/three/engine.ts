import * as THREE from "@particle-academy/fancy-3d-three/three";
import { orbitFrom, orbitPosition, type Camera3D } from "../camera";
import { groupClusters } from "../clusters";
import { colorFor, parseColor } from "../color";
import { computeLinkStates, computeNodeStates, focusOf, NODE_ACTIVE, NODE_NEIGHBOR, pickScreen } from "../interaction";
import { effectiveLinkVisibility, isLayerVisible } from "../layers";
import { LabelLayer, labelCandidates, placeLabels, type ClusterLabel, type ConstellationLabel } from "../labels";
import { createLayoutRunner, type GraphLayout, type LayoutRunner } from "../layout/contract";
import { truncateLabel, type GraphLimits } from "../limits";
import type { GraphCluster, IndexedGraph, Vec3 } from "../types";
import { linkLayer3D, nodeLayer3D } from "./layers";
import type { GraphLayer3D, GraphRenderers3D, LayerFrame3D, StageLike } from "./types";

export type ClusterSource3D = "group" | GraphCluster[] | ((graph: IndexedGraph, positions: Float32Array, meta: unknown) => GraphCluster[]);

export interface Engine3DOptions {
  renderers: GraphRenderers3D;
  clusters?: ClusterSource3D;
  clusterLabel?: (cluster: GraphCluster) => string | null;
  nodeColor?: (index: number, meta: unknown) => string;
  nodeSize?: (index: number, meta: unknown) => number;
  labelOf: (index: number) => string;
  linkVisibility: "all" | "focus" | "none";
  /** Layer visibility by id; a missing id is visible. */
  layers?: Partial<Record<string, boolean>>;
  paused: boolean;
  /** Where the home view looks from (radians). */
  homeYaw: number;
  homePitch: number;
  /** Seconds a new layout takes to fly bodies from their old positions (0: instant). Skipped under reduced motion. */
  transition?: number;
  /** Semantic zoom: world size of what each label names (see `GraphPreset3D.labelReach`). */
  labelReach?: (index: number, meta: unknown) => number;
  /** The world radius selecting a node frames, or null for the default. */
  frameRadius?: (index: number, meta: unknown) => number | null;
}

/** A named set of nodes a layout exposes as `meta.constellations` (the cosmos does). */
interface ConstellationLike {
  id: string;
  label: string;
  members: number[];
  color?: string | null;
}
const constellationsOf = (meta: unknown): ConstellationLike[] => {
  const list = (meta as { constellations?: unknown } | null | undefined)?.constellations;
  return Array.isArray(list) ? (list as ConstellationLike[]) : [];
};

export interface Engine3DCallbacks {
  onSelect(index: number): void;
  onHover(index: number): void;
  onCamera(camera: Camera3D): void;
  onEscape(): void;
  /** A constellation's label was clicked. */
  onConstellation?(id: string): void;
}

const MIN_DT = 1 / 240;
const MAX_DT = 1 / 20;
const DRAG_PX = 4;

/**
 * Finds the orbit target. With fancy-3d-three's `controls` handle it is
 * `controls.target`. Without it (0.2.1), the Stage's OrbitControls still calls
 * `camera.lookAt(controls.target)` every frame, so the first Vector3 passed
 * to lookAt IS the target; this captures it, and restores lookAt on dispose.
 */
class Orbit {
  target: THREE.Vector3 | null = null;
  private patched = false;
  private readonly hadOwn: boolean;
  private readonly own: THREE.Camera["lookAt"] | undefined;

  constructor(private readonly stage: StageLike) {
    const cam = stage.camera;
    this.hadOwn = Object.prototype.hasOwnProperty.call(cam, "lookAt");
    this.own = this.hadOwn ? cam.lookAt : undefined;
    if (stage.controls?.target) {
      this.target = stage.controls.target;
      return;
    }
    const original = cam.lookAt as (this: THREE.Object3D, ...args: unknown[]) => void;
    const capture = (v: THREE.Vector3) => {
      if (!this.target) this.target = v;
    };
    this.patched = true;
    cam.lookAt = function (this: THREE.Object3D, ...args: unknown[]) {
      const x = args[0] as THREE.Vector3 | number;
      if (typeof x !== "number" && x?.isVector3) capture(x);
      original.apply(this, args);
    } as THREE.Camera["lookAt"];
  }

  look() {
    // The prototype method, so a patched lookAt never sees the kit's own calls.
    if (this.target) (THREE.Object3D.prototype.lookAt as (this: THREE.Object3D, v: THREE.Vector3) => void).call(this.stage.camera, this.target);
  }

  restore() {
    if (!this.patched) return;
    const cam = this.stage.camera as unknown as { lookAt?: unknown };
    if (this.hadOwn) cam.lookAt = this.own;
    else delete cam.lookAt;
    this.patched = false;
  }
}

/** A layer's default visibility id, by slot (background, cluster, link, node). */
const SLOT_LAYER = ["background", "clusters", "links", "nodes"] as const;

const asList = (x: GraphLayer3D | GraphLayer3D[] | undefined, fallback: () => GraphLayer3D[]) => (x === undefined ? fallback() : Array.isArray(x) ? x : [x]);

/** The 3D renderer: drives a fancy-3d-three Stage's scene, camera and controls. */
export class StageEngine {
  private orbit: Orbit;
  private group = new THREE.Group();
  private labels: LabelLayer;
  private labelRoot: HTMLDivElement;
  private graph: IndexedGraph | null = null;
  private runner: LayoutRunner | null = null;
  private layers: { layer: GraphLayer3D; id: string; group: THREE.Group }[] = [];
  private screen = new Float32Array(0);
  private depths = new Float32Array(0);
  private order = new Uint32Array(0);
  private states = new Uint8Array(0);
  private linkStates = new Uint8Array(0);
  private sizes = new Float32Array(0);
  private colors = new Float32Array(0);
  private clusterCache: GraphCluster[] = [];
  /** What layers and labels read: the layout's positions, or a blend toward them while a new layout flies in. */
  private live: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private transition: { from: Float32Array; t: number; dur: number } | null = null;
  private reachWorld: Float32Array | null = null;
  private reachPx = new Float32Array(0);
  private constellation: string | null = null;
  private constellationMembers: Set<number> | null = null;
  private effectiveMatches: Set<number> | null = null;
  private selected = -1;
  private hovered = -1;
  private focused = -1;
  private neighborhood = false;
  private matches: Set<number> | null = null;
  private follow = -1;
  private followOffset = new THREE.Vector3();
  private travelling = false;
  private goalTarget: THREE.Vector3 | null = null;
  private goalDist: number | null = null;
  private goalDir: THREE.Vector3 | null = null;
  private homePending = true;
  private extent = 100;
  private center = new THREE.Vector3();
  private last = 0;
  private stop: () => void;
  private down: { x: number; y: number; button: number; shift: boolean } | null = null;
  private controlsLimits: { min?: number; max?: number } | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private spherical = new THREE.Spherical();

  constructor(
    private readonly stage: StageLike,
    private limits: GraphLimits,
    private opts: Engine3DOptions,
    private readonly cb: Engine3DCallbacks,
    private reducedMotion: boolean,
  ) {
    this.orbit = new Orbit(stage);
    this.group.name = "fancy-graph";
    stage.scene.add(this.group);
    const c = stage.controls;
    if (c) {
      // The kit clamps distance itself, relative to the graph; a Stage default of 80 would fight it.
      this.controlsLimits = { min: c.minDistance, max: c.maxDistance };
      c.minDistance = 0;
      c.maxDistance = Infinity;
    }
    this.labelRoot = stage.overlayRoot.ownerDocument.createElement("div");
    this.labelRoot.setAttribute("data-fancy-graph-labels", "");
    this.labelRoot.setAttribute("aria-hidden", "true");
    this.labelRoot.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    stage.overlayRoot.appendChild(this.labelRoot);
    this.labels = new LabelLayer(this.labelRoot, { pool: limits.maxLabels + limits.maxForcedLabels });
    const cv = stage.canvas;
    cv.addEventListener("pointerdown", this.onDown);
    cv.addEventListener("pointermove", this.onMove);
    cv.addEventListener("pointerup", this.onUp);
    cv.addEventListener("pointercancel", this.onCancel);
    cv.addEventListener("pointerleave", this.onLeave);
    cv.addEventListener("wheel", this.onWheel, { passive: true });
    cv.addEventListener("keydown", this.onKey);
    this.stop = stage.onFrame(() => this.frame());
  }

  // ---------------------------------------------------------------- state in

  setGraph(graph: IndexedGraph, layout: GraphLayout) {
    const prevSelectedId = this.graph && this.selected >= 0 ? this.graph.nodes[this.selected]?.id : null;
    // What was on screen, so the new layout can fly bodies in from there.
    const prev = this.graph && this.runner ? { graph: this.graph, live: Float32Array.from(this.live), time: this.runner.time } : null;
    this.runner?.dispose();
    this.graph = graph;
    const n = graph.nodes.length;
    this.runner = createLayoutRunner(layout, graph, { dimensions: 3, limits: this.limits, reducedMotion: this.reducedMotion });
    // An animated replacement picks up the animated time where the last one was, so nothing jumps back to time 0.
    if (prev && prev.time > 0) this.runner.seek(prev.time);
    this.runner.setPaused(this.opts.paused);
    this.live = this.runner.positions;
    this.transition = null;
    const dur = this.opts.transition ?? 0;
    if (prev && dur > 0 && !this.reducedMotion && n) {
      const from = Float32Array.from(this.runner.positions);
      let shared = 0;
      for (let i = 0; i < n; i++) {
        const j = prev.graph.index.get(graph.nodes[i].id);
        if (j === undefined || j * 3 + 2 >= prev.live.length) continue;
        from[i * 3] = prev.live[j * 3];
        from[i * 3 + 1] = prev.live[j * 3 + 1];
        from[i * 3 + 2] = prev.live[j * 3 + 2];
        shared++;
      }
      if (shared) {
        this.transition = { from, t: 0, dur };
        this.live = Float32Array.from(from);
      }
    }
    this.reachPx = new Float32Array(n);
    this.screen = new Float32Array(n * 4);
    this.depths = new Float32Array(n);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.states = new Uint8Array(n);
    this.linkStates = new Uint8Array(graph.links.length);
    this.sizes = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    if (prevSelectedId === null || !graph.index.has(prevSelectedId)) this.follow = -1;
    this.refreshStyle();
    this.measure();
    this.clusterCache = this.resolveClusters();
    const cam = this.stage.camera;
    cam.far = Math.max(1000, this.extent * 60);
    cam.near = Math.max(0.05, cam.far / 200000);
    cam.updateProjectionMatrix();
    this.remountLayers();
    this.setConstellation(this.constellation);
    if (this.homePending && n) this.goHome(true);
  }

  /** The layout's meta (the cosmos's bodies, galaxies, constellations). */
  getMeta(): unknown {
    return this.runner?.meta;
  }

  /** Selects a constellation by id (null clears): its members are highlighted like search matches. Returns its member indices. */
  setConstellation(id: string | null): number[] {
    const c = id === null ? undefined : constellationsOf(this.runner?.meta).find((k) => k.id === id);
    this.constellation = c ? c.id : null;
    this.constellationMembers = c ? new Set(c.members) : null;
    this.refreshMatches();
    return c ? [...c.members] : [];
  }

  private refreshMatches() {
    const a = this.matches, b = this.constellationMembers;
    this.effectiveMatches = !b ? a : !a ? b : new Set([...a, ...b]);
  }

  /** Graph, layout and look together, so layers never mount against another layout's meta. */
  setScene(graph: IndexedGraph, layout: GraphLayout, opts: Engine3DOptions) {
    this.opts = opts;
    this.setGraph(graph, layout);
  }

  setOptions(opts: Engine3DOptions) {
    const layersChanged = opts.renderers !== this.opts.renderers;
    this.opts = opts;
    this.runner?.setPaused(opts.paused);
    this.refreshStyle();
    if (layersChanged) this.remountLayers();
    else this.applyLayerVisibility();
  }

  setLimits(limits: GraphLimits) {
    if (limits.maxLabels + limits.maxForcedLabels !== this.limits.maxLabels + this.limits.maxForcedLabels) {
      this.labels.dispose();
      this.labels = new LabelLayer(this.labelRoot, { pool: limits.maxLabels + limits.maxForcedLabels });
    }
    this.limits = limits;
  }

  setReducedMotion(r: boolean) {
    this.reducedMotion = r;
  }

  setInteraction(selected: number, hovered: number, matches: Set<number> | null, focused = -1, neighborhood = false) {
    // Clearing the selection lets go of the node the camera was following because it was selected.
    if (selected < 0 && this.selected >= 0 && this.follow === this.selected) this.follow = -1;
    this.selected = selected;
    this.hovered = hovered;
    this.matches = matches;
    this.focused = focused;
    this.neighborhood = neighborhood;
    this.refreshMatches();
  }

  /** Keep a node in view at the current distance: fly to it, then follow it. */
  focusIndex(index: number) {
    const t = this.orbit.target;
    const d = t ? this.stage.camera.position.distanceTo(t) : undefined;
    this.flyToIndex(index, d);
  }

  getScreen(): Float32Array {
    return this.screen;
  }

  /**
   * Analog orbit by radians: dx turns about the vertical, dy tilts up. It moves
   * the eye the way OrbitControls would, so the controls' next update starts
   * from here rather than undoing it, and a follow continues.
   */
  orbitBy(dx: number, dy: number) {
    const t = this.orbit.target;
    if (!t || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    const cam = this.stage.camera;
    this.goalDir = null;
    this.spherical.setFromVector3(this.tmp.copy(cam.position).sub(t));
    this.spherical.theta += dx;
    this.spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.spherical.phi - dy));
    cam.position.copy(t).add(this.tmp.setFromSpherical(this.spherical));
    this.orbit.look();
    cam.updateMatrixWorld();
    this.cb.onCamera(this.getCamera());
    return true;
  }

  /** Moves target and eye together by screen px (x right, y down). Releases a follow. */
  panBy(dx: number, dy: number) {
    const t = this.orbit.target;
    if (!t || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const cam = this.stage.camera;
    this.follow = -1;
    this.goalTarget = null;
    this.travelling = this.goalDist !== null || this.goalDir !== null;
    const H = this.stage.canvas.clientHeight || 1;
    const perPx = (2 * cam.position.distanceTo(t) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / H;
    cam.updateMatrixWorld();
    const right = this.tmp.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(dx * perPx);
    const up = this.tmp2.setFromMatrixColumn(cam.matrixWorld, 1).multiplyScalar(-dy * perPx);
    right.add(up);
    t.add(right);
    cam.position.add(right);
    cam.updateMatrixWorld();
    this.cb.onCamera(this.getCamera());
  }

  /** Divides the distance by `factor` (greater than 1 is closer), within the limits. */
  zoomBy(factor: number) {
    const t = this.orbit.target;
    if (!t || !Number.isFinite(factor) || factor <= 0) return;
    const cam = this.stage.camera;
    this.goalDist = null;
    const max = Math.max(this.limits.minDistance * 2, this.extent * this.limits.maxDistanceFactor);
    const d = Math.min(max, Math.max(this.limits.minDistance, cam.position.distanceTo(t) / factor));
    // Read the offset BEFORE moving the eye: copy(t) first would zero it.
    const offset = this.tmp.copy(cam.position).sub(t).setLength(d);
    cam.position.copy(t).add(offset);
    cam.updateMatrixWorld();
    this.cb.onCamera(this.getCamera());
  }

  private disposeLayers() {
    for (const l of this.layers) {
      l.layer.dispose();
      this.group.remove(l.group);
    }
    this.layers = [];
  }

  private remountLayers() {
    this.disposeLayers();
    const g = this.graph;
    if (!g) return;
    const R = this.opts.renderers;
    const slots: GraphLayer3D[][] = [asList(R.background, () => []), asList(R.cluster, () => []), asList(R.link, () => [linkLayer3D()]), asList(R.node, () => [nodeLayer3D()])];
    slots.forEach((list, order) => {
      for (const layer of list) {
        // One group per layer, so hiding one (the orbit paths) never hides its slot-mates (the galaxies).
        const group = new THREE.Group();
        const id = layer.layer ?? SLOT_LAYER[order];
        group.name = `fancy-graph-layer-${id}`;
        this.group.add(group);
        layer.mount({ group, renderOrder: order, graph: g, meta: this.runner?.meta, clusters: this.clusterCache, camera: this.stage.camera, colors: this.colors, limits: this.limits });
        this.layers.push({ layer, id, group });
      }
    });
    this.applyLayerVisibility();
  }

  private visible(id: string) {
    return id === "nodes" || isLayerVisible(this.opts.layers, id);
  }

  private applyLayerVisibility() {
    for (const l of this.layers) l.group.visible = this.visible(l.id);
  }

  private refreshStyle() {
    const g = this.graph;
    if (!g) return;
    const meta = this.runner?.meta;
    for (let i = 0; i < g.nodes.length; i++) {
      const node = g.nodes[i];
      const css = this.opts.nodeColor ? this.opts.nodeColor(i, meta) : (node.color ?? colorFor(node.group));
      const [r, gg, b] = parseColor(css);
      this.colors[i * 3] = r;
      this.colors[i * 3 + 1] = gg;
      this.colors[i * 3 + 2] = b;
      const s = this.opts.nodeSize ? this.opts.nodeSize(i, meta) : node.size;
      this.sizes[i] = typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 2 + Math.min(10, Math.sqrt(g.degree[i]) * 1.6);
    }
    const reach = this.opts.labelReach;
    if (reach) {
      const w = this.reachWorld && this.reachWorld.length === g.nodes.length ? this.reachWorld : new Float32Array(g.nodes.length);
      for (let i = 0; i < g.nodes.length; i++) {
        const v = reach(i, meta);
        w[i] = typeof v === "number" && !Number.isNaN(v) ? v : 0;
      }
      this.reachWorld = w;
    } else this.reachWorld = null;
  }

  private resolveClusters(): GraphCluster[] {
    const g = this.graph, r = this.runner;
    if (!g || !r) return [];
    const src = this.opts.clusters;
    if (src === "group") return groupClusters(g, r.positions);
    if (typeof src === "function") return src(g, r.positions, r.meta);
    if (Array.isArray(src)) return src;
    return r.clusters() ?? [];
  }

  /** Centre and radius of everything, from live positions. */
  private measure() {
    const r = this.runner, g = this.graph;
    if (!r || !g || !g.nodes.length) return;
    const p = this.live.length === g.nodes.length * 3 ? this.live : r.positions;
    const n = g.nodes.length;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += p[i * 3];
      cy += p[i * 3 + 1];
      cz += p[i * 3 + 2];
    }
    this.center.set(cx / n, cy / n, cz / n);
    let ext = 1;
    for (let i = 0; i < n; i++) ext = Math.max(ext, Math.hypot(p[i * 3] - this.center.x, p[i * 3 + 1] - this.center.y, p[i * 3 + 2] - this.center.z) + this.sizes[i]);
    for (const c of this.clusterCache) ext = Math.max(ext, Math.hypot(c.center[0] - this.center.x, c.center[1] - this.center.y, c.center[2] - this.center.z) + c.radius);
    this.extent = ext;
  }

  // ----------------------------------------------------------------- camera

  private homeDir() {
    const { homeYaw: y, homePitch: p } = this.opts;
    return new THREE.Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y));
  }

  private fitDistance(radius: number) {
    const fov = THREE.MathUtils.degToRad(this.stage.camera.fov);
    const aspect = Math.max(0.2, Math.min(1, this.stage.camera.aspect || 1));
    return (radius / Math.sin(Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2)) * 1.05;
  }

  goHome(firstView = false) {
    this.follow = -1;
    this.goalTarget = this.center.clone();
    this.goalDist = this.fitDistance(this.extent);
    this.goalDir = this.homeDir();
    this.travelling = true;
    if (firstView) {
      this.homePending = false;
      const t = this.orbit.target;
      if (t) {
        // First sight of a graph: start already there, rather than flying in from wherever the Stage put the camera.
        t.copy(this.goalTarget);
        this.stage.camera.position.copy(t).addScaledVector(this.goalDir, this.goalDist);
        this.orbit.look();
        this.travelling = false;
        this.goalTarget = this.goalDist = this.goalDir = null;
      } else this.homePending = true;
    }
  }

  flyToIndex(index: number, distance?: number) {
    if (!this.graph || index < 0 || index >= this.graph.nodes.length) return false;
    const t = this.orbit.target;
    this.follow = index;
    const p = this.live;
    this.followOffset.set(t ? t.x - p[index * 3] : 0, t ? t.y - p[index * 3 + 1] : 0, t ? t.z - p[index * 3 + 2] : 0);
    this.goalTarget = null;
    this.goalDir = null;
    const framed = distance === undefined ? this.opts.frameRadius?.(index, this.runner?.meta) : null;
    this.goalDist = distance ?? (typeof framed === "number" && Number.isFinite(framed) && framed > 0 ? this.fitDistance(framed) : Math.max(this.limits.minDistance * 4, this.sizes[index] * 14 + 20));
    this.travelling = true;
    return true;
  }

  flyToPoint(target: Vec3, distance?: number, direction?: Vec3) {
    this.follow = -1;
    this.goalTarget = new THREE.Vector3(...target);
    this.goalDist = distance ?? null;
    this.goalDir = direction ? new THREE.Vector3(...direction).normalize() : null;
    this.travelling = true;
  }

  flyToCluster(id: string) {
    const c = this.clusterCache.find((k) => k.id === id);
    if (!c) return false;
    this.flyToPoint(c.center, Math.max(this.limits.minDistance * 4, c.radius * 2.6), c.normal);
    return true;
  }

  fitIndices(indices: number[]) {
    const p = this.runner ? this.live : undefined;
    if (!p || !indices.length) return;
    const box = new THREE.Box3();
    for (const i of indices) box.expandByPoint(this.tmp.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    const c = box.getCenter(new THREE.Vector3());
    // Frame each node's drawn radius, not only its centre (Home already does, in measure()).
    let radius = 0;
    for (const i of indices) radius = Math.max(radius, Math.hypot(p[i * 3] - c.x, p[i * 3 + 1] - c.y, p[i * 3 + 2] - c.z) + (this.sizes[i] || 0));
    this.flyToPoint([c.x, c.y, c.z], this.fitDistance(Math.max(this.limits.minDistance, radius)));
  }

  setFollow(index: number) {
    if (index < 0) this.follow = -1;
    else this.flyToIndex(index);
  }

  getCamera(): Camera3D {
    const t = this.orbit.target ?? this.center;
    const e = this.stage.camera.position;
    return orbitFrom([e.x, e.y, e.z], [t.x, t.y, t.z]);
  }

  setCamera(c: Camera3D) {
    const eye = orbitPosition(c);
    const dir = new THREE.Vector3(eye[0] - c.target[0], eye[1] - c.target[1], eye[2] - c.target[2]).normalize();
    this.flyToPoint(c.target, c.distance, [dir.x, dir.y, dir.z]);
  }

  screenPosition(index: number) {
    if (index < 0 || index * 4 >= this.screen.length || this.screen[index * 4 + 3] <= 0) return null;
    return { x: this.screen[index * 4], y: this.screen[index * 4 + 1], radius: this.screen[index * 4 + 2] };
  }

  pick(x: number, y: number) {
    return pickScreen(this.screen, x, y, { minReach: this.limits.pickRadius, mode: "depth" });
  }

  getClusters() {
    return this.clusterCache;
  }

  /** A node's world position this frame. */
  positionOf(index: number): [number, number, number] | null {
    const p = this.runner ? this.live : undefined;
    if (!p || index < 0 || index * 3 >= p.length) return null;
    return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
  }

  /** A cluster's colour from its first member, so labels follow the theme. */
  private memberHex(c: GraphCluster): string | null {
    const i = c.members[0];
    if (i === undefined || i * 3 + 2 >= this.colors.length) return null;
    const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    return `#${h(this.colors[i * 3])}${h(this.colors[i * 3 + 1])}${h(this.colors[i * 3 + 2])}`;
  }

  // ------------------------------------------------------------------ frame

  frame(dtIn?: number): { ms: number } {
    const t0 = performance.now();
    const g = this.graph, r = this.runner;
    if (!g || !r) return { ms: 0 };
    const cam = this.stage.camera;
    const now = t0;
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, dtIn ?? (this.last ? (now - this.last) / 1000 : 1 / 60)));
    this.last = now;
    if (r.tick(dt) && (r.animated || !r.settled)) {
      // Computed clusters follow the nodes; a layout's own clusters follow it while it animates (the cosmos's galaxies orbit).
      const src = this.opts.clusters;
      if (src === "group" || typeof src === "function" || (src === undefined && r.animated)) this.clusterCache = this.resolveClusters();
    }
    const n = g.nodes.length;
    const tr = this.transition;
    if (tr) {
      if (this.reducedMotion) tr.t = tr.dur;
      tr.t += dt;
      const s = Math.min(1, tr.t / tr.dur);
      const e = s * s * s * (s * (s * 6 - 15) + 10);
      const P = r.positions, F = tr.from, L = this.live;
      for (let k = 0; k < n * 3; k++) L[k] = F[k] + (P[k] - F[k]) * e;
      if (s >= 1) {
        this.transition = null;
        this.live = r.positions;
      }
    } else if (this.live !== r.positions) this.live = r.positions;
    if (!r.animated && !r.settled) this.measure();
    const p = this.live;
    const t = this.orbit.target;
    if (this.homePending && t && n) {
      // The target only became known this frame (a Stage without the controls handle).
      const keep = this.follow;
      const keepDist = this.goalDist;
      this.measure();
      this.goHome(true);
      if (keep >= 0) this.flyToIndex(keep, keepDist ?? undefined);
    }

    if (t) {
      const ease = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
      if (this.follow >= 0 && this.follow < n) {
        // Lock onto the node and let the starting offset decay, so a fast mover is caught however fast it goes.
        this.followOffset.multiplyScalar(1 - ease);
        this.tmp.set(p[this.follow * 3], p[this.follow * 3 + 1], p[this.follow * 3 + 2]).add(this.followOffset);
        this.tmp2.copy(this.tmp).sub(t);
        t.add(this.tmp2);
        cam.position.add(this.tmp2);
      } else if (this.travelling && this.goalTarget) {
        this.tmp2.copy(this.goalTarget).sub(t).multiplyScalar(ease);
        t.add(this.tmp2);
        cam.position.add(this.tmp2);
      }
      if (this.travelling) {
        const off = this.tmp.copy(cam.position).sub(t);
        let len = off.length() || 1;
        off.divideScalar(len);
        if (this.goalDist !== null) len += (this.goalDist - len) * ease;
        if (this.goalDir) off.lerp(this.goalDir, ease).normalize();
        cam.position.copy(t).addScaledVector(off, len);
        const targetLeft = this.goalTarget ? this.goalTarget.distanceTo(t) : this.follow >= 0 ? this.followOffset.length() : 0;
        const distLeft = this.goalDist !== null ? Math.abs(this.goalDist - len) : 0;
        const dirLeft = this.goalDir ? 1 - off.dot(this.goalDir) : 0;
        if (targetLeft <= len * 0.002 && distLeft <= len * 0.002 && dirLeft < 1e-5) {
          this.travelling = false;
          this.goalTarget = null;
          this.goalDir = null;
          this.goalDist = null;
          this.cb.onCamera(this.getCamera());
        }
      }
      const max = Math.max(this.limits.minDistance * 2, this.extent * this.limits.maxDistanceFactor);
      const dist = cam.position.distanceTo(t);
      if (dist > max || dist < this.limits.minDistance) {
        this.tmp.copy(cam.position).sub(t).setLength(Math.min(max, Math.max(this.limits.minDistance, dist)));
        cam.position.copy(t).add(this.tmp);
      }
      this.orbit.look();
      cam.updateMatrixWorld();
    }

    // Project every node once: picking, labels and depth order all read this.
    const W = this.stage.canvas.clientWidth || 1;
    const H = this.stage.canvas.clientHeight || 1;
    const view = cam.matrixWorldInverse.elements;
    const f = cam.projectionMatrix.elements[5] * H * 0.5;
    const near = cam.near;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
      const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
      const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
      this.depths[i] = -vz;
      if (vz >= -near) {
        this.screen[i * 4 + 3] = 0;
        continue;
      }
      this.screen[i * 4] = W / 2 + (vx / -vz) * f;
      this.screen[i * 4 + 1] = H / 2 - (vy / -vz) * f;
      this.screen[i * 4 + 2] = (this.sizes[i] * f) / -vz;
      this.screen[i * 4 + 3] = -vz;
      if (this.reachWorld) {
        const w = this.reachWorld[i];
        this.reachPx[i] = w === Infinity ? Infinity : w < 0 ? -1 : (w * f) / -vz;
      }
    }
    const depths = this.depths;
    this.order.sort((a, b) => depths[b] - depths[a]);
    const focusIn = { selected: this.selected, hovered: this.hovered, matches: this.effectiveMatches, focused: this.focused, neighborhood: this.neighborhood };
    computeNodeStates(g, focusIn, this.states);
    computeLinkStates(g, focusIn, this.linkStates);

    const frame: LayerFrame3D = {
      graph: g,
      positions: p,
      order: this.order,
      states: this.states,
      linkStates: this.linkStates,
      sizes: this.sizes,
      colors: this.colors,
      clusters: this.clusterCache,
      time: this.reducedMotion ? 0 : r.time,
      dt,
      width: W,
      height: H,
      pixelRatio: this.stage.renderer.getPixelRatio?.() ?? 1,
      camera: cam,
      meta: r.meta,
      focus: focusOf(focusIn),
      focused: this.focused,
      selected: this.selected,
      hovered: this.hovered,
      matches: this.effectiveMatches,
      linkVisibility: effectiveLinkVisibility(this.opts.linkVisibility, this.visible("links")),
      layers: this.opts.layers ?? {},
      constellation: this.constellation,
    };
    for (const l of this.layers) if (l.group.visible) l.layer.update(frame);
    this.paintLabels(g, W, H, view, f);
    return { ms: performance.now() - t0 };
  }

  private paintLabels(g: IndexedGraph, W: number, H: number, view: ArrayLike<number>, f: number) {
    const max = this.limits.maxLabelLength;
    const cands = labelCandidates({
      screen: this.screen,
      states: this.states,
      selected: this.selected,
      hovered: this.hovered,
      matches: this.effectiveMatches,
      width: W,
      height: H,
      labelMinPx: this.limits.labelMinPx,
      reach: this.reachWorld ? this.reachPx : undefined,
      reachMinPx: this.limits.zoomLabelPx,
      text: (i) => truncateLabel(this.opts.labelOf(i), max),
      focused: this.focused,
      focusNeighbors: this.focused >= 0 ? g.neighbors[this.focused] : undefined,
      cullOthers: this.neighborhood,
    });
    const placed = placeLabels(cands, { maxLabels: this.limits.maxLabels, maxForced: this.limits.maxForcedLabels, width: W, height: H });
    for (const l of placed) {
      l.id = g.nodes[l.index].id;
      const st = this.states[l.index];
      l.state = st === NODE_ACTIVE ? "active" : st === NODE_NEIGHBOR ? "neighbor" : "normal";
    }
    this.labels.render(this.visible("labels") ? placed : []);
    const cl: ClusterLabel[] = [];
    for (const c of this.visible("clusters") ? this.clusterCache : []) {
      const text = this.opts.clusterLabel ? this.opts.clusterLabel(c) : (c.label ?? null);
      if (!text) continue;
      const [cx, cy, cz] = c.center;
      const x = view[0] * cx + view[4] * cy + view[8] * cz + view[12];
      const y = view[1] * cx + view[5] * cy + view[9] * cz + view[13];
      const z = view[2] * cx + view[6] * cy + view[10] * cz + view[14];
      if (z >= 0) continue;
      const apparent = (c.radius * f) / -z;
      // A flat cluster (a galaxy, a layer plane) is an ellipse on screen: lift its label by its projected height,
      // radius x |normal . view|, not its full radius, or an edge-on plane's label floats far above it.
      let lift = apparent;
      if (c.normal) {
        const cam = this.stage.camera.position;
        const dx = cx - cam.x, dy = cy - cam.y, dz = cz - cam.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        lift = apparent * Math.max(0.12, Math.abs((c.normal[0] * dx + c.normal[1] * dy + c.normal[2] * dz) / len));
      }
      if (apparent < 12 || apparent > Math.min(W, H) * 0.6) continue;
      cl.push({ id: c.id, text: truncateLabel(text, max), x: W / 2 + (x / -z) * f, y: Math.max(18, H / 2 - (y / -z) * f - lift - 10), color: c.color ?? this.memberHex(c) ?? colorFor(c.id) });
    }
    this.labels.renderClusters(cl);
    this.paintConstellationLabels(W, H, view, f);
  }

  /** Each visible constellation's name over its members, once its figure is big enough on screen to read. */
  private paintConstellationLabels(W: number, H: number, view: ArrayLike<number>, f: number) {
    const out: ConstellationLabel[] = [];
    const list = this.visible("constellations") && this.visible("labels") ? constellationsOf(this.runner?.meta) : [];
    const p = this.live;
    const max = this.limits.maxLabelLength;
    for (const c of list) {
      if (!this.visible(`constellation:${c.id}`) || !c.members.length) continue;
      let sx = 0, sy = 0, k = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const i of c.members) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
        if (vz >= 0) continue;
        const px = W / 2 + ((view[0] * x + view[4] * y + view[8] * z + view[12]) / -vz) * f;
        const py = H / 2 - ((view[1] * x + view[5] * y + view[9] * z + view[13]) / -vz) * f;
        sx += px;
        sy += py;
        k++;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      if (!k) continue;
      const span = Math.max(maxX - minX, maxY - minY);
      const x = sx / k, y = sy / k;
      if (c.members.length > 1 && span < 24) continue;
      if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
      out.push({ id: c.id, text: truncateLabel(c.label, max), x, y: Math.max(16, y), color: typeof c.color === "string" ? c.color : colorFor(c.id), selected: c.id === this.constellation });
    }
    this.labels.renderConstellations(out, (id) => this.cb.onConstellation?.(id));
  }

  // ------------------------------------------------------------------ input
  // Rotate, pan, zoom and touch belong to the Stage's OrbitControls. These
  // only pick, cancel travel, and add keyboard control.

  private local(e: { clientX: number; clientY: number }) {
    const r = this.stage.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, button: e.button ?? 0, shift: !!e.shiftKey };
  };

  private onMove = (e: PointerEvent) => {
    if (this.down) {
      if (Math.abs(e.clientX - this.down.x) + Math.abs(e.clientY - this.down.y) >= DRAG_PX) {
        this.travelling = false;
        this.goalDir = null;
        this.goalTarget = null;
        if (this.down.button !== 0 || this.down.shift) this.follow = -1;
        this.stage.canvas.style.cursor = "grabbing";
      }
      return;
    }
    if (e.pointerType && e.pointerType !== "mouse") return;
    const p = this.local(e);
    const h = this.pick(p.x, p.y);
    if (h !== this.hovered) {
      this.stage.canvas.style.cursor = h >= 0 ? "pointer" : "grab";
      this.cb.onHover(h);
    }
  };

  private onUp = (e: PointerEvent) => {
    const start = this.down;
    this.down = null;
    this.stage.canvas.style.cursor = this.hovered >= 0 ? "pointer" : "grab";
    if (!start || (e.button ?? 0) !== 0) return;
    if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) >= DRAG_PX) {
      this.cb.onCamera(this.getCamera());
      return;
    }
    const p = this.local(e);
    const h = this.pick(p.x, p.y);
    if (h < 0) this.follow = -1;
    this.cb.onSelect(h);
  };

  private onCancel = () => {
    this.down = null;
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (this.hovered >= 0 && !this.down) this.cb.onHover(-1);
  };

  private onWheel = () => {
    this.goalDist = null;
  };

  private onKey = (e: KeyboardEvent) => {
    const t = this.orbit.target;
    if (!t) return;
    const k = e.key;
    const cam = this.stage.camera;
    if (k === "Escape") {
      this.follow = -1;
      this.cb.onEscape();
    } else if (k === "+" || k === "=" || k === "-" || k === "_") {
      this.goalDist = null;
      this.tmp.copy(cam.position).sub(t).multiplyScalar(k === "+" || k === "=" ? 0.82 : 1.22);
      cam.position.copy(t).add(this.tmp);
    } else if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      this.spherical.setFromVector3(this.tmp.copy(cam.position).sub(t));
      if (k === "ArrowLeft") this.spherical.theta -= 0.09;
      if (k === "ArrowRight") this.spherical.theta += 0.09;
      if (k === "ArrowUp") this.spherical.phi = Math.max(0.05, this.spherical.phi - 0.09);
      if (k === "ArrowDown") this.spherical.phi = Math.min(Math.PI - 0.05, this.spherical.phi + 0.09);
      cam.position.copy(t).add(this.tmp.setFromSpherical(this.spherical));
    } else if (k === "0") {
      this.goHome();
    } else return;
    e.preventDefault();
    this.cb.onCamera(this.getCamera());
  };

  destroy() {
    this.stop();
    this.disposeLayers();
    this.runner?.dispose();
    this.stage.scene.remove(this.group);
    this.labels.dispose();
    this.labelRoot.remove();
    this.orbit.restore();
    const c = this.stage.controls;
    if (c && this.controlsLimits) {
      c.minDistance = this.controlsLimits.min;
      c.maxDistance = this.controlsLimits.max;
    }
    const cv = this.stage.canvas;
    cv.removeEventListener("pointerdown", this.onDown);
    cv.removeEventListener("pointermove", this.onMove);
    cv.removeEventListener("pointerup", this.onUp);
    cv.removeEventListener("pointercancel", this.onCancel);
    cv.removeEventListener("pointerleave", this.onLeave);
    cv.removeEventListener("wheel", this.onWheel);
    cv.removeEventListener("keydown", this.onKey);
  }
}
