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

The 2D view has no WebGL or three.js dependency; it takes one React-only piece
of `@particle-academy/fancy-3d` (a peer, installed for you by npm 7+): its
full-screen hook, so every view goes full screen the same way. The 3D view is
built on fancy-3d-three: it is an optional peer (0.5.0 or later), loaded only by the
`@particle-academy/fancy-graph/three` entry, and fancy-graph takes three.js only
through it (`@particle-academy/fancy-3d-three/three`). fancy-graph declares no
`three` dependency of its own; you install `three` because fancy-3d-three needs
it. The optional view-controls overlay (`@particle-academy/fancy-graph/controls`)
needs `@particle-academy/react-fancy`, likewise an optional peer. No runtime
dependencies.

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

## Views: ready-made presets

Every view is a preset: a layout plus renderers plus defaults. Use one as it is,
or override any piece of it with a prop (`layout`, any `renderers` slot,
`clusters`, `nodeSize`, ...) and keep the rest. Every preset follows the theme
and takes every interaction: selection, focus and `stepFocus`, the camera API,
labels and neighbourhood mode.

```tsx
<GraphView data={data} preset="clustered" theme="dark" />
<GraphView3D data={data} preset="cosmos" />
<GraphView3D data={data} preset={layeredPreset({ layerBy: { field: "createdAt", buckets: 6 } })} />
```

| | |
|---|---|
| **`network`** (2D, the default): a force-directed network.<br>![2D network](docs/presets/2d-network.png) | **`radial`** (2D): an ego view centred on the focused node, else the selection, re-centred as it moves.<br>![2D radial](docs/presets/2d-radial.png) |
| **`hierarchy`** (2D): a layered tree for directed links, roots on top.<br>![2D hierarchy](docs/presets/2d-hierarchy.png) | **`clustered`** (2D): a map grouped by node type, a labelled hull per type.<br>![2D clustered](docs/presets/2d-clustered.png) |
| **`network`** (3D, the default): lit spheres and lines.<br>![3D network](docs/presets/3d-network.png) | **`layered`** (3D): a plane per node type, or per bucket of a date or number field.<br>![3D layered](docs/presets/3d-layered.png) |
| **`cosmos`** (3D): gravity places, light draws. Stars with orbiting planets and moons, a spiral galaxy per node group by default, free systems spread by their links when galaxies are off, comets and constellations. Shown with a star selected: its light arcs out to everything it links to. See [The cosmos](#the-cosmos).<br>![3D cosmos](docs/presets/3d-cosmos.png) | |

### The cosmos

A knowledge graph has two kinds of relation, and the cosmos treats them
differently. **Gravity** (membership: written-in, part-of, member-of) decides
what orbits what, and is the only thing that places a body. **Light** (every
other link) is drawn as soft arcs between bodies and moves nothing, except to
spread free systems so related ones sit near each other. Say which is which
with **lenses**, plain JSON on the `cosmos` prop:

```tsx
<GraphView3D
  data={data}
  preset="cosmos"
  cosmos={{
    systems: { by: { field: "language" } },          // or { relation: "written-in" }, "hubs" (default), "none"
    galaxies: { by: { field: "family" } },           // default: a galaxy per node.group; or { relation: "member-of" }; false = none
    sort: { by: { field: "releasedAt" }, dir: "asc" },// orbit order and order along the arms; never regroups
    constellations: { by: { field: "features" } },  // or [{ id, label, match: { relation | field | linkedTo } }]
    comets: ["multi-membership", { field: "releasedAt", within: "14d" }],
  }}
/>
```

- **Every centre is a node.** A star or a galaxy's core is a real node, or one
  the view makes per field value (`cosmos:system:<value>`,
  `cosmos:galaxy:<value>`, `synthetic: true`). It can be selected, labelled
  and searched, and counts against the limits.
- **Galaxies by group, out of the box.** With no `galaxies` lens, a graph whose
  nodes have two or more groups (`node.group`, or a `type` field) becomes one
  spiral galaxy per group, so regrouping your data re-forms the galaxies and
  the bodies fly there. Not under `systems: { by: { relation } }`, whose
  hierarchy already says what orbits what. `galaxies: false` turns them off
  (0.4.0's sky, exactly); `galaxies: { by: ... }` picks another grouping.
- **Systems always orbit**: planets round their star, moons round their planet.
  In a galaxy a system stays small: at most `limits.maxPlanetsPerSystem` (12)
  planets and moons, and a `"hubs"` system at most `hubShare` (0.2) of its
  galaxy. The rest become stars of their own along the same galaxy's arms.
- **Orbit paths are subtle**: faint rings, drawn only for the selected,
  focused or hovered system and the three nearest the camera, fading out as
  they shrink on screen (`cosmosOrbits({ nearest, fadePx, alpha })`).
- **Changing a lens or the sort is a flight, not a reload**: bodies fly from
  their old orbits to their new ones (instant under reduced motion).
- **Comets**: a node in several systems travels an eccentric loop through each
  of them; a node with a recent time field trails a tail. Tails are drawn on
  the GPU, in their own `comets` layer.
- **Constellations** are figures over the sky, each its own layer, with a
  clickable name (`data-fancy-graph-constellation-label`) and a controlled
  selection (`selectedConstellation`).
- **Semantic zoom labels** (on by default): galaxy and constellation names from
  far, star names closer, planets and moons closer still. Selecting a star
  frames its system, a core its galaxy; `getBreadcrumbs()` /
  `onBreadcrumbsChange` give the way back out.
- **Each body's look comes from its data**: `node.cosmos.skin` (`rocky`, `gas`,
  `ice`, `cratered`, `lava`, `ocean`), `atmosphere`, `rings` and `node.size`,
  all procedural shaders, or `node.cosmos.texture` for an image your app
  supplies (the kit ships none).

| | |
|---|---|
| **Galaxies**: `galaxies: { by: { field: "type" } }`, a spiral galaxy per node type around its core.<br>![Cosmos galaxies](docs/presets/3d-cosmos-galaxies.png) | **A system up close**: skins, atmospheres, rings and moons, all from node fields, with the orbit paths on.<br>![Cosmos system](docs/presets/3d-cosmos-system.png) |
| **The kit dependency map**, 150 packages grouped by family: systems by language, a constellation per feature, comets for polyglots and recent releases, and a galaxy per group with no galaxies lens at all.<br>![Cosmos kit map](docs/presets/3d-cosmos-kit.png) | **The same map grouped by language**: the same nodes and lens, only `node.group` changed, so the galaxies re-form.<br>![Cosmos kit map by language](docs/presets/3d-cosmos-kit-language.png) |
| **Up close**: the typescript system, capped at 12 planets with faint orbit rings, its overflow named along the arm.<br>![Cosmos kit close](docs/presets/3d-cosmos-kit-close.png) | **A constellation selected**: its figure lit and its members named.<br>![Cosmos constellation](docs/presets/3d-cosmos-constellation.png) |

Upgrading from 0.3.0, where the cosmos made a galaxy per type by itself: since
0.4.1 it does again (by `node.group`), and
`cosmos={{ galaxies: { by: { field: "type" } } }}` still asks for it
explicitly. The [changelog](./CHANGELOG.md) lists the rest.

### Selection, layers and the view controls

Click a node to select it; click it again, click empty space, or press Escape
to clear it. Every preset declares the layers it draws, and each one switches
on and off through a controlled JSON prop:

| Preset | Layers (id: default) |
|---|---|
| 2D `network`, `radial`, `hierarchy`; 3D `network` | `links`, `labels` |
| 2D `clustered` | `links`, `labels`, `clusters` |
| 3D `layered` | `links`, `labels`, `clusters` (the planes) |
| 3D `cosmos` | `background` (sky), `clusters` (galaxies), `cores` (galactic cores), `orbits` (orbit paths: on, faint, near the focus only), `links` (light), `comets` (comet tails), `labels`; with constellations, `constellations` and one `constellation:<id>` each |

```tsx
const [layers, setLayers] = useState({ orbits: true });

<GraphView3D
  data={data}
  preset="cosmos"
  layers={layers}                       // partial: unlisted layers keep their default
  onLayersChange={setLayers}            // gets the full map
  linkVisibility={mode}                 // "all" | "focus" | "none"; cosmos defaults to "focus"
  onLinkVisibilityChange={setMode}
  paused={paused}                       // freezes the orbits
  onPausedChange={setPaused}
/>;
```

Each also has an uncontrolled `default*` form. For a ready-made overlay (clear
the selection, a switch per layer, all links or the selection's only, motion),
pass `GraphViewControls`:

```tsx
import { GraphViewControls } from "@particle-academy/fancy-graph/controls";

<GraphView3D data={data} preset="cosmos" controls={GraphViewControls} />;
```

It is built from react-fancy, an optional peer used only by the `/controls`
entry, so it needs `@particle-academy/react-fancy` installed and its styles
set up as for any react-fancy component. It is off unless you pass it. Any
component taking `GraphControlsProps` works the same way, or leave `controls`
off and drive the props yourself.

## Full screen

Every view has a full-screen button. The view's ROOT goes full screen, not the
bare canvas, so the controls overlay, labels, the selection, keyboard and
gamepad focus, the camera controls and the host's `overlay` all come along:

```tsx
<GraphView3D
  data={data}
  preset="cosmos"
  controls={GraphViewControls}
  overlay={<nav aria-label="Where you are">{/* breadcrumbs, a fact card */}</nav>}
/>
```

- **Put what belongs to the view in `overlay`**, not beside it: breadcrumbs, a
  fact card, a "fly to" select. It is drawn inside the root, passes pointer
  events through to the canvas except on its children, and goes full screen with
  the view. Something rendered next to the view stays behind on the page.
- **The button:** the view draws one (bottom right) unless a `controls` overlay
  is given, which carries it instead: `GraphViewControls` shows a
  `[data-fancy-graph-control="fullscreen"]` button (`data-fancy-graph-toggle="fullscreen"`),
  a custom one gets `fullscreen`, `fullscreenAvailable` and
  `onFullscreenChange` in `GraphControlsProps`. `fullscreenButton` forces the
  view's own button on (`true`) or off (`false`).
- **Controlled:** `fullscreen` / `defaultFullscreen` / `onFullscreenChange(on, { source })`,
  `fullscreenLabels`; the handle's `setFullscreen(on, { source })`;
  `getState().fullscreen` and `fullscreenMode` (`"native"`, `"expanded"`, or
  null); a `fullscreen` activity (`id` `"on"` / `"off"`).
- **How:** fancy-3d's one implementation (`@particle-academy/fancy-3d/fullscreen`,
  React only). The Fullscreen API where it is available, else a fixed,
  full-viewport "expanded" mode (iPhone Safari, or a request made without a
  user gesture, as an agent's is). Esc and the button exit; in expanded mode Esc
  leaves full screen without also clearing the selection, as in native mode.
  The canvas resizes and the camera follows. The canvas keeps keyboard focus.
- **Popups:** react-fancy 6.32.0+ menus and listboxes opened from the overlay
  stay visible in native full screen (they portal into the full-screen element).
- `<GraphScene3D>` on your own fancy-3d-three `<Stage>` uses that Stage's full
  screen (the Stage draws the button); `<GraphSceneOnStage>` on a bare stage
  has none, and its controls show no button.

**Styles.** Every class the overlay shows comes from react-fancy's dist (the
overlay writes none of its own), so Tailwind v4 must scan react-fancy. In the
CSS file Tailwind builds, with the path relative to that file (a typical Vite
app's `src/index.css` or `resources/css/app.css`, one level below the project
root):

```css
@import "tailwindcss";
@source "../node_modules/@particle-academy/react-fancy/dist/**/*.js";
```

Without it the switches, buttons and panel render unstyled. fancy-graph's own
dist needs no `@source` line.

**Accent.** react-fancy's switches and buttons take their "on" colour from a
`color` prop, not from a CSS token, and default to blue. The overlay passes its
`color` through to every switch, the chosen link mode and the open panel button:

```tsx
const TealControls = (p: GraphControlsProps) => <GraphViewControls {...p} color="teal" />;

<GraphView3D data={data} preset="cosmos" controls={TealControls} />;
```

Any Tailwind palette name works. For your own colour use `color="brand"` and set
react-fancy's brand variables (`--color-brand`, `--color-brand-contrast`,
`--color-brand-hover`) in your `@theme` or on `:root`.

Each clickable element carries a stable handle for tests and agents:
`[data-fancy-graph-toggle="layer:<id>"]`, `"link-mode:all"`,
`"link-mode:focus"` and `"motion"`, on the switch or radio button itself.

Each built-in has a factory for its options: `networkPreset`, `radialPreset`,
`hierarchyPreset`, `clusteredPreset` (2D) and `network3DPreset`,
`cosmosPreset`, `layeredPreset` (3D). A preset is plain data, so your own is
just another object of the same shape.

### Theme

`theme` is `"light"`, `"dark"`, `"auto"` (the default: a `.dark` or
`[data-theme=dark]` ancestor, else the system) or overrides on a base, such as
per-type colours:

```tsx
<GraphView data={data} theme={{ base: "dark", typeColors: { person: "#f472b6", place: "#34d399" } }} />
```

Every colour also reads a CSS variable, so your kit's tokens can drive it:
`--fancy-graph-background`, `--fancy-graph-link`, `--fancy-graph-label`,
`--fancy-graph-label-halo`, `--fancy-focus`, and `--fancy-graph-type-<type>` for
each node type (`.app { --fancy-graph-type-person: var(--color-pink-400); }`).
An explicit `nodeColor` or a node's own `color` still wins. Types you leave to
the palette each get their own colour within a graph (up to the palette's ten),
the same whatever order the data arrives in.

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
premultiplied blending, back-to-front order and fresh positions every frame.
The `cosmos` preset (galaxies with cores, stars, planets with skins,
atmospheres and rings, moons, comets with GPU tails, light arcs,
constellations, a sky, dust) is built with nothing else;
`src/three/presets/` is the worked example.

It is deterministic: the same data is the same sky on every load, whatever its
input order, and galaxies take their shape (arms, twist, size, tilt, bulge,
warmth) from their key and how their members link. Planets orbit stars, moons
orbit planets, systems turn about their galaxy's core and the universe turns
slowly about its centre, all frozen by `paused` and reduced motion. A node can
pin its place with an optional JSON field: `cosmos: { galaxy: [x, y, z] }` puts
its galaxy's core there (and stops it orbiting), `cosmos: { offset: [x, y] }`
puts the node there relative to its galaxy's core (or, outside a galaxy, its
star). Bad values are ignored with a dev warning, never thrown; see
[AGENTS.md](./AGENTS.md#the-cosmos).

### What the kit owns

Camera (pan, zoom, rotate, touch, keyboard, fly-to, follow), picking, selection,
hover, neighbour highlighting, search focus, labels with overlap handling,
reduced motion, stable `data-fancy-graph*` handles, activity events, and
gamepad-only control (`stepFocus`, `neighbors`, `orbit` / `pan` / `zoom`, a focus
ring, neighbourhood mode). Every limit is configurable through `limits`.

## Performance (measured, not promised)

Measured 2026-11-28 with this repo's own harness (`bench/`), synthetic
knowledge graphs shaped like the first consumer's (eight node types, links
mostly within a type). The 3D rows are the cosmos as that consumer configures
it, a galaxy per type, so each graph carries eight synthetic core nodes too
(658 and 4,008 bodies). Raw numbers: `bench/results/*.json`.

**Frame cost**: the time to produce one frame (layout step, projection,
picking buffer, labels, draw submission), in a headless Chromium 159 at
1280x800. "Frame interval" is the real time between frames while the view
animates; 16.7 ms is 60 fps, the display's limit.

GPU: NVIDIA RTX 3070 through ANGLE / Direct3D 11.

| View | Nodes / links | Frame cost p50 / p95 / max (ms) | Frame interval p50 / p95 (ms) |
|---|---|---|---|
| 2D canvas | 650 / 900 | 0.2 / 0.4 / 0.7 | 16.7 / 16.7 |
| 2D canvas | 4,000 / 6,000 | 1.0 / 1.4 / 2.1 | 16.7 / 16.8 |
| 3D cosmos | 650 / 900 | 0.4 / 0.7 / 0.9 | 16.7 / 16.7 |
| 3D cosmos | 4,000 / 6,000 | 2.4 / 3.3 / 3.8 | 16.7 / 16.8 |

The 0.4.0 cosmos costs more per frame than 0.3.0's (1.0 ms p50 at 4,000
nodes, same harness): each body now carries its look (skin, atmosphere, rings,
a second colour), and labels are ranked by what they name. It stays a small
part of a 16.7 ms frame, and the frame interval is unchanged. Run to run, these
move by a few tenths of a millisecond.

No GPU (SwiftShader, a CPU rasteriser; a floor for weak hardware, 10-frame
samples):

| View | Nodes / links | Frame cost p50 / p95 (ms) | Frame interval p50 / p95 (ms) |
|---|---|---|---|
| 2D canvas | 650 / 900 | 0.3 / 1.1 | 16.7 / 16.7 |
| 2D canvas | 4,000 / 6,000 | 1.7 / 2.7 | 16.7 / 16.8 |
| 3D cosmos | 650 / 900 | 1.3 / 2.3 | 33.4 / 50.1 |
| 3D cosmos | 4,000 / 6,000 | 6.4 / 16.0 | 133.4 / 1283.2 |

Without a GPU the 3D cosmos's frame interval grows far past its frame cost, so
the time goes to rasterising (its glows, procedural surfaces, galaxy discs and
dust are large-area shader work), not to the kit. The 2D view is the better
choice there.

**Layout cost** (Node 24):

| Layout | Nodes / links | Step p50 / p95 (ms) |
|---|---|---|
| force, 2D | 650 / 900 | 1.0 / 1.8 |
| force, 2D | 4,000 / 6,000 | 7.1 / 11.3 |
| force, 3D | 4,000 / 6,000 | 12.9 / 18.7 |
| cosmos orbits (every frame) | 4,000 / 6,000 | 0.28 / 0.48 |

The cosmos also does its placement once, when the data or a lens changes: 47
ms at 650 nodes and 257 ms at 4,000 (spreading free systems by their links is
most of it; `limits.maxSpreadTicks` bounds it). A force step at 4,000 nodes
takes much of a frame, which is why `workerLayout` moves built-in layouts off
the main thread above `limits.workerThreshold` (1,500 nodes by default).

## License

MIT
