/** A point or direction in world space. 2D layouts leave z at 0. */
export type Vec3 = [number, number, number];

/**
 * A node, as plain JSON. Only `id` is required. Everything an app wants to
 * carry for its own renderers goes in `data`; the kit never reads it.
 */
export interface GraphNode {
  id: string;
  /** Shown as TEXT, never HTML. Defaults to the id. */
  label?: string;
  /** Used for default colours and for `clusters="group"`. */
  group?: string;
  /** World-space radius. Defaults to a size derived from the node's degree. */
  size?: number;
  /** Any CSS colour the renderer can parse (`#rrggbb` works everywhere). */
  color?: string;
  /** Seed position. With `fixed`, the node is pinned there. */
  x?: number;
  y?: number;
  z?: number;
  fixed?: boolean;
  /** Where this node sits in the 3D `cosmos` preset, and how it looks there. Optional; other views ignore it. */
  cosmos?: GraphCosmosFields;
  /** Made by a view, not by the data: the cosmos's centres for a field value. Left out of degree ranking. */
  synthetic?: boolean;
  data?: Record<string, unknown>;
}

/** A body's surface in the `cosmos` preset. A procedural shader, never an image unless `texture` names one. */
export type GraphCosmosSkinName = "rocky" | "gas" | "ice" | "cratered" | "lava" | "ocean";

/**
 * How a node looks in the `cosmos` preset, as plain JSON. Every field is
 * optional; the preset supplies a default for each body kind. A bad value is
 * ignored and reported in the layout's `meta.lookIssues`, never thrown.
 */
export interface GraphCosmosLook {
  /** A procedural surface, by name or with its colours (one or two CSS colours). */
  skin?: GraphCosmosSkinName | { type: GraphCosmosSkinName; colors?: string[] };
  /** An image the HOST supplies (https, http, a relative path, `data:image/...` or `blob:`), mapped onto the sphere. The kit bundles none. */
  texture?: string;
  /** A glowing shell. `true` takes the default for the body. */
  atmosphere?: boolean | { color?: string; /** 0 to 1, of the radius. */ thickness?: number; /** 0 to 2. */ glow?: number };
  /** A ring system. `inner` and `outer` are multiples of the radius. */
  rings?: boolean | { color?: string; inner?: number; outer?: number; /** Radians the ring tips toward the viewer. */ tilt?: number; /** 0 to 1. */ opacity?: number };
}

/** The `cosmos` field: placement and look, both optional. */
export type GraphCosmosFields = GraphCosmosPlacement & GraphCosmosLook;

/**
 * Optional placement for the `cosmos` 3D preset, as plain JSON. Absent, the
 * procedural layout decides. A bad value (not finite numbers, the wrong
 * length, past `limits.maxPlacement`) is ignored with one dev-mode warning and
 * listed in the layout's `meta.placementIssues`; it never throws.
 */
export interface GraphCosmosPlacement {
  /**
   * Where this node's galaxy core sits, `[x, y, z]` in world units (the graph
   * centre is the origin). A pinned galaxy stays there instead of orbiting the
   * centre. Set it on any member; if members disagree, the first valid one in
   * id order wins and the rest are reported.
   */
  galaxy?: [number, number, number];
  /**
   * Where this node sits relative to its galaxy core, in the galaxy's disc:
   * `[x, y]` in the disc plane or `[x, y, z]` with z out of it, world units.
   * The node turns with its galaxy and no longer orbits a star. Outside any
   * galaxy it is relative to its star instead; with neither, it is reported.
   */
  offset?: [number, number] | [number, number, number];
}

export interface GraphLink {
  id?: string;
  source: string;
  target: string;
  /** Defaults to 1. Used by layouts, and to keep the strongest links when capped. */
  weight?: number;
  kind?: string;
  /** Made by a view (the cosmos's gravity to a synthetic centre), not by the data. */
  synthetic?: boolean;
  data?: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface IndexedLink {
  /** Position in `IndexedGraph.links`. */
  index: number;
  a: number;
  b: number;
  weight: number;
  link: GraphLink;
}

/** A graph after validation, with indices instead of ids. Built by `normalizeGraph`. */
export interface IndexedGraph {
  nodes: GraphNode[];
  links: IndexedLink[];
  index: Map<string, number>;
  /** Sum of link weights per node. */
  degree: Float64Array;
  /** Unique neighbour indices per node. */
  neighbors: number[][];
  /** Link indices touching each node. */
  incident: number[][];
  dropped: {
    /** Nodes beyond `limits.maxNodes`. */
    nodes: number;
    /** Valid links beyond `limits.maxLinks` (the weakest are dropped). */
    links: number;
    /** Links to a missing node, self-links, and malformed links. */
    invalidLinks: number;
    duplicateNodes: number;
  };
}

/**
 * A group of nodes drawn as one thing: a galaxy, a community, a hull. Either a
 * layout supplies them (`GraphLayoutStepper.clusters`) or the view computes them
 * from `clusters="group"`.
 */
export interface GraphCluster {
  id: string;
  label?: string;
  center: Vec3;
  radius: number;
  /** Indices of member nodes. */
  members: number[];
  color?: string;
  /** For flat clusters in 3D (a galaxy disc): the plane's normal. */
  normal?: Vec3;
  data?: Record<string, unknown>;
}

/** Where a change came from. Agents act through `"agent"`; the kit never guesses. */
export type GraphActivitySource = "user" | "agent" | "api";

export interface GraphActivity {
  /**
   * `"layer"`: a layer was switched (`id` is the layer's id). `"links"`: the
   * link visibility mode changed (`id` is the mode). `"motion"`: animation was
   * paused or resumed (`id` is `"paused"` or `"running"`). `"constellation"`:
   * a constellation was selected (`id`) or cleared (`null`). `"fullscreen"`:
   * the view entered (`id` `"on"`) or left (`"off"`) full screen.
   */
  type: "select" | "hover" | "focus" | "camera" | "search" | "layer" | "links" | "motion" | "constellation" | "fullscreen";
  id?: string | null;
  source: GraphActivitySource;
  at: number;
  /** Set on a select / hover / focus whose `id` is a view's synthetic node (a cosmos galaxy core), not an input node. */
  synthetic?: true;
}
