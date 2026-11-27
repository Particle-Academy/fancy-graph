# Contributing to @particle-academy/fancy-graph

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Build and test

```bash
npm run build   # tsup: index, core, worker, three, controls
npm run lint    # tsc --noEmit (src, tests, examples, bench) && eslint .
npm test        # vitest run
npm run bench   # layout timings in Node -> bench/results/layout-times.json
```

Browser check and frame-time benchmark (headless, never opens a window):

```bash
npx tsup --config bench/browser/tsup.config.ts
PLAYWRIGHT_MODULE=<path to a playwright package> PROFILE=hardware node bench/browser/run.mjs
PLAYWRIGHT_MODULE=<path to a playwright package> PROFILE=software node bench/browser/run.mjs
```

It uses whatever Playwright `PLAYWRIGHT_MODULE` points at and that copy's
browsers; it never installs any. It fails on any console error or warning in the
hardware profile, writes `bench/results/frame-times-<profile>.json`, and puts
screenshots in `SHOTS_DIR`. Update the README's numbers from those files, never
by hand-typing a figure you did not measure.

## Layout of the source

- `src/core.ts` is the headless entry: `graph.ts` (validation, limits),
  `interaction.ts` (states, search, picking, focus stepping), `labels.ts`,
  `camera.ts`, `clusters.ts`, `layout/` (contract, force + Barnes-Hut,
  radial, hierarchy, worker).
- `src/index.ts` adds React and the 2D renderer (`react/`, `render2d/`). It
  re-exports the core module by module, not `export *`, to avoid an empty
  shared chunk; `tests/entry-isolation.test.ts` holds the two lists equal.
- `src/three/` is the only code that may import fancy-3d-three, and nothing in
  the repo imports `three` directly: three.js comes only through
  `@particle-academy/fancy-3d-three/three`, and `package.json` has no `three`
  dependency of any kind (owner, 2026-11-26). `tests/entry-isolation.test.ts`
  walks the import graphs and scans every file to hold both. `@types/three`
  stays a devDependency because the re-export's declarations need it.
- `src/controls/` is the only code that may import `@particle-academy/react-fancy`
  (an optional peer, the `./controls` entry). The controls contract
  (`GraphControlsProps`, the slot that renders it) is in `src/react/controls.ts`
  and imports no react-fancy, so the core and `./three` entries never pull it in;
  `tests/entry-isolation.test.ts` holds that.
- Layer visibility (`src/layers.ts`) is headless. A preset declares its layers;
  the 2D engine checks ids where it draws, the 3D engine gives every layer its
  own group and hides that group (and skips its `update`). A new drawn part
  gets an id and a `GraphLayerSpec` in the presets that draw it.
- `src/presets/` (2D) and `src/three/presets/` (3D) hold the built-in views.
  Each is only a layout plus renderers plus defaults, built on the public plug
  points; the cosmos lives there too and is the reference example. A new preset
  joins `GRAPH_PRESETS_2D` / `GRAPH_PRESETS_3D`, the parameterised tests in
  `tests/presets2d.test.tsx` / `tests/presets3d.test.tsx`, the gallery in
  `bench/browser/run.mjs` (its screenshot in `docs/presets/`), and the README.
- `examples/cosmos/` is the first acceptance case (beachhead's Cosmos view): its
  data and colours, reusing the cosmos preset. It does not ship.

## Invariants

- No runtime dependencies, and no third-party code without owner approval.
- Every limit is in `GraphLimits` with a default in `DEFAULT_LIMITS`.
- Labels and any text from data go into the DOM through `textContent` only.
- The 3D renderer uses the Stage's `controls` handle. It also still works with
  a Stage-like context that has none (`three/engine.ts`, `Orbit`, captures the
  target from `camera.lookAt`), and tests run both paths.
- Focus and selection stay visually distinct: `hasHighlightRing` decides the
  solid ring, the focus has its own dashed ring.

## Changelog

Update `CHANGELOG.md` (Keep a Changelog, `[Unreleased]` at the top) in the same
commit as the change.
