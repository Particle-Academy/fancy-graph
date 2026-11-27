import type { GraphLayout } from "../layout/contract";
import { forceLayout, type ForceLayoutOptions } from "../layout/force";
import { hierarchyLayout, radialLayout, type HierarchyLayoutOptions, type RadialLayoutOptions } from "../layout/static";
import type { ClusterSource } from "../render2d/engine";
import type { GraphRenderers2D } from "../render2d/types";
import type { GraphCluster, IndexedGraph } from "../types";
import { DEFAULT_LAYERS, type GraphLayerSpec } from "../layers";

/** Links and labels, plus a layer for the cluster hulls. */
const WITH_CLUSTERS: GraphLayerSpec[] = [...DEFAULT_LAYERS, { id: "clusters", label: "Clusters" }];

/** What a preset's layout may depend on. A change of `layoutKey` re-runs the layout. */
export interface PresetState {
  graph: IndexedGraph;
  selected: string | null;
  focused: string | null;
}

/**
 * A ready-made 2D view: a layout plus renderers plus defaults. Pass one (or its
 * id) as `preset`; any prop you also pass (`layout`, `renderers.node`,
 * `clusters`, ...) overrides that piece and keeps the rest.
 */
export interface GraphPreset2D {
  id: string;
  title: string;
  description: string;
  layout: (state: PresetState) => GraphLayout;
  /** When it changes, the layout is rebuilt (e.g. the radial view's centre). Default: never. */
  layoutKey?: (state: PresetState) => string;
  renderers?: GraphRenderers2D;
  clusters?: ClusterSource;
  clusterLabel?: (cluster: GraphCluster) => string | null;
  linkVisibility?: "all" | "focus" | "none";
  /** The layers this preset draws, for `layers` / `onLayersChange` and the controls. Default: links and labels. */
  layers?: GraphLayerSpec[];
}

/** A force-directed network: the default view. */
export function networkPreset(options: ForceLayoutOptions = {}): GraphPreset2D {
  return {
    id: "network",
    title: "Network",
    description: "A force-directed network: linked nodes pull together, everything else spreads out. The default view for any graph.",
    layout: () => forceLayout({ gravity: 0.05, ...options }),
    layers: [...DEFAULT_LAYERS],
  };
}

/** An ego view: the focused node (else the selection, else the best-connected node) at the centre, neighbours on rings by distance. */
export function radialPreset(options: Omit<RadialLayoutOptions, "root"> = {}): GraphPreset2D {
  const centre = (s: PresetState) => s.focused ?? s.selected ?? "";
  return {
    id: "radial",
    title: "Radial (ego)",
    description: "An ego view centred on the focused node, else the selection: its neighbours on the first ring, theirs on the next, re-centred whenever the centre moves.",
    layout: (s) => radialLayout({ ...options, ringGap: options.ringGap ?? 90, root: centre(s) || undefined }),
    layoutKey: centre,
    layers: [...DEFAULT_LAYERS],
  };
}

/** A layered tree for directed links: roots on top, children below their parents. */
export function hierarchyPreset(options: HierarchyLayoutOptions = {}): GraphPreset2D {
  return {
    id: "hierarchy",
    title: "Hierarchy",
    description: "A layered tree for directed links (source above target): roots on top, each child under its parents, crossings reduced. Cycles are broken, not looped.",
    layout: () => hierarchyLayout({ layerGap: 90, nodeGap: 46, ...options }),
    layers: [...DEFAULT_LAYERS],
  };
}

/** A clustered map: a force layout that gathers each node type, with a labelled hull per type. */
export function clusteredPreset(options: ForceLayoutOptions = {}): GraphPreset2D {
  return {
    id: "clustered",
    title: "Clustered map",
    description: "A map grouped by node type: each type gathers into its own region with a labelled hull, links still drawn across regions.",
    layout: () => forceLayout({ groupPull: 0.3, gravity: 0.05, ...options }),
    clusters: "group",
    clusterLabel: (c) => `${c.label ?? c.id} · ${c.members.length}`,
    layers: WITH_CLUSTERS,
  };
}

/** Every built-in 2D preset, by id. `network` is the default. */
export const GRAPH_PRESETS_2D: Readonly<Record<"network" | "radial" | "hierarchy" | "clustered", GraphPreset2D>> = Object.freeze({
  network: networkPreset(),
  radial: radialPreset(),
  hierarchy: hierarchyPreset(),
  clustered: clusteredPreset(),
});

export type GraphPreset2DId = keyof typeof GRAPH_PRESETS_2D;

/** A preset from an id or an object; an unknown id is an error, never a silent default. */
export function resolvePreset2D(preset: GraphPreset2DId | string | GraphPreset2D | undefined): GraphPreset2D {
  if (preset === undefined) return GRAPH_PRESETS_2D.network;
  if (typeof preset === "object") return preset;
  const found = (GRAPH_PRESETS_2D as Record<string, GraphPreset2D>)[preset];
  if (!found) throw new Error(`Unknown fancy-graph 2D preset "${preset}". Built in: ${Object.keys(GRAPH_PRESETS_2D).join(", ")}.`);
  return found;
}
