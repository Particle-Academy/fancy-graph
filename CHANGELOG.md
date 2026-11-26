# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes may land in MINOR releases. Read the entry, not
> the version number. The API stays pre-1.0 until a second consumer has used it.

## [Unreleased]

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
