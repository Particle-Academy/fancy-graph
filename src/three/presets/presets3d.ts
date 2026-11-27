import { forceLayout, type ForceLayoutOptions } from "../../layout/force";
import type { GraphLayout } from "../../layout/contract";
import type { PresetState } from "../../presets/presets2d";
import type { GraphCluster, GraphNode } from "../../types";
import { DEFAULT_LAYERS, type GraphLayerSpec } from "../../layers";
import { linkLayer3D, nodeLayer3D } from "../layers";
import type { GraphRenderers3D } from "../types";
import { cosmosLayout, type CosmosLayoutOptions } from "./cosmos-layout";
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

/** The cosmos: galaxies per node type, stars, orbiting planets and asteroids. The reference example of how far the plug points go. */
export function cosmosPreset(options: CosmosLayoutOptions & CosmosRenderOptions = {}): GraphPreset3D {
  return {
    id: "cosmos",
    title: "Cosmos",
    description: "Each node type is a spiral galaxy; the best-connected nodes are stars, linked nodes orbit them as planets, unlinked ones drift as asteroids, under a seeded sky.",
    layout: () => cosmosLayout(options),
    renderers: () => cosmosRenderers(options),
    ...cosmosDefaults,
    layers: cosmosLayers(),
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
