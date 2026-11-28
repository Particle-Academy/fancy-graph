import type * as THREE from "@particle-academy/fancy-3d-three/three";
import type { GraphLimits } from "../limits";
import type { GraphCluster, IndexedGraph } from "../types";

/** The parts of OrbitControls the kit drives. fancy-3d-three's Stage exposes one as `controls`. */
export interface OrbitControlsLike {
  target: THREE.Vector3;
  update(): unknown;
  enabled?: boolean;
  minDistance?: number;
  maxDistance?: number;
}

/**
 * The shape of fancy-3d-three's Stage context (`useStage()`). `controls` is
 * the additive handle; on a Stage without it (fancy-3d-three 0.2.1) the kit
 * finds the orbit target through the `camera.lookAt(controls.target)` call the
 * Stage makes every frame.
 */
export interface StageLike {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  onFrame(cb: () => void): () => void;
  controls?: OrbitControlsLike;
}

/** What a layer gets once, when it mounts. Add objects to `group`; the kit removes the group on unmount. */
export interface LayerContext3D {
  /** This layer's own group (one per layer, so a layer can be hidden alone). */
  group: THREE.Group;
  /** Draw order slot: background 0, cluster 1, link 2, node 3. */
  renderOrder: number;
  graph: IndexedGraph;
  meta: unknown;
  clusters: GraphCluster[];
  camera: THREE.PerspectiveCamera;
  /** 3 floats (0..1 rgb) per node, as the theme and nodeColor resolved them. */
  colors: Float32Array;
  /** The view's limits (the cosmos reads its comet tail length from them). */
  limits?: GraphLimits;
}

/** What a layer gets every frame. Positions are live: animated layouts move them every frame. */
export interface LayerFrame3D {
  graph: IndexedGraph;
  /** 3 floats per node, world space. */
  positions: Float32Array;
  /** Node indices sorted back to front (farthest first), for correct blending. */
  order: Uint32Array;
  /** NODE_* state per node. */
  states: Uint8Array;
  /** LINK_* state per link. */
  linkStates: Uint8Array;
  /** World radius per node. */
  sizes: Float32Array;
  /** 3 floats (0..1 rgb) per node. */
  colors: Float32Array;
  clusters: GraphCluster[];
  time: number;
  dt: number;
  /** Viewport in CSS px. */
  width: number;
  height: number;
  pixelRatio: number;
  camera: THREE.PerspectiveCamera;
  meta: unknown;
  focus: number;
  /** The keyboard / gamepad focus (-1 for none). Draw it apart from the selection. */
  focused: number;
  selected: number;
  hovered: number;
  matches: ReadonlySet<number> | null;
  linkVisibility: "all" | "focus" | "none";
  /** Layer visibility by id (a missing id is visible), for layers that draw parts with their own switches. */
  layers?: Partial<Record<string, boolean>>;
  /** The selected constellation's id, or null. */
  constellation?: string | null;
}

/** A pluggable piece of the 3D scene: the background, the clusters, the links or the nodes. */
export interface GraphLayer3D {
  /**
   * Which visibility layer this is (`layers` prop). Defaults to its slot:
   * `background`, `clusters`, `links`, or `nodes` (never hidden). The cosmos's
   * orbit paths say `"orbits"`. A hidden layer's group is invisible and its
   * `update` is not called.
   */
  layer?: string;
  mount(ctx: LayerContext3D): void;
  update(frame: LayerFrame3D): void;
  dispose(): void;
}

type OneOrMany<T> = T | T[];

/** Replace any part of the 3D look. Omitted slots use the defaults (no background, no clusters, lines, impostor spheres). */
export interface GraphRenderers3D {
  background?: OneOrMany<GraphLayer3D>;
  cluster?: OneOrMany<GraphLayer3D>;
  link?: OneOrMany<GraphLayer3D>;
  node?: OneOrMany<GraphLayer3D>;
}
