import { describe, expect, it } from "vitest";
import { DEFAULT_LAYERS, effectiveLinkVisibility, isLayerVisible, layerMap, pickScreen, resolveLayers } from "../src/core";
import { GRAPH_PRESETS_2D } from "../src/index";
import { GRAPH_PRESETS_3D } from "../src/three/index";

describe("layer visibility (headless)", () => {
  it("resolves a preset's declared layers against a partial, JSON map", () => {
    const specs = [{ id: "links", label: "Links" }, { id: "orbits", label: "Orbit paths", visible: false }];
    expect(resolveLayers(specs)).toEqual([
      { id: "links", label: "Links", visible: true },
      { id: "orbits", label: "Orbit paths", visible: false },
    ]);
    expect(resolveLayers(specs, { orbits: true, links: false, unknown: true })).toEqual([
      { id: "links", label: "Links", visible: false },
      { id: "orbits", label: "Orbit paths", visible: true },
    ]);
  });

  it("gives a full id -> boolean map, and treats an undeclared layer as visible", () => {
    const map = layerMap(resolveLayers(DEFAULT_LAYERS, { labels: false }));
    expect(map).toEqual({ links: true, labels: false });
    expect(isLayerVisible(map, "labels")).toBe(false);
    expect(isLayerVisible(map, "nodes")).toBe(true);
  });

  it("switching the links layer off means no links, whatever the mode", () => {
    expect(effectiveLinkVisibility("all", true)).toBe("all");
    expect(effectiveLinkVisibility("focus", true)).toBe("focus");
    expect(effectiveLinkVisibility("all", false)).toBe("none");
  });

  it("every built-in preset declares the layers it draws", () => {
    for (const p of Object.values(GRAPH_PRESETS_2D)) expect(p.layers?.map((l) => l.id)).toEqual(expect.arrayContaining(["links", "labels"]));
    expect(GRAPH_PRESETS_2D.clustered.layers!.map((l) => l.id)).toContain("clusters");
    expect(GRAPH_PRESETS_2D.network.layers!.map((l) => l.id)).not.toContain("clusters");
    for (const p of Object.values(GRAPH_PRESETS_3D)) expect(p.layers?.map((l) => l.id)).toEqual(expect.arrayContaining(["links", "labels"]));
    expect(GRAPH_PRESETS_3D.layered.layers!.map((l) => l.id)).toContain("clusters");
    const cosmos = resolveLayers(GRAPH_PRESETS_3D.cosmos.layers!);
    expect(cosmos.map((l) => l.id).sort()).toEqual(["background", "clusters", "labels", "links", "orbits"]);
    // Orbit paths are new; off by default so the published look is unchanged.
    expect(cosmos.find((l) => l.id === "orbits")!.visible).toBe(false);
  });
});

describe("pickScreen depth mode in a crowd", () => {
  it("a direct hit beats a near miss that is closer to the camera", () => {
    // 0: a star dead under the pointer, far away. 1: a tiny asteroid 6 px off, in front.
    const screen = new Float32Array([100, 100, 5, 900, 106, 100, 1, 10]);
    expect(pickScreen(screen, 100, 100, { minReach: 7 })).toBe(0);
  });
  it("among near misses, the nearest on screen wins", () => {
    const screen = new Float32Array([100, 100, 1, 900, 106, 100, 1, 10]);
    expect(pickScreen(screen, 101, 100, { minReach: 7 })).toBe(0);
  });
});
