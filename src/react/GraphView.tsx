import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type CSSProperties, type Ref } from "react";
import type { Camera2D } from "../camera";
import type { GraphLayout } from "../layout/contract";
import { CanvasEngine, type ClusterSource, type Engine2DOptions } from "../render2d/engine";
import type { GraphRenderers2D } from "../render2d/types";
import { neighborLinks, type NeighborLink, type StepDirection } from "../interaction";
import type { GraphActivitySource, GraphCluster, GraphNode } from "../types";
import { effectiveFocus, freshCycle, stepFocusIndex, type PendingFocus } from "./navigation";
import { useGraphModel, type GraphViewBaseProps } from "./model";
import { resolvePreset2D, type GraphPreset2D, type GraphPreset2DId } from "../presets/presets2d";
import { applyThemeVars, resolveTheme, typeColorsFor } from "../theme";
import { DEFAULT_LAYERS, mergeLayerSpecs, type GraphLayerSpec } from "../layers";
import { controlsDataset, controlsHandle, controlsState, isAnimatedLayout, renderControls, type GraphControlsHandle, type GraphControlsState } from "./controls";
import { FullscreenButton, FullscreenContext } from "@particle-academy/fancy-3d/fullscreen";
import { OVERLAY_CSS, showsOwnButton, useGraphFullscreen, useOwnFullscreen, type GraphFullscreenHandle } from "./fullscreen";

export interface GraphViewHandleBase extends GraphControlsHandle, GraphFullscreenHandle {
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
  /** A node's position in the current layout (world units), or null. */
  positionOf(id: string): [number, number, number] | null;
}

export interface GraphViewState extends GraphControlsState {
  selected: string | null;
  hovered: string | null;
  focused: string | null;
  matches: string[];
  /** Input nodes in the view (after validation and limits). A preset's synthetic centres are not counted here. */
  nodeCount: number;
  /** Input links in the view. A preset's synthetic gravity links are not counted here. */
  linkCount: number;
  /** Nodes the view added itself (the cosmos's galaxy and system centres, `synthetic: true`). */
  syntheticNodeCount: number;
  /** Links the view added itself (gravity to those centres). */
  syntheticLinkCount: number;
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
  /**
   * A ready-made view: `"network"` (default), `"radial"`, `"hierarchy"`,
   * `"clustered"`, or a preset object (see `GRAPH_PRESETS_2D` and the preset
   * factories). Any of `layout`, `renderers`, `clusters`, `clusterLabel` and
   * `linkVisibility` passed as well overrides that piece of the preset.
   */
  preset?: GraphPreset2DId | GraphPreset2D;
  /** A layout function or stepper. Overrides the preset's. */
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
  /** Canvas fill. Defaults to the theme's background; `"transparent"` lets the container show. */
  background?: string;
  /** Link stroke colour. Defaults to the theme's. */
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
  const preset = useMemo(() => resolvePreset2D(props.preset), [props.preset]);
  // The preset's layers, plus any the props add (a cluster source, a background renderer).
  const hasClusters = props.clusters !== undefined || preset.clusters !== undefined;
  const hasBackground = !!(props.renderers?.background ?? preset.renderers?.background);
  const layerSpecs = useMemo<readonly GraphLayerSpec[]>(
    () =>
      mergeLayerSpecs(
        preset.layers ?? DEFAULT_LAYERS,
        hasClusters ? [{ id: "clusters", label: "Clusters" }] : [],
        hasBackground ? [{ id: "background", label: "Background" }] : [],
      ),
    [preset, hasClusters, hasBackground],
  );
  const model = useGraphModel(props, { layers: layerSpecs, linkVisibility: preset.linkVisibility });
  const { graph, limits } = model;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const latest = useRef({ props, model, preset });
  latest.current = { props, model, preset };
  // Full screen takes the root: canvas, labels, controls overlay and the host's overlay.
  const own = useOwnFullscreen(rootRef, props);
  const fs = useGraphFullscreen(own.controller, model, own.asked);
  const fsRef = useRef(fs);
  fsRef.current = fs;

  // The preset's layout, rebuilt only when its key changes (the radial view's centre).
  const presetState = { graph, selected: model.selectedId, focused: model.focusedId };
  const layoutKey = preset.layoutKey ? preset.layoutKey(presetState) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const presetLayout = useMemo(() => preset.layout(presetState), [preset, layoutKey, graph]);
  const layout = props.layout ?? presetLayout;
  const animated = isAnimatedLayout(layout);
  const animatedRef = useRef(animated);
  animatedRef.current = animated;

  const options = (): Engine2DOptions => {
    const { props: p, model: m, preset: pr } = latest.current;
    // Resolved against the container, not the root, so the variables the root sets for its labels never feed back.
    const themeEl = rootRef.current?.parentElement ?? null;
    const theme = resolveTheme(p.theme, themeEl);
    if (rootRef.current) {
      applyThemeVars(rootRef.current, theme);
      rootRef.current.dataset.fancyGraphTheme = theme.mode;
    }
    const typeColorOf = typeColorsFor(theme, m.graph.nodes, themeEl);
    return {
      renderers: { ...(pr.renderers ?? {}), ...(p.renderers ?? {}) },
      clusters: p.clusters ?? pr.clusters,
      clusterLabel: p.clusterLabel ?? pr.clusterLabel,
      nodeColor: (i) => {
        const node = m.graph.nodes[i];
        return p.nodeColor ? p.nodeColor(node, i) : (node.color ?? typeColorOf(node.group));
      },
      nodeSize: p.nodeSize ? (i) => p.nodeSize!(m.graph.nodes[i], i) : undefined,
      labelOf: m.labelOf,
      linkVisibility: m.linkVisibility,
      layers: m.layers,
      background: p.background ?? theme.background,
      linkColor: p.linkColor ?? theme.link,
      focusColor: theme.focus,
      paused: m.paused,
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
          const id = i >= 0 ? m.graph.nodes[i].id : null;
          // A click on the selected node clears it: in a dense view there may be no empty space to click.
          m.select(id !== null && id === m.selectedId ? null : id, { source: "user" });
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
  const themeKey = JSON.stringify(props.theme ?? "auto");
  useLayoutEffect(() => {
    engineRef.current?.setOptions(options());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, themeKey, props.renderers, props.clusters, props.clusterLabel, props.nodeColor, props.nodeSize, model.labelOf, model.linkVisibility, model.layers, props.background, props.linkColor, model.paused]);
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
        ...controlsHandle(m),
        setFullscreen: (on, opts) => fsRef.current.set(on, opts?.source ?? "api"),
        neighbors: (id) => (m().graph.index.has(id) ? neighborLinks(m().graph, index(id)) : []),
        positionOf: (id) => e()?.positionOf(index(id)) ?? null,
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
            nodeCount: mm.counts.nodes,
            linkCount: mm.counts.links,
            syntheticNodeCount: mm.counts.syntheticNodes,
            syntheticLinkCount: mm.counts.syntheticLinks,
            dropped: { ...mm.graph.dropped },
            ...controlsState(mm, animatedRef.current, fsRef.current.state()),
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
  const label = `${props["aria-label"] ?? "Graph"}: ${model.counts.nodes} nodes, ${model.counts.links} links`;
  return (
    <FullscreenContext.Provider value={fs.controller}>
    <div
      ref={rootRef}
      className={props.className}
      style={{ position: "relative", overflow: "hidden", touchAction: "none", width: props.width, height: props.height, ...props.style }}
      data-fancy-graph=""
      data-fancy-graph-renderer="2d"
      data-fancy-graph-preset={preset.id}
      data-fancy-graph-node-count={model.counts.nodes}
      data-fancy-graph-link-count={model.counts.links}
      data-fancy-graph-synthetic-node-count={model.counts.syntheticNodes}
      data-fancy-graph-synthetic-link-count={model.counts.syntheticLinks}
      data-fancy-graph-selected={model.selectedId ?? ""}
      data-fancy-graph-hovered={model.hoveredId ?? ""}
      data-fancy-graph-focused={model.focusedId ?? ""}
      data-fancy-graph-matches={model.matchIds.length}
      {...controlsDataset(model)}
    >
      <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={label} data-fancy-graph-canvas="" style={{ display: "block", width: "100%", height: "100%", outline: "none", cursor: "grab" }} />
      <div ref={labelsRef} aria-hidden="true" data-fancy-graph-labels="" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />
      <div aria-live="polite" style={visuallyHidden} data-fancy-graph-announcer="">
        {selectedLabel ? `Selected ${selectedLabel}` : ""}
      </div>
      {renderControls(props.controls, model, animated, fs.controls)}
      {props.overlay != null && (
        <div data-fancy-graph-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <style>{OVERLAY_CSS}</style>
          {props.overlay}
        </div>
      )}
      {showsOwnButton(props) && <FullscreenButton controller={fs.controller} />}
    </div>
    </FullscreenContext.Provider>
  );
}


