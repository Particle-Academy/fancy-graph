# Contributing to @particle-academy/fancy-graph

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Build and test

```bash
npm run build   # tsup: index, core, worker, three
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
- `src/three/` is the only code that may import `three` or fancy-3d-three.
  `tests/entry-isolation.test.ts` walks the import graph from every other entry.
- `examples/cosmos/` is the first acceptance case (beachhead's Cosmos view) built
  only through the public plug points. It is consumer code and does not ship.

## Invariants

- No runtime dependencies, and no third-party code without owner approval.
- Every limit is in `GraphLimits` with a default in `DEFAULT_LIMITS`.
- Labels and any text from data go into the DOM through `textContent` only.
- The 3D renderer must keep working on fancy-3d-three 0.2.1, which has no
  `controls` on its Stage context: `three/engine.ts` (`Orbit`) falls back to
  capturing the target from `camera.lookAt`. Tests run both paths.
- Focus and selection stay visually distinct: `hasHighlightRing` decides the
  solid ring, the focus has its own dashed ring.

## Changelog

Update `CHANGELOG.md` (Keep a Changelog, `[Unreleased]` at the top) in the same
commit as the change.
