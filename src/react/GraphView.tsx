import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type CSSProperties, type Ref } from "react";
import type { Camera2D } from "../camera";
import { forceLayout } from "../layout/force";
import type { GraphLayout } from "../layout/contract";
import { CanvasEngine, type ClusterSource, type Engine2DOptions } from "../render2d/engine";
import type { GraphRenderers2D } from "../render2d/types";
import { neighborLinks, type NeighborLink, type StepDirection } from "../interaction";
import type { GraphActivitySource, GraphCluster, GraphNode } from "../types";
import { effectiveFocus, freshCycle, stepFocusIndex, type PendingFocus } from "./navigation";
import { useGraphModel, type GraphViewBaseProps } from "./model";

export interface GraphViewHandleBase {
  /** Select a node (or null), through the same controlled path a click takes. */
  select(id: string | null, opts?: { source?: GraphActivitySource }): void;
  /** Search results, the selection and counts, for agents and tooling. */
  getState(): GraphViewState;
  getClusters(): GraphCluster[];
  /** Projected position (CSS px, relative to the canvas) of a node in the last frame. */
  screenPosition(id: string): { x: number; y: number; radius: number } | null;
  /** The node under a canvas point, or null. */
  pick(x: number, y: number): string | null;
  /** Renders one frame synchronously; returns its cost in ms. */
  renderFrame(dt?: number): { ms: number };
  /** The root element (`[data-fancy-graph]`). */
  readonly root: HTMLElement | null;
  /** A node's links in a stable order (input link order), each with the node at the other end. */
  neighbors(id: string): NeighborLink[];
  /**
   * Moves the focus: along a link in a screen direction, or to the next /
   * previous link of the node where cycling began. Returns the focused id.
   */
  stepFocus(direction: StepDirection, opts?: { source?: GraphActivitySource }): string | null;
  /** Sets the focus directly (null clears it). */
  focus(id: string | null, opts?: { source?: GraphActivitySource }): void;
  /** Analog camera input, per frame. Rotates about the target by radians; returns false where there is no rotation (2D). */
  orbit(dx: number, dy: number): boolean;
  /** Moves the view by screen px (x right, y down). Releases a follow. */
  pan(dx: number, dy: number): void;
  /** Multiplies the zoom (greater than 1 is closer). */
  zoom(factor: number): void;
}

export interface GraphViewState {
  selected: string | null;
  hovered: string | null;
  focused: string | null;
  matches: string[];
  nodeCount: number;
  linkCount: number;
  dropped: { nodes: number; links: number; invalidLinks: number; duplicateNodes: number };
}

export interface GraphViewHandle extends GraphViewHandleBase {
  flyTo(id: string, opts?: { zoom?: number; instant?: boolean }): boolean;
  fit(ids?: string[], opts?: { instant?: boolean }): void;
  reset(): void;
  getCamera(): Camera2D;
  setCamera(camera: Camera2D, opts?: { instant?: boolean }): void;
  follow(id: string | null): void;
}

export interface GraphViewProps extends GraphViewBaseProps {
  ref?: Ref<GraphViewHandle>;
  /** A layout function or stepper. Defaults to a force layout. */
  layout?: GraphLayout;
  renderers?: GraphRenderers2D;
  /** `"group"`, a fixed list, or a function of the live positions. Defaults to the layout's own clusters, if any. */
  clusters?: ClusterSource;
  clusterLabel?: (cluster: GraphCluster) => string | null;
  nodeColor?: (node: GraphNode, index: number) => string;
  /** World-space radius per node. */
  nodeSize?: (node: GraphNode, index: number) => number;
  /** Requested camera. When it changes the view flies there; `onCameraChange` reports where it settled. */
  camera?: Camera2D;
  onCameraChange?: (camera: Camera2D) => void;
  /** Canvas fill. Defaults to transparent (the container's background shows). */
  background?: string;
  /** Link stroke colour. Defaults to `--fancy-graph-link`, else slate. */
  linkColor?: string;
  /** Fixed size in CSS px. Omit to fill the container (it needs a height). */
  width?: number;
  height?: number;
}

export const visuallyHidden: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/**
 * A knowledge-graph viewer on a 2D canvas. Controlled: selection, hover,
 * focus, search and camera come in as props and go out through callbacks.
 * Layout and drawing are pluggable; picking, labels, camera and motion
 * preferences are the kit's.
 */
export function GraphView(props: GraphViewProps) {
  const model = useGraphModel(props);
  const { graph, limits } = model;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const latest = useRef({ props, model });
  latest.current = { props, model };

  const defaultLayout = useMemo(() => forceLayout(), []);
  const layout = props.layout ?? defaultLayout;

  const options = (): Engine2DOptions => {
    const { props: p, model: m } = latest.current;
    return {
      renderers: p.renderers ?? {},
      clusters: p.clusters,
      clusterLabel: p.clusterLabel,
      nodeColor: p.nodeColor ? (i) => p.nodeColor!(m.graph.nodes[i], i) : undefined,
      nodeSize: p.nodeSize ? (i) => p.nodeSize!(m.graph.nodes[i], i) : undefined,
      labelOf: m.labelOf,
      linkVisibility: p.linkVisibility ?? "all",
      background: p.background,
      linkColor: p.linkColor ?? readVar(rootRef.current, "--fancy-graph-link", "#94a3b8"),
      focusColor: readVar(rootRef.current, "--fancy-focus", "#3b82f6"),
      paused: !!p.paused,
    };
  };

  // The engine lives as long as the canvas does.
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new CanvasEngine(
      canvas,
      labelsRef.current!,
      latest.current.model.limits,
      options(),
      {
        onSelect: (i) => {
          const m = latest.current.model;
          m.select(i >= 0 ? m.graph.nodes[i].id : null, { source: "user" });
        },
        onHover: (i) => {
          const m = latest.current.model;
          m.hover(i >= 0 ? m.graph.nodes[i].id : null, { source: "user" });
        },
        onCamera: (c) => {
          latest.current.props.onCameraChange?.(c);
          latest.current.model.emit("camera", null, "user");
        },
        onEscape: () => {
          const m = latest.current.model;
          if (m.selectedId !== null) m.select(null, { source: "user" });
        },
      },
      latest.current.model.reducedMotion,
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    engineRef.current?.setReducedMotion(model.reducedMotion);
  }, [model.reducedMotion]);
  useLayoutEffect(() => {
    engineRef.current?.setLimits(limits);
  }, [limits]);
  useLayoutEffect(() => {
    engineRef.current?.setGraph(graph, layout);
  }, [graph, layout]);
  useLayoutEffect(() => {
    engineRef.current?.setOptions(options());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.renderers, props.clusters, props.clusterLabel, props.nodeColor, props.nodeSize, model.labelOf, props.linkVisibility, props.background, props.linkColor, props.paused]);
  useLayoutEffect(() => {
    engineRef.current?.setInteraction(model.selectedIndex, model.hoveredIndex, model.matches, model.focusedIndex, !!props.neighborhood);
  }, [model.selectedIndex, model.hoveredIndex, model.matches, model.focusedIndex, props.neighborhood]);
  const followFocused = props.followFocused ?? true;
  useLayoutEffect(() => {
    if (followFocused && model.focusedIndex >= 0) engineRef.current?.setFocus(model.focusedIndex);
  }, [followFocused, model.focusedIndex, graph]);
  const cycle = useRef(freshCycle());
  const pendingFocus = useRef<PendingFocus | null>(null);
  useLayoutEffect(() => {
    pendingFocus.current = null;
  });
  const flyOnSelect = props.flyOnSelect ?? false;
  useLayoutEffect(() => {
    if (flyOnSelect && model.selectedIndex >= 0) engineRef.current?.flyToIndex(model.selectedIndex);
  }, [flyOnSelect, model.selectedIndex]);
  const camKey = props.camera ? `${props.camera.x},${props.camera.y},${props.camera.zoom}` : "";
  useLayoutEffect(() => {
    const c = latest.current.props.camera;
    const e = engineRef.current;
    if (!c || !e) return;
    const cur = e.getCamera();
    if (cur.x !== c.x || cur.y !== c.y || cur.zoom !== c.zoom) e.setCamera(c);
  }, [camKey]);

  // Size: fixed props, else follow the container.
  useLayoutEffect(() => {
    const root = rootRef.current!;
    const apply = () => {
      const w = props.width ?? (root.clientWidth || 300);
      const h = props.height ?? (root.clientHeight || 150);
      engineRef.current?.setSize(w, h, typeof window !== "undefined" ? window.devicePixelRatio : 1);
    };
    apply();
    if (props.width !== undefined && props.height !== undefined) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    return () => ro.disconnect();
  }, [props.width, props.height]);

  useImperativeHandle(
    props.ref,
    (): GraphViewHandle => {
      const e = () => engineRef.current;
      const m = () => latest.current.model;
      const index = (id: string) => m().graph.index.get(id) ?? -1;
      return {
        neighbors: (id) => (m().graph.index.has(id) ? neighborLinks(m().graph, index(id)) : []),
        stepFocus(direction, opts) {
          const mm = m();
          const screen = e()?.getScreen() ?? new Float32Array(0);
          const current = effectiveFocus(mm.focusedId, pendingFocus.current);
          const from = current !== null ? (mm.graph.index.get(current) ?? -1) : -1;
          const next = stepFocusIndex(mm.graph, cycle.current, from, mm.selectedIndex, direction, screen);
          const id = next >= 0 ? mm.graph.nodes[next].id : null;
          if (id !== current) {
            pendingFocus.current = { id, from: mm.focusedId };
            mm.setFocused(id, { source: opts?.source ?? "api" });
          }
          return id;
        },
        focus(id, opts) {
          const mm = m();
          if (id !== null && !mm.graph.index.has(id)) return;
          mm.setFocused(id, { source: opts?.source ?? "api" });
        },
        orbit: () => false,
        pan: (dx, dy) => e()?.pan(dx, dy),
        zoom: (f) => e()?.zoomBy(f),
        select(id, opts) {
          const mm = m();
          if (id !== null && !mm.graph.index.has(id)) return;
          mm.select(id, { source: opts?.source ?? "api" });
        },
        flyTo(id, opts) {
          const ok = !!e()?.flyToIndex(index(id), opts?.zoom, opts?.instant);
          if (ok) m().emit("focus", id, "api");
          return ok;
        },
        fit(ids, opts) {
          e()?.fit(ids ? ids.map(index).filter((i) => i >= 0) : null, opts?.instant);
        },
        reset() {
          e()?.fit(null);
        },
        getCamera: () => e()?.getCamera() ?? { x: 0, y: 0, zoom: 1 },
        setCamera(c, opts) {
          e()?.setCamera(c, opts?.instant);
        },
        follow(id) {
          e()?.setFollow(id === null ? -1 : index(id));
        },
        screenPosition: (id) => e()?.screenPosition(index(id)) ?? null,
        pick(x, y) {
          const i = e()?.pick(x, y) ?? -1;
          return i >= 0 ? m().graph.nodes[i].id : null;
        },
        renderFrame: (dt) => e()?.renderFrame(dt) ?? { ms: 0 },
        getClusters: () => e()?.getClusters() ?? [],
        getState() {
          const mm = m();
          return {
            selected: mm.selectedId,
            hovered: mm.hoveredId,
            focused: mm.focusedId,
            matches: mm.matchIds,
            nodeCount: mm.graph.nodes.length,
            linkCount: mm.graph.links.length,
            dropped: { ...mm.graph.dropped },
          };
        },
        get root() {
          return rootRef.current;
        },
      };
    },
    [],
  );

  const selectedLabel = model.selectedIndex >= 0 ? model.labelOf(model.selectedIndex) : "";
  const label = `${props["aria-label"] ?? "Graph"}: ${graph.nodes.length} nodes, ${graph.links.length} links`;
  return (
    <div
      ref={rootRef}
      className={props.className}
      style={{ position: "relative", overflow: "hidden", touchAction: "none", width: props.width, height: props.height, ...props.style }}
      data-fancy-graph=""
      data-fancy-graph-renderer="2d"
      data-fancy-graph-node-count={graph.nodes.length}
      data-fancy-graph-link-count={graph.links.length}
      data-fancy-graph-selected={model.selectedId ?? ""}
      data-fancy-graph-hovered={model.hoveredId ?? ""}
      data-fancy-graph-focused={model.focusedId ?? ""}
      data-fancy-graph-matches={model.matchIds.length}
    >
      <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={label} data-fancy-graph-canvas="" style={{ display: "block", width: "100%", height: "100%", outline: "none", cursor: "grab" }} />
      <div ref={labelsRef} aria-hidden="true" data-fancy-graph-labels="" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />
      <div aria-live="polite" style={visuallyHidden} data-fancy-graph-announcer="">
        {selectedLabel ? `Selected ${selectedLabel}` : ""}
      </div>
    </div>
  );
}

function readVar(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el || typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

