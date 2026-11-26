/**
 * The cosmos look now ships as part of the `cosmos` 3D preset
 * (src/three/presets/cosmos-renderers.ts). The example adds only what an app
 * adds: its own per-type colours.
 */
import type { GraphNode } from "../../src/core";
import { colorFor } from "../../src/core";
import { cosmosDefaults } from "../../src/three/presets/cosmos-renderers";
import { COSMOS_COLORS } from "./data";

export { cosmosRenderers, cosmosDefaults, type CosmosRenderOptions } from "../../src/three/presets/cosmos-renderers";

/** The preset's defaults plus this app's colours. */
export function cosmosProps(colors: Record<string, string> = COSMOS_COLORS) {
  return { ...cosmosDefaults, nodeColor: (n: GraphNode) => colors[n.group ?? ""] ?? colorFor(n.group) };
}
