/**
 * Layer visibility, headless. A preset declares the layers it draws (links,
 * labels, clusters, a background, the cosmos's orbit paths, ...); the view
 * takes a partial JSON map `{ [id]: boolean }` over those, so a host, the
 * built-in controls and an agent all switch them the same way.
 */

/** `"all"`, `"focus"` (only the focus's links while something is focused or searched), or `"none"`. */
export type LinkVisibility = "all" | "focus" | "none";

/** A layer a preset can switch on and off. */
export interface GraphLayerSpec {
  /** Stable id: `links`, `labels`, `clusters`, `background`, `orbits`, or a custom layer's own. */
  id: string;
  /** What the controls call it ("Galaxies", "Orbit paths"). */
  label: string;
  /** Shown unless the map says otherwise. Default true. */
  visible?: boolean;
}

/** One layer as the view currently has it. */
export interface GraphLayerState {
  id: string;
  label: string;
  visible: boolean;
}

/** Partial on the way in (`layers`, `defaultLayers`); full, one key per declared layer, on the way out (`onLayersChange`). */
export type GraphLayerVisibility = Record<string, boolean>;

/** What every view draws: links and node labels. */
export const DEFAULT_LAYERS: readonly GraphLayerSpec[] = Object.freeze([
  { id: "links", label: "Links" },
  { id: "labels", label: "Labels" },
]);

/** The declared layers, each resolved against the map. Ids the preset does not declare are ignored. */
export function resolveLayers(specs: readonly GraphLayerSpec[], value?: Partial<Record<string, boolean>> | null): GraphLayerState[] {
  return specs.map((s) => {
    const v = value?.[s.id];
    return { id: s.id, label: s.label, visible: typeof v === "boolean" ? v : s.visible !== false };
  });
}

/** Several declarations as one list, in order; the first declaration of an id wins. */
export function mergeLayerSpecs(...lists: readonly (readonly GraphLayerSpec[] | undefined)[]): GraphLayerSpec[] {
  const out: GraphLayerSpec[] = [];
  const seen = new Set<string>();
  for (const list of lists)
    for (const s of list ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  return out;
}

/** `{ id: visible }` for every layer. */
export function layerMap(states: readonly GraphLayerState[]): GraphLayerVisibility {
  const out: GraphLayerVisibility = {};
  for (const s of states) out[s.id] = s.visible;
  return out;
}

/** A layer nobody declared (the nodes, a custom layer) is always visible. */
export function isLayerVisible(map: Readonly<Partial<Record<string, boolean>>> | undefined, id: string): boolean {
  return map?.[id] !== false;
}

/** The links layer switched off means no links, whatever the mode. */
export function effectiveLinkVisibility(mode: LinkVisibility, linksVisible: boolean): LinkVisibility {
  return linksVisible ? mode : "none";
}
