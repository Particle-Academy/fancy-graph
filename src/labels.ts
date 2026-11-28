import { NODE_ACTIVE, NODE_NEIGHBOR } from "./interaction";

export interface LabelCandidate {
  index: number;
  /** Projected node centre and radius, CSS px. */
  x: number;
  y: number;
  radius: number;
  text: string;
  /** Higher places first. */
  priority: number;
  /** Placed even when it overlaps (the selection, the hover). */
  forced?: boolean;
}

export interface PlacedLabel {
  index: number;
  id?: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state?: "active" | "neighbor" | "normal";
}

export interface PlaceOptions {
  /** Labels in total; forced labels may go past it. */
  maxLabels: number;
  /** Forced labels (selection, hover, the focused node and its neighbours). Default: no cap. */
  maxForced?: number;
  width: number;
  height: number;
  /** Estimated px per character. Defaults to 6.2 (11px UI font). */
  charWidth?: number;
  /** Label box height. Defaults to 14. */
  lineHeight?: number;
  /** Gap between the node edge and its label. Defaults to 4. */
  gap?: number;
}

/**
 * Greedy label placement: highest priority first, each label to the right of
 * its node, rejected when its box overlaps one already placed (forced labels
 * are never rejected). A uniform grid keeps the overlap test cheap at a few
 * thousand candidates.
 */
export function placeLabels(candidates: LabelCandidate[], opts: PlaceOptions): PlacedLabel[] {
  const cw = opts.charWidth ?? 6.2;
  const lh = opts.lineHeight ?? 14;
  const gap = opts.gap ?? 4;
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const placed: PlacedLabel[] = [];
  const cell = 64;
  const grid = new Map<number, PlacedLabel[]>();
  const key = (cx: number, cy: number) => cx * 100003 + cy;
  const maxForced = opts.maxForced ?? Infinity;
  let forcedCount = 0;
  for (const c of sorted) {
    if (c.forced) {
      if (forcedCount >= maxForced) continue;
    } else if (placed.length >= opts.maxLabels) continue;
    const w = Array.from(c.text).length * cw;
    const x = c.x + Math.max(3, c.radius) + gap;
    const y = c.y - lh / 2;
    if (x > opts.width || x + w < 0 || y > opts.height || y + lh < 0) continue;
    const x0 = Math.floor(x / cell), x1 = Math.floor((x + w) / cell), y0 = Math.floor(y / cell), y1 = Math.floor((y + lh) / cell);
    if (!c.forced) {
      let hit = false;
      for (let gx = x0; gx <= x1 && !hit; gx++)
        for (let gy = y0; gy <= y1 && !hit; gy++)
          for (const p of grid.get(key(gx, gy)) ?? []) if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + lh > p.y) {
            hit = true;
            break;
          }
      if (hit) continue;
    }
    const label: PlacedLabel = { index: c.index, text: c.text, x, y, w, h: lh };
    placed.push(label);
    if (c.forced) forcedCount++;
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = key(gx, gy);
        const list = grid.get(k);
        if (list) list.push(label);
        else grid.set(k, [label]);
      }
  }
  return placed;
}

export interface CandidateInput {
  /** 4 floats per node: x, y, radius px, depth (0 = hidden). */
  screen: Float32Array;
  states: Uint8Array;
  selected: number;
  hovered: number;
  matches: ReadonlySet<number> | null;
  width: number;
  height: number;
  labelMinPx: number;
  text: (index: number) => string;
  /** The keyboard / gamepad focus: it and its neighbours are always labelled. */
  focused?: number;
  focusNeighbors?: readonly number[];
  /** Label nothing else while something is focused (neighbourhood mode). */
  cullOthers?: boolean;
  /**
   * Semantic zoom: per node, the projected size (CSS px) of what its label
   * names, such as a star's whole system. With it, a node competes when its
   * reach is at least `reachMinPx` (instead of its radius at least
   * `labelMinPx`), bigger reach first; `Infinity` always competes, a negative
   * reach never does (only the forced labels reach it).
   */
  reach?: Float32Array;
  reachMinPx?: number;
  /**
   * Most unforced candidates returned, the highest priority kept. Text is
   * only asked for those, so a big graph does not build thousands of label
   * strings a frame for the few that can be placed. Default: no cap.
   */
  limit?: number;
}

/**
 * Which nodes compete for a label: the selection and hover always; matches and
 * the focus's neighbours next; otherwise only nodes drawn large enough, and
 * none at all while something is selected or searched (it would be noise).
 */
export function labelCandidates(input: CandidateInput): LabelCandidate[] {
  const { screen, states, selected, hovered, matches, width, height } = input;
  const kept: { index: number; x: number; y: number; radius: number; priority: number; forced: boolean }[] = [];
  const focused = input.focused ?? -1;
  const near = new Set(focused >= 0 ? (input.focusNeighbors ?? []) : []);
  const quiet = selected >= 0 || (matches && matches.size > 0) || (!!input.cullOthers && focused >= 0);
  const n = screen.length >> 2;
  for (let i = 0; i < n; i++) {
    const depth = screen[i * 4 + 3];
    if (depth <= 0) continue;
    const x = screen[i * 4], y = screen[i * 4 + 1], r = screen[i * 4 + 2];
    if (x < -40 || y < -20 || x > width + 40 || y > height + 20) continue;
    const reach = input.reach ? input.reach[i] : r;
    let priority = input.reach ? (reach === Infinity ? 5e3 : Math.max(0, Math.min(4e3, reach))) : r;
    let forced = false;
    if (i === focused) {
      priority += 9e6;
      forced = true;
    } else if (near.has(i)) {
      priority += 2e6;
      forced = true;
    } else if (i === selected) {
      priority += 1e7;
      forced = true;
    } else if (i === hovered) {
      priority += 1e6;
      forced = true;
    } else if (matches?.has(i)) priority += 1e5;
    else if (states[i] === NODE_NEIGHBOR) priority += 1e4;
    else if (quiet || (input.reach ? reach < 0 || reach < (input.reachMinPx ?? input.labelMinPx) : r < input.labelMinPx)) continue;
    else if (states[i] !== NODE_ACTIVE && hovered >= 0) priority *= 0.5;
    kept.push({ index: i, x, y, radius: r, priority, forced });
  }
  let list = kept;
  const limit = input.limit;
  if (typeof limit === "number" && Number.isFinite(limit) && limit >= 0) {
    const free = kept.filter((c) => !c.forced);
    if (free.length > limit) {
      const n = Math.floor(limit);
      // The n-th highest priority; everything above it is kept, and ties at it fill what room is left, in index order.
      const cut = n > 0 ? Float64Array.from(free, (c) => c.priority).sort()[free.length - n] : Infinity;
      let room = n - free.filter((c) => c.priority > cut).length;
      list = kept.filter((c) => c.forced || c.priority > cut || (c.priority === cut && room-- > 0));
    }
  }
  return list.map((c) => ({ ...c, text: input.text(c.index) }));
}

export interface ClusterLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  color?: string;
}

const LABEL_CSS =
  "position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;will-change:transform;display:none;" +
  "font:11px/14px ui-sans-serif,system-ui,sans-serif;color:var(--fancy-graph-label,#e8eef5);" +
  "text-shadow:0 0 4px var(--fancy-graph-label-halo,#000),0 0 2px var(--fancy-graph-label-halo,#000)";
const CLUSTER_CSS =
  "position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;will-change:transform;display:none;" +
  "font:600 12px/16px ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;" +
  "text-shadow:0 0 6px var(--fancy-graph-label-halo,#000),0 0 2px var(--fancy-graph-label-halo,#000)";

/**
 * The first spot (CSS px, in order) where a centred name `textWidth` wide is
 * on screen, at least `clear` px from every name already `taken`, and off
 * every placed node label's box. Null when none is clear: better no name than
 * one on top of another.
 */
export function chooseLabelSpot(spots: readonly [number, number][], taken: readonly { x: number; y: number }[], boxes: readonly PlacedLabel[], textWidth: number, width: number, height: number, clear: number): [number, number] | null {
  const hw = textWidth / 2 + 4;
  for (const [x, y] of spots) {
    if (x - hw < 0 || x + hw > width || y < 12 || y > height - 8) continue;
    if (taken.some((t) => Math.hypot(t.x - x, t.y - y) <= clear)) continue;
    if (boxes.some((b) => x + hw > b.x && x - hw < b.x + b.w && y + 9 > b.y && y - 9 < b.y + b.h)) continue;
    return [x, y];
  }
  return null;
}

export interface ConstellationLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  color?: string;
  selected?: boolean;
}

const CONSTELLATION_CSS =
  "position:absolute;left:0;top:0;white-space:nowrap;pointer-events:auto;cursor:pointer;will-change:transform;display:none;" +
  "font:italic 500 13px/16px ui-serif,Georgia,serif;letter-spacing:.08em;" +
  "text-shadow:0 0 6px var(--fancy-graph-label-halo,#000),0 0 2px var(--fancy-graph-label-halo,#000)";

/**
 * A pooled DOM layer for labels. Text goes in through `textContent` only, so a
 * label is inert whatever it contains. Elements are reused and moved with a
 * transform, never created per frame.
 */
export class LabelLayer {
  private readonly pool: HTMLDivElement[] = [];
  private readonly clusters: HTMLDivElement[] = [];
  private readonly constellations: HTMLDivElement[] = [];
  private onConstellation: ((id: string) => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    opts: { pool: number },
  ) {
    for (let i = 0; i < opts.pool; i++) {
      const el = root.ownerDocument.createElement("div");
      el.style.cssText = LABEL_CSS;
      el.setAttribute("data-fancy-graph-label", "");
      root.appendChild(el);
      this.pool.push(el);
    }
  }

  render(labels: PlacedLabel[]): void {
    const used = Math.min(labels.length, this.pool.length);
    for (let i = 0; i < used; i++) {
      const l = labels[i];
      const el = this.pool[i];
      if (el.textContent !== l.text) el.textContent = l.text;
      const id = l.id ?? String(l.index);
      if (el.dataset.fancyGraphLabel !== id) el.dataset.fancyGraphLabel = id;
      const state = l.state ?? "normal";
      if (el.dataset.fancyGraphLabelState !== state) el.dataset.fancyGraphLabelState = state;
      el.style.fontWeight = state === "active" ? "700" : "400";
      el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px)`;
      if (el.style.display !== "block") el.style.display = "block";
    }
    for (let i = used; i < this.pool.length; i++) {
      const el = this.pool[i];
      if (el.style.display !== "none") {
        el.style.display = "none";
        el.dataset.fancyGraphLabel = "";
      }
    }
  }

  renderClusters(labels: ClusterLabel[]): void {
    while (this.clusters.length < labels.length) {
      const el = this.root.ownerDocument.createElement("div");
      el.style.cssText = CLUSTER_CSS;
      this.root.appendChild(el);
      this.clusters.push(el);
    }
    this.clusters.forEach((el, i) => {
      const l = labels[i];
      if (!l) {
        el.style.display = "none";
        return;
      }
      if (el.textContent !== l.text) el.textContent = l.text;
      el.setAttribute("data-fancy-graph-cluster-label", l.id);
      el.style.color = l.color ?? "var(--fancy-graph-label,#e8eef5)";
      el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px) translate(-50%,-100%)`;
      el.style.display = "block";
    });
  }

  /**
   * Constellation names: clickable (the one label kind that takes pointer
   * events), each carrying `data-fancy-graph-constellation-label="<id>"`. Text
   * through `textContent` only.
   */
  renderConstellations(labels: ConstellationLabel[], onClick: (id: string) => void): void {
    this.onConstellation = onClick;
    while (this.constellations.length < labels.length) {
      const el = this.root.ownerDocument.createElement("div");
      el.style.cssText = CONSTELLATION_CSS;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-fancy-graph-constellation-label");
        if (id) this.onConstellation?.(id);
      });
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      this.root.appendChild(el);
      this.constellations.push(el);
    }
    this.constellations.forEach((el, i) => {
      const l = labels[i];
      if (!l) {
        if (el.style.display !== "none") el.style.display = "none";
        return;
      }
      if (el.textContent !== l.text) el.textContent = l.text;
      if (el.getAttribute("data-fancy-graph-constellation-label") !== l.id) el.setAttribute("data-fancy-graph-constellation-label", l.id);
      el.dataset.fancyGraphConstellationState = l.selected ? "selected" : "normal";
      el.style.color = l.color ?? "var(--fancy-graph-label,#e8eef5)";
      el.style.opacity = l.selected ? "1" : "0.72";
      el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px) translate(-50%,-50%)`;
      el.style.display = "block";
    });
  }

  dispose(): void {
    for (const el of [...this.pool, ...this.clusters, ...this.constellations]) el.remove();
    this.pool.length = 0;
    this.clusters.length = 0;
    this.constellations.length = 0;
  }
}
