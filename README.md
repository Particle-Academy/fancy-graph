# @particle-academy/fancy-graph

A knowledge-graph map viewer for React. Give it plain JSON nodes and links; it
lays them out, draws them and lets people (and agents) explore them, in 2D on a
canvas or in 3D on three.js. Layout, physics and drawing are all pluggable, so
one app can draw circles in a force layout and another a cosmos of orbiting
planets, from the same component.

Part of the [Fancy Dev Kit](https://ui.particle.academy). Pre-1.0.

<!-- fancy-agents-note:start -->
> **For agents.** This package is listed on the Fancy MCP catalog server at
> `https://ui.particle.academy/mcp` (streamable HTTP, no API key; MCP id `fancy-ui`),
> with install commands and docs, alongside the rest of the kit. How an agent
> installs and uses this package is in [AGENTS.md](https://github.com/Particle-Academy/fancy-graph/blob/main/AGENTS.md).
<!-- fancy-agents-note:end -->

## Install

```bash
npm install @particle-academy/fancy-graph
# for 3D as well:
npm install @particle-academy/fancy-3d-three @particle-academy/fancy-3d three
```

The 2D view has no 3D dependency. The 3D view is built on fancy-3d-three: it is
an optional peer (0.3.0 or later), loaded only by the
`@particle-academy/fancy-graph/three` entry, and fancy-graph takes three.js only
through it (`@particle-academy/fancy-3d-three/three`). fancy-graph declares no
`three` dependency of its own; you install `three` because fancy-3d-three needs
it. No runtime dependencies.

## Usage

```tsx
import { GraphView } from "@particle-academy/fancy-graph";

const [selected, setSelected] = useState<string | null>(null);

<GraphView
  data={{ nodes: [{ id: "a", label: "Alpha", group: "team" }, { id: "b", label: "Beta" }], links: [{ source: "a", target: "b" }] }}
  selected={selected}
  onSelectedChange={(id) => setSelected(id)}
  search={query}
  style={{ height: 600 }}
/>;
```

In 3D:

```tsx
import { GraphView3D } from "@particle-academy/fancy-graph/three";

<GraphView3D data={data} style={{ height: 600 }} />;
```

Or inside a `<Stage>` you already have, with `<GraphScene3D>`.

### Your own layout

A layout is a function that fills positions (3 floats per node), or a stepper
that may move every node every frame:

```ts
const orbits = {
  animated: true,
  init(graph, positions) { /* place everything */ },
  step(positions, { time }) { /* move things */ return true; },
};
<GraphView3D data={data} layout={orbits} />;
```

Built in, all written for this package: `forceLayout()` (Barnes-Hut, 2D or 3D,
`groupPull` to gather groups), `radialLayout()`, `hierarchyLayout()`, and
`workerLayout()` to run them in a Web Worker for large graphs.

### Your own look

2D: `renderers={{ node, link, cluster, background }}`, canvas callbacks with
screen coordinates and each node's state. 3D: layers. `createInstancedLayer`
takes your own GLSL 3 shaders and gives you instancing, additive or
premultiplied blending, back-to-front order and fresh positions every frame;
`examples/cosmos/` builds a full cosmos (galaxies, stars, planets with rings,
asteroids, a sky, dust) with nothing else.

### What the kit owns

Camera (pan, zoom, rotate, touch, keyboard, fly-to, follow), picking, selection,
hover, neighbour highlighting, search focus, labels with overlap handling,
reduced motion, stable `data-fancy-graph*` handles, activity events, and
gamepad-only control (`stepFocus`, `neighbors`, `orbit` / `pan` / `zoom`, a focus
ring, neighbourhood mode). Every limit is configurable through `limits`.

## Performance (measured, not promised)

Measured 2026-11-26 with this repo's own harness (`bench/`), synthetic
knowledge graphs shaped like the first consumer's (eight node types, links
mostly within a type). Raw numbers: `bench/results/*.json`.

**Frame cost**: the time to produce one frame (layout step, projection,
picking buffer, labels, draw submission), in a headless Chromium 159 at
1280x800. "Frame interval" is the real time between frames while the view
animates; 16.7 ms is 60 fps, the display's limit.

GPU: NVIDIA RTX 3070 through ANGLE / Direct3D 11.

| View | Nodes / links | Frame cost p50 / p95 / max (ms) | Frame interval p50 / p95 (ms) |
|---|---|---|---|
| 2D canvas | 650 / 900 | 0.2 / 0.4 / 1.1 | 16.7 / 16.7 |
| 2D canvas | 4,000 / 6,000 | 0.9 / 1.4 / 2.3 | 16.7 / 16.8 |
| 3D cosmos | 650 / 900 | 0.2 / 0.4 / 0.6 | 16.7 / 16.8 |
| 3D cosmos | 4,000 / 6,000 | 1.0 / 1.7 / 2.1 | 16.7 / 16.7 |

Run to run, these move by a few tenths of a millisecond: the run before this
one measured 1.3 (2D) and 1.4 (3D) ms p50 at 4,000 nodes.

No GPU (SwiftShader, a CPU rasteriser; a floor for weak hardware, 10-frame
samples):

| View | Nodes / links | Frame cost p50 / p95 (ms) | Frame interval p50 / p95 (ms) |
|---|---|---|---|
| 2D canvas | 650 / 900 | 0.5 / 0.7 | 16.7 / 16.8 |
| 2D canvas | 4,000 / 6,000 | 1.8 / 3.0 | 16.7 / 16.7 |
| 3D cosmos | 650 / 900 | 0.5 / 0.9 | 33.3 / 83.3 |
| 3D cosmos | 4,000 / 6,000 | 2.0 / 2.3 | 100.1 / 200.1 |

Without a GPU the 3D cosmos's frame cost stays low while its frame interval
grows, so the time goes to rasterising (its glows, galaxy discs and dust are
large-area shader work), not to the kit. The 2D view is the better choice there.

**Layout cost** (Node 24, per step):

| Layout | Nodes / links | Step p50 / p95 (ms) |
|---|---|---|
| force, 2D | 650 / 900 | 0.7 / 1.5 |
| force, 2D | 4,000 / 6,000 | 6.3 / 8.6 |
| force, 3D | 4,000 / 6,000 | 12.5 / 15.7 |
| cosmos orbits (every frame) | 4,000 / 6,000 | 0.12 / 0.16 |

A force step at 4,000 nodes takes much of a frame, which is why
`workerLayout` moves built-in layouts off the main thread above
`limits.workerThreshold` (1,500 nodes by default).

## License

MIT
