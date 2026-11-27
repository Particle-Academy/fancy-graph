/**
 * @particle-academy/fancy-graph/three — the 3D renderer, on fancy-3d-three's
 * <Stage>. This is the only entry that imports `three`; install `three` and
 * `@particle-academy/fancy-3d-three` to use it.
 */
export { GraphScene3D, GraphSceneOnStage, GraphView3D, type GraphScene3DHandle, type GraphScene3DProps, type GraphSceneOnStageProps, type GraphView3DProps } from "./GraphScene";
export { StageEngine, type ClusterSource3D, type Engine3DOptions } from "./engine";
export {
  createInstancedLayer,
  createLayerMaterial,
  createPointsLayer,
  linkLayer3D,
  nodeLayer3D,
  quadGeometry,
  ringState,
  type Blending3D,
  type InstancedLayerSpec,
  type KitUniforms,
  type LinkLayer3DOptions,
  type NodeLayer3DOptions,
  type PointsLayerSpec,
  type ShaderMaterialSpec,
} from "./layers";
export type { GraphLayer3D, GraphRenderers3D, LayerContext3D, LayerFrame3D, OrbitControlsLike, StageLike } from "./types";
export {
  GRAPH_PRESETS_3D,
  cosmosPreset,
  layeredPreset,
  network3DPreset,
  resolvePreset3D,
  type GraphPreset3D,
  type GraphPreset3DId,
} from "./presets/presets3d";
export { ASTEROID, PLANET, STAR, cosmosLayout, spiralPoint, type BodyKind, type CosmosBody, type CosmosGalaxy, type CosmosLayoutOptions, type CosmosMeta } from "./presets/cosmos-layout";
export { cosmosDefaults, cosmosLayers, cosmosOrbits, cosmosRenderers, type CosmosOrbitOptions, type CosmosRenderOptions } from "./presets/cosmos-renderers";
export type { GraphControlsProps } from "../react/controls";
export { layeredLayout, layerPlanes, type LayerBy, type LayeredLayoutOptions } from "./presets/layered";
