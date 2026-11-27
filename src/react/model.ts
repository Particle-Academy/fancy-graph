import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { normalizeGraph } from "../graph";
import { searchNodes } from "../interaction";
import { DEFAULT_LAYERS, layerMap, resolveLayers, type GraphLayerSpec, type GraphLayerState, type GraphLayerVisibility, type LinkVisibility } from "../layers";
import type { GraphControlsProps } from "./controls";
import { resolveLimits, type GraphLimits } from "../limits";
import type { GraphThemeInput } from "../theme";
import type { GraphActivity, GraphActivitySource, GraphData, GraphNode, IndexedGraph } from "../types";

export interface ChangeMeta {
  source: GraphActivitySource;
}

/** The props every renderer shares: data, controlled interaction state, search, limits, motion. */
export interface GraphViewBaseProps {
  /** Plain JSON. A new object means a new graph; mutate nothing in place. */
  data: GraphData;
  /** Controlled selection (a node id or null). Omit to let the view own it. */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelectedChange?: (id: string | null, meta: ChangeMeta) => void;
  /** Controlled hover. */
  hovered?: string | null;
  onHoveredChange?: (id: string | null, meta: ChangeMeta) => void;
  /**
   * `"light"`, `"dark"`, `"auto"` (default: a `.dark` / `[data-theme=dark]`
   * ancestor, else the system), or overrides such as per-type colours:
   * `{ base: "dark", typeColors: { person: "#f472b6" } }`. CSS variables
   * (`--fancy-graph-background`, `--fancy-graph-type-<type>`, ...) override the base.
   */
  theme?: GraphThemeInput;
  /**
   * Controlled keyboard / gamepad focus: a cursor distinct from the selection,
   * drawn with its own ring, labelled with its neighbours, and kept in view.
   * Move it with the handle's `stepFocus`.
   */
  focused?: string | null;
  defaultFocused?: string | null;
  onFocusedChange?: (id: string | null, meta: ChangeMeta) => void;
  /** Keep the focused node in view (the camera follows it). Default true. */
  followFocused?: boolean;
  /** Neighbourhood mode: dim everything but the focused node and its neighbours, and label only them. */
  neighborhood?: boolean;
  /** Search query. Matches are highlighted, labelled, and reported. */
  search?: string;
  onSearchResults?: (ids: string[]) => void;
  /** Label text per node. Defaults to the label, then the id. Always rendered as text. */
  label?: (node: GraphNode, index: number) => string;
  /** Fly to a node when it becomes selected. 2D defaults to false, 3D to true. */
  flyOnSelect?: boolean;
  /**
   * `"all"`, `"focus"` (only the focus's links while something is focused or
   * searched), or `"none"`. Controlled when given; else `defaultLinkVisibility`,
   * else the preset's, else `"all"`. Switching the `links` layer off overrides it.
   */
  linkVisibility?: LinkVisibility;
  defaultLinkVisibility?: LinkVisibility;
  onLinkVisibilityChange?: (mode: LinkVisibility, meta: ChangeMeta) => void;
  /**
   * Which of the preset's layers are drawn, as JSON: `{ orbits: true, labels: false }`.
   * Ids are the preset's (`getLayers()` lists them: `links`, `labels`,
   * `clusters`, `background`, `orbits`, ...); one left out keeps its default.
   * Controlled when given.
   */
  layers?: Partial<GraphLayerVisibility>;
  defaultLayers?: Partial<GraphLayerVisibility>;
  /** Gets the full map, one key per declared layer. */
  onLayersChange?: (layers: GraphLayerVisibility, meta: ChangeMeta) => void;
  /** Freezes animated layouts (orbits). Controlled when given. */
  paused?: boolean;
  defaultPaused?: boolean;
  onPausedChange?: (paused: boolean, meta: ChangeMeta) => void;
  /**
   * A view-controls overlay drawn over the view, wired to all of the above and
   * the selection: pass `GraphViewControls` from
   * `@particle-academy/fancy-graph/controls`, or your own component. Off by default.
   */
  controls?: ComponentType<GraphControlsProps> | null | false;
  /** `"auto"` (default) follows `prefers-reduced-motion`. */
  reducedMotion?: boolean | "auto";
  limits?: Partial<GraphLimits>;
  onActivity?: (event: GraphActivity) => void;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

/** Reads `prefers-reduced-motion` and follows changes to it. */
export function useReducedMotion(pref: boolean | "auto" | undefined): boolean {
  const query = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [system, setSystem] = useState<boolean>(query);
  useEffect(() => {
    if (pref !== "auto" && pref !== undefined) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setSystem(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [pref]);
  return pref === true ? true : pref === false ? false : system;
}

function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T, meta: ChangeMeta) => void) {
  const [inner, setInner] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = useCallback(
    (next: T, meta: ChangeMeta) => {
      if (!controlled) setInner(next);
      onChange?.(next, meta);
    },
    [controlled, onChange],
  );
  return [current, set] as const;
}

export interface GraphModel {
  graph: IndexedGraph;
  limits: GraphLimits;
  matches: Set<number> | null;
  matchIds: string[];
  selectedId: string | null;
  hoveredId: string | null;
  selectedIndex: number;
  hoveredIndex: number;
  focusedId: string | null;
  focusedIndex: number;
  reducedMotion: boolean;
  select: (id: string | null, meta: ChangeMeta) => void;
  hover: (id: string | null, meta: ChangeMeta) => void;
  setFocused: (id: string | null, meta: ChangeMeta) => void;
  emit: (type: GraphActivity["type"], id: string | null | undefined, source: GraphActivitySource) => void;
  labelOf: (index: number) => string;
  /** The declared layers, resolved. */
  layerStates: GraphLayerState[];
  /** `{ id: visible }` for every declared layer. */
  layers: GraphLayerVisibility;
  /** False for an id the view does not declare. */
  setLayer: (id: string, visible: boolean, meta: ChangeMeta) => boolean;
  /** The mode asked for; the `links` layer may still hide them. */
  linkVisibility: LinkVisibility;
  setLinkVisibility: (mode: LinkVisibility, meta: ChangeMeta) => void;
  paused: boolean;
  setPaused: (paused: boolean, meta: ChangeMeta) => void;
}

/** What the view (its preset) tells the model: the layers it draws and its default link mode. */
export interface GraphModelView {
  layers?: readonly GraphLayerSpec[];
  linkVisibility?: LinkVisibility;
}

export function useGraphModel(props: GraphViewBaseProps, view: GraphModelView = {}): GraphModel {
  const limitsKey = JSON.stringify(props.limits ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const limits = useMemo(() => resolveLimits(props.limits), [limitsKey]);
  const graph = useMemo(() => normalizeGraph(props.data, limits), [props.data, limits]);
  const matchIdx = useMemo(() => searchNodes(graph, props.search ?? "", { limit: limits.maxSearchResults }), [graph, props.search, limits]);
  const matches = useMemo(() => (matchIdx.length ? new Set(matchIdx) : null), [matchIdx]);
  const matchIds = useMemo(() => matchIdx.map((i) => graph.nodes[i].id), [matchIdx, graph]);

  const onActivity = useRef(props.onActivity);
  onActivity.current = props.onActivity;
  const emit = useCallback((type: GraphActivity["type"], id: string | null | undefined, source: GraphActivitySource) => {
    onActivity.current?.({ type, id: id ?? null, source, at: Date.now() });
  }, []);

  const onSelectedChange = props.onSelectedChange;
  const onSelected = useCallback(
    (id: string | null, meta: ChangeMeta) => {
      onSelectedChange?.(id, meta);
      emit("select", id, meta.source);
    },
    [onSelectedChange, emit],
  );
  const onHoveredChange = props.onHoveredChange;
  const onHovered = useCallback(
    (id: string | null, meta: ChangeMeta) => {
      onHoveredChange?.(id, meta);
      emit("hover", id, meta.source);
    },
    [onHoveredChange, emit],
  );
  const [selectedId, select] = useControllable<string | null>(props.selected, props.defaultSelected ?? null, onSelected);
  const [hoveredId, hover] = useControllable<string | null>(props.hovered, null, onHovered);
  const onFocusedChange = props.onFocusedChange;
  const onFocused = useCallback(
    (id: string | null, meta: ChangeMeta) => {
      onFocusedChange?.(id, meta);
      emit("focus", id, meta.source);
    },
    [onFocusedChange, emit],
  );
  const [focusedId, setFocused] = useControllable<string | null>(props.focused, props.defaultFocused ?? null, onFocused);

  const onSearchResults = useRef(props.onSearchResults);
  onSearchResults.current = props.onSearchResults;
  useEffect(() => {
    onSearchResults.current?.(matchIds);
  }, [matchIds]);

  const reducedMotion = useReducedMotion(props.reducedMotion);
  const idx = (id: string | null | undefined) => (id != null ? (graph.index.get(id) ?? -1) : -1);
  const labelFn = props.label;
  const labelOf = useCallback(
    (i: number) => {
      const node = graph.nodes[i];
      if (!node) return "";
      const raw = labelFn ? labelFn(node, i) : (node.label ?? node.id);
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    [graph, labelFn],
  );

  // Layers: a partial map in, the full map out.
  const specs = view.layers ?? DEFAULT_LAYERS;
  const [innerLayers, setInnerLayers] = useState<Partial<GraphLayerVisibility>>(() => props.defaultLayers ?? {});
  const layerInput = props.layers !== undefined ? props.layers : innerLayers;
  const layerStates = useMemo(() => resolveLayers(specs, layerInput), [specs, layerInput]);
  const layers = useMemo(() => layerMap(layerStates), [layerStates]);
  const live = useRef({ props, layers, specs });
  live.current = { props, layers, specs };
  const setLayer = useCallback(
    (id: string, visible: boolean, meta: ChangeMeta) => {
      const { props: p, layers: cur, specs: sp } = live.current;
      if (!sp.some((s) => s.id === id) || typeof visible !== "boolean") return false;
      const next = { ...cur, [id]: visible };
      // Two calls before a render must both land.
      live.current.layers = next;
      if (p.layers === undefined) setInnerLayers(next);
      p.onLayersChange?.(next, meta);
      emit("layer", id, meta.source);
      return true;
    },
    [emit],
  );

  const [innerLinks, setInnerLinks] = useState<LinkVisibility | null>(() => props.defaultLinkVisibility ?? null);
  const linkVisibility: LinkVisibility = props.linkVisibility ?? innerLinks ?? view.linkVisibility ?? "all";
  const setLinkVisibility = useCallback(
    (mode: LinkVisibility, meta: ChangeMeta) => {
      if (mode !== "all" && mode !== "focus" && mode !== "none") return;
      const p = live.current.props;
      if (p.linkVisibility === undefined) setInnerLinks(mode);
      p.onLinkVisibilityChange?.(mode, meta);
      emit("links", mode, meta.source);
    },
    [emit],
  );

  const [innerPaused, setInnerPaused] = useState<boolean>(() => !!props.defaultPaused);
  const paused = props.paused ?? innerPaused;
  const setPaused = useCallback(
    (next: boolean, meta: ChangeMeta) => {
      const p = live.current.props;
      if (p.paused === undefined) setInnerPaused(!!next);
      p.onPausedChange?.(!!next, meta);
      emit("motion", next ? "paused" : "running", meta.source);
    },
    [emit],
  );

  return {
    graph,
    limits,
    matches,
    matchIds,
    selectedId,
    hoveredId,
    selectedIndex: idx(selectedId),
    hoveredIndex: idx(hoveredId),
    focusedId,
    focusedIndex: idx(focusedId),
    reducedMotion,
    select,
    hover,
    setFocused,
    emit,
    labelOf,
    layerStates,
    layers,
    setLayer,
    linkVisibility,
    setLinkVisibility,
    paused,
    setPaused,
  };
}
