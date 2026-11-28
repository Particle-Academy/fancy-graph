import { Stage, useStage } from "@particle-academy/fancy-3d-three/react";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_LAYERS, mergeLayerSpecs, type GraphLayerSpec } from "../layers";
import { controlsDataset, controlsHandle, controlsState, isAnimatedLayout, renderControls } from "../react/controls";
import { FullscreenButton, FullscreenContext, useFullscreenContext } from "@particle-academy/fancy-3d/fullscreen";
import { showsOwnButton, useGraphFullscreen, useOwnFullscreen } from "../react/fullscreen";
import type { Camera3D } from "../camera";
import type { GraphLayout } from "../layout/contract";
import { applyThemeVars, resolveTheme, typeColorsFor } from "../theme";
import { resolvePreset3D, type GraphPreset3D, type GraphPreset3DId } from "./presets/presets3d";
import type { GraphViewHandleBase, GraphViewState } from "../react/GraphView";
import { useGraphModel, type ChangeMeta, type GraphViewBaseProps } from "../react/model";
import type { CosmosLenses } from "./presets/cosmos-layout";
import { neighborLinks } from "../interaction";
import { effectiveFocus, freshCycle, stepFocusIndex, type PendingFocus } from "../react/navigation";
import type { GraphActivitySource, GraphCluster, GraphNode, Vec3 } from "../types";
import { StageEngine, type ClusterSource3D, type Engine3DOptions } from "./engine";
import type { GraphRenderers3D, StageLike } from "./types";

/** One step of the way out from a selection: the universe (id null), a galaxy's core, a star, a planet, the node. */
export interface GraphBreadcrumb {
  id: string | null;
  label: string;
}

/** A named set of nodes the layout drew (the cosmos's constellations). */
export interface GraphConstellationInfo {
  id: string;
  label: string;
  /** Member node ids. */
  members: string[];
}

export interface GraphScene3DState extends GraphViewState {
  /** The selected constellation's id, or null. */
  constellation: string | null;
}

export interface GraphScene3DHandle extends GraphViewHandleBase {
  getState(): GraphScene3DState;
  /** Whatever the layout exposed (the cosmos's bodies, galaxies, comets, constellations). */
  getMeta(): unknown;
  /** The selection's path, universe first; just the universe with nothing selected. Select a crumb's id to fly there. */
  getBreadcrumbs(): GraphBreadcrumb[];
  getConstellations(): GraphConstellationInfo[];
  /** Selects a constellation (null clears) through the controlled path. False for an id the view does not draw. */
  selectConstellation(id: string | null, opts?: { source?: GraphActivitySource }): boolean;
  /** Fly to a node and follow it while it moves. */
  flyTo(id: string, opts?: { distance?: number }): boolean;
  flyToCluster(id: string): boolean;
  flyToPoint(target: Vec3, opts?: { distance?: number; direction?: Vec3 }): void;
  fit(ids?: string[]): void;
  /** Back to the whole graph. */
  reset(): void;
  follow(id: string | null): void;
  getCamera(): Camera3D;
  setCamera(camera: Camera3D): void;
}

export interface GraphScene3DProps extends GraphViewBaseProps {
  ref?: Ref<GraphScene3DHandle>;
  /**
   * A ready-made 3D view: `"network"` (default), `"cosmos"`, `"layered"`, or a
   * preset object (see `GRAPH_PRESETS_3D` and the preset factories). `layout`,
   * any `renderers` slot, `nodeSize`, `clusterLabel`, `linkVisibility` and
   * the home angles passed as well override that piece of the preset.
   */
  preset?: GraphPreset3DId | GraphPreset3D;
  /** A layout function or stepper; it is given 3 dimensions. Overrides the preset's. */
  layout?: GraphLayout;
  /** Layers per slot; a slot given here replaces the preset's, the rest stay. */
  renderers?: GraphRenderers3D;
  clusters?: ClusterSource3D;
  clusterLabel?: (cluster: GraphCluster) => string | null;
  /** CSS colour per node. `meta` is whatever the layout exposed. */
  nodeColor?: (node: GraphNode, index: number, meta: unknown) => string;
  /** World radius per node. */
  nodeSize?: (node: GraphNode, index: number, meta: unknown) => number;
  /** Requested camera; when it changes the view flies there. */
  camera?: Camera3D;
  onCameraChange?: (camera: Camera3D) => void;
  /** Direction of the home view, radians. Defaults to the preset's, else 0.75 / 0.55. */
  homeYaw?: number;
  homePitch?: number;
  /** Paint the stage's clear colour from the theme. Default: when `theme` is given (always, in `<GraphView3D>`). */
  applyThemeBackground?: boolean;
  /**
   * The cosmos's lenses, as JSON: `systems`, `galaxies`, `sort`,
   * `constellations`, `comets`, `labels`. With a preset that takes options
   * (the cosmos does), it replaces the preset's lenses; a change animates.
   */
  cosmos?: CosmosLenses;
  /** Controlled constellation selection (an id or null). Its members are highlighted and the view frames them. */
  selectedConstellation?: string | null;
  defaultSelectedConstellation?: string | null;
  onSelectedConstellationChange?: (id: string | null, meta: ChangeMeta) => void;
  /** The selection's breadcrumbs, each time they change. */
  onBreadcrumbsChange?: (crumbs: GraphBreadcrumb[]) => void;
  /** @internal GraphView3D's record of who asked for its last full-screen change. */
  fullscreenAsked?: { current: GraphActivitySource | null };
}

export interface GraphSceneOnStageProps extends GraphScene3DProps {
  /** A fancy-3d-three Stage context (from `useStage()`), or anything shaped like one. */
  stage: StageLike;
}

/**
 * The 3D graph, mounted on a stage you pass in. Use `<GraphScene3D>` inside a
 * `<Stage>` instead; this form exists for hosts that hold the stage context
 * themselves.
 */
export function GraphSceneOnStage(props: GraphSceneOnStageProps) {
  const { stage } = props;
  const cosmosKey = props.cosmos === undefined ? "" : JSON.stringify(props.cosmos);
  const preset = useMemo(() => {
    const base = resolvePreset3D(props.preset);
    return cosmosKey && base.configure ? base.configure(JSON.parse(cosmosKey) as CosmosLenses) : base;
  }, [props.preset, cosmosKey]);
  // Layers a preset can name only after its layout has run (one per constellation).
  const [metaLayers, setMetaLayers] = useState<GraphLayerSpec[]>([]);
  // Layers own GPU state: a fresh set per preset, and slot-by-slot overrides from the props.
  const presetLayers = useMemo(() => preset.renderers?.() ?? {}, [preset]);
  const renderers = useMemo(() => ({ ...presetLayers, ...(props.renderers ?? {}) }), [presetLayers, props.renderers]);
  const hasClusters = props.clusters !== undefined;
  // The preset's layers, plus any its renderers (or the props' overrides) fill or tag.
  const layerSpecs = useMemo(() => mergeLayerSpecs(preset.layers, metaLayers, layersOf(renderers, hasClusters)), [preset, renderers, hasClusters, metaLayers]);
  const model = useGraphModel(props, { layers: layerSpecs, linkVisibility: preset.linkVisibility, prepare: preset.prepare });
  const { graph, limits } = model;
  const engineRef = useRef<StageEngine | null>(null);
  const latest = useRef({ props, model, preset });
  latest.current = { props, model, preset };
  // Full screen is the nearest viewer's: GraphView3D's root, or the host's Stage.
  const fs = useGraphFullscreen(useFullscreenContext(), model, props.fullscreenAsked);
  const fsRef = useRef(fs);
  fsRef.current = fs;
  const presetState = { graph, selected: model.selectedId, focused: model.focusedId };
  const layoutKey = preset.layoutKey ? preset.layoutKey(presetState) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const presetLayout = useMemo(() => preset.layout(presetState), [preset, layoutKey, graph]);
  const layout = props.layout ?? presetLayout;
  const animated = isAnimatedLayout(layout);
  const animatedRef = useRef(animated);
  animatedRef.current = animated;
  const themeKey = JSON.stringify(props.theme ?? "auto");

  const options = (): Engine3DOptions => {
    const { props: p, model: m, preset: pr } = latest.current;
    const themeEl = stage.canvas.closest("[data-fancy-graph]")?.parentElement ?? null;
    const theme = resolveTheme(p.theme, themeEl);
    applyThemeVars(stage.overlayRoot as HTMLElement, theme);
    if (p.applyThemeBackground ?? p.theme !== undefined) {
      (stage.renderer as { setClearColor?: (c: THREE.Color, a?: number) => void }).setClearColor?.(new THREE.Color(theme.background), 1);
    }
    const root = stage.canvas.closest<HTMLElement>("[data-fancy-graph]");
    if (root) {
      root.dataset.fancyGraphTheme = theme.mode;
      root.dataset.fancyGraphPreset = pr.id;
    }
    const nodeSize = p.nodeSize ?? pr.nodeSize;
    const typeColorOf = typeColorsFor(theme, m.graph.nodes, themeEl);
    return {
      renderers: rendersRef.current,
      clusters: p.clusters,
      clusterLabel: p.clusterLabel ?? pr.clusterLabel,
      nodeColor: (i, meta) => {
        const node = m.graph.nodes[i];
        return p.nodeColor ? p.nodeColor(node, i, meta) : (node.color ?? typeColorOf(node.group));
      },
      nodeSize: nodeSize ? (i, meta) => nodeSize(m.graph.nodes[i], i, meta) : undefined,
      labelOf: m.labelOf,
      linkVisibility: m.linkVisibility,
      layers: m.layers,
      paused: m.paused,
      homeYaw: p.homeYaw ?? pr.homeYaw ?? 0.75,
      homePitch: p.homePitch ?? pr.homePitch ?? 0.55,
      transition: pr.transition,
      labelReach: pr.labelReach,
      frameRadius: pr.frameRadius,
    };
  };

  // The constellation selection: controlled when the prop is given.
  const [innerConstellation, setInnerConstellation] = useState<string | null>(props.defaultSelectedConstellation ?? null);
  const constellation = props.selectedConstellation !== undefined ? props.selectedConstellation : innerConstellation;
  const selectConstellation = useCallback((id: string | null, meta: ChangeMeta) => {
    const { props: p, model: m } = latest.current;
    if (p.selectedConstellation === undefined) setInnerConstellation(id);
    p.onSelectedConstellationChange?.(id, meta);
    m.emit("constellation", id, meta.source);
  }, []);
  const constellationRef = useRef(constellation);
  constellationRef.current = constellation;
  const rendersRef = useRef(renderers);
  rendersRef.current = renderers;

  useLayoutEffect(() => {
    const engine = new StageEngine(
      stage,
      latest.current.model.limits,
      options(),
      {
        onSelect: (i) => {
          const m = latest.current.model;
          const hit = i >= 0 ? m.graph.nodes[i].id : null;
          // A click on the selected node clears it: in a dense view (the cosmos) there may be no empty space to click.
          const id = hit !== null && hit === m.selectedId ? null : hit;
          if (id !== m.selectedId) m.select(id, { source: "user" });
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
        onConstellation: (id) => {
          // A click on the selected constellation clears it.
          selectConstellation(id === constellationRef.current ? null : id, { source: "user" });
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
  }, [stage]);

  useLayoutEffect(() => {
    engineRef.current?.setReducedMotion(model.reducedMotion);
  }, [model.reducedMotion, stage]);
  useLayoutEffect(() => {
    engineRef.current?.setLimits(limits);
  }, [limits, stage]);
  // The scene BEFORE the options. A preset change brings a new layout and new
  // layers together; run setOptions first and it mounts the new layers (and calls
  // the new nodeSize) against the OLD layout's meta, and the cosmos reads
  // meta.bodies. setScene takes the options too, so setOptions after it is a no-op remount-wise.
  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setScene(graph, layout, options());
    const next = latest.current.preset.layersFor?.(engine.getMeta()) ?? [];
    setMetaLayers((cur) => (cur.map((l) => `${l.id}=${l.label}`).join("|") === next.map((l) => `${l.id}=${l.label}`).join("|") ? cur : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout, renderers, stage]);
  useLayoutEffect(() => {
    engineRef.current?.setOptions(options());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, themeKey, props.clusters, props.clusterLabel, props.nodeColor, props.nodeSize, model.labelOf, model.linkVisibility, model.layers, model.paused, props.homeYaw, props.homePitch, props.applyThemeBackground, stage]);
  useLayoutEffect(() => {
    engineRef.current?.setInteraction(model.selectedIndex, model.hoveredIndex, model.matches, model.focusedIndex, !!props.neighborhood);
  }, [model.selectedIndex, model.hoveredIndex, model.matches, model.focusedIndex, props.neighborhood, stage]);
  const followFocused = props.followFocused ?? true;
  useLayoutEffect(() => {
    if (followFocused && model.focusedIndex >= 0) engineRef.current?.focusIndex(model.focusedIndex);
  }, [followFocused, model.focusedIndex, graph, stage]);
  const cycle = useRef(freshCycle());
  const pendingFocus = useRef<PendingFocus | null>(null);
  useLayoutEffect(() => {
    pendingFocus.current = null;
  });
  const flyOnSelect = props.flyOnSelect ?? true;
  // A constellation selected (here, by a click, or by an agent) highlights its members and, like a selection, flies to frame them.
  useLayoutEffect(() => {
    const members = engineRef.current?.setConstellation(constellation ?? null) ?? [];
    if (flyOnSelect && members.length) engineRef.current?.fitIndices(members);
  }, [constellation, graph, layout, flyOnSelect, stage]);
  const crumbsOf = (): GraphBreadcrumb[] => {
    const { model: m, preset: pr } = latest.current;
    const out: GraphBreadcrumb[] = [{ id: null, label: "Universe" }];
    const sel = m.selectedIndex;
    if (sel < 0) return out;
    const path = pr.path ? pr.path(sel, engineRef.current?.getMeta()) : [sel];
    for (const i of path) if (i >= 0 && i < m.graph.nodes.length) out.push({ id: m.graph.nodes[i].id, label: m.labelOf(i) });
    return out;
  };
  const lastCrumbs = useRef("");
  useLayoutEffect(() => {
    const crumbs = crumbsOf();
    const key = JSON.stringify(crumbs);
    const root = stage.canvas.closest<HTMLElement>("[data-fancy-graph]");
    if (root) root.dataset.fancyGraphBreadcrumbs = crumbs.map((c) => c.id).filter((x): x is string => x !== null).join(" > ");
    if (key === lastCrumbs.current) return;
    lastCrumbs.current = key;
    latest.current.props.onBreadcrumbsChange?.(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.selectedIndex, graph, layout, stage]);
  useLayoutEffect(() => {
    if (flyOnSelect && model.selectedIndex >= 0) engineRef.current?.flyToIndex(model.selectedIndex);
  }, [flyOnSelect, model.selectedIndex, stage]);
  const camKey = props.camera ? JSON.stringify(props.camera) : "";
  useLayoutEffect(() => {
    const c = latest.current.props.camera;
    if (c) engineRef.current?.setCamera(c);
  }, [camKey]);

  // Stable handles on the enclosing [data-fancy-graph] (GraphView3D's root), and an accessible name on the canvas.
  const ariaName = `${props["aria-label"] ?? "Graph"}: ${model.counts.nodes} nodes, ${model.counts.links} links`;
  useLayoutEffect(() => {
    const root = stage.canvas.closest<HTMLElement>("[data-fancy-graph]");
    if (root) {
      root.dataset.fancyGraphNodeCount = String(model.counts.nodes);
      root.dataset.fancyGraphLinkCount = String(model.counts.links);
      root.dataset.fancyGraphSyntheticNodeCount = String(model.counts.syntheticNodes);
      root.dataset.fancyGraphSyntheticLinkCount = String(model.counts.syntheticLinks);
      root.dataset.fancyGraphSelected = model.selectedId ?? "";
      root.dataset.fancyGraphHovered = model.hoveredId ?? "";
      root.dataset.fancyGraphFocused = model.focusedId ?? "";
      root.dataset.fancyGraphMatches = String(model.matchIds.length);
      root.dataset.fancyGraphConstellation = constellation ?? "";
      for (const [k, v] of Object.entries(controlsDataset(model))) root.setAttribute(k, v);
    }
    stage.canvas.setAttribute("aria-label", ariaName);
    stage.canvas.setAttribute("role", "img");
    stage.canvas.setAttribute("data-fancy-graph-canvas", "");
  }, [stage, graph, model.counts, model.selectedId, model.hoveredId, model.focusedId, model.matchIds, ariaName, model.layerStates, model.linkVisibility, model.paused, constellation]);

  useImperativeHandle(
    props.ref,
    (): GraphScene3DHandle => {
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
        orbit: (dx, dy) => !!e()?.orbitBy(dx, dy),
        pan: (dx, dy) => e()?.panBy(dx, dy),
        zoom: (f) => e()?.zoomBy(f),
        select(id, opts) {
          const mm = m();
          if (id !== null && !mm.graph.index.has(id)) return;
          mm.select(id, { source: opts?.source ?? "api" });
        },
        flyTo(id, opts) {
          const ok = !!e()?.flyToIndex(index(id), opts?.distance);
          if (ok) m().emit("focus", id, "api");
          return ok;
        },
        flyToCluster: (id) => !!e()?.flyToCluster(id),
        flyToPoint: (target, opts) => e()?.flyToPoint(target, opts?.distance, opts?.direction),
        fit(ids) {
          if (!ids) e()?.goHome();
          else e()?.fitIndices(ids.map(index).filter((i) => i >= 0));
        },
        reset: () => e()?.goHome(),
        follow: (id) => e()?.setFollow(id === null ? -1 : index(id)),
        getCamera: () => e()?.getCamera() ?? { target: [0, 0, 0], distance: 1, yaw: 0, pitch: 0 },
        setCamera: (c) => e()?.setCamera(c),
        screenPosition: (id) => e()?.screenPosition(index(id)) ?? null,
        pick(x, y) {
          const i = e()?.pick(x, y) ?? -1;
          return i >= 0 ? m().graph.nodes[i].id : null;
        },
        renderFrame(dt) {
          const engine = e();
          if (!engine) return { ms: 0 };
          const t0 = performance.now();
          engine.frame(dt);
          stage.renderer.render?.(stage.scene, stage.camera);
          return { ms: performance.now() - t0 };
        },
        getClusters: () => e()?.getClusters() ?? [],
        getMeta: () => e()?.getMeta(),
        getBreadcrumbs: () => crumbsOf(),
        getConstellations() {
          const mm = m();
          const list = (e()?.getMeta() as { constellations?: { id: string; label: string; members: number[] }[] } | undefined)?.constellations;
          return Array.isArray(list) ? list.map((c) => ({ id: c.id, label: c.label, members: c.members.map((i) => mm.graph.nodes[i]?.id).filter((x): x is string => !!x) })) : [];
        },
        selectConstellation(id, opts) {
          const list = (e()?.getMeta() as { constellations?: { id: string }[] } | undefined)?.constellations ?? [];
          if (id !== null && !list.some((c) => c.id === id)) return false;
          selectConstellation(id, { source: opts?.source ?? "api" });
          return true;
        },
        getState() {
          const mm = m();
          return {
            constellation: constellationRef.current ?? null,
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
          return stage.canvas.closest<HTMLElement>("[data-fancy-graph]") ?? stage.canvas.parentElement;
        },
      };
    },
    [stage],
  );

  // The controls overlay sits in the stage's overlay root, above the canvas: its clicks never reach the picker.
  const controls = renderControls(props.controls, model, animated, fs.controls);
  return controls ? createPortal(controls, stage.overlayRoot) : null;
}

/** Layers for a 3D view whose preset declares none: links and labels, plus whatever slots and tags its renderers fill. */
function layersOf(renderers: GraphRenderers3D, clusters: boolean): GraphLayerSpec[] {
  const out: GraphLayerSpec[] = [];
  const list = (x: GraphRenderers3D[keyof GraphRenderers3D]) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const seen = new Set<string>();
  const add = (id: string, label: string) => {
    if (seen.has(id) || id === "nodes") return;
    seen.add(id);
    out.push({ id, label });
  };
  if (list(renderers.background).length) add("background", "Background");
  if (clusters || list(renderers.cluster).length) add("clusters", "Clusters");
  for (const l of [...list(renderers.background), ...list(renderers.cluster), ...list(renderers.link), ...list(renderers.node)]) if (l.layer) add(l.layer, l.layer);
  for (const d of DEFAULT_LAYERS) add(d.id, d.label);
  return out;
}

/** The 3D graph inside a fancy-3d-three `<Stage>`. Renders nothing in React; it draws into the stage. */
export function GraphScene3D(props: GraphScene3DProps) {
  const stage = useStage() as unknown as StageLike;
  return <GraphSceneOnStage {...props} stage={stage} />;
}

export interface GraphView3DProps extends GraphScene3DProps {
  /** Canvas clear colour. Defaults to the theme's background. */
  clearColor?: string;
}

/**
 * A complete 3D graph view: a fancy-3d-three `<Stage>` (renderer, camera,
 * OrbitControls, frame loop) with the graph mounted on it. Needs `three` and
 * `@particle-academy/fancy-3d-three` installed; the 2D `<GraphView>` needs
 * neither.
 */
export function GraphView3D({ clearColor, className, style, overlay, ...props }: GraphView3DProps) {
  // Full screen takes this root, so the Stage (canvas, labels, controls) and the overlay come along.
  // The Stage inside sees this controller and defers to it.
  const rootRef = useRef<HTMLDivElement>(null);
  const own = useOwnFullscreen(rootRef, props);
  // The scene writes the live counts and selection onto this element; see GraphSceneOnStage.
  return (
    <FullscreenContext.Provider value={own.controller}>
    <div ref={rootRef} className={className} style={{ position: "relative", overflow: "hidden", ...style }} data-fancy-graph="" data-fancy-graph-renderer="3d">
      <Stage
        bare
        cameraRadius={3000}
        cameraTarget={[0, 0, 0]}
        clearColor={clearColor ?? "#02030a"}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        fullscreenButton={false}
        overlay={overlay}
      >
        <GraphScene3D applyThemeBackground={clearColor === undefined} {...props} fullscreenAsked={own.asked} />
      </Stage>
      {showsOwnButton(props) && <FullscreenButton controller={own.controller} />}
    </div>
    </FullscreenContext.Provider>
  );
}
