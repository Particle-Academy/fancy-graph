/**
 * Browser harness for the headless check and the frame-time benchmark.
 * Bundled to one IIFE (bench/browser/tsup.config.ts) and opened from file://
 * by run.mjs. Not shipped.
 */
import { createRef, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { forceLayout, GRAPH_PRESETS_2D, GraphView, type GraphData, type GraphViewHandle } from "../../src/index";
import { cosmosPreset, GRAPH_PRESETS_3D, GraphView3D, type CosmosLenses, type GraphScene3DHandle } from "../../src/three/index";
import { COSMOS_COLORS, cosmosData } from "../../examples/cosmos/data";
import { BEACHHEAD_COSMOS } from "../../examples/cosmos/renderers";
import { KIT_NOW, kitData } from "../../examples/cosmos/kit";
import { GraphViewControls } from "../../src/controls/index";

type Handle = GraphViewHandle | GraphScene3DHandle;

interface MountOptions {
  nodes: number;
  links: number;
  search?: string;
  selected?: string | null;
  focused?: string | null;
  neighborhood?: boolean;
}

let root: Root | null = null;
let handle: Handle | null = null;

const host = () => document.getElementById("app")!;

function reset() {
  root?.unmount();
  host().replaceChildren();
  root = createRoot(host());
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { frames: s.length, mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
}

function Demo2D({ data, opts, handleRef }: { data: GraphData; opts: MountOptions; handleRef: React.RefObject<GraphViewHandle | null> }) {
  const [selected, setSelected] = useState<string | null>(opts.selected ?? null);
  const layout = useState(() => forceLayout({ seed: 3, groupPull: 0.2 }))[0];
  return (
    <GraphView
      ref={handleRef}
      data={data}
      layout={layout}
      selected={selected}
      onSelectedChange={(id) => setSelected(id)}
      defaultFocused={opts.focused ?? null}
      neighborhood={opts.neighborhood}
      search={opts.search}
      clusters="group"
      reducedMotion
      background="#0b1020"
      style={{ width: "100%", height: "100%" }}
      aria-label="Benchmark graph"
    />
  );
}

function Demo3D({ data, opts, handleRef }: { data: GraphData; opts: MountOptions; handleRef: React.RefObject<GraphScene3DHandle | null> }) {
  const [selected, setSelected] = useState<string | null>(opts.selected ?? null);
  // Beachhead's view: a galaxy per type, as the consumer asks for it in 0.4.0.
  const preset = useMemo(() => cosmosPreset({ ...BEACHHEAD_COSMOS, colors: COSMOS_COLORS }), []);
  return (
    <GraphView3D
      ref={handleRef}
      data={data}
      preset={preset}
      theme={{ base: "dark", typeColors: COSMOS_COLORS }}
      selected={selected}
      onSelectedChange={(id) => setSelected(id)}
      defaultFocused={opts.focused ?? null}
      neighborhood={opts.neighborhood}
      search={opts.search}
      limits={{ maxLinks: 6000 }}
      style={{ width: "100%", height: "100%" }}
      aria-label="Cosmos"
    />
  );
}

/** A tree-shaped graph for the hierarchy preset: 4 roots, 3 children each, 3 grandchildren each. */
function treeData(): GraphData {
  const nodes: GraphData["nodes"] = [];
  const links: GraphData["links"] = [];
  const types = ["agent", "problem", "solution", "post"];
  for (let r = 0; r < 4; r++) {
    const root = `r${r}`;
    nodes.push({ id: root, label: `Theme ${r + 1}`, group: types[r] });
    for (let c = 0; c < 3; c++) {
      const child = `${root}-${c}`;
      nodes.push({ id: child, label: `Topic ${r + 1}.${c + 1}`, group: types[r] });
      links.push({ source: root, target: child });
      for (let g = 0; g < 3; g++) {
        const leaf = `${child}-${g}`;
        nodes.push({ id: leaf, label: `Note ${r + 1}.${c + 1}.${g + 1}`, group: types[(r + g + 1) % 4] });
        links.push({ source: child, target: leaf });
      }
    }
  }
  return { nodes, links };
}

let setSwitchPreset: ((id: string) => void) | null = null;

/** One mounted view whose preset changes in place (no key), as a consumer's preset picker does. */
function PresetSwitcher({ kind, first, data }: { kind: "2d" | "3d"; first: string; data: GraphData }) {
  const [preset, setPreset] = useState(first);
  setSwitchPreset = setPreset;
  const style = { width: "100%", height: "100%" };
  return kind === "2d" ? (
    <GraphView data={data} preset={preset as keyof typeof GRAPH_PRESETS_2D} theme={{ base: "dark", typeColors: COSMOS_COLORS }} reducedMotion style={style} aria-label="Preset switch" />
  ) : (
    <GraphView3D data={data} preset={preset as keyof typeof GRAPH_PRESETS_3D} theme={{ base: "dark", typeColors: COSMOS_COLORS }} flyOnSelect={false} reducedMotion style={style} aria-label="Preset switch" />
  );
}

/** A small system whose bodies carry their own looks: every skin, atmospheres, rings, moons. */
function looksData(): GraphData {
  const planets: [string, string, Record<string, unknown>][] = [
    ["ember", "#f97316", { skin: { type: "lava", colors: ["#7c2d12", "#fdba74"] } }],
    ["terra", "#38bdf8", { skin: { type: "ocean", colors: ["#1d4ed8", "#65a30d"] }, atmosphere: { color: "#93c5fd", thickness: 0.18, glow: 0.9 } }],
    ["dust", "#d6a77a", { skin: { type: "rocky", colors: ["#7c4a2d", "#e7c9a3"] } }],
    ["ringo", "#eab308", { skin: { type: "gas", colors: ["#a16207", "#fef3c7"] }, rings: { color: "#fde68a", inner: 1.4, outer: 2.5, opacity: 0.85 }, atmosphere: { thickness: 0.1, glow: 0.6 } }],
    ["frost", "#a5f3fc", { skin: { type: "ice", colors: ["#67e8f9", "#f0fdff"] }, atmosphere: { color: "#cffafe", thickness: 0.1, glow: 0.5 } }],
    ["umber", "#a78bfa", { skin: { type: "gas", colors: ["#4c1d95", "#ddd6fe"] }, rings: { color: "#c4b5fd", inner: 1.3, outer: 2.0, tilt: 0.5, opacity: 0.6 } }],
  ];
  const nodes: GraphData["nodes"] = [{ id: "sol", label: "Sol", group: "star", color: "#fde68a" }];
  const links: GraphData["links"] = [];
  planets.forEach(([id, color, look], k) => {
    nodes.push({ id, label: id[0].toUpperCase() + id.slice(1), group: "planet", color, size: 7 + (k % 3) * 2.5, cosmos: look });
    links.push({ source: id, target: "sol", kind: "orbits" });
    for (let m = 0; m < (k % 3); m++) {
      const moon = `${id}-moon-${m}`;
      nodes.push({ id: moon, label: `${id} ${["I", "II"][m]}`, group: "moon", color: "#cbd5e1" });
      links.push({ source: moon, target: id, kind: "orbits" });
    }
  });
  return { nodes, links };
}

const COSMOS_DATA: Record<string, () => GraphData> = {
  beachhead: () => cosmosData(650, 900, 1),
  kit: () => kitData(120, 3),
  looks: looksData,
};

/** The kit dependency map, the cosmos's first real use: systems by language, a constellation per feature, comets. */
const KIT_COSMOS: CosmosLenses = {
  systems: { by: { field: "language" } },
  constellations: { by: { field: "features" } },
  comets: ["multi-membership", { field: "releasedAt", within: "14d", now: KIT_NOW }],
};
const COSMOS_LENSES: Record<string, CosmosLenses> = {
  galaxies: BEACHHEAD_COSMOS,
  kit: KIT_COSMOS,
  looks: { systems: { by: { relation: "orbits" } }, comets: false },
};

interface CosmosCase {
  data: string;
  lenses: string;
  selected?: string | null;
  constellation?: string | null;
  fly?: { id: string; distance: number } | null;
  layers?: Record<string, boolean>;
  frames?: number;
}

const harness = {
  /** A cosmos as a consumer configures it: a named dataset and lens set, optionally a selection, a constellation or a flight. */
  async mountCosmos(c: CosmosCase) {
    reset();
    host().style.background = "#02030a";
    const data = COSMOS_DATA[c.data]();
    const ref = createRef<GraphScene3DHandle>();
    root!.render(
      <GraphView3D
        ref={ref}
        data={data}
        preset="cosmos"
        cosmos={COSMOS_LENSES[c.lenses]}
        theme={{ base: "dark", typeColors: COSMOS_COLORS }}
        defaultSelected={c.selected ?? null}
        defaultSelectedConstellation={c.constellation ?? null}
        defaultLayers={c.layers}
        flyOnSelect={false}
        reducedMotion
        style={{ width: "100%", height: "100%" }}
        aria-label="Cosmos"
      />,
    );
    await waitFrames(30);
    handle = ref.current;
    if (c.fly) (handle as GraphScene3DHandle).flyTo(c.fly.id, { distance: c.fly.distance });
    await waitFrames(c.frames ?? 30);
    const h = handle as GraphScene3DHandle;
    return { ...h.getState(), comets: (h.getMeta() as { comets: unknown[] }).comets.length, constellations: h.getConstellations().map((k) => k.id), crumbs: h.getBreadcrumbs().map((k) => k.id) };
  },
  /**
   * Switches one mounted view through every ordered pair of its kind's presets,
   * in place. Returns the preset the root reports after each step; a throw
   * unmounts the tree, so the attribute goes missing and the page logs an error.
   */
  async switchPresets(kind: "2d" | "3d") {
    reset();
    const ids = Object.keys(kind === "2d" ? GRAPH_PRESETS_2D : GRAPH_PRESETS_3D);
    const { nodes, links } = cosmosData(160, 220, 1);
    root!.render(<PresetSwitcher kind={kind} first={ids[0]} data={{ nodes, links }} />);
    await waitFrames(10);
    // A walk that takes every ordered pair: from each preset to every other.
    const walk: string[] = [];
    for (const a of ids) for (const b of ids) if (a !== b) walk.push(a, b);
    const seen: { want: string; got: string | null }[] = [];
    for (const id of walk) {
      setSwitchPreset!(id);
      await waitFrames(kind === "3d" ? 6 : 3);
      seen.push({ want: id, got: document.querySelector("[data-fancy-graph]")?.getAttribute("data-fancy-graph-preset") ?? null });
    }
    return seen;
  },
  /** One built-in preset, as a consumer would use it: the preset and a theme, nothing else. */
  async mountPreset(kind: "2d" | "3d", id: string, theme: "light" | "dark", selected: string | null) {
    reset();
    host().style.background = theme === "dark" ? "#0b1020" : "#f8fafc";
    const data = id === "hierarchy" ? treeData() : (() => {
      const { nodes, links } = cosmosData(kind === "3d" && id === "cosmos" ? 650 : 160, kind === "3d" && id === "cosmos" ? 900 : 220, 1);
      return { nodes, links };
    })();
    if (kind === "2d") {
      const ref = createRef<GraphViewHandle>();
      root!.render(<GraphView ref={ref} data={data} preset={id as keyof typeof GRAPH_PRESETS_2D} theme={{ base: theme, typeColors: COSMOS_COLORS }} defaultSelected={selected} reducedMotion style={{ width: "100%", height: "100%" }} aria-label={`${id} preset`} />);
      await waitFrames(20);
      handle = ref.current;
    } else {
      const ref = createRef<GraphScene3DHandle>();
      root!.render(<GraphView3D ref={ref} data={data} preset={id as keyof typeof GRAPH_PRESETS_3D} theme={{ base: theme, typeColors: COSMOS_COLORS }} defaultSelected={selected} flyOnSelect={false} reducedMotion style={{ width: "100%", height: "100%" }} aria-label={`${id} preset`} />);
      await waitFrames(60);
      handle = ref.current;
    }
    return handle!.getState();
  },
  presets: () => ({ "2d": Object.keys(GRAPH_PRESETS_2D), "3d": Object.keys(GRAPH_PRESETS_3D) }),
  /** The cosmos preset as the owner used it, with orbit paths on and the view-controls overlay. */
  async mountCosmosControls(selected: string) {
    reset();
    host().style.background = "#02030a";
    const { nodes, links } = cosmosData(650, 900, 1);
    const ref = createRef<GraphScene3DHandle>();
    root!.render(<GraphView3D ref={ref} data={{ nodes, links }} preset="cosmos" theme={{ base: "dark", typeColors: COSMOS_COLORS }} defaultSelected={selected} defaultLayers={{ orbits: true }} flyOnSelect={false} reducedMotion controls={GraphViewControls} style={{ width: "100%", height: "100%" }} aria-label="Cosmos with controls" />);
    await waitFrames(60);
    handle = ref.current;
    return handle!.getState();
  },
  async mount2d(opts: MountOptions) {
    reset();
    const { nodes, links } = cosmosData(opts.nodes, opts.links, 1);
    const ref = createRef<GraphViewHandle>();
    root!.render(<Demo2D data={{ nodes, links }} opts={opts} handleRef={ref} />);
    await waitFrames(5);
    handle = ref.current;
    return handle!.getState();
  },
  async mount3d(opts: MountOptions) {
    reset();
    const { nodes, links } = cosmosData(opts.nodes, opts.links, 1);
    const ref = createRef<GraphScene3DHandle>();
    root!.render(<Demo3D data={{ nodes, links }} opts={opts} handleRef={ref} />);
    await waitFrames(10);
    handle = ref.current;
    return handle!.getState();
  },
  /** CPU cost of a frame the kit renders synchronously (layout step, projection, layers, labels, draw call submission). */
  measureSync(frames: number) {
    const ms: number[] = [];
    for (let i = 0; i < frames; i++) ms.push(handle!.renderFrame(1 / 60).ms);
    return stats(ms);
  },
  /**
   * Real frame-to-frame intervals. The 3D Stage renders every frame on its own;
   * a settled 2D view idles, so `drive` renders one 2D frame per tick, as it
   * does while panning or while a layout moves.
   */
  measureRaf(durationMs: number, drive = false): Promise<ReturnType<typeof stats>> {
    return new Promise((resolve) => {
      const gaps: number[] = [];
      let last = 0;
      const start = performance.now();
      const tick = (t: number) => {
        if (last) gaps.push(t - last);
        last = t;
        if (drive) handle!.renderFrame(1 / 60);
        if (t - start < durationMs) requestAnimationFrame(tick);
        else resolve(stats(gaps));
      };
      requestAnimationFrame(tick);
    });
  },
  handle: () => handle,
  waitFrames,
  webgl: () => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  },
};

(window as unknown as { harness: typeof harness }).harness = harness;
document.title = "fancy-graph harness ready";
