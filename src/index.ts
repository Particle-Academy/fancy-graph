/**
 * @particle-academy/fancy-graph — a knowledge-graph map viewer.
 *
 * This entry is React + the headless core, with a 2D canvas renderer. It never
 * imports three; the 3D renderer is `@particle-academy/fancy-graph/three`.
 */
// The core is re-exported module by module (not `export * from "./core"`), so the
// bundler does not emit an empty shared chunk for core.ts. tests/entry-isolation.test.ts
// holds the two lists equal.
export type { GraphActivity, GraphActivitySource, GraphCluster, GraphData, GraphLink, GraphNode, IndexedGraph, IndexedLink, Vec3 } from "./types";
export { DEFAULT_LIMITS, resolveLimits, truncateLabel, type GraphLimits } from "./limits";
export { normalizeGraph } from "./graph";
export { hash01, seeded } from "./random";
export {
  computeLinkStates,
  computeNodeStates,
  cycleNeighbor,
  focusOf,
  hasHighlightRing,
  neighborLinks,
  stepInDirection,
  type NeighborLink,
  type ScreenDirection,
  type StepDirection,
  LINK_ACTIVE,
  LINK_DIMMED,
  LINK_NORMAL,
  NODE_ACTIVE,
  NODE_DIMMED,
  NODE_NEIGHBOR,
  NODE_NORMAL,
  pickScreen,
  searchNodes,
  type FocusInput,
  type LinkState,
  type NodeState,
  type PickOptions,
  type SearchOptions,
} from "./interaction";
export { labelCandidates, LabelLayer, placeLabels, type CandidateInput, type ClusterLabel, type LabelCandidate, type PlacedLabel, type PlaceOptions } from "./labels";
export {
  clampCamera2D,
  fitCamera2D,
  lerpCamera2D,
  orbitFrom,
  orbitPosition,
  screenToWorld2D,
  worldToScreen2D,
  zoomAt2D,
  type Camera2D,
  type Camera3D,
} from "./camera";
export { groupClusters } from "./clusters";
export { createLayoutRunner, type GraphLayout, type GraphLayoutFunction, type GraphLayoutStepper, type LayoutEnv, type LayoutFrame, type LayoutRunner } from "./layout/contract";
export { forceLayout, type ForceLayoutOptions } from "./layout/force";
export { hierarchyLayout, radialLayout, type HierarchyLayoutOptions, type RadialLayoutOptions } from "./layout/static";
export {
  builtinLayout,
  workerLayout,
  type BuiltinLayoutSpec,
  type FromWorker,
  type LayoutWorkerLike,
  type ToWorker,
  type WorkerGraph,
  type WorkerLayoutOptions,
} from "./layout/worker-layout";
export { colorFor, parseColor, DEFAULT_PALETTE } from "./color";
export { DARK_THEME, LIGHT_THEME, applyThemeVars, cssVar, resolveTheme, typeColor, type GraphTheme, type GraphThemeInput } from "./theme";
export { GraphView, type GraphViewHandle, type GraphViewHandleBase, type GraphViewProps, type GraphViewState } from "./react/GraphView";
export { useGraphModel, useReducedMotion, type ChangeMeta, type GraphModel, type GraphViewBaseProps } from "./react/model";
export type { ClusterSource } from "./render2d/engine";
export {
  GRAPH_PRESETS_2D,
  clusteredPreset,
  hierarchyPreset,
  networkPreset,
  radialPreset,
  resolvePreset2D,
  type GraphPreset2D,
  type GraphPreset2DId,
  type PresetState,
} from "./presets/presets2d";
export type {
  BackgroundDraw2D,
  BackgroundRenderer2D,
  ClusterDraw2D,
  ClusterRenderer2D,
  GraphRenderers2D,
  LinkDraw2D,
  LinkRenderer2D,
  NodeDraw2D,
  NodeRenderer2D,
} from "./render2d/types";
