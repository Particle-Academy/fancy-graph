# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes may land in MINOR releases. Read the entry, not
> the version number. The API stays pre-1.0 until a second consumer has used it.

## [Unreleased]

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
    `<Stage>`, with `createInstancedLayer` (custom GLSL 3 instanced shaders,
    additive or premultiplied blending, back-to-front order, per-frame
    positions), `createPointsLayer`, `nodeLayer3D`, `linkLayer3D`. Uses the
    Stage's `controls` handle when present and falls back to the Stage's
    `camera.lookAt(controls.target)` on fancy-3d-three 0.2.1.
  - Kit-owned camera (pan, zoom, rotate, touch, keyboard, fly-to, follow),
    picking, neighbour highlighting, search focus, labels with overlap
    handling, reduced motion, stable `data-fancy-graph*` handles, activity
    events, and every limit configurable through `limits`.
  - Gamepad / keyboard-only control: `neighbors(id)`, `stepFocus` by screen
    direction or next / previous link, `orbit` / `pan` / `zoom` for analog
    input, a focus ring distinct from selection, `neighborhood` mode, and
    labels always shown for the focus and its neighbours.
  - A measured benchmark at 650 nodes and at 4,000 nodes / 6,000 links (README).

### Changed

- CI: re-pin the org third-party allowlist to the commit that grants `three`
  to this package (owner, q_2b73af5d, 2026-11-26). Consumers do nothing.
