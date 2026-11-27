# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes may land in MINOR releases. Read the entry, not
> the version number. The API stays pre-1.0 until a second consumer has used it.

## [Unreleased]

## [0.2.1] - 2026-11-27

**Consumer action: none.** Existing handles keep their place and meaning, and
the overlay looks the same unless you pass the new `color`. Reported by two
apps using `GraphViewControls`.

### Fixed

- **Every clickable control in the overlay has its own handle, on the element
  that takes the click.** react-fancy's Switch puts `data-*` on its wrapper, so
  `data-fancy-graph-layer="<id>"` and `data-fancy-graph-control="motion"` named
  a div that ignores clicks, and the link-mode options had no handle at all
  (only their label text). Now the `role="switch"` / `role="radio"` buttons
  carry `data-fancy-graph-toggle`: `layer:<id>`, `link-mode:all`,
  `link-mode:focus`, `motion`. The wrapper handles stay where they were.

### Added

- **`color` on `GraphViewControls`**, react-fancy's own accent prop (a palette
  name such as `"teal"`, or `"brand"` for the host's `--color-brand`
  variables), passed to every switch, the chosen link mode and the open panel
  button. Unset, react-fancy's default blue applies, as before. react-fancy's
  Switch, MultiSwitch and Button take their accent only from `color`, so a
  host had no way to set it for the overlay.

### Docs

- README and AGENTS.md: the Tailwind v4 `@source` line the overlay needs. It is
  react-fancy's (`@source "../node_modules/@particle-academy/react-fancy/dist/**/*.js";`),
  because the overlay writes no class names of its own; fancy-graph's dist
  needs none, and a test now holds that.
- README and AGENTS.md: how to set the overlay's accent (`color="teal"`, or
  `color="brand"` with the brand variables), and the new toggle handles.

## [0.2.0] - 2026-11-27

**Consumer action: none.** Everything here is additive; existing props keep
their meaning and defaults, and nothing new is drawn unless you ask for it.
Reported by the owner using the cosmos preset (2026-11-27): no practical way
to unselect a node, and no way to switch orbits or link lines on or off.

### Added

- **Layer visibility as controlled JSON.** `layers` / `defaultLayers` /
  `onLayersChange` on `<GraphView>`, `<GraphView3D>` and `<GraphScene3D>`, over
  the layers the preset declares (new `layers: GraphLayerSpec[]` on
  `GraphPreset2D` / `GraphPreset3D`): `links`, `labels`, `clusters`,
  `background`, and the cosmos's `orbits`. In, a partial map
  (`{ orbits: true }`); out, the full map. Handle: `getLayers()`,
  `setLayer(id, visible, { source })`; `getState()` reports `layers`. A custom
  3D layer joins a visibility layer with `layer: "<id>"`, else it belongs to
  its slot. Headless helpers in the core: `resolveLayers`, `layerMap`,
  `mergeLayerSpecs`, `isLayerVisible`, `effectiveLinkVisibility`,
  `DEFAULT_LAYERS`.
- **Orbit paths for the cosmos** (`cosmosOrbits()`, the `orbits` layer): one
  faint ring per planet and asteroid around its star, brighter for the
  highlighted bodies. There were none before, so there was nothing to switch;
  the preset declares them **off by default** so its look is unchanged. Options
  through `cosmosPreset({ orbits: { segments, alpha } })`.
- **Link mode and motion are controllable:** `defaultLinkVisibility` /
  `onLinkVisibilityChange` beside the existing `linkVisibility`, and
  `defaultPaused` / `onPausedChange` beside `paused`. Handle:
  `setLinkVisibility`, `setPaused`; `getState()` reports `linkVisibility`,
  `paused` and `animated`. Activity events `layer`, `links` and `motion`.
- **`clearSelection()`** on the handle, and stable root handles
  `data-fancy-graph-layers`, `-link-visibility`, `-paused`.
- **A `controls` slot and an optional overlay.** `controls={GraphViewControls}`
  (new `@particle-academy/fancy-graph/controls` entry) draws a clear-selection
  button and a panel with a switch per declared layer, all links or the
  selection's only, and motion for animated layouts. Built from react-fancy's
  `Button`, `Card`, `Switch` and `MultiSwitch`; every control has a
  `data-fancy-graph-control` handle; every string is in `labels`. Any component
  taking `GraphControlsProps` can fill the slot. In 3D it renders into the
  Stage's overlay, so its clicks never reach the picker.
  **Opt-in, not on by default:** react-fancy brings its own styles and
  dependencies, and on by default would make every consumer install it and
  draw new UI over every existing embed. It is an optional peer
  (`>=5.13.0`, when the subpaths it uses appeared), imported only by
  `/controls`; the core, root and `/three` entries never load it.
- A headless browser check of the above on the cosmos, through real clicks, in
  `bench/browser/run.mjs`.

### Changed

- **Clicking the selected node clears the selection** (2D and 3D). In 3D the
  click used to be ignored; in 2D it re-reported the same id. In a dense view
  such as the cosmos there may be no empty space left to click, so this was
  the only way to unselect without the keyboard.
- **3D picking prefers a direct hit.** It used to take the node nearest the
  camera among everything within `pickRadius` (7 px), so a tiny asteroid a few
  pixels off but in front stole a click aimed dead at a star behind it, which
  also defeated clicking the selected node to clear it. Now a node under the
  pointer wins (nearest the camera among those); a near miss counts only when
  nothing is directly hit, and then the nearest on screen wins. `pickScreen`
  in `"depth"` mode changes the same way; `"nearest"` (2D) is unchanged.
- Clearing the selection releases a camera follow of that node.
- Each 3D layer is mounted into its own group (`LayerContext3D.group`), so
  one can be hidden without its slot-mates. Layers that add to `ctx.group`
  need no change.
- `GraphActivity["type"]` adds `"layer"`, `"links"` and `"motion"`. A
  `switch` over it that must be exhaustive needs the three new cases.

## [0.1.0] - 2026-11-26

### Added

- First version (CC-fancy-0062): a knowledge-graph map viewer.
  - `<GraphView>`, a controlled 2D canvas view over plain JSON `{ nodes, links }`:
    selection, hover, focus, search and camera as props and callbacks.
  - A layout contract (a function, or a stepper that may move every node every
    frame) with hand-written `forceLayout` (Barnes-Hut, 2D/3D, `groupPull`),
    `radialLayout` and `hierarchyLayout`, and `workerLayout` to run them in a
    Worker (`/worker` entry) above a configurable size.
  - Pluggable rendering per node, link, cluster and background.
  - `/three`: `<GraphView3D>` and `<GraphScene3D>` on fancy-3d-three's
    `<Stage>`, built entirely on fancy-3d-three: three.js comes only through
    `@particle-academy/fancy-3d-three/three` (fancy-3d-three 0.3.0 or later, an
    optional peer), and fancy-graph declares no `three` dependency of its own.
    With `createInstancedLayer` (custom GLSL 3 instanced shaders,
    additive or premultiplied blending, back-to-front order, per-frame
    positions), `createPointsLayer`, `nodeLayer3D`, `linkLayer3D`. Uses the
    Stage's `controls` handle, and falls back to `camera.lookAt(controls.target)`
    for a Stage-like context without one.
  - Kit-owned camera (pan, zoom, rotate, touch, keyboard, fly-to, follow),
    picking, neighbour highlighting, search focus, labels with overlap
    handling, reduced motion, stable `data-fancy-graph*` handles, activity
    events, and every limit configurable through `limits`.
  - Gamepad / keyboard-only control: `neighbors(id)`, `stepFocus` by screen
    direction or next / previous link, `orbit` / `pan` / `zoom` for analog
    input, a focus ring distinct from selection, `neighborhood` mode, and
    labels always shown for the focus and its neighbours.
  - A measured benchmark at 650 nodes and at 4,000 nodes / 6,000 links (README).
  - Ready-made view presets (owner, 2026-11-26), each a layout plus renderers
    plus defaults, usable as-is or overridden piece by piece through the usual
    props: 2D `network` (the default), `radial` (ego view), `hierarchy` and
    `clustered`; 3D `network` (the default), `cosmos` and `layered` (by type or
    by a date or number field). `preset` prop on every view, `GRAPH_PRESETS_2D`
    / `GRAPH_PRESETS_3D`, and a factory per preset. The cosmos now ships as a
    preset and stays the reference example.
  - Theming: `theme` (`light`, `dark`, `auto`, or overrides with per-type
    colours), with every colour also read from a CSS variable so kit tokens can
    drive it (`--fancy-graph-background`, `--fancy-graph-type-<type>`, ...).
  - Types left to the palette each get their own colour within a graph
    (`assignTypeColors`): a type keeps its hashed colour unless another type
    already holds it. Hashing each type on its own put five ordinary types
    (person, project, topic, place, event) on three colours, found by the
    fancy-labs graph benchmark.
  - `positionOf(id)` on every view handle; `forceLayout({ gravity })`; layer
    materials take `side: "double"`.

### Changed

- CI installs `three` for the tests only, in a separate `--no-save` step at the
  version fancy-3d-three's own dev pin uses (`^0.184.0`), because the kit's
  standard `--legacy-peer-deps` install skips fancy-3d-three's peers. The
  package still declares no `three` dependency. Dev and test use of three is
  approved by the owner (ForceTheQuestion q_2b73af5d, 2026-11-26). Consumers do
  nothing.
