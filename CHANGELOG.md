# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes may land in MINOR releases. Read the entry, not
> the version number. The API stays pre-1.0 until a second consumer has used it.

## [Unreleased]

## [0.5.0] - 2026-11-28

**Every view goes full screen, with its whole control UX inside, and the
cosmos is galactic out of the box again.** This release folds in 0.4.1, which
was never published: with 0.4.0's default lens a dense graph collapsed into a
few giant systems, each a dartboard of dozens of orbit rings, and the host's
grouping changed nothing. Now the grouping shapes the sky.

**Consumer action:** none for most. Four things to know: (1) a full-screen
button now shows in the bottom-right corner of a view with no `controls`
overlay (`fullscreenButton={false}` hides it); (2) the package now has a
required peer, `@particle-academy/fancy-3d >=0.7.0` (React only; npm 7+
installs it), and the 3D peer moved to `@particle-academy/fancy-3d-three
>=0.5.0`. To take breadcrumbs or a fact card into full screen, render them in
the new `overlay` prop instead of beside the view; (3) the cosmos forms a
galaxy per node group by default. For 0.4.0's galaxy-less sky back, pass
`cosmos={{ galaxies: false }}` (or `"none"`) and the layout is 0.4.0's exactly
(the suite holds it to fingerprints taken from the 0.4.0 code); (4) those
default galaxy centres are synthetic nodes (`cosmos:galaxy:<group>`,
`synthetic: true`), as any `{ field }` galaxy lens already made in 0.4.0, and
they are now kept out of every count, search and neighbour list (see Fixed).

### Added

- **Full screen on `<GraphView>`, `<GraphView3D>` and `<GraphScene3D>`.** The
  view's ROOT goes full screen, not the bare canvas, so the controls overlay,
  labels, selection, keyboard and gamepad focus, and camera controls keep
  working inside it. The mechanism is fancy-3d's one implementation
  (`@particle-academy/fancy-3d/fullscreen`): the Fullscreen API, else a fixed
  full-viewport mode (iPhone Safari, or an agent's request without a user
  gesture). Esc and the button exit; in the fallback Esc leaves full screen
  without also clearing the selection, as the browser's native Esc does. The
  canvas and camera follow the new size.
- **`overlay`**: content drawn over the view, inside its root, so the host's
  breadcrumbs, fact cards and selects go full screen with it. Pointer events
  pass through to the canvas except on its children.
- **The button.** The view draws its own (bottom right) when there is no
  `controls` overlay; `GraphViewControls` carries one instead
  (`[data-fancy-graph-control="fullscreen"]`, `data-fancy-graph-toggle="fullscreen"`,
  labels `fullscreenEnter` / `fullscreenExit`). `fullscreenButton` forces the
  view's own on or off.
- **Controlled state, handle, state and activity:** `fullscreen`,
  `defaultFullscreen`, `onFullscreenChange(on, { source })`,
  `fullscreenLabels`; `setFullscreen(on, { source })` on every handle (false
  where nothing owns full screen); `getState().fullscreen` and
  `fullscreenMode`; a `fullscreen` activity (`id` `"on"` / `"off"`).
  `GraphControlsProps` gains `fullscreen`, `fullscreenAvailable` and
  `onFullscreenChange`, so a custom controls overlay can draw its own button.
  New types: `GraphFullscreenProps`, `GraphControlsFullscreen`,
  `GraphFullscreenHandle`, `GraphFullscreenState`.
- `<GraphScene3D>` inside your own `<Stage>` uses that Stage's full screen;
  `<GraphView3D>` owns it on its root, and its Stage defers.
- `autoGalaxyField(nodes)` and `AUTO_GALAXY_FIELDS` (the field the default
  lens groups by), `orbitSystemWeights` and `orbitFade` (the orbit-path
  selection and fade, headless) and `COSMOS_ORBIT_DEFAULTS`, from `./three`.
- Browser captures of the kit map grouped by family and by language, and the
  typescript system up close (`docs/presets/3d-cosmos-kit*.png`); the harness
  regroups a mounted view and fails if the galaxies do not re-form. It also
  checks full screen (the native API by a click, the fallback for an agent's
  request, Esc, 2D and 3D, the view growing to the viewport and back) and the
  synthetic counts, search, neighbour order and first focus step.

### Changed

- **Default: a spiral galaxy per node group.** With no `galaxies` lens and two
  or more distinct `node.group` values (or `data.type` values), each group is
  a spiral galaxy around a core node. Changing the grouping re-forms the
  galaxies, and the bodies fly to their new places (the 1.2 s transition).
  An explicit `galaxies: { by: ... }` still wins. Not under
  `systems: { by: { relation } }`, whose hierarchy already says what orbits
  what (its groups usually name body kinds: star, planet, moon). **Opt out
  with `galaxies: false`** (or `"none"`, or `null`).
- **Systems in a galaxy stay small.** A new limit,
  `limits.maxPlanetsPerSystem` (default 12), caps the planets and moons one
  system holds; a `"hubs"` system also holds at most `hubShare` (a new cosmos
  option, default 0.2) of its galaxy. The overflow becomes stars of their own
  on the same galaxy's arms, the best-connected staying with the star. A
  membership link given up this way is drawn as light. Without galaxies,
  0.4.0's systems stand unchanged.
- **Orbit paths are on by default, and subtle.** Faint rings (alpha 0.07,
  0.3 highlighted, 0.02 dimmed), drawn only for the selected, focused or
  hovered system and the 3 systems nearest the camera (fainter with rank),
  each fading out as it shrinks on screen. `cosmosOrbits({ nearest, fadePx,
  alpha })` tunes it; `layers={{ orbits: false }}` hides them as before.
- **A lone star on a galaxy's arm is named up close**, as a free star is, so
  the overflow stars stay legible.
- **New required peer: `@particle-academy/fancy-3d` `>=0.7.0 <2.0`.** Only its
  React-only `./fullscreen` subpath is used, by every entry that renders a view
  (the headless `./core` and `./worker` do not). npm 7+ installs it.
- **`@particle-academy/fancy-3d-three` peer `>=0.5.0 <2.0`** (was `>=0.3.0`):
  the Stage that takes `overlay` and defers full screen to `GraphView3D`.
- **`GraphControlsProps` has three more fields.** A controls component RECEIVES
  them, so nothing to do there; only code that builds a `GraphControlsProps`
  object by hand (a test) must add `fullscreen`, `fullscreenAvailable` and
  `onFullscreenChange`.

### Fixed

- **`GraphViewControls` keeps its toggle handles on react-fancy 6.31.0+.**
  react-fancy 6.31.0 moved a `Switch`'s `data-*` from a wrapper onto the
  `role="switch"` button itself, and the overlay looked for the button inside
  the wrapper, so on 6.31.0+ no layer or motion switch carried
  `data-fancy-graph-toggle` and an agent addressing `layer:<id>` or `motion`
  found nothing. It now accepts either placement. **Nothing to do.**
- **The cosmos's synthetic centres no longer leak into the public surface.**
  Since galaxies form by default (above), the `cosmos:galaxy:*` /
  `cosmos:system:*` nodes `prepareCosmos` adds (`synthetic: true`) were counted
  and listed as if they were the input's (lab run 1563: 45 nodes and 85 links
  reported for data of 40 and 45, and `neighbors(n4)` led with the core). Now:
  - `data-fancy-graph-node-count` / `-link-count`, `getState().nodeCount` /
    `linkCount` and the canvas's accessible name report the INPUT. The
    synthetic ones are apart: `data-fancy-graph-synthetic-node-count` /
    `-synthetic-link-count` and `getState().syntheticNodeCount` /
    `syntheticLinkCount`.
  - `neighbors(id)` lists the input's links first, in input order, then a
    gravity link to a core LAST, marked `synthetic: true` (`NeighborLink`).
  - `stepFocus("next")` / `("previous")` (and `cycleNeighbor`) cycle a real
    node's INPUT links only, and wrap among them: `next` from n15 wraps to n1,
    `previous` from n1 to n15. The core's gravity link is never a step (the
    lab's check on the first 0.5.0 build found `previous` from n1 wrapping to
    the core). A core stays reachable by click, breadcrumbs or focusing it
    directly, and a focused core's own stepping walks its members. A real node
    with no input links stays put. Directional steps take a core only when no
    input neighbour lies that way; with nothing focused, `stepFocus` lands on
    the best-connected input node.
  - A core is never highlighted or labelled as a neighbour (neighbourhood mode
    labels the focus and its real neighbours only). Selecting or focusing a
    core still highlights its members.
  - Search (`searchNodes`, `matches`, `onSearchResults`,
    `data-fancy-graph-matches`) returns input nodes only.
  - A core can still be selected, hovered and focused; `onSelectedChange` /
    `onHoveredChange` / `onFocusedChange` then get `meta.synthetic: true`, and
    the activity event carries `synthetic: true`. Input nodes carry no mark.
  - New exports: `isSyntheticLink`, `inputNeighbors`, `countGraph`,
    `GraphCounts`.

  **Consumer action: none**, unless you subtracted the synthetic centres from
  `nodeCount` yourself; stop, or you will subtract them twice. An agent bridge
  reading `getState()` and `neighbors()` gets the corrected values as is.

## [0.4.0] - 2026-11-28

**The cosmos is redesigned (breaking, in a minor: pre-1.0).** Gravity places,
light draws: systems always orbit, galaxies are optional, and every centre is
a node. Design: `.ai/plans/fancy-graph-cosmos-design.md` (approved 2026-11-28).

**Consumer action**, only if you use the `cosmos` preset (2D views, `network`
and `layered` are unchanged):

1. **To keep 0.3.0's galaxy per node type, ask for it.** The cosmos no longer
   makes galaxies on its own. Pass
   `<GraphView3D preset="cosmos" cosmos={{ galaxies: { by: { field: "type" } } }} />`
   (or `cosmosPreset({ galaxies: { by: { field: "type" } } })`). `type` reads
   `node.group`, as before. Without it you get free systems spread by their
   links, which is the new default.
2. **Galaxy centres are now nodes.** With a `{ field }` lens the view adds one
   synthetic node per value, id `cosmos:galaxy:<value>` (or
   `cosmos:system:<value>`), `synthetic: true`, labelled with the value. They
   count in `getState().nodeCount` and `data-fancy-graph-node-count`, can be
   selected, hovered and searched, and count against `limits.maxNodes` /
   `maxLinks`. If you count or list nodes, skip `node.synthetic`. If you passed
   `layout={cosmosLayout(...)}` and `renderers` without the preset, run your
   data through `prepareCosmos(data, lenses)` first, or use the preset.
3. **Galaxy labels are just the name** (`"agent"`, was `"agent · 255"`). Pass
   `clusterLabel` to keep the count.
4. **The layer list changed**: `comets` (comet tails) is new, `links` is
   labelled "Light", and with constellations there are `constellations` and
   one `constellation:<id>` per figure. A saved layer map keeps working:
   unknown ids are ignored, missing ones take their default.
5. **Gravity links are not drawn as lines any more**: the orbit is the drawing
   (switch on the `orbits` layer to see the rings). Only light links get arcs.

If none of these apply, upgrading needs nothing.

### Added

- **Lenses, as JSON, through a new `cosmos` prop** on `GraphView3D` /
  `GraphScene3D` (or `cosmosPreset(options)`):
  - `systems: { by: { relation } | { field } | "hubs" | "none" }`: a relation
    makes its source orbit its target (the star); a source of a planet is a
    moon. `{ field }` makes a star per value. `"hubs"` (the default) makes the
    best-connected nodes stars. `"none"` makes every node a lone star, a
    starfield shaped by its links.
  - `galaxies: { by: { relation } | { field } }`: optional; systems sit on the
    arms of their galaxy's core.
  - `sort: { by: "degree" | "label" | "id" | { field }, dir }`: orbit order
    (inner first) and order along the arms. It reorders and never regroups.
  - `constellations: [{ id, label, color, match: { relation } | { field, value } | { linkedTo } }]`
    or `{ by: { field } }` (one per value).
  - `comets`: `"multi-membership"` (the default), `{ field, within, now }`, or
    both in an array; `false` turns them off.
  - `labels: "semantic" | "size"`.
- **Every centre is a node.** A preset can now `prepare(data)` before the view
  validates it (`GraphPreset3D.prepare`); the cosmos uses it for synthetic
  stars and cores, and leaves synthetic gravity out of degree ranking
  (`meta.lightDegree`). `GraphNode.synthetic` and `GraphLink.synthetic` mark them.
- **Free systems are spread by their light links**, so related systems sit
  near each other, and no two systems or galaxies overlap. Galaxies and free
  systems turn slowly about the centre together.
- **Animated transitions.** Changing a lens or the sort flies every body from
  its old orbit to its new one (`GraphPreset3D.transition`, 1.2 s for the
  cosmos; instant under reduced motion). An animated layout that replaces
  another picks up its animated time (`LayoutRunner.seek`).
- **Comets.** A node with several memberships (several values of the systems
  field, or several gravity links) becomes a traveller on an eccentric loop
  through each of its systems, home first. A node whose time field is within
  the window is an arrival: it keeps its orbit and gets a tail, longer for
  newer. Tails are drawn on the GPU: particles live in the geometry, and the
  CPU writes three path samples per comet per frame. They are their own
  `comets` layer and follow pause and reduced motion. `cometTailPoints()`.
- **Constellations**: figures over the sky (a minimum spanning tree over the
  members' resting places, the same on every build), each its own layer,
  labelled with a clickable `data-fancy-graph-constellation-label="<id>"`, and
  selectable: `selectedConstellation` / `defaultSelectedConstellation` /
  `onSelectedConstellationChange`, the handle's `selectConstellation()` and
  `getConstellations()`, `getState().constellation`, and
  `data-fancy-graph-constellation` on the root. A selected constellation
  highlights its members and the view frames them. Activity type
  `"constellation"`. Placement never changes.
- **Light links as arcs** that glow on focus (`cosmosLight()`); between two
  bodies in one galaxy they run along the arm. `lightArcPoints()` /
  `writeLightArc()` give the path.
- **Semantic zoom labels, on by default**: from far, galaxy and constellation
  names; closer, star names; closer still, planets and moons
  (`GraphPreset3D.labelReach`, `limits.zoomLabelPx`). `labels: "size"` gives
  back the 0.3.0 rule.
- **Flight frames the scale you picked**: selecting a star frames its whole
  system, a core its galaxy (`GraphPreset3D.frameRadius`). **Breadcrumbs**
  (Universe > galaxy > star > planet > moon): `getBreadcrumbs()`,
  `onBreadcrumbsChange`, `data-fancy-graph-breadcrumbs`; select a crumb's id to
  climb back out.
- **Data-driven looks**: `node.cosmos.skin` (`rocky`, `gas`, `ice`, `cratered`,
  `lava`, `ocean`, with up to two colours), `atmosphere` (colour, thickness,
  glow), `rings` (colour, inner, outer, tilt, opacity) and `node.size`, over
  preset defaults per body kind (`cosmosPreset({ looks })`). Skins are
  procedural shaders. `node.cosmos.texture` maps a HOST-SUPPLIED image (https,
  http, relative, `data:image/` or `blob:`; anything else is refused); the kit
  bundles no images. Bad values are ignored and listed in `meta.lookIssues`.
- New body kinds `MOON`, `CORE` and `COMET`; stars and cores get selection rings.
- New limits, all configurable: `maxOrbitDepth` (4), `maxSpreadTicks` (160),
  `maxComets` (256), `maxCometStops` (6), `maxCometTail` (400),
  `maxConstellations` (32), `maxConstellationMembers` (96), `maxTextures` (16),
  `zoomLabelPx` (22).
- `labelCandidates({ limit })` keeps only the highest-priority unforced
  candidates and asks for text only for those (the 3D view passes four times
  `maxLabels`), and `chooseLabelSpot()` picks a name's first clear spot.
  Constellation names use it, so they never sit on each other or on a node's label.
- `GraphPreset3D` gains `prepare`, `configure`, `transition`, `labelReach`,
  `frameRadius`, `path` and `layersFor`, so any 3D preset can use them.
  `LayerFrame3D` gains `layers` and `constellation`; `LayerContext3D` gains `limits`.

### Changed

- **`cosmosOrbits()` is one instanced line set** (a unit circle, each ring's
  centre and axes per instance), so moons' rings follow their moving planets.
  It was one line set per galaxy.
- `node.cosmos.offset` outside a galaxy is relative to the node's star; with
  neither it is reported in `meta.placementIssues`.
- `CosmosGalaxy` gains `key`, `core` and `systems`; its cluster's id is the
  key (the field value, or the core node's id) and `data.core` the core's id.
  `CosmosBody` gains `depth`, `system`, `synthetic`, `extent`, `spacing`,
  `tail` and `look`; `galaxy` is -1 in open space.
- **In the cosmos's default `"focus"` link mode, no light is drawn until
  something is focused**, then only the focus's own (0.3.0 drew every link
  faintly). The sky stays clean until you ask; `linkVisibility="all"` draws
  every light link.
- The 3D view caches each node's cut label text instead of building it every
  frame.
- `cosmosProps()` in the example returns only view props.

## [0.3.0] - 2026-11-27

**Consumer action: none.** The `cosmos` preset looks different (cores,
per-graph galaxy shapes, galaxies that move); nothing you pass needs to change.
Two things to know: if you show the cosmos's layer list, it gains a `cores`
entry; and if you read `CosmosBody.home` as a live position, read the layout's
positions instead, because stars now move.

### Added

- **A galactic core in every cosmos galaxy**: a bright, smooth central bulge,
  tinted by the galaxy's warmth and flattened into its disc, distinct from the
  stars (no star sits inside it). It is its own layer, `cores` (visible by
  default), drawn by the new `cores` slot in `cosmosRenderers()`; tune it with
  `cosmosPreset({ cores: { brightness, minPx } })`.
- **Procedural, deterministic galaxies.** Each galaxy's arm count (2 to 6),
  twist, size, tilt, bulge size, warmth and arm spread are derived from its type
  id and its members: how many there are, how many links they share inside the
  galaxy and out of it. The same data gives the same universe, whatever the
  input order; a different graph gets different-looking galaxies. The shape is
  on each galaxy cluster's `data` (`arms`, `twist`, `coreRadius`, `warmth`,
  `pinned`) and on `CosmosGalaxy`.
- **A motion hierarchy.** Planets and asteroids orbit their stars as before;
  every system now turns about its galaxy's core, and galaxies orbit the graph
  centre (the origin), each at a fixed distance. `paused` and reduced motion
  freeze every level. Speeds: `cosmosLayout` / `cosmosPreset` options
  `galaxyOrbitSpeed` (radians per second, default 0.004) and `spinSpeed` (a
  galaxy's rim speed, world units per second, default 6); 0 stops that level.
- **Optional placement from data: `node.cosmos`** (`GraphCosmosPlacement`),
  plain JSON. `cosmos.galaxy: [x, y, z]` pins the node's galaxy core in world
  space (it then stays put instead of orbiting); `cosmos.offset: [x, y]` or
  `[x, y, z]` pins the node relative to its galaxy's core, in the disc's plane
  (it turns with the galaxy and orbits no star). Absent, the procedural layout
  decides. Members disagreeing on `galaxy`: the first in id order wins.
- **`GraphLimits.maxPlacement`** (default 100000): the largest absolute
  coordinate a `cosmos` placement may ask for, configurable through `limits`.
- `cosmosDust()`, `galaxyLocal()` and the `CosmosCoreOptions` /
  `CosmosPlacementIssue` types are exported from `/three`.

### Changed

- **Bad `cosmos` values are ignored loudly, never thrown**: one `console.warn`
  per layout in development listing them, and `meta.placementIssues` on the
  cosmos layout either way.
- **Layout-supplied clusters follow an animated layout.** The 3D view now
  refreshes a layout's own clusters every frame while it animates (it already
  did for `clusters="group"` and functions), so galaxy labels and
  `getClusters()` track galaxies as they orbit.
- **Galaxy dust and orbit rings are built once per galaxy in its own frame**
  and carried by a model matrix, so moving galaxies cost nothing per point.
  `cosmosOrbits()` now draws one line set per galaxy.
- Stars sit on the arms clear of the core, including a galaxy's only star,
  which used to sit at its centre. The disc's spiral now matches the one stars
  and dust sit on (it used a fixed twist), and its arms melt into the bulge
  instead of pinching to a point at the centre.
- `CosmosBody` gains `pinned`; its `home`, `orbitU` and `orbitV` are now the
  galaxy's rest frame (time 0). `CosmosGalaxy`'s `center`, `u` and `v` are live
  and change in place every step; `restCenter`, `restU`, `restV` hold time 0.

## [0.2.3] - 2026-11-27

**Consumer action: none.** A `limits={{ maxZoom }}` you lowered to stop a small
graph being blown up can be removed; it still works if you keep it.

### Added

- **`GraphLimits.fitMaxZoom`** (default `2`): the highest zoom an automatic 2D
  fit (first view, layout settling, `fit()`, Home) picks. It caps fitting only;
  wheel, pinch, keys and `setCamera` still reach `maxZoom`. Set it through the
  `limits` prop like every other limit.

### Fixed

- **A 2D fit frames whole nodes, not only their centres.** `fitCamera2D` took
  its zoom from the bounding box of node centres, so a small graph (7 nodes,
  3 links, 620x480, `preset="network"`) zoomed in until nodes of 3-14 world
  units were drawn over 100 px across and the outer ones ran past the canvas
  edge. The fit now includes each node's drawn radius (its resolved size,
  including a preset's or the prop's `nodeSize`), so every node lies wholly
  inside the padded viewport, and the zoom stops at `fitMaxZoom`. A large
  graph's fit is unchanged: the radii are a rounding error there and the
  ceiling never binds. `fitCamera2D` takes the radii as a new optional last
  argument; existing calls still compile.
- **A 3D `fit(ids)` frames each node's drawn radius too.** It sized the view
  from the bounding sphere of the centres plus a fixed 4 units, so large nodes
  at the edge were cut off. Home (`measure()`) already included the radii and is
  unchanged.

## [0.2.2] - 2026-11-27

**Consumer action: none.** A `key={preset}` you added to remount the 3D view on
a preset change can be removed; it still works if you keep it.

### Fixed

- **A 3D view's `preset` can change in place.** Switching a mounted
  `GraphView3D` / `GraphScene3D` into `"cosmos"` (from `"network"` or
  `"layered"`) threw `Cannot read properties of undefined (reading 'bodies')`
  since 0.1.0. The view applied the new preset's options (its layers and its
  `nodeSize`) one step before its new layout, so the cosmos layers and sizes
  read the old layout's meta, which has no bodies. The layout and layers now
  change together first, then the options. Every ordered pair of 3D presets, and
  of 2D presets, is now tested switching in place: no throw, and the new
  preset's layers, layout and clusters match a fresh mount. The headless browser
  check switches a real view through every pair too.

### Changed

- AGENTS.md: an Upgrading note. A running Vite dev server keeps its prebundled
  old version after an upgrade until it restarts (or `vite --force`).

## [0.2.1] - 2026-11-27

**Consumer action: none.** Existing handles keep their place and meaning, and
the overlay looks the same unless you pass the new `color`. Reported by two
apps using `GraphViewControls`.

### Added

- **`color` on `GraphViewControls`**, react-fancy's own accent prop (a palette
  name such as `"teal"`, or `"brand"` for the host's `--color-brand`
  variables), passed to every switch, the chosen link mode and the open panel
  button. Unset, react-fancy's default blue applies, as before. react-fancy's
  Switch, MultiSwitch and Button take their accent only from `color`, so a
  host had no way to set it for the overlay.

### Changed

- README and AGENTS.md: the Tailwind v4 `@source` line the overlay needs. It is
  react-fancy's (`@source "../node_modules/@particle-academy/react-fancy/dist/**/*.js";`),
  because the overlay writes no class names of its own; fancy-graph's dist
  needs none, and a test now holds that.
- README and AGENTS.md: how to set the overlay's accent (`color="teal"`, or
  `color="brand"` with the brand variables), and the new toggle handles.

### Fixed

- **Every clickable control in the overlay has its own handle, on the element
  that takes the click.** react-fancy's Switch puts `data-*` on its wrapper, so
  `data-fancy-graph-layer="<id>"` and `data-fancy-graph-control="motion"` named
  a div that ignores clicks, and the link-mode options had no handle at all
  (only their label text). Now the `role="switch"` / `role="radio"` buttons
  carry `data-fancy-graph-toggle`: `layer:<id>`, `link-mode:all`,
  `link-mode:focus`, `motion`. The wrapper handles stay where they were.

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
