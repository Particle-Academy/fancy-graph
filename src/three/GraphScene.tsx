import { Stage, useStage } from "@particle-academy/fancy-3d-three/react";
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from "react";
import type { Camera3D } from "../camera";
import { forceLayout } from "../layout/force";
import type { GraphLayout } from "../layout/contract";
import type { GraphViewHandleBase } from "../react/GraphView";
import { useGraphModel, type GraphViewBaseProps } from "../react/model";
import { neighborLinks } from "../interaction";
import { effectiveFocus, freshCycle, stepFocusIndex, type PendingFocus } from "../react/navigation";
import type { GraphCluster, GraphNode, Vec3 } from "../types";
import { StageEngine, type ClusterSource3D, type Engine3DOptions } from "./engine";
import type { GraphRenderers3D, StageLike } from "./types";

export interface GraphScene3DHandle extends GraphViewHandleBase {
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
  /** A layout function or stepper; it is given 3 dimensions. Defaults to a 3D force layout. */
  layout?: GraphLayout;
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
  /** Direction of the home view, radians. Defaults 0.75 / 0.55. */
  homeYaw?: number;
  homePitch?: number;
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
  const model = useGraphModel(props);
  const { graph, limits } = model;
  const engineRef = useRef<StageEngine | null>(null);
  const latest = useRef({ props, model });
  latest.current = { props, model };
  const defaultLayout = useMemo(() => forceLayout({ linkDistance: 24 }), []);
  const layout = props.layout ?? defaultLayout;

  const options = (): Engine3DOptions => {
    const { props: p, model: m } = latest.current;
    return {
      renderers: p.renderers ?? {},
      clusters: p.clusters,
      clusterLabel: p.clusterLabel,
      nodeColor: p.nodeColor ? (i, meta) => p.nodeColor!(m.graph.nodes[i], i, meta) : undefined,
      nodeSize: p.nodeSize ? (i, meta) => p.nodeSize!(m.graph.nodes[i], i, meta) : undefined,
      labelOf: m.labelOf,
      linkVisibility: p.linkVisibility ?? "all",
      paused: !!p.paused,
      homeYaw: p.homeYaw ?? 0.75,
      homePitch: p.homePitch ?? 0.55,
    };
  };

  useLayoutEffect(() => {
    const engine = new StageEngine(
      stage,
      latest.current.model.limits,
      options(),
      {
        onSelect: (i) => {
          const m = latest.current.model;
          const id = i >= 0 ? m.graph.nodes[i].id : null;
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
  useLayoutEffect(() => {
    engineRef.current?.setOptions(options());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.renderers, props.clusters, props.clusterLabel, props.nodeColor, props.nodeSize, model.labelOf, props.linkVisibility, props.paused, props.homeYaw, props.homePitch, stage]);
  useLayoutEffect(() => {
    engineRef.current?.setGraph(graph, layout);
  }, [graph, layout, stage]);
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
  useLayoutEffect(() => {
    if (flyOnSelect && model.selectedIndex >= 0) engineRef.current?.flyToIndex(model.selectedIndex);
  }, [flyOnSelect, model.selectedIndex, stage]);
  const camKey = props.camera ? JSON.stringify(props.camera) : "";
  useLayoutEffect(() => {
    const c = latest.current.props.camera;
    if (c) engineRef.current?.setCamera(c);
  }, [camKey]);

  // Stable handles on the enclosing [data-fancy-graph] (GraphView3D's root), and an accessible name on the canvas.
  const ariaName = `${props["aria-label"] ?? "Graph"}: ${graph.nodes.length} nodes, ${graph.links.length} links`;
  useLayoutEffect(() => {
    const root = stage.canvas.closest<HTMLElement>("[data-fancy-graph]");
    if (root) {
      root.dataset.fancyGraphNodeCount = String(graph.nodes.length);
      root.dataset.fancyGraphLinkCount = String(graph.links.length);
      root.dataset.fancyGraphSelected = model.selectedId ?? "";
      root.dataset.fancyGraphHovered = model.hoveredId ?? "";
      root.dataset.fancyGraphFocused = model.focusedId ?? "";
      root.dataset.fancyGraphMatches = String(model.matchIds.length);
    }
    stage.canvas.setAttribute("aria-label", ariaName);
    stage.canvas.setAttribute("role", "img");
    stage.canvas.setAttribute("data-fancy-graph-canvas", "");
  }, [stage, graph, model.selectedId, model.hoveredId, model.focusedId, model.matchIds, ariaName]);

  useImperativeHandle(
    props.ref,
    (): GraphScene3DHandle => {
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
          return stage.canvas.closest<HTMLElement>("[data-fancy-graph]") ?? stage.canvas.parentElement;
        },
      };
    },
    [stage],
  );

  return null;
}

/** The 3D graph inside a fancy-3d-three `<Stage>`. Renders nothing in React; it draws into the stage. */
export function GraphScene3D(props: GraphScene3DProps) {
  const stage = useStage() as unknown as StageLike;
  return <GraphSceneOnStage {...props} stage={stage} />;
}

export interface GraphView3DProps extends GraphScene3DProps {
  /** Canvas clear colour. Default near-black. */
  clearColor?: string;
}

/**
 * A complete 3D graph view: a fancy-3d-three `<Stage>` (renderer, camera,
 * OrbitControls, frame loop) with the graph mounted on it. Needs `three` and
 * `@particle-academy/fancy-3d-three` installed; the 2D `<GraphView>` needs
 * neither.
 */
export function GraphView3D({ clearColor = "#02030a", className, style, ...props }: GraphView3DProps) {
  // The scene writes the live counts and selection onto this element; see GraphSceneOnStage.
  return (
    <div className={className} style={{ position: "relative", overflow: "hidden", ...style }} data-fancy-graph="" data-fancy-graph-renderer="3d">
      <Stage bare cameraRadius={3000} cameraTarget={[0, 0, 0]} clearColor={clearColor} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <GraphScene3D {...props} />
      </Stage>
    </div>
  );
}
