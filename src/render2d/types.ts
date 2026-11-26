import type { Camera2D } from "../camera";
import type { NodeState, LinkState } from "../interaction";
import type { GraphCluster, GraphNode, IndexedLink } from "../types";

/** Everything a 2D node renderer needs. Coordinates are CSS px on the canvas. */
export interface NodeDraw2D {
  index: number;
  node: GraphNode;
  x: number;
  y: number;
  /** Projected radius, px. */
  radius: number;
  color: string;
  state: NodeState;
  selected: boolean;
  hovered: boolean;
  /** The keyboard / gamepad focus. The default look draws a dashed ring. */
  focused: boolean;
  zoom: number;
  time: number;
  /** Whatever the layout exposed as `meta`. */
  meta: unknown;
}

export interface LinkDraw2D {
  index: number;
  link: IndexedLink;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  state: LinkState;
  zoom: number;
  meta: unknown;
}

export interface ClusterDraw2D {
  cluster: GraphCluster;
  x: number;
  y: number;
  radius: number;
  zoom: number;
  meta: unknown;
}

export interface BackgroundDraw2D {
  width: number;
  height: number;
  camera: Camera2D;
  time: number;
  pixelRatio: number;
  meta: unknown;
}

export type NodeRenderer2D = (ctx: CanvasRenderingContext2D, d: NodeDraw2D) => void;
export type LinkRenderer2D = (ctx: CanvasRenderingContext2D, d: LinkDraw2D) => void;
export type ClusterRenderer2D = (ctx: CanvasRenderingContext2D, d: ClusterDraw2D) => void;
export type BackgroundRenderer2D = (ctx: CanvasRenderingContext2D, d: BackgroundDraw2D) => void;

/** Replace any part of the 2D look. Anything omitted uses the kit default. */
export interface GraphRenderers2D {
  node?: NodeRenderer2D;
  link?: LinkRenderer2D;
  cluster?: ClusterRenderer2D;
  background?: BackgroundRenderer2D;
}
