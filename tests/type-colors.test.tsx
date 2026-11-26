// @vitest-environment jsdom
/**
 * Per-type colours must tell the types apart. The palette fallback used to hash
 * each type into the palette on its own, so five ordinary types (person,
 * project, topic, place, event) landed on three colours: found by the fancy-labs
 * graph benchmark's screenshots, where events and projects were both purple.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "@particle-academy/fancy-3d-three/three";
import { DARK_THEME, GraphView, LIGHT_THEME, assignTypeColors, colorFor, resolveTheme, type GraphData, type GraphViewHandle } from "../src/index";
import { GraphSceneOnStage, type StageLike } from "../src/three/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TYPES = ["person", "project", "topic", "place", "event"];

describe("assignTypeColors", () => {
  it("the old per-type hash really does collide on these five types (the precondition)", () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      expect(new Set(TYPES.map((t) => colorFor(t, theme.palette))).size).toBeLessThan(TYPES.length);
    }
  });

  it("gives every type in the graph its own colour, light and dark", () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      const colors = assignTypeColors(theme, TYPES, null);
      expect(TYPES.map((t) => colors.get(t))).not.toContain(undefined);
      expect(new Set(TYPES.map((t) => colors.get(t))).size).toBe(TYPES.length);
      for (const t of TYPES) expect(theme.palette).toContain(colors.get(t));
    }
  });

  it("is stable: the order the types arrive in changes nothing", () => {
    const a = assignTypeColors(LIGHT_THEME, TYPES, null);
    const b = assignTypeColors(LIGHT_THEME, [...TYPES].reverse(), null);
    for (const t of TYPES) expect(b.get(t)).toBe(a.get(t));
  });

  it("a type that collides with nobody keeps its hashed colour", () => {
    const only = assignTypeColors(LIGHT_THEME, ["person"], null);
    expect(only.get("person")).toBe(colorFor("person", LIGHT_THEME.palette));
  });

  it("an explicit type colour and a CSS variable still win, and their colours are not handed out again", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.style.setProperty("--fancy-graph-type-topic", "#00ff00");
    const theme = resolveTheme({ base: "light", typeColors: { person: LIGHT_THEME.palette[0] } }, el);
    const colors = assignTypeColors(theme, TYPES, el);
    expect(colors.get("person")).toBe(LIGHT_THEME.palette[0]);
    expect(colors.get("topic")).toBe("#00ff00");
    expect(TYPES.filter((t) => t !== "person").map((t) => colors.get(t))).not.toContain(LIGHT_THEME.palette[0]);
    el.remove();
  });

  it("more types than palette colours still colours every type", () => {
    const many = Array.from({ length: LIGHT_THEME.palette.length + 3 }, (_, i) => `type-${i}`);
    const colors = assignTypeColors(LIGHT_THEME, many, null);
    for (const t of many) expect(LIGHT_THEME.palette).toContain(colors.get(t));
    expect(new Set(many.map((t) => colors.get(t))).size).toBe(LIGHT_THEME.palette.length);
  });
});

const data: GraphData = {
  nodes: TYPES.map((group, i) => ({ id: `n${i}`, label: group, group })),
  links: TYPES.slice(1).map((_, i) => ({ source: "n0", target: `n${i + 1}` })),
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("the views colour each type apart", () => {
  it("2D: five types, five node colours", () => {
    const fills: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : () => undefined),
      set: (t, k, v) => {
        if (k === "fillStyle") fills.push(String(v));
        t[k] = v;
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    const ref = createRef<GraphViewHandle>();
    act(() => root.render(<GraphView ref={ref} data={data} reducedMotion width={400} height={400} theme="light" />));
    act(() => ref.current!.renderFrame());
    const nodeFills = new Set(fills.filter((f) => LIGHT_THEME.palette.includes(f)));
    expect(nodeFills.size).toBe(TYPES.length);
  });

  it("3D: five types, five node colours", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000);
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 800 });
    Object.defineProperty(canvas, "clientHeight", { value: 800 });
    const subs = new Set<() => void>();
    const target = new THREE.Vector3();
    const controls = { target, update: () => camera.lookAt(target) };
    const stage: StageLike = {
      scene, camera, canvas, overlayRoot: document.createElement("div"),
      renderer: { getPixelRatio: () => 1, setClearColor: () => undefined } as unknown as THREE.WebGLRenderer,
      controls: controls as unknown as StageLike["controls"],
      onFrame: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    };
    let colors: Float32Array | null = null;
    const spy = { mount() {}, update: (f: { colors: Float32Array }) => { colors = f.colors; }, dispose() {} };
    act(() => root.render(<GraphSceneOnStage stage={stage} data={data} reducedMotion theme="dark" renderers={{ background: spy }} />));
    act(() => { controls.update(); camera.updateMatrixWorld(); subs.forEach((cb) => cb()); });
    const keys = new Set<string>();
    for (let i = 0; i < TYPES.length; i++) keys.add([...colors!.slice(i * 3, i * 3 + 3)].map((c) => c.toFixed(3)).join(","));
    expect(keys.size).toBe(TYPES.length);
  });
});
