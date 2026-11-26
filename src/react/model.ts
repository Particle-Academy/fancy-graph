import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { normalizeGraph } from "../graph";
import { searchNodes } from "../interaction";
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
  /** `"all"` (default), `"focus"` (only the focus's links while something is focused or searched), or `"none"`. */
  linkVisibility?: "all" | "focus" | "none";
  /** Freezes animated layouts (orbits). */
  paused?: boolean;
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
}

export function useGraphModel(props: GraphViewBaseProps): GraphModel {
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
  };
}
