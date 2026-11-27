/**
 * The headless core: no React, no three. Safe in a Worker, in Node, and in any
 * renderer an app writes for itself.
 */
export type { GraphActivity, GraphActivitySource, GraphCluster, GraphData, GraphLink, GraphNode, IndexedGraph, IndexedLink, Vec3 } from "./types";
export { DEFAULT_LIMITS, resolveLimits, truncateLabel, type GraphLimits } from "./limits";
export { normalizeGraph } from "./graph";
export { DEFAULT_LAYERS, effectiveLinkVisibility, isLayerVisible, layerMap, mergeLayerSpecs, resolveLayers, type GraphLayerSpec, type GraphLayerState, type GraphLayerVisibility, type LinkVisibility } from "./layers";
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
export { DARK_THEME, LIGHT_THEME, applyThemeVars, cssVar, resolveTheme, assignTypeColors, typeColor, typeColorsFor, type GraphTheme, type GraphThemeInput } from "./theme";
