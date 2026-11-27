import { clampCamera2D, fitCamera2D, lerpCamera2D, zoomAt2D, type Camera2D } from "../camera";
import { groupClusters } from "../clusters";
import { colorFor } from "../color";
import { computeLinkStates, computeNodeStates, focusOf, hasHighlightRing, LINK_ACTIVE, LINK_DIMMED, NODE_ACTIVE, NODE_DIMMED, pickScreen } from "../interaction";
import { effectiveLinkVisibility, isLayerVisible } from "../layers";
import { LabelLayer, labelCandidates, placeLabels, type ClusterLabel, type PlacedLabel } from "../labels";
import { createLayoutRunner, type GraphLayout, type LayoutRunner } from "../layout/contract";
import { truncateLabel, type GraphLimits } from "../limits";
import type { GraphCluster, IndexedGraph } from "../types";
import type { GraphRenderers2D } from "./types";

export type ClusterSource = "group" | GraphCluster[] | ((graph: IndexedGraph, positions: Float32Array) => GraphCluster[]);

export interface Engine2DOptions {
  renderers: GraphRenderers2D;
  clusters?: ClusterSource;
  clusterLabel?: (cluster: GraphCluster) => string | null;
  nodeColor?: (index: number) => string;
  nodeSize?: (index: number) => number;
  labelOf: (index: number) => string;
  linkVisibility: "all" | "focus" | "none";
  /** Layer visibility by id (`links`, `labels`, `clusters`, `background`); a missing id is visible. */
  layers?: Partial<Record<string, boolean>>;
  background?: string;
  linkColor: string;
  /** Focus ring colour. Defaults to --fancy-focus, else blue. */
  focusColor: string;
  paused: boolean;
}

export interface Engine2DCallbacks {
  onSelect(index: number): void;
  onHover(index: number): void;
  onCamera(camera: Camera2D): void;
  onEscape(): void;
}

const MIN_DT = 1 / 240;
const MAX_DT = 1 / 20;
const DRAG_PX = 4;

/**
 * The 2D renderer: a canvas, a label layer, the frame loop and the input
 * handling. React owns the state; this owns the pixels. No three, no WebGL.
 */
export class CanvasEngine {
  private ctx: CanvasRenderingContext2D | null;
  private labels: LabelLayer;
  private graph: IndexedGraph | null = null;
  private runner: LayoutRunner | null = null;
  private screen = new Float32Array(0);
  private states = new Uint8Array(0);
  private linkStates = new Uint8Array(0);
  private sizes = new Float32Array(0);
  private colors: string[] = [];
  private camera: Camera2D = { x: 0, y: 0, zoom: 1 };
  private goal: Camera2D | null = null;
  private follow = -1;
  private selected = -1;
  private hovered = -1;
  private focused = -1;
  private neighborhood = false;
  private matches: Set<number> | null = null;
  private userMoved = false;
  private fitPending = true;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private width = 300;
  private height = 150;
  private dpr = 1;
  private destroyed = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; dragging: boolean; cam: Camera2D } | null = null;
  private pinch: { dist: number; cam: Camera2D; mx: number; my: number } | null = null;
  private clusterCache: GraphCluster[] = [];
  /** Clusters are recomputed only when positions moved or their source changed, never on a settled frame. */
  private clustersStale = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    labelRoot: HTMLElement,
    private limits: GraphLimits,
    private opts: Engine2DOptions,
    private readonly cb: Engine2DCallbacks,
    private reducedMotion: boolean,
  ) {
    this.ctx = canvas.getContext("2d");
    this.labels = new LabelLayer(labelRoot, { pool: limits.maxLabels + limits.maxForcedLabels });
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("keydown", this.onKey);
  }

  // ---------------------------------------------------------------- state in

  setGraph(graph: IndexedGraph, layout: GraphLayout) {
    this.clustersStale = true;
    this.runner?.dispose();
    this.graph = graph;
    const n = graph.nodes.length;
    this.runner = createLayoutRunner(layout, graph, { dimensions: 2, limits: this.limits, reducedMotion: this.reducedMotion });
    this.runner.setPaused(this.opts.paused);
    this.screen = new Float32Array(n * 4);
    this.states = new Uint8Array(n);
    this.linkStates = new Uint8Array(graph.links.length);
    this.refreshStyle();
    if (!this.userMoved) this.fitPending = true;
    this.invalidate();
  }

  setOptions(opts: Engine2DOptions) {
    if (opts.clusters !== this.opts.clusters) this.clustersStale = true;
    this.opts = opts;
    this.runner?.setPaused(opts.paused);
    this.refreshStyle();
    this.invalidate();
  }

  setLimits(limits: GraphLimits) {
    if (limits.maxLabels + limits.maxForcedLabels !== this.limits.maxLabels + this.limits.maxForcedLabels) {
      const root = this.canvas.parentElement?.querySelector<HTMLElement>("[data-fancy-graph-labels]");
      this.labels.dispose();
      if (root) this.labels = new LabelLayer(root, { pool: limits.maxLabels + limits.maxForcedLabels });
    }
    this.limits = limits;
    this.invalidate();
  }

  setReducedMotion(r: boolean) {
    this.reducedMotion = r;
  }

  setSize(width: number, height: number, dpr: number) {
    const ratio = Math.min(this.limits.maxPixelRatio, Math.max(1, dpr || 1));
    if (width === this.width && height === this.height && ratio === this.dpr) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = ratio;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    if (!this.userMoved) this.fitPending = true;
    this.invalidate();
  }

  setInteraction(selected: number, hovered: number, matches: Set<number> | null, focused = -1, neighborhood = false) {
    // Clearing the selection lets go of the node the camera was following because it was selected.
    if (selected < 0 && this.selected >= 0 && this.follow === this.selected) this.follow = -1;
    this.selected = selected;
    this.hovered = hovered;
    this.matches = matches;
    this.focused = focused;
    this.neighborhood = neighborhood;
    this.invalidate();
  }

  /** Keep a node in view: fly to it at the current zoom, then follow it. */
  setFocus(index: number) {
    if (index >= 0) {
      this.flyToIndex(index, this.camera.zoom, this.reducedMotion);
      this.follow = index;
    } else this.follow = -1;
  }

  /** The projected screen buffer of the last frame: x, y, radius, visible, per node. */
  getScreen(): Float32Array {
    return this.screen;
  }

  /** Moves the camera by screen px (positive x right, positive y down). Releases any follow, so it never fights one. */
  pan(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.goal = null;
    this.follow = -1;
    this.userMoved = true;
    this.fitPending = false;
    this.camera = clampCamera2D({ ...this.camera, x: this.camera.x + dx / this.camera.zoom, y: this.camera.y + dy / this.camera.zoom }, this.limits);
    this.cb.onCamera(this.getCamera());
    this.invalidate();
  }

  /** Zooms about the viewport centre (factor greater than 1 zooms in). A follow continues. */
  zoomBy(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.goal = null;
    this.userMoved = true;
    this.fitPending = false;
    this.camera = zoomAt2D(this.camera, this.width, this.height, this.width / 2, this.height / 2, factor, this.limits);
    this.cb.onCamera(this.getCamera());
    this.invalidate();
  }

  // ----------------------------------------------------------------- camera

  getCamera(): Camera2D {
    return { ...this.camera };
  }

  setCamera(cam: Camera2D, instant = this.reducedMotion) {
    const next = clampCamera2D(cam, this.limits);
    this.userMoved = true;
    this.fitPending = false;
    if (instant) {
      this.camera = next;
      this.goal = null;
      this.cb.onCamera(this.getCamera());
    } else this.goal = next;
    this.invalidate();
  }

  flyToIndex(index: number, zoom?: number, instant = this.reducedMotion): boolean {
    const p = this.runner?.positions;
    if (!p || index < 0 || index * 3 >= p.length) return false;
    this.setCamera({ x: p[index * 3], y: p[index * 3 + 1], zoom: zoom ?? Math.max(this.camera.zoom, 1) }, instant);
    return true;
  }

  fit(indices: number[] | null, instant = this.reducedMotion) {
    const p = this.runner?.positions;
    if (!p) return;
    const cam = indices ? fitCamera2D(p, indices, this.width, this.height, Math.min(60, Math.min(this.width, this.height) * 0.1), this.limits) : this.fitAll(p);
    this.setCamera(cam, instant);
    if (!indices) this.userMoved = false;
  }

  setFollow(index: number) {
    this.follow = index;
    this.invalidate();
  }

  screenPosition(index: number): { x: number; y: number; radius: number } | null {
    if (index < 0 || index * 4 >= this.screen.length) return null;
    return { x: this.screen[index * 4], y: this.screen[index * 4 + 1], radius: this.screen[index * 4 + 2] };
  }

  pick(x: number, y: number): number {
    return pickScreen(this.screen, x, y, { minReach: this.limits.pickRadius, mode: "nearest" });
  }

  getClusters(): GraphCluster[] {
    return this.clusterCache;
  }

  /** A node's world position in the current layout. */
  positionOf(index: number): [number, number, number] | null {
    const p = this.runner?.positions;
    if (!p || index < 0 || index * 3 >= p.length) return null;
    return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
  }

  // ------------------------------------------------------------------ frame

  invalidate() {
    this.dirty = true;
    this.schedule();
  }

  private schedule() {
    if (this.destroyed || this.raf || typeof requestAnimationFrame !== "function") return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      const dt = this.last ? (t - this.last) / 1000 : 1 / 60;
      this.last = t;
      this.renderFrame(dt);
      if (this.needsFrame()) this.schedule();
      else this.last = 0;
    });
  }

  private needsFrame(): boolean {
    const r = this.runner;
    return this.dirty || !!this.goal || (!!r && (!r.settled || (r.animated && !this.opts.paused && !this.reducedMotion))) || this.follow >= 0;
  }

  /** Renders one frame now. Returns how long it took (ms). Tests and benchmarks drive this directly. */
  renderFrame(dtIn = 1 / 60): { ms: number } {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.dirty = false;
    const g = this.graph;
    const r = this.runner;
    if (!g || !r) return { ms: 0 };
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, dtIn));
    const wasSettled = r.settled;
    if (r.tick(dt)) this.clustersStale = true;
    const p = r.positions;
    const n = g.nodes.length;

    if (this.fitPending) {
      this.fitPending = false;
      this.camera = this.fitAll(p);
    } else if (!wasSettled && r.settled && !this.userMoved) {
      // The layout just came to rest: frame it, unless the person already moved the view.
      const cam = this.fitAll(p);
      if (this.reducedMotion) this.camera = cam;
      else this.goal = cam;
    }

    if (this.goal) {
      const ease = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
      this.camera = lerpCamera2D(this.camera, this.goal, ease);
      const g2 = this.goal;
      if (ease >= 1 || (Math.abs(g2.x - this.camera.x) * g2.zoom < 0.5 && Math.abs(g2.y - this.camera.y) * g2.zoom < 0.5 && Math.abs(Math.log(g2.zoom / this.camera.zoom)) < 0.002)) {
        this.camera = g2;
        this.goal = null;
        this.cb.onCamera(this.getCamera());
      }
    }
    if (this.follow >= 0 && this.follow < n && !this.goal) {
      this.camera = { ...this.camera, x: p[this.follow * 3], y: p[this.follow * 3 + 1] };
    }

    const W = this.width, H = this.height, cam = this.camera;
    if (this.sizes.length !== n) this.sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const node = g.nodes[i];
      const s = this.opts.nodeSize ? this.opts.nodeSize(i) : node.size;
      this.sizes[i] = typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 3 + Math.min(9, Math.sqrt(g.degree[i]) * 1.5);
      const x = p[i * 3], y = p[i * 3 + 1];
      this.screen[i * 4] = (x - cam.x) * cam.zoom + W / 2;
      this.screen[i * 4 + 1] = (y - cam.y) * cam.zoom + H / 2;
      this.screen[i * 4 + 2] = Math.max(1.5, this.sizes[i] * cam.zoom);
      this.screen[i * 4 + 3] = Number.isFinite(x) && Number.isFinite(y) ? 1 : 0;
    }
    const focus = { selected: this.selected, hovered: this.hovered, matches: this.matches, focused: this.focused, neighborhood: this.neighborhood };
    computeNodeStates(g, focus, this.states);
    computeLinkStates(g, focus, this.linkStates);
    if (this.clustersStale) {
      this.clusterCache = this.resolveClusters(g, p);
      this.clustersStale = false;
    }

    const ctx = this.ctx;
    if (ctx) this.paint(ctx, g);
    this.paintLabels(g);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return { ms: t1 - t0 };
  }

  /** A cluster's own colour, else its members' (so it follows the theme), else a palette guess. */
  private clusterColor(c: GraphCluster): string {
    return c.color ?? (c.members[0] !== undefined ? this.colors[c.members[0]] : undefined) ?? colorFor(c.id);
  }

  private fitAll(p: Float32Array): Camera2D {
    return fitCamera2D(p, null, this.width, this.height, Math.min(60, Math.min(this.width, this.height) * 0.1), this.limits);
  }

  private resolveClusters(g: IndexedGraph, p: Float32Array): GraphCluster[] {
    const src = this.opts.clusters;
    if (src === "group") return groupClusters(g, p);
    if (typeof src === "function") return src(g, p);
    if (Array.isArray(src)) return src;
    return this.runner?.clusters() ?? [];
  }

  private refreshStyle() {
    const g = this.graph;
    if (!g) return;
    this.colors = g.nodes.map((node, i) => (this.opts.nodeColor ? this.opts.nodeColor(i) : (node.color ?? colorFor(node.group))));
  }

  private paint(ctx: CanvasRenderingContext2D, g: IndexedGraph) {
    const { width: W, height: H, dpr, camera: cam } = this;
    const meta = this.runner?.meta;
    const time = this.runner?.time ?? 0;
    const R = this.opts.renderers;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.opts.background) {
      ctx.fillStyle = this.opts.background;
      ctx.fillRect(0, 0, W, H);
    }
    if (isLayerVisible(this.opts.layers, "background")) R.background?.(ctx, { width: W, height: H, camera: { ...cam }, time, pixelRatio: dpr, meta });

    for (const c of isLayerVisible(this.opts.layers, "clusters") ? this.clusterCache : []) {
      const x = (c.center[0] - cam.x) * cam.zoom + W / 2;
      const y = (c.center[1] - cam.y) * cam.zoom + H / 2;
      const radius = c.radius * cam.zoom;
      if (R.cluster) R.cluster(ctx, { cluster: c, x, y, radius, zoom: cam.zoom, meta });
      else {
        const colour = this.clusterColor(c);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    const vis = effectiveLinkVisibility(this.opts.linkVisibility, isLayerVisible(this.opts.layers, "links"));
    const anyFocus = focusOf({ selected: this.selected, hovered: this.hovered, focused: this.focused, neighborhood: this.neighborhood }) >= 0 || !!this.matches;
    if (vis !== "none") {
      const s = this.screen;
      if (R.link) {
        for (const l of g.links) {
          const st = this.linkStates[l.index];
          if (vis === "focus" && anyFocus && st !== LINK_ACTIVE) continue;
          R.link(ctx, { index: l.index, link: l, ax: s[l.a * 4], ay: s[l.a * 4 + 1], bx: s[l.b * 4], by: s[l.b * 4 + 1], state: st as 0 | 1 | 2, zoom: cam.zoom, meta });
        }
      } else {
        // Batched: one path per state, so 6,000 links cost three strokes.
        ctx.strokeStyle = this.opts.linkColor;
        for (const [state, alpha, width] of [[0, 0.32, 1], [LINK_DIMMED, 0.06, 1], [LINK_ACTIVE, 0.9, 1.6]] as const) {
          if (vis === "focus" && anyFocus && state !== LINK_ACTIVE) continue;
          ctx.beginPath();
          let any = false;
          for (const l of g.links) {
            if (this.linkStates[l.index] !== state) continue;
            ctx.moveTo(s[l.a * 4], s[l.a * 4 + 1]);
            ctx.lineTo(s[l.b * 4], s[l.b * 4 + 1]);
            any = true;
          }
          if (!any) continue;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = width;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    const s = this.screen;
    const n = g.nodes.length;
    const time2 = time;
    for (let i = 0; i < n; i++) {
      const x = s[i * 4], y = s[i * 4 + 1], r = s[i * 4 + 2];
      if (x < -r || y < -r || x > W + r || y > H + r || s[i * 4 + 3] <= 0) continue;
      const state = this.states[i] as 0 | 1 | 2 | 3;
      if (R.node) {
        R.node(ctx, { index: i, node: g.nodes[i], x, y, radius: r, color: this.colors[i], state, selected: i === this.selected, hovered: i === this.hovered, focused: i === this.focused, zoom: cam.zoom, time: time2, meta });
        continue;
      }
      ctx.globalAlpha = state === NODE_DIMMED ? 0.18 : 1;
      ctx.fillStyle = this.colors[i];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (state === NODE_ACTIVE && hasHighlightRing(i, { selected: this.selected, hovered: this.hovered, matches: this.matches })) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.opts.linkColor;
        ctx.lineWidth = i === this.selected ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (i === this.focused) {
        // Dashed, in the focus colour, and outside the selection ring: never mistaken for it.
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.opts.focusColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
  }

  private paintLabels(g: IndexedGraph) {
    const W = this.width, H = this.height;
    const max = this.limits.maxLabelLength;
    const cands = labelCandidates({
      screen: this.screen,
      states: this.states,
      selected: this.selected,
      hovered: this.hovered,
      matches: this.matches,
      width: W,
      height: H,
      labelMinPx: this.limits.labelMinPx * 2.5,
      text: (i) => truncateLabel(this.opts.labelOf(i), max),
      focused: this.focused,
      focusNeighbors: this.focused >= 0 ? g.neighbors[this.focused] : undefined,
      cullOthers: this.neighborhood,
    });
    const placed: PlacedLabel[] = placeLabels(cands, { maxLabels: this.limits.maxLabels, maxForced: this.limits.maxForcedLabels, width: W, height: H });
    for (const l of placed) {
      l.id = g.nodes[l.index].id;
      const st = this.states[l.index];
      l.state = st === NODE_ACTIVE ? "active" : st === 2 ? "neighbor" : "normal";
    }
    this.labels.render(isLayerVisible(this.opts.layers, "labels") ? placed : []);
    const cl: ClusterLabel[] = [];
    const cam = this.camera;
    for (const c of isLayerVisible(this.opts.layers, "clusters") ? this.clusterCache : []) {
      const text = this.opts.clusterLabel ? this.opts.clusterLabel(c) : (c.label ?? null);
      if (!text) continue;
      const radius = c.radius * cam.zoom;
      if (radius < 12 || radius > Math.min(W, H) * 0.6) continue;
      // Kept on screen: a hull reaching past the top edge still shows its name.
      const y = Math.max(18, (c.center[1] - cam.y) * cam.zoom + H / 2 - radius - 4);
      cl.push({ id: c.id, text: truncateLabel(text, max), x: (c.center[0] - cam.x) * cam.zoom + W / 2, y, color: this.clusterColor(c) });
    }
    this.labels.renderClusters(cl);
  }

  // ------------------------------------------------------------------ input

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.set(e.pointerId ?? 0, p);
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable (synthetic event) */
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cam: { ...this.camera }, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      this.down = null;
      return;
    }
    this.down = { x: p.x, y: p.y, dragging: false, cam: { ...this.camera } };
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId ?? 0)) this.pointers.set(e.pointerId ?? 0, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const next = zoomAt2D(this.pinch.cam, this.width, this.height, this.pinch.mx, this.pinch.my, d / this.pinch.dist, this.limits);
      this.camera = next;
      this.goal = null;
      this.follow = -1;
      this.userMoved = true;
      this.invalidate();
      return;
    }
    if (this.down) {
      const dx = p.x - this.down.x, dy = p.y - this.down.y;
      if (!this.down.dragging && Math.abs(dx) + Math.abs(dy) >= DRAG_PX) this.down.dragging = true;
      if (this.down.dragging) {
        this.goal = null;
        this.follow = -1;
        this.userMoved = true;
        this.camera = { ...this.down.cam, x: this.down.cam.x - dx / this.camera.zoom, y: this.down.cam.y - dy / this.camera.zoom };
        this.canvas.style.cursor = "grabbing";
        this.invalidate();
      }
      return;
    }
    if (e.pointerType && e.pointerType !== "mouse") return;
    const h = this.pick(p.x, p.y);
    if (h !== this.hovered) {
      this.canvas.style.cursor = h >= 0 ? "pointer" : "grab";
      this.cb.onHover(h);
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId ?? 0);
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this.pinch = null;
        this.cb.onCamera(this.getCamera());
      }
      return;
    }
    const start = this.down;
    this.down = null;
    this.canvas.style.cursor = this.hovered >= 0 ? "pointer" : "grab";
    if (!start) return;
    if (start.dragging) {
      this.cb.onCamera(this.getCamera());
      return;
    }
    if ((e.button ?? 0) !== 0) return;
    const p = this.local(e);
    this.cb.onSelect(this.pick(p.x, p.y));
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId ?? 0);
    this.down = null;
    this.pinch = null;
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (this.hovered >= 0 && !this.down) this.cb.onHover(-1);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.camera = zoomAt2D(this.camera, this.width, this.height, p.x, p.y, Math.exp(-e.deltaY * unit * 0.0015), this.limits);
    this.goal = null;
    this.follow = -1;
    this.userMoved = true;
    this.fitPending = false;
    this.cb.onCamera(this.getCamera());
    this.invalidate();
  };

  private onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const step = 60 / this.camera.zoom;
    let cam: Camera2D | null = null;
    if (k === "Escape") {
      this.cb.onEscape();
    } else if (k === "+" || k === "=") cam = zoomAt2D(this.camera, this.width, this.height, this.width / 2, this.height / 2, 1.2, this.limits);
    else if (k === "-" || k === "_") cam = zoomAt2D(this.camera, this.width, this.height, this.width / 2, this.height / 2, 1 / 1.2, this.limits);
    else if (k === "ArrowLeft") cam = { ...this.camera, x: this.camera.x - step };
    else if (k === "ArrowRight") cam = { ...this.camera, x: this.camera.x + step };
    else if (k === "ArrowUp") cam = { ...this.camera, y: this.camera.y - step };
    else if (k === "ArrowDown") cam = { ...this.camera, y: this.camera.y + step };
    else if (k === "0") {
      this.fit(null);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    if (cam) {
      this.follow = -1;
      this.goal = null;
      this.userMoved = true;
      this.camera = cam;
      this.cb.onCamera(this.getCamera());
      this.invalidate();
    }
  };

  destroy() {
    this.destroyed = true;
    if (this.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.runner?.dispose();
    this.labels.dispose();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("keydown", this.onKey);
  }
}
