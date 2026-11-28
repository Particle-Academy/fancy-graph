import { forceLayout, type ForceLayoutOptions } from "../../layout/force";
import type { GraphLayout } from "../../layout/contract";
import type { PresetState } from "../../presets/presets2d";
import type { GraphCluster, GraphData, GraphNode } from "../../types";
import { DEFAULT_LAYERS, type GraphLayerSpec } from "../../layers";
import { linkLayer3D, nodeLayer3D } from "../layers";
import type { GraphRenderers3D } from "../types";
import { cosmosLayout, prepareCosmos, withLenses, type CosmosLayoutOptions, type CosmosLenses } from "./cosmos-layout";
import { cosmosDefaults, cosmosLayers, cosmosRenderers, type CosmosRenderOptions } from "./cosmos-renderers";
import { layeredLayout, layerPlanes, type LayeredLayoutOptions } from "./layered";

/**
 * A ready-made 3D view: a layout, a look and the defaults that go with them.
 * `renderers` is a FACTORY: 3D layers own GPU state, so every view gets its
 * own. Pass a preset (or its id) as `preset`; any prop you also pass
 * overrides that piece.
 */
export interface GraphPreset3D {
  id: string;
  title: string;
  description: string;
  layout: (state: PresetState) => GraphLayout;
  layoutKey?: (state: PresetState) => string;
  renderers?: () => GraphRenderers3D;
  nodeSize?: (node: GraphNode, index: number, meta: unknown) => number;
  clusterLabel?: (cluster: GraphCluster) => string | null;
  linkVisibility?: "all" | "focus" | "none";
  /**
   * The layers this preset draws, for `layers` / `onLayersChange` and the
   * controls. A 3D layer is matched by its `layer` tag, else its slot
   * (`background`, `clusters`, `links`; nodes never hide). Default: links and labels.
   */
  layers?: GraphLayerSpec[];
  homeYaw?: number;
  homePitch?: number;
  /**
   * Runs on the data before it is validated, so a preset can add nodes of its
   * own (the cosmos's synthetic centres). Its output counts against the limits.
   */
  prepare?: (data: GraphData) => GraphData;
  /**
   * The same preset with these options (JSON), for a prop that configures it
   * in place: `<GraphView3D preset="cosmos" cosmos={...}>` calls this.
   */
  configure?: (options: CosmosLenses) => GraphPreset3D;
  /** Seconds a layout change animates, bodies flying from their old positions to their new ones. 0 or absent: instant. */
  transition?: number;
  /**
   * Semantic zoom: per node, the world-space size of what its label names (a
   * system, an orbit). Labels then compete by that size on screen
   * (`limits.zoomLabelPx`); `Infinity` always competes, a negative never does.
   */
  labelReach?: (index: number, meta: unknown) => number;
  /** The world radius selecting a node frames (a star's whole system), or null for the default. */
  frameRadius?: (index: number, meta: unknown) => number | null;
  /** The breadcrumb path to a node, outermost first, ending with the node. */
  path?: (index: number, meta: unknown) => number[];
  /** Layers the preset knows only once the layout has run (one per constellation). */
  layersFor?: (meta: unknown) => GraphLayerSpec[];
}

/** A 3D force network: lit spheres and lines. The default. */
export function network3DPreset(options: ForceLayoutOptions = {}): GraphPreset3D {
  return {
    id: "network",
    title: "Network (3D)",
    description: "A force-directed network in 3D: lit spheres for nodes, lines for links, orbit and zoom to read structure the 2D view flattens.",
    layout: () => forceLayout({ linkDistance: 24, gravity: 0.05, ...options }),
    renderers: () => ({ link: linkLayer3D(), node: nodeLayer3D() }),
    layers: [...DEFAULT_LAYERS],
  };
}

/**
 * The cosmos: gravity places, light draws. Systems (a star, its planets and
 * their moons) always orbit; galaxies are optional; free systems are spread by
 * their light links; comets travel between systems; constellations are drawn
 * over the sky. Configure it with lenses, here or through the `cosmos` prop.
 * Default: `systems: { by: "hubs" }`, no galaxies, travellers on.
 */
export function cosmosPreset(options: CosmosLayoutOptions & CosmosRenderOptions = {}): GraphPreset3D {
  const { labelReach, ...defaults } = cosmosDefaults;
  return {
    id: "cosmos",
    title: "Cosmos",
    description: "Gravity places, light draws: stars with orbiting planets and moons, optional spiral galaxies, free systems spread by their links, comets travelling between systems and constellations over a seeded sky.",
    layout: () => cosmosLayout(options),
    renderers: () => cosmosRenderers(options),
    prepare: (data) => prepareCosmos(data, options),
    configure: (lenses) => cosmosPreset(withLenses(options, lenses ?? {})),
    ...defaults,
    labelReach: options.labels === "size" ? undefined : labelReach,
    layers: cosmosLayers(options),
  };
}

/** Layers by type or by a time field: horizontal planes stacked top to bottom, links crossing between them. */
export function layeredPreset(options: LayeredLayoutOptions = {}): GraphPreset3D {
  return {
    id: "layered",
    title: "Layered",
    description: "Horizontal planes stacked top to bottom, one per node type (or per bucket of a date or number field), with links crossing between them, so flows and timelines read downward.",
    layout: () => layeredLayout(options),
    renderers: () => ({ cluster: layerPlanes(), link: linkLayer3D(), node: nodeLayer3D() }),
    clusterLabel: (c) => `${c.label ?? c.id} · ${c.members.length}`,
    layers: [...DEFAULT_LAYERS, { id: "clusters", label: "Planes" }],
    homeYaw: 0.6,
    homePitch: 0.5,
  };
}

/** Every built-in 3D preset, by id. `network` is the default. */
export const GRAPH_PRESETS_3D: Readonly<Record<"network" | "cosmos" | "layered", GraphPreset3D>> = Object.freeze({
  network: network3DPreset(),
  cosmos: cosmosPreset(),
  layered: layeredPreset(),
});

export type GraphPreset3DId = keyof typeof GRAPH_PRESETS_3D;

export function resolvePreset3D(preset: GraphPreset3DId | string | GraphPreset3D | undefined): GraphPreset3D {
  if (preset === undefined) return GRAPH_PRESETS_3D.network;
  if (typeof preset === "object") return preset;
  const found = (GRAPH_PRESETS_3D as Record<string, GraphPreset3D>)[preset];
  if (!found) throw new Error(`Unknown fancy-graph 3D preset "${preset}". Built in: ${Object.keys(GRAPH_PRESETS_3D).join(", ")}.`);
  return found;
}
