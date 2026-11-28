// Headless browser check + frame-time benchmark.
//
//   npx tsup --config bench/browser/tsup.config.ts
//   PLAYWRIGHT_MODULE=<path to playwright> SHOTS_DIR=<dir> node bench/browser/run.mjs
//
// Uses whatever Playwright PLAYWRIGHT_MODULE points at (in this estate, the
// copy Genie hosts, with its browsers via PLAYWRIGHT_BROWSERS_PATH); it never
// installs browsers. Headless only: no window opens. Writes the measured
// frame times to bench/results/frame-times.json, and fails on any console
// error or page error.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mod = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const pw = await import(mod.includes(":") || mod.startsWith("/") ? pathToFileURL(join(mod, "index.js")).href : mod);
const chromium = pw.chromium ?? pw.default.chromium;
const shots = resolve(process.env.SHOTS_DIR ?? join(here, "..", "results"));
mkdirSync(shots, { recursive: true });

// PROFILE=hardware (default): the machine's GPU through ANGLE/D3D11, still headless.
// PROFILE=software: SwiftShader, a CPU rasteriser; a floor for machines with a weak or no GPU.
const profile = process.env.PROFILE === "software" ? "software" : "hardware";
const args = profile === "hardware" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const shoot = profile === "hardware";
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const consoleLog = [];
// Every message carries the phase it arrived in, so a warning can be traced to the step that caused it.
let phase = "load";
page.on("console", (m) => consoleLog.push({ phase, type: m.type(), text: m.text() }));
page.on("pageerror", (e) => consoleLog.push({ phase, type: "pageerror", text: String(e) }));

await page.goto(pathToFileURL(join(here, "index.html")).href);
await page.waitForFunction(() => document.title === "fancy-graph harness ready");
const renderer = await page.evaluate(() => window.harness.webgl());
const version = browser.version();
const results = { profile, measuredAt: new Date().toISOString(), browser: `chromium ${version} (headless)`, webgl: renderer, viewport: "1280x800 @1x", cases: [] };

async function shot(opts) {
  if (shoot) await page.screenshot(opts);
}

async function bench(label, mount, opts) {
  phase = `bench: ${label}`;
  const state = await page.evaluate(([m, o]) => window.harness[m](o), [mount, opts]);
  await page.evaluate(() => window.harness.waitFrames(30));
  // The software floor is slow enough at 4,000 nodes (seconds per frame) that a smaller sample is the only practical one.
  const sync = await page.evaluate((n) => window.harness.measureSync(n), profile === "software" ? 10 : 240);
  const raf = await page.evaluate((drive) => window.harness.measureRaf(4000, drive), mount === "mount2d");
  const entry = { label, renderer: mount === "mount2d" ? "2d canvas" : "3d webgl (cosmos)", nodes: state.nodeCount, links: state.linkCount, frameCostMs: sync, rafIntervalMs: raf };
  results.cases.push(entry);
  console.log(JSON.stringify(entry));
  return state;
}

// ---- 2D
await bench("2D, 650 nodes", "mount2d", { nodes: 650, links: 900 });
await shot({ path: join(shots, "2d-650.png") });
phase = "2D search + selection";
await page.evaluate(() => window.harness.mount2d({ nodes: 650, links: 900, search: "nova", selected: "agent-3" }));
await page.evaluate(() => window.harness.waitFrames(20));
await shot({ path: join(shots, "2d-650-selected-search.png") });
const labels2d = await page.evaluate(() => [...document.querySelectorAll("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").length);
await bench("2D, 4,000 nodes / 6,000 links", "mount2d", { nodes: 4000, links: 6000 });
await shot({ path: join(shots, "2d-4000.png") });

// ---- 3D cosmos
await bench("3D cosmos, 650 nodes", "mount3d", { nodes: 650, links: 900 });
await shot({ path: join(shots, "3d-cosmos-650.png") });
phase = "3D fly to galaxy";
await page.evaluate(async () => {
  const h = window.harness.handle();
  h.flyToCluster(h.getClusters()[1].id);
  await window.harness.waitFrames(150);
});
await shot({ path: join(shots, "3d-cosmos-galaxy.png") });
phase = "3D select + follow";
const picked = await page.evaluate(async () => {
  const h = window.harness.handle();
  h.select("agent-0", { source: "agent" });
  await window.harness.waitFrames(200);
  return h.getState().selected;
});
await shot({ path: join(shots, "3d-cosmos-follow-star.png") });
const handles3d = await page.evaluate(() => {
  const r = document.querySelector("[data-fancy-graph]");
  return { renderer: r?.getAttribute("data-fancy-graph-renderer"), nodes: r?.getAttribute("data-fancy-graph-node-count"), selected: r?.getAttribute("data-fancy-graph-selected"), labels: [...document.querySelectorAll("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").length, clusterLabels: document.querySelectorAll("[data-fancy-graph-cluster-label]").length };
});
await bench("3D cosmos, 4,000 nodes / 6,000 links", "mount3d", { nodes: 4000, links: 6000 });
await shot({ path: join(shots, "3d-cosmos-4000.png") });

// Preset gallery: every built-in preset as a consumer uses it, one screenshot each into
// docs/presets/ (committed, shown in the README and AGENTS.md). Hardware profile only.
phase = "preset gallery";
const gallery = {};
if (shoot) {
  const docs = join(here, "..", "..", "docs", "presets");
  mkdirSync(docs, { recursive: true });
  const ids = await page.evaluate(() => window.harness.presets());
  for (const kind of ["2d", "3d"])
    for (const id of ids[kind]) {
      const theme = kind === "2d" ? "light" : "dark";
      const selected = id === "hierarchy" ? "r0-1" : "agent-0";
      const state = await page.evaluate(([k, i, t, s]) => window.harness.mountPreset(k, i, t, s), [kind, id, theme, selected]);
      const attrs = await page.evaluate(() => {
        const r = document.querySelector("[data-fancy-graph]");
        return { preset: r?.getAttribute("data-fancy-graph-preset"), theme: r?.getAttribute("data-fancy-graph-theme"), labels: [...document.querySelectorAll("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").length };
      });
      await page.screenshot({ path: join(docs, `${kind}-${id}.png`) });
      gallery[`${kind}-${id}`] = { nodes: state.nodeCount, selected: state.selected, ...attrs };
    }
}

// The cosmos redesign (0.4.0), as consumers configure it: a galaxy per type, the kit map with its
// constellations and comets, a selected constellation, and a close look at data-driven bodies.
// Hardware profile only; committed to docs/presets/ and shown in the README.
phase = "cosmos captures";
const cosmosShots = {};
if (shoot) {
  const docs = join(here, "..", "..", "docs", "presets");
  const cases = {
    "3d-cosmos-galaxies": { data: "beachhead", lenses: "galaxies" },
    // The kit map with the sandbox's lens (systems by language, no galaxies asked for): 0.5.0 forms a galaxy per group.
    "3d-cosmos-kit": { data: "kit", lenses: "kit", frames: 40 },
    "3d-cosmos-kit-language": { data: "kitLanguage", lenses: "kit", frames: 40 },
    // Up close: the typescript system (capped at 12 planets) on its galaxy's arm, among the overflow stars, its rings faint.
    "3d-cosmos-kit-close": { data: "kitLanguage", lenses: "kit", flyToSystem: { id: "cosmos:system:typescript", factor: 2.2 }, frames: 90 },
    "3d-cosmos-constellation": { data: "kit", lenses: "kit", constellation: "ai", frames: 40 },
    "3d-cosmos-system": { data: "looks", lenses: "looks", fly: { id: "sol", distance: 330 }, layers: { orbits: true }, frames: 40 },
  };
  for (const [name, c] of Object.entries(cases)) {
    phase = `cosmos capture: ${name}`;
    cosmosShots[name] = await page.evaluate((x) => window.harness.mountCosmos(x), c);
    cosmosShots[name].labels = await page.evaluate(() => [...document.querySelectorAll("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").length);
    cosmosShots[name].constellationLabels = await page.evaluate(() => [...document.querySelectorAll("[data-fancy-graph-constellation-label]")].filter((e) => e.style.display !== "none").length);
    await page.screenshot({ path: join(docs, `${name}.png`) });
  }
}

// Regrouping (owner, 2026-11-28: "it doesn't matter what I group it by"): the same kit map, its node.group
// switched from family to language on a mounted view, re-forms the galaxies and flies every body there.
phase = "cosmos regroup";
await page.evaluate(() => window.harness.mountCosmos({ data: "kit", lenses: "kit", frames: 60, motion: true }));
const regroup = await page.evaluate(() => window.harness.regroupCosmos("kitLanguage", 12, "pkg-30"));
await shot({ path: join(shots, "3d-cosmos-regroup-midflight.png") });
regroup.landed = await page.evaluate(() => window.harness.positionAfter("pkg-30", 150));
await shot({ path: join(shots, "3d-cosmos-regroup-landed.png") });
const d3 = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0);
regroup.ok =
  regroup.before.clusters.join(",") === "commerce,documents,engines,surfaces,tooling" &&
  regroup.after.clusters.join(",") === "php,python,typescript" &&
  d3(regroup.before.at, regroup.landed) > 20 &&
  d3(regroup.after.at, regroup.landed) > 1;
console.log(JSON.stringify({ regroup }));

// Synthetic centres (0.5.0): the default galaxies add cores, and the public surface reports the INPUT.
phase = "cosmos synthetic";
await page.evaluate(() => window.harness.mountCosmos({ data: "kit", lenses: "kit", frames: 30, search: "fancy" }));
const synthetic = await page.evaluate(() => window.harness.syntheticProbe("pkg-30"));
synthetic.ok =
  synthetic.nodeCount === synthetic.input[0] &&
  synthetic.linkCount === synthetic.input[1] &&
  synthetic.attrNodes === String(synthetic.input[0]) &&
  synthetic.attrLinks === String(synthetic.input[1]) &&
  synthetic.syntheticNodeCount > 0 &&
  synthetic.attrSyntheticNodes === String(synthetic.syntheticNodeCount) &&
  synthetic.ariaLabel?.includes(String(synthetic.input[0])) === true &&
  Array.isArray(synthetic.matches) && synthetic.matches.length > 0 && synthetic.matches.every((id) => !id.startsWith("cosmos:")) &&
  synthetic.syntheticLast && synthetic.syntheticAreCores &&
  typeof synthetic.stepped === "string" && !synthetic.stepped.startsWith("cosmos:");
console.log(JSON.stringify({ synthetic }));

// Full screen (0.5.0): the view's ROOT goes full screen, controls and overlay inside it, the canvas following.
phase = "fullscreen";
const fullscreen = {};
const vp = (p) => p.root?.[0] === p.viewport[0] && p.root?.[1] === p.viewport[1] && p.canvas?.[0] === p.viewport[0] && p.canvas?.[1] === p.viewport[1];
const boxed = (p) => p.root?.[0] === 640 && p.root?.[1] === 400 && p.canvas?.[0] === 640 && p.canvas?.[1] === 400;
const probe = () => page.evaluate(() => window.harness.fullscreenProbe());
const settle = () => page.evaluate(() => window.harness.waitFrames(20));
// Every view mounts in a 640x400 box, so entering full screen must grow it to the viewport and leaving must shrink it back.
await page.evaluate(() => window.harness.mountCosmosControls("agent-0", true));
fullscreen.before3d = await probe();
// An agent's request carries no user gesture (made from a timer, past the activation lifespan),
// so it takes the fixed full-viewport fallback. Esc leaves it and keeps the selection.
phase = "fullscreen: agent request";
await page.evaluate(() => window.harness.agentFullscreenLater(6000));
await settle();
fullscreen.expanded3d = await probe();
phase = "fullscreen";
await page.focus("[data-fancy-graph] canvas");
await page.keyboard.press("Escape");
await settle();
fullscreen.expanded3dEsc = await probe();
// The controls overlay's button: a real click, so the native Fullscreen API on the view's root.
await page.click('[data-fancy-graph-control="fullscreen"]');
await settle();
fullscreen.native3d = await probe();
await shot({ path: join(shots, "3d-cosmos-fullscreen.png") });
await page.click('[data-fancy-graph-control="fullscreen"]');
await settle();
fullscreen.native3dExit = await probe();
// 2D with no controls overlay: the view's own button, and the host's overlay goes along.
await page.evaluate(() => window.harness.mountFullscreen2d());
await page.click("[data-fancy-3d-fullscreen-button]");
await settle();
fullscreen.native2d = await probe();
await shot({ path: join(shots, "2d-fullscreen.png") });
await page.click("[data-fancy-3d-fullscreen-button]");
await settle();
fullscreen.native2dExit = await probe();
const off = (p) => p.state.fullscreen === false && p.attr === "false" && !p.nativeIsRoot && boxed(p);
fullscreen.ok =
  boxed(fullscreen.before3d) &&
  fullscreen.expanded3d.state.fullscreen === true && fullscreen.expanded3d.state.mode === "expanded" && fullscreen.expanded3d.attrMode === "expanded" && !fullscreen.expanded3d.nativeIsRoot && vp(fullscreen.expanded3d) &&
  off(fullscreen.expanded3dEsc) && fullscreen.expanded3dEsc.state.selected === "agent-0" &&
  fullscreen.native3d.state.fullscreen === true && fullscreen.native3d.state.mode === "native" && fullscreen.native3d.nativeIsRoot && fullscreen.native3d.controlsInside && vp(fullscreen.native3d) &&
  off(fullscreen.native3dExit) &&
  fullscreen.native2d.state.fullscreen === true && fullscreen.native2d.state.mode === "native" && fullscreen.native2d.nativeIsRoot && fullscreen.native2d.overlayInside && vp(fullscreen.native2d) &&
  off(fullscreen.native2dExit);
console.log(JSON.stringify({ fullscreen }));

// Gamepad path: focus stepping, neighbourhood mode, analog camera, on both renderers.
const gamepad = {};
phase = "2D gamepad";
await page.evaluate(() => window.harness.mount2d({ nodes: 650, links: 900, focused: "agent-0", neighborhood: true }));
await page.evaluate(() => window.harness.waitFrames(10));
gamepad.step2d = await page.evaluate(async () => {
  const h = window.harness.handle();
  const seq = [];
  for (const d of ["next", "next", "right", "previous"]) {
    seq.push(h.stepFocus(d));
    await window.harness.waitFrames(3);
  }
  h.zoom(1.6);
  h.pan(30, 10);
  await window.harness.waitFrames(5);
  return { seq, focusedAttr: document.querySelector("[data-fancy-graph]")?.getAttribute("data-fancy-graph-focused"), neighbors: h.neighbors(seq[seq.length - 1] ?? "agent-0").length };
});
await shot({ path: join(shots, "2d-gamepad-neighbourhood.png") });
phase = "3D gamepad";
await page.evaluate(() => window.harness.mount3d({ nodes: 650, links: 900, focused: "agent-0", neighborhood: true }));
await page.evaluate(() => window.harness.waitFrames(60));
gamepad.step3d = await page.evaluate(async () => {
  const h = window.harness.handle();
  const before = h.getCamera();
  for (let i = 0; i < 30; i++) {
    h.orbit(0.01, 0.004);
    await window.harness.waitFrames(1);
  }
  h.zoom(1.3);
  const seq = [h.stepFocus("next"), h.stepFocus("next")];
  await window.harness.waitFrames(90);
  const after = h.getCamera();
  return { seq, yawMoved: +(after.yaw - before.yaw).toFixed(3), focusedAttr: document.querySelector("[data-fancy-graph]")?.getAttribute("data-fancy-graph-focused") };
});
await shot({ path: join(shots, "3d-gamepad-neighbourhood.png") });

// A click through the real input path, on the 2D view.
phase = "2D click";
await page.evaluate(() => window.harness.mount2d({ nodes: 650, links: 900 }));
await page.evaluate(() => window.harness.waitFrames(10));
const clickTarget = await page.evaluate(() => window.harness.handle().screenPosition("agent-0"));
await page.mouse.click(clickTarget.x, clickTarget.y);
await page.evaluate(() => window.harness.waitFrames(5));
const clicked = await page.evaluate(() => document.querySelector("[data-fancy-graph]")?.getAttribute("data-fancy-graph-selected"));

// Deselect and layer toggles on the cosmos, through real clicks (owner report, 2026-11-27).
phase = "3D cosmos controls";
await page.evaluate(() => window.harness.mountCosmosControls("agent-0"));
const attr = (name) => page.evaluate((n) => document.querySelector("[data-fancy-graph]")?.getAttribute(n), name);
const cosmosControls = { orbitRings: await page.evaluate(() => window.harness.handle().getState().layers.orbits) };
await shot({ path: join(shots, "3d-cosmos-orbits-controls.png") });
// Clicking the selected star again clears it.
const star = await page.evaluate(() => window.harness.handle().screenPosition("agent-0"));
await page.mouse.click(star.x, star.y);
await page.evaluate(() => window.harness.waitFrames(5));
cosmosControls.afterReclick = await attr("data-fancy-graph-selected");
await page.mouse.click(star.x, star.y);
await page.evaluate(() => window.harness.waitFrames(5));
cosmosControls.afterClick = await attr("data-fancy-graph-selected");
// The overlay's clear button.
await page.click('[data-fancy-graph-control="clear-selection"]');
await page.evaluate(() => window.harness.waitFrames(5));
cosmosControls.afterClear = await attr("data-fancy-graph-selected");
// Open the panel and switch the orbit paths off, then the links on for everything.
await page.click('[data-fancy-graph-control="panel"]');
// The stable toggle handle, which holds whichever element react-fancy puts the switch's data-* on (6.31 moved it).
await page.click('[data-fancy-graph-toggle="layer:orbits"]');
await page.click('[data-fancy-graph-control="link-visibility"] button:has-text("All")');
await page.evaluate(() => window.harness.waitFrames(10));
cosmosControls.layers = await attr("data-fancy-graph-layers");
cosmosControls.linkVisibility = await attr("data-fancy-graph-link-visibility");
await shot({ path: join(shots, "3d-cosmos-controls-all-links.png") });
const controlsOk =
  cosmosControls.orbitRings === true &&
  cosmosControls.afterReclick === "" &&
  cosmosControls.afterClick === "agent-0" &&
  cosmosControls.afterClear === "" &&
  cosmosControls.layers === "background clusters cores links comets labels" &&
  cosmosControls.linkVisibility === "all";

// A preset switched in place on a mounted view, every ordered pair, 2D and 3D (0.2.2: 3D into the cosmos threw).
phase = "preset switch";
const presetSwitch = {};
for (const kind of ["2d", "3d"]) presetSwitch[kind] = await page.evaluate((k) => window.harness.switchPresets(k), kind);
const switchOk = Object.values(presetSwitch).every((steps) => steps.length > 0 && steps.every((x) => x.got === x.want));

await browser.close();

results.checks = { labels2dVisible: labels2d, selected3d: picked, handles3d, clicked2d: clicked, gamepad, gallery, cosmosShots, regroup, synthetic, fullscreen, cosmosControls, presetSwitch };
results.console = consoleLog;
mkdirSync(join(here, "..", "results"), { recursive: true });
writeFileSync(join(here, "..", "results", `frame-times-${profile}.json`), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ checks: results.checks, console: consoleLog }, null, 2));
// SwiftShader prints GL driver performance notes ("GPU stall due to ReadPixels") as console
// warnings. In the software profile they are kept in the JSON and reported, but they do not
// fail it: that profile is a measurement of a CPU rasteriser, not the check. The hardware
// profile is the check, and any warning at all fails it.
const driverNote = (m) => profile === "software" && m.type === "warning" && /^\[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance/.test(m.text);
// The agent's no-gesture request is the one place the fallback is meant to run: fancy-3d tries the
// Fullscreen API first, Chrome refuses it and says so, and the view expands instead. Exactly that
// message, in exactly that phase, is expected; anywhere else, or any other text, still fails.
const gestureRefusal = (m) => m.phase === "fullscreen: agent request" && m.type === "warning" && m.text === "Failed to execute 'requestFullscreen' on 'Element': API can only be initiated by a user gesture.";
const bad = consoleLog.filter((m) => (m.type === "error" || m.type === "pageerror" || m.type === "warning") && !driverNote(m) && !gestureRefusal(m));
if (bad.length || clicked !== "agent-0" || picked !== "agent-0" || !controlsOk || !switchOk || !regroup.ok || !synthetic.ok || !fullscreen.ok) {
  console.error(`FAILED: ${bad.length} console errors/warnings, clicked=${clicked}, picked=${picked}, cosmosControls=${JSON.stringify(cosmosControls)}, presetSwitch=${switchOk ? "ok" : JSON.stringify(presetSwitch)}, regroup=${JSON.stringify(regroup)}, synthetic=${JSON.stringify(synthetic)}, fullscreen=${JSON.stringify(fullscreen)}`);
  process.exit(1);
}
console.log("OK");
