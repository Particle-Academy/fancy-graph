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
page.on("console", (m) => consoleLog.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => consoleLog.push({ type: "pageerror", text: String(e) }));

await page.goto(pathToFileURL(join(here, "index.html")).href);
await page.waitForFunction(() => document.title === "fancy-graph harness ready");
const renderer = await page.evaluate(() => window.harness.webgl());
const version = browser.version();
const results = { profile, measuredAt: new Date().toISOString(), browser: `chromium ${version} (headless)`, webgl: renderer, viewport: "1280x800 @1x", cases: [] };

async function shot(opts) {
  if (shoot) await page.screenshot(opts);
}

async function bench(label, mount, opts) {
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
await page.evaluate(() => window.harness.mount2d({ nodes: 650, links: 900, search: "nova", selected: "agent-3" }));
await page.evaluate(() => window.harness.waitFrames(20));
await shot({ path: join(shots, "2d-650-selected-search.png") });
const labels2d = await page.evaluate(() => [...document.querySelectorAll("[data-fancy-graph-label]")].filter((e) => e.style.display !== "none").length);
await bench("2D, 4,000 nodes / 6,000 links", "mount2d", { nodes: 4000, links: 6000 });
await shot({ path: join(shots, "2d-4000.png") });

// ---- 3D cosmos
await bench("3D cosmos, 650 nodes", "mount3d", { nodes: 650, links: 900 });
await shot({ path: join(shots, "3d-cosmos-650.png") });
await page.evaluate(async () => {
  const h = window.harness.handle();
  h.flyToCluster(h.getClusters()[1].id);
  await window.harness.waitFrames(150);
});
await shot({ path: join(shots, "3d-cosmos-galaxy.png") });
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

// Gamepad path: focus stepping, neighbourhood mode, analog camera, on both renderers.
const gamepad = {};
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
await page.evaluate(() => window.harness.mount2d({ nodes: 650, links: 900 }));
await page.evaluate(() => window.harness.waitFrames(10));
const clickTarget = await page.evaluate(() => window.harness.handle().screenPosition("agent-0"));
await page.mouse.click(clickTarget.x, clickTarget.y);
await page.evaluate(() => window.harness.waitFrames(5));
const clicked = await page.evaluate(() => document.querySelector("[data-fancy-graph]")?.getAttribute("data-fancy-graph-selected"));

await browser.close();

results.checks = { labels2dVisible: labels2d, selected3d: picked, handles3d, clicked2d: clicked, gamepad };
results.console = consoleLog;
mkdirSync(join(here, "..", "results"), { recursive: true });
writeFileSync(join(here, "..", "results", `frame-times-${profile}.json`), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ checks: results.checks, console: consoleLog }, null, 2));
// SwiftShader prints GL driver performance notes ("GPU stall due to ReadPixels") as console
// warnings. In the software profile they are kept in the JSON and reported, but they do not
// fail it: that profile is a measurement of a CPU rasteriser, not the check. The hardware
// profile is the check, and any warning at all fails it.
const driverNote = (m) => profile === "software" && m.type === "warning" && /^\[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance/.test(m.text);
const bad = consoleLog.filter((m) => (m.type === "error" || m.type === "pageerror" || m.type === "warning") && !driverNote(m));
if (bad.length || clicked !== "agent-0" || picked !== "agent-0") {
  console.error(`FAILED: ${bad.length} console errors/warnings, clicked=${clicked}, picked=${picked}`);
  process.exit(1);
}
console.log("OK");
