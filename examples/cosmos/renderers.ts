/**
 * The cosmos look now ships as part of the `cosmos` 3D preset
 * (src/three/presets/cosmos-renderers.ts). The example adds only what an app
 * adds: its own per-type colours.
 */
import type { GraphNode } from "../../src/core";
import type { CosmosLenses } from "../../src/three/presets/cosmos-layout";
import { colorFor } from "../../src/core";
import { cosmosDefaults } from "../../src/three/presets/cosmos-renderers";
import { COSMOS_COLORS } from "./data";

export { cosmosRenderers, cosmosDefaults, type CosmosRenderOptions } from "../../src/three/presets/cosmos-renderers";

/**
 * Beachhead's view: a galaxy per entity type, as 0.3.0 drew by default. In
 * 0.4.0 a galaxy is asked for, and this is the line that asks.
 */
export const BEACHHEAD_COSMOS: CosmosLenses = { galaxies: { by: { field: "type" } } };

/** The preset's view props plus this app's colours. */
export function cosmosProps(colors: Record<string, string> = COSMOS_COLORS) {
  const { nodeSize, clusterLabel, homeYaw, homePitch, linkVisibility } = cosmosDefaults;
  return { nodeSize, clusterLabel, homeYaw, homePitch, linkVisibility, nodeColor: (n: GraphNode) => colors[n.group ?? ""] ?? colorFor(n.group) };
}
