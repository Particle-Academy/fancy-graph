/**
 * Browser harness for the headless check and the frame-time benchmark.
 * Bundled to one IIFE (bench/browser/tsup.config.ts) and opened from file://
 * by run.mjs. Not shipped.
 */
import { createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { forceLayout, GraphView, type GraphData, type GraphViewHandle } from "../../src/index";
import { GraphView3D, type GraphScene3DHandle } from "../../src/three/index";
import { COSMOS_COLORS, cosmosData } from "../../examples/cosmos/data";
import { cosmosLayout } from "../../examples/cosmos/layout";
import { cosmosProps, cosmosRenderers } from "../../examples/cosmos/renderers";

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
  const [layout] = useState(() => cosmosLayout({ colors: COSMOS_COLORS }));
  const [renderers] = useState(() => cosmosRenderers());
  return (
    <GraphView3D
      ref={handleRef}
      data={data}
      layout={layout}
      renderers={renderers}
      {...cosmosProps()}
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

const harness = {
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
